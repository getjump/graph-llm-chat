import {
  DEFAULT_ATTACHMENT_PROCESSING,
  normalizeAttachmentProcessingSettings,
  splitTextWithOverlap,
  tokenizeRetrievalText,
  computeLexicalChunkScore,
  pickTopRetrievalChunks,
  buildExtractiveFallbackSummary,
  compactAttachmentContextMessage,
} from './attachments';

describe('attachments utils', () => {
  it('normalizes attachment processing settings', () => {
    expect(normalizeAttachmentProcessingSettings()).toEqual(
      DEFAULT_ATTACHMENT_PROCESSING
    );

    expect(
      normalizeAttachmentProcessingSettings({
        mode: 'summarize',
        retrievalTopK: 100,
        chunkSize: 100,
        chunkOverlap: 900,
      })
    ).toEqual({
      mode: 'summarize',
      retrievalTopK: 20,
      chunkSize: 400,
      chunkOverlap: 399,
    });
  });

  it('splits text with overlap', () => {
    const chunks = splitTextWithOverlap('abcdefghij', 4, 1);
    expect(chunks).toEqual(['abcd', 'defg', 'ghij', 'j']);
  });

  it('tokenizes and scores chunks for lexical retrieval', () => {
    const terms = tokenizeRetrievalText('Japan budget 2026');
    expect(terms).toEqual(['japan', 'budget', '2026']);

    const relevant = computeLexicalChunkScore('Japan budget for 2026 is high', terms);
    const irrelevant = computeLexicalChunkScore('Weather in Rome is sunny', terms);

    expect(relevant).toBeGreaterThan(irrelevant);
    expect(irrelevant).toBe(0);
  });

  it('picks top retrieval chunks by score and order', () => {
    const top = pickTopRetrievalChunks(
      [
        {
          attachmentName: 'a.txt',
          attachmentSize: 10,
          chunkIndex: 1,
          chunkText: 'low',
          score: 1,
          order: 2,
        },
        {
          attachmentName: 'b.txt',
          attachmentSize: 10,
          chunkIndex: 0,
          chunkText: 'high',
          score: 3,
          order: 5,
        },
        {
          attachmentName: 'c.txt',
          attachmentSize: 10,
          chunkIndex: 0,
          chunkText: 'mid',
          score: 3,
          order: 1,
        },
      ],
      2
    );

    expect(top.map((item) => item.attachmentName)).toEqual(['c.txt', 'b.txt']);
  });

  it('builds extractive fallback summary', () => {
    const summary = buildExtractiveFallbackSummary('Line one\n\nLine two');
    expect(summary).toBe('- Line one\n- Line two');
  });

  it('compacts retrieved attachment context message for UI', () => {
    const compact = compactAttachmentContextMessage(
      'Attachment context (retrieved):\nMode: retrieval (hybrid lexical + embedding)\nTop K: 6\n...'
    );
    expect(compact).toBe(
      'Attachment context (retrieved): Mode: retrieval (hybrid lexical + embedding)'
    );
  });
});
