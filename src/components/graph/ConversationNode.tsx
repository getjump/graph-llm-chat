import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useStore } from '../../store';
import type { ConversationNode as ConversationNodeType, Message } from '../../types';

interface ConversationNodeProps {
  data: {
    node: ConversationNodeType;
  };
  selected?: boolean;
}

function ConversationNodeComponent({ data, selected }: ConversationNodeProps) {
  const { node } = data;
  const activeNodeId = useStore((state) => state.activeNodeId);
  const setActiveNode = useStore((state) => state.setActiveNode);
  const activeRequests = useStore((state) => state.activeRequests);
  const conversation = useStore((state) => state.conversations.get(node.conversationId));
  const updateConversation = useStore((state) => state.updateConversation);

  const excludedNodeIds = conversation?.contextSettings?.excludedNodeIds ?? [];
  const isExcluded = excludedNodeIds.includes(node.id);

  const isActive = activeNodeId === node.id;
  const isStreaming = activeRequests.has(node.id);

  // Get preview of messages
  const userMessage = node.messages.find((m: Message) => m.role === 'user');
  const assistantMessage = node.messages.find((m: Message) => m.role === 'assistant');

  const handleClick = () => {
    setActiveNode(node.id);
  };

  const statusColors: Record<string, string> = {
    idle: 'border-gray-200 dark:border-gray-700',
    streaming: 'border-blue-400 animate-pulse',
    error: 'border-red-400',
    cancelled: 'border-yellow-400',
  };

  return (
    <div
      onClick={handleClick}
      className={`
        min-w-[250px] max-w-[300px] bg-white dark:bg-gray-900 rounded-lg shadow-md border-2 cursor-pointer transition-all
        ${statusColors[node.status] || 'border-gray-200'}
        ${
          isActive
            ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900'
            : ''
        }
        ${isExcluded ? 'opacity-70 border-dashed' : ''}
        ${selected ? 'shadow-lg' : ''}
        hover:shadow-lg
      `}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-blue-500 border-2 border-white"
      />

      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {node.label || `Node ${node.id.slice(0, 6)}`}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!conversation) return;
            const nextExcluded = new Set(excludedNodeIds);
            if (nextExcluded.has(node.id)) {
              nextExcluded.delete(node.id);
            } else {
              nextExcluded.add(node.id);
            }
            updateConversation(conversation.id, {
              contextSettings: {
                ...conversation.contextSettings,
                excludedNodeIds: Array.from(nextExcluded),
              },
            });
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          className={`nodrag nopan text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
            isExcluded
              ? 'border-gray-300 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
              : 'border-emerald-400 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
          }`}
          title={isExcluded ? 'Exclude from context' : 'Include in context'}
        >
          {isExcluded ? 'Excluded' : 'In context'}
        </button>
        {isStreaming && (
          <span className="text-xs text-blue-500 animate-pulse">streaming...</span>
        )}
        {node.status === 'error' && (
          <span className="text-xs text-red-500">error</span>
        )}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {node.messages.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">Empty node</p>
        ) : (
          <>
            {userMessage && (
              <div className="text-sm">
                <span className="text-blue-600 font-medium">You: </span>
                <span className="text-gray-700 dark:text-gray-200 line-clamp-2">
                  {userMessage.content.slice(0, 100)}
                  {userMessage.content.length > 100 ? '...' : ''}
                </span>
              </div>
            )}
            {assistantMessage && (
              <div className="text-sm">
                <span className="text-green-600 font-medium">AI: </span>
                <span className="text-gray-600 dark:text-gray-300 line-clamp-2">
                  {assistantMessage.content.slice(0, 100)}
                  {assistantMessage.content.length > 100 ? '...' : ''}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 rounded-b-lg flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
        <span>{node.messages.length} messages</span>
        <span>{new Date(node.createdAt).toLocaleTimeString()}</span>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-green-500 border-2 border-white"
      />
    </div>
  );
}

export const ConversationNode = memo(ConversationNodeComponent);
