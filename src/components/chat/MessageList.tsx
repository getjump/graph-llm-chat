import type { RefObject } from 'react';
import { memo, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { MessageItem } from './MessageItem';
import { SummaryBlock } from '../shared/SummaryBlock';
import type { NodeId, Message, ConversationNode } from '../../types';

interface MessageListProps {
  onSendReply: (parentNodeId: NodeId, content: string) => void;
  onRetry?: (nodeId: NodeId) => void;
  containerRef?: RefObject<HTMLDivElement | null>;
}

export const MessageList = memo(function MessageList({
  onSendReply,
  onRetry,
  containerRef,
}: MessageListProps) {
  const {
    nodes,
    getActivePath,
    getRepliesForNode,
    getBranchesFromNode,
    setActiveNode,
    conversations,
    activeConversationId,
    activeNodeId,
    highlightedMessageId,
    highlightedQuery,
    setHighlightedMessage,
  } = useStore(
    useShallow((state) => ({
      nodes: state.nodes,
      getActivePath: state.getActivePath,
      getRepliesForNode: state.getRepliesForNode,
      getBranchesFromNode: state.getBranchesFromNode,
      setActiveNode: state.setActiveNode,
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      activeNodeId: state.activeNodeId,
      highlightedMessageId: state.highlightedMessageId,
      highlightedQuery: state.highlightedQuery,
      setHighlightedMessage: state.setHighlightedMessage,
    }))
  );

  const activePath = getActivePath();
  const leafNodeId = activePath[activePath.length - 1];
  const leafNode = leafNodeId ? nodes.get(leafNodeId) : null;
  const summary = leafNode?.contextSummary;
  const branchIds = activeNodeId ? getBranchesFromNode(activeNodeId) : [];
  const branchNodes = useMemo(
    () =>
      branchIds
        .map((id) => nodes.get(id))
        .filter((node): node is ConversationNode => Boolean(node)),
    [branchIds, nodes]
  );
  const showBranchChooser = branchNodes.length > 1;
  const conversation = activeConversationId
    ? conversations.get(activeConversationId)
    : null;

  const messagesWithMeta = useMemo(() => {
    const next: Array<{
      message: Message;
      nodeId: NodeId;
      isLastInNode: boolean;
      replies: ConversationNode[];
    }> = [];

    for (const nodeId of activePath) {
      const node = nodes.get(nodeId);
      if (!node) continue;

      const replies = getRepliesForNode(nodeId);

      for (let i = 0; i < node.messages.length; i++) {
        const message = node.messages[i];
        const isLastInNode = i === node.messages.length - 1;

        next.push({
          message,
          nodeId,
          isLastInNode,
          replies: isLastInNode ? replies : [],
        });
      }
    }

    return next;
  }, [activePath, nodes, getRepliesForNode]);

  useEffect(() => {
    if (!highlightedMessageId || !containerRef?.current) return;
    let attempts = 0;
    const maxAttempts = 20;
    let timeout: number | null = null;
    const interval = window.setInterval(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${highlightedMessageId}"]`
      );
      attempts += 1;

      if (el) {
        window.clearInterval(interval);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        timeout = window.setTimeout(() => {
          setHighlightedMessage(null, null);
        }, 3000);
        return;
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(interval);
      }
    }, 120);

    return () => {
      window.clearInterval(interval);
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, [highlightedMessageId, containerRef, setHighlightedMessage]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto flex flex-col">
      {messagesWithMeta.length === 0 ? (
        <div className="flex-1 flex flex-col text-gray-500 dark:text-gray-400">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-lg">Start a conversation</p>
              <p className="text-sm mt-1">Type a message below to begin</p>
              {conversation?.systemPrompt && (
                <p className="text-xs mt-4 text-gray-400 dark:text-gray-500">
                  System prompt is set for this conversation
                </p>
              )}
            </div>
          </div>
          {showBranchChooser && (
            <BranchChooser branchNodes={branchNodes} onSelect={setActiveNode} />
          )}
        </div>
      ) : (
        <>
          {summary && (
            <div className="px-4 py-3">
              <SummaryBlock
                title="Auto-summary"
                content={summary.content}
                timestamp={summary.createdAt}
              />
            </div>
          )}
          {/* System prompt indicator */}
          {conversation?.systemPrompt && (
            <div className="px-4 py-2 bg-yellow-50 dark:bg-yellow-500/10 border-b border-yellow-100 dark:border-yellow-500/30 text-sm text-yellow-700 dark:text-yellow-200">
              <span className="font-medium">System prompt:</span>{' '}
              <span className="text-yellow-600 dark:text-yellow-200 truncate inline-block max-w-md align-bottom">
                {conversation.systemPrompt.slice(0, 100)}
                {conversation.systemPrompt.length > 100 ? '...' : ''}
              </span>
            </div>
          )}

          {/* Messages */}
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {messagesWithMeta.map(({ message, nodeId, isLastInNode, replies }) => (
              <MessageItem
                key={message.id}
                message={message}
                nodeId={nodeId}
                isLastInNode={isLastInNode}
                replies={replies}
                onSendReply={onSendReply}
                onRetry={onRetry}
                highlightQuery={
                  highlightedMessageId === message.id ? highlightedQuery : null
                }
                isHighlighted={highlightedMessageId === message.id}
              />
            ))}
          </div>

          {showBranchChooser && (
            <BranchChooser branchNodes={branchNodes} onSelect={setActiveNode} />
          )}

        </>
      )}
    </div>
  );
});

function getNodePreview(node: ConversationNode): { title: string; subtitle: string } {
  const firstUser = node.messages.find((m) => m.role === 'user');
  const firstAssistant = node.messages.find((m) => m.role === 'assistant');
  const titleSource = firstUser?.content || firstAssistant?.content || '';
  const title = titleSource
    ? truncateText(titleSource, 48)
    : `Node ${node.id.slice(0, 6)}`;

  const subtitleSource = firstAssistant?.content || firstUser?.content || '';
  const subtitle = subtitleSource
    ? truncateText(subtitleSource, 72)
    : 'Empty branch';

  return { title, subtitle };
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

interface BranchChooserProps {
  branchNodes: ConversationNode[];
  onSelect: (nodeId: NodeId | null) => void;
}

const BranchChooser = memo(function BranchChooser({
  branchNodes,
  onSelect,
}: BranchChooserProps) {
  return (
    <div className="px-4 py-4 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900" data-testid="branch-chooser">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Choose a branch</div>
      <div className="mt-2 grid gap-2">
        {branchNodes.map((node) => {
          const preview = getNodePreview(node);
          return (
            <button
              key={node.id}
              onClick={() => onSelect(node.id)}
              data-testid="branch-option"
              data-branch-id={node.id}
              className="text-left rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
            >
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {node.label || preview.title}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {preview.subtitle}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});
