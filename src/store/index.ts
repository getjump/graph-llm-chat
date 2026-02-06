import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
  Conversation,
  ConversationNode,
  ConversationEdge,
  Message,
  NodeId,
  ConversationId,
  MessageId,
  EdgeId,
  ViewMode,
  ActiveRequest,
  AdjacencyList,
  ReverseAdjacencyList,
  ComputedContext,
  LLMModel,
  StoredFileHandle,
  Toast,
  Project,
  ProjectId,
  PendingAttachment,
  NormalizedToolSettings,
  ToolSettings,
  ToolTraceEntry,
  MemorySettings,
  NormalizedMemorySettings,
  MemoryRetrievalPreview,
} from '../types';
import { normalizeAttachmentProcessingSettings } from '../utils/attachments';
import { isLikelyEmbeddingModel } from '../utils/models';
import { normalizeToolSettings } from '../utils/tools';
import { normalizeMemorySettings } from '../utils/memory';
import {
  computeAdjacencyLists,
  wouldCreateCycle,
  computeContext,
  getDescendants,
  getPathToNode,
  layoutNodes,
} from '../utils/graph';
import * as db from '../db';
import {
  fetchEmbeddingModelsWithCache,
  fetchModelsWithCache,
  getBundledEmbeddingFallbackModels,
  getBundledFallbackModels,
  OPENROUTER_BASE_URL,
} from '../api/openrouter';

const FALLBACK_MODELS: LLMModel[] = getBundledFallbackModels(OPENROUTER_BASE_URL);
const FALLBACK_EMBEDDING_MODELS: LLMModel[] =
  getBundledEmbeddingFallbackModels(OPENROUTER_BASE_URL);

const LAST_CONVERSATION_KEY = 'graph_chat_last_conversation';
const LAST_BRANCH_KEY_PREFIX = 'graph_chat_last_branch:';
const CUSTOM_PROFILE_KEY = 'graph_chat_custom_profile';
const CUSTOM_RESPONSE_STYLE_KEY = 'graph_chat_custom_response_style';
const AUTO_TITLE_ENABLED_KEY = 'graph_chat_auto_title_enabled';
const AUTO_TITLE_MODEL_KEY = 'graph_chat_auto_title_model';
const EMBEDDING_MODEL_KEY = 'graph_chat_embedding_model';
const LAST_PROJECT_KEY = 'graph_chat_last_project';
const THEME_KEY = 'graph_chat_theme';
const CHAT_DRAFTS_KEY = 'graph_chat_chat_drafts_v1';
const REPLY_DRAFTS_KEY = 'graph_chat_reply_drafts_v1';
const TOOL_SETTINGS_KEY = 'graph_chat_tool_settings_v1';
const MEMORY_SETTINGS_KEY = 'graph_chat_memory_settings_v1';

function getLastBranchKey(conversationId: ConversationId) {
  return `${LAST_BRANCH_KEY_PREFIX}${conversationId}`;
}

function getInitialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function arePendingAttachmentsEqual(
  a: PendingAttachment[],
  b: PendingAttachment[]
) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.name !== right.name ||
      left.size !== right.size ||
      left.type !== right.type ||
      left.lastModified !== right.lastModified ||
      left.source !== right.source ||
      left.handleId !== right.handleId
    ) {
      return false;
    }
  }
  return true;
}

function sanitizeDraftAttachments(
  attachments: PendingAttachment[]
): PendingAttachment[] {
  return attachments
    .filter((attachment) => attachment.source === 'handle')
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
      lastModified: attachment.lastModified,
      source: attachment.source,
      handleId: attachment.handleId,
    }));
}

function loadChatDraftsFromStorage() {
  try {
    const raw = localStorage.getItem(CHAT_DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<
      string,
      { content?: string; attachments?: PendingAttachment[] }
    >;
    const next: Record<
      string,
      { content: string; attachments: PendingAttachment[] }
    > = {};

    for (const [nodeId, draft] of Object.entries(parsed || {})) {
      const content = typeof draft?.content === 'string' ? draft.content : '';
      const attachments = Array.isArray(draft?.attachments)
        ? sanitizeDraftAttachments(draft.attachments)
        : [];
      if (!content && attachments.length === 0) continue;
      next[nodeId] = { content, attachments };
    }
    return next;
  } catch {
    return {};
  }
}

function loadReplyDraftsFromStorage() {
  try {
    const raw = localStorage.getItem(REPLY_DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, string> = {};
    for (const [nodeId, value] of Object.entries(parsed || {})) {
      if (typeof value === 'string' && value) {
        next[nodeId] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function loadToolSettingsFromStorage(): NormalizedToolSettings {
  try {
    const raw = localStorage.getItem(TOOL_SETTINGS_KEY);
    if (!raw) return normalizeToolSettings();
    return normalizeToolSettings(JSON.parse(raw) as ToolSettings);
  } catch {
    return normalizeToolSettings();
  }
}

function loadMemorySettingsFromStorage(): NormalizedMemorySettings {
  try {
    const raw = localStorage.getItem(MEMORY_SETTINGS_KEY);
    if (!raw) return normalizeMemorySettings();
    return normalizeMemorySettings(JSON.parse(raw) as MemorySettings);
  } catch {
    return normalizeMemorySettings();
  }
}

interface GraphChatState {
  // Data
  conversations: Map<ConversationId, Conversation>;
  nodes: Map<NodeId, ConversationNode>;
  edges: Map<EdgeId, ConversationEdge>;
  projects: Map<ProjectId, Project>;

  // UI State
  activeConversationId: ConversationId | null;
  activeNodeId: NodeId | null;
  activeInputNodeId: NodeId | null;
  activeProjectId: ProjectId | null;
  viewMode: ViewMode;
  selectedModel: string;
  apiKey: string;
  apiBaseUrl: string;
  models: LLMModel[];
  embeddingModels: LLMModel[];
  modelsLoading: boolean;
  modelsError: string | null;
  customProfile: string;
  customResponseStyle: string;
  autoTitleEnabled: boolean;
  autoTitleModel: string;
  embeddingModel: string;
  toolSettings: NormalizedToolSettings;
  memorySettings: NormalizedMemorySettings;
  replyThreadFocusNodeId: NodeId | null;
  theme: 'light' | 'dark';
  highlightedMessageId: MessageId | null;
  highlightedQuery: string | null;
  chatDrafts: Record<string, { content: string; attachments: PendingAttachment[] }>;
  replyDrafts: Record<string, string>;
  toolTraceByConversation: Record<ConversationId, ToolTraceEntry[]>;
  memoryRetrievalByConversation: Record<ConversationId, MemoryRetrievalPreview | null>;

  // Streaming State
  activeRequests: Map<NodeId, ActiveRequest>;

  // File handles
  fileHandles: Map<string, FileSystemFileHandle>;

  // Toasts
  toasts: Toast[];

  // Computed (cached)
  adjacencyList: AdjacencyList;
  reverseAdjacencyList: ReverseAdjacencyList;

  // Loading state
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  initialize: () => Promise<void>;
  loadModels: () => Promise<void>;

  // Conversation CRUD
  createConversation: (
    title: string,
    systemPrompt?: string,
    projectId?: ProjectId | null
  ) => Promise<ConversationId>;
  updateConversation: (id: ConversationId, updates: Partial<Conversation>) => void;
  deleteConversation: (id: ConversationId) => Promise<void>;
  setActiveConversation: (id: ConversationId | null) => Promise<void>;

  // Project CRUD
  createProject: (name: string) => Promise<ProjectId>;
  updateProject: (id: ProjectId, updates: Partial<Project>) => void;
  deleteProject: (id: ProjectId) => Promise<void>;
  setActiveProject: (id: ProjectId | null) => void;

  // Node CRUD
  createNode: (
    conversationId: ConversationId,
    parentNodeId?: NodeId,
    branchedFromMessageId?: MessageId
  ) => NodeId;
  updateNode: (nodeId: NodeId, updates: Partial<ConversationNode>) => void;
  deleteNode: (nodeId: NodeId) => void;
  setActiveNode: (nodeId: NodeId | null) => void;
  setActiveInputNode: (nodeId: NodeId | null) => void;

  // Edge CRUD
  createEdge: (source: NodeId, target: NodeId) => EdgeId | null;
  deleteEdge: (edgeId: EdgeId) => void;

  // Message operations
  addMessage: (
    nodeId: NodeId,
    message: Omit<Message, 'id' | 'nodeId' | 'createdAt'>
  ) => MessageId;
  updateMessage: (nodeId: NodeId, messageId: MessageId, updates: Partial<Message>) => void;
  appendToStreamingMessage: (nodeId: NodeId, messageId: MessageId, content: string) => void;
  deleteMessage: (nodeId: NodeId, messageId: MessageId) => void;
  editMessage: (
    nodeId: NodeId,
    messageId: MessageId,
    content: string,
    mode: 'preserve' | 'reset'
  ) => void;

  // Branching
  branchFromMessage: (nodeId: NodeId, messageId: MessageId) => NodeId;

  // Request management
  registerRequest: (nodeId: NodeId, abortController: AbortController) => void;
  unregisterRequest: (nodeId: NodeId) => void;
  cancelRequest: (nodeId: NodeId) => void;

  // Graph algorithms
  getComputedContext: (nodeId: NodeId) => ComputedContext;
  canCreateEdge: (source: NodeId, target: NodeId) => boolean;
  getActivePath: () => NodeId[];
  getBranchesFromNode: (nodeId: NodeId) => NodeId[];
  getRepliesForNode: (nodeId: NodeId) => ConversationNode[];

  // Reply/comment system
  createReply: (parentNodeId: NodeId) => NodeId;

  // UI actions
  setViewMode: (mode: ViewMode) => void;
  setSelectedModel: (model: string) => void;
  setApiKey: (key: string) => void;
  setApiBaseUrl: (url: string) => void;
  setFlowMode: (conversationId: ConversationId, enabled: boolean) => void;
  connectFlowNodes: (conversationId: ConversationId) => void;
  setChatDraft: (
    nodeId: NodeId,
    draft: { content: string; attachments: PendingAttachment[] }
  ) => void;
  clearChatDraft: (nodeId: NodeId) => void;
  setReplyDraft: (parentNodeId: NodeId, content: string) => void;
  clearReplyDraft: (parentNodeId: NodeId) => void;
  setCustomProfile: (value: string) => void;
  setCustomResponseStyle: (value: string) => void;
  setAutoTitleEnabled: (value: boolean) => void;
  setAutoTitleModel: (value: string) => void;
  setEmbeddingModel: (value: string) => void;
  setToolSettings: (value: ToolSettings) => void;
  setMemorySettings: (value: MemorySettings) => void;
  setReplyThreadFocusNodeId: (value: NodeId | null) => void;
  setHighlightedMessage: (messageId: MessageId | null, query?: string | null) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  updateNodePosition: (nodeId: NodeId, position: { x: number; y: number }) => void;
  autoLayoutNodes: () => void;

  // File handle actions
  registerFileHandle: (record: StoredFileHandle) => Promise<void>;
  getFileHandle: (id: string) => FileSystemFileHandle | null;
  deleteFileHandle: (id: string) => Promise<void>;

  // Toast actions
  addToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  addToolTrace: (
    entry: Omit<ToolTraceEntry, 'id' | 'startedAt' | 'status'>
  ) => string;
  updateToolTrace: (
    conversationId: ConversationId,
    traceId: string,
    updates: Partial<ToolTraceEntry>
  ) => void;
  clearToolTrace: (conversationId: ConversationId) => void;
  setMemoryRetrievalPreview: (
    conversationId: ConversationId,
    preview: MemoryRetrievalPreview | null
  ) => void;

  // Persistence
  persistConversation: (conversationId: ConversationId) => Promise<void>;
}

export const useStore = create<GraphChatState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    conversations: new Map(),
    nodes: new Map(),
    edges: new Map(),
    projects: new Map(),
    activeConversationId: null,
    activeNodeId: null,
    activeInputNodeId: null,
    activeProjectId: localStorage.getItem(LAST_PROJECT_KEY),
    viewMode: 'chat',
    selectedModel: 'openai/gpt-4-turbo',
    apiKey: localStorage.getItem('openrouter-api-key') || '',
    apiBaseUrl:
      localStorage.getItem('openrouter-api-base-url') || 'https://openrouter.ai/api/v1',
    customProfile: localStorage.getItem(CUSTOM_PROFILE_KEY) || '',
    customResponseStyle: localStorage.getItem(CUSTOM_RESPONSE_STYLE_KEY) || '',
    autoTitleEnabled: localStorage.getItem(AUTO_TITLE_ENABLED_KEY) === 'true',
    autoTitleModel:
      localStorage.getItem(AUTO_TITLE_MODEL_KEY) || 'openai/gpt-4-turbo',
    embeddingModel:
      localStorage.getItem(EMBEDDING_MODEL_KEY) || 'openai/text-embedding-3-small',
    toolSettings: loadToolSettingsFromStorage(),
    memorySettings: loadMemorySettingsFromStorage(),
    replyThreadFocusNodeId: null,
    theme: getInitialTheme(),
    highlightedMessageId: null,
    highlightedQuery: null,
    chatDrafts: loadChatDraftsFromStorage(),
    replyDrafts: loadReplyDraftsFromStorage(),
    toolTraceByConversation: {},
    memoryRetrievalByConversation: {},
    models: FALLBACK_MODELS,
    embeddingModels: FALLBACK_EMBEDDING_MODELS,
    modelsLoading: false,
    modelsError: null,
    activeRequests: new Map(),
    fileHandles: new Map(),
    toasts: [],
    adjacencyList: {},
    reverseAdjacencyList: {},
    isLoading: false,
    isInitialized: false,

    // Initialize - load data from IndexedDB
    initialize: async () => {
      set({ isLoading: true });

      try {
        const conversations = await db.loadAllConversations();
        const conversationsMap = new Map<ConversationId, Conversation>();
        for (const conv of conversations) {
          conversationsMap.set(conv.id, {
            ...conv,
            attachmentProcessing: normalizeAttachmentProcessingSettings(
              conv.attachmentProcessing
            ),
          });
        }

        const projects = await db.loadAllProjects();
        const projectsMap = new Map<ProjectId, Project>();
        for (const project of projects) {
          projectsMap.set(project.id, project);
        }

        let fileHandlesMap = new Map<string, FileSystemFileHandle>();
        try {
          const storedHandles = await db.loadAllFileHandles();
          fileHandlesMap = new Map(
            storedHandles.map((record) => [record.id, record.handle])
          );
        } catch (error) {
          console.warn('Failed to load file handles:', error);
        }

        let activeProjectId = get().activeProjectId;
        if (activeProjectId && !projectsMap.has(activeProjectId)) {
          activeProjectId = null;
        }

        set({
          conversations: conversationsMap,
          projects: projectsMap,
          fileHandles: fileHandlesMap,
          activeProjectId,
          isInitialized: true,
          isLoading: false,
        });

        const lastConversationId = localStorage.getItem(LAST_CONVERSATION_KEY);
        if (lastConversationId && conversationsMap.has(lastConversationId)) {
          await get().setActiveConversation(lastConversationId);
        }
      } catch (error) {
        console.error('Failed to initialize:', error);
        set({ isLoading: false, isInitialized: true });
      }
    },

    loadModels: async () => {
      const state = get();
      if (state.modelsLoading) return;

      set({ modelsLoading: true, modelsError: null });

      if (!state.apiKey) {
        set({
          models: getBundledFallbackModels(state.apiBaseUrl),
          embeddingModels: getBundledEmbeddingFallbackModels(state.apiBaseUrl),
          modelsLoading: false,
          modelsError: null,
        });
        return;
      }

      try {
        const [modelsResult, embeddingsResult] = await Promise.allSettled([
          fetchModelsWithCache(state.apiKey, state.apiBaseUrl),
          fetchEmbeddingModelsWithCache(state.apiKey, state.apiBaseUrl),
        ]);

        const fallbackModels = getBundledFallbackModels(state.apiBaseUrl);
        const fallbackEmbeddingModels = getBundledEmbeddingFallbackModels(
          state.apiBaseUrl
        );

        const models =
          modelsResult.status === 'fulfilled' ? modelsResult.value : fallbackModels;
        const embeddingModels =
          embeddingsResult.status === 'fulfilled' && embeddingsResult.value.length > 0
            ? embeddingsResult.value
            : fallbackEmbeddingModels.length > 0
              ? fallbackEmbeddingModels
              : models.filter((model) => isLikelyEmbeddingModel(model));

        const modelsError =
          modelsResult.status === 'rejected'
            ? modelsResult.reason instanceof Error
              ? modelsResult.reason.message
              : 'Failed to load models'
            : null;

        set({
          models,
          embeddingModels,
          modelsLoading: false,
          modelsError,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load models';
        set({
          models: getBundledFallbackModels(state.apiBaseUrl),
          embeddingModels: getBundledEmbeddingFallbackModels(state.apiBaseUrl),
          modelsLoading: false,
          modelsError: message,
        });
      }
    },

    // Create a new conversation
    createConversation: async (
      title: string,
      systemPrompt?: string,
      projectId?: ProjectId | null
    ) => {
      const state = get();
      const conversationId = uuidv4();
      const rootNodeId = uuidv4();
      const now = Date.now();

      const conversation: Conversation = {
        id: conversationId,
        title,
        rootNodeId,
        systemPrompt,
        model: state.selectedModel,
        createdAt: now,
        updatedAt: now,
        projectId: projectId ?? undefined,
        attachmentProcessing: normalizeAttachmentProcessingSettings(),
      };

      const rootNode: ConversationNode = {
        id: rootNodeId,
        conversationId,
        messages: [],
        position: { x: 0, y: 0 },
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        isCollapsed: false,
        model: state.selectedModel,
      };

      const newConversations = new Map(state.conversations);
      newConversations.set(conversationId, conversation);

      const newNodes = new Map(state.nodes);
      newNodes.set(rootNodeId, rootNode);

      set({
        conversations: newConversations,
        nodes: newNodes,
        activeConversationId: conversationId,
        activeNodeId: rootNodeId,
        activeInputNodeId: rootNodeId,
        activeProjectId: projectId ?? state.activeProjectId,
      });

      localStorage.setItem(LAST_CONVERSATION_KEY, conversationId);
      localStorage.setItem(getLastBranchKey(conversationId), rootNodeId);
      if (projectId) {
        localStorage.setItem(LAST_PROJECT_KEY, projectId);
      }

      // Persist
      await db.saveConversation(conversation, [rootNode], []);

      return conversationId;
    },

    // Update conversation
    updateConversation: (id: ConversationId, updates: Partial<Conversation>) => {
      const state = get();
      const conversation = state.conversations.get(id);
      if (!conversation) return;

      const nextAttachmentProcessing =
        updates.attachmentProcessing !== undefined
          ? normalizeAttachmentProcessingSettings({
              ...conversation.attachmentProcessing,
              ...updates.attachmentProcessing,
            })
          : conversation.attachmentProcessing;

      const updated = {
        ...conversation,
        ...updates,
        attachmentProcessing: nextAttachmentProcessing,
        updatedAt: Date.now(),
      };
      const newConversations = new Map(state.conversations);
      newConversations.set(id, updated);
      set({ conversations: newConversations });
    },

    // Create a new project
    createProject: async (name: string) => {
      const state = get();
      const projectId = uuidv4();
      const now = Date.now();

      const project: Project = {
        id: projectId,
        name,
        createdAt: now,
        updatedAt: now,
        attachments: [],
      };

      const newProjects = new Map(state.projects);
      newProjects.set(projectId, project);

      set({ projects: newProjects, activeProjectId: projectId });
      localStorage.setItem(LAST_PROJECT_KEY, projectId);

      await db.saveProject(project);
      return projectId;
    },

    updateProject: (id: ProjectId, updates: Partial<Project>) => {
      const state = get();
      const project = state.projects.get(id);
      if (!project) return;

      const updated = { ...project, ...updates, updatedAt: Date.now() };
      const newProjects = new Map(state.projects);
      newProjects.set(id, updated);
      set({ projects: newProjects });
      void db.saveProject(updated);
    },

    deleteProject: async (id: ProjectId) => {
      const state = get();
      const newProjects = new Map(state.projects);
      newProjects.delete(id);

      const newConversations = new Map(state.conversations);
      for (const [convId, conv] of newConversations) {
        if (conv.projectId === id) {
          newConversations.set(convId, { ...conv, projectId: undefined });
        }
      }

      const nextActiveProjectId =
        state.activeProjectId === id ? null : state.activeProjectId;

      set({
        projects: newProjects,
        conversations: newConversations,
        activeProjectId: nextActiveProjectId,
      });

      if (state.activeProjectId === id) {
        localStorage.removeItem(LAST_PROJECT_KEY);
      }

      await db.deleteProject(id);
      await db.deleteRagChunksForScope('project', id);
    },

    setActiveProject: (id: ProjectId | null) => {
      const state = get();
      if (!id) {
        localStorage.removeItem(LAST_PROJECT_KEY);
        set({ activeProjectId: null });
        return;
      }

      let nextActiveConversationId = state.activeConversationId;
      let nextActiveNodeId = state.activeNodeId;
      let nextActiveInputNodeId = state.activeInputNodeId;
      if (nextActiveConversationId) {
        const conversation = state.conversations.get(nextActiveConversationId);
        if (!conversation || conversation.projectId !== id) {
          nextActiveConversationId = null;
          nextActiveNodeId = null;
          nextActiveInputNodeId = null;
          localStorage.removeItem(LAST_CONVERSATION_KEY);
        }
      }

      localStorage.setItem(LAST_PROJECT_KEY, id);
      set({
        activeProjectId: id,
        activeConversationId: nextActiveConversationId,
        activeNodeId: nextActiveNodeId,
        activeInputNodeId: nextActiveInputNodeId,
      });
    },

    // Delete conversation
    deleteConversation: async (id: ConversationId) => {
      const state = get();

      // Cancel any active requests for this conversation
      const nodesInConv = Array.from(state.nodes.values()).filter(
        (n) => n.conversationId === id
      );
      for (const node of nodesInConv) {
        state.cancelRequest(node.id);
      }

      // Remove from state
      const newConversations = new Map(state.conversations);
      newConversations.delete(id);

      const newNodes = new Map(state.nodes);
      const newEdges = new Map(state.edges);

      for (const node of nodesInConv) {
        newNodes.delete(node.id);
      }

      for (const [edgeId, edge] of state.edges) {
        if (edge.conversationId === id) {
          newEdges.delete(edgeId);
        }
      }

      const removedNodeIds = new Set(nodesInConv.map((node) => node.id));
      const nextChatDrafts = { ...state.chatDrafts };
      const nextReplyDrafts = { ...state.replyDrafts };
      const nextToolTraceByConversation = { ...state.toolTraceByConversation };
      delete nextToolTraceByConversation[id];
      for (const removedId of removedNodeIds) {
        delete nextChatDrafts[removedId];
        delete nextReplyDrafts[removedId];
      }

      const isActive = state.activeConversationId === id;

      set({
        conversations: newConversations,
        nodes: newNodes,
        edges: newEdges,
        chatDrafts: nextChatDrafts,
        replyDrafts: nextReplyDrafts,
        toolTraceByConversation: nextToolTraceByConversation,
        activeConversationId: isActive ? null : state.activeConversationId,
        activeNodeId: isActive ? null : state.activeNodeId,
        activeInputNodeId: isActive ? null : state.activeInputNodeId,
      });

      localStorage.removeItem(getLastBranchKey(id));
      if (isActive) {
        localStorage.removeItem(LAST_CONVERSATION_KEY);
      }

      // Update adjacency lists
      get().autoLayoutNodes();

      // Delete from DB
      await db.deleteConversation(id);
      await db.deleteRagChunksForScope('conversation', id);
    },

    // Set active conversation
    setActiveConversation: async (id: ConversationId | null) => {
      if (id === null) {
        localStorage.removeItem(LAST_CONVERSATION_KEY);
        set({ activeConversationId: null, activeNodeId: null, activeInputNodeId: null });
        return;
      }

      const state = get();
      set({ isLoading: true });
      localStorage.setItem(LAST_CONVERSATION_KEY, id);

      // Load full conversation data if not loaded
      const loaded = await db.loadConversation(id);
      if (!loaded) {
        set({ isLoading: false });
        return;
      }

      const { conversation, nodes, edges } = loaded;

      // Update state with loaded data
      const newNodes = new Map(state.nodes);
      for (const node of nodes) {
        newNodes.set(node.id, node);
      }

      const newEdges = new Map(state.edges);
      for (const edge of edges) {
        newEdges.set(edge.id, edge);
      }

      // Compute adjacency lists
      const { adjacencyList, reverseAdjacencyList } = computeAdjacencyLists(edges);

      const storedBranchId = localStorage.getItem(getLastBranchKey(id));
      let activeNodeId = conversation.rootNodeId;
      if (storedBranchId && newNodes.has(storedBranchId)) {
        let candidate = newNodes.get(storedBranchId) || null;
        while (candidate && candidate.isReply && candidate.parentNodeId) {
          candidate = newNodes.get(candidate.parentNodeId) || null;
        }
        if (candidate) {
          activeNodeId = candidate.id;
        }
      }

      const activeNode = newNodes.get(activeNodeId);
      const selectedModel =
        activeNode?.model || conversation.model || state.selectedModel;

      const nextProjectId = conversation.projectId ?? null;
      if (nextProjectId) {
        localStorage.setItem(LAST_PROJECT_KEY, nextProjectId);
      } else {
        localStorage.removeItem(LAST_PROJECT_KEY);
      }

      set({
        nodes: newNodes,
        edges: newEdges,
        adjacencyList,
        reverseAdjacencyList,
        activeConversationId: id,
        activeNodeId,
        activeInputNodeId: activeNodeId,
        activeProjectId: nextProjectId,
        selectedModel,
        isLoading: false,
      });
    },

    // Create a new node
    createNode: (
      conversationId: ConversationId,
      parentNodeId?: NodeId,
      branchedFromMessageId?: MessageId
    ) => {
      const state = get();
      const nodeId = uuidv4();
      const now = Date.now();

      const newNode: ConversationNode = {
        id: nodeId,
        conversationId,
        messages: [],
        position: { x: 0, y: 0 },
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        isCollapsed: false,
        branchedFromMessageId,
        model: state.selectedModel,
      };

      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, newNode);

      let newEdges = state.edges;
      let newAdjList = state.adjacencyList;
      let newRevAdjList = state.reverseAdjacencyList;

      // Create edge from parent if specified
      if (parentNodeId) {
        const edgeId = uuidv4();
        const edge: ConversationEdge = {
          id: edgeId,
          source: parentNodeId,
          target: nodeId,
          conversationId,
          createdAt: now,
        };

        newEdges = new Map(state.edges);
        newEdges.set(edgeId, edge);

        // Update adjacency lists
        const allEdges = Array.from(newEdges.values());
        const { adjacencyList, reverseAdjacencyList } = computeAdjacencyLists(allEdges);
        newAdjList = adjacencyList;
        newRevAdjList = reverseAdjacencyList;
      }

      set({
        nodes: newNodes,
        edges: newEdges,
        adjacencyList: newAdjList,
        reverseAdjacencyList: newRevAdjList,
      });

      return nodeId;
    },

    // Update node
    updateNode: (nodeId: NodeId, updates: Partial<ConversationNode>) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) return;

      const updated = { ...node, ...updates, updatedAt: Date.now() };
      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, updated);
      set({ nodes: newNodes });
    },

    // Delete node
    deleteNode: (nodeId: NodeId) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) return;

      // Don't allow deleting root node
      const conversation = state.conversations.get(node.conversationId);
      if (conversation && conversation.rootNodeId === nodeId) {
        console.warn('Cannot delete root node');
        return;
      }

      state.cancelRequest(nodeId);

      const newNodes = new Map(state.nodes);
      newNodes.delete(nodeId);

      // Remove related edges
      const newEdges = new Map(state.edges);
      for (const [edgeId, edge] of state.edges) {
        if (edge.source === nodeId || edge.target === nodeId) {
          newEdges.delete(edgeId);
        }
      }

      // Update adjacency lists
      const allEdges = Array.from(newEdges.values());
      const { adjacencyList, reverseAdjacencyList } = computeAdjacencyLists(allEdges);
      const nextChatDrafts = { ...state.chatDrafts };
      const nextReplyDrafts = { ...state.replyDrafts };
      delete nextChatDrafts[nodeId];
      delete nextReplyDrafts[nodeId];

      set({
        nodes: newNodes,
        edges: newEdges,
        adjacencyList,
        reverseAdjacencyList,
        chatDrafts: nextChatDrafts,
        replyDrafts: nextReplyDrafts,
        activeNodeId: state.activeNodeId === nodeId ? null : state.activeNodeId,
        activeInputNodeId:
          state.activeInputNodeId === nodeId ? null : state.activeInputNodeId,
      });
    },

    // Set active node
    setActiveNode: (nodeId: NodeId | null) => {
      const state = get();
      if (!nodeId) {
        set({ activeNodeId: null, activeInputNodeId: null });
        return;
      }

      const node = state.nodes.get(nodeId);
      const conversation = node
        ? state.conversations.get(node.conversationId)
        : null;
      const selectedModel = node?.isReply
        ? state.selectedModel
        : node?.model || conversation?.model || state.selectedModel;
      if (node) {
        localStorage.setItem(getLastBranchKey(node.conversationId), node.id);
        localStorage.setItem(LAST_CONVERSATION_KEY, node.conversationId);
      }

      set({
        activeNodeId: nodeId,
        activeInputNodeId: nodeId,
        selectedModel,
      });
    },

    // Create edge
    createEdge: (source: NodeId, target: NodeId) => {
      const state = get();

      // Check if edge would create cycle
      if (wouldCreateCycle(state.adjacencyList, source, target)) {
        console.warn('Cannot create edge: would create cycle');
        return null;
      }

      const sourceNode = state.nodes.get(source);
      const targetNode = state.nodes.get(target);
      if (!sourceNode || !targetNode) return null;
      if (sourceNode.conversationId !== targetNode.conversationId) return null;

      const edgeId = uuidv4();
      const edge: ConversationEdge = {
        id: edgeId,
        source,
        target,
        conversationId: sourceNode.conversationId,
        createdAt: Date.now(),
      };

      const newEdges = new Map(state.edges);
      newEdges.set(edgeId, edge);

      const allEdges = Array.from(newEdges.values());
      const { adjacencyList, reverseAdjacencyList } = computeAdjacencyLists(allEdges);

      set({
        edges: newEdges,
        adjacencyList,
        reverseAdjacencyList,
      });

      return edgeId;
    },

    // Delete edge
    deleteEdge: (edgeId: EdgeId) => {
      const state = get();
      const newEdges = new Map(state.edges);
      newEdges.delete(edgeId);

      const allEdges = Array.from(newEdges.values());
      const { adjacencyList, reverseAdjacencyList } = computeAdjacencyLists(allEdges);

      set({
        edges: newEdges,
        adjacencyList,
        reverseAdjacencyList,
      });
    },

    // Add message
    addMessage: (nodeId: NodeId, message: Omit<Message, 'id' | 'nodeId' | 'createdAt'>) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) throw new Error(`Node ${nodeId} not found`);

      const messageId = uuidv4();
      const now = Date.now();
      const lastCreatedAt = node.messages[node.messages.length - 1]?.createdAt ?? 0;
      const createdAt = now <= lastCreatedAt ? lastCreatedAt + 1 : now;
      const fullMessage: Message = {
        ...message,
        id: messageId,
        nodeId,
        createdAt,
      };

      const updatedNode: ConversationNode = {
        ...node,
        messages: [...node.messages, fullMessage],
        updatedAt: Date.now(),
      };

      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, updatedNode);
      set({ nodes: newNodes });

      return messageId;
    },

    // Update message
    updateMessage: (nodeId: NodeId, messageId: MessageId, updates: Partial<Message>) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) return;

      const updatedMessages = node.messages.map((m) =>
        m.id === messageId ? { ...m, ...updates } : m
      );

      const updatedNode: ConversationNode = {
        ...node,
        messages: updatedMessages,
        updatedAt: Date.now(),
      };

      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, updatedNode);
      set({ nodes: newNodes });
    },

    editMessage: (
      nodeId: NodeId,
      messageId: MessageId,
      content: string,
      mode: 'preserve' | 'reset'
    ) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) return;

      const messageIndex = node.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      const updatedMessages = node.messages.map((m) =>
        m.id === messageId ? { ...m, content } : m
      );

      const trimmedMessages =
        mode === 'reset' ? updatedMessages.slice(0, messageIndex + 1) : updatedMessages;

      const updatedNode: ConversationNode = {
        ...node,
        messages: trimmedMessages,
        updatedAt: Date.now(),
      };

      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, updatedNode);

      if (mode === 'preserve') {
        set({ nodes: newNodes });
        return;
      }

      const descendants = getDescendants(nodeId, state.adjacencyList);
      const nextChatDrafts = { ...state.chatDrafts };
      const nextReplyDrafts = { ...state.replyDrafts };
      if (descendants.size > 0) {
        for (const id of descendants) {
          state.cancelRequest(id);
          newNodes.delete(id);
          delete nextChatDrafts[id];
          delete nextReplyDrafts[id];
        }
      }

      const newEdges = new Map(state.edges);
      for (const [edgeId, edge] of state.edges) {
        if (descendants.has(edge.source) || descendants.has(edge.target)) {
          newEdges.delete(edgeId);
        }
      }

      const { adjacencyList, reverseAdjacencyList } = computeAdjacencyLists(
        Array.from(newEdges.values())
      );

      const activeNodeId =
        state.activeNodeId && descendants.has(state.activeNodeId)
          ? nodeId
          : state.activeNodeId;
      const activeInputNodeId =
        state.activeInputNodeId && descendants.has(state.activeInputNodeId)
          ? nodeId
          : state.activeInputNodeId;

      set({
        nodes: newNodes,
        edges: newEdges,
        adjacencyList,
        reverseAdjacencyList,
        chatDrafts: nextChatDrafts,
        replyDrafts: nextReplyDrafts,
        activeNodeId,
        activeInputNodeId,
      });
    },

    // Append to streaming message
    appendToStreamingMessage: (nodeId: NodeId, messageId: MessageId, content: string) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) return;

      const updatedMessages = node.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + content } : m
      );

      const updatedNode: ConversationNode = {
        ...node,
        messages: updatedMessages,
      };

      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, updatedNode);
      set({ nodes: newNodes });
    },

    // Delete message
    deleteMessage: (nodeId: NodeId, messageId: MessageId) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) return;

      const targetMessage = node.messages.find((m) => m.id === messageId);
      if (!targetMessage || targetMessage.isStreaming) return;

      const updatedMessages = node.messages.filter((m) => m.id !== messageId);
      if (updatedMessages.length === node.messages.length) return;

      const updatedNode: ConversationNode = {
        ...node,
        messages: updatedMessages,
        updatedAt: Date.now(),
      };

      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, updatedNode);
      set({ nodes: newNodes });
    },

    // Branch from message
    branchFromMessage: (nodeId: NodeId, messageId: MessageId) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) throw new Error(`Node ${nodeId} not found`);

      // Create new node with parent edge
      const newNodeId = state.createNode(node.conversationId, nodeId, messageId);

      // Set as active
      set({ activeNodeId: newNodeId });

      return newNodeId;
    },

    // Request management
    registerRequest: (nodeId: NodeId, abortController: AbortController) => {
      const state = get();
      const newRequests = new Map(state.activeRequests);
      newRequests.set(nodeId, {
        nodeId,
        abortController,
        startedAt: Date.now(),
      });
      set({ activeRequests: newRequests });

      // Update node status
      state.updateNode(nodeId, { status: 'streaming' });
    },

    unregisterRequest: (nodeId: NodeId) => {
      const state = get();
      const newRequests = new Map(state.activeRequests);
      newRequests.delete(nodeId);
      set({ activeRequests: newRequests });
    },

    cancelRequest: (nodeId: NodeId) => {
      const state = get();
      const request = state.activeRequests.get(nodeId);
      if (request) {
        request.abortController.abort();
        state.unregisterRequest(nodeId);
        state.updateNode(nodeId, { status: 'cancelled' });
      }
    },

    // Get computed context for a node
    getComputedContext: (nodeId: NodeId) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) {
        return { nodes: [], messages: [], tokenEstimate: 0 };
      }

      const conversation = state.conversations.get(node.conversationId);
      const systemPrompt = conversation?.systemPrompt;
      const project =
        conversation?.projectId ? state.projects.get(conversation.projectId) : null;

      return computeContext(
        nodeId,
        state.nodes,
        state.reverseAdjacencyList,
        state.adjacencyList,
        systemPrompt,
        {
          profile: state.customProfile,
          responseStyle: state.customResponseStyle,
          projectProfile: project?.customProfile,
          projectResponseStyle: project?.customResponseStyle,
        },
        conversation?.contextSettings
      );
    },

    // Check if edge can be created
    canCreateEdge: (source: NodeId, target: NodeId) => {
      const state = get();
      return !wouldCreateCycle(state.adjacencyList, source, target);
    },

    // Get active path (for chat view) - returns full path from root to leaf
    // Returns path from root to active node (skips reply nodes)
    getActivePath: () => {
      const state = get();
      if (!state.activeConversationId || !state.activeNodeId) return [];

      const conversation = state.conversations.get(state.activeConversationId);
      if (!conversation) return [];

      let target: NodeId | null = state.activeNodeId;
      while (target) {
        const node = state.nodes.get(target);
        if (!node) return [];
        if (!node.isReply) break;
        target = node.parentNodeId ?? null;
      }
      if (!target) return [];

      const path = getPathToNode(
        target,
        conversation.rootNodeId,
        state.reverseAdjacencyList
      );

      return path.filter((id) => {
        const node = state.nodes.get(id);
        return node ? !node.isReply : false;
      });
    },

    // Get branches from a node
    getBranchesFromNode: (nodeId: NodeId) => {
      const state = get();
      const childIds = state.adjacencyList[nodeId] || [];
      return childIds.filter((childId) => {
        const childNode = state.nodes.get(childId);
        return childNode ? !childNode.isReply : false;
      });
    },

    // Get reply nodes for a node (child nodes marked as replies)
    getRepliesForNode: (nodeId: NodeId) => {
      const state = get();
      const childIds = state.adjacencyList[nodeId] || [];
      const replies: ConversationNode[] = [];

      for (const childId of childIds) {
        const childNode = state.nodes.get(childId);
        if (childNode && childNode.isReply) {
          replies.push(childNode);
        }
      }

      return replies.sort((a, b) => a.createdAt - b.createdAt);
    },

    // Create a reply node (for comment threads)
    createReply: (parentNodeId: NodeId) => {
      const state = get();
      const parentNode = state.nodes.get(parentNodeId);
      if (!parentNode) throw new Error(`Parent node ${parentNodeId} not found`);

      const nodeId = uuidv4();
      const now = Date.now();

      const newNode: ConversationNode = {
        id: nodeId,
        conversationId: parentNode.conversationId,
        messages: [],
        position: { x: 0, y: 0 },
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        isCollapsed: false,
        isReply: true,
        parentNodeId: parentNodeId,
      };

      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, newNode);

      // Create edge from parent to this reply
      const edgeId = uuidv4();
      const edge: ConversationEdge = {
        id: edgeId,
        source: parentNodeId,
        target: nodeId,
        conversationId: parentNode.conversationId,
        createdAt: now,
      };

      const newEdges = new Map(state.edges);
      newEdges.set(edgeId, edge);

      // Update adjacency lists
      const allEdges = Array.from(newEdges.values());
      const { adjacencyList, reverseAdjacencyList } = computeAdjacencyLists(allEdges);

      set({
        nodes: newNodes,
        edges: newEdges,
        adjacencyList,
        reverseAdjacencyList,
      });

      return nodeId;
    },

    // UI actions
    setViewMode: (mode: ViewMode) => {
      set({ viewMode: mode });
    },

    setSelectedModel: (model: string) => {
      const state = get();
      const targetNodeId = state.activeInputNodeId ?? state.activeNodeId;
      if (!targetNodeId) {
        set({ selectedModel: model });
        return;
      }

      const node = state.nodes.get(targetNodeId);
      if (!node) {
        set({ selectedModel: model });
        return;
      }

       if (node.isReply) {
         set({ selectedModel: model });
         return;
       }

      const updatedNode: ConversationNode = {
        ...node,
        model,
        updatedAt: Date.now(),
      };

      const newNodes = new Map(state.nodes);
      newNodes.set(targetNodeId, updatedNode);

      set({ selectedModel: model, nodes: newNodes });
    },

    setActiveInputNode: (nodeId: NodeId | null) => {
      const state = get();
      if (!nodeId) {
        set({ activeInputNodeId: null });
        return;
      }

      const node = state.nodes.get(nodeId);
      if (!node) {
        set({ activeInputNodeId: nodeId });
        return;
      }

      if (node.isReply) {
        set({ activeInputNodeId: nodeId });
        return;
      }

      const conversation = state.conversations.get(node.conversationId);
      const selectedModel = node.model || conversation?.model || state.selectedModel;

      set({ activeInputNodeId: nodeId, selectedModel });
    },

    setApiKey: (key: string) => {
      localStorage.setItem('openrouter-api-key', key);
      set({ apiKey: key });
      void get().loadModels();
    },

    setApiBaseUrl: (url: string) => {
      const normalized = url.trim().replace(/\/$/, '');
      localStorage.setItem('openrouter-api-base-url', normalized);
      set({ apiBaseUrl: normalized });
      void get().loadModels();
    },

    setFlowMode: (conversationId: ConversationId, enabled: boolean) => {
      const state = get();
      const conversation = state.conversations.get(conversationId);
      if (!conversation) return;

      if (!enabled) {
        state.updateConversation(conversationId, { flowMode: false });
        return;
      }

      let rootNodeId = state.activeNodeId ?? conversation.rootNodeId;
      if (state.nodes.get(rootNodeId)?.conversationId !== conversationId) {
        rootNodeId = conversation.rootNodeId;
      }

      let node = state.nodes.get(rootNodeId);
      while (node?.isReply && node.parentNodeId) {
        rootNodeId = node.parentNodeId;
        node = state.nodes.get(rootNodeId);
      }

      state.updateConversation(conversationId, {
        flowMode: true,
        flowRootNodeId: rootNodeId,
        flowNodeIds: [],
      });
    },

    connectFlowNodes: (conversationId: ConversationId) => {
      const state = get();
      const conversation = state.conversations.get(conversationId);
      if (!conversation) return;

      const flowRootNodeId = conversation.flowRootNodeId;
      const flowNodeIds = conversation.flowNodeIds ?? [];
      if (!flowRootNodeId || flowNodeIds.length === 0) {
        state.updateConversation(conversationId, {
          flowNodeIds: [],
          flowRootNodeId: undefined,
        });
        return;
      }

      const flowNodes = flowNodeIds
        .map((id) => state.nodes.get(id))
        .filter((node): node is ConversationNode => Boolean(node))
        .sort((a, b) => a.createdAt - b.createdAt);

      if (flowNodes.length === 0) {
        state.updateConversation(conversationId, {
          flowNodeIds: [],
          flowRootNodeId: undefined,
        });
        return;
      }

      const newEdges = new Map(state.edges);
      for (const [edgeId, edge] of newEdges) {
        if (edge.conversationId !== conversationId) continue;
        if (edge.source === flowRootNodeId && flowNodeIds.includes(edge.target)) {
          newEdges.delete(edgeId);
        }
      }

      let { adjacencyList, reverseAdjacencyList } = computeAdjacencyLists(
        Array.from(newEdges.values())
      );

      let previousId = flowRootNodeId;
      for (const node of flowNodes) {
        if (previousId === node.id) continue;
        const existing = adjacencyList[previousId]?.includes(node.id);
        if (!existing && !wouldCreateCycle(adjacencyList, previousId, node.id)) {
          const edgeId = uuidv4();
          newEdges.set(edgeId, {
            id: edgeId,
            source: previousId,
            target: node.id,
            conversationId,
            createdAt: Date.now(),
          });
          const updated = computeAdjacencyLists(Array.from(newEdges.values()));
          adjacencyList = updated.adjacencyList;
          reverseAdjacencyList = updated.reverseAdjacencyList;
        }
        previousId = node.id;
      }

      set({ edges: newEdges, adjacencyList, reverseAdjacencyList });
      state.updateConversation(conversationId, {
        flowNodeIds: [],
        flowRootNodeId: undefined,
      });
    },

    setChatDraft: (
      nodeId: NodeId,
      draft: { content: string; attachments: PendingAttachment[] }
    ) => {
      const state = get();
      const previous = state.chatDrafts[nodeId];
      const isEmptyDraft = !draft.content && draft.attachments.length === 0;

      if (previous) {
        if (
          previous.content === draft.content &&
          arePendingAttachmentsEqual(previous.attachments, draft.attachments)
        ) {
          return;
        }
        if (isEmptyDraft) {
          const next = { ...state.chatDrafts };
          delete next[nodeId];
          set({ chatDrafts: next });
          return;
        }
      } else if (isEmptyDraft) {
        return;
      }

      set({
        chatDrafts: {
          ...state.chatDrafts,
          [nodeId]: {
            content: draft.content,
            attachments: draft.attachments,
          },
        },
      });
    },

    clearChatDraft: (nodeId: NodeId) => {
      const state = get();
      if (!(nodeId in state.chatDrafts)) return;
      const next = { ...state.chatDrafts };
      delete next[nodeId];
      set({ chatDrafts: next });
    },

    setReplyDraft: (parentNodeId: NodeId, content: string) => {
      const state = get();
      if (state.replyDrafts[parentNodeId] === content) return;
      if (!content) {
        if (!(parentNodeId in state.replyDrafts)) return;
        const next = { ...state.replyDrafts };
        delete next[parentNodeId];
        set({ replyDrafts: next });
        return;
      }
      set({
        replyDrafts: {
          ...state.replyDrafts,
          [parentNodeId]: content,
        },
      });
    },

    clearReplyDraft: (parentNodeId: NodeId) => {
      const state = get();
      if (!(parentNodeId in state.replyDrafts)) return;
      const next = { ...state.replyDrafts };
      delete next[parentNodeId];
      set({ replyDrafts: next });
    },

    setCustomProfile: (value: string) => {
      localStorage.setItem(CUSTOM_PROFILE_KEY, value);
      set({ customProfile: value });
    },

    setCustomResponseStyle: (value: string) => {
      localStorage.setItem(CUSTOM_RESPONSE_STYLE_KEY, value);
      set({ customResponseStyle: value });
    },

    setAutoTitleEnabled: (value: boolean) => {
      const state = get();
      localStorage.setItem(AUTO_TITLE_ENABLED_KEY, String(value));
      if (value && !state.autoTitleModel) {
        const fallbackModel = state.selectedModel || 'openai/gpt-4-turbo';
        localStorage.setItem(AUTO_TITLE_MODEL_KEY, fallbackModel);
        set({ autoTitleEnabled: value, autoTitleModel: fallbackModel });
        return;
      }
      set({ autoTitleEnabled: value });
    },

    setAutoTitleModel: (value: string) => {
      localStorage.setItem(AUTO_TITLE_MODEL_KEY, value);
      set({ autoTitleModel: value });
    },

    setEmbeddingModel: (value: string) => {
      const state = get();
      if (state.embeddingModel === value) return;
      localStorage.setItem(EMBEDDING_MODEL_KEY, value);
      const now = Date.now();
      const nextConversations = new Map(state.conversations);
      for (const [conversationId, conversation] of state.conversations.entries()) {
        nextConversations.set(conversationId, {
          ...conversation,
          ragReindexRequestedAt: now,
          ragRebuildInProgress: false,
          updatedAt: now,
        });
      }
      set({
        embeddingModel: value,
        conversations: nextConversations,
      });
    },

    setToolSettings: (value: ToolSettings) => {
      const normalized = normalizeToolSettings(value);
      localStorage.setItem(TOOL_SETTINGS_KEY, JSON.stringify(normalized));
      set({ toolSettings: normalized });
    },

    setMemorySettings: (value: MemorySettings) => {
      const normalized = normalizeMemorySettings(value);
      localStorage.setItem(MEMORY_SETTINGS_KEY, JSON.stringify(normalized));
      set({ memorySettings: normalized });
    },

    setReplyThreadFocusNodeId: (value: NodeId | null) => {
      set({ replyThreadFocusNodeId: value });
    },

    setHighlightedMessage: (messageId: MessageId | null, query?: string | null) => {
      set({
        highlightedMessageId: messageId,
        highlightedQuery: query ?? null,
      });
    },

    setTheme: (theme: 'light' | 'dark') => {
      localStorage.setItem(THEME_KEY, theme);
      set({ theme });
    },

    updateNodePosition: (nodeId: NodeId, position: { x: number; y: number }) => {
      const state = get();
      const node = state.nodes.get(nodeId);
      if (!node) return;

      const updated = { ...node, position };
      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, updated);
      set({ nodes: newNodes });
    },

    autoLayoutNodes: () => {
      const state = get();
      if (!state.activeConversationId) return;

      const conversationNodes = Array.from(state.nodes.values()).filter(
        (n) => n.conversationId === state.activeConversationId
      );
      const conversationEdges = Array.from(state.edges.values()).filter(
        (e) => e.conversationId === state.activeConversationId
      );

      const layoutedNodes = layoutNodes(conversationNodes, conversationEdges);

      const newNodes = new Map(state.nodes);
      for (const node of layoutedNodes) {
        newNodes.set(node.id, node);
      }

      // Update adjacency lists
      const { adjacencyList, reverseAdjacencyList } = computeAdjacencyLists(conversationEdges);

      set({
        nodes: newNodes,
        adjacencyList,
        reverseAdjacencyList,
      });
    },

    addToolTrace: (entry) => {
      const state = get();
      const id = uuidv4();
      const startedAt = Date.now();
      const nextEntry: ToolTraceEntry = {
        id,
        status: 'started',
        startedAt,
        ...entry,
      };
      const existing = state.toolTraceByConversation[entry.conversationId] || [];
      const capped = [...existing, nextEntry].slice(-200);
      set({
        toolTraceByConversation: {
          ...state.toolTraceByConversation,
          [entry.conversationId]: capped,
        },
      });
      return id;
    },

    updateToolTrace: (conversationId, traceId, updates) => {
      const state = get();
      const traces = state.toolTraceByConversation[conversationId];
      if (!traces || traces.length === 0) return;
      let changed = false;
      const next = traces.map((trace) => {
        if (trace.id !== traceId) return trace;
        changed = true;
        return { ...trace, ...updates };
      });
      if (!changed) return;
      set({
        toolTraceByConversation: {
          ...state.toolTraceByConversation,
          [conversationId]: next,
        },
      });
    },

    clearToolTrace: (conversationId) => {
      const state = get();
      if (!state.toolTraceByConversation[conversationId]) return;
      const next = { ...state.toolTraceByConversation };
      delete next[conversationId];
      set({ toolTraceByConversation: next });
    },

    setMemoryRetrievalPreview: (conversationId, preview) => {
      const state = get();
      if (preview === null) {
        if (!state.memoryRetrievalByConversation[conversationId]) return;
        const next = { ...state.memoryRetrievalByConversation };
        delete next[conversationId];
        set({ memoryRetrievalByConversation: next });
        return;
      }
      set({
        memoryRetrievalByConversation: {
          ...state.memoryRetrievalByConversation,
          [conversationId]: preview,
        },
      });
    },

    addToast: (toast) => {
      const id = uuidv4();
      const nextToast: Toast = {
        ...toast,
        id,
        createdAt: Date.now(),
      };
      const state = get();
      set({ toasts: [...state.toasts, nextToast] });
      return id;
    },

    removeToast: (id: string) => {
      const state = get();
      set({ toasts: state.toasts.filter((toast) => toast.id !== id) });
    },

    clearToasts: () => {
      set({ toasts: [] });
    },

    registerFileHandle: async (record: StoredFileHandle) => {
      const state = get();
      const nextHandles = new Map(state.fileHandles);
      nextHandles.set(record.id, record.handle);
      set({ fileHandles: nextHandles });
      try {
        await db.saveFileHandle(record);
      } catch (error) {
        console.warn('Failed to persist file handle:', error);
      }
    },

    getFileHandle: (id: string) => {
      const state = get();
      return state.fileHandles.get(id) || null;
    },

    deleteFileHandle: async (id: string) => {
      const state = get();
      const nextHandles = new Map(state.fileHandles);
      nextHandles.delete(id);
      set({ fileHandles: nextHandles });
      try {
        await db.deleteFileHandle(id);
      } catch (error) {
        console.warn('Failed to delete file handle:', error);
      }
    },

    // Persist conversation
    persistConversation: async (conversationId: ConversationId) => {
      const state = get();
      const conversation = state.conversations.get(conversationId);
      if (!conversation) return;

      const nodes = Array.from(state.nodes.values()).filter(
        (n) => n.conversationId === conversationId
      );
      const edges = Array.from(state.edges.values()).filter(
        (e) => e.conversationId === conversationId
      );

      await db.saveConversation(conversation, nodes, edges);
    },
  }))
);

// Auto-persist on changes (debounced)
let persistTimeout: ReturnType<typeof setTimeout> | null = null;

useStore.subscribe(
  (state) => [state.nodes, state.edges, state.conversations],
  () => {
    const state = useStore.getState();
    if (!state.activeConversationId || !state.isInitialized) return;

    if (persistTimeout) clearTimeout(persistTimeout);
    persistTimeout = setTimeout(() => {
      state.persistConversation(state.activeConversationId!);
    }, 1000);
  }
);

useStore.subscribe(
  (state) => [state.chatDrafts, state.replyDrafts],
  ([chatDrafts, replyDrafts]) => {
    const serializableChatDrafts: Record<
      string,
      { content: string; attachments: PendingAttachment[] }
    > = {};

    for (const [nodeId, draft] of Object.entries(chatDrafts)) {
      const content = draft?.content || '';
      const attachments = sanitizeDraftAttachments(draft?.attachments || []);
      if (!content && attachments.length === 0) continue;
      serializableChatDrafts[nodeId] = { content, attachments };
    }

    localStorage.setItem(CHAT_DRAFTS_KEY, JSON.stringify(serializableChatDrafts));
    localStorage.setItem(REPLY_DRAFTS_KEY, JSON.stringify(replyDrafts));
  }
);
