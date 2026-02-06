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

  it('uses primary thread path and excludes side-parent branch content', () => {
    const root: ConversationNode = {
      id: 'root',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm-root', nodeId: 'root', content: 'root' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
      isCollapsed: false,
    };
    const threadA: ConversationNode = {
      id: 'a',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm-a', nodeId: 'a', content: 'thread-a' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 2,
      updatedAt: 2,
      isCollapsed: false,
      parentNodeId: 'root',
    };
    const sideParent: ConversationNode = {
      id: 'b',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm-b', nodeId: 'b', content: 'side-parent' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 3,
      updatedAt: 3,
      isCollapsed: false,
      parentNodeId: 'root',
    };
    const target: ConversationNode = {
      id: 'target',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm-target', nodeId: 'target', content: 'target' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 4,
      updatedAt: 4,
      isCollapsed: false,
      parentNodeId: 'a',
    };

    const nodes = new Map<string, ConversationNode>([
      ['root', root],
      ['a', threadA],
      ['b', sideParent],
      ['target', target],
    ]);

    const adjacency = {
      root: ['a', 'b'],
      a: ['target'],
      b: ['target'],
    };
    const reverse = {
      a: ['root'],
      b: ['root'],
      target: ['a', 'b'],
    };

    const context = computeContext('target', nodes, reverse, adjacency, undefined, undefined, undefined, 'root');

    const contents = context.messages.map((message) => message.content);
    expect(contents).toContain('root');
    expect(contents).toContain('thread-a');
    expect(contents).toContain('target');
    expect(contents).not.toContain('side-parent');
  });

  it('falls back to deterministic parent selection when parentNodeId is missing', () => {
    const root: ConversationNode = {
      id: 'root',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm-root', nodeId: 'root', content: 'root' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
      isCollapsed: false,
    };
    const olderParent: ConversationNode = {
      id: 'older',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm-older', nodeId: 'older', content: 'older-parent' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 2,
      updatedAt: 2,
      isCollapsed: false,
    };
    const newerParent: ConversationNode = {
      id: 'newer',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm-newer', nodeId: 'newer', content: 'newer-parent' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 10,
      updatedAt: 10,
      isCollapsed: false,
    };
    const target: ConversationNode = {
      id: 'target',
      conversationId: 'c1',
      messages: [baseMessage({ id: 'm-target', nodeId: 'target', content: 'target' })],
      position: { x: 0, y: 0 },
      status: 'idle',
      createdAt: 11,
      updatedAt: 11,
      isCollapsed: false,
    };

    const nodes = new Map<string, ConversationNode>([
      ['root', root],
      ['older', olderParent],
      ['newer', newerParent],
      ['target', target],
    ]);

    const adjacency = {
      root: ['older', 'newer'],
      older: ['target'],
      newer: ['target'],
    };
    const reverse = {
      older: ['root'],
      newer: ['root'],
      target: ['newer', 'older'],
    };

    const context = computeContext('target', nodes, reverse, adjacency, undefined, undefined, undefined, 'root');
    const contents = context.messages.map((message) => message.content);
    expect(contents).toContain('older-parent');
    expect(contents).not.toContain('newer-parent');
  });
});
