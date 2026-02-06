import type { LLMModel } from '../types';

export const REASONING_EFFORT_OPTIONS = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

function normalizeSupportedParameters(model?: LLMModel | null): string[] {
  if (!model?.supportedParameters) return [];
  return model.supportedParameters
    .map((param) => param.trim().toLowerCase())
    .filter(Boolean);
}

export function getReasoningParameter(
  model?: LLMModel | null
): 'reasoning_effort' | 'reasoning' | null {
  if (!model) return null;
  const supported = normalizeSupportedParameters(model);
  if (supported.includes('reasoning_effort') || supported.includes('reasoning-effort')) {
    return 'reasoning_effort';
  }
  if (supported.includes('reasoning')) {
    return 'reasoning';
  }
  if (model.supportsReasoning) {
    return 'reasoning';
  }
  return null;
}

export function isReasoningModel(model?: LLMModel | null): boolean {
  return getReasoningParameter(model) !== null;
}

export function isLikelyEmbeddingModel(model?: LLMModel | null): boolean {
  if (!model) return false;
  const supported = normalizeSupportedParameters(model);
  if (supported.includes('embeddings') || supported.includes('embedding')) {
    return true;
  }

  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  return (
    id.includes('embedding') ||
    id.includes('embed') ||
    name.includes('embedding') ||
    name.includes('embed')
  );
}
