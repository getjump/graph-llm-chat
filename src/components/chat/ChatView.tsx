import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { useStreaming } from '../../hooks';
import { MessageList } from './MessageList';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import type { NodeId, PendingAttachment } from '../../types';
import {
  estimateAttachmentTokens,
  estimateContextExtraTokens,
  estimateTokensFromText,
} from '../../utils/tokenBudget';

export function ChatView() {
  const {
    activeNodeId,
    activeRequests,
    setActiveNode,
    setActiveInputNode,
    nodes,
    createReply,
    conversations,
    getComputedContext,
    selectedModel,
    models,
    toolSettings,
    memorySettings,
    memoryRetrievalByConversation,
    registerFileHandle,
    updateConversation,
    connectFlowNodes,
    chatDrafts,
    setChatDraft,
    clearChatDraft,
  } = useStore(
    useShallow((state) => ({
      activeNodeId: state.activeNodeId,
      activeRequests: state.activeRequests,
      setActiveNode: state.setActiveNode,
      setActiveInputNode: state.setActiveInputNode,
      nodes: state.nodes,
      createReply: state.createReply,
      conversations: state.conversations,
      getComputedContext: state.getComputedContext,
      selectedModel: state.selectedModel,
      models: state.models,
      toolSettings: state.toolSettings,
      memorySettings: state.memorySettings,
      memoryRetrievalByConversation: state.memoryRetrievalByConversation,
      registerFileHandle: state.registerFileHandle,
      updateConversation: state.updateConversation,
      connectFlowNodes: state.connectFlowNodes,
      chatDrafts: state.chatDrafts,
      setChatDraft: state.setChatDraft,
      clearChatDraft: state.clearChatDraft,
    }))
  );

  const { sendMessage, cancelRequest, retryMessage } = useStreaming();
  const chatInputRef = useRef<ChatInputHandle>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [quoteSelection, setQuoteSelection] = useState<{
    text: string;
    rect: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<PendingAttachment[]>([]);
  const draftTextRef = useRef('');
  const draftAttachmentsRef = useRef<PendingAttachment[]>([]);
  const lastSelectionRef = useRef<{
    text: string;
    rect: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const dragCounterRef = useRef(0);

  const isStreaming = activeNodeId ? activeRequests.has(activeNodeId) : false;
  const activeNode = activeNodeId ? nodes.get(activeNodeId) : null;
  // Find the node to send messages to (active node, skipping replies)
  const getLeafNodeId = useCallback((): NodeId | null => {
    if (!activeNodeId) return null;

    let current: NodeId | null = activeNodeId;
    while (current) {
      const node = nodes.get(current);
      if (!node) return null;
      if (!node.isReply) break;
      current = node.parentNodeId ?? null;
    }
    return current;
  }, [activeNodeId, nodes]);

  const leafNodeId = getLeafNodeId();
  const activeDraft = leafNodeId ? chatDrafts[leafNodeId] : undefined;
  const contextInfo = leafNodeId ? getComputedContext(leafNodeId) : null;
  const contextBaseTokens = contextInfo?.tokenEstimate ?? 0;
  const resolvedModelId = (() => {
    if (!leafNodeId) return selectedModel;
    const node = nodes.get(leafNodeId);
    if (!node) return selectedModel;
    const conversation = conversations.get(node.conversationId);
    return node.model || conversation?.model || selectedModel;
  })();
  const resolvedModelInfo = useMemo(
    () => models.find((model) => model.id === resolvedModelId) || null,
    [models, resolvedModelId]
  );
  const contextLimit = resolvedModelInfo?.contextLength ?? 4096;
  const memoryPreview = activeNode
    ? memoryRetrievalByConversation[activeNode.conversationId] || null
    : null;
  const extras = estimateContextExtraTokens({
    toolSettings,
    memorySettings,
    memoryPreview,
  });
  const contextTokens = contextBaseTokens + extras.total;
  const tokenUsageRatio = contextLimit > 0 ? Math.min(1, contextTokens / contextLimit) : 0;
  const draftTokens = estimateTokensFromText(draftText);
  const attachmentTokens = estimateAttachmentTokens(draftAttachments);
  const projectedTokens = contextTokens + draftTokens + attachmentTokens;
  const projectedRatio =
    contextLimit > 0 ? Math.min(1, projectedTokens / contextLimit) : 0;

  const handleDraftChange = useCallback(
    (nextDraft: string) => {
      setDraftText(nextDraft);
      draftTextRef.current = nextDraft;
      if (!leafNodeId) return;
      setChatDraft(leafNodeId, {
        content: nextDraft,
        attachments: draftAttachmentsRef.current,
      });
    },
    [leafNodeId, setChatDraft]
  );

  const handleAttachmentsChange = useCallback(
    (nextAttachments: PendingAttachment[]) => {
      setDraftAttachments(nextAttachments);
      draftAttachmentsRef.current = nextAttachments;
      if (!leafNodeId) return;
      setChatDraft(leafNodeId, {
        content: draftTextRef.current,
        attachments: nextAttachments,
      });
    },
    [leafNodeId, setChatDraft]
  );

  useEffect(() => {
    draftTextRef.current = draftText;
  }, [draftText]);

  useEffect(() => {
    draftAttachmentsRef.current = draftAttachments;
  }, [draftAttachments]);

  // Handle sending a message in the main chat
  const handleSubmit = useCallback(
    async (content: string, attachments: PendingAttachment[]) => {
      const leafNodeId = getLeafNodeId();
      if (!leafNodeId) return;

      const leafNode = nodes.get(leafNodeId);
      const conversation = leafNode ? conversations.get(leafNode.conversationId) : null;
      const flowModeEnabled = conversation?.flowMode ?? false;
      const flowNodes = conversation?.flowNodeIds ?? [];

      if (!flowModeEnabled && conversation && flowNodes.length > 0) {
        connectFlowNodes(conversation.id);
      }

      if (flowModeEnabled && conversation) {
        if (!leafNode || leafNode.messages.length === 0) {
          await sendMessage(leafNodeId, content, attachments);
          clearChatDraft(leafNodeId);
          return;
        }

        const flowRootNodeId = conversation.flowRootNodeId ?? leafNodeId;
        const newNodeId = useStore.getState().createNode(
          conversation.id,
          flowRootNodeId
        );
        updateConversation(conversation.id, {
          flowRootNodeId,
          flowNodeIds: [...flowNodes, newNodeId],
          flowMode: true,
        });
        clearChatDraft(leafNodeId);
        setActiveNode(newNodeId);
        await sendMessage(newNodeId, content, attachments);
        return;
      }

      await sendMessage(leafNodeId, content, attachments);
      clearChatDraft(leafNodeId);
    },
    [
      getLeafNodeId,
      nodes,
      sendMessage,
      setActiveNode,
      conversations,
      updateConversation,
      connectFlowNodes,
      clearChatDraft,
    ]
  );

  // Handle sending a reply to a specific message
  const handleSendReply = useCallback(
    async (parentNodeId: NodeId, content: string) => {
      // Create a reply node
      const replyNodeId = createReply(parentNodeId);

      // Send message to the reply node
      await sendMessage(replyNodeId, content);
    },
    [createReply, sendMessage]
  );

  const handleCancel = useCallback(() => {
    const leafNodeId = getLeafNodeId();
    if (leafNodeId) {
      cancelRequest(leafNodeId);
    }
  }, [getLeafNodeId, cancelRequest]);

  const updateSelection = useCallback(() => {
    if (isStreaming) {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
      return;
    }
    const container = messagesContainerRef.current;
    if (!container) {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
      return;
    }

    const text = selection.toString();
    if (!text.trim()) {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
      return;
    }

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range) {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
      return;
    }

    const ancestorNode = range.commonAncestorContainer;
    const ancestorElement =
      ancestorNode.nodeType === Node.ELEMENT_NODE
        ? (ancestorNode as Element)
        : ancestorNode.parentElement;

    if (!ancestorElement) {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
      return;
    }

    if (ancestorElement.closest('textarea, input')) {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
      return;
    }

    if (!container.contains(ancestorElement)) {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
      return;
    }

    const nextSelection = {
      text,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    };

    const prev = lastSelectionRef.current;
    if (
      prev &&
      prev.text === nextSelection.text &&
      prev.rect.left === nextSelection.rect.left &&
      prev.rect.top === nextSelection.rect.top &&
      prev.rect.width === nextSelection.rect.width &&
      prev.rect.height === nextSelection.rect.height
    ) {
      return;
    }

    lastSelectionRef.current = nextSelection;
    setQuoteSelection(nextSelection);
  }, [isStreaming]);

  useEffect(() => {
    const handleSelectionChange = () => updateSelection();
    document.addEventListener('mouseup', handleSelectionChange);
    document.addEventListener('keyup', handleSelectionChange);

    return () => {
      document.removeEventListener('mouseup', handleSelectionChange);
      document.removeEventListener('keyup', handleSelectionChange);
    };
  }, [updateSelection]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (lastSelectionRef.current !== null) {
        lastSelectionRef.current = null;
        setQuoteSelection(null);
      }
    };
    container.addEventListener('scroll', handleScroll);

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (!quoteSelection) return;

      event.preventDefault();
      chatInputRef.current?.insertQuote(quoteSelection.text);
      window.getSelection()?.removeAllRanges();
      setQuoteSelection(null);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [quoteSelection]);

  const tooltipStyle = useMemo(() => {
    if (!quoteSelection) return undefined;
    const x = quoteSelection.rect.left + quoteSelection.rect.width / 2;
    const y = Math.max(8, quoteSelection.rect.top - 8);
    return {
      left: `${x}px`,
      top: `${y}px`,
    };
  }, [quoteSelection]);

  const hasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types || []).includes('Files');

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    if (!activeNodeId || isStreaming) return;
    event.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingFiles(true);
  }, [activeNodeId, isStreaming]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    if (!activeNodeId || isStreaming) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, [activeNodeId, isStreaming]);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingFiles(false);
      if (!activeNodeId || isStreaming) return;

      const dataTransfer = event.dataTransfer;
      const items = Array.from(dataTransfer.items || []);
      const files = Array.from(dataTransfer.files || []);
      const attachments: PendingAttachment[] = [];

      for (const item of items) {
        if (item.kind !== 'file') continue;
        const getAsHandle = (
          item as DataTransferItem & {
            getAsFileSystemHandle?: () => Promise<FileSystemHandle>;
          }
        ).getAsFileSystemHandle;

        if (getAsHandle) {
          try {
            const handle = await getAsHandle();
            if (handle && handle.kind === 'file') {
              const fileHandle = handle as FileSystemFileHandle;
              const file = await fileHandle.getFile();
              const id = uuidv4();
              await registerFileHandle({
                id,
                handle: fileHandle,
                name: file.name,
                size: file.size,
                type: file.type,
                lastModified: file.lastModified,
                createdAt: Date.now(),
              });
              attachments.push({
                id,
                name: file.name,
                size: file.size,
                type: file.type,
                lastModified: file.lastModified,
                source: 'handle',
                handleId: id,
              });
              continue;
            }
          } catch {
            // Fall back to file object below.
          }
        }

        const file = item.getAsFile();
        if (file) {
          attachments.push({
            id: uuidv4(),
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            source: 'memory',
            file,
          });
        }
      }

      if (attachments.length === 0 && files.length > 0) {
        for (const file of files) {
          attachments.push({
            id: uuidv4(),
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            source: 'memory',
            file,
          });
        }
      }

      if (attachments.length === 0) return;

      chatInputRef.current?.addAttachments(attachments);
    },
    [activeNodeId, isStreaming, registerFileHandle]
  );

  return (
    <div
      className="h-full flex flex-col relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-2 flex items-center justify-between bg-white dark:bg-gray-900">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {activeNode?.label || (activeNodeId ? `Node ${activeNodeId.slice(0, 6)}` : '')}
        </div>
      </div>
      <MessageList
        onSendReply={handleSendReply}
        onRetry={retryMessage}
        containerRef={messagesContainerRef}
      />
      <div className="border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 py-2">
          <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
            <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  tokenUsageRatio >= 0.9
                    ? 'bg-red-500'
                    : tokenUsageRatio >= 0.7
                      ? 'bg-amber-500'
                      : 'bg-green-500'
                }`}
                style={{ width: `${Math.round(tokenUsageRatio * 100)}%` }}
              />
            </div>
            <div className="tabular-nums whitespace-nowrap">
              {contextTokens.toLocaleString()} / {contextLimit.toLocaleString()} tokens
            </div>
          </div>
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            Base {contextBaseTokens.toLocaleString()} + tools {extras.tools.total.toLocaleString()} + memory {extras.memory.total.toLocaleString()}
          </div>
          {(draftText.trim() || draftAttachments.length > 0) && (
            <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    projectedRatio >= 0.9
                      ? 'bg-red-400'
                      : projectedRatio >= 0.7
                        ? 'bg-amber-400'
                        : 'bg-green-400'
                  }`}
                  style={{ width: `${Math.round(projectedRatio * 100)}%` }}
                />
              </div>
              <div className="tabular-nums whitespace-nowrap">
                After send ≈ {projectedTokens.toLocaleString()} tokens
              </div>
            </div>
          )}
          {resolvedModelInfo && (
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Context for: {resolvedModelInfo.name}
            </div>
          )}
        </div>
      </div>
      <ChatInput
        ref={chatInputRef}
        draftKey={leafNodeId || 'no-node'}
        initialContent={activeDraft?.content || ''}
        initialAttachments={activeDraft?.attachments || []}
        onSubmit={handleSubmit}
        disabled={!activeNodeId}
        isStreaming={isStreaming}
        onCancel={handleCancel}
        onFocusInput={() => {
          const leafNodeId = getLeafNodeId();
          if (leafNodeId) setActiveInputNode(leafNodeId);
        }}
        onDraftChange={handleDraftChange}
        onAttachmentsChange={handleAttachmentsChange}
      />
      {quoteSelection && tooltipStyle && (
        <div
          style={tooltipStyle}
          className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg"
        >
          Press Tab to quote
        </div>
      )}
      {isDraggingFiles && (
        <div className="absolute inset-0 z-40 bg-blue-50/80 dark:bg-blue-500/10 border-2 border-dashed border-blue-300 dark:border-blue-500/50 flex items-center justify-center text-sm text-blue-700 dark:text-blue-200">
          Drop files here to attach
        </div>
      )}
    </div>
  );
}
