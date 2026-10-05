import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Engine,
  FX_IDS,
  FX_INFO,
  STEPS_PER_BAR,
  SimulatedSource,
  STYLES,
  ambient,
  blues,
  chiptune,
  free,
  jazz,
  isChordTone,
  stepDuration,
  techno,
  type FxId,
  type NoteEvent,
  type SensorDescriptor,
  type SensorSample,
  type Style,
} from '../src';

interface Played {
  ev: NoteEvent;
  inScale: boolean;
  /** A blue note where the rules allow one: a lead that may bend, a weak step, ♭3 or ♭5 of the key. */
  blueOk: boolean;
  chordTone: boolean;
  range: [number, number] | undefined;
}

interface SensorScript {
  descriptors: readonly SensorDescriptor[];
  sampleAt(t: number): SensorSample[];
}

/** Simulated sensors, optionally with one channel's readings scaled. */
function sim(seed = 3, tweak?: { id: string; factor: number }): SensorScript {
  const s = new SimulatedSource(seed);
  return {
    descriptors: s.descriptors,
    sampleAt: (t) =>
      s.sampleAt(t).map((x) => (tweak && x.id === tweak.id ? { ...x, v: x.v * tweak.factor } : x)),
  };
}

/** Every simulated channel held at one value. */
function frozen(): SensorScript {
  const s = new SimulatedSource(3);
  const values = s.sampleAt(0);
  return { descriptors: s.descriptors, sampleAt: (t) => values.map((x) => ({ ...x, t })) };
}

/** Runs the engine and records each note with its harmonic context. */
function run(style: Style, bars: number, sensors: SensorScript = sim(), seed = 0): Played[] {
  const engine = new Engine({ style, seed });
  for (const d of sensors.descriptors) engine.hub.announce(d);
  const dt = stepDuration(style.defaultTempo);
  const out: Played[] = [];
  for (let step = 0; step < bars * STEPS_PER_BAR; step++) {
    engine.hub.pushAll(sensors.sampleAt(step * dt));
    const events = engine.tick(dt);
    const machines = new Map(engine.trackMachines().map((m) => [m.slot, m.machine]));
    for (const ev of events) {
      const scale = engine.scale;
      const chord = engine.chord;
      const machine = machines.get(ev.part);
      const rel = ev.midi === undefined ? -1 : (((ev.midi - (engine.key ?? 0)) % 12) + 12) % 12;
      out.push({
        ev,
        inScale: ev.midi === undefined || (scale?.contains(ev.midi) ?? false),
        blueOk:
          !!machine?.blueNotes &&
          ev.role === 'lead' &&
          ev.step % 2 === 1 &&
          (rel === 3 || rel === 6),
        chordTone:
          ev.midi === undefined || (scale && chord ? isChordTone(scale, chord, ev.midi) : false),
        range: machine?.range,
      });
    }
  }
  return out;
}

/** What a listener hears in one bar: which track plays which note, when. */
function barSignatures(played: readonly Played[], bars: number, from = 0): Set<string>[] {
  const out = Array.from({ length: bars }, () => new Set<string>());
  for (const { ev } of played) {
    const bar = Math.floor(ev.step / STEPS_PER_BAR) - from;
    if (bar < 0 || bar >= bars) continue;
    (out[bar] as Set<string>).add(
      `${ev.part}:${ev.step % STEPS_PER_BAR}:${ev.midi ?? ev.voice}:${Math.round(ev.vel * 20)}`,
    );
  }
  return out;
}

function jaccardDistance(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return 1 - both / union.size;
}

/** Arbitrary sensor values, including garbage a broken sensor might send. */
const wildValue = fc.oneof(
  fc.double({ min: -1e6, max: 1e6, noNaN: true }),
  fc.constantFrom(NaN, Infinity, -Infinity, 0, 1e12),
);

const MELODIC = ['lead', 'arp', 'chords', 'pad'];

describe('Engine', () => {
  for (const style of STYLES) {
    describe(style.name, () => {
      const played = run(style, 64);

      it('plays several tracks', () => {
        const parts = new Set(played.filter((p) => p.ev.role !== 'fx').map((p) => p.ev.part));
        expect(parts.size).toBeGreaterThanOrEqual(Math.min(4, style.palette.trackCount[0]));
        expect(played.length).toBeGreaterThan(100);
      });

      it('keeps every pitched note in the current scale (blue notes aside)', () => {
        expect(played.filter((p) => !p.inScale && !p.blueOk)).toEqual([]);
      });

      it('lands melodic notes on chord tones on strong beats', () => {
        const strong = played.filter(
          (p) => p.ev.midi !== undefined && p.ev.step % 4 === 0 && MELODIC.includes(p.ev.role),
        );
        expect(strong.length).toBeGreaterThan(0);
        expect(strong.filter((p) => !p.chordTone)).toEqual([]);
      });

      it('plays a chord tone on the bass downbeat', () => {
        const downbeats = played.filter(
          (p) => p.ev.role === 'bass' && p.ev.step % STEPS_PER_BAR === 0,
        );
        expect(downbeats.filter((p) => !p.chordTone)).toEqual([]);
      });

      it('emits well-formed events inside each track range', () => {
        for (const { ev, range } of played) {
          expect(Number.isInteger(ev.step)).toBe(true);
          expect(ev.durSteps).toBeGreaterThan(0);
          expect(ev.vel).toBeGreaterThan(0);
          expect(ev.vel).toBeLessThanOrEqual(1);
          if (ev.role === 'fx') {
            expect(ev.fx).toBeDefined();
            expect(ev.midi).toBeUndefined();
          } else if (ev.midi !== undefined) {
            expect(Number.isInteger(ev.midi)).toBe(true);
            expect(range).toBeDefined();
            expect(ev.midi).toBeGreaterThanOrEqual((range as [number, number])[0]);
            expect(ev.midi).toBeLessThanOrEqual((range as [number, number])[1]);
          } else {
            expect(ev.voice).toBeTruthy();
          }
          for (const v of Object.values(ev.params ?? {})) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      });

      it('never repeats a phrase under frozen sensors', () => {
        const still = run(style, 128, frozen());
        const phraseSteps = style.palette.phraseBars * STEPS_PER_BAR;
        const phrases = new Map<number, string[]>();
        for (const { ev } of still) {
          const i = Math.floor(ev.step / phraseSteps);
          const list = phrases.get(i) ?? [];
          list.push(`${ev.part}:${ev.step % phraseSteps}:${ev.midi ?? ev.voice}`);
          phrases.set(i, list);
        }
        const keys = [...phrases.values()].map((l) => l.sort().join(','));
        expect(keys.length).toBeGreaterThan(20);
        expect(new Set(keys).size).toBe(keys.length);
      });
    });
  }

  it('is silent with no sensor at all', () => {
    const engine = new Engine({ style: chiptune });
    let events = 0;
    for (let i = 0; i < 8 * STEPS_PER_BAR; i++) events += engine.tick(0.1).length;
    expect(events).toBe(0);
    expect(engine.snapshot().waiting).toBe(true);
  });

  it('is silent while sensors are announced but send nothing', () => {
    const engine = new Engine({ style: chiptune });
    for (const d of new SimulatedSource(1).descriptors) engine.hub.announce(d);
    let events = 0;
    for (let i = 0; i < 8 * STEPS_PER_BAR; i++) events += engine.tick(0.1).length;
    expect(events).toBe(0);
  });

  it('stops when every sensor goes quiet and resumes on the next bar', () => {
    const engine = new Engine({ style: chiptune });
    const source = new SimulatedSource(2);
    for (const d of source.descriptors) engine.hub.announce(d);
    const dt = stepDuration(chiptune.defaultTempo);
    const perBar: number[] = [];
    for (let step = 0; step < 48 * STEPS_PER_BAR; step++) {
      const t = step * dt;
      const bar = Math.floor(step / STEPS_PER_BAR);
      // Sensors send for 16 bars, stop for 16, then come back.
      if (bar < 16 || bar >= 32) engine.hub.pushAll(source.sampleAt(t));
      engine.hub.markStale(t, 1);
      perBar[bar] = (perBar[bar] ?? 0) + engine.tick(dt).length;
    }
    expect(perBar.slice(0, 16).some((n) => n > 0)).toBe(true);
    // Stale after one second: silent from the bar after next on.
    expect(perBar.slice(18, 32).every((n) => n === 0)).toBe(true);
    expect(perBar.slice(33, 48).some((n) => n > 0)).toBe(true);
  });

  it('changes a lot when one sensor reads 2% differently', () => {
    const bars = 64;
    const a = barSignatures(run(chiptune, bars), bars);
    const b = barSignatures(
      run(chiptune, bars, sim(3, { id: 'sim.temperature', factor: 1.02 })),
      bars,
    );
    const distances = a.slice(4).map((s, i) => jaccardDistance(s, b[i + 4] as Set<string>));
    const differing = distances.filter((d) => d > 0).length / distances.length;
    const mean = distances.reduce((x, y) => x + y, 0) / distances.length;
    expect(differing).toBeGreaterThanOrEqual(0.6);
    expect(mean).toBeGreaterThanOrEqual(0.3);
  });

  it('is deterministic for the same sensors and seed', () => {
    const a = run(chiptune, 16).map((p) => p.ev);
    const b = run(chiptune, 16).map((p) => p.ev);
    const c = run(chiptune, 16, sim(), 8).map((p) => p.ev);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('matches the recorded output for fixed sensors', () => {
    const events = run(chiptune, 4).map(({ ev }) => [
      ev.step,
      ev.part,
      ev.midi ?? ev.voice ?? ev.fx,
      Math.round(ev.vel * 1000) / 1000,
    ]);
    expect(events).toMatchSnapshot();
  });

  it('stays musical with arbitrary, even broken, sensor values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.array(fc.array(wildValue, { minLength: 4, maxLength: 4 }), {
          minLength: 32,
          maxLength: 160,
        }),
        (seed, frames) => {
          const engine = new Engine({ style: chiptune, seed });
          const kinds = ['motion.accel', 'light', 'orientation.pitch', 'mystery.sensor'];
          kinds.forEach((kind, i) => engine.hub.announce({ id: `s${i}`, kind, label: kind }));
          const dt = stepDuration(chiptune.defaultTempo);
          frames.forEach((frame, step) => {
            frame.forEach((v, i) => engine.hub.push({ id: `s${i}`, t: step * dt, v }));
            const events = engine.tick(dt);
            for (const m of Object.values(engine.router.macros)) {
              expect(m).toBeGreaterThanOrEqual(0);
              expect(m).toBeLessThanOrEqual(1);
            }
            const notes = events.filter((e) => e.role !== 'fx');
            expect(notes.length).toBeLessThanOrEqual(chiptune.palette.maxEventsPerStep);
            expect(events.length - notes.length).toBeLessThanOrEqual(1);
            for (const ev of events) {
              expect(Number.isFinite(ev.vel)).toBe(true);
              expect(Number.isFinite(ev.micro ?? 0)).toBe(true);
              for (const v of Object.values(ev.params ?? {})) expect(Number.isFinite(v)).toBe(true);
              if (ev.midi !== undefined) expect(engine.scale?.contains(ev.midi)).toBe(true);
            }
          });
        },
      ),
      { numRuns: 60 },
    );
  });

  it('switches style on the next bar line', () => {
    const engine = new Engine({ style: chiptune });
    const source = new SimulatedSource(1);
    for (const d of source.descriptors) engine.hub.announce(d);
    const dt = stepDuration(120);
    const tick = (i: number) => {
      engine.hub.pushAll(source.sampleAt(i * dt));
      engine.tick(dt);
    };
    for (let i = 0; i < 5; i++) tick(i);
    engine.setStyle(ambient);
    for (let i = 5; i < STEPS_PER_BAR; i++) tick(i);
    expect(engine.currentStyle.id).toBe('chiptune');
    tick(STEPS_PER_BAR);
    expect(engine.currentStyle.id).toBe('ambient');
    expect(engine.trackMachines().every((m) => m.machineId in ambient.palette.machines)).toBe(true);
  });

  it('reports a readable snapshot and view', () => {
    const engine = new Engine({ style: chiptune, keyRoot: 9 });
    const source = new SimulatedSource(1);
    for (const d of source.descriptors) engine.hub.announce(d);
    engine.hub.pushAll(source.sampleAt(0));
    engine.tick(0.1);
    const snap = engine.snapshot();
    expect(snap.keyName).toMatch(/^A /);
    expect(snap.chordRoman).toMatch(/^(i|I)/);
    expect(snap.waiting).toBe(false);
    expect(snap.genome).toMatch(/^[0-9a-f]{6}$/);
    const view = engine.view();
    expect(view.tracks.length).toBeGreaterThanOrEqual(chiptune.palette.trackCount[0]);
    expect(view.keySource).toBe('place');
    for (const t of view.tracks) {
      expect(t.trigs.length).toBeGreaterThanOrEqual(t.length);
      expect(t.position).toBeGreaterThanOrEqual(0);
    }
    expect(view.routes.length).toBeGreaterThan(source.descriptors.length * 2);
  });
});

describe('Ambient drone', () => {
  it('holds the tonic and fifth of the current key', () => {
    const engine = new Engine({ style: ambient });
    const source = new SimulatedSource(4);
    for (const d of source.descriptors) engine.hub.announce(d);
    const dt = stepDuration(ambient.defaultTempo);
    let drones = 0;
    for (let step = 0; step < 64 * STEPS_PER_BAR; step++) {
      engine.hub.pushAll(source.sampleAt(step * dt));
      for (const ev of engine.tick(dt)) {
        if (ev.role !== 'drone') continue;
        drones++;
        const rel = ((((ev.midi as number) - (engine.scale?.root ?? 0)) % 12) + 12) % 12;
        expect([0, 7]).toContain(rel);
        expect(ev.durSteps).toBeGreaterThanOrEqual(STEPS_PER_BAR);
      }
    }
    expect(drones).toBeGreaterThanOrEqual(8);
  });
});

describe('Chord scales', () => {
  /** Chord names at every bar line, with frozen sensors so nothing rewrites the form. */
  function barChords(style: Style, bars: number): string[] {
    const engine = new Engine({ style });
    const sensors = frozen();
    for (const d of sensors.descriptors) engine.hub.announce(d);
    const dt = stepDuration(style.defaultTempo);
    const chords: string[] = [];
    for (let step = 0; step < bars * STEPS_PER_BAR; step++) {
      engine.hub.pushAll(sensors.sampleAt(step * dt));
      engine.tick(dt);
      if (step % STEPS_PER_BAR === 0) chords.push(engine.snapshot().chordRoman);
    }
    return chords;
  }

  it('plays the blues as a 12-bar form', () => {
    const chords = barChords(blues, 24);
    const forms = (blues.palette.chordScales?.forms ?? []).map((f) => f.sequence.join(' '));
    expect(forms).toContain(chords.slice(0, 12).join(' '));
    expect(chords.slice(12, 24)).toEqual(chords.slice(0, 12));
  });

  it('moves jazz between chords on their own scales', () => {
    const engine = new Engine({ style: jazz });
    const sensors = sim();
    for (const d of sensors.descriptors) engine.hub.announce(d);
    const dt = stepDuration(jazz.defaultTempo);
    const roots = new Set<number>();
    const modes = new Set<string>();
    for (let step = 0; step < 32 * STEPS_PER_BAR; step++) {
      engine.hub.pushAll(sensors.sampleAt(step * dt));
      engine.tick(dt);
      if (engine.scale) {
        roots.add(engine.scale.root);
        modes.add(engine.scale.mode);
      }
    }
    expect(roots.size).toBeGreaterThanOrEqual(3);
    expect(modes.size).toBeGreaterThanOrEqual(2);
  });

  it('resolves every blue note by a step', () => {
    const played = run(blues, 64).filter((p) => p.ev.role === 'lead');
    let blueNotes = 0;
    played.forEach((p, i) => {
      if (p.inScale || !p.blueOk) return;
      blueNotes++;
      const next = played.slice(i + 1).find((q) => q.ev.part === p.ev.part);
      if (next?.ev.midi !== undefined) {
        expect(Math.abs(next.ev.midi - (p.ev.midi as number))).toBeLessThanOrEqual(2);
      }
    });
    expect(blueNotes).toBeGreaterThan(0);
  });
});

describe('Free mode', () => {
  it('builds tracks from several styles', () => {
    const styles = new Set<string>();
    for (const sensorSeed of [1, 2, 3, 4, 5, 6]) {
      const engine = new Engine({ style: free });
      const source = new SimulatedSource(sensorSeed);
      for (const d of source.descriptors) engine.hub.announce(d);
      engine.hub.pushAll(source.sampleAt(0));
      engine.tick(0.1);
      for (const m of engine.trackMachines()) styles.add(m.machineId.split('.')[0] as string);
    }
    expect(styles.size).toBeGreaterThanOrEqual(4);
  });
});

describe('Triggered effects', () => {
  for (const style of STYLES) {
    it(`fires ${style.name} effects one at a time, with cooldowns`, () => {
      const fx = run(style, 64)
        .map((p) => p.ev)
        .filter((ev) => ev.role === 'fx');
      expect(fx.length).toBeGreaterThan(0);
      const steps = fx.map((ev) => ev.step);
      expect(new Set(steps).size).toBe(steps.length);
      const allowed = style.palette.effects ?? FX_IDS;
      for (const ev of fx) expect(allowed).toContain(ev.fx);
      const exclusive = fx.filter((ev) => FX_INFO[ev.fx as FxId].exclusive);
      for (let i = 1; i < exclusive.length; i++) {
        const prev = exclusive[i - 1] as NoteEvent;
        expect((exclusive[i] as NoteEvent).step).toBeGreaterThanOrEqual(prev.step + prev.durSteps);
      }
      const last = new Map<FxId, NoteEvent>();
      for (const ev of fx) {
        const prev = last.get(ev.fx as FxId);
        if (prev) {
          const rest = FX_INFO[ev.fx as FxId].rest;
          expect(ev.step).toBeGreaterThanOrEqual(prev.step + prev.durSteps + rest);
        }
        last.set(ev.fx as FxId, ev);
      }
    });
  }

  it('answers a shake with a stutter', () => {
    const engine = new Engine({ style: chiptune });
    engine.hub.announce({ id: 'acc', kind: 'motion.accel', label: 'Shake', range: [0, 20] });
    engine.hub.announce({ id: 'lux', kind: 'light', label: 'Light', range: [0, 1000] });
    const dt = stepDuration(chiptune.defaultTempo);
    const shakes: number[] = [];
    const stutters: number[] = [];
    for (let step = 0; step < 32 * STEPS_PER_BAR; step++) {
      const t = step * dt;
      const shaking = step % (2 * STEPS_PER_BAR) >= 20 && step % (2 * STEPS_PER_BAR) < 24;
      if (shaking && step % (2 * STEPS_PER_BAR) === 20) shakes.push(step);
      engine.hub.push({ id: 'acc', t, v: shaking ? 18 : 0.5 });
      engine.hub.push({ id: 'lux', t, v: 300 });
      for (const ev of engine.tick(dt)) if (ev.fx === 'stutter') stutters.push(ev.step);
    }
    const answered = shakes.filter((s) => stutters.some((x) => x >= s && x < s + 6));
    expect(answered.length).toBeGreaterThanOrEqual(shakes.length / 2);
  });

  it('shows the FX lane among the tracks', () => {
    const engine = new Engine({ style: techno });
    const sensors = sim();
    for (const d of sensors.descriptors) engine.hub.announce(d);
    engine.hub.pushAll(sensors.sampleAt(0));
    engine.tick(0.1);
    const lane = engine.view().tracks.find((t) => t.role === 'fx');
    expect(lane?.label).toBe('FX lane');
    expect(engine.trackMachines().some((m) => m.slot === lane?.slot)).toBe(false);
  });
});
