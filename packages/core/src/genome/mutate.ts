import { clamp } from '../math';
import { parseSensorSource, sourceKind } from '../mod/matrix';
import type { Rng } from '../random';
import { newTrigAt, randomCondition, randomLocks, randomRetrig } from '../seq/generate';
import { MAX_TRACK_LENGTH, type TrackSpec, type Trig } from '../seq/types';
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

/**
 * Mutates the genome in place at a phrase start: a few trigs, locks,
 * conditions, notes and routes change. `amount` (0..1, from how much the
 * sensors move) sets how many. Returns a short description of each change.
 * The random stream comes from the fine fingerprint, so a slightly different
 * reading mutates differently.
 */
export function mutatePhrase(genome: Genome, rng: Rng, amount: number): string[] {
  const done: string[] = [];
  const count = 1 + Math.round(clamp(amount) * 4);
  for (let i = 0; i < count; i++) {
    const op = (OPS[rng.weightedIndex(OPS.map(([, w]) => w))] as [Op, number])[0];
    const note = apply(genome, rng, op);
    if (note) done.push(note);
  }
  return done;
}

function apply(genome: Genome, rng: Rng, op: Op): string | undefined {
  const tracks = genome.tracks.filter((t) => t.role !== 'drone' && t.role !== 'pad');
  if (op === 'route') return mutateRoute(genome, rng);
  if (tracks.length === 0) return undefined;
  const track = rng.pick(tracks);
  const placed = placedTrigs(track);
  const pickTrig = () => (placed.length > 0 ? rng.pick(placed) : undefined);
  switch (op) {
    case 'flip': {
      const i = rng.int(1, Math.max(1, track.length - 1)) % track.length;
      if (i === 0) return undefined;
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
    case 'rotate': {
      const dir = rng.chance(0.5) ? 1 : -1;
      const n = track.length;
      const old = track.trigs.slice(0, n);
      for (let i = 0; i < n; i++) track.trigs[i] = old[(((i - dir) % n) + n) % n];
      return `${track.slot}: rotated ${dir > 0 ? 'right' : 'left'}`;
    }
    case 'length': {
      const next = clamp(track.length + (rng.chance(0.5) ? 1 : -1), 2, MAX_TRACK_LENGTH);
      while (track.trigs.length < next) track.trigs.push(undefined);
      track.length = next;
      return `${track.slot}: length ${next}`;
    }
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

/** Nudges a route's amount, or moves it to the same param on another track. */
function mutateRoute(genome: Genome, rng: Rng): string | undefined {
  const routes = genome.matrix.routes;
  if (routes.length === 0) return undefined;
  const route = rng.pick(routes);
  const fromSensor = sourceKind(route.source) === 'sensor';
  const strongSensor = fromSensor && parseSensorSource(route.source).feature !== 'jitter';
  const dot = route.dest.indexOf('.');
  const slot = route.dest.slice(0, dot);
  const others = genome.tracks.filter((t) => t.slot !== slot);
  if (/^t\d+$/.test(slot) && others.length > 0 && rng.chance(0.25)) {
    route.dest = `${rng.pick(others).slot}${route.dest.slice(dot)}`;
    return `route moved to ${route.dest}`;
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
