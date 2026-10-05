/**
 * Parameters of one track, each normalized to 0..1. The genome sets a base
 * value, trigs can lock a value for one step (p-locks), and the modulation
 * matrix adds offsets on top. The renderer maps them to physical units.
 */
export const TRACK_PARAMS = [
  'level',
  'pan',
  'cutoff',
  'reso',
  'drive',
  'decay',
  'attack',
  'timbre',
  'tune',
  'prob',
  'retrig',
  'micro',
  'sendReverb',
  'sendDelay',
] as const;

export type TrackParam = (typeof TRACK_PARAMS)[number];
export type TrackParams = Record<TrackParam, number>;

export interface ParamInfo {
  label: string;
  /** Three-letter label for compact views. */
  short: string;
  /** Neutral value; also where a track starts when its machine sets no range. */
  neutral: number;
  /** Range the genome draws a base value from, unless the machine overrides it. */
  base: [number, number];
}

export const PARAM_INFO: Record<TrackParam, ParamInfo> = {
  level: { label: 'Level', short: 'LVL', neutral: 0.5, base: [0.45, 0.55] },
  pan: { label: 'Pan', short: 'PAN', neutral: 0.5, base: [0.3, 0.7] },
  cutoff: { label: 'Filter cutoff', short: 'CUT', neutral: 0.8, base: [0.6, 0.95] },
  reso: { label: 'Resonance', short: 'RES', neutral: 0.15, base: [0.05, 0.35] },
  drive: { label: 'Drive', short: 'DRV', neutral: 0.1, base: [0, 0.3] },
  decay: { label: 'Decay', short: 'DEC', neutral: 0.5, base: [0.35, 0.65] },
  attack: { label: 'Attack', short: 'ATK', neutral: 0.5, base: [0.4, 0.6] },
  timbre: { label: 'Timbre', short: 'TMB', neutral: 0.5, base: [0.2, 0.8] },
  tune: { label: 'Tune / register', short: 'TUN', neutral: 0.5, base: [0.35, 0.65] },
  prob: { label: 'Trig probability', short: 'PRB', neutral: 0.5, base: [0.5, 0.5] },
  retrig: { label: 'Retrig', short: 'RTG', neutral: 0.5, base: [0.5, 0.5] },
  micro: { label: 'Micro timing', short: 'MIC', neutral: 0.5, base: [0.5, 0.5] },
  sendReverb: { label: 'Reverb send', short: 'REV', neutral: 0.25, base: [0.1, 0.4] },
  sendDelay: { label: 'Delay send', short: 'DLY', neutral: 0.15, base: [0, 0.3] },
};

export function neutralParams(): TrackParams {
  const p = {} as TrackParams;
  for (const id of TRACK_PARAMS) p[id] = PARAM_INFO[id].neutral;
  return p;
}

/** Song-wide destinations of the modulation matrix. */
export const GLOBAL_PARAMS = ['tension', 'brightness', 'swing', 'space', 'fx'] as const;
export type GlobalParam = (typeof GLOBAL_PARAMS)[number];
export type GlobalParams = Record<GlobalParam, number>;

/**
 * Effective probability of a trig: the track's `prob` param scales the
 * trig's own probability from ×0.25 (sparse) to ×1.75, so modulation can thin
 * a pattern out or fill in its uncertain trigs but never silences a track.
 */
export function effectiveProbability(trigProb: number, probParam: number): number {
  const p = trigProb * (0.25 + 1.5 * probParam);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
