import type { AttachmentProcessingSettings } from '../types';

export const DEFAULT_ATTACHMENT_PROCESSING: Required<AttachmentProcessingSettings> = {
  mode: 'retrieval',
  retrievalTopK: 6,
  chunkSize: 1200,
  chunkOverlap: 200,
};

export function normalizeAttachmentProcessingSettings(
  value?: AttachmentProcessingSettings
): Required<AttachmentProcessingSettings> {
  const mode = value?.mode === 'summarize' ? 'summarize' : 'retrieval';
  const retrievalTopK = Number.isFinite(value?.retrievalTopK)
    ? Math.max(1, Math.min(20, Math.round(value?.retrievalTopK || 0)))
    : DEFAULT_ATTACHMENT_PROCESSING.retrievalTopK;
  const chunkSize = Number.isFinite(value?.chunkSize)
    ? Math.max(400, Math.min(6000, Math.round(value?.chunkSize || 0)))
    : DEFAULT_ATTACHMENT_PROCESSING.chunkSize;
  const chunkOverlap = Number.isFinite(value?.chunkOverlap)
    ? Math.max(0, Math.min(chunkSize - 1, Math.round(value?.chunkOverlap || 0)))
    : DEFAULT_ATTACHMENT_PROCESSING.chunkOverlap;

  return {
    mode,
    retrievalTopK,
    chunkSize,
    chunkOverlap,
  };
}

export function tokenizeRetrievalText(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function computeLexicalChunkScore(chunk: string, queryTerms: string[]) {
  if (queryTerms.length === 0) return 0;
  const normalizedChunk = chunk.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    const escaped = escapeRegExp(term);
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
    const matches = normalizedChunk.match(regex);
    if (!matches) continue;
    score += matches.length;
    if (matches.length > 0) {
      score += 0.25;
    }
  }

  return score;
}

export function splitTextWithOverlap(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  if (!text) return [];

  const safeChunkSize = Math.max(1, chunkSize);
  const safeOverlap = Math.max(0, Math.min(safeChunkSize - 1, chunkOverlap));
  const step = Math.max(1, safeChunkSize - safeOverlap);

  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + safeChunkSize));
    offset += step;
  }

  return chunks;
}

export interface RetrievalChunkCandidate {
  attachmentName: string;
  attachmentSize: number;
  chunkIndex: number;
  chunkText: string;
  score: number;
  order: number;
}

export function pickTopRetrievalChunks(
  candidates: RetrievalChunkCandidate[],
  topK: number
) {
  const limitedTopK = Math.max(1, topK);
  return [...candidates]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.order !== b.order) return a.order - b.order;
      return a.chunkIndex - b.chunkIndex;
    })
    .slice(0, limitedTopK);
}

export function buildExtractiveFallbackSummary(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => (line.length > 200 ? `${line.slice(0, 197)}...` : line));
  if (lines.length === 0) {
    return '';
  }
  return lines.map((line) => `- ${line}`).join('\n');
}

export function compactAttachmentContextMessage(content: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith('Attachment context (retrieved):')) {
    return 'Attachment context (retrieved): Mode: retrieval (hybrid lexical + embedding)';
  }
  return content;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
