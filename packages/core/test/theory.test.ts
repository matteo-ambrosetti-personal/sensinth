import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MODE_LADDER,
  Scale,
  chordPitchClasses,
  chordSymbol,
  euclid,
  mod,
  nearestChordTone,
  voiceChord,
  type ModeId,
} from '../src';

const modeArb = fc.constantFrom<ModeId>(...MODE_LADDER);

describe('Scale', () => {
  it('maps degrees to the expected notes', () => {
    const c = new Scale(0, 'ionian');
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((d) => c.degreeToMidi(d + 35))).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72,
    ]);
    const a = new Scale(9, 'aeolian');
    expect(a.name).toBe('A Minor');
    expect(a.pitchClasses()).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });

  it('round-trips degrees, and every degree is in the scale', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 11 }),
        modeArb,
        fc.integer({ min: -10, max: 80 }),
        (root, mode, deg) => {
          const s = new Scale(root, mode);
          const midi = s.degreeToMidi(deg);
          expect(s.contains(midi)).toBe(true);
          expect(s.degreeOf(midi)).toBe(deg);
        },
      ),
    );
  });

  it('quantizes any note to a nearby in-scale note', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 11 }),
        modeArb,
        fc.integer({ min: 0, max: 127 }),
        (root, mode, m) => {
          const q = new Scale(root, mode).quantize(m);
          expect(new Scale(root, mode).contains(q)).toBe(true);
          expect(Math.abs(q - m)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe('chords', () => {
  it('names diatonic chords', () => {
    const c = new Scale(0, 'ionian');
    expect(chordSymbol(c, { degree: 0, size: 3 })).toEqual({ roman: 'I', name: 'C' });
    expect(chordSymbol(c, { degree: 1, size: 3 })).toEqual({ roman: 'ii', name: 'Dm' });
    expect(chordSymbol(c, { degree: 4, size: 4 })).toEqual({ roman: 'V7', name: 'G7' });
    expect(chordSymbol(c, { degree: 0, size: 4 })).toEqual({ roman: 'Imaj7', name: 'Cmaj7' });
    expect(chordSymbol(c, { degree: 6, size: 3 })).toEqual({ roman: 'vii°', name: 'Bdim' });
    expect(chordSymbol(c, { degree: 6, size: 4 })).toEqual({ roman: 'viiø', name: 'Bm7b5' });
    expect(chordSymbol(c, { degree: 5, size: 5 })).toEqual({ roman: 'vi9', name: 'Am9' });
  });

  it('finds the nearest chord tone within range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 11 }),
        modeArb,
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 30, max: 90 }),
        (root, mode, degree, midi) => {
          const s = new Scale(root, mode);
          const chord = { degree, size: 3 };
          const t = nearestChordTone(s, chord, midi, midi - 12, midi + 12);
          expect(chordPitchClasses(s, chord)).toContain(mod(t, 12));
          expect(Math.abs(t - midi)).toBeLessThanOrEqual(4);
        },
      ),
    );
  });
});

describe('voiceChord', () => {
  it('stays in range, uses the chord notes and moves little', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 11 }),
        modeArb,
        fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 2, maxLength: 8 }),
        (root, mode, degrees) => {
          const s = new Scale(root, mode);
          let prev: number[] | undefined;
          for (const degree of degrees) {
            const pcs = chordPitchClasses(s, { degree, size: 4 });
            const v = voiceChord(pcs, 55, 79, prev);
            for (const n of v) {
              expect(n).toBeGreaterThanOrEqual(55);
              expect(n).toBeLessThanOrEqual(79);
            }
            expect(new Set(v.map((n) => mod(n, 12)))).toEqual(new Set(pcs));
            if (prev) {
              const moved = v.reduce(
                (sum, n) => sum + Math.min(...prev!.map((p) => Math.abs(n - p))),
                0,
              );
              expect(moved).toBeLessThanOrEqual(4 * 6);
            }
            prev = v;
          }
        },
      ),
    );
  });
});

describe('euclid', () => {
  it('spreads hits evenly', () => {
    const str = (b: boolean[]) => b.map((x) => (x ? 'x' : '.')).join('');
    expect(str(euclid(3, 8))).toBe('x..x..x.');
    expect(str(euclid(4, 16))).toBe('x...x...x...x...');
    expect(str(euclid(0, 4))).toBe('....');
    expect(euclid(5, 13).filter(Boolean)).toHaveLength(5);
  });
});
