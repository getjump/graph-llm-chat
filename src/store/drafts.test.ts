import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from './index';
import type { PendingAttachment } from '../types';

const memoryAttachment: PendingAttachment = {
  id: 'att-1',
  name: 'notes.txt',
  size: 12,
  type: 'text/plain',
  lastModified: 1,
  source: 'memory',
  file: new File(['hello world'], 'notes.txt', { type: 'text/plain' }),
};

describe('store drafts', () => {
  beforeEach(() => {
    useStore.setState({
      chatDrafts: {},
      replyDrafts: {},
    });
  });

  it('stores and clears chat drafts', () => {
    const store = useStore.getState();
    store.setChatDraft('node-a', { content: 'draft text', attachments: [memoryAttachment] });

    const draft = useStore.getState().chatDrafts['node-a'];
    expect(draft).toBeDefined();
    expect(draft.content).toBe('draft text');
    expect(draft.attachments).toHaveLength(1);

    store.setChatDraft('node-a', { content: '', attachments: [] });
    expect(useStore.getState().chatDrafts['node-a']).toBeUndefined();
  });

  it('does not store empty chat drafts', () => {
    const store = useStore.getState();
    store.setChatDraft('node-empty', { content: '', attachments: [] });
    expect(useStore.getState().chatDrafts['node-empty']).toBeUndefined();
  });

  it('keeps reply drafts isolated by parent node', () => {
    const store = useStore.getState();
    store.setReplyDraft('parent-1', 'reply one');
    store.setReplyDraft('parent-2', 'reply two');

    expect(useStore.getState().replyDrafts['parent-1']).toBe('reply one');
    expect(useStore.getState().replyDrafts['parent-2']).toBe('reply two');

    store.clearReplyDraft('parent-1');
    expect(useStore.getState().replyDrafts['parent-1']).toBeUndefined();
    expect(useStore.getState().replyDrafts['parent-2']).toBe('reply two');
  });
});
