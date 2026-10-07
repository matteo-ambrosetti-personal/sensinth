import type { FxId } from '../fx/effects';
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
  | 'kick'
  | 'snare'
  | 'brush'
  | 'clap'
  | 'rim'
  | 'hat'
  | 'ohat'
  | 'ride'
  | 'crash'
  | 'cowbell'
  | 'shaker'
  | 'tom'
  | 'perc'
  | 'zap'
  | 'noise';

/** Sound family of a drum voice: 8-bit, dusty boom-bap, or soft and round. */
export type DrumFlavor = 'chip' | 'lofi' | 'soft';

/** A per-note low-pass with its own envelope: the squelch of an acid bass. */
export interface NoteFilter {
  /** Cutoff in Hz at the bottom and top of its sweep. */
  range: [number, number];
  /** Resonance (Q). */
  q: number;
  /** Envelope depth 0..1; accents (loud notes) open it further. */
  env: number;
  /** Seconds for the envelope to close. */
  decay: number;
}

/** Monophonic pitch slide between notes that ask for it. */
export interface Glide {
  /** Seconds to reach the new note. */
  time: number;
}

/** A pitch drop at the start of each note (808s, toms). */
export interface PitchEnvelope {
  /** Semitones above the note it starts from. */
  semitones: number;
  /** Seconds to fall to the note. */
  time: number;
}

/** Amplitude wobble: vibraphone motor, Leslie speaker. */
export interface Tremolo {
  /** Hz. */
  rate: number;
  /** 0..1. */
  depth: number;
}

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
      filter?: NoteFilter;
      glide?: Glide;
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
      filter?: NoteFilter;
      glide?: Glide;
      pitchEnv?: PitchEnvelope;
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
      tremolo?: Tremolo;
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
      /** Additive organ: drawbar levels for the 16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓' and 1' pipes. */
      type: 'organ';
      gain: number;
      drawbars: readonly number[];
      env: Envelope;
      gate?: number;
      /** Leslie-like tremolo; `timbre` speeds it up. */
      tremolo?: Tremolo;
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
  /** Leads may bend to blue notes (♭3, ♭5 of the key) on weak steps. */
  blueNotes?: boolean;
  /** Longest melodic note, in steps. */
  maxLen?: number;
  /** Rhythm the pattern generator follows (default: Euclidean). */
  rhythm?: RhythmHint;
  /** Chance that a note slides into the next (needs a patch with `glide`). */
  slide?: number;
}

/**
 * Rhythm templates a machine's patterns follow:
 * - `four`: four on the floor; `offbeat`: the "and" of every beat;
 * - `backbeat`: beats 2 and 4; `break`: breakbeat kick/snare figures;
 * - `walking`: a note on every beat, into the next chord;
 * - `ride`: the jazz ride figure; `charleston`: comping on 1 and the "and" of 2;
 * - `pulse`: steady eighths; `euclid`: evenly spread hits (default).
 */
export type RhythmHint =
  | 'euclid'
  | 'four'
  | 'offbeat'
  | 'backbeat'
  | 'break'
  | 'walking'
  | 'ride'
  | 'charleston'
  | 'pulse';

/** A place for a track in the pattern, filled with one of the listed machines. */
export interface SlotOption {
  role: TrackRole;
  machines: readonly string[];
  /** Always present, before optional slots. */
  required?: boolean;
  /** Relative chance of an optional slot being picked (default 1). */
  weight?: number;
}

/** A chord built on its own local scale: the tonic chord of `mode`, rooted `root` semitones above the key. */
export interface ChordDef {
  /** Shown as the roman numeral, e.g. `IV7`, `ii∅`. */
  id: string;
  /** Semitones above the key's root. */
  root: number;
  /** The local scale; its tonic chord gives the quality (mixolydian → 7, locrian → m7♭5, …). */
  mode: ModeId;
}

/** A fixed chord sequence that loops, like a 12-bar blues. */
export interface ChordForm {
  id: string;
  label: string;
  /** Where `brightness` picks this form, 0 dark .. 1 bright. */
  brightness: number;
  /** One chord id per chord change. */
  sequence: readonly string[];
}

/**
 * Harmony for styles whose chords leave the key (blues, jazz): every chord
 * carries its own scale, and progressions follow forms.
 */
export interface ChordScales {
  /** Shown after the key's name, e.g. "C blues". */
  keyLabel: string;
  chords: readonly ChordDef[];
  forms: readonly ChordForm[];
  /** Chords tension may swap in, e.g. a tritone substitute for V7. */
  substitutions?: Record<string, readonly string[]>;
}

/**
 * The sound world of a style. Sensors decide everything inside it: which
 * machines play, the patterns, lengths, routings, timbres, key and mode.
 */
export interface Palette {
  /** Modes the genome chooses from; `brightness` moves within its choice. */
  modes: readonly ModeId[];
  /** Diatonic chord progression (ignored when `chordScales` is set). */
  progression: MarkovTable;
  /** Chords with their own scales and forms, for blues and jazz. */
  chordScales?: ChordScales;
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
  /** Effects this style may fire (default: all). */
  effects?: readonly FxId[];
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

/**
 * How a style drifts away from where it started, section after section.
 * Each weight scales one kind of change (1 = the default pace, 0 = never).
 */
export interface DriftProfile {
  /** Patterns: how many beats each section takes from a fresh take. */
  pattern: number;
  /** Sound: filters, timbre, decay, drive, sends walking. */
  sound: number;
  /** Harmony: the modes, chord rate and progression. */
  harmony: number;
  /** Rhythm: swing and track lengths. */
  rhythm: number;
  /** Phase: track speeds (polymeter against the beat). */
  phase: number;
  /** Instruments: another machine for a track, now and then. */
  machine: number;
  /** Motion: LFOs, chaos and routings. */
  motion: number;
  /** Per role, on top of `pattern`. */
  roles?: Partial<Record<TrackRole, number>>;
}

export const DEFAULT_DRIFT: DriftProfile = {
  pattern: 1,
  sound: 1,
  harmony: 1,
  rhythm: 1,
  phase: 1,
  machine: 1,
  motion: 1,
};

/** A style's drift, with the defaults for what it leaves out. */
export function driftOf(style: Pick<Style, 'drift'>): DriftProfile {
  return { ...DEFAULT_DRIFT, ...style.drift, roles: { ...style.drift?.roles } };
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
  /** Effects the genome may pick from per section, instead of `fx`. */
  fxPresets?: readonly FxConfig[];
  /** Style-specific mapping rules for the macros, layered over the defaults. */
  mapping?: Partial<MappingRules>;
  /** How the style drifts over time (default: `DEFAULT_DRIFT`). */
  drift?: Partial<DriftProfile>;
}
