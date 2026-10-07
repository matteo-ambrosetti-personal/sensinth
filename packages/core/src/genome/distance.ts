import { clamp, mod } from '../math';
import { TRACK_PARAMS } from '../mod/params';
import type { TrackRole, TrackSpec } from '../seq/types';
import type { HarmonyGenes } from './genome';

/** What the distance looks at: a genome, or a deterministic song. */
export interface GenomeShape {
  tracks: readonly TrackSpec[];
  harmony: HarmonyGenes;
}

/** The key a piece was in. */
export interface KeyState {
  root: number;
  mode: string;
}

export interface TrackDistance {
  slot: string;
  role: TrackRole;
  machine: string;
  /** 0 the same track .. 1 another track altogether. */
  value: number;
  /** The track is in `a` only: it has gone. */
  gone?: boolean;
}

export interface GenomeDistance {
  /** 0 the same music .. 1 nothing in common. */
  total: number;
  /** How far the harmony moved, 0..1. */
  harmony: number;
  /** Every track of either genome, `b`'s first, in slot order. */
  tracks: TrackDistance[];
}

/** 16th steps unrolled to compare patterns of any length and speed. */
const GRID = 64;
/** Base params change by small walks: this scales their mean difference to 0..1. */
const PARAM_GAIN = 3;

/** Which 16th steps of an unrolled grid a track plays a trig on, and the trigs. */
function unroll(t: TrackSpec): (TrackSpec['trigs'][number] | undefined)[] {
  const n = Math.max(1, t.length);
  const out: (TrackSpec['trigs'][number] | undefined)[] = [];
  for (let g = 0; g < GRID; g++) out.push(t.trigs[Math.floor(g * t.scale) % n]);
  return out;
}

/** How different two patterns sound: where they play (Jaccard), and what notes. */
function patternDistance(a: TrackSpec, b: TrackSpec): number {
  const ua = unroll(a);
  const ub = unroll(b);
  let union = 0;
  let both = 0;
  let notes = 0;
  for (let g = 0; g < GRID; g++) {
    const x = ua[g];
    const y = ub[g];
    if (!x && !y) continue;
    union++;
    if (x && y) {
      both++;
      const nx = x.note;
      const ny = y.note;
      if (nx && ny && (nx.tone !== ny.tone || nx.oct !== ny.oct || nx.chord !== ny.chord)) notes++;
    }
  }
  if (union === 0) return 0;
  const where = 1 - both / union;
  const what = both > 0 ? notes / both : 0;
  return clamp(0.7 * where + 0.3 * what);
}

function trackDistance(a: TrackSpec, b: TrackSpec): number {
  if (a.role !== b.role) return 1;
  const machine = a.machine === b.machine ? 0 : 1;
  const shape = (a.length === b.length ? 0 : 0.5) + (a.scale === b.scale ? 0 : 0.5);
  let params = 0;
  for (const p of TRACK_PARAMS) params += Math.abs(a.base[p] - b.base[p]);
  params = clamp((PARAM_GAIN * params) / TRACK_PARAMS.length);
  return clamp(0.3 * machine + 0.4 * patternDistance(a, b) + 0.1 * shape + 0.2 * params);
}

/** Steps around the circle of fifths between two keys, 0..6. */
function fifthsApart(a: number, b: number): number {
  const steps = mod((mod(b - a, 12) * 7) % 12, 12);
  return Math.min(steps, 12 - steps);
}

function harmonyDistance(a: HarmonyGenes, b: HarmonyGenes, keys?: { a: KeyState; b: KeyState }) {
  const parts: number[] = [];
  const ma = new Set<string>([...a.modes, ...a.forms]);
  const mb = new Set<string>([...b.modes, ...b.forms]);
  const union = new Set([...ma, ...mb]);
  let shared = 0;
  for (const m of ma) if (mb.has(m)) shared++;
  parts.push(union.size === 0 ? 0 : 1 - shared / union.size);
  const n = Math.min(a.progressionBias.length, b.progressionBias.length);
  let bias = 0;
  for (let i = 0; i < n; i++) {
    bias += Math.abs((a.progressionBias[i] ?? 1) - (b.progressionBias[i] ?? 1));
  }
  parts.push(n > 0 ? clamp(bias / n / 1.4) : 0);
  parts.push(a.chordRateBars === b.chordRateBars ? 0 : 1);
  if (keys) {
    parts.push(fifthsApart(keys.a.root, keys.b.root) / 6);
    parts.push(keys.a.mode === keys.b.mode ? 0 : 1);
  }
  return parts.reduce((x, y) => x + y, 0) / parts.length;
}

/**
 * How far one genome is from another: per track (matched by slot; a slot
 * that holds another kind of track, or a track only one of them has, counts
 * as 1), and overall, with the harmony. The FX lane is left out. Symmetric,
 * 0 for a genome against itself.
 */
export function genomeDistance(
  a: GenomeShape,
  b: GenomeShape,
  keys?: { a: KeyState; b: KeyState },
): GenomeDistance {
  const playing = (g: GenomeShape) => g.tracks.filter((t) => t.role !== 'fx');
  const before = new Map(playing(a).map((t) => [t.slot, t]));
  const after = playing(b);
  const tracks: TrackDistance[] = after.map((t) => {
    const prev = before.get(t.slot);
    return {
      slot: t.slot,
      role: t.role,
      machine: t.machine,
      value: prev ? trackDistance(prev, t) : 1,
    };
  });
  const present = new Set(after.map((t) => t.slot));
  for (const t of playing(a)) {
    if (!present.has(t.slot)) {
      tracks.push({ slot: t.slot, role: t.role, machine: t.machine, value: 1, gone: true });
    }
  }
  const harmony = harmonyDistance(a.harmony, b.harmony, keys);
  const mean = tracks.length > 0 ? tracks.reduce((s, t) => s + t.value, 0) / tracks.length : 0;
  return { total: clamp(0.75 * mean + 0.25 * harmony), harmony, tracks };
}
