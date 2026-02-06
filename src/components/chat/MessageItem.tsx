import { memo, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import type { Message, NodeId, ConversationNode } from '../../types';
import { useStore } from '../../store';
import { ReplyThread } from './ReplyThread';
import { copyTextToClipboard } from '../../utils/clipboard';
import { formatFileSize } from '../../utils/files';
import { compactAttachmentContextMessage } from '../../utils/attachments';

interface MessageItemProps {
  message: Message;
  nodeId: NodeId;
  isLastInNode: boolean;
  replies: ConversationNode[];
  onSendReply: (parentNodeId: NodeId, content: string) => void;
  onRetry?: (nodeId: NodeId) => void;
  highlightQuery?: string | null;
  isHighlighted?: boolean;
}

export const MessageItem = memo(function MessageItem({
  message,
  nodeId,
  isLastInNode,
  replies,
  onSendReply,
  onRetry,
  highlightQuery,
  isHighlighted,
}: MessageItemProps) {
  const { activeRequests, editMessage, deleteMessage, nodeModel } = useStore(
    useShallow((state) => ({
      activeRequests: state.activeRequests,
      editMessage: state.editMessage,
      deleteMessage: state.deleteMessage,
      nodeModel: state.nodes.get(nodeId)?.model,
    }))
  );
  const isStreaming = activeRequests.has(nodeId) && message.isStreaming;

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isAssistant = message.role === 'assistant';
  const canEdit = !isSystem && !isStreaming;
  const modelChanged =
    isAssistant && Boolean(message.model) && Boolean(nodeModel) && message.model !== nodeModel;
  const isErrorMessage = isAssistant && message.content.startsWith('[Error:');
  const assistantLabel = message.model || nodeModel || 'Assistant';

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  // Show reply thread only on assistant messages that are last in the node
  const showReplyThread = isAssistant && isLastInNode && !isStreaming;
  const timestamp = formatTimestamp(message.createdAt);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  if (isSystem) {
    const displayContent = message.isAttachmentContext
      ? compactAttachmentContextMessage(message.content)
      : message.content;
    return (
      <div className="px-4 py-2 bg-yellow-50 dark:bg-yellow-500/10 border-l-4 border-yellow-400 dark:border-yellow-500/60 text-sm text-yellow-800 dark:text-yellow-200">
        <span className="font-semibold">
          {message.isAttachmentContext ? 'Attachments: ' : 'System: '}
        </span>
        {displayContent}
      </div>
    );
  }

  return (
    <div
      className={`group flex gap-3 px-4 py-4 ${
        isUser ? 'bg-blue-50 dark:bg-blue-500/10' : 'bg-white dark:bg-gray-900'
      } ${isHighlighted ? 'ring-2 ring-amber-400/70 ring-inset' : ''}`}
      data-testid="message-item"
      data-message-id={message.id}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? 'bg-blue-500' : 'bg-green-500'
        }`}
      >
        <span className="text-white text-sm font-medium">{isUser ? 'U' : 'A'}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {isUser ? 'You' : assistantLabel}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{timestamp}</span>
            {isStreaming && (
              <span className="text-xs text-blue-500 animate-pulse">typing...</span>
            )}
          </div>
        </div>

        {!isEditing ? (
          <>
            <MarkdownRenderer
              className="prose prose-sm max-w-none text-gray-800 dark:text-gray-100 dark:prose-invert"
              content={message.content || (isStreaming ? '...' : '')}
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
              data-testid="edit-message-input"
              rows={3}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {modelChanged && (
              <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Model will change: {message.model} → {nodeModel}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  editMessage(nodeId, message.id, draft, 'preserve');
                  setIsEditing(false);
                }}
                data-testid="save-message"
                className="px-3 py-1.5 text-xs rounded-md bg-gray-800 text-white hover:bg-gray-900 transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => {
                  editMessage(nodeId, message.id, draft, 'reset');
                  if (onRetry) {
                    void onRetry(nodeId);
                  }
                  setIsEditing(false);
                }}
                data-testid="save-reset-message"
                className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Save & recompute (reset branches)
              </button>
              <button
                onClick={() => {
                  setDraft(message.content);
                  setIsEditing(false);
                }}
                data-testid="cancel-edit-message"
                className="px-3 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
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
          <div className="mt-2 ml-11">
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
                data-testid="copy-message"
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
                data-testid="edit-message"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                Edit
              </button>
              )}
              {canEdit && (
              <button
                type="button"
                onClick={() => deleteMessage(nodeId, message.id)}
                data-testid="delete-message"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-red-600 hover:text-red-700"
              >
                Delete
              </button>
              )}
              {isErrorMessage && onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(nodeId)}
                  data-testid="retry-message"
                  className={`text-xs text-blue-600 hover:text-blue-700 transition-opacity ${
                    isErrorMessage ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {/* Reply thread for assistant messages */}
        {showReplyThread && (
          <ReplyThread
            parentNodeId={nodeId}
            replies={replies}
            onSendReply={onSendReply}
          />
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
