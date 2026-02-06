const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/xhtml+xml',
  'application/x-yaml',
  'application/yaml',
  'text/markdown',
  'text/csv',
]);

export function isTextLikeFile(file: File) {
  if (TEXT_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix))) return true;
  if (TEXT_MIME_TYPES.has(file.type)) return true;
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.md') ||
    name.endsWith('.txt') ||
    name.endsWith('.csv') ||
    name.endsWith('.json') ||
    name.endsWith('.xml') ||
    name.endsWith('.html') ||
    name.endsWith('.htm') ||
    name.endsWith('.yaml') ||
    name.endsWith('.yml') ||
    name.endsWith('.toml') ||
    name.endsWith('.ini') ||
    name.endsWith('.cfg') ||
    name.endsWith('.conf') ||
    name.endsWith('.ics') ||
    name.endsWith('.log')
  );
}

export function formatFileSize(size: number) {
  if (!Number.isFinite(size)) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function* streamFileTextChunks(
  file: File,
  chunkCharLimit: number,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  if (typeof file.stream !== 'function') {
    const text =
      typeof file.text === 'function'
        ? await file.text()
        : await readFileAsText(file);
    let offset = 0;
    while (offset < text.length) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      yield text.slice(offset, offset + chunkCharLimit);
      offset += chunkCharLimit;
    }
    return;
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (buffer.length >= chunkCharLimit) {
        const chunk = buffer.slice(0, chunkCharLimit);
        buffer = buffer.slice(chunkCharLimit);
        yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }

  buffer += decoder.decode();
  if (buffer.length > 0) {
    yield buffer;
  }
}

function readFileAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      resolve(String(file));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}
