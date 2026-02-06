export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpConnectionConfig {
  url: string;
  transport: 'http' | 'sse';
  authToken?: string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

function parseSsePayload(text: string): JsonRpcResponse | null {
  const lines = text.split('\n');
  const dataParts: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).trim());
    }
  }
  if (dataParts.length === 0) return null;
  const merged = dataParts.join('\n');
  if (!merged || merged === '[DONE]') return null;
  try {
    return JSON.parse(merged) as JsonRpcResponse;
  } catch {
    return null;
  }
}

export class McpHttpClient {
  private config: McpConnectionConfig;
  private nextId = 1;
  private initialized = false;
  private sessionId: string | null = null;

  constructor(config: McpConnectionConfig) {
    this.config = config;
  }

  private async request(method: string, params?: unknown, isNotification = false) {
    const payload = isNotification
      ? {
          jsonrpc: '2.0' as const,
          method,
          ...(params !== undefined ? { params } : {}),
        }
      : {
          jsonrpc: '2.0' as const,
          id: this.nextId++,
          method,
          ...(params !== undefined ? { params } : {}),
        };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept:
        this.config.transport === 'sse'
          ? 'text/event-stream, application/json'
          : 'application/json',
    };

    if (this.config.authToken) {
      headers.Authorization = `Bearer ${this.config.authToken}`;
    }
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    const newSession =
      response.headers.get('Mcp-Session-Id') ?? response.headers.get('mcp-session-id');
    if (newSession) {
      this.sessionId = newSession;
    }

    if (isNotification) return null;

    const text = await response.text();
    let json: JsonRpcResponse | null = null;
    try {
      json = JSON.parse(text) as JsonRpcResponse;
    } catch {
      json = parseSsePayload(text);
    }

    if (!json) {
      throw new Error('Invalid MCP response payload');
    }

    if (json.error) {
      throw new Error(json.error.message || 'MCP request returned an error');
    }

    return json.result;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await this.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: {
          name: 'graph-llm-chat',
          version: '1.0.0',
        },
      });
      await this.request('notifications/initialized', {}, true);
      this.initialized = true;
    } catch (error) {
      // Some servers do not require explicit initialize for plain HTTP bridges.
      // We still allow tool calls/listing attempts afterwards.
      console.warn('MCP initialize failed, continuing in compatibility mode:', error);
      this.initialized = true;
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    await this.initialize();
    const result = (await this.request('tools/list', {})) as
      | { tools?: Array<Record<string, unknown>> }
      | undefined;

    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools
      .map((tool): McpToolDescriptor | null => {
        const name = typeof tool.name === 'string' ? tool.name : '';
        if (!name) return null;
        return {
          name,
          description:
            typeof tool.description === 'string' ? tool.description : undefined,
          inputSchema:
            tool.inputSchema && typeof tool.inputSchema === 'object'
              ? (tool.inputSchema as Record<string, unknown>)
              : undefined,
        };
      })
      .filter((tool): tool is McpToolDescriptor => Boolean(tool));
  }

  async callTool(name: string, args: Record<string, unknown>) {
    await this.initialize();
    return this.request('tools/call', {
      name,
      arguments: args,
    });
  }

  async close() {
    try {
      await this.request('close', {}, true);
    } catch {
      // noop
    }
  }
}
