import { describe, expect, test } from 'vitest';
import {
  buildHeaders,
  getBundledEmbeddingFallbackModels,
  getBundledFallbackModels,
  getOpenRouterClient,
  isOpenRouterBaseUrl,
  OPENROUTER_BASE_URL,
} from './openrouter';
import {
  OPENROUTER_FALLBACK_EMBEDDING_MODELS,
  OPENROUTER_FALLBACK_MODELS,
} from '../generated/openrouterFallbackModels';

describe('openrouter headers', () => {
  test('includes OpenRouter headers for default base URL', () => {
    const headers = buildHeaders('test-key', true);

    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['HTTP-Referer']).toBe(window.location.origin);
    expect(headers['X-Title']).toBe('Graph LLM Chat');
  });

  test('omits OpenRouter headers for custom endpoint', () => {
    const headers = buildHeaders('test-key', false);

    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['HTTP-Referer']).toBeUndefined();
    expect(headers['X-Title']).toBeUndefined();
  });

  test('omits Content-Type when fetching models', () => {
    const headers = buildHeaders('test-key', true, true);

    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['Content-Type']).toBeUndefined();
  });
});

describe('OpenRouter client cache', () => {
  test('reuses client for same key and base URL', () => {
    const clientA = getOpenRouterClient('test-key', OPENROUTER_BASE_URL);
    const clientB = getOpenRouterClient('test-key', OPENROUTER_BASE_URL);

    expect(clientA).toBe(clientB);
  });

  test('creates new client for different base URL', () => {
    const clientA = getOpenRouterClient('test-key', 'https://openrouter.ai/api/v1');
    const clientB = getOpenRouterClient('test-key', 'http://localhost:11434/v1');

    expect(clientA).not.toBe(clientB);
  });
});

describe('bundled fallback models', () => {
  test('detects OpenRouter base URL', () => {
    expect(isOpenRouterBaseUrl('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouterBaseUrl('http://localhost:11434/v1')).toBe(false);
  });

  test('returns snapshot fallback for OpenRouter', () => {
    expect(getBundledFallbackModels('https://openrouter.ai/api/v1')).toEqual(
      OPENROUTER_FALLBACK_MODELS
    );
    expect(
      getBundledEmbeddingFallbackModels('https://openrouter.ai/api/v1')
    ).toEqual(OPENROUTER_FALLBACK_EMBEDDING_MODELS);
  });

  test('returns generic fallback for custom endpoints', () => {
    const fallback = getBundledFallbackModels('http://localhost:11434/v1');
    expect(fallback.length).toBeGreaterThan(0);
    expect(
      getBundledEmbeddingFallbackModels('http://localhost:11434/v1')
    ).toEqual([]);
  });
});
