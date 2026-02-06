import { useEffect, useMemo, useState } from 'react';
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import { useStore } from '../../store';

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const models = useStore((state) => state.models);
  const modelsLoading = useStore((state) => state.modelsLoading);
  const modelsError = useStore((state) => state.modelsError);
  const loadModels = useStore((state) => state.loadModels);
  const apiKey = useStore((state) => state.apiKey);

  const [query, setQuery] = useState('');

  useEffect(() => {
    loadModels();
  }, [loadModels, apiKey]);

  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return models;

    return models.filter(
      (model) =>
        model.name.toLowerCase().includes(normalized) ||
        model.id.toLowerCase().includes(normalized)
    );
  }, [models, query]);

  const handleChange = (modelId: string | null) => {
    if (!modelId) return;
    onChange(modelId);
    setQuery('');
  };

  return (
    <div className="relative w-64">
      <Combobox value={value} onChange={handleChange}>
        <div className="relative">
          <ComboboxInput
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 pr-8 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            displayValue={(modelId: string) => {
              const selected = models.find((model) => model.id === modelId);
              return selected?.name || modelId || '';
            }}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={modelsLoading ? 'Loading models...' : 'Search models...'}
          />
          <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2">
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 text-gray-400"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </ComboboxButton>
        </div>

        <ComboboxOptions className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg focus:outline-none">
          {modelsError && (
            <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Failed to load models from API. Showing popular models.
            </div>
          )}

          {modelsLoading && (
            <div className="px-3 py-2 text-sm text-gray-500">Loading models...</div>
          )}

          {!modelsLoading && filteredModels.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">No models found.</div>
          )}

          {!modelsLoading &&
            filteredModels.map((model) => (
              <ComboboxOption
                key={model.id}
                value={model.id}
                className={({ active }) =>
                  `cursor-pointer px-3 py-2 ${
                    active ? 'bg-blue-50 text-blue-900' : 'text-gray-700'
                  }`
                }
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-800">{model.name}</span>
                  <span className="text-xs text-gray-500">{model.id}</span>
                </div>
              </ComboboxOption>
            ))}
        </ComboboxOptions>
      </Combobox>
    </div>
  );
}
