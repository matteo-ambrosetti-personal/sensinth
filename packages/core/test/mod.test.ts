import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Fingerprinter,
  LFO_SHAPES,
  Lfo,
  LogisticMap,
  ModMatrix,
  Rng,
  SENSOR_ROUTE_MIN,
  SensorHub,
  SimulatedSource,
  applyCurve,
  buildRoutes,
  chiptune,
  generateTrack,
  lfoDest,
  lfoSource,
  parseSensorSource,
  sourceKind,
  trackDest,
  type MatrixSpec,
} from '../src';

describe('Lfo', () => {
  it('stays within its depth for every shape', () => {
    for (const shape of LFO_SHAPES) {
      const lfo = new Lfo({ shape, periodSteps: 16, depth: 0.6, phase: 0.1, seed: 3 });
      for (let i = 0; i < 200; i++) {
        const v = lfo.advance();
        expect(Math.abs(v)).toBeLessThanOrEqual(0.6 + 1e-9);
      }
    }
  });

  it('completes one cycle per period, and modulated rate changes the period', () => {
    const count = (rate: number) => {
      const lfo = new Lfo({ shape: 'square', periodSteps: 16, depth: 1, phase: 0, seed: 1 });
      let flips = 0;
      let last = lfo.value;
      for (let i = 0; i < 160; i++) {
        const v = lfo.advance(rate);
        if (v !== last) flips++;
        last = v;
      }
      return flips;
    };
    expect(count(0.5)).toBe(20); // 10 cycles, 2 flips each
    expect(count(0.75)).toBeGreaterThan(30); // one octave faster
    expect(count(0.25)).toBeLessThan(12);
  });
});

describe('LogisticMap', () => {
  it('stays inside (0, 1) whatever the rate, even with garbage', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: false }),
        fc.array(fc.double({ noNaN: false }), { minLength: 1, maxLength: 200 }),
        (start, rates) => {
          const map = new LogisticMap(start);
          for (const r of rates) {
            const x = map.step(r);
            expect(x).toBeGreaterThan(0);
            expect(x).toBeLessThan(1);
          }
        },
      ),
    );
  });

  it('turns a tiny difference in the start into a different trajectory', () => {
    const a = new LogisticMap(0.3);
    const b = new LogisticMap(0.3 + 1e-10);
    let apart = 0;
    for (let i = 0; i < 80; i++) apart = Math.abs(a.step(1) - b.step(1));
    expect(apart).toBeGreaterThan(0.01);
  });
});

describe('ModMatrix', () => {
  const spec = (): MatrixSpec => ({
    routes: [
      { source: 's:x:level', dest: trackDest('t1', 'cutoff'), amount: 0.8, curve: 'lin' },
      { source: lfoSource('t1'), dest: lfoDest('t2', 'rate'), amount: 0.9, curve: 'lin' },
      { source: lfoSource('t2'), dest: lfoDest('t1', 'depth'), amount: -0.9, curve: 'exp' },
      { source: 'env:t1', dest: trackDest('t2', 'level'), amount: -0.5, curve: 'lin' },
      { source: 'chaos:a', dest: 'chaos:b.r', amount: 1, curve: 'fold' },
      { source: 'chaos:b', dest: 'chaos:a.r', amount: -1, curve: 'step' },
    ],
    lfos: {
      t1: { shape: 'sine', periodSteps: 8, depth: 0.7, phase: 0, seed: 1 },
      t2: { shape: 'smooth', periodSteps: 24, depth: 0.5, phase: 0.5, seed: 2 },
    },
    chaos: { a: { start: 0.2, r: 0.8 }, b: { start: 0.7, r: 0.5 } },
  });

  it('sums routes into destinations and scales them by amount', () => {
    const m = new ModMatrix(spec());
    m.setSource('s:x:level', 0.5);
    expect(m.evaluate().get(trackDest('t1', 'cutoff'))).toBeCloseTo(0.4);
    m.clearExternal();
    expect(m.evaluate().get(trackDest('t1', 'cutoff'))).toBeUndefined();
  });

  it('keeps feedback loops finite and bounded under wild input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.double(), fc.constantFrom(NaN, Infinity, -Infinity)), {
          minLength: 1,
          maxLength: 300,
        }),
        (inputs) => {
          const m = new ModMatrix(spec());
          for (const x of inputs) {
            m.clearExternal();
            m.setSource('s:x:level', x);
            const offsets = m.evaluate();
            for (const v of offsets.values()) {
              expect(Number.isFinite(v)).toBe(true);
              expect(Math.abs(v)).toBeLessThanOrEqual(1);
            }
            m.advance(offsets, new Map([['t1', Math.abs(x) % 1 || 0]]));
            for (const id of [lfoSource('t1'), lfoSource('t2'), 'chaos:a', 'chaos:b', 'env:t1']) {
              const v = m.source(id) as number;
              expect(Number.isFinite(v)).toBe(true);
              expect(Math.abs(v)).toBeLessThanOrEqual(1);
            }
          }
        },
      ),
    );
  });

  it('reports each route with its live contribution', () => {
    const m = new ModMatrix(spec());
    m.setSource('s:x:level', -1);
    m.evaluate();
    const view = m.view();
    expect(view).toHaveLength(6);
    expect(view[0]?.value).toBeCloseTo(-0.8);
  });

  it('shapes values with curves', () => {
    expect(applyCurve(0.5, 'lin')).toBe(0.5);
    expect(applyCurve(-0.5, 'exp')).toBe(-0.25);
    expect(applyCurve(0.4, 'step')).toBeCloseTo(1 / 3);
    expect(applyCurve(1, 'fold')).toBeCloseTo(0);
    expect(applyCurve(0.5, 'fold')).toBeCloseTo(1);
  });
});

describe('Generated routes', () => {
  it('give every live sensor at least two strong routes', () => {
    const hub = new SensorHub();
    const sim = new SimulatedSource(5);
    for (const d of sim.descriptors) hub.announce(d);
    for (let t = 0; t < 4; t += 0.05) hub.pushAll(sim.sampleAt(t));
    const fp = new Fingerprinter().take(hub.list());
    const rng = new Rng(9);
    const tracks = ['kick', 'snare', 'triBass', 'lead', 'arp'].map((id, i) =>
      generateTrack(rng, {
        slot: `t${i + 1}`,
        machineId: id,
        machine: chiptune.palette.machines[id]!,
        palette: chiptune.palette,
        density: 0.5,
      }),
    );
    const routes = buildRoutes(rng, fp, tracks);
    for (const ch of fp.channels) {
      const strong = routes.filter(
        (r) =>
          sourceKind(r.source) === 'sensor' &&
          parseSensorSource(r.source).channelId === ch.id &&
          Math.abs(r.amount) >= SENSOR_ROUTE_MIN,
      );
      expect(strong.length, ch.id).toBeGreaterThanOrEqual(2);
      // One structural, one timbral: two different destinations.
      expect(new Set(strong.map((r) => r.dest)).size).toBeGreaterThanOrEqual(2);
    }
    // Internal routes, including an LFO feedback loop.
    expect(routes.some((r) => r.source.startsWith('lfo:') && r.dest.startsWith('lfo:'))).toBe(true);
    expect(routes.some((r) => r.source.startsWith('chaos:'))).toBe(true);
    expect(routes.some((r) => r.source.startsWith('env:'))).toBe(true);
  });
});
