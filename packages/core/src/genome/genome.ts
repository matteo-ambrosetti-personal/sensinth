import { FX_IDS, KIND_FX, type FxId } from '../fx/effects';
import type { Macros } from '../mapping/macros';
import { AREAS, domainOf, partitionAreas, type Area, type Partition } from '../mapping/partition';
import { DEFAULT_MAPPING, mergeRules } from '../mapping/rules';
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
import { cloneTrack, type TrackRole, type TrackSpec } from '../seq/types';
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
  /** The areas each live channel controls (see `partitionAreas`). */
  ownership: Record<string, Area[]>;
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

/** The partition of a fingerprint's channels by the style's rules. */
export function partitionOf(style: Style, fp: Fingerprint, prev?: Partition): Partition {
  return partitionAreas(fp.channels, mergeRules(DEFAULT_MAPPING, style.mapping), prev);
}

export function buildGenome(
  style: Style,
  fp: Fingerprint,
  chain: number,
  section: number,
  macros: Readonly<Macros>,
  partition: Partition = partitionOf(style, fp),
): Genome {
  const { palette } = style;
  // Machines and track count depend only on the coarse fingerprint: they stay
  // while the sensors stay roughly where they are, and change with the place,
  // the light, the colours or the set of sensors.
  const structure = new Rng(hashInts(fp.coarseHash, hashString(style.id)));
  const slots = chooseMachines(palette, structure);
  const rng = new Rng(chain);

  const density = clamp(0.3 + 0.5 * macros.energy + rng.range(-0.2, 0.2));
  const tracks = slots.map(({ slot, machineId, option }) =>
    generateTrack(rng.fork(slot), {
      slot,
      machineId,
      machine: palette.machines[machineId] as NonNullable<Palette['machines'][string]>,
      palette,
      density: clamp(density + rng.range(-0.25, 0.25)),
      option,
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
      routes: buildRoutes(rng.fork('routes'), fp, tracks, partition),
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
    fxTriggers: fxTriggers(fp.channels, chain, effects, partition),
    ownership: ownershipOf(fp, partition),
    ...(style.fxPresets && style.fxPresets.length > 0
      ? { fx: style.fxPresets[hashInts(chain, 0xf0) % style.fxPresets.length] as FxConfig }
      : {}),
  };
}

function ownershipOf(fp: Fingerprint, partition: Partition): Record<string, Area[]> {
  return Object.fromEntries(
    fp.channels.map((c) => [c.id, [...(partition.channels[c.id] ?? AREAS)]]),
  );
}

/** Copies a genome, so evolving or mutating the copy leaves the original as it was. */
export function cloneGenome(g: Genome): Genome {
  return {
    ...g,
    tracks: g.tracks.map(cloneTrack),
    matrix: {
      routes: g.matrix.routes.map((r) => ({ ...r })),
      lfos: Object.fromEntries(Object.entries(g.matrix.lfos).map(([k, v]) => [k, { ...v }])),
      chaos: { a: { ...g.matrix.chaos.a }, b: { ...g.matrix.chaos.b } },
    },
    harmony: {
      ...g.harmony,
      modes: [...g.harmony.modes],
      forms: [...g.harmony.forms],
      progressionBias: [...g.harmony.progressionBias],
    },
    fxTriggers: g.fxTriggers.map((t) => ({ ...t })),
    ownership: Object.fromEntries(Object.entries(g.ownership).map(([k, v]) => [k, [...v]])),
    ...(g.fx ? { fx: { ...g.fx } } : {}),
  };
}

/**
 * Effects fired by sensor events, from the channels that control the
 * effects area: a fast one (or the lid, a cover…) fires its kind's own
 * effect when the style allows it, else one the chain picks.
 */
export function fxTriggers(
  channels: readonly Pick<ChannelPrint, 'id' | 'kind' | 'timescale'>[],
  chain: number,
  effects: readonly FxId[],
  partition?: Partition,
): FxTrigger[] {
  if (effects.length === 0) return [];
  const owners = new Set(partition ? partition.owners['space.fx'] : channels.map((c) => c.id));
  const eventful = (ch: Pick<ChannelPrint, 'kind' | 'timescale'>) =>
    ch.timescale === 'fast' || Object.hasOwn(KIND_FX, ch.kind);
  let chosen = channels.filter((ch) => owners.has(ch.id) && eventful(ch));
  // No owner with events of its own: the owner best suited, if it is not a slow one.
  if (chosen.length === 0 && partition) {
    const best = channels.find((c) => c.id === partition.owners['space.fx'][0]);
    chosen = best && best.timescale !== 'slow' ? [best] : [];
  }
  return chosen.map((ch) => {
    const own = Object.hasOwn(KIND_FX, ch.kind) ? KIND_FX[ch.kind] : undefined;
    const fx =
      own && effects.includes(own)
        ? own
        : (effects[hashInts(hashString(ch.kind), chain) % effects.length] as FxId);
    return { channelId: ch.id, fx };
  });
}

function chooseMachines(
  palette: Palette,
  rng: Rng,
): { slot: string; machineId: string; option: number }[] {
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
  return chosen.map((s, i) => ({
    slot: `t${i + 1}`,
    machineId: rng.pick(s.machines),
    option: palette.slots.indexOf(s),
  }));
}

const RHYTHMIC_ROLES: readonly TrackRole[] = ['drum', 'bass', 'lead', 'arp', 'chords'];
const CURVE_WEIGHTS = [0.5, 0.2, 0.15, 0.15];
/** Most a sensor route may move, for sensors with many areas (so one sensor alone stays musical). */
const WIDE_ROUTE_MAX = 0.7;

/** Track params and global destinations that read better pushed up than pulled down by a fast sensor. */
const UPWARD = new Set(['prob', 'level', 'retrig']);

/**
 * One destination in an area, on the tracks there are: the drums' hits, the
 * groove, the chords' tension, the melody's register, the sound of the drums
 * or of the tonal tracks, the room, the effects, the LFOs, the form. Undefined
 * when the area has nothing to move (no drums for the drums' areas, no lead
 * or arp for the melody).
 */
export function areaDest(rng: Rng, area: Area, tracks: readonly TrackSpec[]): string | undefined {
  const of = (roles: readonly TrackRole[]) => tracks.filter((t) => roles.includes(t.role));
  const drums = of(['drum']);
  const tonal = tracks.filter((t) => t.role !== 'drum');
  const melody = of(['lead', 'arp']);
  const pick = (pool: readonly TrackSpec[]) => (pool.length > 0 ? rng.pick(pool).slot : undefined);
  const on = (pool: readonly TrackSpec[], param: TrackParam) => {
    const slot = pick(pool);
    return slot === undefined ? undefined : trackDest(slot, param);
  };
  switch (area) {
    case 'rhythm.drums':
      return on(drums, rng.pick<TrackParam>(['prob', 'prob', 'retrig', 'micro']));
    case 'rhythm.groove': {
      const groove = of(['bass', 'chords']);
      return rng.chance(0.35) || groove.length === 0
        ? globalDest('swing')
        : on(groove, rng.pick<TrackParam>(['prob', 'micro']));
    }
    case 'harmony.chords': {
      const chordal = of(['chords', 'pad', 'bass', 'drone']);
      return rng.chance(0.6) || chordal.length === 0 ? globalDest('tension') : on(chordal, 'tune');
    }
    case 'harmony.melody':
      return on(melody, rng.pick<TrackParam>(['tune', 'prob', 'micro']));
    case 'sound.drums':
      return on(drums, rng.pick<TrackParam>(['cutoff', 'decay', 'tune', 'drive', 'timbre']));
    case 'sound.tonal':
      return on(
        tonal,
        rng.pick<TrackParam>(['cutoff', 'timbre', 'drive', 'reso', 'attack', 'decay']),
      );
    case 'space.room':
      return rng.chance(0.3)
        ? globalDest('space')
        : on(tracks, rng.pick<TrackParam>(['sendReverb', 'sendDelay']));
    case 'space.fx':
      return rng.chance(0.4) ? globalDest('fx') : on(tracks, 'pan');
    case 'motion.lfo':
      return rng.chance(0.3)
        ? chaosDest(rng.chance(0.5) ? 'a' : 'b')
        : lfoDest(rng.pick(tracks).slot, rng.chance(0.6) ? 'rate' : 'depth');
    case 'motion.form':
      return on(tracks, 'level');
  }
}

/** Fine destinations for a sensor's raw digits, by area: which tracks, which params. */
const JITTER: Partial<
  Record<Area, { roles?: readonly TrackRole[]; params: readonly TrackParam[] }>
> = {
  'rhythm.drums': { roles: ['drum'], params: ['micro'] },
  'rhythm.groove': { roles: ['bass', 'chords'], params: ['micro'] },
  'harmony.melody': { roles: ['lead', 'arp'], params: ['micro'] },
  'sound.drums': { roles: ['drum'], params: ['timbre', 'cutoff'] },
  'sound.tonal': {
    roles: ['bass', 'lead', 'arp', 'chords', 'pad', 'drone'],
    params: ['timbre', 'cutoff'],
  },
  'space.fx': { params: ['pan'] },
};

/**
 * Writes the modulation matrix. Every live sensor gets one strong route per
 * area it controls (at least two, to different places): a sensor alone
 * moves everything, several each move their own part. A channel's routes
 * come from its own stream, so another sensor joining does not move them.
 * LFOs, chaos maps, trig envelopes and macros add internal routes, some of
 * them in feedback loops.
 */
export function buildRoutes(
  rng: Rng,
  fp: Fingerprint,
  tracks: readonly TrackSpec[],
  partition?: Partition,
): Route[] {
  const routes: Route[] = [];
  if (tracks.length === 0) return routes;
  const rhythmic = tracks.filter((t) => RHYTHMIC_ROLES.includes(t.role));
  const pickTrack = (pool: readonly TrackSpec[]) => rng.pick(pool.length > 0 ? pool : tracks);
  const curve = (r: Rng = rng): Curve => CURVES[r.weightedIndex(CURVE_WEIGHTS)] as Curve;
  const salt = rng.int(0, 2 ** 31 - 1);

  for (const ch of fp.channels) {
    const r = new Rng(hashInts(salt, hashString(ch.id)));
    const areas = partition?.channels[ch.id] ?? AREAS;
    const hi = areas.length > 4 ? WIDE_ROUTE_MAX : 0.9;
    const strong = () => r.range(SENSOR_ROUTE_MIN + 0.05, hi);
    const [f1, f2] = featuresFor(r, ch);
    const dests = new Set<string>();
    const add = (area: Area, feature: SensorFeature) => {
      let dest = areaDest(r, area, tracks);
      for (let tries = 0; dest !== undefined && dests.has(dest) && tries < 4; tries++) {
        dest = areaDest(r, area, tracks);
      }
      if (dest === undefined || dests.has(dest)) return;
      dests.add(dest);
      const param = dest.slice(dest.lastIndexOf('.') + 1);
      const up = ch.timescale === 'fast' && UPWARD.has(param);
      const sign = up ? (r.chance(0.75) ? 1 : -1) : r.chance(0.5) ? 1 : -1;
      routes.push({
        source: sensorSource(ch.id, feature),
        dest,
        amount: sign * strong(),
        curve: curve(r),
      });
    };
    areas.forEach((area, i) => add(area, i === 0 ? f1 : f2));
    // At least two strong routes: more in its own areas, else the rest of its domains, else anywhere.
    const domains = new Set(areas.map(domainOf));
    const wider = AREAS.filter((a) => domains.has(domainOf(a)));
    for (const pool of [areas, wider, AREAS]) {
      for (let guard = 0; dests.size < 2 && guard < 8; guard++) add(r.pick(pool), f2);
    }
    // The finest grain: the digits of the reading nudge one more thing, in its own areas.
    const fine = areas.flatMap((a) => {
      const j = JITTER[a];
      const pool = j ? tracks.filter((t) => !j.roles || j.roles.includes(t.role)) : [];
      return j && pool.length > 0 ? [{ pool, params: j.params }] : [];
    });
    if (fine.length > 0 && r.chance(0.5)) {
      const { pool, params } = r.pick(fine);
      routes.push({
        source: sensorSource(ch.id, 'jitter'),
        dest: trackDest(r.pick(pool).slot, r.pick(params)),
        amount: (r.chance(0.5) ? 1 : -1) * r.range(0.08, 0.25),
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

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
