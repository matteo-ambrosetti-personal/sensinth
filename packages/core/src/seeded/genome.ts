import { buildGenome, RHYTHMIC_ROLES, TIMBRAL, type Genome } from '../genome/genome';
import type { Fingerprint } from '../genome/fingerprint';
import { defaultMacros } from '../mapping/macros';
import {
  globalDest,
  sensorSource,
  trackDest,
  type Curve,
  type Route,
  type SensorFeature,
} from '../mod/matrix';
import type { GlobalParam, TrackParam } from '../mod/params';
import { Rng, hashInts, hashString } from '../random';
import type { TrackSpec } from '../seq/types';
import type { Timescale } from '../sensors/types';
import type { Style } from '../styles/schema';

/**
 * A genome written from the seed alone: the machines and track count come
 * from (seed, style), the patterns, routings and harmony settings from
 * (seed, section). No sensor reading takes part, so the same seed always
 * plays the same tracks, section after section.
 */
export function buildSeededGenome(style: Style, seed: number, section: number): Genome {
  const fp: Fingerprint = {
    channels: [],
    coarseHash: hashInts(seed, 0xc0a5e),
    fineHash: hashInts(seed, 0xf14e),
  };
  // Patterns are written a little busier than usual, then thinned out by
  // default, so inputs can both fill them in and thin them further.
  const macros = { ...defaultMacros(), energy: 0.75 };
  return buildGenome(style, fp, seededChain(seed, section), section, macros);
}

/** The hash a section is written from. */
export function seededChain(seed: number, section: number): number {
  return hashInts(seed, section, 0x5ec7);
}

/** What a channel moves, by how fast it changes: only things that answer smoothly. */
const STRUCTURAL: Record<Timescale, readonly string[]> = {
  fast: ['prob', 'decay', 'level', 'micro', 'retrig'],
  medium: ['prob', 'tune', 'micro', 'cutoff'],
  slow: ['g.swing', 'g.tension', 'g.brightness', 'prob'],
};

/**
 * A channel's two routes for one section, from (seed, section, channel id):
 * one changing what is played, one changing how it sounds. Adding or removing
 * a sensor never moves another sensor's routes. Curves are linear or
 * exponential, so a reading 2% higher always pushes its destination a little
 * further, never somewhere else.
 */
export function seededSensorRoutes(
  seed: number,
  section: number,
  channel: { id: string; timescale: Timescale; presses: boolean },
  tracks: readonly TrackSpec[],
): Route[] {
  const playing = tracks.filter((t) => t.role !== 'fx');
  if (playing.length === 0) return [];
  const rng = new Rng(hashInts(seed, section, hashString(channel.id)));
  const rhythmic = playing.filter((t) => RHYTHMIC_ROLES.includes(t.role));
  const pick = (pool: readonly TrackSpec[]) => rng.pick(pool.length > 0 ? pool : playing);
  const curve = (): Curve => (rng.chance(0.7) ? 'lin' : 'exp');
  const amount = () => (rng.chance(0.5) ? 1 : -1) * rng.range(0.45, 0.9);

  const kind = rng.pick(STRUCTURAL[channel.timescale]);
  const structural: SensorFeature =
    channel.timescale === 'fast'
      ? rng.chance(channel.presses ? 0.3 : 0.4)
        ? 'onset'
        : 'activity'
      : rng.chance(0.25)
        ? 'trend'
        : 'level';
  const track = pick(kind === 'prob' || kind === 'micro' || kind === 'retrig' ? rhythmic : playing);
  const dest = kind.startsWith('g.')
    ? globalDest(kind.slice(2) as GlobalParam)
    : trackDest(track.slot, kind as TrackParam);
  const other = playing.length > 1 ? pick(playing.filter((t) => t !== track)) : track;
  return [
    { source: sensorSource(channel.id, structural), dest, amount: amount(), curve: curve() },
    {
      source: sensorSource(channel.id, channel.timescale === 'fast' ? 'activity' : 'level'),
      dest: trackDest(other.slot, rng.pick(TIMBRAL)),
      amount: amount(),
      curve: curve(),
    },
  ];
}
