import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Engine,
  STEPS_PER_BAR,
  SimulatedSource,
  STYLES,
  ambient,
  chiptune,
  isChordTone,
  stepDuration,
  type NoteEvent,
  type Style,
} from '../src';

interface Played {
  ev: NoteEvent;
  inScale: boolean;
  chordTone: boolean;
}

/** Runs the engine with simulated sensors and records each note with its harmonic context. */
function run(style: Style, seed: number, bars: number, sensorSeed = 3): Played[] {
  const engine = new Engine({ style, seed });
  const sim = new SimulatedSource(sensorSeed);
  for (const d of sim.descriptors) engine.hub.announce(d);
  const dt = stepDuration(style.defaultTempo);
  const out: Played[] = [];
  for (let step = 0; step < bars * STEPS_PER_BAR; step++) {
    engine.hub.pushAll(sim.sampleAt(step * dt));
    for (const ev of engine.tick(dt)) {
      out.push({
        ev,
        inScale: ev.midi === undefined || engine.scale.contains(ev.midi),
        chordTone: ev.midi === undefined || isChordTone(engine.scale, engine.chord, ev.midi),
      });
    }
  }
  return out;
}

/** Arbitrary sensor values, including garbage a broken sensor might send. */
const wildValue = fc.oneof(
  fc.double({ min: -1e6, max: 1e6, noNaN: true }),
  fc.constantFrom(NaN, Infinity, -Infinity, 0, 1e12),
);

describe('Engine', () => {
  for (const style of STYLES) {
    describe(style.name, () => {
      const played = run(style, 42, 64);

      it('plays something on every part', () => {
        for (const part of style.parts) {
          expect(played.some((p) => p.ev.part === part.id)).toBe(true);
        }
      });

      it('keeps every pitched note in the current scale', () => {
        expect(played.filter((p) => !p.inScale)).toEqual([]);
      });

      it('lands melody and arpeggio notes on chord tones on strong beats', () => {
        const roles = new Map(style.parts.map((p) => [p.id, p.role]));
        const strong = played.filter(
          (p) =>
            p.ev.midi !== undefined &&
            p.ev.step % 4 === 0 &&
            ['melody', 'arp', 'chords'].includes(roles.get(p.ev.part) ?? ''),
        );
        expect(strong.length).toBeGreaterThan(0);
        expect(strong.filter((p) => !p.chordTone)).toEqual([]);
      });

      it.runIf(style.parts.some((p) => p.role === 'bass'))(
        'plays a chord tone on the bass downbeat',
        () => {
          const bassIds = style.parts.filter((p) => p.role === 'bass').map((p) => p.id);
          const downbeats = played.filter(
            (p) => bassIds.includes(p.ev.part) && p.ev.step % STEPS_PER_BAR === 0,
          );
          expect(downbeats.length).toBeGreaterThan(0);
          expect(downbeats.filter((p) => !p.chordTone)).toEqual([]);
        },
      );

      it('emits well-formed events inside each part range', () => {
        const ranges = new Map(
          style.parts.map((p) => [p.id, 'range' in p ? p.range : undefined] as const),
        );
        for (const { ev } of played) {
          expect(Number.isInteger(ev.step)).toBe(true);
          expect(ev.durSteps).toBeGreaterThan(0);
          expect(ev.vel).toBeGreaterThan(0);
          expect(ev.vel).toBeLessThanOrEqual(1);
          const range = ranges.get(ev.part);
          if (ev.midi !== undefined && range) {
            expect(Number.isInteger(ev.midi)).toBe(true);
            expect(ev.midi).toBeGreaterThanOrEqual(range[0]);
            expect(ev.midi).toBeLessThanOrEqual(range[1]);
          } else {
            expect(ev.voice).toBeTruthy();
          }
        }
      });
    });
  }

  it('is deterministic for a given seed', () => {
    const a = run(chiptune, 7, 16).map((p) => p.ev);
    const b = run(chiptune, 7, 16).map((p) => p.ev);
    const c = run(chiptune, 8, 16).map((p) => p.ev);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('matches the recorded output for a fixed seed', () => {
    const events = run(chiptune, 2026, 4).map((p) => p.ev);
    expect(events).toMatchSnapshot();
  });

  it('stays musical with arbitrary, even broken, sensor values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.array(fc.array(wildValue, { minLength: 4, maxLength: 4 }), {
          minLength: 32,
          maxLength: 128,
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
            expect(events.length).toBeLessThanOrEqual(12);
            for (const ev of events) {
              expect(Number.isFinite(ev.vel)).toBe(true);
              if (ev.midi !== undefined) expect(engine.scale.contains(ev.midi)).toBe(true);
            }
          });
        },
      ),
      { numRuns: 60 },
    );
  });

  it('switches style on the next bar line', () => {
    const engine = new Engine({ style: chiptune, seed: 1 });
    const other: Style = { ...chiptune, id: 'other', parts: chiptune.parts.slice(0, 1) };
    const dt = stepDuration(120);
    for (let i = 0; i < 5; i++) engine.tick(dt);
    engine.setStyle(other);
    for (let i = 5; i < STEPS_PER_BAR; i++) engine.tick(dt);
    expect(engine.currentStyle.id).toBe('chiptune');
    engine.tick(dt);
    expect(engine.currentStyle.id).toBe('other');
  });

  it('reports a readable snapshot', () => {
    const engine = new Engine({ style: chiptune, seed: 3, keyRoot: 9 });
    engine.tick(0.1);
    const snap = engine.snapshot();
    expect(snap.keyName).toMatch(/^A /);
    expect(snap.chordRoman).toMatch(/^(i|I)/);
    expect(snap.bar).toBe(0);
  });
});

describe('Ambient drone', () => {
  it('holds the tonic and fifth of the current key', () => {
    const engine = new Engine({ style: ambient, seed: 4 });
    const dt = stepDuration(ambient.defaultTempo);
    let drones = 0;
    for (let step = 0; step < 64 * STEPS_PER_BAR; step++) {
      for (const ev of engine.tick(dt)) {
        if (ev.part !== 'drone') continue;
        drones++;
        const rel = ((((ev.midi as number) - engine.scale.root) % 12) + 12) % 12;
        expect([0, 7]).toContain(rel);
        expect(ev.durSteps).toBeGreaterThanOrEqual(STEPS_PER_BAR);
      }
    }
    expect(drones).toBeGreaterThanOrEqual(16);
  });
});
