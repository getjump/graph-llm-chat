import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import type { ViewMode } from '../../types';

interface HeaderProps {
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}

export function Header({
  isLeftSidebarOpen,
  isRightSidebarOpen,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: HeaderProps) {
  const { viewMode, setViewMode, activeConversationId, conversations, theme, setTheme } = useStore(
    useShallow((state) => ({
      viewMode: state.viewMode,
      setViewMode: state.setViewMode,
      activeConversationId: state.activeConversationId,
      conversations: state.conversations,
      theme: state.theme,
      setTheme: state.setTheme,
    }))
  );

  const activeConversation = activeConversationId
    ? conversations.get(activeConversationId)
    : null;

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
  };

  return (
    <header className="h-14 border-b border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-800 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggleLeftSidebar}
          data-testid="toggle-left-sidebar"
          className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-200"
          title={isLeftSidebarOpen ? 'Hide chats' : 'Show chats'}
        >
          {isLeftSidebarOpen ? 'Hide Chats' : 'Show Chats'}
        </button>
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
          Graph LLM Chat
        </h1>
        {activeConversation && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {activeConversation.title}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* View Mode Toggle */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => handleViewModeChange('chat')}
            data-testid="view-chat"
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'chat'
                ? 'bg-blue-500 text-white'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => handleViewModeChange('graph')}
            data-testid="view-graph"
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'graph'
                ? 'bg-blue-500 text-white'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            Graph
          </button>
          <button
            onClick={() => handleViewModeChange('context')}
            data-testid="view-context"
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'context'
                ? 'bg-blue-500 text-white'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            Context
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleRightSidebar}
          data-testid="toggle-right-sidebar"
          className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-200"
          title={isRightSidebarOpen ? 'Hide model settings' : 'Show model settings'}
        >
          {isRightSidebarOpen ? 'Hide Model' : 'Show Model'}
        </button>

        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          data-testid="toggle-theme"
          className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-200"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>

      </div>
    </header>
  );
}
