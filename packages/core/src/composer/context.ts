import type { NoteEvent } from '../clock/events';
import type { Macros, Triggers } from '../mapping/macros';
import type { Chord } from '../theory/chords';
import type { Scale } from '../theory/scales';
import type { Style } from '../styles/schema';

/** Everything a part needs to decide what to play on one step. */
export interface ComposerContext {
  style: Style;
  step: number;
  bar: number;
  stepInBar: number;
  barInPhrase: number;
  phraseInSection: number;
  isPhraseStart: boolean;
  isSectionStart: boolean;
  isLastBarOfPhrase: boolean;
  isLastPhraseOfSection: boolean;
  macros: Readonly<Macros>;
  triggers: Readonly<Triggers>;
  scale: Scale;
  chord: Chord;
  nextChord: Chord;
  /** True on the step where a new chord starts. */
  chordChanged: boolean;
  /** Steps left before the next chord starts (≥ 1). */
  stepsUntilChordChange: number;
}

export interface Part {
  readonly id: string;
  /** Called on the first step of every bar, before `onStep`. */
  onBar?(ctx: ComposerContext): void;
  onStep(ctx: ComposerContext): NoteEvent[];
}
