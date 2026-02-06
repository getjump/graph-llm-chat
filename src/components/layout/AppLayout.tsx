import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ChatView } from '../chat/ChatView';
import { GraphView } from '../graph/GraphView';
import { ModelSidebar } from './ModelSidebar';
import { ContextView } from '../context/ContextView';
import { ToastContainer } from '../shared/ToastContainer';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { SettingsModal, type SettingsTab } from './SettingsModal';
import { ProjectSettingsModal } from './ProjectSettingsModal';

export function AppLayout() {
  const {
    viewMode,
    isInitialized,
    initialize,
    loadModels,
    activeConversationId,
    conversations,
    apiKey,
    apiBaseUrl,
    customProfile,
    customResponseStyle,
    autoTitleEnabled,
    autoTitleModel,
    embeddingModel,
    memorySettings,
    toolSettings,
    selectedModel,
    models,
    embeddingModels,
    modelsLoading,
    modelsError,
    projects,
    theme,
    setApiKey,
    setApiBaseUrl,
    setCustomProfile,
    setCustomResponseStyle,
    setAutoTitleEnabled,
    setAutoTitleModel,
    setEmbeddingModel,
    setToolSettings,
    setMemorySettings,
    addToast,
  } = useStore(
    useShallow((state) => ({
      viewMode: state.viewMode,
      isInitialized: state.isInitialized,
      initialize: state.initialize,
      loadModels: state.loadModels,
      activeConversationId: state.activeConversationId,
      conversations: state.conversations,
      apiKey: state.apiKey,
      apiBaseUrl: state.apiBaseUrl,
      customProfile: state.customProfile,
      customResponseStyle: state.customResponseStyle,
      autoTitleEnabled: state.autoTitleEnabled,
      autoTitleModel: state.autoTitleModel,
      embeddingModel: state.embeddingModel,
      memorySettings: state.memorySettings,
      toolSettings: state.toolSettings,
      selectedModel: state.selectedModel,
      models: state.models,
      embeddingModels: state.embeddingModels,
      modelsLoading: state.modelsLoading,
      modelsError: state.modelsError,
      projects: state.projects,
      theme: state.theme,
      setApiKey: state.setApiKey,
      setApiBaseUrl: state.setApiBaseUrl,
      setCustomProfile: state.setCustomProfile,
      setCustomResponseStyle: state.setCustomResponseStyle,
      setAutoTitleEnabled: state.setAutoTitleEnabled,
      setAutoTitleModel: state.setAutoTitleModel,
      setEmbeddingModel: state.setEmbeddingModel,
      setToolSettings: state.setToolSettings,
      setMemorySettings: state.setMemorySettings,
      addToast: state.addToast,
    }))
  );
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = useState(false);
  const [projectSettingsId, setProjectSettingsId] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  useEffect(() => {
    if (!apiKey) return;
    void loadModels();
  }, [apiKey, apiBaseUrl, loadModels]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const isDark = theme === 'dark';

    root.classList.toggle('dark', isDark);
    body.classList.toggle('dark', isDark);

    const colorScheme = isDark ? 'dark' : 'light';
    root.style.colorScheme = colorScheme;
    body.style.colorScheme = colorScheme;
  }, [theme]);

  useEffect(() => {
    const fallbackTitle = 'Graph LLM Chat | Visual AI Workspace';
    if (!activeConversationId) {
      document.title = fallbackTitle;
      return;
    }

    const conversation = conversations.get(activeConversationId);
    const conversationTitle = conversation?.title?.trim();
    document.title = conversationTitle || fallbackTitle;
  }, [activeConversationId, conversations]);

  if (!isInitialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
      <div className="h-screen flex flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        <ErrorBoundary>
          <Header
            isLeftSidebarOpen={isLeftSidebarOpen}
            isRightSidebarOpen={isRightSidebarOpen}
            onToggleLeftSidebar={() => setIsLeftSidebarOpen((value) => !value)}
            onToggleRightSidebar={() => setIsRightSidebarOpen((value) => !value)}
          />
          <div className="flex-1 flex overflow-hidden">
            {isLeftSidebarOpen && (
              <Sidebar
                onOpenSettings={(tab = 'general') => {
                  setSettingsTab(tab);
                  setIsSettingsOpen(true);
                }}
                onOpenProjectSettings={(projectId) => {
                  setProjectSettingsId(projectId);
                  setIsProjectSettingsOpen(true);
                }}
              />
            )}
            <main className="flex-1 overflow-hidden">
              {!apiKey ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center p-8 max-w-md">
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
                      Welcome to Graph LLM Chat
                    </h2>
                    <p className="text-gray-600 dark:text-gray-300 mb-4">
                      To get started, please add your OpenRouter API key in Settings.
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Get your API key at{' '}
                      <a
                        href="https://openrouter.ai/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        openrouter.ai/keys
                      </a>
                    </p>
                  </div>
                </div>
              ) : !activeConversationId ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center p-8">
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
                      No conversation selected
                    </h2>
                    <p className="text-gray-600 dark:text-gray-300">
                      Create a new chat or select an existing one from the sidebar.
                    </p>
                  </div>
                </div>
              ) : viewMode === 'chat' ? (
                <ChatView />
              ) : viewMode === 'graph' ? (
                <GraphView />
              ) : (
                <ContextView />
              )}
            </main>
            {isRightSidebarOpen && <ModelSidebar />}
          </div>
          {isSettingsOpen && (
            <SettingsModal
              isOpen={isSettingsOpen}
              apiKey={apiKey}
              apiBaseUrl={apiBaseUrl}
              customProfile={customProfile}
              customResponseStyle={customResponseStyle}
              autoTitleEnabled={autoTitleEnabled}
              autoTitleModel={autoTitleModel}
              embeddingModel={embeddingModel}
              memorySettings={memorySettings}
              toolSettings={toolSettings}
              selectedModel={selectedModel}
              models={models}
              embeddingModels={embeddingModels}
              modelsLoading={modelsLoading}
              modelsError={modelsError}
              initialTab={settingsTab}
              onClose={() => setIsSettingsOpen(false)}
              onSave={(
                nextKey,
                nextBaseUrl,
                nextProfile,
                nextStyle,
                nextAutoTitleEnabled,
                nextAutoTitleModel,
                nextEmbeddingModel,
                nextToolSettings,
                nextMemorySettings
              ) => {
                setApiKey(nextKey);
                setApiBaseUrl(nextBaseUrl);
                setCustomProfile(nextProfile);
                setCustomResponseStyle(nextStyle);
                setAutoTitleEnabled(nextAutoTitleEnabled);
                setAutoTitleModel(nextAutoTitleModel);
                setEmbeddingModel(nextEmbeddingModel);
                setToolSettings(nextToolSettings);
                setMemorySettings(nextMemorySettings);
                addToast({
                  type: 'success',
                  title: 'Settings saved',
                  message: 'Settings updated successfully.',
                });
                setIsSettingsOpen(false);
              }}
            />
          )}
          <ProjectSettingsModal
            isOpen={isProjectSettingsOpen}
            project={projectSettingsId ? projects.get(projectSettingsId) || null : null}
            onClose={() => {
              setIsProjectSettingsOpen(false);
              setProjectSettingsId(null);
            }}
          />
          <ToastContainer />
        </ErrorBoundary>
      </div>
    </div>
  );
}
