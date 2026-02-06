import { describe, expect, it } from 'vitest';
import { topologicalSort } from './topologicalSort';
import type { AdjacencyList, NodeId } from '../../types';

function expectValidTopoOrder(nodes: NodeId[], edges: Array<[NodeId, NodeId]>) {
  const position = new Map<NodeId, number>();
  nodes.forEach((node, index) => position.set(node, index));
  for (const [from, to] of edges) {
    const fromIndex = position.get(from);
    const toIndex = position.get(to);
    expect(fromIndex).not.toBeUndefined();
    expect(toIndex).not.toBeUndefined();
    expect(fromIndex!).toBeLessThan(toIndex!);
  }
}

describe('topologicalSort', () => {
  it('orders nodes so parents come before children', () => {
    const adjacency: AdjacencyList = {
      A: ['B', 'C'],
      B: ['D'],
      C: ['D'],
      D: [],
    };
    const nodes = ['A', 'B', 'C', 'D'];
    const sorted = topologicalSort(adjacency, nodes);
    expect(sorted).toHaveLength(nodes.length);
    expectValidTopoOrder(sorted, [
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'D'],
      ['C', 'D'],
    ]);
  });

  it('ignores edges to nodes outside the input set', () => {
    const adjacency: AdjacencyList = {
      A: ['B', 'X'],
      B: [],
      X: ['A'],
    };
    const nodes = ['A', 'B'];
    const sorted = topologicalSort(adjacency, nodes);
    expect(sorted).toEqual(['A', 'B']);
  });
});
