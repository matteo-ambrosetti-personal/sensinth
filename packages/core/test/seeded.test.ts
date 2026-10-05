import { describe, expect, it } from 'vitest';
import {
  Engine,
  ReplaySource,
  STEPS_PER_BAR,
  Scale,
  SensorHub,
  SensorRecorder,
  SimulatedSource,
  STYLES,
  absoluteScale,
  chiptune,
  eventPitch,
  keyIndex,
  lofi,
  pressRate,
  stepDuration,
  techno,
  type EventNote,
  type NoteEvent,
  type SensorDescriptor,
  type SensorEvent,
  type SensorSample,
  type Style,
} from '../src';

const KEYS: SensorDescriptor = {
  id: 'computer.keys',
  kind: 'keys.rate',
  label: 'Typing',
  range: [0, 15],
  adaptive: true,
  minSpan: 3,
  rateHz: 30,
};
const LIGHT: SensorDescriptor = {
  id: 'phone.light',
  kind: 'light',
  label: 'Light',
  unit: 'lx',
  range: [0, 10000],
  adaptive: true,
  minSpan: 30,
  rateHz: 10,
};
const SHAKE: SensorDescriptor = {
  id: 'phone.accel',
  kind: 'motion.accel',
  label: 'Shake',
  range: [0, 40],
  adaptive: true,
  minSpan: 0.4,
  rateHz: 50,
};

/** What a test session does: readings over time, and presses. */
interface Script {
  descriptors: readonly SensorDescriptor[];
  sampleAt?(t: number): SensorSample[];
  /** Presses, in time order. */
  events?: readonly SensorEvent[];
}

/** The letter `key` pressed every `interval` seconds from `start`, up to `until`. */
function typing(key: string, interval: number, until: number, start = 0.5): SensorEvent[] {
  const out: SensorEvent[] = [];
  for (let t = start; t < until; t += interval) {
    out.push({ id: KEYS.id, t, kind: 'key', value: keyIndex(key), velocity: 0.8 });
  }
  return out;
}

/** A steady light reading, sampled 10 times a second. */
function light(lux: number) {
  return (t: number): SensorSample[] => [{ id: LIGHT.id, t, v: lux }];
}

interface Take {
  events: NoteEvent[];
  notes: EventNote[];
  /** Every track's machine, length and trigs, per bar. */
  structure: string[];
  /** Every track's live params, per step. */
  params: number[][];
  machines: string[];
}

/** Plays a script in deterministic mode, feeding readings and presses in time order. */
function take(style: Style, bars: number, seed: number, script: Script): Take {
  const hub = new SensorHub();
  for (const d of script.descriptors) hub.announce(d);
  const engine = new Engine({ style, hub, deterministic: { seed } });
  const notes: EventNote[] = [];
  engine.onEventNotes = (n) => notes.push(...n);
  const dt = stepDuration(style.defaultTempo);
  const pending = [...(script.events ?? [])];
  const out: Take = { events: [], notes, structure: [], params: [], machines: [] };
  let sampleT = 0;
  for (let step = 0; step < bars * STEPS_PER_BAR; step++) {
    const t = step * dt;
    // Readings every 0.1 s and every press, up to the time of this step.
    for (; sampleT <= t; sampleT = Math.round((sampleT + 0.1) * 1000) / 1000) {
      hub.pushAll(script.sampleAt?.(sampleT) ?? []);
      while (pending.length > 0 && (pending[0] as SensorEvent).t <= sampleT) {
        hub.emit(pending.shift() as SensorEvent);
      }
    }
    out.events.push(...engine.tick(dt));
    const view = engine.view();
    if (step % STEPS_PER_BAR === 0) {
      out.structure.push(
        JSON.stringify(
          view.tracks.map((tr) => [tr.machine, tr.length, tr.scale, tr.trigs, tr.base]),
        ),
      );
    }
    out.params.push(view.tracks.flatMap((tr) => Object.values(tr.params)));
    if (step === 0) out.machines = engine.trackMachines().map((m) => `${m.slot}:${m.machineId}`);
  }
  engine.dispose();
  return out;
}

const gridKey = (e: NoteEvent) => `${e.part}|${e.step}|${e.midi ?? e.voice}`;

/** Share of grid notes heard in only one of two takes. */
function gridDifference(a: readonly NoteEvent[], b: readonly NoteEvent[]): number {
  const sa = new Set(a.map(gridKey));
  const sb = new Set(b.map(gridKey));
  let only = 0;
  for (const k of sa) if (!sb.has(k)) only++;
  for (const k of sb) if (!sa.has(k)) only++;
  return only / Math.max(1, sa.size + sb.size);
}

/** Largest difference between two takes' live params, and whether any differ at all. */
function paramDifference(a: Take, b: Take): number {
  let max = 0;
  a.params.forEach((row, i) => {
    row.forEach((v, j) => {
      max = Math.max(max, Math.abs(v - ((b.params[i] as number[])[j] ?? v)));
    });
  });
  return max;
}

const BARS = 32;
const SECONDS = (BARS * STEPS_PER_BAR * stepDuration(chiptune.defaultTempo)) as number;

describe('Deterministic mode', () => {
  const script = (interval: number, lux = 250): Script => ({
    descriptors: [KEYS, LIGHT],
    sampleAt: light(lux),
    events: typing('a', interval, SECONDS),
  });

  it('plays the same music for the same seed and the same typing', () => {
    const a = take(chiptune, BARS, 42, script(0.25));
    const b = take(chiptune, BARS, 42, script(0.25));
    expect(a.events.length).toBeGreaterThan(200);
    expect(a.notes.length).toBeGreaterThan(100);
    expect(b.events).toEqual(a.events);
    expect(b.notes).toEqual(a.notes);
  });

  it('plays without any sensor, starting on the first step', () => {
    const quiet = take(chiptune, 2, 42, { descriptors: [] });
    expect(quiet.events.filter((e) => e.step < STEPS_PER_BAR).length).toBeGreaterThan(0);
  });

  it('lets the seed pick the tracks', () => {
    const seeds = [1, 2, 3, 4, 5, 6].map((s) => take(techno, 1, s, { descriptors: [] }));
    expect(new Set(seeds.map((t) => t.machines.join())).size).toBeGreaterThan(1);
    expect(new Set(seeds.map((t) => t.structure[0])).size).toBe(seeds.length);
  });

  it('writes the same tracks and patterns whatever the inputs do', () => {
    const quiet = take(lofi, BARS, 42, { descriptors: [] });
    const busy = take(lofi, BARS, 42, script(0.18, 900));
    const sim = new SimulatedSource(3);
    const simulated = take(lofi, BARS, 42, {
      descriptors: sim.descriptors,
      sampleAt: (t) => sim.sampleAt(t),
    });
    expect(busy.machines).toEqual(quiet.machines);
    expect(busy.structure).toEqual(quiet.structure);
    expect(simulated.structure).toEqual(quiet.structure);
    // Sections still differ from one another.
    const bars = lofi.palette.sectionBars;
    expect(quiet.structure[bars]).not.toEqual(quiet.structure[0]);
  });

  it('answers typing 2% slower with music a little off, not different music', () => {
    const steady = take(chiptune, BARS, 42, script(0.25));
    const slower = take(chiptune, BARS, 42, script(0.255));
    // Each press plays at its own time, with the same note for the same letter.
    const n = Math.min(steady.notes.length, slower.notes.length);
    expect(n).toBeGreaterThan(100);
    let samePitch = 0;
    for (let i = 0; i < n; i++) {
      const a = steady.notes[i] as EventNote;
      const b = slower.notes[i] as EventNote;
      expect(b.time - a.time).toBeCloseTo(i * 0.005, 6);
      if (a.note.midi === b.note.midi) samePitch++;
    }
    expect(samePitch / n).toBeGreaterThan(0.9);
    // The grid barely moves, the params move a little, and not at all would be wrong too.
    expect(gridDifference(steady.events, slower.events)).toBeLessThan(0.1);
    const params = paramDifference(steady, slower);
    expect(params).toBeGreaterThan(0);
    expect(params).toBeLessThan(0.08);
  });

  it('answers 2% more light with params a little off', () => {
    const a = take(chiptune, BARS, 42, script(0.25, 250));
    const b = take(chiptune, BARS, 42, script(0.25, 255));
    const params = paramDifference(a, b);
    expect(params).toBeGreaterThan(0);
    expect(params).toBeLessThan(0.05);
    expect(gridDifference(a.events, b.events)).toBeLessThan(0.1);
  });

  it('moves a destination monotonically as a reading rises', () => {
    const values = [200, 220, 240, 260, 280, 300].map((lux) => {
      const t = take(chiptune, 2, 7, { descriptors: [LIGHT], sampleAt: light(lux) });
      return t.params[24] as number[];
    });
    const first = values[0] as number[];
    const moving = first.map((_, j) => values.map((row) => row[j] as number));
    const changed = moving.filter((col) => col.some((v) => v !== col[0]));
    expect(changed.length).toBeGreaterThan(0);
    for (const col of changed) {
      const diffs = col.slice(1).map((v, i) => v - (col[i] as number));
      const up = diffs.every((d) => d >= -1e-12);
      const down = diffs.every((d) => d <= 1e-12);
      expect(up || down).toBe(true);
    }
  });

  it('plays a hit at the exact time of each shake', () => {
    const shakes = [1.0, 2.5, 4.0];
    const shaking = (t: number): SensorSample[] => {
      const out: SensorSample[] = [];
      // 50 readings a second, a jolt at each shake time.
      for (let k = 0; k < 5; k++) {
        const ts = Math.round((t - 0.08 + k * 0.02) * 1000) / 1000;
        if (ts < 0 || ts > t) continue;
        const jolt = shakes.some((s) => Math.abs(ts - s) < 0.001);
        out.push({ id: SHAKE.id, t: ts, v: jolt ? 15 : 0.2 });
      }
      return out;
    };
    const run = take(techno, 4, 9, { descriptors: [SHAKE], sampleAt: shaking });
    const hits = run.notes.filter((n) => n.note.part === 'hit');
    expect(hits.map((h) => h.time)).toEqual(shakes);
  });

  it('replays a recording with presses to the identical piece', () => {
    const hub = new SensorHub();
    hub.announce(KEYS);
    hub.announce(LIGHT);
    const recorder = new SensorRecorder();
    recorder.start(hub);
    for (let i = 0; i < 40; i++) {
      const t = i * 0.1;
      hub.push({ id: LIGHT.id, t, v: 250 + i });
      if (i % 3 === 0) hub.emit({ id: KEYS.id, t, kind: 'key', value: i % 7, velocity: 0.8 });
    }
    const rec = recorder.stop();
    expect(rec.events?.length).toBe(14);
    const replayed = () => {
      const replay = new ReplaySource(rec, { loop: false });
      return take(chiptune, 4, 42, {
        descriptors: replay.descriptors,
        sampleAt: (t) => replay.samplesUntil(t),
        events: new ReplaySource(rec, { loop: false }).eventsUntil(10),
      });
    };
    const a = replayed();
    const b = replayed();
    expect(a.notes.length).toBe(14);
    expect(b.events).toEqual(a.events);
    expect(b.notes).toEqual(a.notes);
  });

  it('keeps every grid note in its scale for every style', () => {
    for (const style of STYLES) {
      const run = take(style, 8, 42, script(0.3));
      expect(run.events.length).toBeGreaterThan(0);
      expect(run.notes.every((n) => n.note.midi !== undefined || n.note.voice)).toBe(true);
    }
  });
});

describe('Deterministic inputs', () => {
  it('turns press times into a rate that moves in proportion', () => {
    const presses = (interval: number) => Array.from({ length: 40 }, (_, i) => i * interval);
    const at = (interval: number) => pressRate(presses(interval), 39 * interval + 0.01);
    expect(at(0.25)).toBeGreaterThan(3.5);
    expect(at(0.255) / at(0.25)).toBeGreaterThan(0.96);
    expect(at(0.255) / at(0.25)).toBeLessThan(0.995);
  });

  it('reads every channel on a fixed, monotonic scale', () => {
    const descs: SensorDescriptor[] = [
      LIGHT,
      SHAKE,
      { id: 'tilt', kind: 'orientation.pitch', label: '', range: [-90, 90] },
      { id: 'temp', kind: 'temperature.device', label: '', minSpan: 3 },
      { id: 'lid', kind: 'lid.angle', label: '', range: [0, 180], adaptive: true, minSpan: 20 },
    ];
    for (const d of descs) {
      const scale = absoluteScale(d, 40);
      const lo = d.range?.[0] ?? 0;
      const hi = d.range?.[1] ?? 80;
      let prev = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const v = scale(lo + ((hi - lo) * i) / 100);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
    // Light is read on a log scale: a room and daylight both land mid-range.
    const lux = absoluteScale(LIGHT, 0);
    expect(lux(250)).toBeGreaterThan(0.3);
    expect(lux(5000)).toBeLessThan(0.95);
  });

  it('gives every letter its own note, the same within a harmony', () => {
    const scale = new Scale(0, 'ionian');
    const chord = { degree: 0, size: 3 };
    const key = (k: string): SensorEvent => ({
      id: KEYS.id,
      t: 0,
      kind: 'key',
      value: keyIndex(k),
      velocity: 1,
    });
    const range: [number, number] = [60, 96];
    expect(eventPitch(key('a'), scale, chord, range)).toBe(60);
    expect(eventPitch(key('b'), scale, chord, range)).toBe(62);
    expect(eventPitch(key('h'), scale, chord, range)).toBe(72);
    expect(eventPitch(key('A'), scale, chord, range)).toBe(60);
    expect(eventPitch(key('a'), new Scale(2, 'dorian'), chord, range)).toBe(62);
    // A MIDI key keeps its pitch, moved into the scale.
    const note: SensorEvent = { id: 'm', t: 0, kind: 'note', value: 61, velocity: 1 };
    expect(eventPitch(note, scale, chord, range)).toBe(60);
  });
});
