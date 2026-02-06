import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store';
import { ModelPicker } from '../shared/ModelPicker';
import { getReasoningParameter, REASONING_EFFORT_OPTIONS } from '../../utils/models';
import { normalizeAttachmentProcessingSettings } from '../../utils/attachments';

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;

export function ModelSidebar() {
  const {
    models,
    modelsLoading,
    modelsError,
    loadModels,
    apiKey,
    selectedModel,
    setSelectedModel,
    activeConversationId,
    conversations,
    updateConversation,
    setFlowMode,
  } = useStore(
    useShallow((state) => ({
      models: state.models,
      modelsLoading: state.modelsLoading,
      modelsError: state.modelsError,
      loadModels: state.loadModels,
      apiKey: state.apiKey,
      selectedModel: state.selectedModel,
      setSelectedModel: state.setSelectedModel,
      activeConversationId: state.activeConversationId,
      conversations: state.conversations,
      updateConversation: state.updateConversation,
      setFlowMode: state.setFlowMode,
    }))
  );

  useEffect(() => {
    loadModels();
  }, [loadModels, apiKey]);

  const activeConversation = activeConversationId
    ? conversations.get(activeConversationId)
    : null;
  const flowModeEnabled = activeConversation?.flowMode ?? false;
  const attachmentProcessing = normalizeAttachmentProcessingSettings(
    activeConversation?.attachmentProcessing
  );

  const temperatureValue = activeConversation?.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokensValue = activeConversation?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const reasoningEffortValue = activeConversation?.reasoningEffort ?? 'medium';
  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel) || null,
    [models, selectedModel]
  );
  const showReasoningEffort = getReasoningParameter(selectedModelInfo) !== null;

  const handleSelectModel = (modelId: string) => {
    setSelectedModel(modelId);
    if (activeConversationId) {
      updateConversation(activeConversationId, { model: modelId });
    }
  };

  const handleTemperatureChange = (value: number) => {
    if (!activeConversationId) return;
    updateConversation(activeConversationId, { temperature: value });
  };

  const handleMaxTokensChange = (value: number) => {
    if (!activeConversationId) return;
    updateConversation(activeConversationId, { maxTokens: value });
  };

  const handleReasoningEffortChange = (value: string) => {
    if (!activeConversationId) return;
    updateConversation(activeConversationId, { reasoningEffort: value });
  };

  const handleToggleFlowMode = (value: boolean) => {
    if (!activeConversationId) return;
    setFlowMode(activeConversationId, value);
  };

  const handleAttachmentModeChange = (mode: 'retrieval' | 'summarize') => {
    if (!activeConversationId) return;
    updateConversation(activeConversationId, {
      attachmentProcessing: {
        ...attachmentProcessing,
        mode,
      },
    });
  };

  const handleAttachmentNumberChange = (
    key: 'retrievalTopK' | 'chunkSize' | 'chunkOverlap',
    value: number
  ) => {
    if (!activeConversationId) return;
    if (!Number.isFinite(value)) return;
    updateConversation(activeConversationId, {
      attachmentProcessing: {
        ...attachmentProcessing,
        [key]: value,
      },
    });
  };

  return (
    <aside className="w-72 h-full border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-100">
          Model Settings
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Adjust model and generation parameters
        </p>
      </div>

      {!apiKey ? (
        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
          Add your OpenRouter API key to load models.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 border-b border-gray-100 dark:border-gray-800">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
              Model
            </label>
            <ModelPicker
              models={models}
              selectedModel={selectedModel}
              onSelect={handleSelectModel}
              modelsLoading={modelsLoading}
              modelsError={modelsError}
              listHeightClass="h-[40rem]"
              showSelectedHeader={false}
              pinSelectedInList
            />
          </div>

          <div className="p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                Flow Mode
              </label>
              <button
                type="button"
                onClick={() => handleToggleFlowMode(!flowModeEnabled)}
                data-testid="flow-mode-toggle"
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors ${
                  flowModeEnabled
                    ? 'border-emerald-400 text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                }`}
              >
                <span data-testid="flow-mode-state">
                  {flowModeEnabled ? 'Enabled' : 'Disabled'}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  Auto-branch messages
                </span>
              </button>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                When enabled, each new message creates a new branch from the flow root.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                Attachment Processing
              </label>
              <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1">
                <button
                  type="button"
                  onClick={() => handleAttachmentModeChange('retrieval')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    attachmentProcessing.mode === 'retrieval'
                      ? 'bg-blue-500 text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  Retrieval
                </button>
                <button
                  type="button"
                  onClick={() => handleAttachmentModeChange('summarize')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    attachmentProcessing.mode === 'summarize'
                      ? 'bg-blue-500 text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  Summarize
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Retrieval is faster for Q&A; summarize builds condensed file summaries.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                Retrieval Top K
              </label>
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={attachmentProcessing.retrievalTopK}
                onChange={(event) =>
                  handleAttachmentNumberChange('retrievalTopK', Number(event.target.value))
                }
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                Chunk Size (chars)
              </label>
              <input
                type="number"
                min={400}
                max={6000}
                step={100}
                value={attachmentProcessing.chunkSize}
                onChange={(event) =>
                  handleAttachmentNumberChange('chunkSize', Number(event.target.value))
                }
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                Chunk Overlap (chars)
              </label>
              <input
                type="number"
                min={0}
                max={5999}
                step={50}
                value={attachmentProcessing.chunkOverlap}
                onChange={(event) =>
                  handleAttachmentNumberChange('chunkOverlap', Number(event.target.value))
                }
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                Temperature
              </label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperatureValue}
                onChange={(event) => handleTemperatureChange(Number(event.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Default: {DEFAULT_TEMPERATURE}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                Max Tokens
              </label>
              <input
                type="number"
                min={64}
                step={64}
                value={maxTokensValue}
                onChange={(event) => handleMaxTokensChange(Number(event.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Default: {DEFAULT_MAX_TOKENS}
              </p>
            </div>

            {showReasoningEffort && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                  Reasoning effort
                </label>
                <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1">
                  {REASONING_EFFORT_OPTIONS.map((option) => {
                    const isActive = reasoningEffortValue === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleReasoningEffortChange(option.value)}
                        className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                          isActive
                            ? 'bg-blue-500 text-white'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Higher effort can improve reasoning at the cost of latency.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
