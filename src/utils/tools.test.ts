import { describe, expect, test } from 'vitest';
import { getDefaultToolSettings, normalizeToolSettings } from './tools';

describe('tool settings normalization', () => {
  test('returns defaults for empty input', () => {
    const settings = normalizeToolSettings();
    const defaults = getDefaultToolSettings();
    expect(settings).toEqual(defaults);
  });

  test('clamps numeric values and keeps explicit toggles', () => {
    const settings = normalizeToolSettings({
      enabled: true,
      maxSteps: 100,
      showEvents: false,
      datetimeNow: { enabled: false },
      calculator: { enabled: false, maxExpressionLength: 2 },
      searchMessages: { enabled: true, maxResults: 999 },
      searchContextChunks: { enabled: true, maxResults: 0 },
      attachmentReader: { enabled: true, maxCharsPerRead: 999999 },
      daytona: {
        enabled: true,
        defaultTimeoutSeconds: 9999,
        maxStdoutChars: 100,
        maxStderrChars: 999999,
      },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.maxSteps).toBe(12);
    expect(settings.showEvents).toBe(false);
    expect(settings.datetimeNow.enabled).toBe(false);
    expect(settings.calculator.enabled).toBe(false);
    expect(settings.calculator.maxExpressionLength).toBe(32);
    expect(settings.searchMessages.maxResults).toBe(30);
    expect(settings.searchContextChunks.maxResults).toBe(1);
    expect(settings.attachmentReader.enabled).toBe(true);
    expect(settings.attachmentReader.maxCharsPerRead).toBe(50000);
    expect(settings.daytona.enabled).toBe(true);
    expect(settings.daytona.defaultTimeoutSeconds).toBe(600);
    expect(settings.daytona.maxStdoutChars).toBe(500);
    expect(settings.daytona.maxStderrChars).toBe(50000);
  });

  test('migrates legacy single MCP config to servers array', () => {
    const settings = normalizeToolSettings({
      mcp: {
        enabled: true,
        url: 'https://mcp.example.com',
        transport: 'sse',
        authToken: 'token',
        enabledTools: ['web_search'],
      },
    });

    expect(settings.mcp.enabled).toBe(true);
    expect(settings.mcp.servers).toHaveLength(1);
    expect(settings.mcp.servers[0].url).toBe('https://mcp.example.com');
    expect(settings.mcp.servers[0].transport).toBe('sse');
    expect(settings.mcp.servers[0].authToken).toBe('token');
    expect(settings.mcp.servers[0].enabledTools).toEqual(['web_search']);
  });
});
