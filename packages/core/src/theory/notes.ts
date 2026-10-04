import { mod } from '../math';

export const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function pitchClassName(pc: number): string {
  return PITCH_CLASS_NAMES[mod(Math.round(pc), 12)] as string;
}

export function noteName(midi: number): string {
  return `${pitchClassName(midi)}${Math.floor(midi / 12) - 1}`;
}

/** Moves `midi` by octaves until it lies in [lo, hi] (when the range spans an octave). */
export function foldIntoRange(midi: number, lo: number, hi: number): number {
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m < lo ? m + 12 : m;
}
