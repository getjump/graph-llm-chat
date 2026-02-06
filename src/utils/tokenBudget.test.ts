import type {
  NormalizedMemorySettings,
  NormalizedToolSettings,
  MemoryRetrievalPreview,
} from '../types';
import {
  estimateContextExtraTokens,
  estimateMemoryContextTokens,
  estimateToolContextTokens,
  estimateTokensFromText,
} from './tokenBudget';
import { getDefaultToolSettings } from './tools';
import { normalizeMemorySettings } from './memory';

function buildToolSettings(overrides?: Partial<NormalizedToolSettings>): NormalizedToolSettings {
  return {
    ...getDefaultToolSettings(),
    ...(overrides || {}),
    calculator: {
      ...getDefaultToolSettings().calculator,
      ...(overrides?.calculator || {}),
    },
    datetimeNow: {
      ...getDefaultToolSettings().datetimeNow,
      ...(overrides?.datetimeNow || {}),
    },
    searchMessages: {
      ...getDefaultToolSettings().searchMessages,
      ...(overrides?.searchMessages || {}),
    },
    searchContextChunks: {
      ...getDefaultToolSettings().searchContextChunks,
      ...(overrides?.searchContextChunks || {}),
    },
    daytona: {
      ...getDefaultToolSettings().daytona,
      ...(overrides?.daytona || {}),
    },
    mcp: {
      ...getDefaultToolSettings().mcp,
      ...(overrides?.mcp || {}),
      servers: overrides?.mcp?.servers || getDefaultToolSettings().mcp.servers,
    },
  };
}

describe('token budget utils', () => {
  it('estimates text tokens', () => {
    expect(estimateTokensFromText('')).toBe(0);
    expect(estimateTokensFromText('abcd')).toBe(1);
    expect(estimateTokensFromText('abcde')).toBe(2);
  });

  it('estimates tool context tokens', () => {
    const settings = buildToolSettings({
      enabled: true,
      datetimeNow: { enabled: true },
      calculator: { enabled: true, maxExpressionLength: 100 },
      searchMessages: { enabled: false, maxResults: 6 },
      searchContextChunks: { enabled: false, maxResults: 6 },
      daytona: { ...getDefaultToolSettings().daytona, enabled: false },
      mcp: {
        enabled: true,
        servers: [
          {
            id: 's1',
            name: 'S1',
            enabled: true,
            url: 'https://mcp.example.com',
            transport: 'http',
            authToken: '',
            enabledTools: ['a', 'b'],
          },
        ],
      },
    });

    const estimate = estimateToolContextTokens(settings);
    expect(estimate.total).toBeGreaterThan(0);
    expect(estimate.localToolCount).toBe(3);
    expect(estimate.mcpServerCount).toBe(1);
    expect(estimate.mcpToolCount).toBe(2);
  });

  it('estimates memory tokens from preview', () => {
    const settings: NormalizedMemorySettings = normalizeMemorySettings({ enabled: true });
    const preview: MemoryRetrievalPreview = {
      query: 'q',
      embeddingModel: 'm',
      generatedAt: Date.now(),
      content: '',
      items: [
        {
          id: '1',
          text: 'Remember to respond in English.',
          scopeType: 'user',
          category: 'preference',
          confidence: 0.9,
          score: 2,
          pinned: false,
        },
      ],
    };
    const estimate = estimateMemoryContextTokens(settings, preview);
    expect(estimate.source).toBe('preview');
    expect(estimate.total).toBeGreaterThan(0);
    expect(estimate.itemCount).toBe(1);
  });

  it('combines tool and memory token overhead', () => {
    const tools = buildToolSettings({ enabled: true });
    const memory = normalizeMemorySettings({ enabled: true, maxRetrieved: 5 });
    const estimate = estimateContextExtraTokens({
      toolSettings: tools,
      memorySettings: memory,
      memoryPreview: null,
    });
    expect(estimate.total).toBe(estimate.tools.total + estimate.memory.total);
    expect(estimate.total).toBeGreaterThan(0);
  });
});
