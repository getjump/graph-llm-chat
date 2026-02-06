import { describe, expect, it } from 'vitest';
import { getReasoningParameter, isLikelyEmbeddingModel, isReasoningModel } from './models';
import type { LLMModel } from '../types';

describe('models utils', () => {
  it('returns null for missing model', () => {
    expect(getReasoningParameter(null)).toBeNull();
    expect(isReasoningModel(undefined)).toBe(false);
  });

  it('detects reasoning_effort support', () => {
    const model: LLMModel = {
      id: 'test/reasoning-effort',
      name: 'Reasoning Effort',
      contextLength: 4096,
      pricing: { prompt: 0, completion: 0 },
      supportedParameters: ['Reasoning_Effort'],
    };
    expect(getReasoningParameter(model)).toBe('reasoning_effort');
    expect(isReasoningModel(model)).toBe(true);
  });

  it('detects reasoning support via parameters', () => {
    const model: LLMModel = {
      id: 'test/reasoning',
      name: 'Reasoning',
      contextLength: 4096,
      pricing: { prompt: 0, completion: 0 },
      supportedParameters: [' reasoning '],
    };
    expect(getReasoningParameter(model)).toBe('reasoning');
    expect(isReasoningModel(model)).toBe(true);
  });

  it('falls back to supportsReasoning flag', () => {
    const model: LLMModel = {
      id: 'test/flag',
      name: 'Flag',
      contextLength: 4096,
      pricing: { prompt: 0, completion: 0 },
      supportsReasoning: true,
    };
    expect(getReasoningParameter(model)).toBe('reasoning');
    expect(isReasoningModel(model)).toBe(true);
  });

  it('returns null when no reasoning support is found', () => {
    const model: LLMModel = {
      id: 'test/plain',
      name: 'Plain',
      contextLength: 4096,
      pricing: { prompt: 0, completion: 0 },
      supportedParameters: ['temperature', 'max_tokens'],
    };
    expect(getReasoningParameter(model)).toBeNull();
    expect(isReasoningModel(model)).toBe(false);
  });

  it('detects likely embedding model', () => {
    const model: LLMModel = {
      id: 'openai/text-embedding-3-small',
      name: 'text-embedding-3-small',
      contextLength: 8192,
      pricing: { prompt: 0, completion: 0 },
      supportedParameters: ['embeddings'],
    };
    expect(isLikelyEmbeddingModel(model)).toBe(true);
    expect(isLikelyEmbeddingModel(null)).toBe(false);
  });
});
