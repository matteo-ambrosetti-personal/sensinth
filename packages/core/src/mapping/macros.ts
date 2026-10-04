/**
 * Sensor-agnostic musical controls, each 0..1. Sensors drive macros; the
 * composer and the synth read only macros, never raw sensors.
 */
export const MACROS = [
  'energy',
  'tension',
  'brightness',
  'space',
  'variation',
  'texture',
  'register',
  'color',
] as const;

export type MacroId = (typeof MACROS)[number];
export type Macros = Record<MacroId, number>;

export interface MacroInfo {
  description: string;
  /** Value used when no sensor drives the macro. */
  fallback: number;
  /** Seconds to glide toward a new target, so sound changes stay smooth. */
  slewTau: number;
}

export const MACRO_INFO: Record<MacroId, MacroInfo> = {
  energy: { description: 'Note density, drum intensity, velocity', fallback: 0.5, slewTau: 1.5 },
  tension: { description: 'Chord choice: tense vs. resolved', fallback: 0.4, slewTau: 4 },
  brightness: { description: 'Mode (Lydian to Phrygian) and filter', fallback: 0.6, slewTau: 3 },
  space: { description: 'Reverb and delay amount', fallback: 0.4, slewTau: 6 },
  variation: { description: 'How much repeats mutate; fills', fallback: 0.3, slewTau: 4 },
  texture: { description: 'Timbre: pulse width, harmonics', fallback: 0.5, slewTau: 1 },
  register: { description: 'Melody height', fallback: 0.5, slewTau: 1.5 },
  color: { description: 'Harmonic color; key modulation', fallback: 0.5, slewTau: 5 },
};

export function defaultMacros(): Macros {
  const m = {} as Macros;
  for (const id of MACROS) m[id] = MACRO_INFO[id].fallback;
  return m;
}

/** Discrete one-shot requests raised by sensor onsets; honored on the next grid slot. */
export interface Triggers {
  /** Extra percussive hit / accent, strength 0..1 (0 = none). */
  accent: number;
  /** Drum fill at the end of the current bar, strength 0..1 (0 = none). */
  fill: number;
}

export type TriggerId = keyof Triggers;

export function noTriggers(): Triggers {
  return { accent: 0, fill: 0 };
}
