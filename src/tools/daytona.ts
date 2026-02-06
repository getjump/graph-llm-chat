export type DaytonaLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

export interface DaytonaToolConfig {
  apiKey: string;
  apiUrl?: string;
  target?: string;
  sandboxId?: string;
  defaultLanguage: DaytonaLanguage;
  autoCreateSandbox: boolean;
  autoDeleteCreatedSandbox: boolean;
  defaultTimeoutSeconds: number;
  maxStdoutChars: number;
  maxStderrChars: number;
}

export interface DaytonaExecInput {
  command: string;
  cwd?: string;
  timeoutSeconds?: number;
  sandboxId?: string;
  createSandbox?: boolean;
  deleteCreatedSandbox?: boolean;
  language?: DaytonaLanguage;
  env?: Record<string, string>;
}

interface DaytonaSandboxRecord {
  id: string;
  state?: string;
}

interface DaytonaToolboxProxyResponse {
  url?: string;
}

function trimToMax(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || !value) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function normalizeExecutionResult(
  response: unknown,
  maxStdoutChars: number,
  maxStderrChars: number
) {
  const record =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const exitCodeRaw = record.exitCode ?? record.exit_code ?? null;
  const durationRaw = record.durationMs ?? record.duration_ms ?? null;
  const resultText = trimToMax(record.result, maxStdoutChars);
  const stdoutText = trimToMax(record.stdout, maxStdoutChars);
  const stderrText = trimToMax(record.stderr, maxStderrChars);
  const exitCode = typeof exitCodeRaw === 'number' ? exitCodeRaw : null;
  const durationMs = typeof durationRaw === 'number' ? durationRaw : null;

  return {
    exitCode,
    durationMs,
    result: resultText || stdoutText || '',
    stdout: stdoutText || resultText || '',
    stderr: stderrText,
  };
}

function getApiBaseUrl(config: DaytonaToolConfig): string {
  const trimmed = config.apiUrl?.trim();
  if (trimmed) return trimmed.replace(/\/+$/, '');
  return 'https://app.daytona.io/api';
}

function getAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function buildHttpErrorMessage(method: string, url: string, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const detail =
      typeof record.message === 'string'
        ? record.message
        : typeof record.error === 'string'
          ? record.error
          : null;
    if (detail) return `${method} ${url} failed: ${detail}`;
  }
  if (typeof body === 'string' && body.trim()) {
    return `${method} ${url} failed: ${body.trim()}`;
  }
  return `${method} ${url} failed.`;
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  const output: Record<string, string> = {};
  if (!headers) return output;

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      output[key] = String(value);
    }
    return output;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'undefined') {
      output[key] = String(value);
    }
  }

  return output;
}

async function daytonaRequest(
  apiBaseUrl: string,
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const url = `${apiBaseUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...getAuthHeaders(apiKey),
      ...headersToRecord(init?.headers),
    },
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(buildHttpErrorMessage(init?.method ?? 'GET', url, payload));
  }
  return payload;
}

function getSandboxState(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const state = (value as Record<string, unknown>).state;
  return typeof state === 'string' ? state.toLowerCase() : '';
}

function isStartedState(state: string): boolean {
  return state === 'started' || state === 'running';
}

function isFailedState(state: string): boolean {
  return state === 'error' || state === 'build_failed' || state === 'deleted';
}

async function getSandbox(
  apiBaseUrl: string,
  apiKey: string,
  sandboxId: string
): Promise<DaytonaSandboxRecord> {
  const result = await daytonaRequest(
    apiBaseUrl,
    apiKey,
    `/sandbox/${encodeURIComponent(sandboxId)}`
  );
  const record =
    result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
  if (!record || typeof record.id !== 'string') {
    throw new Error('Invalid Daytona sandbox response.');
  }
  return {
    id: record.id,
    state: typeof record.state === 'string' ? record.state : undefined,
  };
}

async function createSandbox(
  apiBaseUrl: string,
  apiKey: string,
  target: string | undefined,
  language: DaytonaLanguage
): Promise<DaytonaSandboxRecord> {
  const payload: Record<string, unknown> = {
    labels: { 'code-toolbox-language': language },
  };
  if (target?.trim()) payload.target = target.trim();

  const result = await daytonaRequest(apiBaseUrl, apiKey, '/sandbox', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const record =
    result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
  if (!record || typeof record.id !== 'string') {
    throw new Error('Failed to create Daytona sandbox.');
  }
  return {
    id: record.id,
    state: typeof record.state === 'string' ? record.state : undefined,
  };
}

async function startSandbox(apiBaseUrl: string, apiKey: string, sandboxId: string) {
  await daytonaRequest(apiBaseUrl, apiKey, `/sandbox/${encodeURIComponent(sandboxId)}/start`, {
    method: 'POST',
  });
}

async function waitForSandboxReady(
  apiBaseUrl: string,
  apiKey: string,
  sandboxId: string,
  timeoutSeconds: number
): Promise<void> {
  const startAt = Date.now();
  let didTryStart = false;

  while (Date.now() - startAt < timeoutSeconds * 1000) {
    const sandbox = await getSandbox(apiBaseUrl, apiKey, sandboxId);
    const state = getSandboxState(sandbox);
    if (isStartedState(state)) {
      return;
    }
    if (isFailedState(state)) {
      throw new Error(`Sandbox ${sandboxId} is in failed state: ${state}`);
    }
    if (!didTryStart && state === 'stopped') {
      didTryStart = true;
      await startSandbox(apiBaseUrl, apiKey, sandboxId);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Sandbox ${sandboxId} did not become ready within ${timeoutSeconds}s.`);
}

async function getToolboxProxyUrl(
  apiBaseUrl: string,
  apiKey: string,
  sandboxId: string
): Promise<string> {
  const result = await daytonaRequest(
    apiBaseUrl,
    apiKey,
    `/sandbox/${encodeURIComponent(sandboxId)}/toolbox-proxy-url`
  );
  const record =
    result && typeof result === 'object'
      ? (result as DaytonaToolboxProxyResponse)
      : ({} as DaytonaToolboxProxyResponse);
  const url = record.url?.trim();
  if (!url) {
    throw new Error('Failed to obtain Daytona toolbox proxy URL.');
  }
  return url.replace(/\/+$/, '');
}

function toBase64Utf8(value: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  if (typeof btoa !== 'function') {
    throw new Error('Base64 encoding is not available in this runtime.');
  }
  return btoa(binary);
}

function escapeDoubleQuotedShell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildCommandWithEnv(command: string, env?: Record<string, string>): string {
  const base64UserCmd = toBase64Utf8(command);
  let wrapped = `echo '${base64UserCmd}' | base64 -d | sh`;

  if (env && Object.keys(env).length > 0) {
    const safeExports = Object.entries(env)
      .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      .map(([key, value]) => {
        const encodedValue = toBase64Utf8(value);
        return `export ${key}=$(echo '${encodedValue}' | base64 -d)`;
      })
      .join('; ');
    if (safeExports) {
      wrapped = `${safeExports}; ${wrapped}`;
    }
  }

  return `sh -c "${escapeDoubleQuotedShell(wrapped)}"`;
}

async function executeToolboxCommand(
  toolboxProxyUrl: string,
  apiKey: string,
  sandboxId: string,
  command: string,
  cwd: string | undefined,
  timeoutSeconds: number
): Promise<unknown> {
  const body: Record<string, unknown> = {
    command,
    timeout: timeoutSeconds,
  };
  if (cwd?.trim()) {
    body.cwd = cwd.trim();
  }

  const response = await fetch(`${toolboxProxyUrl}/${encodeURIComponent(sandboxId)}/process/execute`, {
    method: 'POST',
    headers: getAuthHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(buildHttpErrorMessage('POST', `${toolboxProxyUrl}/${sandboxId}/process/execute`, payload));
  }
  return payload;
}

async function deleteSandbox(apiBaseUrl: string, apiKey: string, sandboxId: string) {
  await daytonaRequest(apiBaseUrl, apiKey, `/sandbox/${encodeURIComponent(sandboxId)}`, {
    method: 'DELETE',
  });
}

export async function executeDaytonaCommand(
  config: DaytonaToolConfig,
  input: DaytonaExecInput
) {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new Error('Daytona API key is required in tool settings.');
  }

  const apiBaseUrl = getApiBaseUrl(config);

  const explicitSandboxId = input.sandboxId?.trim() || config.sandboxId?.trim() || '';
  const shouldCreateSandbox =
    input.createSandbox ?? (explicitSandboxId ? false : config.autoCreateSandbox);
  const language = input.language ?? config.defaultLanguage;

  let sandbox: unknown = null;
  let createdSandbox = false;
  let effectiveSandboxId = explicitSandboxId;
  const warnings: string[] = [];

  if (explicitSandboxId) {
    try {
      sandbox = await getSandbox(apiBaseUrl, apiKey, explicitSandboxId);
    } catch (error) {
      if (!shouldCreateSandbox) {
        throw error;
      }
    }
  }

  if (!sandbox) {
    if (!shouldCreateSandbox) {
      throw new Error(
        'No Daytona sandbox is available. Provide sandbox ID or enable auto-create.'
      );
    }
    sandbox = await createSandbox(apiBaseUrl, apiKey, config.target, language);
    createdSandbox = true;
    const sandboxRecord =
      sandbox && typeof sandbox === 'object' ? (sandbox as Record<string, unknown>) : {};
    if (typeof sandboxRecord.id === 'string') {
      effectiveSandboxId = sandboxRecord.id;
    }
  }

  const timeoutSeconds = Math.max(1, input.timeoutSeconds ?? config.defaultTimeoutSeconds);
  const readinessTimeout = Math.max(timeoutSeconds, 30);
  await waitForSandboxReady(apiBaseUrl, apiKey, effectiveSandboxId, readinessTimeout);
  const toolboxProxyUrl = await getToolboxProxyUrl(apiBaseUrl, apiKey, effectiveSandboxId);

  const wrappedCommand = buildCommandWithEnv(input.command, input.env);
  const executionResponse = await executeToolboxCommand(
    toolboxProxyUrl,
    apiKey,
    effectiveSandboxId,
    wrappedCommand,
    input.cwd,
    timeoutSeconds
  );

  const normalized = normalizeExecutionResult(
    executionResponse,
    config.maxStdoutChars,
    config.maxStderrChars
  );

  const shouldDeleteCreatedSandbox =
    createdSandbox && (input.deleteCreatedSandbox ?? config.autoDeleteCreatedSandbox);
  if (shouldDeleteCreatedSandbox) {
    try {
      await deleteSandbox(apiBaseUrl, apiKey, effectiveSandboxId);
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Failed to delete created sandbox: ${error.message}`
          : 'Failed to delete created sandbox.'
      );
    }
  }

  return {
    sandboxId: effectiveSandboxId || null,
    createdSandbox,
    autoDeleted: shouldDeleteCreatedSandbox,
    command: input.command,
    cwd: input.cwd ?? null,
    timeoutSeconds,
    language,
    ...normalized,
    warnings,
  };
}
