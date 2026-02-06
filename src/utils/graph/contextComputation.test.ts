import { describe, expect, it } from 'vitest';
import { computeContext } from './contextComputation';
import type { ConversationNode, Message } from '../../types';

const baseMessage = (overrides: Partial<Message>): Message => ({
  id: 'm1',
  nodeId: 'n1',
  role: 'user',
  content: 'hello',
  createdAt: 1,
  isStreaming: false,
  ...overrides,
});

describe('computeContext', () => {
  it('includes attachment context system messages', () => {
    const node: ConversationNode = {
      id: 'n1',
      conversationId: 'c1',
      messages: [
        baseMessage({ role: 'system', content: 'system prompt', isAttachmentContext: false }),
        baseMessage({ id: 'm2', role: 'system', content: 'attachment summary', isAttachmentContext: true }),
        baseMessage({ id: 'm3', role: 'user', content: 'question' }),
      ],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
      isCollapsed: false,
    };

    const nodes = new Map<string, ConversationNode>([['n1', node]]);
    const context = computeContext('n1', nodes, {}, {}, undefined);

    expect(context.messages.some((m) => m.content === 'attachment summary')).toBe(true);
    expect(context.messages.some((m) => m.content === 'system prompt')).toBe(false);
  });

  it('can exclude nodes from context', () => {
    const nodeA: ConversationNode = {
      id: 'n1',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm1', nodeId: 'n1', content: 'first' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
      isCollapsed: false,
    };
    const nodeB: ConversationNode = {
      id: 'n2',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm2', nodeId: 'n2', content: 'second' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 2,
      updatedAt: 2,
      isCollapsed: false,
    };

    const nodes = new Map<string, ConversationNode>([
      ['n1', nodeA],
      ['n2', nodeB],
    ]);
    const adjacency = { n1: ['n2'] };
    const reverse = { n2: ['n1'] };

    const context = computeContext('n2', nodes, reverse, adjacency, undefined, undefined, {
      excludedNodeIds: ['n1'],
    });

    expect(context.messages.some((m) => m.content === 'first')).toBe(false);
    expect(context.messages.some((m) => m.content === 'second')).toBe(true);
  });

  it('respects attachment inclusion flags', () => {
    const node: ConversationNode = {
      id: 'n1',
      conversationId: 'c1',
      messages: [
        baseMessage({
          id: 'm1',
          role: 'system',
          content: 'attachment',
          isAttachmentContext: true,
        }),
        baseMessage({
          id: 'm2',
          role: 'system',
          content: 'project attachment',
          isAttachmentContext: true,
          isProjectAttachmentContext: true,
        }),
        baseMessage({ id: 'm3', role: 'user', content: 'hello' }),
      ],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
      isCollapsed: false,
    };

    const nodes = new Map<string, ConversationNode>([['n1', node]]);
    const context = computeContext('n1', nodes, {}, {}, undefined, undefined, {
      includeAttachmentContext: false,
      includeProjectAttachmentContext: true,
    });

    expect(context.messages.some((m) => m.content === 'attachment')).toBe(false);
    expect(context.messages.some((m) => m.content === 'project attachment')).toBe(true);
  });
});
