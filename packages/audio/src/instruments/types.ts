import type { Macros, NoteEvent } from '@sensinth/core';

export interface Instrument {
  readonly output: AudioNode;
  /** Plays `ev` at `time` (seconds, context clock) lasting `duration` seconds. */
  play(ev: NoteEvent, time: number, duration: number, macros: Readonly<Macros>): void;
}
