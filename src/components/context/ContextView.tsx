import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { useStore } from '../../store';
import type { NodeId, MemoryItem } from '../../types';
import { computeContext } from '../../utils/graph';
import { SummaryBlock } from '../shared/SummaryBlock';
import { normalizeAttachmentProcessingSettings } from '../../utils/attachments';
import { estimateContextExtraTokens } from '../../utils/tokenBudget';
import {
  deleteRagChunksForScope,
  loadRagScopeEmbeddingStats,
  type RagScopeEmbeddingStats,
  loadMemoriesForScope,
  updateMemory,
  deleteMemory as deleteMemoryRecord,
} from '../../db';

export function ContextView() {
  const {
    activeNodeId,
    nodes,
    conversations,
    getComputedContext,
    selectedModel,
    models,
    embeddingModel,
    adjacencyList,
    reverseAdjacencyList,
    customProfile,
    customResponseStyle,
    toolSettings,
    memorySettings,
    projects,
    updateConversation,
    toolTraceByConversation,
    clearToolTrace,
    memoryRetrievalByConversation,
    addToast,
  } = useStore(
    useShallow((state) => ({
      activeNodeId: state.activeNodeId,
      nodes: state.nodes,
      conversations: state.conversations,
      getComputedContext: state.getComputedContext,
      selectedModel: state.selectedModel,
      models: state.models,
      embeddingModel: state.embeddingModel,
      adjacencyList: state.adjacencyList,
      reverseAdjacencyList: state.reverseAdjacencyList,
      customProfile: state.customProfile,
      customResponseStyle: state.customResponseStyle,
      toolSettings: state.toolSettings,
      memorySettings: state.memorySettings,
      projects: state.projects,
      updateConversation: state.updateConversation,
      toolTraceByConversation: state.toolTraceByConversation,
      clearToolTrace: state.clearToolTrace,
      memoryRetrievalByConversation: state.memoryRetrievalByConversation,
      addToast: state.addToast,
    }))
  );

  const leafNodeId = useMemo((): NodeId | null => {
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

  const activeNode = leafNodeId ? nodes.get(leafNodeId) : null;
  const activeConversation = activeNode
    ? conversations.get(activeNode.conversationId)
    : null;

  const context = leafNodeId ? getComputedContext(leafNodeId) : null;
  const messages = context?.messages ?? [];
  const tokenBaseEstimate = context?.tokenEstimate ?? 0;
  const project = activeConversation?.projectId
    ? projects.get(activeConversation.projectId) || null
    : null;
  const contextSettings = activeConversation?.contextSettings ?? {};
  const attachmentProcessing = normalizeAttachmentProcessingSettings(
    activeConversation?.attachmentProcessing
  );
  const [kbStats, setKbStats] = useState<{
    conversation: RagScopeEmbeddingStats;
    project: RagScopeEmbeddingStats;
  }>({
    conversation: emptyScopeStats(),
    project: emptyScopeStats(),
  });
  const [isKbRefreshing, setIsKbRefreshing] = useState(false);
  const [memoryBank, setMemoryBank] = useState<{
    conversation: MemoryItem[];
    project: MemoryItem[];
    user: MemoryItem[];
  }>({
    conversation: [],
    project: [],
    user: [],
  });
  const [isMemoryRefreshing, setIsMemoryRefreshing] = useState(false);
  const excludedNodeIds = new Set(contextSettings.excludedNodeIds || []);

  const baseContext = useMemo(() => {
    if (!leafNodeId || !activeConversation) return null;
    return computeContext(
      leafNodeId,
      nodes,
      reverseAdjacencyList,
      adjacencyList,
      activeConversation.systemPrompt,
      {
        profile: customProfile,
        responseStyle: customResponseStyle,
        projectProfile: project?.customProfile,
        projectResponseStyle: project?.customResponseStyle,
      },
      {
        ...contextSettings,
        excludedNodeIds: [],
      },
      activeConversation.rootNodeId
    );
  }, [
    leafNodeId,
    activeConversation,
    nodes,
    reverseAdjacencyList,
    adjacencyList,
    customProfile,
    customResponseStyle,
    project?.customProfile,
    project?.customResponseStyle,
    contextSettings,
  ]);

  const nodeLabels = useMemo(() => {
    const map = new Map<string, string>();
    context?.nodes.forEach((node) => {
      map.set(node.id, node.label || `Node ${node.id.slice(0, 6)}`);
    });
    return map;
  }, [context?.nodes]);

  const selectionNodes = baseContext?.nodes ?? [];
  const summary = leafNodeId ? nodes.get(leafNodeId)?.contextSummary : undefined;

  const conversationAttachments = useMemo(() => {
    if (!baseContext) return [];
    const attachments = new Map<string, string>();
    for (const node of baseContext.nodes) {
      for (const message of node.messages) {
        if (!message.attachments) continue;
        for (const attachment of message.attachments) {
          attachments.set(attachment.id, attachment.name);
        }
      }
    }
    return Array.from(attachments.values());
  }, [baseContext]);

  const resolvedModelId = (() => {
    if (!activeNode) return selectedModel;
    const conversation = conversations.get(activeNode.conversationId);
    return activeNode.model || conversation?.model || selectedModel;
  })();
  const resolvedModelInfo = useMemo(
    () => models.find((model) => model.id === resolvedModelId) || null,
    [models, resolvedModelId]
  );
  const contextLimit = resolvedModelInfo?.contextLength ?? 4096;
  const toolTrace = activeConversation
    ? toolTraceByConversation[activeConversation.id] || []
    : [];
  const memoryRetrieval = activeConversation
    ? memoryRetrievalByConversation[activeConversation.id] || null
    : null;
  const extraTokens = estimateContextExtraTokens({
    toolSettings,
    memorySettings,
    memoryPreview: memoryRetrieval,
  });
  const tokenEstimate = tokenBaseEstimate + extraTokens.total;

  const handleToggleSetting = (key: keyof typeof contextSettings, value: boolean) => {
    if (!activeConversation) return;
    updateConversation(activeConversation.id, {
      contextSettings: {
        ...contextSettings,
        [key]: value,
      },
    });
  };

  const handleToggleNode = (nodeId: string) => {
    if (!activeConversation) return;
    const nextExcluded = new Set(excludedNodeIds);
    if (nextExcluded.has(nodeId)) {
      nextExcluded.delete(nodeId);
    } else {
      nextExcluded.add(nodeId);
    }
    updateConversation(activeConversation.id, {
      contextSettings: {
        ...contextSettings,
        excludedNodeIds: Array.from(nextExcluded),
      },
    });
  };

  const handleAttachmentModeChange = (mode: 'retrieval' | 'summarize') => {
    if (!activeConversation) return;
    updateConversation(activeConversation.id, {
      attachmentProcessing: {
        ...attachmentProcessing,
        mode,
      },
    });
  };

  useEffect(() => {
    if (!isIndexedDbAvailable()) {
      setKbStats({
        conversation: emptyScopeStats(),
        project: emptyScopeStats(),
      });
      return;
    }

    if (!activeConversation) {
      setKbStats({
        conversation: emptyScopeStats(),
        project: emptyScopeStats(),
      });
      return;
    }

    let cancelled = false;
    const loadStats = async () => {
      setIsKbRefreshing(true);
      try {
        const conversationStats = await loadRagScopeEmbeddingStats(
          'conversation',
          activeConversation.id,
          embeddingModel
        );
        const projectStats = activeConversation.projectId
          ? await loadRagScopeEmbeddingStats(
              'project',
              activeConversation.projectId,
              embeddingModel
            )
          : emptyScopeStats();

        if (cancelled) return;
        setKbStats({
          conversation: conversationStats,
          project: projectStats,
        });
      } finally {
        if (!cancelled) setIsKbRefreshing(false);
      }
    };

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [activeConversation?.id, activeConversation?.projectId, embeddingModel]);

  useEffect(() => {
    if (!isIndexedDbAvailable()) {
      setMemoryBank({ conversation: [], project: [], user: [] });
      return;
    }
    if (!activeConversation) {
      setMemoryBank({ conversation: [], project: [], user: [] });
      return;
    }
    let cancelled = false;
    const loadMemoryBank = async () => {
      setIsMemoryRefreshing(true);
      try {
        const [conversationMemories, projectMemories, userMemories] = await Promise.all([
          loadMemoriesForScope('conversation', activeConversation.id),
          activeConversation.projectId
            ? loadMemoriesForScope('project', activeConversation.projectId)
            : Promise.resolve([]),
          loadMemoriesForScope('user', 'global'),
        ]);
        if (cancelled) return;
        setMemoryBank({
          conversation: conversationMemories.slice(0, 30),
          project: projectMemories.slice(0, 30),
          user: userMemories.slice(0, 30),
        });
      } finally {
        if (!cancelled) setIsMemoryRefreshing(false);
      }
    };

    void loadMemoryBank();
    return () => {
      cancelled = true;
    };
  }, [activeConversation?.id, activeConversation?.projectId, memoryRetrieval?.generatedAt]);

  const handleRefreshKnowledgeBase = async () => {
    if (!activeConversation) return;
    if (!isIndexedDbAvailable()) return;
    setIsKbRefreshing(true);
    try {
      const conversationStats = await loadRagScopeEmbeddingStats(
        'conversation',
        activeConversation.id,
        embeddingModel
      );
      const projectStats = activeConversation.projectId
        ? await loadRagScopeEmbeddingStats(
            'project',
            activeConversation.projectId,
            embeddingModel
          )
        : emptyScopeStats();

      setKbStats({
        conversation: conversationStats,
        project: projectStats,
      });
    } finally {
      setIsKbRefreshing(false);
    }
  };

  const refreshMemoryBank = async () => {
    if (!activeConversation) return;
    if (!isIndexedDbAvailable()) return;
    setIsMemoryRefreshing(true);
    try {
      const [conversationMemories, projectMemories, userMemories] = await Promise.all([
        loadMemoriesForScope('conversation', activeConversation.id),
        activeConversation.projectId
          ? loadMemoriesForScope('project', activeConversation.projectId)
          : Promise.resolve([]),
        loadMemoriesForScope('user', 'global'),
      ]);
      setMemoryBank({
        conversation: conversationMemories.slice(0, 30),
        project: projectMemories.slice(0, 30),
        user: userMemories.slice(0, 30),
      });
    } finally {
      setIsMemoryRefreshing(false);
    }
  };

  const handleTogglePinMemory = async (memory: MemoryItem) => {
    await updateMemory(memory.id, {
      pinned: !memory.pinned,
      updatedAt: Date.now(),
    });
    await refreshMemoryBank();
  };

  const handleDeleteMemory = async (memory: MemoryItem) => {
    await deleteMemoryRecord(memory.id);
    await refreshMemoryBank();
  };

  const handleClearKnowledgeBase = async () => {
    if (!activeConversation) return;
    if (!isIndexedDbAvailable()) return;
    await deleteRagChunksForScope('conversation', activeConversation.id);
    if (activeConversation.projectId) {
      await deleteRagChunksForScope('project', activeConversation.projectId);
    }
    await handleRefreshKnowledgeBase();
    addToast({
      type: 'success',
      title: 'Knowledge base cleared',
      message: 'Stored RAG chunks were removed.',
    });
  };

  const handleReindexNextSend = () => {
    if (!activeConversation) return;
    updateConversation(activeConversation.id, {
      ragReindexRequestedAt: Date.now(),
    });
    addToast({
      type: 'info',
      title: 'Reindex queued',
      message: 'Knowledge base will be rebuilt on the next send.',
    });
  };

  if (!activeConversation) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        No conversation selected.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="context-view">
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
          <span
            className="font-medium text-gray-800 dark:text-gray-100"
            data-testid="context-title"
          >
            Context
          </span>
          <span>{messages.length} messages</span>
          <span>{tokenEstimate.toLocaleString()} tokens</span>
          <span>
            Limit:{' '}
            <span className="text-gray-800 dark:text-gray-100">{contextLimit.toLocaleString()}</span>
          </span>
          {resolvedModelInfo && (
            <span className="text-gray-500 dark:text-gray-400">
              Model: {resolvedModelInfo.name}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Base {tokenBaseEstimate.toLocaleString()} + tools {extraTokens.tools.total.toLocaleString()} + memory {extraTokens.memory.total.toLocaleString()}
        </div>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">
          Context Controls
        </div>
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Knowledge Base
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Embedding model: {embeddingModel}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>
              Conversation: {kbStats.conversation.chunkCount} chunks /{' '}
              {kbStats.conversation.sourceCount} sources
            </span>
            <StatusPill
              status={resolveScopeStatus(
                kbStats.conversation,
                Boolean(activeConversation.ragRebuildInProgress)
              )}
            />
            <span>
              match {kbStats.conversation.matchingEmbeddingChunks} / stale{' '}
              {kbStats.conversation.staleEmbeddingChunks}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>
              Project: {kbStats.project.chunkCount} chunks / {kbStats.project.sourceCount}{' '}
              sources
            </span>
            <StatusPill
              status={resolveScopeStatus(
                kbStats.project,
                Boolean(activeConversation.ragRebuildInProgress)
              )}
            />
            <span>
              match {kbStats.project.matchingEmbeddingChunks} / stale{' '}
              {kbStats.project.staleEmbeddingChunks}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRefreshKnowledgeBase}
              className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
            >
              {isKbRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={handleClearKnowledgeBase}
              className="px-2 py-1 text-xs rounded-md border border-red-300 text-red-600"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleReindexNextSend}
              className="px-2 py-1 text-xs rounded-md border border-blue-300 text-blue-600"
            >
              Reindex on next send
            </button>
          </div>
        </div>
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Attachment mode
          </div>
          <div className="mt-2 inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 p-1">
            <button
              type="button"
              onClick={() => handleAttachmentModeChange('retrieval')}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                attachmentProcessing.mode === 'retrieval'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800'
              }`}
            >
              Retrieval
            </button>
            <button
              type="button"
              onClick={() => handleAttachmentModeChange('summarize')}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                attachmentProcessing.mode === 'summarize'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800'
              }`}
            >
              Summarize
            </button>
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            topK={attachmentProcessing.retrievalTopK}, chunk={attachmentProcessing.chunkSize}, overlap={attachmentProcessing.chunkOverlap}
          </div>
        </div>
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
              Tool Trace
            </div>
            <button
              type="button"
              onClick={() => activeConversation && clearToolTrace(activeConversation.id)}
              className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
            >
              Clear
            </button>
          </div>
          {toolTrace.length === 0 ? (
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              No tool calls yet.
            </div>
          ) : (
            <div className="mt-2 space-y-2 max-h-44 overflow-y-auto">
              {[...toolTrace]
                .slice(-20)
                .reverse()
                .map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-gray-700 dark:text-gray-200">
                        {entry.toolName}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {entry.source}
                      </span>
                      <StatusPill status={statusToPill(entry.status)} />
                      {typeof entry.durationMs === 'number' && (
                        <span className="text-gray-500 dark:text-gray-400">
                          {entry.durationMs} ms
                        </span>
                      )}
                    </div>
                    {entry.inputPreview && (
                      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 break-words">
                        args: {entry.inputPreview}
                      </div>
                    )}
                    {entry.outputPreview && (
                      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 break-words">
                        result: {entry.outputPreview}
                      </div>
                    )}
                    {entry.error && (
                      <div className="mt-1 text-[11px] text-red-600 dark:text-red-400 break-words">
                        error: {entry.error}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Memory Retrieval
          </div>
          {!memorySettings.enabled ? (
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Memory is disabled in Settings.
            </div>
          ) : !memoryRetrieval ? (
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              No retrieval trace yet. Send a message to populate this block.
            </div>
          ) : (
            <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-2 py-2">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words">
                {memoryRetrieval.content}
              </div>
            </div>
          )}
        </div>
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
              Memory Bank
            </div>
            <button
              type="button"
              onClick={refreshMemoryBank}
              className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
            >
              {isMemoryRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="mt-2 grid gap-2">
            <MemoryScopeSection
              title="Conversation"
              items={memoryBank.conversation}
              onTogglePin={handleTogglePinMemory}
              onDelete={handleDeleteMemory}
            />
            <MemoryScopeSection
              title="Project"
              items={memoryBank.project}
              onTogglePin={handleTogglePinMemory}
              onDelete={handleDeleteMemory}
            />
            <MemoryScopeSection
              title="User"
              items={memoryBank.user}
              onTogglePin={handleTogglePinMemory}
              onDelete={handleDeleteMemory}
            />
          </div>
        </div>
        <div className="mt-2 grid gap-2 text-sm text-gray-700 dark:text-gray-200">
          {activeConversation?.systemPrompt && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={contextSettings.includeSystemPrompt ?? true}
                onChange={(e) =>
                  handleToggleSetting('includeSystemPrompt', e.target.checked)
                }
              />
              System prompt
            </label>
          )}
          {(customProfile.trim() || customResponseStyle.trim()) && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={contextSettings.includeCustomInstructions ?? true}
                onChange={(e) =>
                  handleToggleSetting('includeCustomInstructions', e.target.checked)
                }
              />
              Custom instructions
            </label>
          )}
          {(project?.customProfile?.trim() || project?.customResponseStyle?.trim()) && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={contextSettings.includeProjectInstructions ?? true}
                onChange={(e) =>
                  handleToggleSetting('includeProjectInstructions', e.target.checked)
                }
              />
              Project instructions
            </label>
          )}
          {conversationAttachments.length > 0 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={contextSettings.includeAttachmentContext ?? true}
                onChange={(e) =>
                  handleToggleSetting('includeAttachmentContext', e.target.checked)
                }
              />
              Attachment context ({conversationAttachments.length})
            </label>
          )}
          {(project?.attachments?.length ?? 0) > 0 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={contextSettings.includeProjectAttachmentContext ?? true}
                onChange={(e) =>
                  handleToggleSetting('includeProjectAttachmentContext', e.target.checked)
                }
              />
              Project attachment context ({project?.attachments?.length ?? 0})
            </label>
          )}
        </div>

        {selectionNodes.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">
              Nodes
            </div>
            <div className="mt-2 grid gap-2 text-sm text-gray-700 dark:text-gray-200">
              {selectionNodes.map((node) => (
                <label key={node.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!excludedNodeIds.has(node.id)}
                    onChange={() => handleToggleNode(node.id)}
                  />
                  <span>{node.label || `Node ${node.id.slice(0, 6)}`}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {conversationAttachments.length > 0 && (
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Files: {conversationAttachments.join(', ')}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
        <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">
          {summary && (
            <SummaryBlock
              title="Auto-summary"
              content={summary.content}
              timestamp={summary.createdAt}
            />
          )}
          {messages.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Context is empty.</div>
          ) : (
            messages.map((message) => {
              const label =
                message.role === 'system' && message.isCustomInstruction
                  ? 'Custom Instructions'
                  : message.role === 'system' && message.isProjectInstruction
                    ? 'Project Instructions'
                    : message.nodeId === 'system'
                      ? 'System Prompt'
                      : nodeLabels.get(message.nodeId) || `Node ${message.nodeId.slice(0, 6)}`;
              const roleStyles =
                message.role === 'system'
                  ? message.isCustomInstruction
                    ? 'border-indigo-200 bg-indigo-50 dark:border-indigo-500/40 dark:bg-indigo-500/10'
                    : message.isProjectInstruction
                      ? 'border-cyan-200 bg-cyan-50 dark:border-cyan-500/40 dark:bg-cyan-500/10'
                      : 'border-yellow-200 bg-yellow-50 dark:border-yellow-500/40 dark:bg-yellow-500/10'
                  : message.role === 'user'
                    ? 'border-blue-200 bg-white dark:border-blue-500/40 dark:bg-gray-900'
                    : 'border-green-200 bg-white dark:border-green-500/40 dark:bg-gray-900';
              const roleLabel =
                message.role === 'system' && message.isAttachmentContext
                  ? 'attachment'
                  : message.role === 'assistant'
                    ? message.model || 'assistant'
                    : message.role;

              return (
                <div
                  key={`${message.id}-${message.nodeId}`}
                  className={`rounded-lg border ${roleStyles} p-3`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
                    <span className="uppercase tracking-wide font-medium text-gray-600 dark:text-gray-300">
                      {roleLabel}
                    </span>
                    <span>·</span>
                    <span>{label}</span>
                  </div>
                  <MarkdownRenderer
                    className="prose prose-sm max-w-none text-gray-800 dark:text-gray-100 dark:prose-invert"
                    content={message.content || '—'}
                  />
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {message.attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className="px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-200 bg-gray-50 dark:bg-gray-800"
                        >
                          {attachment.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function isIndexedDbAvailable() {
  return typeof indexedDB !== 'undefined';
}

function MemoryScopeSection({
  title,
  items,
  onTogglePin,
  onDelete,
}: {
  title: string;
  items: MemoryItem[];
  onTogglePin: (memory: MemoryItem) => void;
  onDelete: (memory: MemoryItem) => void;
}) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 px-2 py-2">
      <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Empty</div>
      ) : (
        <div className="mt-2 space-y-1 max-h-32 overflow-y-auto pr-1">
          {items.slice(0, 10).map((item) => (
            <div
              key={item.id}
              className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  {item.category} · conf {item.confidence.toFixed(2)}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onTogglePin(item)}
                    className={`text-[11px] ${
                      item.pinned
                        ? 'text-amber-600 dark:text-amber-300'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {item.pinned ? 'Pinned' : 'Pin'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item)}
                    className="text-[11px] text-red-600 dark:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-1 text-xs text-gray-700 dark:text-gray-200 break-words">
                {item.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function emptyScopeStats(): RagScopeEmbeddingStats {
  return {
    chunkCount: 0,
    sourceCount: 0,
    matchingEmbeddingChunks: 0,
    matchingEmbeddingSources: 0,
    staleEmbeddingChunks: 0,
  };
}

function resolveScopeStatus(
  stats: RagScopeEmbeddingStats,
  isRebuilding: boolean
): 'ready' | 'stale' | 'rebuilding' {
  if (isRebuilding) return 'rebuilding';
  if (stats.chunkCount === 0) return 'stale';
  if (stats.staleEmbeddingChunks > 0) return 'stale';
  if (stats.matchingEmbeddingChunks === 0) return 'stale';
  return 'ready';
}

function StatusPill({ status }: { status: 'ready' | 'stale' | 'rebuilding' }) {
  const styles =
    status === 'ready'
      ? 'border-green-300 text-green-700 dark:border-green-500/40 dark:text-green-300'
      : status === 'rebuilding'
        ? 'border-blue-300 text-blue-700 dark:border-blue-500/40 dark:text-blue-300'
        : 'border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-300';

  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase ${styles}`}>
      {status}
    </span>
  );
}

function statusToPill(status: 'started' | 'succeeded' | 'failed' | 'denied') {
  if (status === 'started') return 'rebuilding';
  if (status === 'succeeded') return 'ready';
  return 'stale';
}
