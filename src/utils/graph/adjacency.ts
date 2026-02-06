import type {
  ConversationEdge,
  AdjacencyList,
  ReverseAdjacencyList,
} from '../../types';

/**
 * Builds adjacency lists from edges for efficient graph traversal
 */
export function computeAdjacencyLists(edges: ConversationEdge[]): {
  adjacencyList: AdjacencyList;
  reverseAdjacencyList: ReverseAdjacencyList;
} {
  const adjacencyList: AdjacencyList = {};
  const reverseAdjacencyList: ReverseAdjacencyList = {};
  const orderedEdges = [...edges].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.id.localeCompare(right.id);
  });

  for (const edge of orderedEdges) {
    // Forward: source -> target
    if (!adjacencyList[edge.source]) {
      adjacencyList[edge.source] = [];
    }
    adjacencyList[edge.source].push(edge.target);

    // Reverse: target -> source (for ancestor lookup)
    if (!reverseAdjacencyList[edge.target]) {
      reverseAdjacencyList[edge.target] = [];
    }
    reverseAdjacencyList[edge.target].push(edge.source);
  }

  return { adjacencyList, reverseAdjacencyList };
}

/**
 * Get all children of a node
 */
export function getChildren(
  nodeId: string,
  adjacencyList: AdjacencyList
): string[] {
  return adjacencyList[nodeId] || [];
}

/**
 * Get all parents of a node
 */
export function getParents(
  nodeId: string,
  reverseAdjacencyList: ReverseAdjacencyList
): string[] {
  return reverseAdjacencyList[nodeId] || [];
}
