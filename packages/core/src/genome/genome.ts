import { FX_IDS, KIND_FX, type FxId } from '../fx/effects';
import type { Macros } from '../mapping/macros';
import { clamp } from '../math';
import {
  CURVES,
  chaosDest,
  envSource,
  globalDest,
  lfoDest,
  lfoSource,
  macroSource,
  sensorSource,
  chaosSource,
  trackDest,
  type Curve,
  type MatrixSpec,
  type Route,
  type SensorFeature,
} from '../mod/matrix';
import type { TrackParam } from '../mod/params';
import { Rng, hashInts, hashString } from '../random';
import { fxLane, generateTrack } from '../seq/generate';
import type { TrackRole, TrackSpec } from '../seq/types';
import type { Timescale } from '../sensors/types';
import type { FxConfig, Palette, Style } from '../styles/schema';
import { byBrightness, type ModeId } from '../theory/scales';
import type { ChannelPrint, Fingerprint } from './fingerprint';

export interface HarmonyGenes {
  /** Modes to move between, darkest first; `brightness` picks one. */
  modes: ModeId[];
  /** Forms to choose from (chord-scale palettes); `brightness` picks one. */
  forms: string[];
  chordRateBars: number;
  /** Multiplier on the chance of moving to each scale degree's chord. */
  progressionBias: number[];
}

/**
 * Everything the sensors decided for one section: the tracks (machines,
 * lengths, speeds, patterns, base params), the modulation matrix, harmony
 * settings and swing.
 */
export interface Genome {
  /** Link of the hash chain this genome was built from. */
  chain: number;
  coarseHash: number;
  section: number;
  tracks: TrackSpec[];
  matrix: MatrixSpec;
  harmony: HarmonyGenes;
  /** Swing 0..1 inside the palette's range, before modulation. */
  swing: number;
  /** Pattern density 0..1 chosen for this section. */
  density: number;
  /** Effects for this section, when the style offers several (Free). */
  fx?: FxConfig;
  /** Which effect each fast sensor's events fire. */
  fxTriggers: FxTrigger[];
}

/** A sensor whose events (onsets) fire an effect on the whole mix. */
export interface FxTrigger {
  channelId: string;
  fx: FxId;
}

/**
 * Next link of the hash chain. It folds in the previous link, so even a
 * sensor reading that never changes gives a new genome every section, and a
 * replayed recording gives the same chain.
 */
export function nextChain(prev: number, fp: Fingerprint, section: number): number {
  return hashInts(prev, fp.coarseHash, section);
}

/** First link: everything about the sensors at the moment the music starts. */
export function firstChain(seed: number, fp: Fingerprint): number {
  return hashInts(seed, fp.coarseHash, fp.fineHash);
}

/** Minimum strength of a route from a sensor, so every sensor is clearly audible. */
export const SENSOR_ROUTE_MIN = 0.4;

export function buildGenome(
  style: Style,
  fp: Fingerprint,
  chain: number,
  section: number,
  macros: Readonly<Macros>,
): Genome {
  const { palette } = style;
  // Machines and track count depend only on the coarse fingerprint: they stay
  // while the sensors stay roughly where they are, and change with the place,
  // the light, the colours or the set of sensors.
  const structure = new Rng(hashInts(fp.coarseHash, hashString(style.id)));
  const slots = chooseMachines(palette, structure);
  const rng = new Rng(chain);

  const density = clamp(0.3 + 0.5 * macros.energy + rng.range(-0.2, 0.2));
  const tracks = slots.map(({ slot, machineId }) =>
    generateTrack(rng.fork(slot), {
      slot,
      machineId,
      machine: palette.machines[machineId] as NonNullable<Palette['machines'][string]>,
      palette,
      density: clamp(density + rng.range(-0.25, 0.25)),
    }),
  );

  const effects = palette.effects ?? FX_IDS;
  const fxTrack =
    effects.length > 0 ? fxLane(rng.fork('fx'), effects, palette.lfoPeriod) : undefined;
  const modeCount = Math.min(palette.modes.length, rng.int(2, 3));
  const modes = byBrightness(shuffle(rng, palette.modes).slice(0, modeCount));
  const allForms = palette.chordScales?.forms ?? [];
  const forms =
    allForms.length === 0
      ? []
      : shuffle(rng, allForms)
          .slice(0, rng.int(Math.ceil(allForms.length / 2), allForms.length))
          .map((f) => f.id);
  return {
    chain,
    coarseHash: fp.coarseHash,
    section,
    tracks: fxTrack ? [...tracks, fxTrack] : tracks,
    matrix: {
      routes: buildRoutes(rng.fork('routes'), fp, tracks),
      lfos: Object.fromEntries(tracks.map((t) => [t.slot, t.lfo])),
      chaos: {
        a: { start: (fp.fineHash % 9973) / 9973, r: rng.range(0.3, 0.95) },
        b: { start: (hashInts(fp.fineHash, 7) % 9967) / 9967, r: rng.range(0.3, 0.95) },
      },
    },
    harmony: {
      modes,
      forms,
      chordRateBars: rng.pick(palette.chordRates),
      progressionBias: Array.from({ length: 7 }, () => rng.range(0.4, 1.8)),
    },
    swing: rng.next(),
    density,
    fxTriggers: fxTriggers(fp, chain, effects),
    ...(style.fxPresets && style.fxPresets.length > 0
      ? { fx: style.fxPresets[hashInts(chain, 0xf0) % style.fxPresets.length] as FxConfig }
      : {}),
  };
}

/** Fast sensors (and the lid) fire effects: the kind's own effect when the style allows it. */
function fxTriggers(fp: Fingerprint, chain: number, effects: readonly FxId[]): FxTrigger[] {
  if (effects.length === 0) return [];
  return fp.channels
    .filter((ch) => ch.timescale === 'fast' || ch.kind in KIND_FX)
    .map((ch) => {
      const own = KIND_FX[ch.kind];
      const fx =
        own && effects.includes(own)
          ? own
          : (effects[hashInts(hashString(ch.kind), chain) % effects.length] as FxId);
      return { channelId: ch.id, fx };
    });
}

function chooseMachines(palette: Palette, rng: Rng): { slot: string; machineId: string }[] {
  const [lo, hi] = palette.trackCount;
  const count = rng.int(lo, hi);
  const chosen = palette.slots.filter((s) => s.required);
  const pool = palette.slots.filter((s) => !s.required);
  while (chosen.length < count && pool.length > 0) {
    const i = rng.weightedIndex(pool.map((s) => s.weight ?? 1));
    chosen.push(...pool.splice(i, 1));
  }
  // Keep the palette's order so the tracks list reads drums first, then bass, …
  chosen.sort((a, b) => palette.slots.indexOf(a) - palette.slots.indexOf(b));
  return chosen.map((s, i) => ({ slot: `t${i + 1}`, machineId: rng.pick(s.machines) }));
}

/** Destination kinds a sensor drives, by how fast it changes. */
const STRUCTURAL: Record<Timescale, readonly string[]> = {
  fast: ['prob', 'retrig', 'decay', 'level', 'micro'],
  medium: ['prob', 'tune', 'micro', 'lfo.rate', 'retrig'],
  slow: ['chaos', 'g.swing', 'g.tension', 'lfo.rate', 'prob'],
};
const TIMBRAL: readonly TrackParam[] = [
  'cutoff',
  'timbre',
  'drive',
  'reso',
  'pan',
  'sendReverb',
  'sendDelay',
  'decay',
  'attack',
];
const RHYTHMIC_ROLES: readonly TrackRole[] = ['drum', 'bass', 'lead', 'arp', 'chords'];
const CURVE_WEIGHTS = [0.5, 0.2, 0.15, 0.15];

/**
 * Writes the modulation matrix. Every live sensor gets at least two strong
 * routes, one changing what is played and one changing how it sounds, on
 * tracks the genome picks; LFOs, chaos maps, trig envelopes and macros add
 * internal routes, some of them in feedback loops.
 */
export function buildRoutes(rng: Rng, fp: Fingerprint, tracks: readonly TrackSpec[]): Route[] {
  const routes: Route[] = [];
  if (tracks.length === 0) return routes;
  const rhythmic = tracks.filter((t) => RHYTHMIC_ROLES.includes(t.role));
  const pickTrack = (pool: readonly TrackSpec[]) => rng.pick(pool.length > 0 ? pool : tracks);
  const curve = (): Curve => CURVES[rng.weightedIndex(CURVE_WEIGHTS)] as Curve;
  const strong = () => rng.range(SENSOR_ROUTE_MIN + 0.05, 0.9);

  for (const ch of fp.channels) {
    const [f1, f2] = featuresFor(rng, ch);
    // Structural: what is played.
    const kind = rng.pick(STRUCTURAL[ch.timescale]);
    const track = pickTrack(
      kind === 'prob' || kind === 'retrig' || kind === 'micro' ? rhythmic : tracks,
    );
    const positive = ch.timescale === 'fast' && (kind === 'prob' || kind === 'level');
    const sign = positive ? (rng.chance(0.75) ? 1 : -1) : rng.chance(0.5) ? 1 : -1;
    routes.push({
      source: sensorSource(ch.id, f1),
      dest: structuralDest(rng, kind, track.slot),
      amount: sign * strong(),
      curve: curve(),
    });
    // Timbral: how it sounds, on another track when there is one.
    const other = tracks.length > 1 ? pickTrack(tracks.filter((t) => t !== track)) : track;
    routes.push({
      source: sensorSource(ch.id, f2),
      dest: trackDest(other.slot, rng.pick(TIMBRAL)),
      amount: (rng.chance(0.5) ? 1 : -1) * strong(),
      curve: curve(),
    });
    // The finest grain: the digits of the reading nudge one more thing.
    if (rng.chance(0.5)) {
      routes.push({
        source: sensorSource(ch.id, 'jitter'),
        dest: trackDest(
          pickTrack(tracks).slot,
          rng.pick<TrackParam>(['micro', 'timbre', 'pan', 'cutoff']),
        ),
        amount: (rng.chance(0.5) ? 1 : -1) * rng.range(0.08, 0.25),
        curve: 'lin',
      });
    }
  }

  // Each track's LFO moves one of its own params.
  for (const t of tracks) {
    routes.push({
      source: lfoSource(t.slot),
      dest: trackDest(
        t.slot,
        rng.pick<TrackParam>(['cutoff', 'timbre', 'pan', 'sendDelay', 'decay', 'reso']),
      ),
      amount: (rng.chance(0.5) ? 1 : -1) * rng.range(0.15, 0.5),
      curve: 'lin',
    });
  }
  if (tracks.length >= 2) {
    // A feedback loop: LFO A bends LFO B's rate, LFO B bends LFO A's depth.
    const [a, b] = shuffle(rng, tracks).slice(0, 2) as [TrackSpec, TrackSpec];
    routes.push({
      source: lfoSource(a.slot),
      dest: lfoDest(b.slot, 'rate'),
      amount: (rng.chance(0.5) ? 1 : -1) * rng.range(0.3, 0.7),
      curve: 'lin',
    });
    routes.push({
      source: lfoSource(b.slot),
      dest: lfoDest(a.slot, 'depth'),
      amount: (rng.chance(0.5) ? 1 : -1) * rng.range(0.2, 0.5),
      curve: curve(),
    });
    // One track's hits shape another: ducking or a filter pluck.
    const drums = tracks.filter((t) => t.role === 'drum');
    const src = pickTrack(drums);
    const dst = pickTrack(tracks.filter((t) => t !== src));
    const duck = rng.chance(0.5);
    routes.push({
      source: envSource(src.slot),
      dest: trackDest(dst.slot, duck ? 'level' : 'cutoff'),
      amount: duck ? -rng.range(0.2, 0.45) : (rng.chance(0.5) ? 1 : -1) * rng.range(0.25, 0.6),
      curve: 'lin',
    });
  }
  // Chaos: one map thins or fills a pattern, the other perturbs a sound.
  routes.push({
    source: chaosSource('a'),
    dest: trackDest(pickTrack(rhythmic).slot, 'prob'),
    amount: (rng.chance(0.5) ? 1 : -1) * rng.range(0.2, 0.5),
    curve: curve(),
  });
  routes.push({
    source: chaosSource('b'),
    dest: trackDest(
      pickTrack(tracks).slot,
      rng.pick<TrackParam>(['timbre', 'tune', 'micro', 'cutoff']),
    ),
    amount: (rng.chance(0.5) ? 1 : -1) * rng.range(0.15, 0.4),
    curve: 'lin',
  });
  // The dials still act: register moves melodies, texture timbre, energy density.
  const melodic = tracks.filter((t) => t.role === 'lead' || t.role === 'arp');
  for (const t of melodic) {
    routes.push({
      source: macroSource('register'),
      dest: trackDest(t.slot, 'tune'),
      amount: 0.6,
      curve: 'lin',
    });
  }
  const tonal = tracks.filter((t) => t.role !== 'drum');
  routes.push({
    source: macroSource('texture'),
    dest: trackDest(pickTrack(tonal).slot, 'timbre'),
    amount: rng.range(0.4, 0.6),
    curve: 'lin',
  });
  routes.push({
    source: macroSource('energy'),
    dest: trackDest(pickTrack(rhythmic).slot, 'prob'),
    amount: rng.range(0.3, 0.6),
    curve: 'lin',
  });
  routes.push({
    source: macroSource('variation'),
    dest: globalDest('fx'),
    amount: 0.5,
    curve: 'lin',
  });
  routes.push({
    source: macroSource('variation'),
    dest: trackDest(pickTrack(tracks.filter((t) => t.role === 'drum')).slot, 'retrig'),
    amount: rng.range(0.3, 0.5),
    curve: 'lin',
  });
  return routes;
}

function featuresFor(rng: Rng, ch: ChannelPrint): [SensorFeature, SensorFeature] {
  switch (ch.timescale) {
    case 'fast':
      return [rng.chance(0.3) ? 'onset' : 'activity', 'activity'];
    case 'medium':
      return [rng.chance(0.25) ? 'trend' : 'level', 'level'];
    case 'slow':
      return ['level', 'level'];
  }
}

function structuralDest(rng: Rng, kind: string, slot: string): string {
  switch (kind) {
    case 'lfo.rate':
      return lfoDest(slot, 'rate');
    case 'chaos':
      return chaosDest(rng.chance(0.5) ? 'a' : 'b');
    case 'g.swing':
      return globalDest('swing');
    case 'g.tension':
      return globalDest('tension');
    default:
      return trackDest(slot, kind as TrackParam);
  }
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
