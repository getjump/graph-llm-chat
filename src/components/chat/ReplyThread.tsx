import { memo, useEffect, useRef, useState } from 'react';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import type { ConversationNode, NodeId } from '../../types';
import { copyTextToClipboard } from '../../utils/clipboard';
import { formatFileSize } from '../../utils/files';

interface ReplyThreadProps {
  parentNodeId: NodeId;
  replies: ConversationNode[];
  onSendReply: (parentNodeId: NodeId, content: string) => void;
}

export const ReplyThread = memo(function ReplyThread({
  parentNodeId,
  replies,
  onSendReply,
}: ReplyThreadProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    activeRequests,
    setActiveInputNode,
    replyThreadFocusNodeId,
    setReplyThreadFocusNodeId,
    replyDrafts,
    setReplyDraft,
    clearReplyDraft,
  } = useStore(
    useShallow((state) => ({
      activeRequests: state.activeRequests,
      setActiveInputNode: state.setActiveInputNode,
      replyThreadFocusNodeId: state.replyThreadFocusNodeId,
      setReplyThreadFocusNodeId: state.setReplyThreadFocusNodeId,
      replyDrafts: state.replyDrafts,
      setReplyDraft: state.setReplyDraft,
      clearReplyDraft: state.clearReplyDraft,
    }))
  );
  const persistedReplyDraft = replyDrafts[parentNodeId] || '';

  // Check if any reply is currently streaming
  const isAnyReplyStreaming = replies.some((reply) => activeRequests.has(reply.id));

  // Auto-expand when there's an active request
  useEffect(() => {
    if (isAnyReplyStreaming) {
      setIsExpanded(true);
    }
  }, [isAnyReplyStreaming]);

  useEffect(() => {
    if (replyThreadFocusNodeId === parentNodeId) {
      setIsExpanded(true);
      setReplyThreadFocusNodeId(null);
    }
  }, [replyThreadFocusNodeId, parentNodeId, setReplyThreadFocusNodeId]);

  useEffect(() => {
    setReplyContent(persistedReplyDraft);
    if (persistedReplyDraft.trim()) {
      setIsExpanded(true);
    }
  }, [parentNodeId, persistedReplyDraft]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContent.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSendReply(parentNodeId, replyContent.trim());
      setReplyContent('');
      clearReplyDraft(parentNodeId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const replyCount = replies.length;

  return (
    <div className="mt-2 ml-11">
      {/* Toggle button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid="toggle-replies"
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {replyCount > 0 ? (
          <span>
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </span>
        ) : (
          <span>Reply to this message</span>
        )}
        {isAnyReplyStreaming && (
          <span className="text-blue-500 animate-pulse ml-1">typing...</span>
        )}
      </button>

      {/* Expanded thread */}
      {isExpanded && (
        <div className="mt-2 border-l-2 border-blue-200 dark:border-blue-400/60 pl-3 space-y-3">
          {/* Existing replies */}
          {replies.map((reply) => (
            <ReplyItem key={reply.id} reply={reply} />
          ))}

          {/* Reply input */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <textarea
              ref={inputRef}
              data-testid="reply-input"
              value={replyContent}
              onChange={(e) => {
                const next = e.target.value;
                setReplyContent(next);
                setReplyDraft(parentNodeId, next);
              }}
              onFocus={() => setActiveInputNode(parentNodeId)}
              onKeyDown={handleKeyDown}
              placeholder="Write a reply..."
              disabled={isSubmitting || isAnyReplyStreaming}
              rows={1}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 dark:disabled:bg-gray-800 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
            />
            <button
              type="submit"
              disabled={!replyContent.trim() || isSubmitting || isAnyReplyStreaming}
              data-testid="send-reply"
              className="px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reply
            </button>
          </form>
        </div>
      )}
    </div>
  );
});

interface ReplyItemProps {
  reply: ConversationNode;
}

const ReplyItem = memo(function ReplyItem({ reply }: ReplyItemProps) {
  const activeRequests = useStore((state) => state.activeRequests);
  const isStreaming = activeRequests.has(reply.id);

  return (
    <div className="space-y-2">
      {reply.messages.map((message) => (
        <ReplyMessageItem
          key={message.id}
          replyNodeId={reply.id}
          message={message}
          isStreaming={isStreaming}
        />
      ))}
    </div>
  );
});

interface ReplyMessageItemProps {
  replyNodeId: NodeId;
  message: ConversationNode['messages'][number];
  isStreaming: boolean;
}

const ReplyMessageItem = memo(function ReplyMessageItem({
  replyNodeId,
  message,
  isStreaming,
}: ReplyMessageItemProps) {
  const { editMessage, deleteMessage, nodeModel, highlightedMessageId, highlightedQuery } = useStore(
    useShallow((state) => ({
      editMessage: state.editMessage,
      deleteMessage: state.deleteMessage,
      nodeModel: state.nodes.get(replyNodeId)?.model,
      highlightedMessageId: state.highlightedMessageId,
      highlightedQuery: state.highlightedQuery,
    }))
  );
  const isUser = message.role === 'user';
  const isMessageStreaming = isStreaming && message.isStreaming;
  const canEdit = !isMessageStreaming && message.role !== 'system';
  const isAssistant = message.role === 'assistant';
  const modelChanged =
    isAssistant && Boolean(message.model) && Boolean(nodeModel) && message.model !== nodeModel;
  const timestamp = formatTimestamp(message.createdAt);
  const assistantLabel = message.model || nodeModel || 'Assistant';

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const isHighlighted = highlightedMessageId === message.id;
  const highlightQuery = isHighlighted ? highlightedQuery : null;

  return (
    <div
      className={`group flex gap-2 ${
        isUser ? '' : 'bg-gray-50 dark:bg-gray-800 -ml-3 pl-3 -mr-1 pr-1 py-1 rounded'
      } ${isHighlighted ? 'ring-2 ring-amber-400/70 ring-inset rounded' : ''}`}
      data-testid="reply-message-item"
      data-message-id={message.id}
    >
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs ${
          isUser ? 'bg-blue-400' : 'bg-green-400'
        }`}
      >
        <span className="text-white font-medium">{isUser ? 'U' : 'A'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-200">
              {isUser ? 'You' : assistantLabel}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{timestamp}</span>
            {isMessageStreaming && (
              <span className="text-xs text-blue-500 animate-pulse">typing...</span>
            )}
          </div>
        </div>
        {!isEditing ? (
          <>
            <MarkdownRenderer
              className="prose prose-sm max-w-none text-gray-700 dark:text-gray-100 dark:prose-invert text-sm"
              content={message.content || (isMessageStreaming ? '...' : '')}
              highlightQuery={highlightQuery}
            />
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {message.attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-200 bg-gray-50 dark:bg-gray-800"
                  >
                    {attachment.name} · {formatFileSize(attachment.size)}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              data-testid="edit-reply-input"
              rows={3}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {modelChanged && (
              <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Model will change: {message.model} → {nodeModel}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  editMessage(replyNodeId, message.id, draft, 'preserve');
                  setIsEditing(false);
                }}
                data-testid="save-reply"
                className="px-2 py-1 text-xs rounded-md bg-gray-800 text-white hover:bg-gray-900 transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => {
                  editMessage(replyNodeId, message.id, draft, 'reset');
                  setIsEditing(false);
                }}
                data-testid="save-reset-reply"
                className="px-2 py-1 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Save & recompute (reset branches)
              </button>
              <button
                onClick={() => {
                  setDraft(message.content);
                  setIsEditing(false);
                }}
                data-testid="cancel-reply-edit"
                className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500">
              “Save & recompute (reset branches)” will delete child branches and comments.
            </div>
          </div>
        )}

        {!isEditing && (
          <div className="mt-1">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  const success = await copyTextToClipboard(message.content);
                  if (!success) return;
                  setCopied(true);
                  if (copyTimeoutRef.current !== null) {
                    window.clearTimeout(copyTimeoutRef.current);
                  }
                  copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
                }}
                data-testid="copy-reply"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setDraft(message.content);
                  setIsEditing(true);
                }}
                data-testid="edit-reply"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                Edit
              </button>
              )}
              {canEdit && (
              <button
                type="button"
                onClick={() => deleteMessage(replyNodeId, message.id)}
                data-testid="delete-reply"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-red-600 hover:text-red-700"
              >
                Delete
              </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

function formatTimestamp(timestamp: number) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
