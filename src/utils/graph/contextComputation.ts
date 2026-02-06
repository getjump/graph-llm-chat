import type {
  NodeId,
  ConversationNode,
  Message,
  AdjacencyList,
  ReverseAdjacencyList,
  ComputedContext,
} from '../../types';
import { topologicalSort } from './topologicalSort';

/**
 * Computes the full context for a node by collecting all ancestors
 * Returns messages in correct topological order
 *
 * The context includes:
 * 1. All ancestor nodes (reachable via reverse edges)
 * 2. Messages from those nodes in topological order
 * 3. The current node's messages
 */
export function computeContext(
  nodeId: NodeId,
  nodesMap: Map<NodeId, ConversationNode>,
  reverseAdjacencyList: ReverseAdjacencyList,
  adjacencyList: AdjacencyList,
  systemPrompt?: string,
  customInstructions?: {
    profile?: string;
    responseStyle?: string;
    projectProfile?: string;
    projectResponseStyle?: string;
  },
  contextSettings?: {
    excludedNodeIds?: NodeId[];
    includeSystemPrompt?: boolean;
    includeCustomInstructions?: boolean;
    includeProjectInstructions?: boolean;
    includeAttachmentContext?: boolean;
    includeProjectAttachmentContext?: boolean;
  }
): ComputedContext {
  const excludeNodes = new Set(contextSettings?.excludedNodeIds || []);
  const includeSystemPrompt = contextSettings?.includeSystemPrompt ?? true;
  const includeCustomInstructions = contextSettings?.includeCustomInstructions ?? true;
  const includeProjectInstructions = contextSettings?.includeProjectInstructions ?? true;
  const includeAttachmentContext = contextSettings?.includeAttachmentContext ?? true;
  const includeProjectAttachmentContext =
    contextSettings?.includeProjectAttachmentContext ?? true;

  // Step 1: Collect all ancestor nodes using BFS on reverse adjacency
  const ancestors = new Set<NodeId>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current)) continue;
    ancestors.add(current);

    const parents = reverseAdjacencyList[current] || [];
    for (const parent of parents) {
      if (!ancestors.has(parent)) {
        queue.push(parent);
      }
    }
  }

  // Step 2: Topologically sort the ancestors
  const sortedNodeIds = topologicalSort(adjacencyList, Array.from(ancestors));

  // Step 3: Get nodes in sorted order
  const contextNodes: ConversationNode[] = [];
  for (const id of sortedNodeIds) {
    const node = nodesMap.get(id);
    if (node) {
      contextNodes.push(node);
    }
  }

  // Step 4: Flatten messages in order
  const messages: Message[] = [];

  // Add custom instructions first if provided
  const profileText = customInstructions?.profile?.trim();
  if (includeCustomInstructions && profileText) {
    messages.push({
      id: 'custom-profile',
      nodeId: 'system',
      role: 'system',
      content: `User profile:\n${profileText}`,
      createdAt: 0,
      isStreaming: false,
      isCustomInstruction: true,
    });
  }

  const responseStyleText = customInstructions?.responseStyle?.trim();
  if (includeCustomInstructions && responseStyleText) {
    messages.push({
      id: 'custom-response-style',
      nodeId: 'system',
      role: 'system',
      content: `Response style:\n${responseStyleText}`,
      createdAt: 0,
      isStreaming: false,
      isCustomInstruction: true,
    });
  }

  const projectProfileText = customInstructions?.projectProfile?.trim();
  if (includeProjectInstructions && projectProfileText) {
    messages.push({
      id: 'project-profile',
      nodeId: 'system',
      role: 'system',
      content: `Project context:\n${projectProfileText}`,
      createdAt: 0,
      isStreaming: false,
      isProjectInstruction: true,
    });
  }

  const projectResponseStyleText = customInstructions?.projectResponseStyle?.trim();
  if (includeProjectInstructions && projectResponseStyleText) {
    messages.push({
      id: 'project-response-style',
      nodeId: 'system',
      role: 'system',
      content: `Project response style:\n${projectResponseStyleText}`,
      createdAt: 0,
      isStreaming: false,
      isProjectInstruction: true,
    });
  }

  // Add system prompt if exists
  if (includeSystemPrompt && systemPrompt) {
    messages.push({
      id: 'system-prompt',
      nodeId: 'system',
      role: 'system',
      content: systemPrompt,
      createdAt: 0,
      isStreaming: false,
    });
  }

  // Add messages from each node in topological order
  for (const node of contextNodes) {
    if (excludeNodes.has(node.id)) continue;
    // Sort messages within node by creation time
    const nodeMessages = [...node.messages].sort(
      (a, b) => a.createdAt - b.createdAt
    );
    // Filter out system messages from nodes (they come from conversation level),
    // but keep attachment context messages.
    const visibleMessages = nodeMessages.filter((m) => {
      if (m.role !== 'system') return true;
      if (!m.isAttachmentContext) return false;
      if (m.isProjectAttachmentContext) {
        return includeProjectAttachmentContext;
      }
      return includeAttachmentContext;
    });
    messages.push(...visibleMessages);
  }

  // Step 5: Estimate token count
  const tokenEstimate = estimateTokens(messages);

  return {
    nodes: contextNodes,
    messages,
    tokenEstimate,
  };
}

/**
 * Simple token estimation (4 chars ~= 1 token for English)
 */
function estimateTokens(messages: Message[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 4);
}

/**
 * Get all descendants of a node
 */
export function getDescendants(
  nodeId: NodeId,
  adjacencyList: AdjacencyList
): Set<NodeId> {
  const descendants = new Set<NodeId>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = adjacencyList[current] || [];

    for (const child of children) {
      if (!descendants.has(child)) {
        descendants.add(child);
        queue.push(child);
      }
    }
  }

  return descendants;
}

/**
 * Get all ancestors of a node
 */
export function getAncestors(
  nodeId: NodeId,
  reverseAdjacencyList: ReverseAdjacencyList
): Set<NodeId> {
  const ancestors = new Set<NodeId>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const parents = reverseAdjacencyList[current] || [];

    for (const parent of parents) {
      if (!ancestors.has(parent)) {
        ancestors.add(parent);
        queue.push(parent);
      }
    }
  }

  return ancestors;
}

/**
 * Get the linear path from root to a node (for chat view)
 * Returns nodes in order from root to target
 */
export function getPathToNode(
  nodeId: NodeId,
  rootNodeId: NodeId,
  reverseAdjacencyList: ReverseAdjacencyList
): NodeId[] {
  const path: NodeId[] = [];
  let current: NodeId | null = nodeId;

  while (current) {
    path.unshift(current);
    if (current === rootNodeId) break;

    const parentList: NodeId[] = reverseAdjacencyList[current] || [];
    // Take the first parent (in case of multiple, we pick one path)
    current = parentList.length > 0 ? parentList[0] : null;
  }

  return path;
}
