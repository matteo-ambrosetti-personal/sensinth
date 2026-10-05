import type { NoteEvent, TrackParams } from '@sensinth/core';

export interface Instrument {
  readonly output: AudioNode;
  /**
   * Plays `ev` at `time` (seconds, context clock) lasting `duration` seconds.
   * `params` are the track's values for this note (timbre, decay, tune, …).
   */
  play(ev: NoteEvent, time: number, duration: number, params: Readonly<TrackParams>): void;
}
