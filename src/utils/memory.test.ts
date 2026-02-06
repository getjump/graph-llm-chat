import {
  DEFAULT_MEMORY_SETTINGS,
  extractMemoryCandidates,
  normalizeMemorySettings,
  normalizeMemoryText,
} from './memory';

describe('memory utils', () => {
  it('normalizes memory settings', () => {
    expect(normalizeMemorySettings()).toEqual(DEFAULT_MEMORY_SETTINGS);
    expect(
      normalizeMemorySettings({
        enabled: true,
        maxPerMessage: 100,
        maxRetrieved: 0,
        minConfidence: 9,
      })
    ).toEqual({
      ...DEFAULT_MEMORY_SETTINGS,
      enabled: true,
      maxPerMessage: 12,
      maxRetrieved: 1,
      minConfidence: 1,
    });
  });

  it('normalizes memory text', () => {
    expect(normalizeMemoryText('  We   use TypeScript.  ')).toBe('we use typescript.');
  });

  it('extracts useful user memory candidates', () => {
    const candidates = extractMemoryCandidates(
      `We use TypeScript and Vite.\nPlease keep answers concise and in English.\nThanks!`,
      'user',
      5
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates.some(
        (entry) => entry.category === 'preference' || entry.category === 'context'
      )
    ).toBe(true);
    expect(candidates.every((entry) => entry.confidence > 0)).toBe(true);
  });

  it('filters noisy content', () => {
    const candidates = extractMemoryCandidates(
      'Hello.\nThanks!\n```ts\nconst a = 1\n```',
      'assistant',
      4
    );
    expect(candidates).toEqual([]);
  });
});
