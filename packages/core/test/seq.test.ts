import { describe, expect, it } from 'vitest';
import {
  Rng,
  STYLES,
  TrackRunner,
  conditionLabel,
  effectiveProbability,
  effectiveRetrig,
  evaluateCondition,
  generateTrack,
  neutralParams,
  type TrackSpec,
  type Trig,
  type TrigCondition,
} from '../src';

const state = { loop: 0, fill: false, pre: false, nei: false };

function trig(extra: Partial<Trig> = {}): Trig {
  return { vel: 0.8, len: 1, prob: 1, cond: { kind: 'always' }, micro: 0, ...extra };
}

function spec(length: number, scale: number, trigs: (Trig | undefined)[]): TrackSpec {
  return {
    slot: 't1',
    role: 'drum',
    machine: 'kick',
    length,
    scale,
    trigs,
    base: neutralParams(),
    range: [36, 60],
    lfo: { shape: 'sine', periodSteps: 16, depth: 0.5, phase: 0, seed: 1 },
    voice: 'kick',
  };
}

/** Which 16th steps a track plays on, over `steps` steps. */
function playedSteps(s: TrackSpec, steps: number, fill = false): number[] {
  const r = new TrackRunner(s, new Rng(1));
  const out: number[] = [];
  for (let g = 0; g < steps; g++) {
    if (r.step(g, neutralParams(), { fill, nei: false }).length > 0) out.push(g);
  }
  return out;
}

describe('Trig conditions', () => {
  it('A:B plays on loop A of every B loops', () => {
    const c: TrigCondition = { kind: 'ratio', a: 2, b: 3 };
    const loops = [0, 1, 2, 3, 4, 5, 6].filter((loop) => evaluateCondition(c, { ...state, loop }));
    expect(loops).toEqual([1, 4]);
  });

  it('fill, pre, nei and first follow their flags, and ! inverts them', () => {
    const cases: [TrigCondition, Partial<typeof state>, boolean][] = [
      [{ kind: 'fill', not: false }, { fill: true }, true],
      [{ kind: 'fill', not: false }, { fill: false }, false],
      [{ kind: 'fill', not: true }, { fill: false }, true],
      [{ kind: 'pre', not: false }, { pre: true }, true],
      [{ kind: 'pre', not: true }, { pre: true }, false],
      [{ kind: 'nei', not: false }, { nei: true }, true],
      [{ kind: 'nei', not: true }, { nei: false }, true],
      [{ kind: 'first', not: false }, { loop: 0 }, true],
      [{ kind: 'first', not: false }, { loop: 1 }, false],
      [{ kind: 'first', not: true }, { loop: 2 }, true],
    ];
    for (const [cond, s, expected] of cases) {
      expect(evaluateCondition(cond, { ...state, ...s }), conditionLabel(cond)).toBe(expected);
    }
  });

  it('labels conditions like an Elektron box', () => {
    expect(conditionLabel({ kind: 'ratio', a: 1, b: 2 })).toBe('1:2');
    expect(conditionLabel({ kind: 'pre', not: true })).toBe('!pre');
    expect(conditionLabel({ kind: 'always' })).toBe('');
  });

  it('plays fill trigs only during fills', () => {
    const s = spec(4, 1, [
      trig(),
      undefined,
      trig({ cond: { kind: 'fill', not: false } }),
      undefined,
    ]);
    expect(playedSteps(s, 8)).toEqual([0, 4]);
    expect(playedSteps(s, 8, true)).toEqual([0, 2, 4, 6]);
  });

  it('pre follows the previous conditional trig on the track', () => {
    const s = spec(4, 1, [
      trig({ cond: { kind: 'ratio', a: 1, b: 2 } }),
      trig({ cond: { kind: 'pre', not: false } }),
      trig({ cond: { kind: 'pre', not: true } }),
      undefined,
    ]);
    // Loop 0: 1:2 plays, so pre plays and !pre is skipped… then !pre's own
    // result (false) becomes the previous one.
    expect(playedSteps(s, 8)).toEqual([0, 1, 6]);
  });
});

describe('TrackRunner', () => {
  it('loops on its own length (polymeter)', () => {
    const s = spec(7, 1, [
      trig(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(playedSteps(s, 22)).toEqual([0, 7, 14, 21]);
  });

  it('runs at double and half speed', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => (i === 0 ? trig() : undefined));
    expect(playedSteps(spec(12, 2, twelve), 24)).toEqual([0, 6, 12, 18]);
    expect(playedSteps(spec(12, 0.5, twelve), 50)).toEqual([0, 24, 48]);
  });

  it('places in-between steps of odd speeds with micro offsets', () => {
    const all = Array.from({ length: 4 }, () => trig());
    const r = new TrackRunner(spec(4, 0.75, all), new Rng(1));
    const fired = [];
    for (let g = 0; g < 8; g++)
      fired.push(...r.step(g, neutralParams(), { fill: false, nei: false }));
    expect(fired).toHaveLength(6);
    for (const f of fired) {
      expect(f.micro).toBeGreaterThanOrEqual(-0.45);
      expect(f.micro).toBeLessThan(1);
    }
    // Track step 1 sounds a third of a step after 16th step 1.
    expect(fired[1]?.micro).toBeCloseTo(1 / 0.75 - 1);
  });

  it('keeps micro timing and retrigs bounded', () => {
    const rng = new Rng(4);
    for (let i = 0; i < 200; i++) {
      const r = effectiveRetrig(
        rng.chance(0.5) ? { count: rng.int(2, 4), rate: 0.5, curve: 0 } : undefined,
        rng.next(),
        rng.next(),
      );
      if (r) {
        expect(r.count).toBeGreaterThanOrEqual(2);
        expect(r.count).toBeLessThanOrEqual(8);
      }
    }
    const extreme = { ...neutralParams(), micro: 1 };
    const runner = new TrackRunner(spec(1, 1, [trig({ micro: 0.45 })]), new Rng(1));
    for (let g = 0; g < 4; g++) {
      for (const f of runner.step(g, extreme, { fill: false, nei: false })) {
        expect(f.micro).toBeLessThanOrEqual(1.45);
      }
    }
  });

  it('scales trig probability with the prob param but never silences a sure trig', () => {
    expect(effectiveProbability(1, 0.5)).toBe(1);
    expect(effectiveProbability(1, 0)).toBe(0.25);
    expect(effectiveProbability(0.5, 1)).toBe(0.875);
  });
});

describe('Generated tracks', () => {
  it('fit their length and keep trig values in range for every machine', () => {
    const rng = new Rng(11);
    for (const style of STYLES) {
      for (const [id, machine] of Object.entries(style.palette.machines)) {
        for (let i = 0; i < 5; i++) {
          const t = generateTrack(rng, {
            slot: 't1',
            machineId: id,
            machine,
            palette: style.palette,
            density: rng.next(),
          });
          expect(t.trigs.length, id).toBe(t.length);
          expect(
            t.trigs.some((x) => x),
            id,
          ).toBe(true);
          for (const x of t.trigs) {
            if (!x) continue;
            expect(x.vel).toBeGreaterThan(0);
            expect(x.vel).toBeLessThanOrEqual(1);
            expect(x.prob).toBeGreaterThan(0);
            expect(x.prob).toBeLessThanOrEqual(1);
            expect(Math.abs(x.micro)).toBeLessThanOrEqual(0.45);
            expect(x.len).toBeGreaterThan(0);
          }
          for (const v of Object.values(t.base)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});
