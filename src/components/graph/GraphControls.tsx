import { useStore } from '../../store';

export function GraphControls() {
  const autoLayoutNodes = useStore((state) => state.autoLayoutNodes);
  const activeNodeId = useStore((state) => state.activeNodeId);
  const nodes = useStore((state) => state.nodes);
  const createNode = useStore((state) => state.createNode);
  const setActiveNode = useStore((state) => state.setActiveNode);
  const deleteNode = useStore((state) => state.deleteNode);
  const conversations = useStore((state) => state.conversations);

  const activeNode = activeNodeId ? nodes.get(activeNodeId) : null;
  const activeConversation = activeNode
    ? conversations.get(activeNode.conversationId)
    : null;
  const canDelete =
    Boolean(activeNodeId) &&
    Boolean(activeConversation) &&
    activeConversation?.rootNodeId !== activeNodeId;

  const handleAutoLayout = () => {
    autoLayoutNodes();
  };

  const handleAddBranch = () => {
    if (!activeNode || !activeNodeId) return;
    const newNodeId = createNode(activeNode.conversationId, activeNodeId);
    setActiveNode(newNodeId);
  };

  return (
    <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
      <button
        onClick={handleAutoLayout}
        className="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2"
        title="Auto-arrange nodes"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
          />
        </svg>
        Auto Layout
      </button>

      {activeNode && (
        <button
          onClick={handleAddBranch}
          className="px-3 py-2 bg-blue-500 text-white rounded-lg shadow-sm hover:bg-blue-600 text-sm font-medium flex items-center gap-2"
          title="Add branch from selected node"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Add Branch
        </button>
      )}

      {activeNode && (
        <button
          onClick={() => {
            if (!activeNodeId) return;
            deleteNode(activeNodeId);
          }}
          disabled={!canDelete}
          className={`px-3 py-2 rounded-lg shadow-sm text-sm font-medium flex items-center gap-2 ${
            canDelete
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
          }`}
          title={canDelete ? 'Delete selected node' : 'Cannot delete root node'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 7h12m-9 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0l1 12a1 1 0 001 1h4a1 1 0 001-1l1-12"
            />
          </svg>
          Delete Node
        </button>
      )}
    </div>
  );
}
