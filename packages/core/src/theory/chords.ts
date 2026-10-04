import { mod } from '../math';
import { pitchClassName } from './notes';
import type { Scale } from './scales';

/** A diatonic chord: thirds stacked on a scale degree, so its notes are always in the scale. */
export interface Chord {
  /** Scale degree of the root, 0..6 (0 = tonic). */
  degree: number;
  /** Number of notes: 3 triad, 4 seventh, 5 ninth. */
  size: number;
}

export function chordDegrees(chord: Chord): number[] {
  return Array.from({ length: chord.size }, (_, i) => chord.degree + 2 * i);
}

export function chordPitchClasses(scale: Scale, chord: Chord): number[] {
  return chordDegrees(chord).map((d) => mod(scale.degreeToMidi(d), 12));
}

export function isChordTone(scale: Scale, chord: Chord, midi: number): boolean {
  return chordPitchClasses(scale, chord).includes(mod(midi, 12));
}

/** Lowest note at or above `lo` with the given pitch class. */
export function lowestAtOrAbove(pc: number, lo: number): number {
  return lo + mod(pc - lo, 12);
}

/**
 * Chord tone closest to `midi` inside [lo, hi]. When two are equally close,
 * `prefer` picks the direction. Returns `midi` unchanged if none fits.
 */
export function nearestChordTone(
  scale: Scale,
  chord: Chord,
  midi: number,
  lo = -Infinity,
  hi = Infinity,
  prefer: 'up' | 'down' = 'down',
): number {
  const pcs = chordPitchClasses(scale, chord);
  const ok = (m: number) => m >= lo && m <= hi && pcs.includes(mod(m, 12));
  for (let d = 0; d <= 12; d++) {
    const first = prefer === 'down' ? midi - d : midi + d;
    const second = prefer === 'down' ? midi + d : midi - d;
    if (ok(first)) return first;
    if (ok(second)) return second;
  }
  return midi;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Roman numeral and chord name, e.g. `{ roman: 'vi7', name: 'Am7' }`. */
export function chordSymbol(scale: Scale, chord: Chord): { roman: string; name: string } {
  const pcs = chordPitchClasses(scale, chord);
  const root = pcs[0] as number;
  const third = mod((pcs[1] as number) - root, 12);
  const fifth = mod((pcs[2] as number) - root, 12);
  const seventh = pcs.length > 3 ? mod((pcs[3] as number) - root, 12) : undefined;
  const minor = third === 3;
  const dim = minor && fifth === 6;
  const aug = !minor && fifth === 8;

  let roman = ROMAN[mod(chord.degree, 7)] as string;
  if (minor) roman = roman.toLowerCase();
  let name = pitchClassName(root);
  if (dim) {
    roman += seventh === 10 ? 'ø' : '°';
    name += seventh === 10 ? 'm7b5' : seventh === 9 ? 'dim7' : 'dim';
  } else if (aug) {
    roman += '+';
    name += 'aug';
  } else if (minor) {
    name += 'm';
  }
  if (seventh !== undefined && !dim) {
    const ext = chord.size >= 5 ? '9' : '7';
    if (seventh === 11) {
      roman += `maj${ext}`;
      name += `maj${ext}`;
    } else {
      roman += ext;
      name += ext;
    }
  }
  return { roman, name };
}
