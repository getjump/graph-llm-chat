import { useMemo, useState } from 'react';
import type { LLMModel } from '../../types';
import { isReasoningModel } from '../../utils/models';

interface ModelPickerProps {
  models: LLMModel[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
  modelsLoading?: boolean;
  modelsError?: string | null;
  listHeightClass?: string;
  queryPlaceholder?: string;
  showSelectedHeader?: boolean;
  pinSelectedInList?: boolean;
}

export function ModelPicker({
  models,
  selectedModel,
  onSelect,
  modelsLoading,
  modelsError,
  listHeightClass = 'h-64',
  queryPlaceholder = 'Search models',
  showSelectedHeader = true,
  pinSelectedInList = true,
}: ModelPickerProps) {
  const [query, setQuery] = useState('');

  const normalized = query.trim().toLowerCase();
  const baseModels = models ?? [];

  const selectedInfo = useMemo(
    () => baseModels.find((model) => model.id === selectedModel) || null,
    [baseModels, selectedModel]
  );

  const filteredModels = useMemo(() => {
    if (!normalized) return baseModels;

    return baseModels.filter(
      (model) =>
        model.name.toLowerCase().includes(normalized) ||
        model.id.toLowerCase().includes(normalized)
    );
  }, [baseModels, normalized]);

  const pinnedModel = useMemo(() => {
    if (!selectedModel) return null;
    if (selectedInfo) return selectedInfo;
    return {
      id: selectedModel,
      name: selectedModel,
      contextLength: 0,
      pricing: { prompt: 0, completion: 0 },
    };
  }, [selectedModel, selectedInfo]);

  const displayModels = useMemo(() => {
    if (!pinSelectedInList || !selectedModel) return filteredModels;
    return filteredModels.filter((model) => model.id !== selectedModel);
  }, [filteredModels, pinSelectedInList, selectedModel]);

  const hasAnyModels = Boolean((pinSelectedInList && pinnedModel) || displayModels.length > 0);

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={queryPlaceholder}
          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
        />
        {modelsError && (
          <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Failed to load models from API. Showing popular models.
          </div>
        )}
        {modelsLoading && (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Loading models...
          </div>
        )}
      </div>

      {showSelectedHeader && (
        <div className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <span>
            Current model:{' '}
            {selectedInfo
              ? `${selectedInfo.name} (${selectedInfo.id})`
              : selectedModel || '—'}
          </span>
          {isReasoningModel(selectedInfo) && (
            <span className="rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-200 px-2 py-0.5 text-[10px] uppercase tracking-wide">
              Reasoning
            </span>
          )}
        </div>
      )}

      <div className={`${listHeightClass} overflow-y-auto`}>
        {!hasAnyModels ? (
          <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
            No models found.
          </div>
        ) : (
          <>
            {pinSelectedInList && pinnedModel && (
              <div className="sticky top-0 z-10 border-b border-blue-100 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-900">
                <ModelOption
                  model={pinnedModel}
                  selectedModel={selectedModel}
                  onSelect={onSelect}
                />
              </div>
            )}
            {displayModels.length > 0 && (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {displayModels.map((model) => (
                  <li key={model.id}>
                    <ModelOption
                      model={model}
                      selectedModel={selectedModel}
                      onSelect={onSelect}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface ModelOptionProps {
  model: LLMModel;
  selectedModel: string;
  onSelect: (modelId: string) => void;
}

function ModelOption({
  model,
  selectedModel,
  onSelect,
}: ModelOptionProps) {
  const showReasoningBadge = isReasoningModel(model);
  const hasBadges = showReasoningBadge;

  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
        selectedModel === model.id
          ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200'
          : 'text-gray-700 dark:text-gray-200'
      }`}
    >
      <div className="text-sm font-medium">{model.name}</div>
      {hasBadges && (
        <div className="mt-1 flex w-fit flex-col items-start gap-1">
          {showReasoningBadge && (
            <span className="rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-200 px-2 py-0.5 text-[10px] uppercase tracking-wide">
              Reasoning
            </span>
          )}
        </div>
      )}
      <div className="text-xs text-gray-500 dark:text-gray-400">{model.id}</div>
      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
        Prompt {formatPricePerMillion(model.pricing.prompt)} / 1M · Completion{' '}
        {formatPricePerMillion(model.pricing.completion)} / 1M
      </div>
    </button>
  );
}

function formatPricePerMillion(value: number | string | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '—';
  const perMillion = numeric * 1_000_000;
  if (perMillion >= 1) return `$${perMillion.toFixed(2)}`;
  if (perMillion >= 0.01) return `$${perMillion.toFixed(4)}`;
  return `$${perMillion.toFixed(6)}`;
}
