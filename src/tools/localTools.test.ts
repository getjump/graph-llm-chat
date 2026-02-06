import { describe, expect, test } from 'vitest';
import { createLocalTools } from './localTools';
import type { AttachmentSource } from '../types';

interface ToolAttachmentEntry {
  attachmentId: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  source: AttachmentSource;
  handleId?: string;
  scope: 'conversation' | 'project';
}

interface ListAttachedFilesResult {
  count: number;
  files: Array<{
    attachmentId: string;
    readable: boolean;
  }>;
}

interface ReadAttachedFileResult {
  content?: string;
  returnedChars?: number;
  hasMore?: boolean;
  error?: string;
  matches?: Array<{ attachmentId: string }>;
}

function getToolExecute<TInput extends object, TOutput>(tool: unknown) {
  const candidate = tool as { execute?: unknown };
  if (typeof candidate.execute !== 'function') {
    throw new Error('Tool execute function is unavailable in test.');
  }
  return candidate.execute as (input: TInput) => Promise<TOutput>;
}

function createTools(params?: {
  attachments?: ToolAttachmentEntry[];
  filesByHandleId?: Record<string, File>;
}) {
  const filesByHandleId = params?.filesByHandleId ?? {};
  return createLocalTools({
    enabled: true,
    enableDatetimeNow: false,
    enableCalculator: false,
    enableSearchMessages: false,
    enableSearchContextChunks: false,
    maxExpressionLength: 160,
    maxMessageResults: 6,
    maxContextChunkResults: 6,
    enableAttachmentReader: true,
    attachmentReaderMaxCharsPerRead: 12,
    attachments: params?.attachments ?? [],
    resolveAttachmentFile: async (handleId: string) => filesByHandleId[handleId] ?? null,
    enableDaytona: false,
    daytonaConfig: {
      apiKey: '',
      defaultLanguage: 'typescript',
      autoCreateSandbox: true,
      autoDeleteCreatedSandbox: true,
      defaultTimeoutSeconds: 60,
      maxStdoutChars: 6000,
      maxStderrChars: 3000,
    },
    conversationId: 'conversation-1',
  });
}

describe('local attachment tools', () => {
  test('lists attached files with dedupe by file handle', async () => {
    const now = Date.now();
    const tools = createTools({
      attachments: [
        {
          attachmentId: 'a1',
          name: 'alpha.txt',
          size: 10,
          type: 'text/plain',
          lastModified: now,
          source: 'handle',
          handleId: 'h1',
          scope: 'conversation',
        },
        {
          attachmentId: 'a2',
          name: 'alpha.txt',
          size: 10,
          type: 'text/plain',
          lastModified: now - 1,
          source: 'handle',
          handleId: 'h1',
          scope: 'project',
        },
      ],
    });

    const execute = getToolExecute<{ scope: 'auto' }, ListAttachedFilesResult>(
      tools.list_attached_files
    );
    const result = await execute({ scope: 'auto' });

    expect(result.count).toBe(1);
    expect(result.files[0].attachmentId).toBe('a1');
    expect(result.files[0].readable).toBe(true);
  });

  test('reads text attachment in bounded window', async () => {
    const file = new File(['abcdefghijklmno'], 'notes.txt', { type: 'text/plain' });
    const tools = createTools({
      attachments: [
        {
          attachmentId: 'a1',
          name: 'notes.txt',
          size: file.size,
          type: file.type,
          lastModified: Date.now(),
          source: 'handle',
          handleId: 'h1',
          scope: 'conversation',
        },
      ],
      filesByHandleId: { h1: file },
    });

    const execute = getToolExecute<
      { attachmentId: string; offsetChars: number; maxChars: number },
      ReadAttachedFileResult
    >(tools.read_attached_file);
    const result = await execute({
      attachmentId: 'a1',
      offsetChars: 2,
      maxChars: 5,
    });

    expect(result.content).toBe('cdefg');
    expect(result.returnedChars).toBe(5);
    expect(result.hasMore).toBe(true);
  });

  test('asks for attachment id when file name is ambiguous', async () => {
    const tools = createTools({
      attachments: [
        {
          attachmentId: 'a1',
          name: 'duplicate.md',
          size: 11,
          type: 'text/markdown',
          lastModified: Date.now(),
          source: 'handle',
          handleId: 'h1',
          scope: 'conversation',
        },
        {
          attachmentId: 'a2',
          name: 'duplicate.md',
          size: 12,
          type: 'text/markdown',
          lastModified: Date.now() - 1,
          source: 'handle',
          handleId: 'h2',
          scope: 'project',
        },
      ],
    });

    const execute = getToolExecute<{ fileName: string }, ReadAttachedFileResult>(
      tools.read_attached_file
    );
    const result = await execute({
      fileName: 'duplicate.md',
    });

    expect(result.error).toContain('Multiple files matched by name');
    expect(result.matches).toHaveLength(2);
  });

  test('rejects binary attachments', async () => {
    const binary = new File([new Uint8Array([0, 1, 2, 3])], 'image.png', {
      type: 'image/png',
    });
    const tools = createTools({
      attachments: [
        {
          attachmentId: 'a1',
          name: 'image.png',
          size: binary.size,
          type: binary.type,
          lastModified: Date.now(),
          source: 'handle',
          handleId: 'h1',
          scope: 'conversation',
        },
      ],
      filesByHandleId: { h1: binary },
    });

    const execute = getToolExecute<{ attachmentId: string }, ReadAttachedFileResult>(
      tools.read_attached_file
    );
    const result = await execute({
      attachmentId: 'a1',
    });

    expect(result.error).toContain('Binary files are not supported');
  });
});
