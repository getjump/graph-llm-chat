import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { searchMessages } from '../../db';
import type { MessageSearchResult } from '../../types';
import type { SettingsTab } from './SettingsModal';
import { regenerateConversationTitle } from '../../hooks/useStreaming';

interface SidebarProps {
  onOpenSettings: (tab?: SettingsTab) => void;
  onOpenProjectSettings: (projectId: string) => void;
}

export function Sidebar({ onOpenSettings, onOpenProjectSettings }: SidebarProps) {
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    createConversation,
    deleteConversation,
    projects,
    activeProjectId,
    createProject,
    setActiveProject,
    setActiveNode,
    setViewMode,
    setReplyThreadFocusNodeId,
    setHighlightedMessage,
    updateConversation,
    addToast,
  } = useStore(
    useShallow((state) => ({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      setActiveConversation: state.setActiveConversation,
      createConversation: state.createConversation,
      deleteConversation: state.deleteConversation,
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      createProject: state.createProject,
      setActiveProject: state.setActiveProject,
      setActiveNode: state.setActiveNode,
      setViewMode: state.setViewMode,
      setReplyThreadFocusNodeId: state.setReplyThreadFocusNodeId,
      setHighlightedMessage: state.setHighlightedMessage,
      updateConversation: state.updateConversation,
      addToast: state.addToast,
    }))
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    conversationId: string;
    x: number;
    y: number;
  } | null>(null);

  const sortedConversations = Array.from(conversations.values())
    .filter((conv) => (activeProjectId ? conv.projectId === activeProjectId : true))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const sortedProjects = Array.from(projects.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  const trimmedSearch = searchQuery.trim();
  const showSearchResults = trimmedSearch.length > 0;

  useEffect(() => {
    let isActive = true;
    if (!trimmedSearch) {
      setSearchResults([]);
      setIsSearching(false);
      setHighlightedMessage(null, null);
      return;
    }

    setIsSearching(true);
    const handler = window.setTimeout(async () => {
      const results = await searchMessages(trimmedSearch, 100);
      if (!isActive) return;
      setSearchResults(results);
      setIsSearching(false);
    }, 300);

    return () => {
      isActive = false;
      window.clearTimeout(handler);
    };
  }, [trimmedSearch]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const handleOpenResult = async (result: MessageSearchResult) => {
    const targetNodeId =
      result.isReply && result.parentNodeId ? result.parentNodeId : result.nodeId;
    await setActiveConversation(result.conversationId);
    setActiveNode(targetNodeId);
    if (result.isReply && result.parentNodeId) {
      setReplyThreadFocusNodeId(result.parentNodeId);
    }
    setHighlightedMessage(result.messageId, trimmedSearch);
    setViewMode('chat');
  };

  const resultsSummary = useMemo(() => {
    if (!showSearchResults) return '';
    if (isSearching) return 'Searching...';
    return `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`;
  }, [showSearchResults, isSearching, searchResults.length]);

  const handleNewChat = async () => {
    const title = `Chat ${conversations.size + 1}`;
    await createConversation(title, undefined, activeProjectId);
  };

  const handleNewProject = async () => {
    const title = `Project ${projects.size + 1}`;
    await createProject(title);
  };

  const handleSelectConversation = async (id: string) => {
    await setActiveConversation(id);
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      await deleteConversation(id);
    }
  };

  const handleOpenContextMenu = (event: React.MouseEvent, id: string) => {
    event.preventDefault();
    setContextMenu({ conversationId: id, x: event.clientX, y: event.clientY });
  };

  const handleRenameConversation = (id: string) => {
    const conversation = conversations.get(id);
    if (!conversation) return;
    const nextTitle = prompt('Rename chat', conversation.title);
    if (!nextTitle) return;
    const trimmed = nextTitle.trim();
    if (!trimmed) return;
    updateConversation(id, { title: trimmed });
    setContextMenu(null);
  };

  const handleMoveConversation = (id: string, projectId: string | null) => {
    updateConversation(id, { projectId: projectId ?? undefined });
    setContextMenu(null);
  };

  const handleRegenerateTitle = async (id: string) => {
    setContextMenu(null);
    try {
      await regenerateConversationTitle(id);
      addToast({
        type: 'success',
        title: 'Title regenerated',
        message: 'Chat title was updated.',
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Title regeneration failed',
        message: error instanceof Error ? error.message : 'Could not regenerate title.',
      });
    }
  };

  return (
    <aside className="w-64 h-full border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={handleNewChat}
          data-testid="new-chat"
          className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
        >
          + New Chat
        </button>
      </div>

      {/* Projects */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Projects
          </span>
          <button
            type="button"
            onClick={handleNewProject}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            + New
          </button>
        </div>
        <div className="space-y-1">
          <button
            onClick={() => setActiveProject(null)}
            className={`w-full px-3 py-2 text-left rounded-lg transition-colors text-sm ${
              activeProjectId === null
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200'
            }`}
          >
            All Chats
          </button>
          {sortedProjects.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">No projects yet</p>
          ) : (
            sortedProjects.map((project) => (
              <div key={project.id} className="group flex items-center">
                <button
                  onClick={() => setActiveProject(project.id)}
                  className={`flex-1 px-3 py-2 text-left rounded-lg transition-colors text-sm ${
                    activeProjectId === project.id
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <span className="truncate">{project.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenProjectSettings(project.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 text-xs"
                  title="Project settings"
                >
                  Edit
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-3">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search all messages..."
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
          />
          {showSearchResults && (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{resultsSummary}</div>
          )}
        </div>

        {showSearchResults ? (
          searchResults.length === 0 && !isSearching ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No matches
            </p>
          ) : (
            <ul className="space-y-2">
              {searchResults.map((result) => (
                <li key={`${result.messageId}-${result.nodeId}`}>
                  <button
                    onClick={() => handleOpenResult(result)}
                    className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                  >
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {result.projectName
                        ? `${result.projectName} · ${result.conversationTitle}`
                        : result.conversationTitle}
                    </div>
                    <div className="text-sm text-gray-800 dark:text-gray-100 mt-1">
                      {getSnippet(result.content, trimmedSearch)}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {result.role}
                      {result.isReply ? ' · reply' : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : sortedConversations.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            No conversations yet
          </p>
        ) : (
          <ul className="space-y-1">
            {sortedConversations.map((conv) => (
              <li key={conv.id}>
                <button
                  onClick={() => handleSelectConversation(conv.id)}
                  onContextMenu={(event) => handleOpenContextMenu(event, conv.id)}
                  data-testid="conversation-item"
                  data-conversation-id={conv.id}
                  data-active={activeConversationId === conv.id ? 'true' : 'false'}
                  className={`w-full px-3 py-2 text-left rounded-lg transition-colors group flex items-center justify-between ${
                    activeConversationId === conv.id
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <span className="truncate text-sm">{conv.title}</span>
                  <button
                    onClick={(e) => handleDeleteConversation(e, conv.id)}
                    data-testid="delete-conversation"
                    data-conversation-id={conv.id}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 dark:text-gray-500 hover:text-red-500 p-1"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Settings */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-800">
        <button
          onClick={() => onOpenSettings('general')}
          data-testid="open-settings"
          className="w-full px-3 py-2 text-sm text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          Settings
        </button>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-2 text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => handleRenameConversation(contextMenu.conversationId)}
            className="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              void handleRegenerateTitle(contextMenu.conversationId);
            }}
            className="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Regenerate title
          </button>
          <div className="mt-2 border-t border-gray-100 dark:border-gray-800 pt-2">
            <div className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 px-2 pb-1">
              Move to project
            </div>
            <button
              type="button"
              onClick={() => handleMoveConversation(contextMenu.conversationId, null)}
              className="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              No project
            </button>
            {sortedProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() =>
                  handleMoveConversation(contextMenu.conversationId, project.id)
                }
                className="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {project.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function getSnippet(content: string, query: string, maxLength = 140) {
  if (!content) return '';
  const normalized = content.toLowerCase();
  const idx = normalized.indexOf(query.toLowerCase());
  if (idx === -1) {
    return content.length > maxLength ? `${content.slice(0, maxLength)}...` : content;
  }
  const start = Math.max(0, idx - Math.floor(maxLength / 2));
  const end = Math.min(content.length, start + maxLength);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';
  return `${prefix}${content.slice(start, end)}${suffix}`;
}
