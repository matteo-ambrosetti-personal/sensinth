import type { MacroId } from '../mapping/macros';
import type { MappingRules } from '../mapping/rules';
import type { ModeId } from '../theory/scales';

/**
 * Chord-progression Markov table over scale degrees (0 = I … 6 = vii):
 * `table[from][to]` is the relative weight of moving from one chord to the next.
 */
export type MarkovTable = Record<number, Record<number, number>>;

/** Envelope in seconds; `s` is the sustain level 0..1. */
export interface Envelope {
  a: number;
  d: number;
  s: number;
  r: number;
}

export interface Vibrato {
  /** Hz. */
  rate: number;
  /** Cents. */
  depth: number;
  /** Seconds before vibrato fades in. */
  delay: number;
}

/** Sound of one part. Interpreted by the audio renderer. */
export type Patch =
  | {
      type: 'pulse';
      gain: number;
      pan?: number;
      /** Pulse widths to choose from; `texture` picks one. */
      duty: readonly number[];
      env: Envelope;
      /** Fraction of the note length the gate stays open. */
      gate?: number;
      vibrato?: Vibrato;
    }
  | {
      type: 'osc';
      wave: 'sine' | 'triangle' | 'sawtooth' | 'square';
      gain: number;
      pan?: number;
      env: Envelope;
      gate?: number;
      /** Cents between two detuned oscillators per note (0 = one oscillator). */
      detune?: number;
      vibrato?: Vibrato;
    }
  | {
      type: 'chipDrums';
      gain: number;
      pan?: number;
    };

interface PartBase {
  id: string;
  /** Key into `Style.instruments`. */
  instrument: string;
}

/**
 * Drums play 16-step patterns per voice. Each voice lists patterns from
 * sparse to busy; `energy` picks the level. Pattern characters:
 * `X` accent, `x` hit, `o` ghost, `.` rest.
 */
export interface DrumsPartConfig extends PartBase {
  role: 'drums';
  voices: Record<string, readonly string[]>;
  /** One-beat fills (4 characters per voice) replacing the last beat of a bar. */
  fills: readonly Record<string, string>[];
  /** Voice used when a sensor onset requests an accent. */
  accentVoice: string;
  /** Voice used for random ghost notes when `variation` is high. */
  ghostVoice: string;
}

/**
 * Bass patterns (16 or 32 steps), sparse to busy. Characters:
 * `R` root, `5` fifth, `3` third, `8` octave, `x` any of root/fifth/octave,
 * `a` approach tone into the next chord, `-` hold, `.` rest.
 */
export interface BassPartConfig extends PartBase {
  role: 'bass';
  range: [number, number];
  patterns: readonly string[];
}

export interface MelodyPartConfig extends PartBase {
  role: 'melody';
  range: [number, number];
  /** Probability-ish note density at energy 0 and energy 1. */
  density: [number, number];
  /** How often off-beat 16ths get notes, 0..1. */
  syncopation: number;
  /** Longest note, in steps. */
  maxDur: number;
}

export interface ArpPartConfig extends PartBase {
  role: 'arp';
  range: [number, number];
  /** Semitone window the arpeggio spans inside `range`; `register` moves it. */
  span: number;
  /** Steps per note, slow to fast; `energy` picks one. */
  rates: readonly number[];
}

/**
 * Chord comping/pads. Patterns use `x` for a chord hit and `-` to hold.
 */
export interface ChordsPartConfig extends PartBase {
  role: 'chords';
  range: [number, number];
  patterns: readonly string[];
}

export type PartConfig =
  DrumsPartConfig | BassPartConfig | MelodyPartConfig | ArpPartConfig | ChordsPartConfig;

export interface FxConfig {
  /** Reverb send at space = 0 and space = 1. */
  reverb: [number, number];
  /** Delay send at space = 0 and space = 1. */
  delay: [number, number];
  /** Delay time in steps (3 = dotted eighth). */
  delaySteps: number;
  /** Master low-pass cutoff in Hz at brightness = 0 and brightness = 1. */
  filter: [number, number];
}

/** A style is pure data: adding a style means adding one of these. */
export interface Style {
  id: string;
  name: string;
  description: string;
  /** Suggested tempo; the user always has the final say. */
  defaultTempo: number;
  /** 0.5 straight, up to ~0.66 shuffled. */
  swing: number;
  /** Allowed modes; `brightness` chooses among them. */
  modes: readonly ModeId[];
  progression: MarkovTable;
  /** Bars per chord (0.5, 1, 2 or 4). */
  chordRateBars: number;
  /** Notes per chord, [min, max]; `tension` picks within it. */
  chordSize: [number, number];
  /** Bars per phrase (motif + answer), usually 4. */
  phraseBars: number;
  /** Bars per section; key changes only happen between sections. */
  sectionBars: number;
  parts: readonly PartConfig[];
  instruments: Record<string, Patch>;
  fx: FxConfig;
  /** Style-specific mapping rules, layered over the defaults. */
  mapping?: Partial<MappingRules>;
  /**
   * Squeezes a macro into [min, max] for this style, e.g. a dance style that
   * never drops below medium energy even when the phone lies still.
   */
  macroRanges?: Partial<Record<MacroId, [number, number]>>;
}
