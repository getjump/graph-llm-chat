import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../../store';
import type { PendingAttachment } from '../../types';
import { formatFileSize } from '../../utils/files';

export interface ChatInputHandle {
  insertQuote: (quoteText: string) => void;
  focus: () => void;
  addAttachments: (attachments: PendingAttachment[]) => void;
}

interface ChatInputProps {
  onSubmit: (content: string, attachments: PendingAttachment[]) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onCancel?: () => void;
  onFocusInput?: () => void;
  onDraftChange?: (draft: string) => void;
  onAttachmentsChange?: (attachments: PendingAttachment[]) => void;
  draftKey?: string;
  initialContent?: string;
  initialAttachments?: PendingAttachment[];
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  (
    {
      onSubmit,
      disabled,
      isStreaming,
      onCancel,
      onFocusInput,
      onDraftChange,
      onAttachmentsChange,
      draftKey,
      initialContent,
      initialAttachments,
    },
    ref
  ) => {
    const [content, setContent] = useState(initialContent ?? '');
    const [attachments, setAttachments] = useState<PendingAttachment[]>(
      initialAttachments ?? []
    );
    const [attachError, setAttachError] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const registerFileHandle = useStore((state) => state.registerFileHandle);

    // Auto-resize textarea
    useEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      }
    }, [content]);

    const updateContent = useCallback(
      (nextContent: string) => {
        setContent(nextContent);
        onDraftChange?.(nextContent);
      },
      [onDraftChange]
    );

    const updateAttachments = useCallback(
      (nextAttachments: PendingAttachment[]) => {
        setAttachments(nextAttachments);
        onAttachmentsChange?.(nextAttachments);
      },
      [onAttachmentsChange]
    );

    // Restore draft for current node/reply when context changes.
    useEffect(() => {
      const nextContent = initialContent ?? '';
      const nextAttachments = initialAttachments ?? [];
      if (content !== nextContent) {
        updateContent(nextContent);
      }
      if (!areAttachmentsEqual(attachments, nextAttachments)) {
        updateAttachments(nextAttachments);
      }
      setAttachError(null);
    }, [
      draftKey,
      initialContent,
      initialAttachments,
      content,
      attachments,
      updateContent,
      updateAttachments,
    ]);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = content.trim();
      if ((!trimmed && attachments.length === 0) || disabled) return;

      onSubmit(trimmed, attachments);
      updateContent('');
      updateAttachments([]);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    };

    const handleAttachClick = async () => {
      setAttachError(null);
      const openPicker = (window as Window & {
        showOpenFilePicker?: (options?: {
          multiple?: boolean;
          excludeAcceptAllOption?: boolean;
          types?: Array<{
            description?: string;
            accept: Record<string, string[]>;
          }>;
        }) => Promise<FileSystemFileHandle[]>;
      }).showOpenFilePicker;

      if (openPicker) {
        try {
          const handles = await openPicker({
            multiple: true,
            excludeAcceptAllOption: false,
          });

          const next: PendingAttachment[] = [];
          for (const handle of handles) {
            const file = await handle.getFile();
            const id = uuidv4();
            await registerFileHandle({
              id,
              handle,
              name: file.name,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
              createdAt: Date.now(),
            });
            next.push({
              id,
              name: file.name,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
              source: 'handle',
              handleId: id,
            });
          }

          if (next.length > 0) {
            updateAttachments([...attachments, ...next]);
          }
          return;
        } catch (error) {
          const errorName = (error as Error)?.name;
          if (errorName === 'AbortError') {
            return;
          }
          setAttachError('Failed to open file via system dialog.');
        }
      }

      fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length === 0) return;

      const next = files.map((file) => ({
        id: uuidv4(),
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        source: 'memory' as const,
        file,
      }));
      updateAttachments([...attachments, ...next]);
      event.target.value = '';
    };

    const removeAttachment = (id: string) => {
      updateAttachments(attachments.filter((attachment) => attachment.id !== id));
    };

    useImperativeHandle(
      ref,
      () => ({
        insertQuote: (quoteText: string) => {
          const textarea = textareaRef.current;
          if (!textarea) return;
          const trimmed = quoteText.trim();
          if (!trimmed) return;

          const lines = trimmed.split(/\r?\n/);
          const quoted = lines
            .map((line) => (line.trim() === '' ? '> ' : `> ${line}`))
            .join('\n');
          const insert = `${quoted}\n\n`;

          const start = textarea.selectionStart ?? content.length;
          const end = textarea.selectionEnd ?? content.length;
          const currentValue = textarea.value;
          const nextValue = `${currentValue.slice(0, start)}${insert}${currentValue.slice(
            end
          )}`;

          updateContent(nextValue);
          const nextCursor = start + insert.length;
          requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(nextCursor, nextCursor);
          });
        },
        focus: () => {
          textareaRef.current?.focus();
        },
        addAttachments: (newAttachments: PendingAttachment[]) => {
          if (newAttachments.length === 0) return;
          updateAttachments([...attachments, ...newAttachments]);
        },
      }),
      [attachments, content, updateAttachments, updateContent]
    );

    return (
      <form onSubmit={handleSubmit} className="border-t border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900">
        <div className="flex gap-3 items-end max-w-4xl mx-auto">
          <button
            type="button"
            onClick={handleAttachClick}
            data-testid="attach-files"
            disabled={disabled || isStreaming}
            className="px-3 py-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Attach
          </button>
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              data-testid="chat-input"
              value={content}
              onChange={(e) => updateContent(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={onFocusInput}
              placeholder="Type a message... (Shift+Enter for new line)"
              disabled={disabled}
              rows={1}
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-500 dark:text-gray-100 dark:disabled:text-gray-500 bg-white dark:bg-gray-900"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            data-testid="file-input"
            className="hidden"
            onChange={handleFileChange}
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              data-testid="stop-streaming"
              className="px-4 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Stop
            </button>
          ) : (
            <button
              type="submit"
              data-testid="send-message"
              disabled={disabled || (!content.trim() && attachments.length === 0)}
              className="px-4 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
              Send
            </button>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="max-w-4xl mx-auto mt-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                data-testid="attachment-chip"
                data-attachment-id={attachment.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-200 bg-gray-50 dark:bg-gray-800"
              >
                <span className="font-medium">{attachment.name}</span>
                <span className="text-gray-400">{formatFileSize(attachment.size)}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  data-testid="remove-attachment"
                  data-attachment-id={attachment.id}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {attachError && (
          <div className="max-w-4xl mx-auto mt-2 text-xs text-amber-600 dark:text-amber-400">
            {attachError}
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </form>
    );
  }
);

ChatInput.displayName = 'ChatInput';

function areAttachmentsEqual(
  a: PendingAttachment[],
  b: PendingAttachment[]
) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.name !== right.name ||
      left.size !== right.size ||
      left.source !== right.source ||
      left.handleId !== right.handleId
    ) {
      return false;
    }
  }
  return true;
}
