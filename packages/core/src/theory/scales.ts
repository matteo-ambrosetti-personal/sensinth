import { mod } from '../math';
import { pitchClassName } from './notes';

export type ModeId = 'lydian' | 'ionian' | 'mixolydian' | 'dorian' | 'aeolian' | 'phrygian';

/** Diatonic modes, as semitone offsets from the root. */
export const MODES: Record<ModeId, { intervals: readonly number[]; label: string }> = {
  lydian: { intervals: [0, 2, 4, 6, 7, 9, 11], label: 'Lydian' },
  ionian: { intervals: [0, 2, 4, 5, 7, 9, 11], label: 'Major' },
  mixolydian: { intervals: [0, 2, 4, 5, 7, 9, 10], label: 'Mixolydian' },
  dorian: { intervals: [0, 2, 3, 5, 7, 9, 10], label: 'Dorian' },
  aeolian: { intervals: [0, 2, 3, 5, 7, 8, 10], label: 'Minor' },
  phrygian: { intervals: [0, 1, 3, 5, 7, 8, 10], label: 'Phrygian' },
};

/** Modes from darkest to brightest; `brightness` walks along this ladder. */
export const MODE_LADDER: readonly ModeId[] = [
  'phrygian',
  'aeolian',
  'dorian',
  'mixolydian',
  'ionian',
  'lydian',
];

/**
 * Scale-degree indices (0..6) of a mode's pentatonic subset: the mode minus
 * its tritone pair, which removes the semitone clashes. The tonic is never
 * dropped (in Lydian only the raised fourth goes).
 */
export function pentatonicDegrees(mode: ModeId): number[] {
  const iv = MODES[mode].intervals;
  const drop = new Set<number>();
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      if ((iv[j] as number) - (iv[i] as number) === 6) {
        if (i !== 0) drop.add(i);
        drop.add(j);
      }
    }
  }
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !drop.has(d));
}

/** Sorts a style's modes from darkest to brightest. */
export function byBrightness(modes: readonly ModeId[]): ModeId[] {
  return [...modes].sort((a, b) => MODE_LADDER.indexOf(a) - MODE_LADDER.indexOf(b));
}

/**
 * A key (root pitch class) plus a mode. Pitches are addressed by absolute
 * scale degree: degree 0 is the root in MIDI octave -1, degree 7 an octave
 * higher, and so on. Anything built from degrees is in the scale by construction.
 */
export class Scale {
  readonly intervals: readonly number[];

  constructor(
    readonly root: number,
    readonly mode: ModeId,
  ) {
    this.intervals = MODES[mode].intervals;
  }

  get name(): string {
    return `${pitchClassName(this.root)} ${MODES[this.mode].label}`;
  }

  degreeToMidi(degree: number): number {
    const octave = Math.floor(degree / 7);
    return this.root + 12 * octave + (this.intervals[mod(degree, 7)] as number);
  }

  /** Absolute degree of `midi`; for out-of-scale notes, the degree just below. */
  degreeOf(midi: number): number {
    const rel = midi - this.root;
    const octave = Math.floor(rel / 12);
    const pc = mod(rel, 12);
    let idx = 0;
    for (let i = 0; i < 7; i++) if ((this.intervals[i] as number) <= pc) idx = i;
    return octave * 7 + idx;
  }

  contains(midi: number): boolean {
    return this.intervals.includes(mod(midi - this.root, 12));
  }

  /** Nearest in-scale note (ties resolve downward). */
  quantize(midi: number): number {
    const m = Math.round(midi);
    for (let d = 0; d <= 6; d++) {
      if (this.contains(m - d)) return m - d;
      if (this.contains(m + d)) return m + d;
    }
    return m;
  }

  pitchClasses(): number[] {
    return this.intervals.map((i) => mod(this.root + i, 12));
  }
}
