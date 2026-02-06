import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { ContextView } from './ContextView';
import { useStore } from '../../store';
import type { Conversation, ConversationNode, LLMModel } from '../../types';

const model: LLMModel = {
  id: 'openai/gpt-4-turbo',
  name: 'GPT-4 Turbo',
  contextLength: 4096,
  pricing: { prompt: 0, completion: 0 },
};

const conversation: Conversation = {
  id: 'c1',
  title: 'Test Chat',
  rootNodeId: 'n1',
  model: 'openai/gpt-4-turbo',
  createdAt: 1,
  updatedAt: 1,
};

const node: ConversationNode = {
  id: 'n1',
  conversationId: 'c1',
  messages: [
    {
      id: 'm1',
      nodeId: 'n1',
      role: 'system',
      content: 'Attachment context (summary): file.txt',
      createdAt: 1,
      isStreaming: false,
      isAttachmentContext: true,
    },
    {
      id: 'm2',
      nodeId: 'n1',
      role: 'user',
      content: 'Hello',
      createdAt: 2,
      isStreaming: false,
    },
  ],
  position: { x: 0, y: 0 },
  status: 'idle',
  createdAt: 1,
  updatedAt: 1,
  isCollapsed: false,
};

describe('ContextView', () => {
  beforeEach(() => {
    useStore.setState({
      conversations: new Map([[conversation.id, conversation]]),
      nodes: new Map([[node.id, node]]),
      edges: new Map(),
      activeConversationId: conversation.id,
      activeNodeId: node.id,
      adjacencyList: {},
      reverseAdjacencyList: {},
      models: [model],
      selectedModel: model.id,
    });
  });

  it('renders messages from computed context', () => {
    render(<ContextView />);
    expect(screen.getByTestId('context-title')).toBeInTheDocument();
    expect(screen.getByText('attachment')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
