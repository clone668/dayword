import { describe, expect, it } from 'vitest';
import { configFor } from '../miniprogram/core/config.js';
import { COOLDOWN_DAYS, DOWN_RATIO, UP_RATIO } from '../miniprogram/core/level.js';
import { MAX_RETRY } from '../miniprogram/core/session.js';
import { ALL_BOXES, boxDistribution, masteredCount, weekReport } from '../miniprogram/core/stats.js';
import { MAX_SHIELDS } from '../miniprogram/core/streak.js';
import { daysBetween } from '../miniprogram/core/time.js';
import { day } from './helpers.js';
import { runSim } from './simulator.js';

describe('90 天正常出勤', () => {
  const sim = runSim({ days: 90, poolSize: 1800, seed: 42 });
  const attended = sim.records.filter((r) => r.attended);

  it('每日题量始终有界 —— 不会某天突然爆给孩子一大堆', () => {
    for (const r of attended) {
      const cfg = configFor(r.level);
      const planned = r.plan.reviewIds.length + r.newIntroduced;
      expect(planned).toBeLessThanOrEqual(cfg.reviewCap + cfg.newPerDay);
      expect(r.asked).toBeLessThanOrEqual(planned * (MAX_RETRY + 1));
    }
  });

  it('90 天确实学到了东西', () => {
    expect(sim.states.size).toBeGreaterThan(100);
    expect(masteredCount([...sim.states.values()])).toBeGreaterThan(30);
  });

  it('学习曲线向上：第 15 / 45 / 89 天掌握量递增', () => {
    const m = (d: number) => sim.records.find((r) => r.d === d)!.mastered;
    expect(m(15)).toBeLessThan(m(45));
    expect(m(45)).toBeLessThan(m(89));
  });

  it('正常出勤下不会长期积压', () => {
    const backlogDays = attended.filter((r) => r.plan.backlog > 0).length;
    expect(backlogDays / attended.length).toBeLessThan(0.2);
  });

  it('每次复习后都至少推到明天，不会当天反复出现同一个词', () => {
    for (const s of sim.states.values()) {
      expect(daysBetween(s.updatedAt, s.dueAt)).toBeGreaterThanOrEqual(1);
    }
  });

  it('盒子分布合法，一个词都没丢', () => {
    const dist = boxDistribution([...sim.states.values()]);
    expect(ALL_BOXES.reduce((n, b) => n + dist[b], 0)).toBe(sim.states.size);
    for (const b of ALL_BOXES) expect(dist[b]).toBeGreaterThanOrEqual(0);
  });

  it('连续打卡一路累计到 90 天', () => {
    expect(sim.streak.current).toBe(90);
    expect(sim.streak.best).toBe(90);
  });

  it('每日聚合日志逐日唯一，不会重复记账', () => {
    const days = sim.logs.map((l) => l.day);
    expect(new Set(days).size).toBe(days.length);
    expect(sim.logs).toHaveLength(attended.length);
  });

  it('词池没被抽干 —— 否则"不发新词"是词库空了，不是调度器的决定', () => {
    expect(attended.filter((r) => r.starved)).toHaveLength(0);
  });
});

describe('断签 10 天后回归', () => {
  const AWAY_FROM = 30;
  const BACK_ON = 40;
  const sim = runSim({
    days: 80,
    poolSize: 1800,
    seed: 7,
    attends: (d) => d < AWAY_FROM || d >= BACK_ON,
  });
  const returnDay = sim.records.find((r) => r.d === BACK_ON)!;

  it('断签期间积压确实堆了起来', () => {
    expect(returnDay.plan.backlog).toBeGreaterThan(0);
  });

  it('回归当天复习量被硬封顶 —— 这是防流失的关键防护', () => {
    const cfg = configFor(returnDay.level);
    expect(returnDay.plan.reviewIds.length).toBe(cfg.reviewCap);
    expect(returnDay.asked).toBeLessThanOrEqual((cfg.reviewCap + cfg.newPerDay) * (MAX_RETRY + 1));
  });

  it('积压严重时暂停发新词，先还旧账', () => {
    expect(returnDay.plan.newPaused).toBe(true);
    expect(returnDay.newIntroduced).toBe(0);
  });

  it('积压能清空，不会永久堵住队列', () => {
    const after = sim.records.filter((r) => r.d >= BACK_ON && r.attended);
    const cleared = after.find((r) => r.plan.backlog === 0);
    expect(cleared).toBeDefined();
    expect(cleared!.d - BACK_ON).toBeLessThanOrEqual(25);
  });

  it('还完旧账后新词发放会恢复', () => {
    const after = sim.records.filter((r) => r.d > BACK_ON && r.attended);
    expect(after.some((r) => r.newIntroduced > 0)).toBe(true);
  });

  it('连续记录断掉了（护盾只够顶 3 天），但历史最佳保留', () => {
    const streakOn = (d: number) => sim.records.find((r) => r.d === d)!.streak;
    expect(streakOn(AWAY_FROM - 1)).toBe(AWAY_FROM); // 断签前已连续 30 天
    expect(streakOn(BACK_ON)).toBe(1); // 缺 10 天，3 个护盾顶不住，从 1 重来
    expect(sim.streak.best).toBeGreaterThanOrEqual(AWAY_FROM);
  });
});

/**
 * 护盾的产品意义：把"断签"从悬崖变成缓坡。
 * 上面那个 10 天断签必须断，这里的 2 天断签必须不断 —— 两端都要钉住，
 * 否则护盾很容易被改成"永远救得回来"，打卡就失去意义了。
 */
describe('短暂断签由护盾兜住', () => {
  const sim = runSim({
    days: 40,
    poolSize: 1800,
    seed: 3,
    attends: (d) => d !== 30 && d !== 31,
  });
  const streakOn = (d: number) => sim.records.find((r) => r.d === d)!.streak;

  it('缺 2 天，护盾垫上，连续记录不清零', () => {
    expect(streakOn(29)).toBe(30);
    expect(streakOn(32)).toBe(31); // 被补的两天不计入天数，但记录没断
  });

  it('护盾被消耗掉了，不是无限免死金牌', () => {
    expect(sim.streak.shields).toBeLessThan(MAX_SHIELDS);
  });
});

/**
 * 自我调速：新词是复习量的唯一来源，所以"排不下就停止进货"
 * 会让系统自动收敛到 reviewCap 附近。这条不变量是整个负担控制的地基。
 */
describe('新词发放自我调速', () => {
  const sim = runSim({ days: 120, poolSize: 2400, seed: 5 });
  const attended = sim.records.filter((r) => r.attended);

  it('有积压的那天一定不发新词', () => {
    for (const r of attended) {
      if (r.plan.backlog > 0) expect(r.newIntroduced).toBe(0);
    }
  });

  it('120 天里既发过新词也踩过刹车 —— 说明闭环真的在工作', () => {
    expect(attended.some((r) => r.newIntroduced > 0)).toBe(true);
    expect(attended.some((r) => r.plan.newPaused)).toBe(true);
  });

  it('复习量收敛在预算附近，不会随词汇量无限膨胀', () => {
    const late = attended.slice(-30);
    for (const r of late) {
      expect(r.plan.reviewIds.length).toBeLessThanOrEqual(configFor(r.level).reviewCap);
    }
    // 后期仍在持续掌握新词，不是靠"卡死不发新词"换来的低负担
    const m = (d: number) => sim.records.find((r) => r.d === d)!.mastered;
    expect(m(119)).toBeGreaterThan(m(89));
  });
});

describe('等级自适应', () => {
  it('学得快的孩子会被推上去', () => {
    const sim = runSim({ days: 90, poolSize: 1800, seed: 11, startLevel: 3, ability: 1.8 });
    expect(sim.level.level).toBeGreaterThan(3);
  });

  it('吃力的孩子会被静默降下来，而不是每天硬啃不会的题', () => {
    const sim = runSim({ days: 90, poolSize: 1800, seed: 11, startLevel: 3, ability: 0.5 });
    expect(sim.level.level).toBeLessThan(3);
  });
});

/**
 * 等级控制器最容易出的错不是崩溃，而是变成**单向棘轮**：
 * 每个孩子都被慢慢压到 L1，然后一直给 10 岁孩子出学前词 —— 测试全绿。
 *
 * 这一组盯住三件事：保持率停在健康带内、控制器双向可动、调级不频繁。
 * 曾经踩过的坑：把新词首答混进能力评估，让 60% 出头的"正常"正确率
 * 持续触发降级；以及把下线放到 0.6、上线留在 0.9，上线根本不可达。
 */
describe('等级控制器不是单向棘轮', () => {
  const sim = runSim({ days: 365, poolSize: 3000, seed: 5 });
  const changes: number[] = [];
  for (let i = 1; i < sim.records.length; i++) {
    const prev = sim.records[i - 1]!.level;
    const cur = sim.records[i]!.level;
    if (cur !== prev) changes.push(i);
  }

  it('长期保持率停在健康带内，没有被压到地板', () => {
    const late = sim.logs.slice(-60);
    const rate =
      late.reduce((n, l) => n + l.firstTryCorrect, 0) /
      late.reduce((n, l) => n + l.firstTryTotal, 0);
    expect(rate).toBeGreaterThan(DOWN_RATIO);
    expect(rate).toBeLessThan(UP_RATIO);
  });

  it('降过也升回过 —— 控制器双向可动', () => {
    const dirs = changes.map((d) => Math.sign(sim.records[d]!.level - sim.records[d - 1]!.level));
    expect(dirs).toContain(-1);
    expect(dirs).toContain(1);
  });

  it('相邻两次调级至少隔一个冷静期', () => {
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i]! - changes[i - 1]!).toBeGreaterThanOrEqual(COOLDOWN_DAYS);
    }
  });

  it('一年内调级次数有界，孩子不会一直在换词表', () => {
    expect(changes.length).toBeLessThanOrEqual(15); // 平均 24 天以上才动一次
  });

  it('掌握量长期向上；个别词遗忘掉层正常，但不会集体崩塌', () => {
    // 掌握量本身不是单调的：顶层的词忘了会掉到第 3 层，这是"掉一半"规则的本意。
    // 所以按月检查趋势，再单独限制单日回退幅度。
    const monthly = Array.from({ length: 13 }, (_, i) => sim.records[i * 30]!.mastered);
    for (let i = 1; i < monthly.length; i++) {
      expect(monthly[i]!).toBeGreaterThanOrEqual(monthly[i - 1]!);
    }

    for (let i = 1; i < sim.records.length; i++) {
      const drop = sim.records[i - 1]!.mastered - sim.records[i]!.mastered;
      // 掉层只可能发生在当天被复习到的词上，回退幅度不可能超过当天复习量
      expect(drop).toBeLessThanOrEqual(sim.records[i]!.plan.reviewIds.length);
    }
  });
});

describe('瞎猜保护', () => {
  it('秒答蒙中不推进楼梯：高瞎猜率的孩子掌握量明显更低', () => {
    const base = { days: 90, poolSize: 1800, seed: 99, guessRate: 0 } as const;
    const honest = masteredCount([...runSim(base).states.values()]);
    const clicker = masteredCount([...runSim({ ...base, guessRate: 0.9 }).states.values()]);
    expect(clicker).toBeLessThan(honest);
  });

  /**
   * 有效作答率的分母必须是**全部作答次数**，不是复习题首答数。
   * 瞎猜可能发生在新词和重试上，用 firstTryTotal 当分母算出过 −133% ——
   * 家长报告里出现负数百分比，而且越敷衍越负。
   */
  it('有效作答率恒在 0–1 之间，且敷衍的孩子明显更低', () => {
    const base = { days: 60, poolSize: 1800, seed: 21 } as const;
    const rateOf = (guessRate: number) => {
      const sim = runSim({ ...base, guessRate });
      return weekReport(sim.logs, [...sim.states.values()], day(base.days - 1)).effectiveRate;
    };

    for (const g of [0, 0.5, 0.9]) {
      const r = rateOf(g);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
    expect(rateOf(0.9)).toBeLessThan(rateOf(0));
  });
});
