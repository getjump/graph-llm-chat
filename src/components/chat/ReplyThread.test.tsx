import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplyThread } from './ReplyThread';
import { useStore } from '../../store';
import type { ConversationNode } from '../../types';

const emptyReplies: ConversationNode[] = [];

describe('ReplyThread', () => {
  beforeEach(() => {
    useStore.setState({
      activeRequests: new Map(),
      replyThreadFocusNodeId: null,
      replyDrafts: {},
      activeInputNodeId: null,
    });
  });

  it('persists independent drafts for different parent messages', () => {
    const onSendReply = vi.fn(async () => {});

    render(
      <div>
        <ReplyThread parentNodeId="node-1" replies={emptyReplies} onSendReply={onSendReply} />
        <ReplyThread parentNodeId="node-2" replies={emptyReplies} onSendReply={onSendReply} />
      </div>
    );

    const toggles = screen.getAllByTestId('toggle-replies');
    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);

    let inputs = screen.getAllByTestId('reply-input');
    fireEvent.change(inputs[0], { target: { value: 'Draft for first message' } });
    fireEvent.change(inputs[1], { target: { value: 'Draft for second message' } });

    const stateAfterTyping = useStore.getState().replyDrafts;
    expect(stateAfterTyping['node-1']).toBe('Draft for first message');
    expect(stateAfterTyping['node-2']).toBe('Draft for second message');
  });

  it('restores persisted draft into input when remounted', () => {
    useStore.setState({
      replyDrafts: {
        'node-1': 'Persisted reply draft',
      },
    });

    const onSendReply = vi.fn(async () => {});
    render(
      <ReplyThread parentNodeId="node-1" replies={emptyReplies} onSendReply={onSendReply} />
    );

    expect(screen.getByTestId('reply-input')).toHaveValue('Persisted reply draft');
  });
});
