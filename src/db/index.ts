import Dexie, { type Table } from 'dexie';
import type {
  Conversation,
  ConversationNode,
  ConversationEdge,
  Message,
  ConversationId,
  NodeId,
  StoredFileHandle,
  Project,
  ProjectId,
  MessageSearchResult,
  RagChunk,
  RagScopeType,
  RagScopeStats,
  MemoryItem,
  MemoryScopeType,
} from '../types';

class GraphChatDB extends Dexie {
  conversations!: Table<Conversation, ConversationId>;
  nodes!: Table<ConversationNode, NodeId>;
  edges!: Table<ConversationEdge, string>;
  messages!: Table<Message, string>;
  fileHandles!: Table<StoredFileHandle, string>;
  projects!: Table<Project, ProjectId>;
  ragChunks!: Table<RagChunk, string>;
  memories!: Table<MemoryItem, string>;

  constructor() {
    super('GraphChatDB');

    this.version(1).stores({
      conversations: 'id, createdAt, updatedAt',
      nodes: 'id, conversationId, createdAt, [conversationId+createdAt]',
      edges: 'id, conversationId, source, target, [source+target]',
      messages: 'id, nodeId, createdAt, [nodeId+createdAt]',
    });

    this.version(2).stores({
      conversations: 'id, createdAt, updatedAt',
      nodes: 'id, conversationId, createdAt, [conversationId+createdAt]',
      edges: 'id, conversationId, source, target, [source+target]',
      messages: 'id, nodeId, createdAt, [nodeId+createdAt]',
      fileHandles: 'id, createdAt',
    });

    this.version(3).stores({
      conversations: 'id, createdAt, updatedAt',
      nodes: 'id, conversationId, createdAt, [conversationId+createdAt]',
      edges: 'id, conversationId, source, target, [source+target]',
      messages: 'id, nodeId, createdAt, [nodeId+createdAt]',
      fileHandles: 'id, createdAt',
      projects: 'id, createdAt, updatedAt',
    });

    this.version(4).stores({
      conversations: 'id, createdAt, updatedAt',
      nodes: 'id, conversationId, createdAt, [conversationId+createdAt]',
      edges: 'id, conversationId, source, target, [source+target]',
      messages: 'id, nodeId, createdAt, [nodeId+createdAt]',
      fileHandles: 'id, createdAt',
      projects: 'id, createdAt, updatedAt',
      ragChunks:
        'id, [scopeType+scopeId], [scopeType+scopeId+sourceKey], sourceKey, updatedAt',
    });

    this.version(5).stores({
      conversations: 'id, createdAt, updatedAt',
      nodes: 'id, conversationId, createdAt, [conversationId+createdAt]',
      edges: 'id, conversationId, source, target, [source+target]',
      messages: 'id, nodeId, createdAt, [nodeId+createdAt]',
      fileHandles: 'id, createdAt',
      projects: 'id, createdAt, updatedAt',
      ragChunks:
        'id, [scopeType+scopeId], [scopeType+scopeId+sourceKey], sourceKey, updatedAt',
      memories:
        'id, [scopeType+scopeId], [scopeType+scopeId+normalizedText], updatedAt, pinned',
    });
  }
}

export const db = new GraphChatDB();

// Load a full conversation with all its data
export async function loadConversation(id: ConversationId) {
  const conversation = await db.conversations.get(id);
  if (!conversation) return null;

  const nodes = await db.nodes.where('conversationId').equals(id).toArray();
  const edges = (await db.edges.where('conversationId').equals(id).toArray()).sort(
    (a, b) => (a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id.localeCompare(b.id))
  );
  const nodeIds = nodes.map((n) => n.id);
  const messages =
    nodeIds.length > 0
      ? await db.messages.where('nodeId').anyOf(nodeIds).toArray()
      : [];

  // Attach messages to nodes
  const messagesByNode = new Map<NodeId, Message[]>();
  for (const msg of messages) {
    const existing = messagesByNode.get(msg.nodeId) || [];
    existing.push(msg);
    messagesByNode.set(msg.nodeId, existing);
  }

  const nodesWithMessages = nodes.map((node) => ({
    ...node,
    messages: normalizeMessageOrder(
      (messagesByNode.get(node.id) || []).sort((a, b) => a.createdAt - b.createdAt)
    ),
  }));

  return { conversation, nodes: nodesWithMessages, edges };
}

function normalizeMessageOrder(messages: Message[]) {
  if (messages.length === 0) return messages;
  const normalized: Message[] = [];
  let lastCreatedAt = 0;

  for (const message of messages) {
    let createdAt = message.createdAt;
    if (createdAt <= lastCreatedAt) {
      createdAt = lastCreatedAt + 1;
    }
    normalized.push(
      createdAt === message.createdAt ? message : { ...message, createdAt }
    );
    lastCreatedAt = createdAt;
  }

  return normalized;
}

// Load all conversations (metadata only)
export async function loadAllConversations() {
  return db.conversations.orderBy('updatedAt').reverse().toArray();
}

export async function loadAllProjects() {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

// Save a conversation with all its data
export async function saveConversation(
  conversation: Conversation,
  nodes: ConversationNode[],
  edges: ConversationEdge[]
) {
  const messages = nodes.flatMap((n) => n.messages);
  const existingNodeIds = await db.nodes
    .where('conversationId')
    .equals(conversation.id)
    .primaryKeys();

  await db.transaction(
    'rw',
    [db.conversations, db.nodes, db.edges, db.messages],
    async () => {
      await db.conversations.put(conversation);
      if (existingNodeIds.length > 0) {
        await db.messages.where('nodeId').anyOf(existingNodeIds as string[]).delete();
      }
      await db.nodes.where('conversationId').equals(conversation.id).delete();
      await db.edges.where('conversationId').equals(conversation.id).delete();
      await db.nodes.bulkPut(nodes);
      await db.edges.bulkPut(edges);
      if (messages.length > 0) {
        await db.messages.bulkPut(messages);
      }
    }
  );
}

// Delete a conversation and all its data
export async function deleteConversation(id: ConversationId) {
  const nodes = await db.nodes.where('conversationId').equals(id).toArray();
  const nodeIds = nodes.map((n) => n.id);

  await db.transaction(
    'rw',
    [db.conversations, db.nodes, db.edges, db.messages],
    async () => {
      await db.conversations.delete(id);
      await db.nodes.where('conversationId').equals(id).delete();
      await db.edges.where('conversationId').equals(id).delete();
      if (nodeIds.length > 0) {
        await db.messages.where('nodeId').anyOf(nodeIds).delete();
      }
    }
  );
}

export async function saveProject(project: Project) {
  await db.projects.put(project);
}

export async function deleteProject(id: ProjectId) {
  await db.projects.delete(id);
}

export async function saveRagChunks(chunks: RagChunk[]) {
  if (chunks.length === 0) return;
  await db.ragChunks.bulkPut(chunks);
}

export async function loadRagChunksForScope(scopeType: RagScopeType, scopeId: string) {
  return db.ragChunks.where('[scopeType+scopeId]').equals([scopeType, scopeId]).toArray();
}

export async function loadRagChunksForSource(
  scopeType: RagScopeType,
  scopeId: string,
  sourceKey: string
) {
  return db.ragChunks
    .where('[scopeType+scopeId+sourceKey]')
    .equals([scopeType, scopeId, sourceKey])
    .toArray();
}

export async function deleteRagChunksForScope(scopeType: RagScopeType, scopeId: string) {
  await db.ragChunks.where('[scopeType+scopeId]').equals([scopeType, scopeId]).delete();
}

export async function deleteRagChunksForSource(
  scopeType: RagScopeType,
  scopeId: string,
  sourceKey: string
) {
  await db.ragChunks
    .where('[scopeType+scopeId+sourceKey]')
    .equals([scopeType, scopeId, sourceKey])
    .delete();
}

export async function loadRagScopeStats(
  scopeType: RagScopeType,
  scopeId: string
): Promise<RagScopeStats> {
  const rows = await loadRagChunksForScope(scopeType, scopeId);
  if (rows.length === 0) {
    return { chunkCount: 0, sourceCount: 0, latestUpdatedAt: null };
  }

  const sources = new Set(rows.map((row) => row.sourceKey));
  const latestUpdatedAt = rows.reduce(
    (max, row) => (row.updatedAt > max ? row.updatedAt : max),
    rows[0].updatedAt
  );

  return {
    chunkCount: rows.length,
    sourceCount: sources.size,
    latestUpdatedAt,
  };
}

export async function hasRagChunksForScope(scopeType: RagScopeType, scopeId: string) {
  const count = await db.ragChunks.where('[scopeType+scopeId]').equals([scopeType, scopeId]).count();
  return count > 0;
}

export async function loadMemoriesForScope(scopeType: MemoryScopeType, scopeId: string) {
  const rows = await db.memories.where('[scopeType+scopeId]').equals([scopeType, scopeId]).toArray();
  return rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
    return b.updatedAt - a.updatedAt;
  });
}

export async function findMemoryByNormalizedText(
  scopeType: MemoryScopeType,
  scopeId: string,
  normalizedText: string
) {
  return db.memories
    .where('[scopeType+scopeId+normalizedText]')
    .equals([scopeType, scopeId, normalizedText])
    .first();
}

export async function saveMemory(memory: MemoryItem) {
  await db.memories.put(memory);
}

export async function saveMemories(memories: MemoryItem[]) {
  if (memories.length === 0) return;
  await db.memories.bulkPut(memories);
}

export async function updateMemory(
  id: string,
  updates: Partial<Omit<MemoryItem, 'id' | 'scopeType' | 'scopeId' | 'createdAt'>>
) {
  await db.memories.update(id, updates);
}

export async function deleteMemory(id: string) {
  await db.memories.delete(id);
}

export async function clearMemoriesForScope(scopeType: MemoryScopeType, scopeId: string) {
  await db.memories.where('[scopeType+scopeId]').equals([scopeType, scopeId]).delete();
}

export interface RagScopeEmbeddingStats {
  chunkCount: number;
  sourceCount: number;
  matchingEmbeddingChunks: number;
  matchingEmbeddingSources: number;
  staleEmbeddingChunks: number;
}

export async function loadRagScopeEmbeddingStats(
  scopeType: RagScopeType,
  scopeId: string,
  embeddingModel: string
): Promise<RagScopeEmbeddingStats> {
  const rows = await loadRagChunksForScope(scopeType, scopeId);
  if (rows.length === 0) {
    return {
      chunkCount: 0,
      sourceCount: 0,
      matchingEmbeddingChunks: 0,
      matchingEmbeddingSources: 0,
      staleEmbeddingChunks: 0,
    };
  }

  const sources = new Set<string>();
  const matchingSources = new Set<string>();
  let matchingEmbeddingChunks = 0;
  let staleEmbeddingChunks = 0;

  for (const row of rows) {
    sources.add(row.sourceKey);
    if (row.embeddingModel === embeddingModel) {
      matchingEmbeddingChunks += 1;
      matchingSources.add(row.sourceKey);
      continue;
    }
    if (Array.isArray(row.embedding) && row.embedding.length > 0) {
      staleEmbeddingChunks += 1;
    }
  }

  return {
    chunkCount: rows.length,
    sourceCount: sources.size,
    matchingEmbeddingChunks,
    matchingEmbeddingSources: matchingSources.size,
    staleEmbeddingChunks,
  };
}

export async function searchMessages(
  query: string,
  limit = 100
): Promise<MessageSearchResult[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const [messages, nodes, conversations, projects] = await Promise.all([
    db.messages.toArray(),
    db.nodes.toArray(),
    db.conversations.toArray(),
    db.projects.toArray(),
  ]);

  const nodesById = new Map<NodeId, ConversationNode>();
  for (const node of nodes) {
    nodesById.set(node.id, node);
  }

  const conversationsById = new Map<ConversationId, Conversation>();
  for (const conversation of conversations) {
    conversationsById.set(conversation.id, conversation);
  }

  const projectsById = new Map<ProjectId, Project>();
  for (const project of projects) {
    projectsById.set(project.id, project);
  }

  const results: MessageSearchResult[] = [];

  for (const message of messages) {
    if (!message.content) continue;
    if (!message.content.toLowerCase().includes(normalized)) continue;

    const node = nodesById.get(message.nodeId);
    if (!node) continue;

    const conversation = conversationsById.get(node.conversationId);
    if (!conversation) continue;

    const projectId = conversation.projectId;
    const project = projectId ? projectsById.get(projectId) : null;

    results.push({
      messageId: message.id,
      nodeId: message.nodeId,
      conversationId: conversation.id,
      projectId: projectId ?? undefined,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      conversationTitle: conversation.title,
      projectName: project?.name,
      isReply: node.isReply,
      parentNodeId: node.parentNodeId,
    });
  }

  results.sort((a, b) => b.createdAt - a.createdAt);
  return results.slice(0, limit);
}

// Update a single node
export async function updateNode(node: ConversationNode) {
  await db.transaction('rw', [db.nodes, db.messages], async () => {
    await db.nodes.put(node);
    if (node.messages.length > 0) {
      await db.messages.bulkPut(node.messages);
    }
  });
}

// Add a new edge
export async function addEdge(edge: ConversationEdge) {
  await db.edges.put(edge);
}

// Delete an edge
export async function deleteEdge(edgeId: string) {
  await db.edges.delete(edgeId);
}

export async function saveFileHandle(record: StoredFileHandle) {
  await db.fileHandles.put(record);
}

export async function loadAllFileHandles() {
  return db.fileHandles.toArray();
}

export async function getFileHandle(id: string) {
  return db.fileHandles.get(id);
}

export async function deleteFileHandle(id: string) {
  await db.fileHandles.delete(id);
}
