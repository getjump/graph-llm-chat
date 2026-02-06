import { describe, expect, it } from 'vitest';
import { formatFileSize, isTextLikeFile, streamFileTextChunks } from './files';

describe('files utils', () => {
  it('formats file sizes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1023)).toBe('1023 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('detects text-like files', () => {
    const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const jsonFile = new File(['{}'], 'data.json', { type: 'application/json' });
    const calendarFile = new File(['BEGIN:VCALENDAR'], 'event.ics', { type: '' });
    const unknownFile = new File(['binary'], 'blob.bin', { type: 'application/octet-stream' });

    expect(isTextLikeFile(textFile)).toBe(true);
    expect(isTextLikeFile(jsonFile)).toBe(true);
    expect(isTextLikeFile(calendarFile)).toBe(true);
    expect(isTextLikeFile(unknownFile)).toBe(false);
  });

  it('streams file chunks without loading full file', async () => {
    const file = new File(['hello world'], 'sample.txt', { type: 'text/plain' });
    const chunks: string[] = [];

    for await (const chunk of streamFileTextChunks(file, 5)) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('hello world');
    expect(chunks.length).toBeGreaterThan(1);
  });
});
