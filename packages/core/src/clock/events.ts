import type { FxId } from '../fx/effects';
import type { TrackParams } from '../mod/params';
import type { Retrig, TrackRole } from '../seq/types';

/** One note produced by the engine, always on the 16th-note grid. */
export interface NoteEvent {
  /** Track slot, e.g. `t1`. */
  part: string;
  role: TrackRole;
  /** Absolute step index (16ths since start). */
  step: number;
  /**
   * Deterministic mode: the step within the loop. Anything the renderer
   * varies per note (humanized timing, noise) follows it, so every pass of
   * the loop sounds the same.
   */
  loopStep?: number;
  /** Length in steps (may be fractional). */
  durSteps: number;
  /** MIDI note number; omitted for unpitched drum hits. */
  midi?: number;
  /** Velocity 0..1. */
  vel: number;
  /** Drum voice, e.g. `kick`, `snare`, `hat`. */
  voice?: string;
  /** Offset from the grid, in steps (micro timing, track speed). */
  micro?: number;
  /** Repeats of the note, e.g. a hi-hat roll. */
  retrig?: Retrig;
  /** Slide into this note from the previous one. */
  slide?: boolean;
  /** An effect on the whole mix (role `fx`); `vel` is its depth, `durSteps` its length. */
  fx?: FxId;
  /** The track's parameters for this note (base or p-lock, plus modulation), 0..1. */
  params?: TrackParams;
}
