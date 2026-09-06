#!/usr/bin/env node
/**
 * 终端里试玩 core/ —— 在有 UI 之前唯一能"用手感受"调度器的方式。
 *
 *   npm run play                  今天的一节课，你来当那个孩子
 *   npm run play -- --advance 1   时钟前进 1 天再上课（看该复习哪些词回来了）
 *   npm run play -- --advance 5   跳 5 天，看积压与"暂停发新词"怎么触发
 *   npm run trace -- --days 14    不用打字：虚拟孩子跑 14 天，只看调度决策
 *   npm run play -- reset         清空存档
 *
 * 进度存在 `.dayword-demo.json`，和小程序的 Storage 无关，删掉即重来。
 * 音频与配图在终端里是占位符，详见 tools/quiz.ts 的说明。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { configFor } from '../miniprogram/core/config.js';
import {
  accuracy,
  evaluateDaily,
  initLevel,
  recordAnswers,
  type FirstTry,
  type LevelState,
} from '../miniprogram/core/level.js';
import { pickKind } from '../miniprogram/core/questions.js';
import { buildQuestion, type Question } from '../miniprogram/core/quiz.js';
import {
  current,
  isFinished,
  planDay,
  progress,
  startSession,
  submit,
} from '../miniprogram/core/session.js';
import { GUESS_RT_MS, isGuess, MASTERED_BOX, newWordState, review } from '../miniprogram/core/srs.js';
import { stairsView, upsertLog, weekReport, type DailyLog } from '../miniprogram/core/stats.js';
import { checkIn, initStreak, type StreakState } from '../miniprogram/core/streak.js';
import { addDays, startOfDay } from '../miniprogram/core/time.js';
import type { Answer, KindTier, Level, Word, WordState } from '../miniprogram/core/types.js';
import { checkAnswer, renderQuestion, type Rendered } from './quiz.js';
import { WORD_BY_ID, wordsUpToLevel } from './seed-words.js';

const SAVE_FILE = '.dayword-demo.json';
const line = (s = '') => console.log(s);

/* ---------------------------------- 存档 ---------------------------------- */

interface Save {
  /** 虚拟时钟相对今天偏移几天，用 --advance 推进 */
  dayOffset: number;
  level: LevelState;
  streak: StreakState;
  states: WordState[];
  logs: DailyLog[];
}

function emptySave(startLevel: Level): Save {
  return {
    dayOffset: 0,
    level: initLevel(startLevel),
    streak: initStreak(),
    states: [],
    logs: [],
  };
}

function load(startLevel: Level): Save {
  if (!existsSync(SAVE_FILE)) return emptySave(startLevel);
  return JSON.parse(readFileSync(SAVE_FILE, 'utf8')) as Save;
}

function save(s: Save): void {
  writeFileSync(SAVE_FILE, JSON.stringify(s, null, 2));
}

/**
 * 虚拟"现在"：把日期挪到偏移后的那一天，但保留真实的时刻。
 * 用 addDays 而不是加毫秒，跨夏令时不会漂（见 core/time.ts）。
 */
function virtualNow(dayOffset: number): number {
  const real = Date.now();
  return addDays(real, dayOffset) + (real - startOfDay(real));
}

/** mulberry32：确定性随机源，同一 seed 重放同一节课 */
function makeRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------- 一天的课 -------------------------------- */

/** 答题者。交互模式是真人，trace 模式是概率模型 —— 一天的流程两者共用。 */
interface Player {
  /** 新词的第一张卡是"教"不是"测"（见 core/session.ts） */
  teach(word: Word): Promise<void>;
  ask(q: Question, view: Rendered, st: WordState): Promise<{ correct: boolean; rtMs: number }>;
  /** 是否打印逐题过程 */
  verbose: boolean;
}

interface DayResult {
  level: Level;
  levelChanged: -1 | 0 | 1;
  newIssued: number;
  reviewPlanned: number;
  backlog: number;
  newPaused: boolean;
  /** 想发新词但词池空了 —— 和"调度器决定不发"表象相同，必须区分 */
  starved: boolean;
  asked: number;
  retention: number;
  streak: number;
  outcome: string;
}

async function runDay(s: Save, player: Player, rand: () => number): Promise<DayResult> {
  const now = virtualNow(s.dayOffset);
  const cfg = configFor(s.level.level);
  const byId = new Map(s.states.map((st) => [st.wordId, st]));
  const plan = planDay(s.states, cfg, now);

  // 新词从"已解锁等级且没学过"里挑；词池可能被抽干
  const pool = wordsUpToLevel(s.level.level);
  const fresh = pool.filter((w) => !byId.has(w.id)).slice(0, plan.newQuota);
  let sess = startSession(plan.reviewIds, fresh.map((w) => w.id));

  const firstTry: FirstTry[] = [];
  const seen = new Set<string>();
  let asked = 0;
  let guesses = 0;

  while (!isFinished(sess)) {
    const item = current(sess)!;
    const word = WORD_BY_ID.get(item.wordId)!;
    const st = byId.get(item.wordId) ?? newWordState(item.wordId, now);
    // 先定题型再判分：题型决定难度，这是等级唯一的作用通道
    const kind = pickKind(s.level.level, st.box, rand);
    const question = buildQuestion(word, kind, pool, rand);
    const view = renderQuestion(question, (id) => WORD_BY_ID.get(id)!);

    if (item.isNew) await player.teach(word);
    if (player.verbose) {
      const p = progress(sess);
      // 分母是词数不是题数：答错的词会插回队列再来一次，但进度条不该倒退
      line(`  ── ${p.done}/${p.total} 词过关 · ${kind} · 第 ${st.box} 层 ──`);
    }
    const { correct, rtMs } = await player.ask(question, view, st);

    const a: Answer = { wordId: item.wordId, correct, rtMs, kind, at: now };
    if (!seen.has(item.wordId)) {
      seen.add(item.wordId);
      firstTry.push({ correct, isNew: item.isNew });
    }
    if (isGuess(a)) guesses++;
    byId.set(item.wordId, review(st, a, now));
    sess = submit(sess, a);
    asked++;
  }

  const reviewed = firstTry.filter((t) => !t.isNew);
  const evaluated = evaluateDaily(recordAnswers(s.level, firstTry), now);
  const check = checkIn(s.streak, now);

  s.states = [...byId.values()];
  s.level = evaluated.state;
  s.streak = check.state;
  s.logs = upsertLog(s.logs, {
    day: startOfDay(now),
    newCount: fresh.length,
    reviewCount: plan.reviewIds.length,
    firstTryCorrect: reviewed.filter((t) => t.correct).length,
    firstTryTotal: reviewed.length,
    answerCount: asked,
    guessCount: guesses,
    seconds: asked * 8,
  });

  return {
    level: evaluated.state.level,
    levelChanged: evaluated.changed,
    newIssued: fresh.length,
    reviewPlanned: plan.reviewIds.length,
    backlog: plan.backlog,
    newPaused: plan.newPaused,
    starved: fresh.length < plan.newQuota,
    asked,
    retention: reviewed.length === 0 ? 0 : reviewed.filter((t) => t.correct).length / reviewed.length,
    streak: check.state.current,
    outcome: check.outcome,
  };
}

/* --------------------------------- 答题者 --------------------------------- */

type Ask = ReturnType<typeof createInterface>;

function humanPlayer(rl: Ask): Player {
  return {
    verbose: true,
    async teach(word) {
      line();
      line('  ✨ 新单词');
      line(`     ${word.text}   ${word.phonetic}   (${word.pos})`);
      line(`     ${word.meaningZh.join('；')}`);
      const ex = word.examples[0];
      if (ex) {
        line(`     例句：${ex.en}`);
        line(`           ${ex.zh}`);
      }
      await rl.question('     看完按回车 ');
    },
    async ask(q, view) {
      for (const l of view.prompt) line(`  ${l}`);
      view.options.forEach((o, i) => line(`     ${i + 1}. ${o}`));
      const t0 = Date.now();
      const input = await rl.question(`  ${view.hint} > `);
      const rtMs = Date.now() - t0;
      const correct = checkAnswer(
        q,
        q.isChoice ? Number.parseInt(input.trim(), 10) - 1 : input,
      );

      const truth = q.isChoice
        ? `${q.answerIndex + 1}. ${view.options[q.answerIndex]}`
        : q.answer;
      line(correct ? `  ✅ 对了！ (${(rtMs / 1000).toFixed(1)}s)` : `  ❌ 正确答案是 ${truth}`);
      if (correct && q.isChoice && rtMs < GUESS_RT_MS) {
        line('  ⚡ 秒答会被判为疑似瞎猜：算你对，但楼层不涨（srs.isGuess）');
      }
      line();
      return { correct, rtMs };
    },
  };
}

/**
 * 虚拟孩子。这里的记忆模型是**粗略替身**，只为让 trace 有东西可看；
 * 严格的模型和不变量在 tests/simulator.ts + tests/simulation.test.ts。
 */
const TIER_DELTA: Record<KindTier, number> = { recognize: 0.1, translate: 0, produce: -0.18 };

function autoPlayer(ability: number, rand: () => number): Player {
  return {
    verbose: false,
    async teach() {},
    async ask(q, _view, st) {
      const learned = 1 - Math.exp(-0.35 * ability * st.reps);
      const p = Math.min(
        0.97,
        Math.max(0.05, 0.45 * ability + 0.5 * learned - 0.15 + TIER_DELTA[q.tier]),
      );
      const correct = rand() < p;
      return { correct, rtMs: 900 + Math.floor(rand() * 4000) };
    },
  };
}

/* ---------------------------------- 报表 ---------------------------------- */

const textOf = (id: string) => WORD_BY_ID.get(id)?.text ?? id;

/** 爬楼梯 —— 孩子端的主画面，这里是它的文字版 */
function printStairs(states: readonly WordState[]): void {
  line();
  line('  🪜 爬楼梯');
  for (const f of [...stairsView(states, 6)].reverse()) {
    const label = f.box === MASTERED_BOX ? '🏆 已掌握' : `   第 ${f.box} 层`;
    const bar = '▉'.repeat(Math.min(f.count, 24)).padEnd(24, '·');
    line(`  ${label} │${bar}│ ${String(f.count).padStart(3)}  ${f.sample.map(textOf).join(' ')}`);
  }
}

/** 家长端周报 */
function printWeek(s: Save, now: number): void {
  const r = weekReport(s.logs, s.states, now);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  // 分母为 0 时 weekReport 返回 0（见其文档）。渲染成 "0%" 会让家长以为孩子全错，
  // 而真相是"今天只学了新词，还没有复习题可考"。M2 的家长页要照此处理。
  const hasReview = s.logs.some((l) => l.firstTryTotal > 0);
  line();
  line('  👨‍👩‍👧 家长周报（最近 7 天）');
  line(
    `     出勤 ${r.activeDays}/7 天 · 新学 ${r.newLearned} 词 · 累计掌握 ${r.masteredTotal} 词 · 用时 ${r.totalMinutes} 分钟`,
  );
  line(
    `     记忆保持率 ${hasReview ? pct(r.firstTryAccuracy) : '暂无（还没有复习题）'}` +
      `${hasReview ? '（健康区间 70%–90%）' : ''} · 有效作答率 ${pct(r.effectiveRate)}`,
  );
  if (r.stubborn.length > 0) {
    line(
      `     需要多陪一会儿：${r.stubborn.map((st) => `${textOf(st.wordId)}(错${st.lapses}次)`).join('、')}`,
    );
  }
}

function printDayHeader(s: Save, now: number): void {
  const cfg = configFor(s.level.level);
  line();
  line('═'.repeat(64));
  line(
    `  ${new Date(now).toLocaleDateString('zh-CN')}　L${s.level.level}　` +
      `预算：新词≤${cfg.newPerDay} 复习≤${cfg.reviewCap}　连续 ${s.streak.current} 天　护盾 ${s.streak.shields}`,
  );
  line('═'.repeat(64));
}

function printDayResult(r: DayResult, s: Save, now: number): void {
  line('─'.repeat(64));
  line(`  今天做了 ${r.asked} 题：新词 ${r.newIssued} · 复习 ${r.reviewPlanned}`);
  if (r.reviewPlanned > 0) line(`  复习题首答正确率 ${Math.round(r.retention * 100)}%`);
  if (r.newPaused) line(`  ⏸ 有 ${r.backlog} 个词排不下 → 今天暂停发新词，先还旧账`);
  if (r.starved && !r.newPaused) line('  ⚠ 演示词库已学完（不是调度器不发新词）');
  if (r.levelChanged === 1) line(`  🎉 升级！现在是 L${r.level}`);
  if (r.levelChanged === -1) line(`  （静默降到 L${r.level} —— 真机上不提示孩子）`);
  const outcomeText: Record<string, string> = {
    first: '第一次打卡',
    continued: '连续记录 +1',
    saved: '🛡 护盾顶住了断签',
    broken: '💔 连续记录断了',
    'same-day': '今天已打过卡',
  };
  line(`  ${outcomeText[r.outcome] ?? r.outcome}：连续 ${r.streak} 天`);

  // 明天会回来哪些词 —— 让间隔重复"看得见"
  const tomorrow = addDays(now, 1);
  const back = s.states.filter((st) => st.dueAt <= tomorrow).map((st) => textOf(st.wordId));
  line(`  明天要复习 ${back.length} 个：${back.slice(0, 12).join(' ')}${back.length > 12 ? ' …' : ''}`);
  const acc = accuracy(s.level);
  if (s.level.recent.length > 0) {
    line(`  能力窗口 ${s.level.recent.length}/30 样本，保持率 ${Math.round(acc * 100)}%`);
  }
}

/* ----------------------------------- CLI ---------------------------------- */

function numFlag(argv: readonly string[], name: string, dflt: number): number {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : dflt;
}

const asLevel = (n: number): Level => Math.min(6, Math.max(1, Math.round(n))) as Level;

async function play(argv: readonly string[]): Promise<void> {
  const s = load(asLevel(numFlag(argv, 'level', 2)));
  s.dayOffset += numFlag(argv, 'advance', 0);
  const now = virtualNow(s.dayOffset);

  if (s.logs.some((l) => l.day === startOfDay(now))) {
    line(`${new Date(now).toLocaleDateString('zh-CN')} 已经上过课了 —— 一天只算一次（打卡是幂等的）。`);
    line('把时钟拨到明天：npm run play -- --advance 1');
    return;
  }

  printDayHeader(s, now);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const r = await runDay(s, humanPlayer(rl), makeRand(numFlag(argv, 'seed', Date.now())));
    if (r.asked === 0) {
      line('  今天没有到期的词，演示词库也发完了 —— 换个更高等级重来：npm run play -- reset');
      return;
    }
    printDayResult(r, s, now);
    printStairs(s.states);
    printWeek(s, now);
    save(s);
    line();
    line(`  已存档 → ${SAVE_FILE}　下一节课：npm run play -- --advance 1`);
  } finally {
    rl.close();
  }
}

async function trace(argv: readonly string[]): Promise<void> {
  const days = numFlag(argv, 'days', 10);
  const ability = numFlag(argv, 'ability', 1);
  const startLevel = asLevel(numFlag(argv, 'level', 2));
  const s = emptySave(startLevel);
  const rand = makeRand(numFlag(argv, 'seed', 42));
  const player = autoPlayer(ability, rand);

  line();
  line(`  虚拟孩子（ability=${ability}）跑 ${days} 天，只看调度器的决定：`);
  line(
    `  演示词库 L1–L${startLevel} 共 ${wordsUpToLevel(startLevel).length} 词，` +
      `很快会被学完 —— 之后的"新词 0"是词库空了，不是调度器踩刹车（见"事件"列）。`,
  );
  line();
  line('   天  等级  新词  复习  积压  题数  保持率  连续  事件');
  line('  ' + '─'.repeat(62));

  for (let d = 0; d < days; d++) {
    s.dayOffset = d;
    const r = await runDay(s, player, rand);
    const notes = [
      r.newPaused ? '暂停发新词' : '',
      r.starved && !r.newPaused ? '词库已空' : '',
      r.levelChanged === 1 ? '升级 🎉' : r.levelChanged === -1 ? '静默降级' : '',
      r.outcome === 'saved' ? '护盾' : r.outcome === 'broken' ? '断签' : '',
    ].filter(Boolean);
    line(
      `  ${String(d + 1).padStart(3)}   L${r.level}  ` +
        `${String(r.newIssued).padStart(4)}  ${String(r.reviewPlanned).padStart(4)}  ` +
        `${String(r.backlog).padStart(4)}  ${String(r.asked).padStart(4)}  ` +
        `${(r.reviewPlanned === 0 ? '  --' : `${Math.round(r.retention * 100)}%`).padStart(6)}  ` +
        `${String(r.streak).padStart(4)}  ${notes.join(' ')}`,
    );
  }

  printStairs(s.states);
  printWeek(s, virtualNow(s.dayOffset));
  line();
  line(`  （这是粗略模型，严格的不变量断言在 tests/simulation.test.ts：npm test）`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => !a.startsWith('--') && Number.isNaN(Number(a))) ?? 'play';

  if (cmd === 'reset') {
    if (existsSync(SAVE_FILE)) rmSync(SAVE_FILE);
    line('存档已清空。');
    return;
  }
  if (cmd === 'trace') return trace(argv);
  if (cmd === 'play') return play(argv);
  line(`未知命令 "${cmd}"。可用：play（默认） / trace / reset`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
