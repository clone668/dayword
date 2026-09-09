/**
 * Storage 里的不可信 JSON → 严格领域数据。
 * 每个 normalizer 都做最小粒度恢复：一条坏状态不能拖着整份孩子进度一起清空。
 */
import { initLevel, WINDOW, type FirstTry, type LevelState } from '../core/level.js';
import { MAX_RETRY, type SessionState } from '../core/session.js';
import type { DailyLog } from '../core/stats.js';
import { initStreak, MAX_SHIELDS, type StreakState } from '../core/streak.js';
import type { Box, Level, QuestionKind, WordState } from '../core/types.js';
import type { LearningDraft, Profile } from './repository.js';
import { canonicalWordId } from './words.js';

const LEVELS: readonly Level[] = [1, 2, 3, 4, 5, 6];
const BOXES: readonly Box[] = [1, 2, 3, 4, 5];
const KINDS: readonly QuestionKind[] = [
  'audio2image',
  'image2word',
  'en2zh',
  'zh2en',
  'dragSpell',
  'clozeSentence',
  'typeSpell',
  'dictation',
];

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  const n = finite(v);
  return n === null ? fallback : Math.max(min, Math.min(max, Math.trunc(n)));
};
const timestamp = (v: unknown, fallback: number | null = null): number | null => {
  const n = finite(v);
  return n === null || n < 0 ? fallback : n;
};
const bools = (v: unknown): boolean[] =>
  Array.isArray(v) ? v.filter((x): x is boolean => typeof x === 'boolean').slice(-WINDOW) : [];
const level = (v: unknown, fallback: Level): Level => (LEVELS.includes(v as Level) ? (v as Level) : fallback);
const box = (v: unknown): Box | null => (BOXES.includes(v as Box) ? (v as Box) : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

export function normalizeLevelState(value: unknown, fallback: Level): LevelState {
  const v = obj(value);
  if (v === null) return initLevel(fallback);
  return {
    level: level(v['level'], fallback),
    recent: bools(v['recent']),
    upDays: int(v['upDays'], 0, 0, 3),
    downDays: int(v['downDays'], 0, 0, 3),
    lastEvalDay: timestamp(v['lastEvalDay']),
    changedDay: timestamp(v['changedDay']),
  };
}

export function normalizeStreak(value: unknown): StreakState {
  const v = obj(value);
  if (v === null) return initStreak();
  const current = int(v['current']);
  return {
    current,
    best: Math.max(current, int(v['best'])),
    shields: int(v['shields'], 0, 0, MAX_SHIELDS),
    lastDay: timestamp(v['lastDay']),
  };
}

export function normalizeProfile(value: unknown, fallback: Level): Profile {
  const v = obj(value);
  return {
    level: normalizeLevelState(v?.['level'], fallback),
    streak: normalizeStreak(v?.['streak']),
    placed: v?.['placed'] === true,
  };
}

const nonNegative = (v: unknown): number | null => {
  const n = finite(v);
  return n === null || n < 0 ? null : n;
};

export function normalizeWordState(value: unknown): WordState | null {
  const v = obj(value);
  if (v === null || typeof v['wordId'] !== 'string') return null;
  const b = box(v['box']);
  const dueAt = nonNegative(v['dueAt']);
  const firstSeenAt = nonNegative(v['firstSeenAt']);
  const updatedAt = nonNegative(v['updatedAt']);
  if (b === null || dueAt === null || firstSeenAt === null || updatedAt === null) return null;
  return {
    wordId: canonicalWordId(v['wordId']),
    box: b,
    dueAt,
    lapses: int(v['lapses']),
    streak: int(v['streak']),
    reps: int(v['reps']),
    firstSeenAt,
    updatedAt,
  };
}

export function normalizeStates(value: unknown): WordState[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, WordState>();
  for (const raw of value) {
    const state = normalizeWordState(raw);
    if (state === null) continue;
    const old = byId.get(state.wordId);
    if (old === undefined || state.updatedAt >= old.updatedAt) byId.set(state.wordId, state);
  }
  return [...byId.values()];
}

export function normalizeDailyLog(value: unknown): DailyLog | null {
  const v = obj(value);
  const day = timestamp(v?.['day']);
  if (v === null || day === null) return null;
  const newCount = int(v['newCount']);
  const reviewCount = int(v['reviewCount']);
  const firstTryTotal = int(v['firstTryTotal']);
  const firstTryCorrect = int(v['firstTryCorrect'], 0, 0, firstTryTotal);
  const answerCount = Math.max(int(v['answerCount']), firstTryTotal, newCount + reviewCount);
  return {
    day,
    newCount,
    reviewCount,
    firstTryCorrect,
    firstTryTotal,
    answerCount,
    guessCount: int(v['guessCount'], 0, 0, answerCount),
    seconds: int(v['seconds']),
  };
}

export function normalizeLogs(value: unknown): DailyLog[] {
  if (!Array.isArray(value)) return [];
  const byDay = new Map<number, DailyLog>();
  for (const raw of value) {
    const log = normalizeDailyLog(raw);
    if (log !== null) byDay.set(log.day, log);
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day).slice(-60);
}

function normalizeAnswer(value: unknown) {
  const v = obj(value);
  if (
    v === null ||
    typeof v['wordId'] !== 'string' ||
    typeof v['correct'] !== 'boolean' ||
    !KINDS.includes(v['kind'] as QuestionKind)
  ) {
    return null;
  }
  const at = nonNegative(v['at']);
  if (at === null) return null;
  return {
    wordId: canonicalWordId(v['wordId']),
    correct: v['correct'],
    rtMs: int(v['rtMs']),
    kind: v['kind'] as QuestionKind,
    at,
  };
}

function normalizeSession(value: unknown): SessionState | null {
  const v = obj(value);
  if (v === null || !Array.isArray(v['queue'])) return null;
  const queue = v['queue'].flatMap((raw) => {
    const item = obj(raw);
    return item !== null && typeof item['wordId'] === 'string'
      ? [{ wordId: canonicalWordId(item['wordId']), isNew: item['isNew'] === true }]
      : [];
  });
  const answers = Array.isArray(v['answers']) ? v['answers'].map(normalizeAnswer).filter((a) => a !== null) : [];
  const missesRaw = obj(v['misses']);
  const misses: Record<string, number> = {};
  if (missesRaw !== null) {
    for (const [id, count] of Object.entries(missesRaw)) {
      misses[canonicalWordId(id)] = int(count, 0, 0, MAX_RETRY + 1);
    }
  }
  return {
    queue,
    done: strings(v['done']).map(canonicalWordId),
    misses,
    answers,
    plannedTotal: int(v['plannedTotal'], queue.length, 0),
  };
}

function normalizeFirstTry(value: unknown): FirstTry | null {
  const v = obj(value);
  return v !== null && typeof v['correct'] === 'boolean' && typeof v['isNew'] === 'boolean'
    ? { correct: v['correct'], isNew: v['isNew'] }
    : null;
}

export function normalizeDraft(value: unknown): LearningDraft | null {
  const v = obj(value);
  const session = normalizeSession(v?.['session']);
  const at = timestamp(v?.['at']);
  const updatedAt = timestamp(v?.['updatedAt']);
  if (v === null || typeof v['id'] !== 'string' || session === null || at === null || updatedAt === null) return null;
  const firstTry = Array.isArray(v['firstTry'])
    ? v['firstTry'].map(normalizeFirstTry).filter((x) => x !== null)
    : [];
  return {
    id: v['id'],
    at,
    session,
    states: normalizeStates(v['states']),
    firstTry,
    seen: [...new Set(strings(v['seen']).map(canonicalWordId))],
    asked: int(v['asked']),
    guesses: int(v['guesses']),
    newCount: int(v['newCount']),
    reviewCount: int(v['reviewCount']),
    activeSeconds: int(v['activeSeconds']),
    updatedAt,
  };
}
