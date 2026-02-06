import type {
  McpServerSettings,
  NormalizedToolSettings,
  ToolSettings,
} from '../types';

function defaultMcpServer(index = 1): McpServerSettings {
  return {
    id: `mcp-server-${index}`,
    name: `MCP ${index}`,
    enabled: true,
    url: '',
    transport: 'http',
    authToken: '',
    enabledTools: [],
  };
}

const DEFAULT_TOOL_SETTINGS: NormalizedToolSettings = {
  enabled: false,
  maxSteps: 4,
  showEvents: true,
  permissions: {
    requireConfirmation: true,
    sensitiveTools: [
      'search_messages',
      'search_context_chunks',
      'list_attached_files',
      'read_attached_file',
      'daytona_exec',
      'mcp:*',
    ],
  },
  datetimeNow: {
    enabled: true,
  },
  calculator: {
    enabled: true,
    maxExpressionLength: 160,
  },
  searchMessages: {
    enabled: true,
    maxResults: 6,
  },
  searchContextChunks: {
    enabled: true,
    maxResults: 6,
  },
  attachmentReader: {
    enabled: true,
    maxCharsPerRead: 12000,
  },
  daytona: {
    enabled: false,
    apiKey: '',
    apiUrl: '',
    target: '',
    sandboxId: '',
    defaultLanguage: 'typescript',
    autoCreateSandbox: true,
    autoDeleteCreatedSandbox: true,
    defaultTimeoutSeconds: 60,
    maxStdoutChars: 6000,
    maxStderrChars: 3000,
  },
  mcp: {
    enabled: false,
    servers: [defaultMcpServer(1)],
  },
};

export function getDefaultToolSettings(): NormalizedToolSettings {
  return {
    enabled: DEFAULT_TOOL_SETTINGS.enabled,
    maxSteps: DEFAULT_TOOL_SETTINGS.maxSteps,
    showEvents: DEFAULT_TOOL_SETTINGS.showEvents,
    permissions: {
      ...DEFAULT_TOOL_SETTINGS.permissions,
      sensitiveTools: [...DEFAULT_TOOL_SETTINGS.permissions.sensitiveTools],
    },
    datetimeNow: { ...DEFAULT_TOOL_SETTINGS.datetimeNow },
    calculator: { ...DEFAULT_TOOL_SETTINGS.calculator },
    searchMessages: { ...DEFAULT_TOOL_SETTINGS.searchMessages },
    searchContextChunks: { ...DEFAULT_TOOL_SETTINGS.searchContextChunks },
    attachmentReader: { ...DEFAULT_TOOL_SETTINGS.attachmentReader },
    daytona: { ...DEFAULT_TOOL_SETTINGS.daytona },
    mcp: {
      enabled: DEFAULT_TOOL_SETTINGS.mcp.enabled,
      servers: DEFAULT_TOOL_SETTINGS.mcp.servers.map((server) => ({
        ...server,
        enabledTools: [...server.enabledTools],
      })),
    },
  };
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return Math.floor(numeric);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeMcpServer(
  value: unknown,
  fallback: McpServerSettings,
  index: number
): McpServerSettings {
  const candidate = (value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  return {
    id:
      typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `mcp-server-${index + 1}`,
    name:
      typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim()
        : `MCP ${index + 1}`,
    enabled:
      typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    url: String(candidate.url ?? fallback.url).trim(),
    transport: candidate.transport === 'sse' ? 'sse' : 'http',
    authToken: String(candidate.authToken ?? fallback.authToken).trim(),
    enabledTools: normalizeStringList(candidate.enabledTools),
  };
}

function normalizeMcpServers(candidate: ToolSettings, defaults: NormalizedToolSettings) {
  const rawServers = Array.isArray(candidate.mcp?.servers)
    ? candidate.mcp?.servers
    : Array.isArray(candidate.mcpServers)
      ? candidate.mcpServers
      : null;

  if (rawServers && rawServers.length > 0) {
    return rawServers.map((server, index) =>
      normalizeMcpServer(
        server,
        defaults.mcp.servers[index] ?? defaultMcpServer(index + 1),
        index
      )
    );
  }

  const hasLegacyServerData = Boolean(
    candidate.mcp?.url ||
      candidate.mcp?.authToken ||
      candidate.mcp?.transport ||
      (candidate.mcp?.enabledTools && candidate.mcp.enabledTools.length > 0)
  );

  if (hasLegacyServerData) {
    return [
      normalizeMcpServer(
        {
          id: 'mcp-server-1',
          name: 'MCP 1',
          enabled: true,
          url: candidate.mcp?.url,
          transport: candidate.mcp?.transport,
          authToken: candidate.mcp?.authToken,
          enabledTools: candidate.mcp?.enabledTools,
        },
        defaultMcpServer(1),
        0
      ),
    ];
  }

  return defaults.mcp.servers.map((server) => ({
    ...server,
    enabledTools: [...server.enabledTools],
  }));
}

export function normalizeToolSettings(
  value?: ToolSettings | null
): NormalizedToolSettings {
  const defaults = getDefaultToolSettings();
  const candidate = value ?? {};
  return {
    enabled: candidate.enabled ?? defaults.enabled,
    maxSteps: normalizeNumber(candidate.maxSteps, defaults.maxSteps, 1, 12),
    showEvents: candidate.showEvents ?? defaults.showEvents,
    permissions: {
      requireConfirmation:
        candidate.permissions?.requireConfirmation ??
        defaults.permissions.requireConfirmation,
      sensitiveTools:
        normalizeStringList(candidate.permissions?.sensitiveTools).length > 0
          ? normalizeStringList(candidate.permissions?.sensitiveTools)
          : defaults.permissions.sensitiveTools,
    },
    datetimeNow: {
      enabled: candidate.datetimeNow?.enabled ?? defaults.datetimeNow.enabled,
    },
    calculator: {
      enabled: candidate.calculator?.enabled ?? defaults.calculator.enabled,
      maxExpressionLength: normalizeNumber(
        candidate.calculator?.maxExpressionLength,
        defaults.calculator.maxExpressionLength,
        32,
        2000
      ),
    },
    searchMessages: {
      enabled: candidate.searchMessages?.enabled ?? defaults.searchMessages.enabled,
      maxResults: normalizeNumber(
        candidate.searchMessages?.maxResults,
        defaults.searchMessages.maxResults,
        1,
        30
      ),
    },
    searchContextChunks: {
      enabled:
        candidate.searchContextChunks?.enabled ?? defaults.searchContextChunks.enabled,
      maxResults: normalizeNumber(
        candidate.searchContextChunks?.maxResults,
        defaults.searchContextChunks.maxResults,
        1,
        30
      ),
    },
    attachmentReader: {
      enabled:
        candidate.attachmentReader?.enabled ?? defaults.attachmentReader.enabled,
      maxCharsPerRead: normalizeNumber(
        candidate.attachmentReader?.maxCharsPerRead,
        defaults.attachmentReader.maxCharsPerRead,
        1000,
        50000
      ),
    },
    daytona: {
      enabled: candidate.daytona?.enabled ?? defaults.daytona.enabled,
      apiKey: String(candidate.daytona?.apiKey ?? defaults.daytona.apiKey).trim(),
      apiUrl: String(candidate.daytona?.apiUrl ?? defaults.daytona.apiUrl).trim(),
      target: String(candidate.daytona?.target ?? defaults.daytona.target).trim(),
      sandboxId: String(candidate.daytona?.sandboxId ?? defaults.daytona.sandboxId).trim(),
      defaultLanguage:
        candidate.daytona?.defaultLanguage === 'python' ||
        candidate.daytona?.defaultLanguage === 'javascript' ||
        candidate.daytona?.defaultLanguage === 'go' ||
        candidate.daytona?.defaultLanguage === 'rust'
          ? candidate.daytona.defaultLanguage
          : 'typescript',
      autoCreateSandbox:
        candidate.daytona?.autoCreateSandbox ?? defaults.daytona.autoCreateSandbox,
      autoDeleteCreatedSandbox:
        candidate.daytona?.autoDeleteCreatedSandbox ??
        defaults.daytona.autoDeleteCreatedSandbox,
      defaultTimeoutSeconds: normalizeNumber(
        candidate.daytona?.defaultTimeoutSeconds,
        defaults.daytona.defaultTimeoutSeconds,
        5,
        600
      ),
      maxStdoutChars: normalizeNumber(
        candidate.daytona?.maxStdoutChars,
        defaults.daytona.maxStdoutChars,
        500,
        50000
      ),
      maxStderrChars: normalizeNumber(
        candidate.daytona?.maxStderrChars,
        defaults.daytona.maxStderrChars,
        500,
        50000
      ),
    },
    mcp: {
      enabled: candidate.mcp?.enabled ?? defaults.mcp.enabled,
      servers: normalizeMcpServers(candidate, defaults),
    },
  };
}

export function isSensitiveToolName(
  toolName: string,
  sensitivePatterns: string[]
): boolean {
  const normalizedTool = toolName.trim().toLowerCase();
  if (!normalizedTool) return false;

  return sensitivePatterns.some((pattern) => {
    const normalizedPattern = pattern.trim().toLowerCase();
    if (!normalizedPattern) return false;
    if (normalizedPattern.endsWith('*')) {
      return normalizedTool.startsWith(normalizedPattern.slice(0, -1));
    }
    return normalizedPattern === normalizedTool;
  });
}
