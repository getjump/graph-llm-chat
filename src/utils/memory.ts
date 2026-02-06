import type {
  MemoryCategory,
  MemorySettings,
  NormalizedMemorySettings,
  MessageRole,
} from '../types';

export const DEFAULT_MEMORY_SETTINGS: NormalizedMemorySettings = {
  enabled: false,
  includeConversation: true,
  includeProject: true,
  includeUser: true,
  autoExtractUser: true,
  autoExtractAssistant: false,
  maxPerMessage: 4,
  maxRetrieved: 8,
  minConfidence: 0.55,
};

export interface MemoryCandidate {
  text: string;
  normalizedText: string;
  category: MemoryCategory;
  confidence: number;
}

const PREFERENCE_PATTERN =
  /\b(prefer|preferred|like|dislike|tone|style|format|verbose|brief|language)\b/i;
const CONSTRAINT_PATTERN =
  /\b(must|should|need to|do not|don't|never|always|deadline|limit|constraint|required)\b/i;
const CONTEXT_PATTERN =
  /\b(project|building|working on|stack|using|we use|goal|roadmap|architecture)\b/i;
const GENERIC_PATTERN = /\b(hello|thanks|thank you|ok|sure|got it|great)\b/i;

export function normalizeMemorySettings(
  value?: MemorySettings | null
): NormalizedMemorySettings {
  const candidate = value ?? {};
  const maxPerMessage = clampInt(candidate.maxPerMessage, 1, 12, 4);
  const maxRetrieved = clampInt(candidate.maxRetrieved, 1, 24, 8);
  const minConfidence = clampNumber(candidate.minConfidence, 0.1, 1, 0.55);

  return {
    enabled: candidate.enabled ?? DEFAULT_MEMORY_SETTINGS.enabled,
    includeConversation:
      candidate.includeConversation ?? DEFAULT_MEMORY_SETTINGS.includeConversation,
    includeProject: candidate.includeProject ?? DEFAULT_MEMORY_SETTINGS.includeProject,
    includeUser: candidate.includeUser ?? DEFAULT_MEMORY_SETTINGS.includeUser,
    autoExtractUser: candidate.autoExtractUser ?? DEFAULT_MEMORY_SETTINGS.autoExtractUser,
    autoExtractAssistant:
      candidate.autoExtractAssistant ?? DEFAULT_MEMORY_SETTINGS.autoExtractAssistant,
    maxPerMessage,
    maxRetrieved,
    minConfidence,
  };
}

export function normalizeMemoryText(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function extractMemoryCandidates(
  content: string,
  role: MessageRole,
  maxCandidates: number
): MemoryCandidate[] {
  if (!content.trim()) return [];

  const max = Math.max(1, Math.min(12, maxCandidates));
  const cleaned = stripMarkdownNoise(content);
  const sentences = splitIntoSentences(cleaned);
  const seen = new Set<string>();
  const candidates: MemoryCandidate[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 12 || trimmed.length > 240) continue;
    if (trimmed.endsWith('?')) continue;
    if (GENERIC_PATTERN.test(trimmed)) continue;

    const normalizedText = normalizeMemoryText(trimmed);
    if (!normalizedText || seen.has(normalizedText)) continue;
    seen.add(normalizedText);

    const category = classifyMemoryCategory(trimmed);
    const confidence = scoreSentence(trimmed, role, category);
    if (confidence < 0.2) continue;

    candidates.push({
      text: trimmed,
      normalizedText,
      category,
      confidence,
    });
  }

  return candidates
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, max);
}

function classifyMemoryCategory(text: string): MemoryCategory {
  if (PREFERENCE_PATTERN.test(text)) return 'preference';
  if (CONSTRAINT_PATTERN.test(text)) return 'constraint';
  if (CONTEXT_PATTERN.test(text)) return 'context';
  return 'fact';
}

function scoreSentence(
  text: string,
  role: MessageRole,
  category: MemoryCategory
) {
  let score = 0.35;
  const lower = text.toLowerCase();

  if (/\b(i|my|we|our)\b/.test(lower)) score += 0.25;
  if (/\b\d{2,4}\b/.test(lower)) score += 0.12;
  if (/\b(use|using|works|working|build|implement)\b/.test(lower)) score += 0.1;
  if (category === 'preference') score += 0.2;
  if (category === 'constraint') score += 0.2;
  if (category === 'context') score += 0.12;
  if (role === 'assistant') score -= 0.08;
  if (text.length > 180) score -= 0.08;

  return clampNumber(score, 0, 1, 0.35);
}

function splitIntoSentences(text: string) {
  return text
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[.!;])\s+/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripMarkdownNoise(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/[#*_~]/g, ' ');
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return Math.round(numeric);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return Number(numeric.toFixed(3));
}
