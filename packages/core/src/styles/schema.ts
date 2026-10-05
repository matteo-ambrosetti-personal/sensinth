import type { MappingRules } from '../mapping/rules';
import type { TrackParam } from '../mod/params';
import type { TrackRole } from '../seq/types';
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

export type DrumVoice =
  'kick' | 'snare' | 'clap' | 'rim' | 'hat' | 'ohat' | 'shaker' | 'tom' | 'perc' | 'zap' | 'noise';

/** Sound family of a drum voice: 8-bit, dusty boom-bap, or soft and round. */
export type DrumFlavor = 'chip' | 'lofi' | 'soft';

/** Sound of a machine. Interpreted by the audio renderer; track params shape it further. */
export type Patch =
  | {
      type: 'pulse';
      gain: number;
      /** Pulse widths to choose from; `timbre` picks one. */
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
      env: Envelope;
      gate?: number;
      /** Cents between two detuned oscillators per note (0 = one oscillator); `timbre` scales it. */
      detune?: number;
      vibrato?: Vibrato;
    }
  | {
      /** Two-operator FM: electric-piano keys, bells, soft leads. */
      type: 'fm';
      gain: number;
      /** Modulator frequency as a multiple of the note frequency. */
      ratio: number;
      /** Modulation index at the attack and after `indexDecay`; `timbre` scales both. */
      index: [number, number];
      /** Seconds for the index to settle (the "ping" of the attack). */
      indexDecay: number;
      env: Envelope;
      gate?: number;
      vibrato?: Vibrato;
    }
  | {
      /** Several detuned oscillators through a low-pass that opens with the note. */
      type: 'pad';
      wave: 'sine' | 'triangle' | 'sawtooth' | 'square';
      gain: number;
      /** Oscillators per note. */
      voices: number;
      /** Total detune spread in cents; `timbre` scales it. */
      detune: number;
      /** Filter cutoff in Hz at cutoff = 0 and cutoff = 1. */
      cutoff: [number, number];
      env: Envelope;
      gate?: number;
    }
  | {
      /** One synthesized drum voice; tune, decay, timbre and drive reshape it. */
      type: 'drum';
      voice: DrumVoice;
      flavor: DrumFlavor;
      gain: number;
    };

/**
 * A sound source a track can use, like a Digitakt track's sample or machine.
 * The style offers machines; the genome picks one per track.
 */
export interface Machine {
  /** Shown on the track. */
  label: string;
  role: TrackRole;
  patch: Patch;
  /** Pitch range for tonal machines. */
  range?: [number, number];
  /** Fraction of steps holding a trig, at the lowest and highest density. */
  density: [number, number];
  /** Track lengths to choose from (default: the palette's). */
  lengths?: readonly number[];
  /** Track speeds to choose from (default: the palette's). */
  scales?: readonly number[];
  /** Ranges for base param values, overriding the defaults. */
  base?: Partial<Record<TrackParam, [number, number]>>;
  /** Track filter cutoff in Hz at cutoff = 0 and cutoff = 1 (default [120, 18000]). */
  filter?: [number, number];
  /** Keep melodic lines on the mode's pentatonic subset (no semitone clashes). */
  pentatonic?: boolean;
  /** Drones: also hold the fifth. */
  fifth?: boolean;
  /** Longest melodic note, in steps. */
  maxLen?: number;
}

/** A place for a track in the pattern, filled with one of the listed machines. */
export interface SlotOption {
  role: TrackRole;
  machines: readonly string[];
  /** Always present, before optional slots. */
  required?: boolean;
  /** Relative chance of an optional slot being picked (default 1). */
  weight?: number;
}

/**
 * The sound world of a style. Sensors decide everything inside it: which
 * machines play, the patterns, lengths, routings, timbres, key and mode.
 */
export interface Palette {
  /** Modes the genome chooses from; `brightness` moves within its choice. */
  modes: readonly ModeId[];
  progression: MarkovTable;
  /** Bars per chord to choose from. */
  chordRates: readonly number[];
  /** Notes per chord, [min, max]; `tension` picks within it. */
  chordSize: [number, number];
  /** Bars per phrase; the pattern mutates at every phrase start. */
  phraseBars: number;
  /** Bars per section; the pattern is regenerated at every section start. */
  sectionBars: number;
  /** Swing range: 0.5 straight, up to ~0.66 shuffled. */
  swing: [number, number];
  /** Number of tracks, [min, max]. */
  trackCount: [number, number];
  /** Required slots first, then optional ones. */
  slots: readonly SlotOption[];
  machines: Record<string, Machine>;
  /** Track lengths in steps; mixing co-prime lengths makes the pattern repeat very rarely. */
  lengths: readonly number[];
  /** Track speeds. */
  scales: readonly number[];
  /** LFO cycle range in steps. */
  lfoPeriod: [number, number];
  /** Most notes that may start on one step. */
  maxEventsPerStep: number;
}

export interface FxConfig {
  /** Reverb return at space = 0 and space = 1. */
  reverb: [number, number];
  /** Delay return at space = 0 and space = 1. */
  delay: [number, number];
  /** Delay time in steps (3 = dotted eighth). */
  delaySteps: number;
  /** Master low-pass cutoff in Hz at brightness = 0 and brightness = 1. */
  filter: [number, number];
  /** Reverb tail length in seconds (default 2.4). */
  reverbSeconds?: number;
  /** Vinyl crackle level at variation = 0 and variation = 1. */
  crackle?: [number, number];
  /** Tape wobble depth in cents at texture = 0 and texture = 1. */
  wobble?: [number, number];
  /** Random timing offset per note, in milliseconds, for a played-by-hand feel. */
  humanize?: number;
}

/** A style is pure data: a palette plus effects. Adding a style means adding one of these. */
export interface Style {
  id: string;
  name: string;
  description: string;
  /** Suggested tempo; the user always has the final say. */
  defaultTempo: number;
  palette: Palette;
  fx: FxConfig;
  /** Style-specific mapping rules for the macros, layered over the defaults. */
  mapping?: Partial<MappingRules>;
}
