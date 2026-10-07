import { destArea } from '../mapping/partition';
import { clamp, mod } from '../math';
import { parseSensorSource, sourceKind } from '../mod/matrix';
import type { Rng } from '../random';
import {
  anchorSteps,
  newTrigAt,
  randomCondition,
  randomLocks,
  randomRetrig,
  templatePeriod,
} from '../seq/generate';
import { MAX_TRACK_LENGTH, type TrackRole, type TrackSpec, type Trig } from '../seq/types';
import type { Palette } from '../styles/schema';
import { SENSOR_ROUTE_MIN, type Genome } from './genome';

type Op =
  'flip' | 'lock' | 'cond' | 'prob' | 'rotate' | 'length' | 'note' | 'route' | 'retrig' | 'micro';

const OPS: readonly [Op, number][] = [
  ['flip', 3],
  ['lock', 2],
  ['cond', 2],
  ['prob', 1],
  ['rotate', 1],
  ['length', 0.4],
  ['note', 2],
  ['route', 2],
  ['retrig', 1],
  ['micro', 1],
];

/** The only changes the FX lane takes: its effects come and go, and their conditions change. */
const LANE_OPS: ReadonlySet<Op> = new Set<Op>(['flip', 'cond', 'prob']);
/** Draws an op may take to find something it can change. */
const TRIES = 3;
/** Params that change what is played: only tracks with a rhythm take them. */
const RHYTHM_PARAMS = new Set(['prob', 'retrig', 'micro']);
const RHYTHMIC_ROLES: readonly TrackRole[] = ['drum', 'bass', 'lead', 'arp', 'chords'];

/**
 * Mutates the genome in place at a phrase start: a few trigs, locks,
 * conditions, notes and routes change. `amount` (0..1, from how much the
 * sensors move) sets how many. Returns a short description of each change.
 * The random stream comes from the fine fingerprint, so a slightly different
 * reading mutates differently. The steps that hold a pattern together (the
 * downbeat, four on the floor, the backbeat) stay where they are; with the
 * palette, templated tracks may also change length by whole periods.
 */
export function mutatePhrase(
  genome: Genome,
  rng: Rng,
  amount: number,
  palette?: Palette,
): string[] {
  const done: string[] = [];
  const count = 1 + Math.round(clamp(amount) * 4);
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < TRIES; tries++) {
      const op = (OPS[rng.weightedIndex(OPS.map(([, w]) => w))] as [Op, number])[0];
      const note = apply(genome, rng, op, palette);
      if (note) {
        done.push(note);
        break;
      }
    }
  }
  return done;
}

function apply(genome: Genome, rng: Rng, op: Op, palette?: Palette): string | undefined {
  if (op === 'route') return mutateRoute(genome, rng);
  const tracks = genome.tracks.filter(
    (t) => t.role !== 'drone' && t.role !== 'pad' && (t.role !== 'fx' || LANE_OPS.has(op)),
  );
  if (tracks.length === 0) return undefined;
  const track = rng.pick(tracks);
  const anchors = anchorSteps(track);
  const placed = placedTrigs(track).filter((p) => !anchors.has(p.index));
  const pickTrig = () => (placed.length > 0 ? rng.pick(placed) : undefined);
  switch (op) {
    case 'flip': {
      const i = rng.int(1, Math.max(1, track.length - 1)) % track.length;
      if (i === 0 || anchors.has(i)) return undefined;
      if (track.trigs[i]) {
        track.trigs[i] = undefined;
        return `${track.slot}: removed step ${i + 1}`;
      }
      track.trigs[i] = newTrigAt(rng, track, i);
      return `${track.slot}: added step ${i + 1}`;
    }
    case 'lock': {
      const p = pickTrig();
      if (!p) return undefined;
      if (p.trig.locks && rng.chance(0.3)) delete p.trig.locks;
      else p.trig.locks = randomLocks(rng);
      return `${track.slot}: p-lock on step ${p.index + 1}`;
    }
    case 'cond': {
      const p = pickTrig();
      if (!p || p.index === 0) return undefined;
      p.trig.cond = p.trig.cond.kind === 'always' ? randomCondition(rng) : { kind: 'always' };
      return `${track.slot}: condition on step ${p.index + 1}`;
    }
    case 'prob': {
      const p = pickTrig();
      if (!p || p.index === 0) return undefined;
      p.trig.prob = Math.round(rng.range(0.3, 1) * 20) / 20;
      return `${track.slot}: probability on step ${p.index + 1}`;
    }
    case 'rotate':
      return rotateTrack(track, rng.chance(0.5) ? 1 : -1);
    case 'length':
      return changeLength(track, rng, palette);
    case 'note': {
      const p = pickTrig();
      if (!p?.trig.note) return undefined;
      const n = p.trig.note;
      if (rng.chance(0.75)) n.tone += rng.chance(0.5) ? 1 : -1;
      else n.oct = clamp(n.oct + (rng.chance(0.5) ? 1 : -1), -1, 1);
      return `${track.slot}: note on step ${p.index + 1}`;
    }
    case 'retrig': {
      const p = pickTrig();
      if (!p || track.role !== 'drum') return undefined;
      if (p.trig.retrig) delete p.trig.retrig;
      else p.trig.retrig = randomRetrig(rng);
      return `${track.slot}: retrig on step ${p.index + 1}`;
    }
    case 'micro': {
      const p = pickTrig();
      if (!p) return undefined;
      p.trig.micro = rng.range(-0.15, 0.15);
      return `${track.slot}: micro timing on step ${p.index + 1}`;
    }
  }
  return undefined;
}

/**
 * Rotates a track by one step, keeping what holds it together: a templated
 * track moves by a whole period (so four on the floor stays on the beat), a
 * drum or bass track keeps its downbeat and rotates the steps after it.
 */
function rotateTrack(track: TrackSpec, dir: 1 | -1): string | undefined {
  const n = track.length;
  if (n < 2) return undefined;
  const period = templatePeriod(track);
  const label = `${track.slot}: rotated ${dir > 0 ? 'right' : 'left'}`;
  if (period > 1) {
    if (n % period !== 0 || n === period) return undefined;
    const old = track.trigs.slice(0, n);
    for (let i = 0; i < n; i++) track.trigs[i] = old[mod(i - dir * period, n)];
    return label;
  }
  const from = track.role === 'drum' || track.role === 'bass' ? 1 : 0;
  const span = n - from;
  if (span < 2) return undefined;
  const old = track.trigs.slice(from, n);
  for (let i = 0; i < span; i++) track.trigs[from + i] = old[mod(i - dir, span)];
  return label;
}

/**
 * A track one step longer or shorter. A templated track only takes the
 * palette's lengths that are whole periods of its template, so a kick on
 * every beat never drifts off the bar.
 */
function changeLength(track: TrackSpec, rng: Rng, palette?: Palette): string | undefined {
  const period = templatePeriod(track);
  let next: number;
  if (period > 1) {
    const machine = palette?.machines[track.machine];
    const lengths = machine?.lengths ?? palette?.lengths ?? [];
    const options = [...new Set(lengths)].filter((l) => l % period === 0 && l !== track.length);
    if (options.length === 0) return undefined;
    next = rng.pick(options);
  } else {
    next = clamp(track.length + (rng.chance(0.5) ? 1 : -1), 2, MAX_TRACK_LENGTH);
    if (next === track.length) return undefined;
  }
  while (track.trigs.length < next) track.trigs.push(undefined);
  track.length = next;
  return `${track.slot}: length ${next}`;
}

/**
 * Nudges a route's amount, or moves it to the same param on another track.
 * Routes never move to the FX lane, rhythm params only move to tracks with
 * a rhythm, and a sensor's route only moves inside the areas it controls.
 */
function mutateRoute(genome: Genome, rng: Rng): string | undefined {
  const routes = genome.matrix.routes;
  if (routes.length === 0) return undefined;
  const route = rng.pick(routes);
  const fromSensor = sourceKind(route.source) === 'sensor';
  const channel = fromSensor ? parseSensorSource(route.source).channelId : undefined;
  const strongSensor = fromSensor && parseSensorSource(route.source).feature !== 'jitter';
  const dot = route.dest.indexOf('.');
  const slot = route.dest.slice(0, dot);
  const param = route.dest.slice(dot + 1);
  const roles = new Map(genome.tracks.map((t) => [t.slot, t.role]));
  if (/^t\d+$/.test(slot) && rng.chance(0.25)) {
    const owned = channel !== undefined ? genome.ownership[channel] : undefined;
    const others = genome.tracks.filter((t) => {
      if (t.slot === slot || t.role === 'fx') return false;
      if (RHYTHM_PARAMS.has(param) && !RHYTHMIC_ROLES.includes(t.role)) return false;
      if (!owned) return true;
      const area = destArea(`${t.slot}.${param}`, (s) => roles.get(s));
      return area !== undefined && owned.includes(area);
    });
    if (others.length > 0) {
      route.dest = `${rng.pick(others).slot}.${param}`;
      return `route moved to ${route.dest}`;
    }
  }
  const sign = Math.sign(route.amount) || 1;
  const magnitude = Math.abs(route.amount) + rng.range(-0.2, 0.2);
  route.amount = sign * clamp(magnitude, strongSensor ? SENSOR_ROUTE_MIN : 0.05, 1);
  return `route to ${route.dest} now ${route.amount.toFixed(2)}`;
}

function placedTrigs(track: TrackSpec): { trig: Trig; index: number }[] {
  const out: { trig: Trig; index: number }[] = [];
  for (let i = 0; i < track.length; i++) {
    const trig = track.trigs[i];
    if (trig) out.push({ trig, index: i });
  }
  return out;
}
