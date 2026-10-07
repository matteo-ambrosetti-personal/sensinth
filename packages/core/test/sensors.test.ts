import { describe, expect, it } from 'vitest';
import {
  Engine,
  FrameAnalyzer,
  ReplaySource,
  SensorHub,
  SensorRecorder,
  SimulatedSource,
  chiptune,
  daylight,
  parseRecording,
  placeKey,
  rmsDb,
  spectralCentroid,
  stepDuration,
} from '../src';

function solid(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...rgb, 255], i * 4);
  return px;
}

describe('FrameAnalyzer', () => {
  it('measures brightness and dominant hue', () => {
    const fa = new FrameAnalyzer();
    expect(fa.analyze(solid(8, 6, [0, 0, 0]), 8, 6).luma).toBe(0);
    expect(fa.analyze(solid(8, 6, [255, 255, 255]), 8, 6).luma).toBeCloseTo(1);
    expect(fa.analyze(solid(8, 6, [255, 0, 0]), 8, 6).hue).toBeCloseTo(0, 3);
    expect(fa.analyze(solid(8, 6, [0, 255, 0]), 8, 6).hue).toBeCloseTo(1 / 3, 3);
    expect(fa.analyze(solid(8, 6, [0, 0, 255]), 8, 6).hue).toBeCloseTo(2 / 3, 3);
  });

  it('sees movement but not a global exposure change', () => {
    const fa = new FrameAnalyzer();
    const a = solid(8, 6, [100, 100, 100]);
    fa.analyze(a, 8, 6);
    expect(fa.analyze(solid(8, 6, [160, 160, 160]), 8, 6).motion).toBeCloseTo(0, 5);
    const b = solid(8, 6, [160, 160, 160]);
    for (let i = 0; i < 24; i++) b.set([255, 255, 255, 255], i * 4);
    expect(fa.analyze(b, 8, 6).motion).toBeGreaterThan(0.05);
  });
});

describe('audio features', () => {
  it('computes RMS level in dBFS', () => {
    const sine = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((i / 48) * 2 * Math.PI));
    expect(rmsDb(sine)).toBeCloseTo(-3.01, 1);
    expect(rmsDb(new Float32Array(128))).toBe(-100);
  });

  it('finds the spectral centroid', () => {
    const bins = new Float32Array(1024).fill(-Infinity);
    bins[100] = -6;
    expect(spectralCentroid(bins, 48000)).toBeCloseTo(100 * (24000 / 1024), 3);
    expect(spectralCentroid(new Float32Array(1024).fill(-Infinity), 48000)).toBe(0);
  });
});

describe('virtual sensors', () => {
  it('maps the clock to daylight', () => {
    expect(daylight(new Date(2026, 5, 1, 12, 0))).toBeCloseTo(1);
    expect(daylight(new Date(2026, 5, 1, 0, 0))).toBeCloseTo(0);
    expect(daylight(new Date(2026, 5, 1, 6, 0))).toBeCloseTo(0.5);
  });

  it('gives each place a stable key', () => {
    const k = placeKey(45.4641, 9.1912);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThan(12);
    expect(placeKey(45.4643, 9.1914)).toBe(k);
    const keys = new Set<number>();
    for (let i = 0; i < 50; i++) keys.add(placeKey(45 + i * 0.01, 9));
    expect(keys.size).toBeGreaterThan(6);
  });
});

describe('SensorHub', () => {
  it('notifies taps and honors the onset gate', () => {
    const hub = new SensorHub();
    const seen: string[] = [];
    const untap = hub.tap({
      announce: (d) => seen.push(`a:${d.id}`),
      push: (s) => seen.push(`p:${s.id}`),
    });
    hub.announce({ id: 'mic', kind: 'sound.level', label: 'mic', minSpan: 6 });
    hub.onsetGate = () => false;
    for (let i = 0; i < 60; i++) hub.push({ id: 'mic', t: i / 30, v: -50 });
    hub.push({ id: 'mic', t: 2.1, v: -10 });
    expect(hub.consumeOnsets()).toEqual([]);
    hub.onsetGate = undefined;
    for (let i = 0; i < 60; i++) hub.push({ id: 'mic', t: 3 + i / 30, v: -50 });
    hub.push({ id: 'mic', t: 5.1, v: -10 });
    expect(hub.consumeOnsets()).toHaveLength(1);
    untap();
    hub.push({ id: 'mic', t: 6, v: -50 });
    expect(seen[0]).toBe('a:mic');
    expect(seen.filter((s) => s.startsWith('p:'))).toHaveLength(122);
  });

  it('gives slow channels longer before marking them stale', () => {
    const hub = new SensorHub();
    hub.announce({ id: 'fast', kind: 'x', label: 'x', rateHz: 30 });
    hub.announce({ id: 'slow', kind: 'battery', label: 'b', rateHz: 0.1 });
    hub.push({ id: 'fast', t: 0, v: 1 });
    hub.push({ id: 'slow', t: 0, v: 1 });
    hub.markStale(10);
    expect(hub.get('fast')?.stale).toBe(true);
    expect(hub.get('slow')?.stale).toBe(false);
    hub.markStale(31);
    expect(hub.get('slow')?.stale).toBe(true);
  });
});

describe('recording and replay', () => {
  function record(seconds: number) {
    const hub = new SensorHub();
    const sim = new SimulatedSource(9);
    const rec = new SensorRecorder();
    rec.start(hub, new Date('2026-10-05T10:00:00Z'));
    for (const d of sim.descriptors) hub.announce(d);
    for (let t = 100; t < 100 + seconds; t += 1 / 30) hub.pushAll(sim.sampleAt(t));
    return rec.stop();
  }

  it('round-trips through JSON', () => {
    const rec = record(3);
    expect(rec.descriptors).toHaveLength(10);
    expect(rec.samples.length).toBeGreaterThan(800);
    expect(rec.samples[0]?.[0]).toBe(0);
    const back = parseRecording(JSON.parse(JSON.stringify(rec)));
    expect(back).toEqual(rec);
  });

  it('rejects files that are not recordings', () => {
    expect(() => parseRecording({ hello: 1 })).toThrow(/Not a Sensinth/);
    expect(() =>
      parseRecording({
        format: 'sensinth-recording',
        version: 1,
        descriptors: [],
        samples: [[0, 3, 1]],
      }),
    ).toThrow(/malformed/);
  });

  it('replays samples in order, prefixed, and loops', () => {
    const rec = record(2);
    const replay = new ReplaySource(rec);
    expect(replay.descriptors.every((d) => d.id.startsWith('replay:'))).toBe(true);
    const first = replay.samplesUntil(1, 50);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((s) => s.t <= 51)).toBe(true);
    const rest = replay.samplesUntil(replay.duration, 50);
    expect(first.length + rest.length).toBe(rec.samples.length);
    const looped = replay.samplesUntil(replay.duration + 1, 50);
    expect(looped.length).toBeGreaterThan(0);
    const all = [...first, ...rest, ...looped].map((s) => s.t);
    expect(all).toEqual([...all].sort((a, b) => a - b));
  });

  it('drives the engine identically on every replay', () => {
    const rec = record(6);
    const play = () => {
      const engine = new Engine({ style: chiptune, seed: 5 });
      const replay = new ReplaySource(rec, { loop: false });
      for (const d of replay.descriptors) engine.hub.announce(d);
      const dt = stepDuration(120);
      const notes: string[] = [];
      for (let step = 0; step < 6 / dt; step++) {
        engine.hub.pushAll(replay.samplesUntil(step * dt));
        for (const ev of engine.tick(dt))
          notes.push(`${ev.step}:${ev.part}:${ev.midi ?? ev.voice}`);
      }
      return { notes, energy: engine.router.macros.energy };
    };
    const a = play();
    expect(a.notes.length).toBeGreaterThan(40);
    expect(play()).toEqual(a);
  });
});
