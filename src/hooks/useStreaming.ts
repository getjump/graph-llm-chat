import { useCallback } from 'react';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { stepCountIs, streamText } from 'ai';
import { useStore } from '../store';
import {
  buildHeaders,
  getOpenRouterClient,
  isOpenRouterBaseUrl,
  type ChatMessage,
} from '../api/openrouter';
import type {
  NodeId,
  ConversationId,
  ComputedContext,
  PendingAttachment,
  FileAttachment,
  AttachmentProcessingSettings,
  RagScopeType,
  RagChunk,
  MessageRole,
  MemoryScopeType,
  MemoryItem,
  RetrievedMemoryItem,
  NormalizedMemorySettings,
  MemoryRetrievalPreview,
} from '../types';
import { isTextLikeFile, streamFileTextChunks, formatFileSize } from '../utils/files';
import { getReasoningParameter } from '../utils/models';
import {
  deleteRagChunksForScope,
  deleteRagChunksForSource,
  hasRagChunksForScope,
  loadRagChunksForScope,
  loadRagChunksForSource,
  saveRagChunks,
  loadMemoriesForScope,
  findMemoryByNormalizedText,
  saveMemory,
} from '../db';
import {
  normalizeAttachmentProcessingSettings,
  tokenizeRetrievalText,
  computeLexicalChunkScore,
  pickTopRetrievalChunks,
  buildExtractiveFallbackSummary,
  type RetrievalChunkCandidate,
} from '../utils/attachments';
import { createLocalTools } from '../tools/localTools';
import { createMcpTools } from '../tools/mcpTools';
import { isSensitiveToolName } from '../utils/tools';
import {
  extractMemoryCandidates,
  type MemoryCandidate,
} from '../utils/memory';
import { estimateContextExtraTokens } from '../utils/tokenBudget';
import type { ToolSet } from 'ai';

const RESERVED_OUTPUT_TOKENS = 512;
const MIN_INPUT_TOKENS = 512;
const SUMMARY_TAIL_MESSAGES = 6;
const FILE_SUMMARY_MAX_CHUNKS = 12;
const RETRIEVAL_MAX_CHUNKS_PER_FILE = 80;

interface AttachmentToolEntry {
  attachmentId: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  source: 'handle' | 'memory';
  handleId?: string;
  scope: 'conversation' | 'project';
}

interface SendOptions {
  skipUserMessage?: boolean;
}

function previewPayload(value: unknown, maxLength = 280): string {
  if (value === undefined) return '';
  const raw =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  if (!raw) return '';
  return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
}

function collectAttachmentToolEntries(params: {
  state: ReturnType<typeof useStore.getState>;
  conversationId: string;
  projectId?: string;
}): AttachmentToolEntry[] {
  const { state, conversationId, projectId } = params;
  const entries: AttachmentToolEntry[] = [];
  const dedupe = new Set<string>();

  for (const node of state.nodes.values()) {
    if (node.conversationId !== conversationId) continue;
    for (const message of node.messages) {
      if (!message.attachments) continue;
      for (const attachment of message.attachments) {
        const key = attachment.handleId || `conversation:${attachment.id}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        entries.push({
          attachmentId: attachment.id,
          name: attachment.name,
          size: attachment.size,
          type: attachment.type,
          lastModified: attachment.lastModified,
          source: attachment.source,
          handleId: attachment.handleId,
          scope: 'conversation',
        });
      }
    }
  }

  if (projectId) {
    const project = state.projects.get(projectId);
    for (const attachment of project?.attachments || []) {
      const key = attachment.handleId || `project:${attachment.id}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      entries.push({
        attachmentId: attachment.id,
        name: attachment.name,
        size: attachment.size,
        type: attachment.type,
        lastModified: attachment.lastModified,
        source: attachment.source,
        handleId: attachment.handleId,
        scope: 'project',
      });
    }
  }

  return entries.sort((a, b) => b.lastModified - a.lastModified);
}

export function useStreaming() {
  const sendMessage = useCallback(
    async (
      nodeId: NodeId,
      userContent: string,
      attachments: PendingAttachment[] = [],
      options: SendOptions = {}
    ) => {
      const state = useStore.getState();
      const apiKey = state.apiKey;

      if (!apiKey) {
        throw new Error('API key not set');
      }

      const node = state.nodes.get(nodeId);
      if (!node) {
        throw new Error(`Node ${nodeId} not found`);
      }

      const conversation = state.conversations.get(node.conversationId);
      const project =
        conversation?.projectId ? state.projects.get(conversation.projectId) : null;
      const memorySettings = state.memorySettings;
      const attachmentProcessing = normalizeAttachmentProcessingSettings(
        conversation?.attachmentProcessing
      );
      const resolvedModel = node.isReply
        ? state.selectedModel
        : node.model || state.selectedModel;
      const embeddingModel = state.embeddingModel || resolvedModel;
      const resolvedModelInfo = state.models.find((model) => model.id === resolvedModel);
      if (!node.model && !node.isReply) {
        state.updateNode(nodeId, { model: resolvedModel });
      }
      const abortController = new AbortController();

      // Register active request
      state.registerRequest(nodeId, abortController);

      const attachmentMetadata: FileAttachment[] = attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        type: attachment.type,
        lastModified: attachment.lastModified,
        source: attachment.source,
        handleId: attachment.handleId,
      }));

      const projectAttachments = project?.attachments ?? [];
      const hasConversationRagChunks =
        attachmentProcessing.mode === 'retrieval'
          ? await hasRagChunksForScope('conversation', node.conversationId)
          : false;
      const shouldProcessConversationAttachmentContext =
        attachmentMetadata.length > 0 || hasConversationRagChunks;

      const hasProjectRagChunks =
        attachmentProcessing.mode === 'retrieval' && project?.id
          ? await hasRagChunksForScope('project', project.id)
          : false;
      const hasProjectAttachmentContext =
        projectAttachments.length > 0 &&
        Array.from(state.nodes.values())
          .filter((n) => n.conversationId === node.conversationId)
          .some((n) => n.messages.some((m) => m.isProjectAttachmentContext));
      const shouldProcessProjectAttachmentContext =
        attachmentProcessing.mode === 'retrieval'
          ? projectAttachments.length > 0 || hasProjectRagChunks
          : projectAttachments.length > 0 && !hasProjectAttachmentContext;

      let attachmentContextMessageId: string | null = null;
      if (shouldProcessConversationAttachmentContext) {
        attachmentContextMessageId = state.addMessage(nodeId, {
          role: 'system',
          content: 'Processing attachments...',
          isStreaming: true,
          isAttachmentContext: true,
        });
      }

      let projectAttachmentContextMessageId: string | null = null;
      if (shouldProcessProjectAttachmentContext) {
        projectAttachmentContextMessageId = state.addMessage(nodeId, {
          role: 'system',
          content: 'Processing project attachments...',
          isStreaming: true,
          isAttachmentContext: true,
          isProjectAttachmentContext: true,
        });
      }

      if (!options.skipUserMessage) {
        // Add user message
        state.addMessage(nodeId, {
          role: 'user',
          content: userContent,
          isStreaming: false,
          attachments: attachmentMetadata.length > 0 ? attachmentMetadata : undefined,
        });
      }

      // Add placeholder for assistant response
      const assistantMessageId = state.addMessage(nodeId, {
        role: 'assistant',
        content: '',
        isStreaming: true,
        model: resolvedModel,
      });
      const shouldReindexNow = Boolean(conversation?.ragReindexRequestedAt);

      try {
        const client = getOpenRouterClient(apiKey, state.apiBaseUrl);

        if (conversation && shouldReindexNow) {
          state.updateConversation(conversation.id, {
            ragRebuildInProgress: true,
          });
          await deleteRagChunksForScope('conversation', node.conversationId);
          if (project?.id) {
            await deleteRagChunksForScope('project', project.id);
          }
          state.updateConversation(conversation.id, {
            ragReindexRequestedAt: undefined,
          });
        }

        if (attachmentContextMessageId) {
          try {
            const attachmentContext = await buildAttachmentContext(
              attachments,
              userContent,
              attachmentProcessing,
              embeddingModel,
              'conversation',
              node.conversationId,
              resolvedModel,
              client,
              state,
              abortController.signal
            );
            state.updateMessage(nodeId, attachmentContextMessageId, {
              content: attachmentContext,
              isStreaming: false,
            });
          } catch (error) {
            if ((error as Error).name === 'AbortError') {
              throw error;
            }
            const message =
              (error as Error).message || 'Failed to process attachments';
            state.updateMessage(nodeId, attachmentContextMessageId, {
              content: `[Attachment processing failed: ${message}]`,
              isStreaming: false,
            });
          }
        }

        if (projectAttachmentContextMessageId) {
          try {
            const attachmentContext = await buildAttachmentContext(
              projectAttachments.map((attachment) => ({ ...attachment })),
              userContent,
              attachmentProcessing,
              embeddingModel,
              'project',
              project?.id || node.conversationId,
              resolvedModel,
              client,
              state,
              abortController.signal
            );
            state.updateMessage(nodeId, projectAttachmentContextMessageId, {
              content: attachmentContext,
              isStreaming: false,
              isProjectAttachmentContext: true,
            });
          } catch (error) {
            if ((error as Error).name === 'AbortError') {
              throw error;
            }
            const message =
              (error as Error).message || 'Failed to process project attachments';
            state.updateMessage(nodeId, projectAttachmentContextMessageId, {
              content: `[Project attachment processing failed: ${message}]`,
              isStreaming: false,
              isProjectAttachmentContext: true,
            });
          }
        }

        let memoryPrompt: { promptContent: string; preview: MemoryRetrievalPreview } | null =
          null;
        if (memorySettings.enabled) {
          try {
            memoryPrompt = await buildMemoryPrompt({
              query: userContent,
              embeddingModel,
              conversationId: node.conversationId,
              projectId: project?.id,
              settings: memorySettings,
              client,
              signal: abortController.signal,
            });
          } catch (error) {
            state.addToast({
              type: 'error',
              title: 'Memory retrieval failed',
              message:
                error instanceof Error ? error.message : 'Failed to retrieve memory.',
            });
          }
        }
        state.setMemoryRetrievalPreview(node.conversationId, memoryPrompt?.preview || null);

        // Get context (all ancestor messages)
        const context: ComputedContext = state.getComputedContext(nodeId);

        // Build messages array from context
        let messages: ChatMessage[] = context.messages
          .filter((m) => m.id !== assistantMessageId) // Exclude the placeholder
          .map((m) => ({
            role: m.role,
            content: m.content,
          }))
          // Do not send empty user turns to provider APIs.
          .filter((m) => !(m.role === 'user' && !m.content.trim()));

        // Add the new user message if not already in context
        const trimmedUserContent = userContent.trim();
        const hasUserMessage =
          trimmedUserContent.length > 0 &&
          messages.some(
            (m) => m.role === 'user' && m.content.trim() === trimmedUserContent
          );
        if (trimmedUserContent.length > 0 && !hasUserMessage) {
          messages.push({ role: 'user', content: userContent });
        }

        if (memoryPrompt?.promptContent) {
          const [systemMessages, conversationMessages] = splitSystemMessages(messages);
          messages = [
            ...systemMessages,
            {
              role: 'system',
              content: memoryPrompt.promptContent,
            },
            ...conversationMessages,
          ];
        }

        const maxContextTokens =
          state.models.find((model) => model.id === resolvedModel)?.contextLength || 4096;
        const toolOverheadTokens = estimateContextExtraTokens({
          toolSettings: state.toolSettings,
          memorySettings,
          memoryPreview: null,
        }).tools.total;
        const maxInputTokens = Math.max(
          MIN_INPUT_TOKENS,
          maxContextTokens - RESERVED_OUTPUT_TOKENS - toolOverheadTokens
        );

        const { messages: preparedMessages, summary } = await maybeSummarizeMessages(
          messages,
          maxInputTokens,
          resolvedModel,
          client
        );
        if (summary) {
          state.updateNode(nodeId, {
            contextSummary: { content: summary.content, createdAt: Date.now() },
          });
        } else if (node.contextSummary) {
          state.updateNode(nodeId, { contextSummary: undefined });
        }

        // Stream response
        const reasoningParam = getReasoningParameter(resolvedModelInfo);
        const reasoningEffort = conversation?.reasoningEffort;
        const requestPayload = {
          model: resolvedModel,
          messages: preparedMessages,
          temperature: conversation?.temperature,
          max_tokens: conversation?.maxTokens,
          ...(reasoningEffort && reasoningParam === 'reasoning_effort'
            ? { reasoning_effort: reasoningEffort }
            : {}),
          ...(reasoningEffort && reasoningParam === 'reasoning'
            ? { reasoning: { effort: reasoningEffort } }
            : {}),
        };

        const streamLegacyResponse = async () => {
          for await (const chunk of client.streamChatCompletion(
            requestPayload,
            abortController.signal
          )) {
            state.appendToStreamingMessage(nodeId, assistantMessageId, chunk);
          }
        };

        const streamToolResponse = async () => {
          const toolSettings = state.toolSettings;
          if (!toolSettings.enabled) {
            await streamLegacyResponse();
            return;
          }

          const providerHeaders = buildHeaders(
            apiKey,
            isOpenRouterBaseUrl(state.apiBaseUrl),
            true
          );
          const provider = createOpenAICompatible({
            baseURL: state.apiBaseUrl,
            name: 'openai-compatible',
            headers: providerHeaders,
          });

          const confirmToolCall = async (
            toolName: string,
            args: Record<string, unknown>,
            source: 'local' | 'mcp'
          ) => {
            if (!toolSettings.permissions.requireConfirmation) return true;
            const patterns = toolSettings.permissions.sensitiveTools;
            const shouldConfirm =
              source === 'mcp'
                ? isSensitiveToolName(`mcp:${toolName}`, patterns) ||
                  isSensitiveToolName(toolName, patterns)
                : isSensitiveToolName(toolName, patterns);
            if (!shouldConfirm) return true;

            return window.confirm(
              `Allow tool "${source === 'mcp' ? `mcp:${toolName}` : toolName}"?\n\nArgs: ${previewPayload(
                args
              )}`
            );
          };

          const localTools = createLocalTools({
            enabled: toolSettings.enabled,
            enableDatetimeNow: toolSettings.datetimeNow.enabled,
            enableCalculator: toolSettings.calculator.enabled,
            enableSearchMessages: toolSettings.searchMessages.enabled,
            enableSearchContextChunks: toolSettings.searchContextChunks.enabled,
            enableAttachmentReader: toolSettings.attachmentReader.enabled,
            enableDaytona: toolSettings.daytona.enabled,
            maxExpressionLength: toolSettings.calculator.maxExpressionLength,
            maxMessageResults: toolSettings.searchMessages.maxResults,
            maxContextChunkResults: toolSettings.searchContextChunks.maxResults,
            attachmentReaderMaxCharsPerRead:
              toolSettings.attachmentReader.maxCharsPerRead,
            attachments: collectAttachmentToolEntries({
              state: useStore.getState(),
              conversationId: node.conversationId,
              projectId: project?.id,
            }),
            resolveAttachmentFile: async (handleId: string) => {
              const handle = useStore.getState().getFileHandle(handleId);
              if (!handle) return null;
              try {
                return await handle.getFile();
              } catch {
                return null;
              }
            },
            daytonaConfig: {
              apiKey: toolSettings.daytona.apiKey,
              apiUrl: toolSettings.daytona.apiUrl || undefined,
              target: toolSettings.daytona.target || undefined,
              sandboxId: toolSettings.daytona.sandboxId || undefined,
              defaultLanguage: toolSettings.daytona.defaultLanguage,
              autoCreateSandbox: toolSettings.daytona.autoCreateSandbox,
              autoDeleteCreatedSandbox: toolSettings.daytona.autoDeleteCreatedSandbox,
              defaultTimeoutSeconds: toolSettings.daytona.defaultTimeoutSeconds,
              maxStdoutChars: toolSettings.daytona.maxStdoutChars,
              maxStderrChars: toolSettings.daytona.maxStderrChars,
            },
            conversationId: node.conversationId,
            projectId: project?.id,
            confirmToolCall: (toolName, args) =>
              confirmToolCall(toolName, args, 'local'),
          });

          const mcpTools: ToolSet = {};
          const mcpAliases: Record<
            string,
            {
              originalName: string;
              displayName: string;
            }
          > = {};
          const mcpClosers: Array<() => Promise<void>> = [];

          if (toolSettings.mcp.enabled) {
            const enabledMcpServers = toolSettings.mcp.servers.filter(
              (server) => server.enabled && server.url.trim()
            );

            for (const [index, server] of enabledMcpServers.entries()) {
              const serverLabel = server.name.trim() || `MCP ${index + 1}`;
              try {
                const mcpBundle = await createMcpTools({
                  config: {
                    url: server.url.trim(),
                    transport: server.transport,
                    authToken: server.authToken || undefined,
                  },
                  enabledTools: server.enabledTools,
                  aliasPrefix: server.id || `server-${index + 1}`,
                  displayNamePrefix: serverLabel,
                  confirmToolCall: (toolName, args) =>
                    confirmToolCall(toolName, args, 'mcp'),
                });
                Object.assign(mcpTools, mcpBundle.tools);
                Object.assign(mcpAliases, mcpBundle.aliases);
                mcpClosers.push(mcpBundle.close);
              } catch (error) {
                state.addToast({
                  type: 'error',
                  title: `${serverLabel} unavailable`,
                  message:
                    error instanceof Error
                      ? error.message
                      : 'Failed to initialize MCP tools.',
                });
              }
            }
          }

          const allTools = { ...localTools, ...mcpTools };
          if (Object.keys(allTools).length === 0) {
            await streamLegacyResponse();
            return;
          }

          const tracesByToolCallId = new Map<
            string,
            { traceId: string; startedAt: number }
          >();

          try {
            const result = streamText({
              model: provider.chatModel(resolvedModel),
              messages: preparedMessages.map((message) => ({
                role: message.role,
                content: message.content,
              })),
              tools: allTools,
              stopWhen: stepCountIs(toolSettings.maxSteps),
              abortSignal: abortController.signal,
              temperature: conversation?.temperature,
              maxOutputTokens: conversation?.maxTokens,
              ...(reasoningEffort
                ? {
                    providerOptions: {
                      'openai-compatible': {
                        reasoningEffort,
                      },
                    },
                  }
                : {}),
              onChunk: async ({ chunk }) => {
                if (chunk.type === 'tool-call') {
                  const startedAt = Date.now();
                  const mcpAlias = mcpAliases[chunk.toolName];
                  const displayToolName = mcpAlias?.displayName || chunk.toolName;
                  const source: 'local' | 'mcp' = mcpAlias ? 'mcp' : 'local';
                  const traceId = state.addToolTrace({
                    conversationId: node.conversationId,
                    nodeId,
                    toolCallId: chunk.toolCallId,
                    toolName: displayToolName,
                    source,
                    inputPreview: previewPayload(chunk.input),
                  });
                  tracesByToolCallId.set(chunk.toolCallId, { traceId, startedAt });
                  if (toolSettings.showEvents) {
                    state.addToast({
                      type: 'info',
                      title: `Tool call: ${displayToolName}`,
                      message: `Source: ${source}`,
                    });
                  }
                  return;
                }
                if (chunk.type === 'tool-result') {
                  const mcpAlias = mcpAliases[chunk.toolName];
                  const displayToolName = mcpAlias?.displayName || chunk.toolName;
                  const traceRecord = tracesByToolCallId.get(chunk.toolCallId);
                  const traceId = traceRecord?.traceId;
                  const now = Date.now();
                  const outputRecord =
                    chunk.output && typeof chunk.output === 'object'
                      ? (chunk.output as Record<string, unknown>)
                      : null;
                  const denied = outputRecord?.denied === true;
                  if (traceId) {
                    state.updateToolTrace(node.conversationId, traceId, {
                      toolName: displayToolName,
                      status: denied ? 'denied' : 'succeeded',
                      outputPreview: previewPayload(chunk.output),
                      finishedAt: now,
                      durationMs: traceRecord ? now - traceRecord.startedAt : undefined,
                    });
                  }
                  tracesByToolCallId.delete(chunk.toolCallId);
                  if (toolSettings.showEvents) {
                    state.addToast({
                      type: denied ? 'info' : 'success',
                      title: `Tool result: ${displayToolName}`,
                      message: denied ? 'Execution denied' : 'Tool execution completed.',
                    });
                  }
                }
              },
            });

            let hasText = false;
            for await (const delta of result.textStream) {
              if (!delta) continue;
              hasText = true;
              state.appendToStreamingMessage(nodeId, assistantMessageId, delta);
            }

            if (!hasText) {
              const finalText = await result.text;
              if (finalText) {
                state.updateMessage(nodeId, assistantMessageId, {
                  content: finalText,
                });
              }
            }
          } finally {
            const now = Date.now();
            for (const [, traceRecord] of tracesByToolCallId) {
              state.updateToolTrace(node.conversationId, traceRecord.traceId, {
                status: 'failed',
                error: 'Tool call did not finish.',
                finishedAt: now,
                durationMs: now - traceRecord.startedAt,
              });
            }
            tracesByToolCallId.clear();
            for (const close of mcpClosers) {
              await close();
            }
          }
        };

        if (state.toolSettings.enabled) {
          try {
            await streamToolResponse();
          } catch (toolError) {
            if ((toolError as Error).name === 'AbortError') {
              throw toolError;
            }
            state.updateMessage(nodeId, assistantMessageId, { content: '' });
            state.addToast({
              type: 'info',
              title: 'Tool loop failed',
              message: 'Falling back to direct model streaming.',
            });
            await streamLegacyResponse();
          }
        } else {
          await streamLegacyResponse();
        }

        // Mark streaming complete
        state.updateMessage(nodeId, assistantMessageId, { isStreaming: false });
        state.updateNode(nodeId, { status: 'idle' });

        if (memorySettings.enabled) {
          try {
            if (memorySettings.autoExtractUser) {
              await extractAndStoreMemories({
                role: 'user',
                content: userContent,
                conversationId: node.conversationId,
                projectId: project?.id,
                nodeId,
                messageId: options.skipUserMessage
                  ? undefined
                  : findLatestMessageId(nodeId, 'user'),
                settings: memorySettings,
                embeddingModel,
                client,
                signal: abortController.signal,
              });
            }

            if (memorySettings.autoExtractAssistant) {
              const finalNode = useStore.getState().nodes.get(nodeId);
              const assistantMessage = finalNode?.messages.find(
                (message) => message.id === assistantMessageId
              );
              if (assistantMessage?.content?.trim()) {
                await extractAndStoreMemories({
                  role: 'assistant',
                  content: assistantMessage.content,
                  conversationId: node.conversationId,
                  projectId: project?.id,
                  nodeId,
                  messageId: assistantMessage.id,
                  settings: memorySettings,
                  embeddingModel,
                  client,
                  signal: abortController.signal,
                });
              }
            }
          } catch (error) {
            state.addToast({
              type: 'error',
              title: 'Memory update failed',
              message:
                error instanceof Error ? error.message : 'Failed to update memory.',
            });
          }
        }

        void maybeAutoTitleConversation({
          nodeId,
          client,
          fallbackModel: resolvedModel,
        });
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          // Request was cancelled
          if (attachmentContextMessageId) {
            state.updateMessage(nodeId, attachmentContextMessageId, {
              isStreaming: false,
              content: '[Attachment processing cancelled]',
            });
          }
          if (projectAttachmentContextMessageId) {
            state.updateMessage(nodeId, projectAttachmentContextMessageId, {
              isStreaming: false,
              content: '[Project attachment processing cancelled]',
            });
          }
          state.updateMessage(nodeId, assistantMessageId, {
            isStreaming: false,
            content: '[Cancelled]',
          });
          state.updateNode(nodeId, { status: 'cancelled' });
        } else {
          // Actual error
          const errorMessage = (error as Error).message || 'Unknown error';
          state.updateMessage(nodeId, assistantMessageId, {
            isStreaming: false,
            content: `[Error: ${errorMessage}]`,
          });
          state.updateNode(nodeId, { status: 'error', error: errorMessage });
          state.addToast({
            type: 'error',
            title: 'Request failed',
            message: errorMessage,
          });
        }
      } finally {
        if (conversation && shouldReindexNow) {
          state.updateConversation(conversation.id, {
            ragRebuildInProgress: false,
          });
        }
        state.unregisterRequest(nodeId);
      }
    },
    []
  );

  const cancelRequest = useCallback(
    (nodeId: NodeId) => {
      useStore.getState().cancelRequest(nodeId);
    },
    []
  );

  const retryMessage = useCallback(
    async (nodeId: NodeId) => {
      const state = useStore.getState();
      const node = state.nodes.get(nodeId);
      if (!node) return;

      const lastUser = [...node.messages]
        .slice()
        .reverse()
        .find((message) => message.role === 'user');

      if (!lastUser) {
        state.addToast({
          type: 'info',
          title: 'Nothing to retry',
          message: 'No user message found to retry.',
        });
        return;
      }

      const attachments: PendingAttachment[] =
        lastUser.attachments?.map((attachment) => ({
          ...attachment,
        })) ?? [];

      if (attachments.some((attachment) => attachment.source === 'memory')) {
        state.addToast({
          type: 'info',
          title: 'Attachments missing',
          message: 'Reattach in-memory files before retrying.',
        });
      }

      await sendMessage(nodeId, lastUser.content, attachments, {
        skipUserMessage: true,
      });
    },
    [sendMessage]
  );

  return { sendMessage, cancelRequest, retryMessage };
}

async function maybeSummarizeMessages(
  messages: ChatMessage[],
  maxInputTokens: number,
  model: string,
  client: ReturnType<typeof getOpenRouterClient>
): Promise<{ messages: ChatMessage[]; summary?: { content: string; sourceCount: number } }> {
  const estimated = estimateTokens(messages);
  if (estimated <= maxInputTokens) {
    return { messages };
  }

  const [systemMessages, conversationMessages] = splitSystemMessages(messages);
  if (conversationMessages.length <= SUMMARY_TAIL_MESSAGES) {
    return { messages: trimToTokenLimit(messages, maxInputTokens) };
  }

  const tail = conversationMessages.slice(-SUMMARY_TAIL_MESSAGES);
  const toSummarize = conversationMessages.slice(
    0,
    conversationMessages.length - SUMMARY_TAIL_MESSAGES
  );

  const summary = await summarizeMessages(toSummarize, model, client);
  const summaryMessage: ChatMessage = {
    role: 'system',
    content: `Summary of earlier context:\\n${summary}`,
  };

  const combined =
    systemMessages.length > 0
      ? [...systemMessages, summaryMessage, ...tail]
      : [summaryMessage, ...tail];

  if (estimateTokens(combined) <= maxInputTokens) {
    return { messages: combined, summary: { content: summary, sourceCount: toSummarize.length } };
  }

  return {
    messages: trimToTokenLimit(combined, maxInputTokens),
    summary: { content: summary, sourceCount: toSummarize.length },
  };
}

const autoTitleInFlight = new Set<ConversationId>();

function findLatestMessageId(nodeId: NodeId, role: MessageRole) {
  const node = useStore.getState().nodes.get(nodeId);
  if (!node) return undefined;
  for (let i = node.messages.length - 1; i >= 0; i--) {
    if (node.messages[i].role === role) {
      return node.messages[i].id;
    }
  }
  return undefined;
}

function getMemoryScopes(
  settings: NormalizedMemorySettings,
  conversationId: string,
  projectId?: string
): Array<{ scopeType: MemoryScopeType; scopeId: string }> {
  const scopes: Array<{ scopeType: MemoryScopeType; scopeId: string }> = [];
  if (settings.includeConversation) {
    scopes.push({ scopeType: 'conversation', scopeId: conversationId });
  }
  if (settings.includeProject && projectId) {
    scopes.push({ scopeType: 'project', scopeId: projectId });
  }
  if (settings.includeUser) {
    scopes.push({ scopeType: 'user', scopeId: 'global' });
  }
  return scopes;
}

async function buildMemoryPrompt(params: {
  query: string;
  embeddingModel: string;
  conversationId: string;
  projectId?: string;
  settings: NormalizedMemorySettings;
  client: ReturnType<typeof getOpenRouterClient>;
  signal: AbortSignal;
}): Promise<{ promptContent: string; preview: MemoryRetrievalPreview } | null> {
  const { query, embeddingModel, conversationId, projectId, settings, client, signal } = params;
  const scopes = getMemoryScopes(settings, conversationId, projectId);
  if (scopes.length === 0) return null;

  const allMemoriesArrays = await Promise.all(
    scopes.map((scope) => loadMemoriesForScope(scope.scopeType, scope.scopeId))
  );
  const unique = new Map<string, MemoryItem>();
  for (const memories of allMemoriesArrays) {
    for (const memory of memories) {
      unique.set(`${memory.scopeType}:${memory.scopeId}:${memory.normalizedText}`, memory);
    }
  }
  const allMemories = Array.from(unique.values());
  if (allMemories.length === 0) return null;

  const queryTerms = tokenizeRetrievalText(query);
  const queryEmbedding =
    query.trim().length > 0
      ? await safeEmbedQuery(query, embeddingModel, client, signal)
      : null;
  const now = Date.now();

  const scored = allMemories
    .map((memory): RetrievedMemoryItem => {
      const lexical =
        queryTerms.length > 0 ? computeLexicalChunkScore(memory.text, queryTerms) : 0;
      const semantic =
        queryEmbedding &&
        memory.embeddingModel === embeddingModel &&
        Array.isArray(memory.embedding) &&
        memory.embedding.length > 0
          ? cosineSimilarity(queryEmbedding, memory.embedding)
          : 0;
      const ageDays = Math.max(0, (now - memory.updatedAt) / (1000 * 60 * 60 * 24));
      const recency = Math.max(0, 1 - ageDays / 30);
      const score =
        lexical +
        semantic * 4 +
        (memory.pinned ? 0.6 : 0) +
        Math.max(0, memory.confidence) +
        recency * 0.2;
      return {
        id: memory.id,
        text: memory.text,
        scopeType: memory.scopeType,
        category: memory.category,
        confidence: memory.confidence,
        score,
        pinned: memory.pinned,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
      return b.confidence - a.confidence;
    })
    .slice(0, settings.maxRetrieved);

  if (scored.length === 0) return null;

  const promptLines = scored.map(
    (item, index) =>
      `${index + 1}. [${item.scopeType}/${item.category}${item.pinned ? '/pinned' : ''}] ${
        item.text
      }`
  );
  const promptContent =
    'Relevant memories (use only when helpful and applicable):\n' +
    promptLines.join('\n');

  const previewLines = scored.map(
    (item, index) =>
      `${index + 1}. [${item.scopeType}/${item.category}${item.pinned ? '/pinned' : ''}] score=${item.score.toFixed(3)} confidence=${item.confidence.toFixed(2)}\n${item.text}`
  );
  const previewContent = [
    'Memory context (retrieved):',
    'Mode: retrieval (hybrid lexical + embedding)',
    `Query: ${query.trim() || '(empty prompt)'}`,
    `Embedding model: ${embeddingModel}`,
    `Items: ${scored.length}`,
    '',
    ...previewLines,
  ].join('\n');

  return {
    promptContent,
    preview: {
      query,
      embeddingModel,
      generatedAt: now,
      items: scored,
      content: previewContent,
    },
  };
}

function createMemoryId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function embedMemoryCandidates(params: {
  candidates: MemoryCandidate[];
  embeddingModel: string;
  client: ReturnType<typeof getOpenRouterClient>;
  signal: AbortSignal;
}) {
  const { candidates, embeddingModel, client, signal } = params;
  if (candidates.length === 0) return new Map<string, number[]>();

  const output = new Map<string, number[]>();
  try {
    const vectors = await client.embeddings(
      {
        model: embeddingModel,
        input: candidates.map((candidate) => candidate.text),
      },
      signal
    );
    for (let i = 0; i < candidates.length; i++) {
      const vector = vectors[i];
      if (vector && vector.length > 0) {
        output.set(candidates[i].normalizedText, vector);
      }
    }
  } catch {
    // Keep lexical-only memory retrieval when embeddings are unavailable.
  }
  return output;
}

async function extractAndStoreMemories(params: {
  role: MessageRole;
  content: string;
  conversationId: string;
  projectId?: string;
  nodeId: NodeId;
  messageId?: string;
  settings: NormalizedMemorySettings;
  embeddingModel: string;
  client: ReturnType<typeof getOpenRouterClient>;
  signal: AbortSignal;
}) {
  const {
    role,
    content,
    conversationId,
    projectId,
    nodeId,
    messageId,
    settings,
    embeddingModel,
    client,
    signal,
  } = params;
  const scopes = getMemoryScopes(settings, conversationId, projectId);
  if (scopes.length === 0) return;

  const extracted = extractMemoryCandidates(content, role, settings.maxPerMessage).filter(
    (candidate) => candidate.confidence >= settings.minConfidence
  );
  if (extracted.length === 0) return;

  const embeddingsByText = await embedMemoryCandidates({
    candidates: extracted,
    embeddingModel,
    client,
    signal,
  });
  const now = Date.now();

  for (const scope of scopes) {
    for (const candidate of extracted) {
      const existing = await findMemoryByNormalizedText(
        scope.scopeType,
        scope.scopeId,
        candidate.normalizedText
      );
      const vector = embeddingsByText.get(candidate.normalizedText);
      if (existing) {
        await saveMemory({
          ...existing,
          text: candidate.text,
          category: candidate.category,
          confidence: Math.max(existing.confidence, candidate.confidence),
          sourceConversationId: conversationId,
          sourceNodeId: nodeId,
          sourceMessageId: messageId,
          sourceRole: role,
          embedding: vector ?? existing.embedding,
          embeddingModel: vector ? embeddingModel : existing.embeddingModel,
          updatedAt: now,
        });
        continue;
      }

      await saveMemory({
        id: createMemoryId(),
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        text: candidate.text,
        normalizedText: candidate.normalizedText,
        category: candidate.category,
        confidence: candidate.confidence,
        pinned: false,
        sourceConversationId: conversationId,
        sourceNodeId: nodeId,
        sourceMessageId: messageId,
        sourceRole: role,
        embedding: vector,
        embeddingModel: vector ? embeddingModel : undefined,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

function getConversationTitleSourceNodeId(
  state: ReturnType<typeof useStore.getState>,
  conversationId: ConversationId
) {
  const nodes = Array.from(state.nodes.values()).filter(
    (candidate) => candidate.conversationId === conversationId && !candidate.isReply
  );
  if (nodes.length === 0) return null;

  const withVisibleMessages = nodes.filter((candidate) =>
    candidate.messages.some((message) => message.role !== 'system' && message.content.trim())
  );
  if (withVisibleMessages.length > 0) {
    withVisibleMessages.sort((a, b) => b.updatedAt - a.updatedAt);
    return withVisibleMessages[0].id;
  }

  const root = nodes.find((candidate) => candidate.id === state.conversations.get(conversationId)?.rootNodeId);
  if (root) return root.id;

  nodes.sort((a, b) => b.updatedAt - a.updatedAt);
  return nodes[0].id;
}

function isDefaultGeneratedTitle(title: string) {
  return /^Chat\s\d+$/i.test(title.trim());
}

function sanitizeTitleText(raw: string) {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return '';

  return firstLine
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^title\s*:\s*/i, '')
    .replace(/^chat\s*title\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFallbackTitle(visibleMessages: ChatMessage[]) {
  const source =
    visibleMessages.find((message) => message.role === 'user' && message.content.trim())
      ?.content ||
    visibleMessages.find((message) => message.content.trim())?.content ||
    '';

  const cleaned = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'New chat';
  const words = cleaned.split(' ').filter(Boolean).slice(0, 8);
  return words.join(' ');
}

async function generateConversationTitle(params: {
  client: ReturnType<typeof getOpenRouterClient>;
  model: string;
  visibleMessages: ChatMessage[];
  reasoningParam: 'reasoning_effort' | 'reasoning' | null;
}) {
  const { client, model, visibleMessages, reasoningParam } = params;
  const sample = visibleMessages.slice(0, 8).map((message) => {
    const role = message.role === 'assistant' ? 'Assistant' : 'User';
    return `${role}: ${message.content}`;
  });

  const prompt: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Generate a short, descriptive chat title (max 6 words). Return only the title, no quotes.',
    },
    {
      role: 'user',
      content: `Conversation:\n${sample.join('\n')}`,
    },
  ];

  let rawTitle = '';
  const baseRequest = {
    model,
    messages: prompt,
    temperature: 0.2,
    max_tokens: 144,
  } as const;

  const attempts: Array<Parameters<typeof client.chatCompletion>[0]> = [];
  if (reasoningParam === 'reasoning_effort') {
    attempts.push({ ...baseRequest, reasoning_effort: 'none' });
    attempts.push({ ...baseRequest, reasoning_effort: 'minimal' });
  } else if (reasoningParam === 'reasoning') {
    attempts.push({ ...baseRequest, reasoning: { effort: 'none' } });
    attempts.push({ ...baseRequest, reasoning: { effort: 'minimal' } });
  }
  attempts.push(baseRequest);

  for (const request of attempts) {
    try {
      rawTitle = await client.chatCompletion(request);
      if (rawTitle.trim()) break;
    } catch {
      // Retry with next attempt, then fallback to local title extraction.
    }
  }

  const normalized = sanitizeTitleText(rawTitle);
  if (normalized) return normalized.slice(0, 80);

  return buildFallbackTitle(visibleMessages).slice(0, 80);
}

async function maybeAutoTitleConversation(params: {
  nodeId: NodeId;
  client: ReturnType<typeof getOpenRouterClient>;
  fallbackModel: string;
}) {
  const { nodeId, client, fallbackModel } = params;
  const state = useStore.getState();

  if (!state.autoTitleEnabled) return;
  const node = state.nodes.get(nodeId);
  if (!node || node.isReply) return;

  const conversation = state.conversations.get(node.conversationId);
  if (!conversation) return;

  if (conversation.autoTitleApplied) return;
  if (!isDefaultGeneratedTitle(conversation.title)) return;
  if (autoTitleInFlight.has(conversation.id)) return;

  const sourceNodeId = getConversationTitleSourceNodeId(state, conversation.id);
  if (!sourceNodeId) return;

  const context = state.getComputedContext(sourceNodeId);
  const visibleMessages = context.messages.filter((m) => m.role !== 'system');
  if (visibleMessages.length === 0) return;

  const titleModel = state.autoTitleModel || fallbackModel;
  const titleModelInfo = state.models.find((model) => model.id === titleModel) || null;
  const titleReasoningParam = getReasoningParameter(titleModelInfo);

  autoTitleInFlight.add(conversation.id);
  try {
    const nextTitle = await generateConversationTitle({
      client,
      model: titleModel,
      visibleMessages,
      reasoningParam: titleReasoningParam,
    });
    if (!nextTitle) return;

    state.updateConversation(conversation.id, {
      title: nextTitle,
      autoTitleApplied: true,
    });
    void state.persistConversation(conversation.id);
  } catch {
    // Ignore auto-title errors
  } finally {
    autoTitleInFlight.delete(conversation.id);
  }
}

export async function regenerateConversationTitle(conversationId: ConversationId) {
  const state = useStore.getState();
  const conversation = state.conversations.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found.');
  }
  if (!state.apiKey) {
    throw new Error('API key not set.');
  }
  if (autoTitleInFlight.has(conversationId)) {
    throw new Error('Title generation is already in progress.');
  }

  const sourceNodeId =
    getConversationTitleSourceNodeId(state, conversationId) || conversation.rootNodeId;
  const sourceNode = state.nodes.get(sourceNodeId);
  const fallbackModel = sourceNode?.model || conversation.model || state.selectedModel;
  const client = getOpenRouterClient(state.apiKey, state.apiBaseUrl);

  autoTitleInFlight.add(conversation.id);
  try {
    const context = state.getComputedContext(sourceNodeId);
    const visibleMessages = context.messages.filter((m) => m.role !== 'system');
    if (visibleMessages.length === 0) {
      throw new Error('No messages available to generate title.');
    }

    const titleModel = state.autoTitleModel || fallbackModel;
    const titleModelInfo = state.models.find((model) => model.id === titleModel) || null;
    const titleReasoningParam = getReasoningParameter(titleModelInfo);
    const nextTitle = await generateConversationTitle({
      client,
      model: titleModel,
      visibleMessages,
      reasoningParam: titleReasoningParam,
    });
    if (!nextTitle) throw new Error('Could not generate title.');

    state.updateConversation(conversation.id, {
      title: nextTitle,
      autoTitleApplied: true,
    });
    await state.persistConversation(conversation.id);
    return nextTitle;
  } finally {
    autoTitleInFlight.delete(conversation.id);
  }
}

function splitSystemMessages(messages: ChatMessage[]): [ChatMessage[], ChatMessage[]] {
  if (messages.length === 0) return [[], []];
  let index = 0;
  while (index < messages.length && messages[index].role === 'system') {
    index += 1;
  }
  return [messages.slice(0, index), messages.slice(index)];
}

function trimToTokenLimit(messages: ChatMessage[], maxInputTokens: number) {
  if (messages.length === 0) return messages;

  let trimmed = [...messages];
  while (trimmed.length > 1 && estimateTokens(trimmed) > maxInputTokens) {
    const [systemMessages, rest] = splitSystemMessages(trimmed);
    if (systemMessages.length > 0) {
      trimmed = [...systemMessages, ...rest.slice(1)];
    } else {
      trimmed = rest;
    }
  }
  return trimmed;
}

function estimateTokens(messages: ChatMessage[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 4);
}

async function summarizeMessages(
  messages: ChatMessage[],
  model: string,
  client: ReturnType<typeof getOpenRouterClient>
) {
  const summaryPrompt: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Summarize the conversation so far. Preserve key facts, decisions, names, and open questions. Use concise bullet points.',
    },
    ...messages,
  ];

  const summary = await client.chatCompletion({
    model,
    messages: summaryPrompt,
    temperature: 0.2,
    max_tokens: 512,
  });

  return summary.trim();
}

async function buildAttachmentContext(
  attachments: PendingAttachment[],
  userContent: string,
  settings: Required<AttachmentProcessingSettings>,
  embeddingModel: string,
  scopeType: RagScopeType,
  scopeId: string,
  model: string,
  client: ReturnType<typeof getOpenRouterClient>,
  state: ReturnType<typeof useStore.getState>,
  signal: AbortSignal
) {
  if (settings.mode === 'summarize') {
    return buildAttachmentSummaryContext(
      attachments,
      settings,
      model,
      client,
      state,
      signal
    );
  }
  return buildAttachmentRetrievalContext(
    attachments,
    userContent,
    settings,
    embeddingModel,
    scopeType,
    scopeId,
    client,
    state,
    signal
  );
}

async function buildAttachmentRetrievalContext(
  attachments: PendingAttachment[],
  userContent: string,
  settings: Required<AttachmentProcessingSettings>,
  embeddingModel: string,
  scopeType: RagScopeType,
  scopeId: string,
  client: ReturnType<typeof getOpenRouterClient>,
  state: ReturnType<typeof useStore.getState>,
  signal: AbortSignal
) {
  const queryTerms = tokenizeRetrievalText(userContent);
  const blocks: string[] = [];
  const indexedSources: string[] = [];

  for (const attachment of attachments) {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const file = await resolveAttachmentFile(attachment, state);
    if (!file) {
      blocks.push(
        `${attachment.name} (${formatFileSize(attachment.size)}): access denied. Please reattach.`
      );
      continue;
    }

    if (!isTextLikeFile(file)) {
      blocks.push(
        `${attachment.name} (${formatFileSize(attachment.size)}): binary file skipped.`
      );
      continue;
    }

    const sourceKey = buildRagSourceKey(
      attachment,
      file,
      settings.chunkSize,
      settings.chunkOverlap
    );
    indexedSources.push(sourceKey);

    const existing = await loadRagChunksForSource(scopeType, scopeId, sourceKey);
    const canReuse =
      existing.length > 0 &&
      existing.every((chunk) =>
        chunk.embeddingModel ? chunk.embeddingModel === embeddingModel : true
      );
    if (canReuse) {
      continue;
    }

    await deleteRagChunksForSource(scopeType, scopeId, sourceKey);
    const created = await indexAttachmentChunks({
      scopeType,
      scopeId,
      sourceKey,
      attachment,
      file,
      settings,
      embeddingModel,
      client,
      signal,
    });
    await saveRagChunks(created);
    if (created.length >= RETRIEVAL_MAX_CHUNKS_PER_FILE) {
      blocks.push(
        `${attachment.name} (${formatFileSize(file.size)}): retrieval indexed first ${RETRIEVAL_MAX_CHUNKS_PER_FILE} chunks.`
      );
    }
  }

  const allScopeChunks = await loadRagChunksForScope(scopeType, scopeId);
  const activeSourceSet = new Set(indexedSources);
  const activeChunks =
    indexedSources.length === 0
      ? allScopeChunks
      : allScopeChunks.filter((chunk) => activeSourceSet.has(chunk.sourceKey));
  if (activeChunks.length === 0) {
    if (blocks.length > 0) {
      return `Attachment context (retrieved):\n\n${blocks.join('\n\n')}`;
    }
    return 'No attachment content available.';
  }

  let queryEmbedding: number[] | null = null;
  if (userContent.trim()) {
    queryEmbedding = await safeEmbedQuery(userContent, embeddingModel, client, signal);
  }

  const matchingEmbeddingChunkCount = activeChunks.filter(
    (chunk) =>
      chunk.embeddingModel === embeddingModel &&
      Array.isArray(chunk.embedding) &&
      chunk.embedding.length > 0
  ).length;
  const hasStaleEmbeddingChunks = activeChunks.some(
    (chunk) =>
      chunk.embeddingModel !== embeddingModel &&
      Array.isArray(chunk.embedding) &&
      chunk.embedding.length > 0
  );

  const candidates: RetrievalChunkCandidate[] = activeChunks.map((chunk, order) => {
    const lexical =
      queryTerms.length > 0 ? computeLexicalChunkScore(chunk.chunkText, queryTerms) : 0;
    const semantic =
      queryEmbedding &&
      chunk.embeddingModel === embeddingModel &&
      chunk.embedding?.length
        ? cosineSimilarity(queryEmbedding, chunk.embedding)
        : 0;
    const score =
      lexical + semantic * 4 + (queryTerms.length === 0 && !queryEmbedding ? -order * 0.001 : 0);

    return {
      attachmentName: chunk.attachmentName,
      attachmentSize: 0,
      chunkIndex: chunk.chunkIndex,
      chunkText: chunk.chunkText,
      score,
      order,
    };
  });

  const topChunks = pickTopRetrievalChunks(candidates, settings.retrievalTopK);
  if (topChunks.length === 0) {
    return 'No attachment content available.';
  }

  const retrievalBlocks = topChunks.map((candidate) => {
    const maxLength = Math.max(200, settings.chunkSize);
    const preview =
      candidate.chunkText.length > maxLength
        ? `${candidate.chunkText.slice(0, maxLength)}...`
        : candidate.chunkText;
    const scoreText = Number.isFinite(candidate.score)
      ? `hybrid=${candidate.score.toFixed(3)}`
      : 'hybrid=n/a';
    return `[${candidate.attachmentName} · chunk ${candidate.chunkIndex + 1} · ${scoreText}]\n${preview}`;
  });

  const queryText = userContent.trim() || '(empty user prompt)';
  const details = [
    `Mode: retrieval (hybrid lexical + embedding)`,
    `Query: ${queryText}`,
    `Top K: ${settings.retrievalTopK}`,
    `Embedding model: ${embeddingModel}`,
    `Semantic index: ${
      matchingEmbeddingChunkCount > 0
        ? hasStaleEmbeddingChunks
          ? 'stale (partial mismatch, reindex recommended)'
          : 'ready'
        : 'unavailable (lexical-only until reindex)'
    }`,
  ];

  if (blocks.length === 0) {
    return `Attachment context (retrieved):\n${details.join('\n')}\n\n${retrievalBlocks.join('\n\n')}`;
  }

  return `Attachment context (retrieved):\n${details.join('\n')}\n\n${[
    ...blocks,
    ...retrievalBlocks,
  ].join('\n\n')}`;
}

async function buildAttachmentSummaryContext(
  attachments: PendingAttachment[],
  settings: Required<AttachmentProcessingSettings>,
  model: string,
  client: ReturnType<typeof getOpenRouterClient>,
  state: ReturnType<typeof useStore.getState>,
  signal: AbortSignal
) {
  const blocks: string[] = [];

  for (const attachment of attachments) {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const file = await resolveAttachmentFile(attachment, state);
    if (!file) {
      blocks.push(
        `${attachment.name} (${formatFileSize(attachment.size)}): access denied. Please reattach.`
      );
      continue;
    }

    if (!isTextLikeFile(file)) {
      blocks.push(
        `${attachment.name} (${formatFileSize(file.size)}): binary file skipped.`
      );
      continue;
    }

    const { summary, truncated } = await summarizeFileHierarchical(
      file,
      settings,
      model,
      client,
      signal
    );
    const suffix = truncated ? '\n\n[Truncated after initial chunks]' : '';
    blocks.push(
      `${attachment.name} (${formatFileSize(file.size)}):\n${
        summary || 'No extractable text found.'
      }${suffix}`
    );
  }

  if (blocks.length === 0) {
    return 'No attachment content available.';
  }

  return `Attachment context (summary):\nMode: summarize\n\n${blocks.join('\n\n')}`;
}

async function resolveAttachmentFile(
  attachment: PendingAttachment,
  state: ReturnType<typeof useStore.getState>
) {
  if (attachment.file) return attachment.file;
  if (!attachment.handleId) return null;
  const handle = state.getFileHandle(attachment.handleId);
  if (!handle) return null;
  try {
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function summarizeFileHierarchical(
  file: File,
  settings: Required<AttachmentProcessingSettings>,
  model: string,
  client: ReturnType<typeof getOpenRouterClient>,
  signal: AbortSignal
) {
  const chunkSummaries: string[] = [];
  let chunkCount = 0;
  let truncated = false;
  let firstChunkPreview = '';

  for await (const chunk of streamFileOverlappingChunks(
    file,
    settings.chunkSize,
    settings.chunkOverlap,
    signal
  )) {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    if (!firstChunkPreview) {
      firstChunkPreview = chunk;
    }
    if (!chunk.trim()) continue;

    chunkCount += 1;
    const nextChunkSummary = await summarizeTextChunk(chunk, model, client, signal);
    if (nextChunkSummary) {
      chunkSummaries.push(nextChunkSummary);
    }

    if (chunkCount >= FILE_SUMMARY_MAX_CHUNKS) {
      truncated = true;
      break;
    }
  }

  let summary = await reduceSummaries(chunkSummaries, model, client, signal);
  if (!summary && firstChunkPreview.trim()) {
    summary = buildExtractiveFallbackSummary(firstChunkPreview);
  }

  return { summary: summary.trim(), truncated };
}

async function summarizeTextChunk(
  chunk: string,
  model: string,
  client: ReturnType<typeof getOpenRouterClient>,
  signal: AbortSignal
) {
  const prompt: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Summarize this chunk. Keep critical facts, entities, numbers, and decisions. Use concise bullet points.',
    },
    {
      role: 'user',
      content: chunk,
    },
  ];

  const result = await client.chatCompletion(
    {
      model,
      messages: prompt,
      temperature: 0.2,
      max_tokens: 384,
    },
    signal
  );
  return result.trim();
}

async function reduceSummaries(
  summaries: string[],
  model: string,
  client: ReturnType<typeof getOpenRouterClient>,
  signal: AbortSignal
) {
  if (summaries.length === 0) return '';
  let current = summaries.filter(Boolean);
  const groupSize = 6;

  while (current.length > 1) {
    const next: string[] = [];

    for (let i = 0; i < current.length; i += groupSize) {
      const group = current.slice(i, i + groupSize);
      const prompt: ChatMessage[] = [
        {
          role: 'system',
          content:
            'Merge the summaries into one compact summary. Preserve important details and unresolved questions. Use concise bullet points.',
        },
        {
          role: 'user',
          content: group.map((entry, idx) => `Summary ${idx + 1}:\n${entry}`).join('\n\n'),
        },
      ];

      const merged = await client.chatCompletion(
        {
          model,
          messages: prompt,
          temperature: 0.2,
          max_tokens: 512,
        },
        signal
      );
      const normalized = merged.trim();
      if (normalized) {
        next.push(normalized);
      }
    }

    if (next.length === 0) return '';
    current = next;
  }

  return current[0] || '';
}

function buildRagSourceKey(
  attachment: PendingAttachment,
  file: File,
  chunkSize: number,
  chunkOverlap: number
) {
  const stableAttachmentId = attachment.handleId || attachment.id;
  return [
    stableAttachmentId,
    attachment.name,
    file.size,
    file.lastModified,
    chunkSize,
    chunkOverlap,
  ].join(':');
}

async function indexAttachmentChunks(params: {
  scopeType: RagScopeType;
  scopeId: string;
  sourceKey: string;
  attachment: PendingAttachment;
  file: File;
  settings: Required<AttachmentProcessingSettings>;
  embeddingModel: string;
  client: ReturnType<typeof getOpenRouterClient>;
  signal: AbortSignal;
}) {
  const {
    scopeType,
    scopeId,
    sourceKey,
    attachment,
    file,
    settings,
    embeddingModel,
    client,
    signal,
  } = params;

  const chunks: Array<{
    id: string;
    chunkIndex: number;
    chunkText: string;
    chunkTokenEstimate: number;
  }> = [];

  let chunkIndex = 0;
  for await (const chunk of streamFileOverlappingChunks(
    file,
    settings.chunkSize,
    settings.chunkOverlap,
    signal
  )) {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    if (chunks.length >= RETRIEVAL_MAX_CHUNKS_PER_FILE) {
      break;
    }

    const chunkText = chunk.trim();
    if (!chunkText) {
      chunkIndex += 1;
      continue;
    }

    chunks.push({
      id: `${sourceKey}:${chunkIndex}`,
      chunkIndex,
      chunkText,
      chunkTokenEstimate: Math.ceil(chunkText.length / 4),
    });
    chunkIndex += 1;
  }

  const embeddingsByChunkId = new Map<string, number[]>();
  if (chunks.length > 0) {
    const batchSize = 32;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      try {
        const embedded = await client.embeddings(
          {
            model: embeddingModel,
            input: batch.map((chunk) => chunk.chunkText),
          },
          signal
        );
        for (let j = 0; j < batch.length; j++) {
          const vector = embedded[j];
          if (vector && vector.length > 0) {
            embeddingsByChunkId.set(batch[j].id, vector);
          }
        }
      } catch {
        // Keep lexical retrieval when embeddings are unavailable.
      }
    }
  }

  const now = Date.now();
  const rows: RagChunk[] = chunks.map((chunk) => ({
    id: chunk.id,
    scopeType,
    scopeId,
    sourceKey,
    attachmentId: attachment.id,
    attachmentName: attachment.name,
    chunkIndex: chunk.chunkIndex,
    chunkText: chunk.chunkText,
    chunkTokenEstimate: chunk.chunkTokenEstimate,
    embedding: embeddingsByChunkId.get(chunk.id),
    embeddingModel,
    createdAt: now,
    updatedAt: now,
  }));
  return rows;
}

async function safeEmbedQuery(
  query: string,
  embeddingModel: string,
  client: ReturnType<typeof getOpenRouterClient>,
  signal: AbortSignal
) {
  try {
    const vectors = await client.embeddings(
      {
        model: embeddingModel,
        input: query,
      },
      signal
    );
    return vectors[0] || null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function* streamFileOverlappingChunks(
  file: File,
  chunkSize: number,
  chunkOverlap: number,
  signal: AbortSignal
) {
  const readBlockSize = Math.max(4096, chunkSize * 2);
  const safeChunkSize = Math.max(1, chunkSize);
  const safeOverlap = Math.max(0, Math.min(safeChunkSize - 1, chunkOverlap));
  const step = Math.max(1, safeChunkSize - safeOverlap);
  let buffer = '';

  for await (const chunk of streamFileTextChunks(file, readBlockSize, signal)) {
    buffer += chunk;
    while (buffer.length >= safeChunkSize) {
      const out = buffer.slice(0, safeChunkSize);
      yield out;
      buffer = buffer.slice(step);
    }
  }

  if (buffer.length > 0) {
    yield buffer;
  }
}
