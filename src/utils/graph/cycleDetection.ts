import type { AdjacencyList, NodeId, CycleCheckResult } from '../../types';

type VisitState = 'unvisited' | 'visiting' | 'visited';

/**
 * Checks if adding an edge from source to target would create a cycle
 * Uses DFS to check if target can reach source
 *
 * Time Complexity: O(V + E)
 * Space Complexity: O(V)
 */
export function wouldCreateCycle(
  adjacencyList: AdjacencyList,
  source: NodeId,
  target: NodeId
): boolean {
  // If source equals target, it's a self-loop
  if (source === target) return true;

  // If target can reach source, adding source->target creates a cycle
  const visited = new Set<NodeId>();
  const stack = [target];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (current === source) {
      return true; // Found path from target to source = cycle
    }

    if (visited.has(current)) continue;
    visited.add(current);

    const children = adjacencyList[current] || [];
    for (const child of children) {
      if (!visited.has(child)) {
        stack.push(child);
      }
    }
  }

  return false;
}

/**
 * Validates that the entire graph is a valid DAG
 * Returns nodes involved in cycles if any exist
 */
export function detectCycles(adjacencyList: AdjacencyList): CycleCheckResult {
  const allNodes = Object.keys(adjacencyList);
  const state = new Map<NodeId, VisitState>();
  const cycleNodes: NodeId[] = [];

  function dfs(node: NodeId, path: Set<NodeId>): boolean {
    if (state.get(node) === 'visited') return false;
    if (state.get(node) === 'visiting') {
      cycleNodes.push(...Array.from(path));
      return true;
    }

    state.set(node, 'visiting');
    path.add(node);

    const children = adjacencyList[node] || [];
    for (const child of children) {
      if (dfs(child, path)) return true;
    }

    path.delete(node);
    state.set(node, 'visited');
    return false;
  }

  for (const node of allNodes) {
    if (!state.has(node)) {
      if (dfs(node, new Set())) {
        return { hasCycle: true, cycleNodes: [...new Set(cycleNodes)] };
      }
    }
  }

  return { hasCycle: false };
}
