import { jsonSchema, type ToolSet, tool } from 'ai';
import { McpHttpClient, type McpConnectionConfig, type McpToolDescriptor } from './mcpClient';

function toAlias(name: string) {
  return `mcp_${name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function normalizeToolResult(result: unknown) {
  if (!result || typeof result !== 'object') return result;
  const record = result as Record<string, unknown>;

  if (
    Array.isArray(record.content) &&
    record.content.every((part) => part && typeof part === 'object')
  ) {
    const textParts = (record.content as Array<Record<string, unknown>>)
      .map((part) => {
        if (part.type === 'text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean);

    if (textParts.length > 0) {
      return {
        text: textParts.join('\n'),
        structuredContent: record.structuredContent,
      };
    }
  }

  return result;
}

export interface McpToolsBundle {
  tools: ToolSet;
  aliases: Record<
    string,
    {
      originalName: string;
      displayName: string;
    }
  >;
  close: () => Promise<void>;
}

interface CreateMcpToolsParams {
  config: McpConnectionConfig;
  enabledTools: string[];
  aliasPrefix?: string;
  displayNamePrefix?: string;
  confirmToolCall?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}

function shouldEnableTool(toolName: string, enabledTools: string[]) {
  if (enabledTools.length === 0) return true;
  return enabledTools.includes(toolName);
}

function buildInputSchema(descriptor: McpToolDescriptor) {
  const schema =
    descriptor.inputSchema && Object.keys(descriptor.inputSchema).length > 0
      ? descriptor.inputSchema
      : {
          type: 'object',
          properties: {},
          additionalProperties: true,
        };
  return jsonSchema(schema);
}

export async function createMcpTools(params: CreateMcpToolsParams): Promise<McpToolsBundle> {
  const client = new McpHttpClient(params.config);
  const descriptors = await client.listTools();

  const tools: ToolSet = {};
  const aliases: Record<
    string,
    {
      originalName: string;
      displayName: string;
    }
  > = {};
  const aliasPrefix = params.aliasPrefix?.trim();
  const displayPrefix = params.displayNamePrefix?.trim();

  for (const descriptor of descriptors) {
    if (!shouldEnableTool(descriptor.name, params.enabledTools)) {
      continue;
    }
    const alias = aliasPrefix
      ? `${toAlias(aliasPrefix)}_${descriptor.name.replace(/[^a-zA-Z0-9_]/g, '_')}`
      : toAlias(descriptor.name);
    aliases[alias] = {
      originalName: descriptor.name,
      displayName: displayPrefix ? `${displayPrefix}:${descriptor.name}` : descriptor.name,
    };
    tools[alias] = tool({
      description: descriptor.description || `MCP tool ${descriptor.name}`,
      inputSchema: buildInputSchema(descriptor),
      execute: async (args: unknown) => {
        const inputArgs =
          args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
        if (params.confirmToolCall) {
          const allowed = await params.confirmToolCall(descriptor.name, inputArgs);
          if (!allowed) {
            return {
              denied: true,
              message: `Execution denied for MCP tool "${descriptor.name}".`,
            };
          }
        }
        const result = await client.callTool(descriptor.name, inputArgs);
        return normalizeToolResult(result);
      },
    });
  }

  return {
    tools,
    aliases,
    close: () => client.close(),
  };
}

export async function discoverMcpToolNames(config: McpConnectionConfig): Promise<string[]> {
  const client = new McpHttpClient(config);
  try {
    const tools = await client.listTools();
    return tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}
