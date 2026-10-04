import { describe, expect, it } from 'vitest';
import { LookaheadScheduler } from '../src/scheduler';

describe('LookaheadScheduler', () => {
  it('schedules evenly spaced steps within the lookahead window', () => {
    const clock = { currentTime: 0 };
    const s = new LookaheadScheduler(clock, { lookahead: 0.1 });
    const steps: [number, number][] = [];
    s.onStep = (step, time) => steps.push([step, time]);
    s.start(120, 0);
    s.stop();
    for (let t = 0; t <= 1; t += 0.02) {
      clock.currentTime = t;
      s.pump();
    }
    const stepSeconds = 60 / 120 / 4;
    steps.forEach(([step, time], i) => {
      expect(step).toBe(i);
      expect(time).toBeCloseTo(i * stepSeconds, 9);
    });
    expect(steps.at(-1)![1]).toBeLessThan(1 + 0.1);
    expect(steps.at(-1)![1]).toBeGreaterThan(1 + 0.1 - stepSeconds);
  });

  it('skips ahead after a stall instead of bursting late notes', () => {
    const clock = { currentTime: 0 };
    const s = new LookaheadScheduler(clock, { lookahead: 0.1 });
    const times: number[] = [];
    s.onStep = (_step, time) => times.push(time);
    s.start(120, 0);
    s.stop();
    clock.currentTime = 5;
    const before = times.length;
    s.pump();
    const late = times.slice(before).filter((t) => t < 5);
    expect(late).toEqual([]);
  });

  it('applies tempo changes to following steps', () => {
    const clock = { currentTime: 0 };
    const s = new LookaheadScheduler(clock, { lookahead: 0.5 });
    const times: number[] = [];
    s.onStep = (_step, time) => times.push(time);
    s.start(120, 0);
    s.stop();
    s.setTempo(60);
    clock.currentTime = 1;
    s.pump();
    const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
    expect(gaps.at(-1)).toBeCloseTo(0.25, 9);
  });
});
