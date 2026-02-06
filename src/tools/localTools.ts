import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import { loadRagChunksForScope, searchMessages } from '../db';
import type { AttachmentSource, RagScopeType } from '../types';
import { executeDaytonaCommand, type DaytonaLanguage } from './daytona';
import {
  computeLexicalChunkScore,
  pickTopRetrievalChunks,
  tokenizeRetrievalText,
  type RetrievalChunkCandidate,
} from '../utils/attachments';
import { formatFileSize, isTextLikeFile, streamFileTextChunks } from '../utils/files';

interface ToolAttachmentEntry {
  attachmentId: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  source: AttachmentSource;
  handleId?: string;
  scope: 'conversation' | 'project';
}

interface LocalToolsOptions {
  enabled: boolean;
  enableDatetimeNow: boolean;
  enableCalculator: boolean;
  enableSearchMessages: boolean;
  enableSearchContextChunks: boolean;
  maxExpressionLength: number;
  maxMessageResults: number;
  maxContextChunkResults: number;
  enableAttachmentReader: boolean;
  attachmentReaderMaxCharsPerRead: number;
  attachments: ToolAttachmentEntry[];
  resolveAttachmentFile: (handleId: string) => Promise<File | null>;
  enableDaytona: boolean;
  daytonaConfig: {
    apiKey: string;
    apiUrl?: string;
    target?: string;
    sandboxId?: string;
    defaultLanguage: DaytonaLanguage;
    autoCreateSandbox: boolean;
    autoDeleteCreatedSandbox: boolean;
    defaultTimeoutSeconds: number;
    maxStdoutChars: number;
    maxStderrChars: number;
  };
  conversationId: string;
  projectId?: string;
  confirmToolCall?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}

interface IndexedAttachmentWindow {
  content: string;
  returnedChars: number;
  hasMore: boolean;
  sourceKey: string;
  chunkCount: number;
}

function buildSnippet(text: string, maxLength = 280) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function safeEvaluateExpression(expression: string): number {
  const normalized = expression.replace(/%/g, '/100').trim();
  if (!normalized) {
    throw new Error('Expression is empty.');
  }
  if (!/^[0-9+\-*/().,\s]+$/.test(normalized)) {
    throw new Error('Expression contains unsupported characters.');
  }
  const result = Function(`"use strict"; return (${normalized});`)();
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('Expression did not produce a finite number.');
  }
  return result;
}

async function readTextWindow(
  file: File,
  offsetChars: number,
  maxChars: number
): Promise<{ content: string; returnedChars: number; hasMore: boolean }> {
  const safeOffset = Math.max(0, Math.floor(offsetChars));
  const safeMaxChars = Math.max(1, Math.floor(maxChars));
  const chunkSize = Math.max(4096, Math.min(32768, safeMaxChars * 2));

  let content = '';
  let cursor = 0;
  let exhausted = true;
  for await (const chunk of streamFileTextChunks(file, chunkSize)) {
    const chunkLength = chunk.length;
    if (cursor + chunkLength <= safeOffset) {
      cursor += chunkLength;
      continue;
    }
    const start = Math.max(0, safeOffset - cursor);
    const remaining = safeMaxChars - content.length;
    if (remaining <= 0) {
      exhausted = false;
      break;
    }
    content += chunk.slice(start, start + remaining);
    cursor += chunkLength;
    if (content.length >= safeMaxChars) {
      exhausted = false;
      break;
    }
  }

  return {
    content,
    returnedChars: content.length,
    hasMore: !exhausted,
  };
}

async function searchRagChunks(params: {
  query: string;
  maxResults: number;
  scopes: Array<{ scopeType: RagScopeType; scopeId: string; label: string }>;
}) {
  const { query, maxResults, scopes } = params;
  const terms = tokenizeRetrievalText(query);

  const allCandidates: RetrievalChunkCandidate[] = [];
  for (const scope of scopes) {
    const rows = await loadRagChunksForScope(scope.scopeType, scope.scopeId);
    for (const row of rows) {
      const lexical = terms.length > 0 ? computeLexicalChunkScore(row.chunkText, terms) : 0;
      if (terms.length > 0 && lexical <= 0) continue;
      allCandidates.push({
        attachmentName: `${row.attachmentName} (${scope.label})`,
        attachmentSize: 0,
        chunkIndex: row.chunkIndex,
        chunkText: row.chunkText,
        score: lexical,
        order: row.updatedAt,
      });
    }
  }

  const top = pickTopRetrievalChunks(
    allCandidates,
    Math.max(1, Math.min(maxResults, 30))
  );

  return top.map((chunk) => ({
    attachment: chunk.attachmentName,
    chunkIndex: chunk.chunkIndex,
    lexicalScore: Number(chunk.score.toFixed(4)),
    snippet: buildSnippet(chunk.chunkText),
  }));
}

async function readIndexedAttachmentWindow(params: {
  entry: ToolAttachmentEntry;
  offsetChars: number;
  maxChars: number;
  conversationId: string;
  projectId?: string;
}): Promise<IndexedAttachmentWindow | null> {
  const { entry, offsetChars, maxChars, conversationId, projectId } = params;
  const scopeLookups: Array<{ scopeType: RagScopeType; scopeId: string }> = [];
  if (entry.scope === 'conversation') {
    scopeLookups.push({ scopeType: 'conversation', scopeId: conversationId });
  } else if (entry.scope === 'project' && projectId) {
    scopeLookups.push({ scopeType: 'project', scopeId: projectId });
  }

  for (const scope of scopeLookups) {
    const rows = await loadRagChunksForScope(scope.scopeType, scope.scopeId);
    const byAttachmentId = rows.filter((row) => row.attachmentId === entry.attachmentId);
    const candidates =
      byAttachmentId.length > 0
        ? byAttachmentId
        : rows.filter((row) => row.attachmentName === entry.name);
    if (candidates.length === 0) continue;

    const groupedBySource = new Map<string, { latestUpdatedAt: number; rows: typeof candidates }>();
    for (const row of candidates) {
      const existing = groupedBySource.get(row.sourceKey);
      if (!existing) {
        groupedBySource.set(row.sourceKey, { latestUpdatedAt: row.updatedAt, rows: [row] });
        continue;
      }
      existing.rows.push(row);
      if (row.updatedAt > existing.latestUpdatedAt) {
        existing.latestUpdatedAt = row.updatedAt;
      }
    }

    const latestSource = Array.from(groupedBySource.entries()).sort((left, right) => {
      if (left[1].latestUpdatedAt !== right[1].latestUpdatedAt) {
        return right[1].latestUpdatedAt - left[1].latestUpdatedAt;
      }
      return right[0].localeCompare(left[0]);
    })[0];

    if (!latestSource) continue;

    const [sourceKey, sourceGroup] = latestSource;
    const ordered = [...sourceGroup.rows].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const fullText = ordered.map((row) => row.chunkText).join('\n\n');
    if (!fullText) continue;

    const safeOffset = Math.max(0, Math.floor(offsetChars));
    const safeMaxChars = Math.max(1, Math.floor(maxChars));
    const content = fullText.slice(safeOffset, safeOffset + safeMaxChars);

    return {
      content,
      returnedChars: content.length,
      hasMore: safeOffset + content.length < fullText.length,
      sourceKey,
      chunkCount: ordered.length,
    };
  }

  return null;
}

export function createLocalTools(options: LocalToolsOptions) {
  if (!options.enabled) return {};

  const tools: ToolSet = {};

  if (options.enableDatetimeNow) {
    tools.datetime_now = tool({
      description: 'Returns current date and time. Optional timezone.',
      inputSchema: z.object({
        timezone: z.string().optional().describe('IANA timezone, e.g. Europe/Berlin'),
      }),
      execute: async ({ timezone }) => {
        if (options.confirmToolCall) {
          const allowed = await options.confirmToolCall('datetime_now', {
            timezone: timezone ?? null,
          });
          if (!allowed) {
            return { denied: true, message: 'Execution denied for datetime_now.' };
          }
        }
        const now = new Date();
        const safeTimezone = timezone?.trim();
        const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
        const formatter = new Intl.DateTimeFormat(locale, {
          dateStyle: 'full',
          timeStyle: 'long',
          timeZone: safeTimezone || undefined,
        });
        return {
          iso: now.toISOString(),
          timezone:
            safeTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
          formatted: formatter.format(now),
        };
      },
    });
  }

  if (options.enableCalculator) {
    tools.calculator = tool({
      description:
        'Evaluates arithmetic expressions. Supported: numbers, parentheses, + - * / . and %.',
      inputSchema: z.object({
        expression: z.string().min(1).describe('Arithmetic expression, e.g. (2+3)*4'),
      }),
      execute: async ({ expression }) => {
        if (options.confirmToolCall) {
          const allowed = await options.confirmToolCall('calculator', { expression });
          if (!allowed) {
            return { denied: true, message: 'Execution denied for calculator.' };
          }
        }
        if (expression.length > options.maxExpressionLength) {
          throw new Error(
            `Expression exceeds max length ${options.maxExpressionLength}.`
          );
        }
        const value = safeEvaluateExpression(expression);
        return { expression, value };
      },
    });
  }

  if (options.enableSearchMessages) {
    tools.search_messages = tool({
      description: 'Search messages across all chats and projects by text query.',
      inputSchema: z.object({
        query: z.string().min(2).describe('Search query text'),
        maxResults: z.number().int().min(1).max(30).optional(),
      }),
      execute: async ({ query, maxResults }) => {
        if (options.confirmToolCall) {
          const allowed = await options.confirmToolCall('search_messages', {
            query,
            maxResults: maxResults ?? null,
          });
          if (!allowed) {
            return { denied: true, message: 'Execution denied for search_messages.' };
          }
        }
        const limit = Math.max(
          1,
          Math.min(maxResults ?? options.maxMessageResults, options.maxMessageResults)
        );
        const results = await searchMessages(query, limit);
        return {
          query,
          count: results.length,
          results: results.map((result) => ({
            conversationTitle: result.conversationTitle,
            projectName: result.projectName,
            role: result.role,
            createdAt: result.createdAt,
            snippet: buildSnippet(result.content),
          })),
        };
      },
    });
  }

  if (options.enableSearchContextChunks) {
    tools.search_context_chunks = tool({
      description:
        'Search indexed RAG chunks for active conversation/project using lexical retrieval.',
      inputSchema: z.object({
        query: z.string().min(2).describe('Query text for chunk search'),
        scope: z.enum(['auto', 'conversation', 'project']).optional(),
        maxResults: z.number().int().min(1).max(30).optional(),
      }),
      execute: async ({ query, scope, maxResults }) => {
        if (options.confirmToolCall) {
          const allowed = await options.confirmToolCall('search_context_chunks', {
            query,
            scope: scope ?? 'auto',
            maxResults: maxResults ?? null,
          });
          if (!allowed) {
            return {
              denied: true,
              message: 'Execution denied for search_context_chunks.',
            };
          }
        }
        const selectedScope = scope ?? 'auto';
        const scopes: Array<{ scopeType: RagScopeType; scopeId: string; label: string }> = [];

        if (selectedScope === 'conversation' || selectedScope === 'auto') {
          scopes.push({
            scopeType: 'conversation',
            scopeId: options.conversationId,
            label: 'conversation',
          });
        }
        if ((selectedScope === 'project' || selectedScope === 'auto') && options.projectId) {
          scopes.push({
            scopeType: 'project',
            scopeId: options.projectId,
            label: 'project',
          });
        }
        if (scopes.length === 0) {
          return { query, count: 0, results: [] };
        }

        const limit = Math.max(
          1,
          Math.min(maxResults ?? options.maxContextChunkResults, options.maxContextChunkResults)
        );
        const results = await searchRagChunks({ query, maxResults: limit, scopes });
        return { query, count: results.length, results };
      },
    });
  }

  if (options.enableAttachmentReader) {
    tools.list_attached_files = tool({
      description: 'List files attached to this conversation and project.',
      inputSchema: z.object({
        scope: z.enum(['auto', 'conversation', 'project']).optional(),
      }),
      execute: async ({ scope }) => {
        if (options.confirmToolCall) {
          const allowed = await options.confirmToolCall('list_attached_files', {
            scope: scope ?? 'auto',
          });
          if (!allowed) {
            return { denied: true, message: 'Execution denied for list_attached_files.' };
          }
        }

        const selectedScope = scope ?? 'auto';
        const entries = options.attachments
          .filter((entry) => {
            if (selectedScope === 'auto') return true;
            return entry.scope === selectedScope;
          })
          .sort((a, b) => b.lastModified - a.lastModified);

        const seen = new Set<string>();
        const unique = entries.filter((entry) => {
          const key = entry.handleId || `${entry.scope}:${entry.attachmentId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        return {
          scope: selectedScope,
          count: unique.length,
          files: unique.map((entry) => ({
            attachmentId: entry.attachmentId,
            name: entry.name,
            scope: entry.scope,
            size: entry.size,
            formattedSize: formatFileSize(entry.size),
            type: entry.type || 'unknown',
            source: entry.source,
            readable: Boolean(entry.handleId && entry.source === 'handle'),
            lastModified: entry.lastModified,
          })),
        };
      },
    });

    tools.read_attached_file = tool({
      description:
        'Read text content from an attached conversation/project file by attachmentId or fileName.',
      inputSchema: z.object({
        attachmentId: z.string().optional(),
        fileName: z.string().optional(),
        scope: z.enum(['auto', 'conversation', 'project']).optional(),
        offsetChars: z.number().int().min(0).optional(),
        maxChars: z.number().int().min(1).max(50000).optional(),
      }),
      execute: async ({ attachmentId, fileName, scope, offsetChars, maxChars }) => {
        if (options.confirmToolCall) {
          const allowed = await options.confirmToolCall('read_attached_file', {
            attachmentId: attachmentId ?? null,
            fileName: fileName ?? null,
            scope: scope ?? 'auto',
            offsetChars: offsetChars ?? null,
            maxChars: maxChars ?? null,
          });
          if (!allowed) {
            return { denied: true, message: 'Execution denied for read_attached_file.' };
          }
        }

        const normalizedId = attachmentId?.trim();
        const normalizedName = fileName?.trim();
        if (!normalizedId && !normalizedName) {
          return {
            error:
              'Provide attachmentId or fileName. Use list_attached_files first to inspect available files.',
          };
        }

        const selectedScope = scope ?? 'auto';
        const candidates = options.attachments.filter((entry) => {
          if (selectedScope !== 'auto' && entry.scope !== selectedScope) return false;
          if (normalizedId) return entry.attachmentId === normalizedId;
          return entry.name.toLowerCase() === normalizedName!.toLowerCase();
        });

        if (candidates.length === 0) {
          return {
            error: 'No matching attached file found.',
            scope: selectedScope,
          };
        }

        if (!normalizedId && candidates.length > 1) {
          return {
            error:
              'Multiple files matched by name. Please pass attachmentId from list_attached_files.',
            matches: candidates.map((entry) => ({
              attachmentId: entry.attachmentId,
              name: entry.name,
              scope: entry.scope,
            })),
          };
        }

        const entry = candidates[0];
        const safeOffset = Math.max(0, offsetChars ?? 0);
        const safeMaxChars = Math.max(
          1,
          Math.min(maxChars ?? options.attachmentReaderMaxCharsPerRead, options.attachmentReaderMaxCharsPerRead)
        );

        if (entry.source === 'handle' && entry.handleId) {
          const file = await options.resolveAttachmentFile(entry.handleId);
          if (file) {
            if (!isTextLikeFile(file)) {
              return {
                error: 'Binary files are not supported by read_attached_file.',
                attachmentId: entry.attachmentId,
                name: entry.name,
                scope: entry.scope,
                size: file.size,
                formattedSize: formatFileSize(file.size),
                type: file.type || 'unknown',
              };
            }

            const window = await readTextWindow(file, safeOffset, safeMaxChars);
            return {
              attachmentId: entry.attachmentId,
              name: entry.name,
              scope: entry.scope,
              size: file.size,
              formattedSize: formatFileSize(file.size),
              type: file.type || 'unknown',
              source: 'file-handle',
              offsetChars: safeOffset,
              requestedMaxChars: safeMaxChars,
              returnedChars: window.returnedChars,
              hasMore: window.hasMore,
              content: window.content,
            };
          }
        }

        const indexedWindow = await readIndexedAttachmentWindow({
          entry,
          offsetChars: safeOffset,
          maxChars: safeMaxChars,
          conversationId: options.conversationId,
          projectId: options.projectId,
        });
        if (indexedWindow) {
          return {
            attachmentId: entry.attachmentId,
            name: entry.name,
            scope: entry.scope,
            size: entry.size,
            formattedSize: formatFileSize(entry.size),
            type: entry.type || 'unknown',
            source: 'indexed-rag',
            offsetChars: safeOffset,
            requestedMaxChars: safeMaxChars,
            returnedChars: indexedWindow.returnedChars,
            hasMore: indexedWindow.hasMore,
            content: indexedWindow.content,
            indexedChunkCount: indexedWindow.chunkCount,
            indexedSourceKey: indexedWindow.sourceKey,
          };
        }

        return {
          error: 'Attachment is not readable. Re-attach file or index it via attachment processing.',
          attachmentId: entry.attachmentId,
          name: entry.name,
          scope: entry.scope,
          source: entry.source,
        };
      },
    });
  }

  if (options.enableDaytona) {
    tools.daytona_exec = tool({
      description:
        'Execute shell commands in Daytona sandbox (remote isolated runtime).',
      inputSchema: z.object({
        command: z.string().min(1).describe('Shell command to run'),
        cwd: z.string().optional().describe('Working directory inside sandbox'),
        timeoutSeconds: z.number().int().min(1).max(600).optional(),
        sandboxId: z.string().optional().describe('Optional existing Daytona sandbox ID'),
        createSandbox: z.boolean().optional().describe('Create new sandbox if missing'),
        deleteCreatedSandbox: z
          .boolean()
          .optional()
          .describe('Auto-delete sandbox created for this run'),
        language: z
          .enum(['typescript', 'javascript', 'python', 'go', 'rust'])
          .optional(),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe('Environment variables'),
      }),
      execute: async ({
        command,
        cwd,
        timeoutSeconds,
        sandboxId,
        createSandbox,
        deleteCreatedSandbox,
        language,
        env,
      }) => {
        if (options.confirmToolCall) {
          const allowed = await options.confirmToolCall('daytona_exec', {
            command,
            cwd: cwd ?? null,
            timeoutSeconds: timeoutSeconds ?? null,
            sandboxId: sandboxId ?? null,
            createSandbox: createSandbox ?? null,
            deleteCreatedSandbox: deleteCreatedSandbox ?? null,
          });
          if (!allowed) {
            return { denied: true, message: 'Execution denied for daytona_exec.' };
          }
        }

        return executeDaytonaCommand(options.daytonaConfig, {
          command,
          cwd,
          timeoutSeconds,
          sandboxId,
          createSandbox,
          deleteCreatedSandbox,
          language,
          env,
        });
      },
    });
  }

  return tools;
}
