import { beatStrength } from '../clock/grid';
import { clamp, expLerp, lerp } from '../math';
import { LFO_SHAPES, type LfoSpec } from '../mod/lfo';
import { PARAM_INFO, TRACK_PARAMS, type TrackParam, type TrackParams } from '../mod/params';
import type { Rng } from '../random';
import type { Machine, Palette } from '../styles/schema';
import { euclid } from '../theory/euclid';
import {
  MAX_TRACK_LENGTH,
  type Retrig,
  type TrackSpec,
  type Trig,
  type TrigCondition,
} from './types';

export interface GenerateOptions {
  slot: string;
  machineId: string;
  machine: Machine;
  palette: Palette;
  /** 0..1: how busy the pattern is inside the machine's density range. */
  density: number;
}

/** Params a p-lock may set. */
const LOCKABLE: readonly TrackParam[] = ['decay', 'tune', 'cutoff', 'timbre', 'pan', 'reso'];

/** Melodic contour steps in scale degrees and their weights: mostly steps, few leaps. */
const CONTOUR = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
const CONTOUR_WEIGHTS = [1, 6, 6, 3, 3, 1, 1, 0.5, 0.5, 0.3, 0.3];

const CONDITIONS: readonly [TrigCondition, number][] = [
  [{ kind: 'ratio', a: 1, b: 2 }, 2],
  [{ kind: 'ratio', a: 2, b: 2 }, 2],
  [{ kind: 'ratio', a: 1, b: 4 }, 1],
  [{ kind: 'ratio', a: 3, b: 4 }, 1],
  [{ kind: 'ratio', a: 2, b: 3 }, 1],
  [{ kind: 'pre', not: false }, 1],
  [{ kind: 'pre', not: true }, 1],
  [{ kind: 'nei', not: false }, 1],
  [{ kind: 'nei', not: true }, 1],
  [{ kind: 'first', not: false }, 0.5],
  [{ kind: 'first', not: true }, 1],
  [{ kind: 'fill', not: true }, 1],
];

/** Writes a whole track: length, speed, base params, LFO and a pattern for its role. */
export function generateTrack(rng: Rng, o: GenerateOptions): TrackSpec {
  const { machine, palette } = o;
  const length = clamp(
    Math.round(rng.pick(machine.lengths ?? palette.lengths)),
    1,
    MAX_TRACK_LENGTH,
  );
  const scale = rng.pick(machine.scales ?? palette.scales);
  const spec: TrackSpec = {
    slot: o.slot,
    role: machine.role,
    machine: o.machineId,
    length,
    scale,
    trigs: [],
    base: baseParams(rng, machine),
    range: machine.range ?? [48, 84],
    lfo: randomLfo(rng, palette.lfoPeriod),
  };
  if (machine.patch.type === 'drum') spec.voice = machine.patch.voice;
  if (machine.pentatonic) spec.pentatonic = true;
  if (machine.fifth) spec.fifth = true;
  spec.trigs = writePattern(rng, spec, machine, o.density);
  return spec;
}

/** A fresh pattern for an existing track (same machine, length and speed). */
export function writePattern(
  rng: Rng,
  spec: TrackSpec,
  machine: Machine,
  density: number,
): (Trig | undefined)[] {
  const d = clamp(lerp(machine.density[0], machine.density[1], clamp(density)), 0.02, 1);
  switch (spec.role) {
    case 'drum':
      return drumPattern(rng, spec, d);
    case 'bass':
      return bassPattern(rng, spec.length, d, machine.maxLen ?? 8);
    case 'lead':
      return leadPattern(rng, spec.length, d, machine.maxLen ?? 6);
    case 'arp':
      return arpPattern(rng, spec.length, d);
    case 'chords':
      return chordPattern(rng, spec.length, d);
    case 'pad':
      return padPattern(rng, spec.length);
    case 'drone': {
      const trigs: (Trig | undefined)[] = new Array(spec.length).fill(undefined);
      trigs[0] = trig(1, spec.length, { note: { tone: 0, chord: true, oct: 0 }, vel: 0.7 });
      return trigs;
    }
  }
}

/** A new trig for position `index` of an existing track, used by phrase mutations. */
export function newTrigAt(rng: Rng, spec: TrackSpec, index: number): Trig {
  const strong = index % 4 === 0;
  const vel = strong ? rng.range(0.75, 0.95) : rng.range(0.45, 0.75);
  switch (spec.role) {
    case 'drum':
      return drumTrig(rng, spec.voice ?? 'perc', index);
    case 'bass':
      return trig(1, rng.int(1, 3), { note: bassNote(rng, index, false), vel });
    case 'lead':
      return trig(1, rng.int(1, 4), {
        note: { tone: rng.int(-3, 5), chord: false, oct: 0 },
        vel,
      });
    case 'arp':
      return trig(1, 1, { note: { tone: rng.int(0, 5), chord: true, oct: 0 }, vel });
    case 'chords':
    case 'pad':
      return trig(1, rng.int(2, 8), { note: { tone: 0, chord: true, oct: 0 }, vel: vel * 0.8 });
    case 'drone':
      return trig(1, spec.length, { note: { tone: 0, chord: true, oct: 0 }, vel: 0.7 });
  }
}

export function randomCondition(rng: Rng): TrigCondition {
  const i = rng.weightedIndex(CONDITIONS.map(([, w]) => w));
  return { ...(CONDITIONS[i] as [TrigCondition, number])[0] };
}

export function randomLocks(rng: Rng): Partial<Record<TrackParam, number>> {
  const locks: Partial<Record<TrackParam, number>> = {};
  const n = rng.int(1, 2);
  for (let i = 0; i < n; i++) locks[rng.pick(LOCKABLE)] = rng.next();
  return locks;
}

export function randomRetrig(rng: Rng): Retrig {
  return {
    count: rng.int(2, 4),
    rate: rng.pick([0.5, 1 / 3, 0.25]),
    curve: rng.range(-0.6, 0.6),
  };
}

export function randomLfo(rng: Rng, period: [number, number]): LfoSpec {
  return {
    shape: rng.pick(LFO_SHAPES),
    periodSteps: Math.round(expLerp(Math.max(2, period[0]), Math.max(3, period[1]), rng.next())),
    depth: rng.range(0.2, 0.8),
    phase: rng.next(),
    seed: rng.int(1, 2 ** 31 - 1),
  };
}

function baseParams(rng: Rng, machine: Machine): TrackParams {
  const base = {} as TrackParams;
  for (const p of TRACK_PARAMS) {
    const [lo, hi] = machine.base?.[p] ?? PARAM_INFO[p].base;
    base[p] = lo === hi ? lo : rng.range(lo, hi);
  }
  return base;
}

function trig(prob: number, len: number, extra: Partial<Trig> & { vel: number }): Trig {
  return { prob, len, cond: { kind: 'always' }, micro: 0, ...extra };
}

/** Sprinkles conditions, probabilities, micro timing and p-locks over a pattern. */
function decorate(
  rng: Rng,
  trigs: (Trig | undefined)[],
  amount: number,
  opts: { anchor?: number; retrigs?: boolean } = {},
): (Trig | undefined)[] {
  trigs.forEach((t, i) => {
    if (!t || i === opts.anchor) return;
    if (rng.chance(amount)) {
      if (rng.chance(0.45)) t.prob = Math.round(rng.range(0.3, 0.85) * 20) / 20;
      else t.cond = randomCondition(rng);
    }
    if (rng.chance(0.2)) t.micro = rng.range(-0.12, 0.12);
    if (rng.chance(0.18)) t.locks = randomLocks(rng);
    if (opts.retrigs && rng.chance(0.1)) t.retrig = randomRetrig(rng);
  });
  return trigs;
}

function drumTrig(rng: Rng, voice: string, index: number): Trig {
  const accent = index % 4 === 0;
  const t = trig(1, 1, { vel: accent ? rng.range(0.85, 1) : rng.range(0.55, 0.85) });
  if (voice === 'ohat') t.len = 2;
  return t;
}

function drumPattern(rng: Rng, spec: TrackSpec, density: number): (Trig | undefined)[] {
  const n = spec.length;
  const voice = spec.voice ?? 'perc';
  const k = clamp(Math.round(density * n), 1, n);
  let hits: boolean[];
  switch (voice) {
    case 'kick':
      hits = euclid(k, n, 0);
      break;
    case 'snare':
    case 'clap':
      if (n % 4 === 0 && n >= 8 && rng.chance(0.7)) {
        hits = Array.from({ length: n }, (_, i) => i === n / 4 || i === (3 * n) / 4);
        if (k > 2) euclid(k - 2, n, rng.int(0, n - 1)).forEach((h, i) => (hits[i] ||= h));
      } else {
        hits = euclid(k, n, rng.int(1, n - 1));
      }
      break;
    case 'ohat':
      // Off-beats.
      hits = euclid(k, n, n > 2 ? -2 : 0);
      break;
    default:
      hits = euclid(k, n, rng.int(0, n - 1));
  }
  const trigs: (Trig | undefined)[] = hits.map((h, i) => (h ? drumTrig(rng, voice, i) : undefined));

  // Ghost notes on the snare and hats.
  if (voice === 'snare' || voice === 'hat' || voice === 'shaker') {
    trigs.forEach((t, i) => {
      if (!t && rng.chance(0.15 * density + 0.03)) {
        trigs[i] = trig(rng.range(0.4, 0.8), 1, { vel: rng.range(0.22, 0.38) });
      }
    });
  }
  // A few hits that only play during fills, in the last quarter.
  if (voice !== 'kick' && n >= 8) {
    const fills = rng.int(1, 3);
    for (let j = 0; j < fills; j++) {
      const i = rng.int(Math.floor((3 * n) / 4), n - 1);
      if (!trigs[i]) {
        trigs[i] = trig(1, 1, { vel: rng.range(0.6, 0.9), cond: { kind: 'fill', not: false } });
      }
    }
  }
  const rolls = voice === 'hat' || voice === 'snare' || voice === 'perc' || voice === 'shaker';
  return decorate(rng, trigs, rng.range(0.1, 0.3), {
    ...(voice === 'kick' ? { anchor: 0 } : {}),
    retrigs: rolls,
  });
}

function bassNote(rng: Rng, index: number, approach: boolean): Trig['note'] {
  if (index % 4 === 0) return { tone: rng.chance(0.75) ? 0 : 2, chord: true, oct: 0 };
  const i = rng.weightedIndex([0.4, 0.25, 0.15, 0.2]);
  const note = { tone: [0, 2, 1, 0][i] as number, chord: true, oct: i === 3 ? 1 : 0 };
  return approach ? { ...note, approach: true } : note;
}

function bassPattern(rng: Rng, n: number, density: number, maxLen: number): (Trig | undefined)[] {
  const k = clamp(Math.round(density * n), 1, n);
  const hits = euclid(k, n, 0);
  const at = hits.flatMap((h, i) => (h ? [i] : []));
  const trigs: (Trig | undefined)[] = new Array(n).fill(undefined);
  at.forEach((i, j) => {
    const next = at[j + 1] ?? n;
    const lastBeforeBar = next >= Math.ceil((i + 1) / 16) * 16;
    const approach = lastBeforeBar && i % 4 !== 0 && rng.chance(0.4);
    const len = Math.max(1, Math.min(maxLen, next - i) * rng.range(0.55, 1));
    trigs[i] = trig(1, len, {
      note: bassNote(rng, i, approach),
      vel: i % 4 === 0 ? rng.range(0.8, 0.95) : rng.range(0.6, 0.8),
    });
  });
  return decorate(rng, trigs, rng.range(0.05, 0.2), { anchor: 0 });
}

function leadPattern(rng: Rng, n: number, density: number, maxLen: number): (Trig | undefined)[] {
  const syncopation = rng.range(0.2, 0.9);
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    let p = density * (0.35 + 1.3 * beatStrength(i % 16));
    if (i % 2 === 1) p *= syncopation;
    if (i === 0) p = 0.85;
    if (rng.chance(clamp(p))) positions.push(i);
  }
  if (positions.length === 0) positions.push(0);
  const trigs: (Trig | undefined)[] = new Array(n).fill(undefined);
  const answer = rng.pick([-2, -1, 1, 2]);
  let deg = rng.pick([0, 2, 4]);
  let last = 0;
  positions.forEach((i, j) => {
    if (j > 0) {
      let step = CONTOUR[rng.weightedIndex(CONTOUR_WEIGHTS)] as number;
      // After a leap, move back by step in the opposite direction.
      if (Math.abs(last) > 2) step = -Math.sign(last);
      if (deg + step > 7 || deg + step < -5) step = -step;
      deg += step;
      last = step;
    }
    const next = positions[j + 1] ?? n;
    // Second half answers the first, a step or two away.
    const tone = deg + (n >= 16 && i >= n / 2 ? answer : 0);
    trigs[i] = trig(1, Math.max(1, Math.min(maxLen, next - i)), {
      note: { tone, chord: false, oct: 0 },
      vel: clamp(0.55 + 0.3 * beatStrength(i % 16) + rng.range(-0.05, 0.1)),
    });
  });
  return decorate(rng, trigs, rng.range(0.08, 0.25), { anchor: positions[0] as number });
}

type ArpOrder = 'up' | 'down' | 'updown' | 'random' | 'converge';

function arpPattern(rng: Rng, n: number, density: number): (Trig | undefined)[] {
  const rate =
    density > 0.6 ? rng.pick([1, 2]) : density > 0.3 ? rng.pick([2, 2, 3]) : rng.pick([3, 4]);
  const order = rng.pick<ArpOrder>(['up', 'down', 'updown', 'random', 'converge']);
  const size = rng.int(3, 6);
  const random = Array.from({ length: size * 2 }, () => rng.int(0, size - 1));
  const toneAt = (j: number): number => {
    const i = j % size;
    switch (order) {
      case 'up':
        return i;
      case 'down':
        return size - 1 - i;
      case 'updown': {
        const period = Math.max(1, 2 * size - 2);
        const p = j % period;
        return p < size ? p : period - p;
      }
      case 'random':
        return random[j % random.length] as number;
      case 'converge':
        return i % 2 === 0 ? i / 2 : size - 1 - (i - 1) / 2;
    }
  };
  const trigs: (Trig | undefined)[] = new Array(n).fill(undefined);
  let j = 0;
  for (let i = 0; i < n; i += rate) {
    trigs[i] = trig(1, rate * 0.85, {
      note: { tone: toneAt(j++), chord: true, oct: 0 },
      vel: i % 4 === 0 ? rng.range(0.6, 0.75) : rng.range(0.4, 0.6),
    });
  }
  return decorate(rng, trigs, rng.range(0.05, 0.2), { anchor: 0 });
}

function chordPattern(rng: Rng, n: number, density: number): (Trig | undefined)[] {
  const k = clamp(Math.round(density * n), 1, n);
  const hits = euclid(k, n, 0);
  const at = hits.flatMap((h, i) => (h ? [i] : []));
  const trigs: (Trig | undefined)[] = new Array(n).fill(undefined);
  at.forEach((i, j) => {
    const next = at[j + 1] ?? n;
    trigs[i] = trig(1, Math.max(1, (next - i) * rng.range(0.5, 1)), {
      note: { tone: 0, chord: true, oct: 0 },
      vel: rng.range(0.45, 0.7),
    });
  });
  return decorate(rng, trigs, rng.range(0.05, 0.15), { anchor: 0 });
}

function padPattern(rng: Rng, n: number): (Trig | undefined)[] {
  const trigs: (Trig | undefined)[] = new Array(n).fill(undefined);
  const split = n >= 8 && rng.chance(0.4);
  const half = Math.floor(n / 2);
  trigs[0] = trig(1, split ? half : n, { note: { tone: 0, chord: true, oct: 0 }, vel: 0.6 });
  if (split) {
    trigs[half] = trig(rng.range(0.6, 1), n - half, {
      note: { tone: 0, chord: true, oct: 0 },
      vel: 0.5,
    });
  }
  return trigs;
}
