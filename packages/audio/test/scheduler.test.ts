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
    const steps: number[] = [];
    const skips: number[] = [];
    s.onStep = (step, time, _dt, skipped) => {
      times.push(time);
      steps.push(step);
      skips.push(skipped);
    };
    s.start(120, 0);
    s.stop();
    clock.currentTime = 5;
    const before = times.length;
    s.pump();
    clock.currentTime = 5.1;
    s.pump();
    const late = times.slice(before).filter((t) => t < 5);
    expect(late).toEqual([]);
    // The step count jumps with the clock, and the first step after says by how much.
    const stepSeconds = 60 / 120 / 4;
    const first = steps[before] as number;
    expect(times[before]).toBeCloseTo(first * stepSeconds, 9);
    expect(first - (steps[before - 1] as number) - 1).toBe(skips[before]);
    expect(skips.slice(before + 1).every((n) => n === 0)).toBe(true);
  });

  it('applies tempo changes to following steps', () => {
    const clock = { currentTime: 0 };
    const s = new LookaheadScheduler(clock, { lookahead: 0.5 });
    const times: number[] = [];
    s.onStep = (_step, time) => times.push(time);
    s.start(120, 0);
    s.stop();
    s.setTempo(60);
    clock.currentTime = 0.6;
    s.pump();
    const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
    expect(gaps.at(-1)).toBeCloseTo(0.25, 9);
  });
});
