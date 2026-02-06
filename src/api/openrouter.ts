import type { LLMModel } from '../types';
import {
  OPENROUTER_FALLBACK_EMBEDDING_MODELS,
  OPENROUTER_FALLBACK_MODELS,
} from '../generated/openrouterFallbackModels';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Models cache
interface ModelsCache {
  models: LLMModel[];
  timestamp: number;
}

const CACHE_KEY = 'openrouter_models_cache_v2';
const EMBEDDINGS_CACHE_KEY = 'openrouter_embedding_models_cache_v1';
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const POPULAR_MODELS_MINIMAL = [
  { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
  { id: 'mistralai/mixtral-8x7b-instruct', name: 'Mixtral 8x7B' },
] as const;

const GENERIC_FALLBACK_MODELS: LLMModel[] = POPULAR_MODELS_MINIMAL.map((model) => ({
  ...model,
  contextLength: 4096,
  pricing: {
    prompt: 0,
    completion: 0,
  },
  supportedParameters: [],
  supportsReasoning: false,
}));

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: string;
  reasoning?: {
    effort?: string;
  };
  stream?: boolean;
}

interface EmbeddingRequest {
  model: string;
  input: string | string[];
}

interface StreamChoice {
  delta: {
    content?: string;
    role?: string;
  };
  finish_reason: string | null;
  index: number;
}

interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;
  private isOpenRouter: boolean;

  constructor(apiKey: string, baseUrl: string = OPENROUTER_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.isOpenRouter = baseUrl.includes('openrouter.ai');
  }

  /**
   * Stream chat completion from OpenRouter
   * Yields content chunks as they arrive
   */
  async *streamChatCompletion(
    request: ChatCompletionRequest,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(this.apiKey, this.isOpenRouter),
      body: JSON.stringify({ ...request, stream: true }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'API request failed' }));
      throw new Error(error.error?.message || error.message || 'API request failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // SSE comment

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;

            try {
              const chunk: StreamChunk = JSON.parse(data);
              const content = chunk.choices[0]?.delta?.content;
              if (content) yield content;
            } catch {
              // Ignore parse errors for malformed chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Non-streaming chat completion
   */
  async chatCompletion(
    request: ChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(this.apiKey, this.isOpenRouter),
      body: JSON.stringify({ ...request, stream: false }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'API request failed' }));
      throw new Error(error.error?.message || error.message || 'API request failed');
    }

    const data = await response.json();
    return extractMessageText(data.choices?.[0]?.message).trim();
  }

  /**
   * Get available models from OpenRouter
   */
  async getModels(): Promise<LLMModel[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: buildHeaders(this.apiKey, this.isOpenRouter, true),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    return extractModelList(data).map(mapApiModel);
  }

  async getEmbeddingModels(): Promise<LLMModel[]> {
    const headers = buildHeaders(this.apiKey, this.isOpenRouter, true);

    // Preferred OpenRouter endpoint
    try {
      const preferred = await fetch(`${this.baseUrl}/embeddings/models`, { headers });
      if (preferred.ok) {
        const payload = await preferred.json();
        const preferredRaw = extractModelList(payload);
        const preferredModels = preferredRaw
          .filter((model) => isEmbeddingModelRecord(model))
          .map(mapApiModel);
        if (preferredModels.length > 0) {
          return preferredModels;
        }
      }
    } catch {
      // Some endpoints block /embeddings/models by CORS in browsers.
      // Fall back to /models below.
    }

    // Fallback: some providers expose only /models.
    const fallback = await fetch(`${this.baseUrl}/models`, { headers });
    if (!fallback.ok) {
      throw new Error('Failed to fetch embedding models');
    }
    const fallbackPayload = await fallback.json();
    const fallbackRaw = extractModelList(fallbackPayload);
    return fallbackRaw
      .filter((model) => isEmbeddingModelRecord(model))
      .map(mapApiModel);
  }

  async embeddings(
    request: EmbeddingRequest,
    signal?: AbortSignal
  ): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: buildHeaders(this.apiKey, this.isOpenRouter),
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'API request failed' }));
      throw new Error(error.error?.message || error.message || 'API request failed');
    }

    const data = await response.json();
    const rows = Array.isArray(data.data) ? data.data : [];
    return rows
      .map((row: Record<string, unknown>) => row.embedding)
      .filter((embedding: unknown): embedding is number[] =>
        Array.isArray(embedding) && embedding.every((value) => Number.isFinite(value))
      );
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getBooleanFlag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

// Singleton instance getter
const clientInstances = new Map<string, OpenRouterClient>();

export function getOpenRouterClient(
  apiKey: string,
  baseUrl: string = OPENROUTER_BASE_URL
): OpenRouterClient {
  const key = `${apiKey}::${baseUrl}`;
  if (!clientInstances.has(key)) {
    clientInstances.set(key, new OpenRouterClient(apiKey, baseUrl));
  }
  return clientInstances.get(key)!;
}

export async function fetchModelsWithCache(
  apiKey: string,
  baseUrl: string = OPENROUTER_BASE_URL
): Promise<LLMModel[]> {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY}:${baseUrl}`);
    if (cached) {
      const { models, timestamp }: ModelsCache = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return models;
      }
    }
  } catch {
    // Ignore cache errors
  }

  const client = getOpenRouterClient(apiKey, baseUrl);
  const models = await client.getModels();

  try {
    localStorage.setItem(
      `${CACHE_KEY}:${baseUrl}`,
      JSON.stringify({
        models,
        timestamp: Date.now(),
      })
    );
  } catch {
    // Ignore cache errors
  }

  return models;
}

export async function fetchEmbeddingModelsWithCache(
  apiKey: string,
  baseUrl: string = OPENROUTER_BASE_URL
): Promise<LLMModel[]> {
  try {
    const cached = localStorage.getItem(`${EMBEDDINGS_CACHE_KEY}:${baseUrl}`);
    if (cached) {
      const { models, timestamp }: ModelsCache = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return models;
      }
    }
  } catch {
    // Ignore cache errors
  }

  const client = getOpenRouterClient(apiKey, baseUrl);
  const models = await client.getEmbeddingModels();

  try {
    localStorage.setItem(
      `${EMBEDDINGS_CACHE_KEY}:${baseUrl}`,
      JSON.stringify({
        models,
        timestamp: Date.now(),
      })
    );
  } catch {
    // Ignore cache errors
  }

  return models;
}

export function isOpenRouterBaseUrl(baseUrl: string): boolean {
  return baseUrl.toLowerCase().includes('openrouter.ai');
}

export function getBundledFallbackModels(baseUrl: string): LLMModel[] {
  if (isOpenRouterBaseUrl(baseUrl) && OPENROUTER_FALLBACK_MODELS.length > 0) {
    return OPENROUTER_FALLBACK_MODELS;
  }
  return GENERIC_FALLBACK_MODELS;
}

export function getBundledEmbeddingFallbackModels(baseUrl: string): LLMModel[] {
  if (
    isOpenRouterBaseUrl(baseUrl) &&
    OPENROUTER_FALLBACK_EMBEDDING_MODELS.length > 0
  ) {
    return OPENROUTER_FALLBACK_EMBEDDING_MODELS;
  }
  return [];
}

export function buildHeaders(
  apiKey: string,
  isOpenRouter: boolean,
  modelsOnly = false
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  if (!modelsOnly) {
    headers['Content-Type'] = 'application/json';
  }

  if (isOpenRouter) {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = 'Graph LLM Chat';
  }

  return headers;
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const rawContent = (message as { content?: unknown }).content;

  if (typeof rawContent === 'string') return rawContent;
  if (Array.isArray(rawContent)) {
    const parts = rawContent
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const text = (item as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join('\n');
  }
  if (rawContent && typeof rawContent === 'object') {
    const text = (rawContent as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }

  const reasoning = (message as { reasoning?: unknown }).reasoning;
  if (typeof reasoning === 'string') return reasoning;
  if (reasoning && typeof reasoning === 'object') {
    const text = (reasoning as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }

  return '';
}

function extractModelList(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')
  );
}

function mapApiModel(model: Record<string, unknown>): LLMModel {
  const supportedParameters = normalizeStringList(
    model.supported_parameters ?? model.supportedParameters ?? model.parameters
  );
  const normalizedParams = supportedParameters.map((param) => param.toLowerCase());
  const tags = normalizeStringList(model.tags ?? model.tag).map((tag) =>
    tag.toLowerCase()
  );
  const capabilitiesRaw = model.capabilities ?? model.capability ?? model.features;
  const capabilities = normalizeStringList(capabilitiesRaw).map((tag) =>
    tag.toLowerCase()
  );
  const explicitReasoning = getBooleanFlag(
    model.supports_reasoning ?? model.supportsReasoning
  );
  const capabilityReasoning =
    typeof capabilitiesRaw === 'object' &&
    capabilitiesRaw !== null &&
    getBooleanFlag((capabilitiesRaw as Record<string, unknown>).reasoning) === true;
  const supportsReasoning =
    typeof explicitReasoning === 'boolean'
      ? explicitReasoning
      : normalizedParams.some((param) => param === 'reasoning' || param === 'reasoning_effort') ||
        [...tags, ...capabilities].some((tag) => tag === 'reasoning' || tag === 'thinking') ||
        capabilityReasoning;

  return {
    id: model.id as string,
    name: (model.name as string) || (model.id as string),
    contextLength: (model.context_length as number) || 4096,
    pricing: {
      prompt: Number((model.pricing as Record<string, unknown>)?.prompt) || 0,
      completion: Number((model.pricing as Record<string, unknown>)?.completion) || 0,
    },
    supportedParameters,
    supportsReasoning,
  };
}

function isEmbeddingModelRecord(model: Record<string, unknown>) {
  const id = String(model.id ?? '').toLowerCase();
  const name = String(model.name ?? '').toLowerCase();
  if (id.includes('embedding') || id.includes('embed')) return true;
  if (name.includes('embedding') || name.includes('embed')) return true;

  const supportedParameters = normalizeStringList(
    model.supported_parameters ?? model.supportedParameters ?? model.parameters
  ).map((param) => param.toLowerCase());
  if (supportedParameters.includes('embeddings') || supportedParameters.includes('embedding')) {
    return true;
  }

  const architecture = model.architecture;
  if (architecture && typeof architecture === 'object') {
    const outputModalities = normalizeStringList(
      (architecture as Record<string, unknown>).output_modalities ??
        (architecture as Record<string, unknown>).outputModalities
    ).map((value) => value.toLowerCase());
    if (outputModalities.includes('embeddings') || outputModalities.includes('embedding')) {
      return true;
    }
  }

  return false;
}
