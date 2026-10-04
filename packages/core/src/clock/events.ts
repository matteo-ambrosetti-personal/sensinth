/** One note produced by the composer, always on the 16th-note grid. */
export interface NoteEvent {
  /** Part id from the style, e.g. `lead`, `bass`, `drums`. */
  part: string;
  /** Absolute step index (16ths since start). */
  step: number;
  /** Length in steps (may be fractional). */
  durSteps: number;
  /** MIDI note number; omitted for unpitched drum hits. */
  midi?: number;
  /** Velocity 0..1. */
  vel: number;
  /** Drum voice, e.g. `kick`, `snare`, `hat`. */
  voice?: string;
}
