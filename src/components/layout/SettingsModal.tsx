import { type ReactNode, useState } from 'react';
import type {
  LLMModel,
  NormalizedToolSettings,
  ToolSettings,
  NormalizedMemorySettings,
  MemorySettings,
} from '../../types';
import { normalizeToolSettings } from '../../utils/tools';
import { normalizeMemorySettings } from '../../utils/memory';
import { ModelPicker } from '../shared/ModelPicker';
import { discoverMcpToolNames } from '../../tools/mcpTools';

export type SettingsTab = 'general' | 'custom' | 'memory' | 'tools';

interface SettingsModalProps {
  isOpen: boolean;
  apiKey: string;
  apiBaseUrl: string;
  customProfile: string;
  customResponseStyle: string;
  autoTitleEnabled: boolean;
  autoTitleModel: string;
  embeddingModel: string;
  memorySettings: NormalizedMemorySettings;
  toolSettings: NormalizedToolSettings;
  selectedModel: string;
  models: LLMModel[];
  embeddingModels: LLMModel[];
  modelsLoading: boolean;
  modelsError: string | null;
  initialTab?: SettingsTab;
  onClose: () => void;
  onSave: (
    apiKey: string,
    apiBaseUrl: string,
    customProfile: string,
    customResponseStyle: string,
    autoTitleEnabled: boolean,
    autoTitleModel: string,
    embeddingModel: string,
    toolSettings: ToolSettings,
    memorySettings: MemorySettings
  ) => void;
}

export function SettingsModal({
  isOpen,
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
  initialTab = 'general',
  onClose,
  onSave,
}: SettingsModalProps) {
  const [localKey, setLocalKey] = useState(apiKey);
  const [localBaseUrl, setLocalBaseUrl] = useState(apiBaseUrl);
  const [localProfile, setLocalProfile] = useState(customProfile);
  const [localResponseStyle, setLocalResponseStyle] = useState(customResponseStyle);
  const [localAutoTitleEnabled, setLocalAutoTitleEnabled] = useState(autoTitleEnabled);
  const [localAutoTitleModel, setLocalAutoTitleModel] = useState(autoTitleModel);
  const [localEmbeddingModel, setLocalEmbeddingModel] = useState(embeddingModel);
  const [localMemorySettings, setLocalMemorySettings] = useState(
    normalizeMemorySettings(memorySettings)
  );
  const [localToolSettings, setLocalToolSettings] = useState(
    normalizeToolSettings(toolSettings)
  );
  const [mcpDiscoveringById, setMcpDiscoveringById] = useState<Record<string, boolean>>(
    {}
  );
  const [mcpDiscoveryErrorById, setMcpDiscoveryErrorById] = useState<
    Record<string, string | null>
  >({});
  const [mcpDiscoveredToolsById, setMcpDiscoveredToolsById] = useState<
    Record<string, string[]>
  >({});
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const sensitiveToolsCsv = localToolSettings.permissions.sensitiveTools.join(', ');
  const getDefaultServerName = (index: number) => `MCP ${index + 1}`;
  const generateServerId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const updateMcpServer = (
    serverId: string,
    updater: (
      server: (typeof localToolSettings.mcp.servers)[number]
    ) => (typeof localToolSettings.mcp.servers)[number]
  ) => {
    setLocalToolSettings((prev) => ({
      ...prev,
      mcp: {
        ...prev.mcp,
        servers: prev.mcp.servers.map((server) =>
          server.id === serverId ? updater(server) : server
        ),
      },
    }));
  };

  const handleAddMcpServer = () => {
    setLocalToolSettings((prev) => {
      const nextIndex = prev.mcp.servers.length;
      const nextServer = {
        id: generateServerId(),
        name: getDefaultServerName(nextIndex),
        enabled: true,
        url: '',
        transport: 'http' as const,
        authToken: '',
        enabledTools: [],
      };
      return {
        ...prev,
        mcp: {
          ...prev.mcp,
          servers: [...prev.mcp.servers, nextServer],
        },
      };
    });
  };

  const handleRemoveMcpServer = (serverId: string) => {
    setLocalToolSettings((prev) => {
      if (prev.mcp.servers.length <= 1) {
        return prev;
      }
      return {
        ...prev,
        mcp: {
          ...prev.mcp,
          servers: prev.mcp.servers.filter((server) => server.id !== serverId),
        },
      };
    });
    setMcpDiscoveredToolsById((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
    setMcpDiscoveryErrorById((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
    setMcpDiscoveringById((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
  };

  const handleDiscoverMcpTools = async (serverId: string) => {
    const server = localToolSettings.mcp.servers.find((item) => item.id === serverId);
    if (!server || !server.url.trim()) {
      setMcpDiscoveryErrorById((prev) => ({ ...prev, [serverId]: 'Set MCP URL first.' }));
      return;
    }
    setMcpDiscoveringById((prev) => ({ ...prev, [serverId]: true }));
    setMcpDiscoveryErrorById((prev) => ({ ...prev, [serverId]: null }));
    try {
      const discovered = await discoverMcpToolNames({
        url: server.url.trim(),
        transport: server.transport,
        authToken: server.authToken.trim() || undefined,
      });
      setMcpDiscoveredToolsById((prev) => ({ ...prev, [serverId]: discovered }));
    } catch (error) {
      setMcpDiscoveryErrorById((prev) => ({
        ...prev,
        [serverId]:
          error instanceof Error ? error.message : 'Failed to discover MCP tools',
      }));
    } finally {
      setMcpDiscoveringById((prev) => ({ ...prev, [serverId]: false }));
    }
  };

  const toggleEnabledMcpTool = (serverId: string, toolName: string, checked: boolean) => {
    const discoveredForServer = mcpDiscoveredToolsById[serverId] || [];
    updateMcpServer(serverId, (server) => {
      const current =
        server.enabledTools.length === 0
          ? new Set(discoveredForServer)
          : new Set(server.enabledTools);
      if (checked) {
        current.add(toolName);
      } else {
        current.delete(toolName);
      }
      return {
        ...server,
        enabledTools: Array.from(current),
      };
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      data-testid="settings-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="close-settings"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Close
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex gap-2 border-b border-gray-100 dark:border-gray-800">
            <SettingsTabButton
              id="settings-tab-general"
              active={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
              label="General"
            />
            <SettingsTabButton
              id="settings-tab-custom"
              active={activeTab === 'custom'}
              onClick={() => setActiveTab('custom')}
              label="Customize"
            />
            <SettingsTabButton
              id="settings-tab-tools"
              active={activeTab === 'tools'}
              onClick={() => setActiveTab('tools')}
              label="Tools"
            />
            <SettingsTabButton
              id="settings-tab-memory"
              active={activeTab === 'memory'}
              onClick={() => setActiveTab('memory')}
              label="Memory"
            />
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[68vh] overflow-y-auto">
          {activeTab === 'general' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={localKey}
                  onChange={(e) => setLocalKey(e.target.value)}
                  placeholder="sk-or-..."
                  data-testid="api-key-input"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  API Base URL
                </label>
                <input
                  type="text"
                  value={localBaseUrl}
                  onChange={(e) => setLocalBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  data-testid="api-base-url-input"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Use an OpenAI-compatible endpoint (e.g., Ollama).
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  Embedding model (RAG)
                </label>
                {embeddingModels.length > 0 && (
                  <div data-testid="embedding-model-picker">
                    <ModelPicker
                      models={embeddingModels}
                      selectedModel={localEmbeddingModel || embeddingModel || selectedModel}
                      onSelect={(modelId) => setLocalEmbeddingModel(modelId)}
                      modelsLoading={modelsLoading}
                      modelsError={modelsError}
                      listHeightClass="h-48"
                      showSelectedHeader={false}
                      queryPlaceholder="Search embedding models"
                    />
                  </div>
                )}
                {embeddingModels.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    No embedding models were detected from this endpoint.
                  </p>
                )}
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Manual embedding model ID
                  </label>
                  <input
                    type="text"
                    value={localEmbeddingModel}
                    onChange={(e) => setLocalEmbeddingModel(e.target.value)}
                    placeholder="e.g. openai/text-embedding-3-small"
                    data-testid="embedding-model-input"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Used for browser RAG indexing and hybrid retrieval.
                </p>
              </div>
            </>
          ) : activeTab === 'custom' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  What should the assistant know about you?
                </label>
                <textarea
                  value={localProfile}
                  onChange={(e) => setLocalProfile(e.target.value)}
                  placeholder="Role, goals, domain, preferences."
                  data-testid="custom-profile-input"
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  How should the assistant respond?
                </label>
                <textarea
                  value={localResponseStyle}
                  onChange={(e) => setLocalResponseStyle(e.target.value)}
                  placeholder="Tone, format, verbosity, language."
                  data-testid="custom-response-style-input"
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  These instructions will be added to every request as system context.
                </p>
              </div>

              <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localAutoTitleEnabled}
                    onChange={(e) => {
                      const nextValue = e.target.checked;
                      setLocalAutoTitleEnabled(nextValue);
                      if (nextValue && !localAutoTitleModel) {
                        setLocalAutoTitleModel(selectedModel);
                      }
                    }}
                    data-testid="auto-title-toggle"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Auto-generate chat titles with LLM
                </label>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Generates a descriptive title after the first assistant response.
                </p>
              </div>

              {localAutoTitleEnabled && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Title model
                  </label>
                  <div data-testid="auto-title-model">
                    <ModelPicker
                      models={models}
                      selectedModel={localAutoTitleModel || selectedModel}
                      onSelect={(modelId) => setLocalAutoTitleModel(modelId)}
                      modelsLoading={modelsLoading}
                      modelsError={modelsError}
                      listHeightClass="h-48"
                      showSelectedHeader={false}
                      queryPlaceholder="Search title models"
                    />
                  </div>
                </div>
              )}
            </>
          ) : activeTab === 'memory' ? (
            <>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localMemorySettings.enabled}
                    onChange={(e) =>
                      setLocalMemorySettings((prev) => ({
                        ...prev,
                        enabled: e.target.checked,
                      }))
                    }
                    data-testid="memory-enabled-toggle"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Enable Memory
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Persist user/project facts and inject relevant memories into prompts.
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Scope
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localMemorySettings.includeConversation}
                    onChange={(e) =>
                      setLocalMemorySettings((prev) => ({
                        ...prev,
                        includeConversation: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Conversation memories
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localMemorySettings.includeProject}
                    onChange={(e) =>
                      setLocalMemorySettings((prev) => ({
                        ...prev,
                        includeProject: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Project memories
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localMemorySettings.includeUser}
                    onChange={(e) =>
                      setLocalMemorySettings((prev) => ({
                        ...prev,
                        includeUser: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Global user memories
                </label>
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Extraction
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localMemorySettings.autoExtractUser}
                    onChange={(e) =>
                      setLocalMemorySettings((prev) => ({
                        ...prev,
                        autoExtractUser: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Extract from user messages
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localMemorySettings.autoExtractAssistant}
                    onChange={(e) =>
                      setLocalMemorySettings((prev) => ({
                        ...prev,
                        autoExtractAssistant: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Extract from assistant messages
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      Max memories per message
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={localMemorySettings.maxPerMessage}
                      onChange={(e) =>
                        setLocalMemorySettings((prev) => ({
                          ...prev,
                          maxPerMessage: Number(e.target.value || prev.maxPerMessage),
                        }))
                      }
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      Minimum confidence
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={localMemorySettings.minConfidence}
                      onChange={(e) =>
                        setLocalMemorySettings((prev) => ({
                          ...prev,
                          minConfidence: Number(e.target.value || prev.minConfidence),
                        }))
                      }
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Retrieval
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Max retrieved memories
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={localMemorySettings.maxRetrieved}
                    onChange={(e) =>
                      setLocalMemorySettings((prev) => ({
                        ...prev,
                        maxRetrieved: Number(e.target.value || prev.maxRetrieved),
                      }))
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.enabled}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        enabled: e.target.checked,
                      }))
                    }
                    data-testid="tools-enabled-toggle"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Enable AI SDK Tool Calling
                </label>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Vendor-neutral tools execution loop for OpenAI-compatible models.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Max tool steps
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={localToolSettings.maxSteps}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        maxSteps: Number(e.target.value || prev.maxSteps),
                      }))
                    }
                    data-testid="tools-max-steps-input"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
                <label className="mt-6 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.showEvents}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        showEvents: e.target.checked,
                      }))
                    }
                    data-testid="tools-show-events-toggle"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Show tool events in chat
                </label>
              </div>

              <ToolCard title="permissions">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.permissions.requireConfirmation}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        permissions: {
                          ...prev.permissions,
                          requireConfirmation: e.target.checked,
                        },
                      }))
                    }
                    data-testid="tool-permission-require-confirmation"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Ask before running sensitive tools
                </label>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Sensitive tool patterns (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={sensitiveToolsCsv}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        permissions: {
                          ...prev.permissions,
                          sensitiveTools: e.target.value
                            .split(',')
                            .map((entry) => entry.trim())
                            .filter(Boolean),
                        },
                      }))
                    }
                    placeholder="search_messages, read_attached_file, daytona_exec, mcp:*"
                    data-testid="tool-permission-sensitive-tools"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
              </ToolCard>

              <ToolCard title="mcp (external tools)">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.mcp.enabled}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        mcp: { ...prev.mcp, enabled: e.target.checked },
                      }))
                    }
                    data-testid="tool-mcp-enabled"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Enable MCP tools
                </label>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Configure multiple MCP servers.
                  </span>
                  <button
                    type="button"
                    onClick={handleAddMcpServer}
                    className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                  >
                    + Add server
                  </button>
                </div>
                <div className="space-y-3">
                  {localToolSettings.mcp.servers.map((server, serverIndex) => {
                    const discoveredTools = mcpDiscoveredToolsById[server.id] || [];
                    const isDiscovering = Boolean(mcpDiscoveringById[server.id]);
                    const discoveryError = mcpDiscoveryErrorById[server.id];
                    return (
                      <div
                        key={server.id}
                        className="rounded-md border border-gray-200 dark:border-gray-700 p-3 space-y-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={server.name}
                            onChange={(e) =>
                              updateMcpServer(server.id, (prev) => ({
                                ...prev,
                                name: e.target.value,
                              }))
                            }
                            placeholder={getDefaultServerName(serverIndex)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                          />
                          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                            <input
                              type="checkbox"
                              checked={server.enabled}
                              onChange={(e) =>
                                updateMcpServer(server.id, (prev) => ({
                                  ...prev,
                                  enabled: e.target.checked,
                                }))
                              }
                            />
                            Enabled
                          </label>
                          <button
                            type="button"
                            onClick={() => handleRemoveMcpServer(server.id)}
                            disabled={localToolSettings.mcp.servers.length <= 1}
                            className="px-2 py-1 text-xs rounded-md border border-red-300 text-red-600 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                              MCP URL
                            </label>
                            <input
                              type="text"
                              value={server.url}
                              onChange={(e) =>
                                updateMcpServer(server.id, (prev) => ({
                                  ...prev,
                                  url: e.target.value,
                                }))
                              }
                              placeholder="https://your-mcp-server.example.com/mcp"
                              data-testid={`tool-mcp-url-${serverIndex}`}
                              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                              Transport
                            </label>
                            <select
                              value={server.transport}
                              onChange={(e) =>
                                updateMcpServer(server.id, (prev) => ({
                                  ...prev,
                                  transport: e.target.value === 'sse' ? 'sse' : 'http',
                                }))
                              }
                              data-testid={`tool-mcp-transport-${serverIndex}`}
                              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                            >
                              <option value="http">HTTP</option>
                              <option value="sse">SSE</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                            Auth token (optional)
                          </label>
                          <input
                            type="password"
                            value={server.authToken}
                            onChange={(e) =>
                              updateMcpServer(server.id, (prev) => ({
                                ...prev,
                                authToken: e.target.value,
                              }))
                            }
                            data-testid={`tool-mcp-auth-token-${serverIndex}`}
                            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDiscoverMcpTools(server.id)}
                            className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
                          >
                            {isDiscovering ? 'Discovering...' : 'Discover tools'}
                          </button>
                          {discoveryError && (
                            <span className="text-xs text-red-600 dark:text-red-400">
                              {discoveryError}
                            </span>
                          )}
                        </div>
                        {discoveredTools.length > 0 && (
                          <div className="rounded-md border border-gray-200 dark:border-gray-700 p-2 space-y-1">
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Enable specific tools:
                            </div>
                            {discoveredTools.map((toolName) => {
                              const checked =
                                server.enabledTools.length === 0 ||
                                server.enabledTools.includes(toolName);
                              return (
                                <label
                                  key={`${server.id}-${toolName}`}
                                  className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) =>
                                      toggleEnabledMcpTool(server.id, toolName, e.target.checked)
                                    }
                                  />
                                  {toolName}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ToolCard>

              <ToolCard title="datetime_now">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.datetimeNow.enabled}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        datetimeNow: { enabled: e.target.checked },
                      }))
                    }
                    data-testid="tool-datetime-enabled"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Enabled
                </label>
              </ToolCard>

              <ToolCard title="calculator">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.calculator.enabled}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        calculator: { ...prev.calculator, enabled: e.target.checked },
                      }))
                    }
                    data-testid="tool-calculator-enabled"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Enabled
                </label>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Max expression length
                  </label>
                  <input
                    type="number"
                    min={32}
                    max={2000}
                    value={localToolSettings.calculator.maxExpressionLength}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        calculator: {
                          ...prev.calculator,
                          maxExpressionLength: Number(
                            e.target.value || prev.calculator.maxExpressionLength
                          ),
                        },
                      }))
                    }
                    data-testid="tool-calculator-max-length"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
              </ToolCard>

              <ToolCard title="search_messages">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.searchMessages.enabled}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        searchMessages: {
                          ...prev.searchMessages,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                    data-testid="tool-search-messages-enabled"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Enabled
                </label>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Max results
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={localToolSettings.searchMessages.maxResults}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        searchMessages: {
                          ...prev.searchMessages,
                          maxResults: Number(e.target.value || prev.searchMessages.maxResults),
                        },
                      }))
                    }
                    data-testid="tool-search-messages-max-results"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
              </ToolCard>

              <ToolCard title="search_context_chunks">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.searchContextChunks.enabled}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        searchContextChunks: {
                          ...prev.searchContextChunks,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                    data-testid="tool-search-context-enabled"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Enabled
                </label>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Max results
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={localToolSettings.searchContextChunks.maxResults}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        searchContextChunks: {
                          ...prev.searchContextChunks,
                          maxResults: Number(
                            e.target.value || prev.searchContextChunks.maxResults
                          ),
                        },
                      }))
                    }
                    data-testid="tool-search-context-max-results"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
              </ToolCard>

              <ToolCard title="attachment_reader">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.attachmentReader.enabled}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        attachmentReader: {
                          ...prev.attachmentReader,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                    data-testid="tool-attachment-reader-enabled"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Enabled
                </label>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Max chars per read
                  </label>
                  <input
                    type="number"
                    min={1000}
                    max={50000}
                    value={localToolSettings.attachmentReader.maxCharsPerRead}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        attachmentReader: {
                          ...prev.attachmentReader,
                          maxCharsPerRead: Number(
                            e.target.value || prev.attachmentReader.maxCharsPerRead
                          ),
                        },
                      }))
                    }
                    data-testid="tool-attachment-reader-max-chars"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
              </ToolCard>

              <ToolCard title="daytona_exec">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={localToolSettings.daytona.enabled}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        daytona: { ...prev.daytona, enabled: e.target.checked },
                      }))
                    }
                    data-testid="tool-daytona-enabled"
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Enabled
                </label>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Daytona API key
                  </label>
                  <input
                    type="password"
                    value={localToolSettings.daytona.apiKey}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        daytona: { ...prev.daytona, apiKey: e.target.value },
                      }))
                    }
                    placeholder="DAYTONA_API_KEY"
                    data-testid="tool-daytona-api-key"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      API URL (optional)
                    </label>
                    <input
                      type="text"
                      value={localToolSettings.daytona.apiUrl}
                      onChange={(e) =>
                        setLocalToolSettings((prev) => ({
                          ...prev,
                          daytona: { ...prev.daytona, apiUrl: e.target.value },
                        }))
                      }
                      placeholder="https://your-daytona-api"
                      data-testid="tool-daytona-api-url"
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      Target (optional)
                    </label>
                    <input
                      type="text"
                      value={localToolSettings.daytona.target}
                      onChange={(e) =>
                        setLocalToolSettings((prev) => ({
                          ...prev,
                          daytona: { ...prev.daytona, target: e.target.value },
                        }))
                      }
                      placeholder="us / eu / local"
                      data-testid="tool-daytona-target"
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Default sandbox ID (optional)
                  </label>
                  <input
                    type="text"
                    value={localToolSettings.daytona.sandboxId}
                    onChange={(e) =>
                      setLocalToolSettings((prev) => ({
                        ...prev,
                        daytona: { ...prev.daytona, sandboxId: e.target.value },
                      }))
                    }
                    placeholder="sandbox-id"
                    data-testid="tool-daytona-sandbox-id"
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      Default language
                    </label>
                    <select
                      value={localToolSettings.daytona.defaultLanguage}
                      onChange={(e) =>
                        setLocalToolSettings((prev) => ({
                          ...prev,
                          daytona: {
                            ...prev.daytona,
                            defaultLanguage: e.target.value as
                              | 'typescript'
                              | 'javascript'
                              | 'python'
                              | 'go'
                              | 'rust',
                          },
                        }))
                      }
                      data-testid="tool-daytona-language"
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    >
                      <option value="typescript">TypeScript</option>
                      <option value="javascript">JavaScript</option>
                      <option value="python">Python</option>
                      <option value="go">Go</option>
                      <option value="rust">Rust</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      Default timeout (sec)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={600}
                      value={localToolSettings.daytona.defaultTimeoutSeconds}
                      onChange={(e) =>
                        setLocalToolSettings((prev) => ({
                          ...prev,
                          daytona: {
                            ...prev.daytona,
                            defaultTimeoutSeconds: Number(
                              e.target.value || prev.daytona.defaultTimeoutSeconds
                            ),
                          },
                        }))
                      }
                      data-testid="tool-daytona-timeout"
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={localToolSettings.daytona.autoCreateSandbox}
                      onChange={(e) =>
                        setLocalToolSettings((prev) => ({
                          ...prev,
                          daytona: {
                            ...prev.daytona,
                            autoCreateSandbox: e.target.checked,
                          },
                        }))
                      }
                      data-testid="tool-daytona-auto-create"
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    Auto-create sandbox when missing
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={localToolSettings.daytona.autoDeleteCreatedSandbox}
                      onChange={(e) =>
                        setLocalToolSettings((prev) => ({
                          ...prev,
                          daytona: {
                            ...prev.daytona,
                            autoDeleteCreatedSandbox: e.target.checked,
                          },
                        }))
                      }
                      data-testid="tool-daytona-auto-delete"
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    Auto-delete created sandbox
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      Max stdout chars
                    </label>
                    <input
                      type="number"
                      min={500}
                      max={50000}
                      value={localToolSettings.daytona.maxStdoutChars}
                      onChange={(e) =>
                        setLocalToolSettings((prev) => ({
                          ...prev,
                          daytona: {
                            ...prev.daytona,
                            maxStdoutChars: Number(
                              e.target.value || prev.daytona.maxStdoutChars
                            ),
                          },
                        }))
                      }
                      data-testid="tool-daytona-max-stdout"
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                      Max stderr chars
                    </label>
                    <input
                      type="number"
                      min={500}
                      max={50000}
                      value={localToolSettings.daytona.maxStderrChars}
                      onChange={(e) =>
                        setLocalToolSettings((prev) => ({
                          ...prev,
                          daytona: {
                            ...prev.daytona,
                            maxStderrChars: Number(
                              e.target.value || prev.daytona.maxStderrChars
                            ),
                          },
                        }))
                      }
                      data-testid="tool-daytona-max-stderr"
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    />
                  </div>
                </div>
              </ToolCard>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            data-testid="cancel-settings"
            className="px-3 py-2 text-sm text-gray-600 dark:text-gray-200 hover:text-gray-800 dark:hover:text-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave(
                localKey,
                localBaseUrl,
                localProfile,
                localResponseStyle,
                localAutoTitleEnabled,
                localAutoTitleModel || selectedModel,
                localEmbeddingModel || embeddingModel || selectedModel,
                normalizeToolSettings(localToolSettings),
                normalizeMemorySettings(localMemorySettings)
              )
            }
            data-testid="save-settings"
            className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-black"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsTabButton({
  id,
  active,
  onClick,
  label,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      data-testid={id}
      onClick={onClick}
      className={`px-3 py-2 text-sm rounded-t-lg ${
        active
          ? 'text-gray-900 dark:text-gray-100 border border-b-0 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

function ToolCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Tool: {title}
      </div>
      {children}
    </div>
  );
}
