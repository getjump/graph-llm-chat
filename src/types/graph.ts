// Unique identifiers
export type NodeId = string;
export type EdgeId = string;
export type MessageId = string;
export type ConversationId = string;
export type ProjectId = string;
export type RagScopeType = 'conversation' | 'project';
export type MemoryScopeType = 'conversation' | 'project' | 'user';

// Message role - standard LLM convention
export type MessageRole = 'user' | 'assistant' | 'system';

export type AttachmentSource = 'handle' | 'memory';

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  source: AttachmentSource;
  handleId?: string;
}

export interface PendingAttachment extends FileAttachment {
  file?: File;
}

// Individual message within a node
export interface Message {
  id: MessageId;
  nodeId: NodeId;
  role: MessageRole;
  content: string;
  createdAt: number;
  isStreaming: boolean;
  model?: string;
  tokenCount?: number;
  finishReason?: string;
  attachments?: FileAttachment[];
  isAttachmentContext?: boolean;
  isCustomInstruction?: boolean;
  isProjectInstruction?: boolean;
  isProjectAttachmentContext?: boolean;
}

// Status of a conversation node
export type NodeStatus = 'idle' | 'streaming' | 'error' | 'cancelled';

// A conversation node in the graph
export interface ConversationNode {
  id: NodeId;
  conversationId: ConversationId;
  messages: Message[];
  position: { x: number; y: number };
  status: NodeStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
  isCollapsed: boolean;
  label?: string;
  branchedFromMessageId?: MessageId;
  isReply?: boolean; // True if this node is a reply/comment thread
  parentNodeId?: NodeId; // Canonical parent in the active thread path
  model?: string;
  contextSummary?: {
    content: string;
    createdAt: number;
  };
}

// Edge connecting two nodes (parent -> child)
export interface ConversationEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  conversationId: ConversationId;
  createdAt: number;
}

// Conversation container
export interface Conversation {
  id: ConversationId;
  title: string;
  rootNodeId: NodeId;
  systemPrompt?: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  autoTitleApplied?: boolean;
  projectId?: ProjectId;
  contextSettings?: ContextSettings;
  attachmentProcessing?: AttachmentProcessingSettings;
  ragReindexRequestedAt?: number;
  ragRebuildInProgress?: boolean;
  flowMode?: boolean;
  flowRootNodeId?: NodeId;
  flowNodeIds?: NodeId[];
}

// Model information from OpenRouter
export interface LLMModel {
  id: string;
  name: string;
  contextLength: number;
  pricing: {
    prompt: number;
    completion: number;
  };
  supportedParameters?: string[];
  supportsReasoning?: boolean;
}

export interface ContextSettings {
  excludedNodeIds?: NodeId[];
  includeSystemPrompt?: boolean;
  includeCustomInstructions?: boolean;
  includeProjectInstructions?: boolean;
  includeAttachmentContext?: boolean;
  includeProjectAttachmentContext?: boolean;
}

export type MemoryCategory = 'fact' | 'preference' | 'constraint' | 'context';

export interface MemoryItem {
  id: string;
  scopeType: MemoryScopeType;
  scopeId: string;
  text: string;
  normalizedText: string;
  category: MemoryCategory;
  confidence: number;
  pinned: boolean;
  sourceConversationId?: ConversationId;
  sourceNodeId?: NodeId;
  sourceMessageId?: MessageId;
  sourceRole?: MessageRole;
  embedding?: number[];
  embeddingModel?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface MemorySettings {
  enabled?: boolean;
  includeConversation?: boolean;
  includeProject?: boolean;
  includeUser?: boolean;
  autoExtractUser?: boolean;
  autoExtractAssistant?: boolean;
  maxPerMessage?: number;
  maxRetrieved?: number;
  minConfidence?: number;
}

export interface NormalizedMemorySettings {
  enabled: boolean;
  includeConversation: boolean;
  includeProject: boolean;
  includeUser: boolean;
  autoExtractUser: boolean;
  autoExtractAssistant: boolean;
  maxPerMessage: number;
  maxRetrieved: number;
  minConfidence: number;
}

export interface RetrievedMemoryItem {
  id: string;
  text: string;
  scopeType: MemoryScopeType;
  category: MemoryCategory;
  confidence: number;
  score: number;
  pinned: boolean;
}

export interface MemoryRetrievalPreview {
  query: string;
  embeddingModel: string;
  generatedAt: number;
  items: RetrievedMemoryItem[];
  content: string;
}

export interface AttachmentProcessingSettings {
  mode?: 'retrieval' | 'summarize';
  retrievalTopK?: number;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface ToolSettings {
  enabled?: boolean;
  maxSteps?: number;
  showEvents?: boolean;
  permissions?: {
    requireConfirmation?: boolean;
    sensitiveTools?: string[];
  };
  datetimeNow?: {
    enabled?: boolean;
  };
  calculator?: {
    enabled?: boolean;
    maxExpressionLength?: number;
  };
  searchMessages?: {
    enabled?: boolean;
    maxResults?: number;
  };
  searchContextChunks?: {
    enabled?: boolean;
    maxResults?: number;
  };
  attachmentReader?: {
    enabled?: boolean;
    maxCharsPerRead?: number;
  };
  daytona?: {
    enabled?: boolean;
    apiKey?: string;
    apiUrl?: string;
    target?: string;
    sandboxId?: string;
    defaultLanguage?: 'typescript' | 'javascript' | 'python' | 'go' | 'rust';
    autoCreateSandbox?: boolean;
    autoDeleteCreatedSandbox?: boolean;
    defaultTimeoutSeconds?: number;
    maxStdoutChars?: number;
    maxStderrChars?: number;
  };
  mcpServers?: Array<{
    id?: string;
    name?: string;
    enabled?: boolean;
    url?: string;
    transport?: 'http' | 'sse';
    authToken?: string;
    enabledTools?: string[];
  }>;
  mcp?: {
    enabled?: boolean;
    url?: string;
    transport?: 'http' | 'sse';
    authToken?: string;
    enabledTools?: string[];
    servers?: Array<{
      id?: string;
      name?: string;
      enabled?: boolean;
      url?: string;
      transport?: 'http' | 'sse';
      authToken?: string;
      enabledTools?: string[];
    }>;
  };
}

export interface McpServerSettings {
  id: string;
  name: string;
  enabled: boolean;
  url: string;
  transport: 'http' | 'sse';
  authToken: string;
  enabledTools: string[];
}

export interface NormalizedToolSettings {
  enabled: boolean;
  maxSteps: number;
  showEvents: boolean;
  permissions: {
    requireConfirmation: boolean;
    sensitiveTools: string[];
  };
  datetimeNow: {
    enabled: boolean;
  };
  calculator: {
    enabled: boolean;
    maxExpressionLength: number;
  };
  searchMessages: {
    enabled: boolean;
    maxResults: number;
  };
  searchContextChunks: {
    enabled: boolean;
    maxResults: number;
  };
  attachmentReader: {
    enabled: boolean;
    maxCharsPerRead: number;
  };
  daytona: {
    enabled: boolean;
    apiKey: string;
    apiUrl: string;
    target: string;
    sandboxId: string;
    defaultLanguage: 'typescript' | 'javascript' | 'python' | 'go' | 'rust';
    autoCreateSandbox: boolean;
    autoDeleteCreatedSandbox: boolean;
    defaultTimeoutSeconds: number;
    maxStdoutChars: number;
    maxStderrChars: number;
  };
  mcp: {
    enabled: boolean;
    servers: McpServerSettings[];
  };
}

export type ToolTraceStatus = 'started' | 'succeeded' | 'failed' | 'denied';

export interface ToolTraceEntry {
  id: string;
  conversationId: ConversationId;
  nodeId: NodeId;
  toolCallId?: string;
  toolName: string;
  source: 'local' | 'mcp';
  status: ToolTraceStatus;
  inputPreview?: string;
  outputPreview?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
}

export interface Project {
  id: ProjectId;
  name: string;
  description?: string;
  customProfile?: string;
  customResponseStyle?: string;
  attachments?: FileAttachment[];
  createdAt: number;
  updatedAt: number;
}

export interface MessageSearchResult {
  messageId: MessageId;
  nodeId: NodeId;
  conversationId: ConversationId;
  projectId?: ProjectId;
  role: MessageRole;
  content: string;
  createdAt: number;
  conversationTitle: string;
  projectName?: string;
  isReply?: boolean;
  parentNodeId?: NodeId;
}

// API request tracking for parallel requests
export interface ActiveRequest {
  nodeId: NodeId;
  abortController: AbortController;
  startedAt: number;
}

// Adjacency list for graph algorithms
export interface AdjacencyList {
  [nodeId: NodeId]: NodeId[];
}

// Reverse adjacency list (for ancestor traversal)
export interface ReverseAdjacencyList {
  [nodeId: NodeId]: NodeId[];
}

// Result of context computation
export interface ComputedContext {
  nodes: ConversationNode[];
  messages: Message[];
  tokenEstimate: number;
}

// Result of cycle detection
export interface CycleCheckResult {
  hasCycle: boolean;
  cycleNodes?: NodeId[];
}

// View mode
export type ViewMode = 'chat' | 'graph' | 'context';

export interface StoredFileHandle {
  id: string;
  handle: FileSystemFileHandle;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  createdAt: number;
}

export type ToastType = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  createdAt: number;
}

// Settings stored in localStorage
export interface AppSettings {
  apiKey: string;
  defaultModel: string;
  theme: 'light' | 'dark' | 'system';
}

export interface RagChunk {
  id: string;
  scopeType: RagScopeType;
  scopeId: string;
  sourceKey: string;
  attachmentId: string;
  attachmentName: string;
  chunkIndex: number;
  chunkText: string;
  chunkTokenEstimate: number;
  embedding?: number[];
  embeddingModel?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RagScopeStats {
  chunkCount: number;
  sourceCount: number;
  latestUpdatedAt: number | null;
}
