import type { FxId } from '../fx/effects';
import type { LfoSpec } from '../mod/lfo';
import type { TrackParam, TrackParams } from '../mod/params';
import type { RhythmHint } from '../styles/schema';

/** What a track plays. Decides how its trigs are turned into notes. `fx` is the effects lane. */
export type TrackRole = 'drum' | 'bass' | 'lead' | 'arp' | 'chords' | 'pad' | 'drone' | 'fx';

export const TRACK_ROLES: readonly TrackRole[] = [
  'drum',
  'bass',
  'lead',
  'arp',
  'chords',
  'pad',
  'drone',
];

/**
 * Trig conditions, as on Elektron sequencers:
 * - `ratio` (A:B): plays on loop A of every B loops of the track;
 * - `fill`: plays only while a fill is on (`not`: only while it is off);
 * - `pre`: plays if the previous conditional trig on this track played;
 * - `nei`: plays if the latest conditional trig on the track above played;
 * - `first`: plays only on the first loop after the pattern was (re)built.
 */
export type TrigCondition =
  | { kind: 'always' }
  | { kind: 'ratio'; a: number; b: number }
  | { kind: 'fill' | 'pre' | 'nei' | 'first'; not: boolean };

/**
 * A pitch addressed relative to the harmony, never as a raw note, so it is
 * realized against whatever scale and chord are playing.
 */
export interface TrigNote {
  /** Chord-tone index (0 root, 1 third, 2 fifth, 3 seventh…) when `chord`, else scale degrees from the track's anchor. */
  tone: number;
  chord: boolean;
  /** Octaves up (+) or down (−). */
  oct: number;
  /** Bass: walk into the next chord's root by a scale step. */
  approach?: boolean;
  /** Lead: bend to a blue note (♭3 or ♭5 of the key) on a weak step, then resolve. */
  blue?: boolean;
}

export interface Retrig {
  /** Hits including the first, 2..8. */
  count: number;
  /** Steps between hits: 0.5 = 1/32, 1/3 = 1/16 triplet, 0.25 = 1/64. */
  rate: number;
  /** Velocity slope over the hits, −1 (fading) .. 1 (growing). */
  curve: number;
}

export interface Trig {
  note?: TrigNote;
  /** Velocity 0..1. */
  vel: number;
  /** Length in the track's own steps. */
  len: number;
  /** Probability 0..1, before the track's `prob` param scales it. */
  prob: number;
  cond: TrigCondition;
  /** Offset from the grid, in steps (−0.45..0.45). */
  micro: number;
  retrig?: Retrig;
  /** Slide into this note from the previous one (machines with glide). */
  slide?: boolean;
  /** FX lane: the effect this trig fires. */
  fx?: FxId;
  /** Parameter locks for this trig only. */
  locks?: Partial<Record<TrackParam, number>>;
}

/** One track of the pattern, as written by the genome and mutated every phrase. */
export interface TrackSpec {
  /** Stable slot id, `t1`… */
  slot: string;
  role: TrackRole;
  /** Machine id in the style palette. */
  machine: string;
  /** Steps per loop, 1..64. */
  length: number;
  /** Track steps per 16th: 0.5 half speed, 2 double speed. */
  scale: number;
  trigs: (Trig | undefined)[];
  /** Base parameter values. */
  base: TrackParams;
  /** Pitch range for tonal tracks. */
  range: [number, number];
  lfo: LfoSpec;
  /** Drum voice, for drum tracks. */
  voice?: string;
  /** Keep melodic tracks on the mode's pentatonic subset. */
  pentatonic?: boolean;
  /** Drones: also hold the fifth. */
  fifth?: boolean;
  /** Leads may use blue notes. */
  blueNotes?: boolean;
  /**
   * Which of the palette's slots the track fills (its index in
   * `palette.slots`): what a track is, whatever slot id it holds. Evolution
   * matches tracks by it.
   */
  option?: number;
  /** The rhythm template its pattern follows, if any (four on the floor, …). */
  rhythm?: RhythmHint;
}

export const MAX_TRACK_LENGTH = 64;

export function cloneTrig(t: Trig): Trig {
  return {
    ...t,
    cond: { ...t.cond },
    ...(t.note ? { note: { ...t.note } } : {}),
    ...(t.retrig ? { retrig: { ...t.retrig } } : {}),
    ...(t.locks ? { locks: { ...t.locks } } : {}),
  };
}

/** A deep copy of a track: edits and mutations of the copy leave the original alone. */
export function cloneTrack(t: TrackSpec): TrackSpec {
  return {
    ...t,
    trigs: t.trigs.map((trig) => (trig ? cloneTrig(trig) : undefined)),
    base: { ...t.base },
    range: [t.range[0], t.range[1]],
    lfo: { ...t.lfo },
  };
}
export const TRACK_SCALES: readonly number[] = [0.5, 0.75, 1, 1.5, 2];

/** Compact label of a condition, as shown on the step grid (`1:2`, `fill`, `!pre`). */
export function conditionLabel(cond: TrigCondition): string {
  switch (cond.kind) {
    case 'always':
      return '';
    case 'ratio':
      return `${cond.a}:${cond.b}`;
    default:
      return `${cond.not ? '!' : ''}${cond.kind}`;
  }
}
