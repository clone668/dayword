import { describe, expect, it } from 'vitest';
import { initLevel } from '../miniprogram/core/level.js';
import { initStreak } from '../miniprogram/core/streak.js';
import type { WordState } from '../miniprogram/core/types.js';
import {
  DRAFT_KEY,
  LocalRepository,
  type StorageDriver,
} from '../miniprogram/data/local-repository.js';
import type { LearningDraft, SnapshotData } from '../miniprogram/data/repository.js';
import { WORD_BY_TEXT } from '../miniprogram/data/words.js';
import { day } from './helpers.js';

class FailingDriver implements StorageDriver {
  values = new Map<string, unknown>();
  writes = 0;
  failAt: number | null = null;

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.writes++;
    if (this.writes === this.failAt) throw new Error('模拟 Storage 写满');
    this.values.set(key, structuredClone(value));
  }

  remove(key: string): void {
    this.values.delete(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

const apple = WORD_BY_TEXT.get('apple')!.id;

function state(updatedAt: number): WordState {
  return {
    wordId: apple,
    box: 2,
    dueAt: day(3),
    lapses: 0,
    streak: 1,
    reps: 1,
    firstSeenAt: day(0),
    updatedAt,
  };
}

function draft(over: Partial<LearningDraft> = {}): LearningDraft {
  return {
    id: 'lesson-1',
    at: day(0),
    session: {
      queue: [{ wordId: apple, isNew: true }],
      done: [],
      misses: {},
      answers: [],
      plannedTotal: 1,
    },
    states: [],
    firstTry: [],
    seen: [],
    asked: 0,
    guesses: 0,
    newCount: 1,
    reviewCount: 0,
    activeSeconds: 0,
    updatedAt: day(0),
    ...over,
  };
}

function snapshot(states: WordState[] = []): SnapshotData {
  return {
    profile: { level: initLevel(2), streak: initStreak(), placed: true },
    states,
    logs: [
      {
        day: day(0, 0),
        newCount: 1,
        reviewCount: 0,
        firstTryCorrect: 0,
        firstTryTotal: 0,
        answerCount: 1,
        guessCount: 0,
        seconds: 15,
      },
    ],
  };
}

describe('学习断点与结算恢复', () => {
  it('初始断点、逐题状态和固定课程日期可跨重启恢复', async () => {
    const storage = new FailingDriver();
    const first = new LocalRepository(storage);
    const started = draft();
    await first.saveDraft(started);

    const answered = draft({
      at: started.at,
      session: {
        queue: [],
        done: [apple],
        misses: {},
        answers: [{ wordId: apple, correct: true, rtMs: 900, kind: 'en2zh', at: started.at }],
        plannedTotal: 1,
      },
      states: [state(day(0) + 1)],
      firstTry: [{ correct: true, isNew: true }],
      seen: [apple],
      asked: 1,
      activeSeconds: 12,
      updatedAt: day(1),
    });
    await first.saveDraft(answered);

    const restarted = new LocalRepository(storage);
    const restored = await restarted.loadDraft();
    expect(restored).toEqual(answered);
    expect(restored!.at).toBe(day(0));
    expect(restored!.session.done).toEqual([apple]);
  });

  it('逐题保存失败后旧断点不变，重试只落同一次作答', async () => {
    const storage = new FailingDriver();
    const repo = new LocalRepository(storage);
    const before = draft();
    const after = draft({ asked: 1, seen: [apple], states: [state(day(1))], updatedAt: day(1) });
    await repo.saveDraft(before);
    storage.failAt = storage.writes + 1;

    await expect(repo.saveDraft(after)).rejects.toThrow('Storage 写满');
    storage.failAt = null;
    expect(await repo.loadDraft()).toEqual(before);

    await repo.saveDraft(after);
    expect(await repo.loadDraft()).toEqual(after);
    expect((await repo.loadDraft())!.asked).toBe(1);
  });

  it('结算中断保留草稿，重启恢复后完成同一快照且不重复日志', async () => {
    const storage = new FailingDriver();
    const repo = new LocalRepository(storage);
    const complete = draft({
      session: { queue: [], done: [apple], misses: {}, answers: [], plannedTotal: 1 },
      states: [state(day(1))],
      asked: 1,
      updatedAt: day(1),
    });
    const final = snapshot(complete.states);
    await repo.saveDraft(complete);
    // 9 个 staged 值、1 个 manifest，随后在正式 key 覆盖期间中断。
    storage.failAt = storage.writes + 12;

    await expect(repo.commitSnapshot(final, true)).rejects.toThrow('Storage 写满');
    storage.failAt = null;
    expect(storage.values.get(DRAFT_KEY)).toEqual(complete);
    storage.values.set('dw:tx:abandoned:0', { stale: true });

    const restarted = new LocalRepository(storage);
    expect(await restarted.loadDraft()).toBeNull();
    expect(storage.values.has('dw:tx:abandoned:0')).toBe(false);
    expect(await restarted.loadLogs()).toEqual(final.logs);
    expect(await restarted.loadStates(1)).toEqual(complete.states);

    await restarted.commitSnapshot(final, true);
    expect(await restarted.loadLogs()).toEqual(final.logs);
    expect(await restarted.loadDraft()).toBeNull();
  });
});
