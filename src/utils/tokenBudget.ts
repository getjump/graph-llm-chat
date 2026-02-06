import type {
  NormalizedMemorySettings,
  NormalizedToolSettings,
  MemoryRetrievalPreview,
  PendingAttachment,
} from '../types';

const LOCAL_TOOL_TOKEN_COST: Record<string, number> = {
  datetime_now: 18,
  calculator: 32,
  search_messages: 58,
  search_context_chunks: 64,
  attachment_reader: 72,
  daytona_exec: 92,
};

const TOOL_LOOP_BASE_TOKENS = 24;
const MCP_SERVER_BASE_TOKENS = 36;
const MCP_TOOL_TOKENS = 30;
const MCP_UNKNOWN_TOOL_COUNT = 6;
const MEMORY_HEADER_TOKENS = 16;
const MEMORY_ITEM_OVERHEAD_TOKENS = 10;
const MEMORY_FALLBACK_ITEM_TOKENS = 34;

export interface ToolTokenEstimate {
  total: number;
  local: number;
  mcp: number;
  localToolCount: number;
  mcpServerCount: number;
  mcpToolCount: number;
}

export interface MemoryTokenEstimate {
  total: number;
  itemCount: number;
  source: 'disabled' | 'preview' | 'fallback';
}

export interface ContextExtraTokenEstimate {
  total: number;
  tools: ToolTokenEstimate;
  memory: MemoryTokenEstimate;
}

export function estimateTokensFromText(text: string) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateAttachmentTokens(attachments: PendingAttachment[]) {
  if (attachments.length === 0) return 0;
  return attachments.reduce((sum, attachment) => {
    const roughTokens = Math.ceil(attachment.size / 4);
    return sum + Math.min(512, roughTokens);
  }, 0);
}

export function estimateToolContextTokens(
  toolSettings: NormalizedToolSettings
): ToolTokenEstimate {
  if (!toolSettings.enabled) {
    return {
      total: 0,
      local: 0,
      mcp: 0,
      localToolCount: 0,
      mcpServerCount: 0,
      mcpToolCount: 0,
    };
  }

  let local = TOOL_LOOP_BASE_TOKENS;
  let localToolCount = 0;
  if (toolSettings.datetimeNow.enabled) {
    local += LOCAL_TOOL_TOKEN_COST.datetime_now;
    localToolCount += 1;
  }
  if (toolSettings.calculator.enabled) {
    local += LOCAL_TOOL_TOKEN_COST.calculator;
    localToolCount += 1;
  }
  if (toolSettings.searchMessages.enabled) {
    local += LOCAL_TOOL_TOKEN_COST.search_messages;
    localToolCount += 1;
  }
  if (toolSettings.searchContextChunks.enabled) {
    local += LOCAL_TOOL_TOKEN_COST.search_context_chunks;
    localToolCount += 1;
  }
  if (toolSettings.attachmentReader.enabled) {
    local += LOCAL_TOOL_TOKEN_COST.attachment_reader;
    localToolCount += 1;
  }
  if (toolSettings.daytona.enabled) {
    local += LOCAL_TOOL_TOKEN_COST.daytona_exec;
    localToolCount += 1;
  }

  let mcp = 0;
  let mcpServerCount = 0;
  let mcpToolCount = 0;
  if (toolSettings.mcp.enabled) {
    const enabledServers = toolSettings.mcp.servers.filter(
      (server) => server.enabled && server.url.trim()
    );
    mcpServerCount = enabledServers.length;
    for (const server of enabledServers) {
      const toolCount =
        server.enabledTools.length > 0
          ? server.enabledTools.length
          : MCP_UNKNOWN_TOOL_COUNT;
      mcpToolCount += toolCount;
      mcp += MCP_SERVER_BASE_TOKENS + toolCount * MCP_TOOL_TOKENS;
    }
  }

  return {
    total: local + mcp,
    local,
    mcp,
    localToolCount,
    mcpServerCount,
    mcpToolCount,
  };
}

export function estimateMemoryContextTokens(
  memorySettings: NormalizedMemorySettings,
  memoryPreview?: MemoryRetrievalPreview | null
): MemoryTokenEstimate {
  if (!memorySettings.enabled) {
    return { total: 0, itemCount: 0, source: 'disabled' };
  }

  if (memoryPreview && memoryPreview.items.length > 0) {
    const total =
      MEMORY_HEADER_TOKENS +
      memoryPreview.items.reduce(
        (sum, item) =>
          sum + estimateTokensFromText(item.text) + MEMORY_ITEM_OVERHEAD_TOKENS,
        0
      );
    return {
      total,
      itemCount: memoryPreview.items.length,
      source: 'preview',
    };
  }

  const itemCount = Math.max(1, memorySettings.maxRetrieved);
  return {
    total: MEMORY_HEADER_TOKENS + itemCount * MEMORY_FALLBACK_ITEM_TOKENS,
    itemCount,
    source: 'fallback',
  };
}

export function estimateContextExtraTokens(params: {
  toolSettings: NormalizedToolSettings;
  memorySettings: NormalizedMemorySettings;
  memoryPreview?: MemoryRetrievalPreview | null;
}) {
  const tools = estimateToolContextTokens(params.toolSettings);
  const memory = estimateMemoryContextTokens(params.memorySettings, params.memoryPreview);
  return {
    total: tools.total + memory.total,
    tools,
    memory,
  } satisfies ContextExtraTokenEstimate;
}
