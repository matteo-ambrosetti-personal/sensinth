import { clamp, lerp } from '../math';
import { PARAM_INFO, TRACK_PARAMS } from '../mod/params';
import type { Route } from '../mod/matrix';
import type { Rng } from '../random';
import { anchorSteps, newTrigAt, writePattern } from '../seq/generate';
import { cloneTrack, MAX_TRACK_LENGTH, type TrackRole, type TrackSpec } from '../seq/types';
import { byBrightness, type ModeId } from '../theory/scales';
import type { DriftProfile, Machine, Palette } from '../styles/schema';
import { cloneGenome, type Genome } from './genome';

export interface EvolveOptions {
  /** How far one evolution goes, 0..1: about the share of beats that change. */
  rate: number;
  drift: DriftProfile;
  palette: Palette;
}

/** Steps per block when patterns cross over: one beat. */
const BLOCK = 4;
/** Density bounds around a machine's range, as fractions of its low and high end. */
const DENSITY_SLACK: [number, number] = [0.7, 1.2];
/** Most conditional trigs, and trigs with a low probability, a track may hold. */
const MAX_CONDITIONAL = 0.4;
const MAX_UNLIKELY = 0.3;

/** A track's identity across genomes: the palette slot it fills, or its role and machine. */
function identity(t: TrackSpec): string {
  return t.option !== undefined ? `o${t.option}` : `${t.role}:${t.machine}`;
}

function slotNumber(slot: string): number {
  return Number(slot.slice(1)) || 0;
}

/** The lowest free `tN` slot id. */
function freeSlot(used: ReadonlySet<string>): string {
  for (let n = 1; ; n++) if (!used.has(`t${n}`)) return `t${n}`;
}

function machineOf(palette: Palette, t: TrackSpec): Machine | undefined {
  return palette.machines[t.machine];
}

function roleWeight(drift: DriftProfile, role: TrackRole): number {
  return drift.roles?.[role] ?? 1;
}

/** A walk that bounces off the ends of [lo, hi]. */
function reflect(v: number, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  let x = v;
  for (let i = 0; i < 4 && (x < lo || x > hi); i++) x = x < lo ? 2 * lo - x : 2 * hi - x;
  return clamp(x, lo, hi);
}

/**
 * Keeps an evolved pattern playable: density inside the machine's range
 * (with some slack), not too many conditional or unlikely trigs, anchors
 * where they were.
 */
function guard(
  t: TrackSpec,
  machine: Machine | undefined,
  rng: Rng,
  anchors: Set<number>,
  cand: TrackSpec,
): void {
  if (t.role === 'drone' || t.role === 'fx') return;
  const n = t.length;
  const placed = () => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (t.trigs[i]) out.push(i);
    return out;
  };
  if (machine) {
    // The machine's range, widened to whatever the generator itself writes (templates, ghosts).
    const fresh =
      cand.trigs.slice(0, cand.length).filter(Boolean).length * (n / Math.max(1, cand.length));
    const lo = Math.max(1, Math.round(Math.min(n * machine.density[0], fresh) * DENSITY_SLACK[0]));
    const hi = Math.max(
      lo,
      Math.min(n, Math.round(Math.max(n * machine.density[1], fresh) * DENSITY_SLACK[1])),
    );
    let on = placed();
    while (on.length > hi) {
      const removable = on.filter((i) => !anchors.has(i));
      if (removable.length === 0) break;
      t.trigs[rng.pick(removable)] = undefined;
      on = placed();
    }
    for (let guardLoop = 0; on.length < lo && guardLoop < n; guardLoop++) {
      const empty: number[] = [];
      for (let i = 0; i < n; i++) if (!t.trigs[i]) empty.push(i);
      if (empty.length === 0) break;
      const i = rng.pick(empty);
      t.trigs[i] = newTrigAt(rng, t, i);
      on = placed();
    }
  }
  const on = placed();
  const conditional = on.filter((i) => t.trigs[i]?.cond.kind !== 'always');
  for (const i of conditional.slice(Math.floor(on.length * MAX_CONDITIONAL))) {
    const trig = t.trigs[i];
    if (trig) trig.cond = { kind: 'always' };
  }
  const unlikely = on.filter((i) => (t.trigs[i]?.prob ?? 1) < 0.5);
  for (const i of unlikely.slice(Math.floor(on.length * MAX_UNLIKELY))) {
    const trig = t.trigs[i];
    if (trig) trig.prob = 1;
  }
  for (const i of anchors) {
    const trig = t.trigs[i];
    if (trig) {
      trig.cond = { kind: 'always' };
      trig.prob = 1;
    }
  }
}

/** Gives a track another machine of its palette slot, rewriting its pattern for it. */
function swapMachine(
  t: TrackSpec,
  o: EvolveOptions,
  rng: Rng,
  density: number,
): string | undefined {
  const slot = t.option !== undefined ? o.palette.slots[t.option] : undefined;
  const options = (slot?.machines ?? []).filter(
    (id) => id !== t.machine && o.palette.machines[id]?.role === t.role,
  );
  if (options.length === 0) return undefined;
  const id = rng.pick(options);
  const machine = o.palette.machines[id] as Machine;
  t.machine = id;
  t.range = machine.range ?? [48, 84];
  if (machine.patch.type === 'drum') t.voice = machine.patch.voice;
  else delete t.voice;
  for (const flag of ['pentatonic', 'fifth', 'blueNotes'] as const) {
    if (machine[flag]) t[flag] = true;
    else delete t[flag];
  }
  if (machine.rhythm && machine.rhythm !== 'euclid') t.rhythm = machine.rhythm;
  else delete t.rhythm;
  for (const p of TRACK_PARAMS) {
    const [lo, hi] = machine.base?.[p] ?? PARAM_INFO[p].base;
    t.base[p] = clamp(t.base[p], lo, hi);
  }
  const lengths = machine.lengths ?? o.palette.lengths;
  if (!lengths.includes(t.length)) t.length = rng.pick(lengths);
  t.length = clamp(Math.round(t.length), 1, MAX_TRACK_LENGTH);
  t.trigs = writePattern(rng, t, machine, density);
  return `${t.slot}: now ${machine.label}`;
}

/**
 * One track a little further along: some of its beats from the fresh take,
 * its sound walking inside its machine's ranges, its LFO drifting, now and
 * then another length, speed or instrument. Changes `t` in place.
 */
function evolveTrack(
  t: TrackSpec,
  cand: TrackSpec,
  rng: Rng,
  o: EvolveOptions,
  density: number,
  changes: string[],
): void {
  const { rate, drift, palette } = o;
  const weight = roleWeight(drift, t.role);
  if (t.role !== 'drone' && rng.chance(clamp(rate * 0.08 * drift.machine))) {
    const note = swapMachine(t, o, rng, density);
    if (note) changes.push(note);
  }
  const machine = machineOf(palette, t);
  const anchors = anchorSteps(t);
  if (t.role !== 'drone' && rng.chance(clamp(rate * 0.12 * drift.rhythm * weight))) {
    const lengths = machine?.lengths ?? palette.lengths;
    const next = lengths.includes(cand.length) ? cand.length : t.length;
    if (next !== t.length && cand.machine === t.machine) {
      t.length = next;
      t.trigs = cand.trigs.map((x) => (x ? { ...x, cond: { ...x.cond } } : undefined));
      changes.push(`${t.slot}: length ${next}`);
    }
  }
  if (rng.chance(clamp(rate * 0.1 * drift.phase))) {
    const scales = machine?.scales ?? palette.scales;
    if (scales.includes(cand.scale) && cand.scale !== t.scale) {
      t.scale = cand.scale;
      changes.push(`${t.slot}: speed ×${cand.scale}`);
    }
  }
  // Beats from the fresh take, a few at a time.
  if (t.role !== 'drone' && cand.length > 0) {
    const p = clamp(rate * 0.7 * drift.pattern * weight);
    let moved = 0;
    for (let b = 0; b * BLOCK < t.length; b++) {
      if (!rng.chance(p)) continue;
      for (let i = b * BLOCK; i < Math.min(t.length, (b + 1) * BLOCK); i++) {
        if (anchors.has(i)) continue;
        const src = cand.machine === t.machine ? cand.trigs[i % cand.length] : undefined;
        t.trigs[i] = src
          ? { ...src, cond: { ...src.cond }, ...(src.note ? { note: { ...src.note } } : {}) }
          : t.trigs[i] && rng.chance(0.5)
            ? undefined
            : rng.chance(0.3)
              ? newTrigAt(rng, t, i)
              : t.trigs[i];
      }
      moved++;
    }
    if (moved > 0) changes.push(`${t.slot}: ${moved} beat${moved > 1 ? 's' : ''} rewritten`);
  }
  // The sound walks inside the machine's ranges, pulled a little toward the fresh take.
  const sigma = 0.35 * rate * drift.sound;
  for (const p of TRACK_PARAMS) {
    const [lo, hi] = machine?.base?.[p] ?? PARAM_INFO[p].base;
    if (lo === hi) continue;
    const step = (p === 'level' ? 0.4 : 1) * sigma * (hi - lo + 0.2);
    const pull = 0.1 * (cand.base[p] - t.base[p]);
    t.base[p] = reflect(t.base[p] + rng.range(-step, step) + pull, lo, hi);
  }
  // The LFO drifts too.
  const [pLo, pHi] = palette.lfoPeriod;
  const m = rate * drift.motion;
  t.lfo = {
    ...t.lfo,
    periodSteps: Math.round(
      clamp(
        t.lfo.periodSteps * Math.exp(rng.range(-0.4, 0.4) * m),
        Math.max(2, pLo),
        Math.max(3, pHi),
      ),
    ),
    depth: reflect(t.lfo.depth + rng.range(-0.15, 0.15) * m, 0.1, 0.9),
    ...(rng.chance(clamp(0.15 * m)) ? { shape: cand.lfo.shape } : {}),
  };
  guard(t, machine, rng, anchors, cand);
}

/** Replaces track slots in a route's source and destination. */
function remapRoute(r: Route, map: ReadonlyMap<string, string>): Route | undefined {
  const swap = (id: string, prefix: RegExp): string | undefined => {
    const m = prefix.exec(id);
    if (!m) return id;
    const to = map.get(m[2] as string);
    return to === undefined ? undefined : `${m[1]}${to}${id.slice((m[0] as string).length)}`;
  };
  const source =
    r.source.startsWith('s:') || r.source.startsWith('m:') || r.source.startsWith('chaos:')
      ? r.source
      : swap(r.source, /^(lfo:|env:)(t\d+)/);
  const dest = swap(r.dest, /^(lfo:|)(t\d+)(?=\.)/);
  if (source === undefined || dest === undefined) return undefined;
  return { ...r, source, dest };
}

function slotsOf(r: Route): string[] {
  const out: string[] = [];
  for (const id of [r.source, r.dest]) {
    const m = /^(?:lfo:|env:)?(t\d+)(?=[.:]|$)/.exec(id);
    if (m && !id.startsWith('s:')) out.push(m[1] as string);
  }
  return out;
}

function channelOf(r: Route): string | undefined {
  if (!r.source.startsWith('s:')) return undefined;
  const body = r.source.slice(2);
  return body.slice(0, body.lastIndexOf(':'));
}

/** A sensor's finest route: its reading's digits nudging one param (see `buildRoutes`). */
function isJitter(r: Route): boolean {
  return r.source.endsWith(':jitter');
}

/**
 * One sensor's routes after an evolution: its previous ones, a few swapped
 * (with chance `p` each) for fresh ones of the same strength, never two to
 * the same place, then topped up to as many strong routes as the fresh take
 * gives it, so a sensor never fades out over a long piece.
 */
function keepRoutes(
  kept: readonly Route[],
  theirs: readonly Route[],
  rng: Rng,
  p: number,
): Route[] {
  const mine: Route[] = [];
  const taken = (dest: string) => mine.some((m) => m.dest === dest);
  for (const r of kept) {
    const spare = theirs.filter((f) => isJitter(f) === isJitter(r) && !taken(f.dest));
    if (spare.length > 0 && (taken(r.dest) || rng.chance(clamp(p)))) mine.push(rng.pick(spare));
    else if (!taken(r.dest)) mine.push({ ...r });
  }
  const strong = (rs: readonly Route[]) => rs.filter((r) => !isJitter(r)).length;
  for (const f of theirs) {
    if (strong(mine) >= strong(theirs)) break;
    if (!isJitter(f) && !taken(f.dest)) mine.push(f);
  }
  return mine;
}

export interface EvolvedTracks {
  tracks: TrackSpec[];
  /**
   * Candidate slot → slot in the evolved tracks, for the candidate's tracks
   * that are there (matched or joined); a track left out maps nowhere.
   */
  slotMap: Map<string, string>;
  changes: string[];
}

/**
 * Moves a set of tracks one step toward a fresh take (`cand`), keeping
 * each track's identity (matched by palette slot): tracks the fresh take
 * also has evolve; at most one track (two for big moves) comes or goes.
 */
export function evolveTracks(
  prev: readonly TrackSpec[],
  cand: readonly TrackSpec[],
  rng: Rng,
  o: EvolveOptions,
  density: number,
): EvolvedTracks {
  const changes: string[] = [];
  const slotMap = new Map<string, string>();
  const before = prev.filter((t) => t.role !== 'fx');
  const fresh = cand.filter((t) => t.role !== 'fx');
  const byId = new Map(before.map((t) => [identity(t), t]));
  const freshIds = new Set(fresh.map(identity));
  const swaps = o.rate > 0.5 ? 2 : 1;

  const out: TrackSpec[] = [];
  const used = new Set(before.map((t) => t.slot));
  let added = 0;
  let dropped = 0;
  // Tracks the fresh take no longer has: one goes, the others stay a while.
  for (const t of before) {
    if (freshIds.has(identity(t))) continue;
    if (dropped < swaps && rng.chance(0.5 + 0.5 * o.rate)) {
      dropped++;
      used.delete(t.slot);
      changes.push(`${t.slot}: left`);
      continue;
    }
    const kept = cloneTrack(t);
    evolveTrack(kept, kept, rng, { ...o, rate: o.rate * 0.5 }, density, changes);
    out.push(kept);
  }
  for (const c of fresh) {
    const p = byId.get(identity(c));
    if (p) {
      const t = cloneTrack(p);
      evolveTrack(t, c, rng, o, density, changes);
      out.push(t);
      slotMap.set(c.slot, p.slot);
      continue;
    }
    if (added >= swaps) continue;
    added++;
    const slot = freeSlot(used);
    used.add(slot);
    out.push({ ...cloneTrack(c), slot });
    slotMap.set(c.slot, slot);
    changes.push(`${slot}: joined`);
  }
  // Keep the palette's order (drums first, then bass, …), then the slot.
  const order = (t: TrackSpec) => (t.option ?? 99) * 100 + slotNumber(t.slot);
  out.sort((a, b) => order(a) - order(b));
  return { tracks: out, slotMap, changes };
}

function evolveModes<T extends string>(
  prev: readonly T[],
  cand: readonly T[],
  rng: Rng,
  p: number,
): T[] {
  const out = [...prev];
  if (out.length === 0 || !rng.chance(p)) return out;
  const fresh = cand.filter((m) => !out.includes(m));
  if (fresh.length === 0) return out;
  out[rng.int(0, out.length - 1)] = rng.pick(fresh);
  return out;
}

/**
 * The next genome in a line: the previous one moved a step toward a fresh
 * take of the sensors (`cand`, as `buildGenome` writes it). Tracks keep
 * their identity and phrase mutations; a share of their beats, their sound,
 * LFOs and routes, and the harmony genes move toward the fresh take. Small
 * rates are a section going by; large ones a new scene.
 */
export function evolveGenome(
  prev: Genome,
  cand: Genome,
  rng: Rng,
  o: EvolveOptions,
): { genome: Genome; changes: string[] } {
  const { rate, drift } = o;
  const next = cloneGenome(cand);
  const { tracks, slotMap, changes } = evolveTracks(prev.tracks, cand.tracks, rng, o, cand.density);
  const prevLane = prev.tracks.find((t) => t.role === 'fx');
  const candLane = cand.tracks.find((t) => t.role === 'fx');
  const lane =
    prevLane && !rng.chance(clamp(rate)) ? cloneTrack(prevLane) : candLane && cloneTrack(candLane);
  next.tracks = lane ? [...tracks, lane] : tracks;
  // A slot keeps its routes only while the same track holds it: one that joined in a
  // slot another track left is new there.
  const was = new Map(prev.tracks.map((t) => [t.slot, identity(t)]));
  const newSlots = new Set(
    tracks.filter((t) => was.get(t.slot) !== identity(t)).map((t) => t.slot),
  );
  const live = new Set(tracks.map((t) => t.slot));
  const valid = (r: Route) => slotsOf(r).every((s) => live.has(s) && !newSlots.has(s));

  // Routes: a sensor whose areas did not change keeps its routes, a few move to the fresh take's.
  const fresh = cand.matrix.routes.flatMap((r) => remapRoute(r, slotMap) ?? []);
  const sameAreas = (ch: string) =>
    (prev.ownership[ch] ?? []).join() === (cand.ownership[ch] ?? []).join() && ch in cand.ownership;
  const routes: Route[] = [];
  const channels = new Set(fresh.flatMap((r) => channelOf(r) ?? []));
  for (const ch of channels) {
    const theirs = fresh.filter((r) => channelOf(r) === ch);
    const kept = sameAreas(ch)
      ? prev.matrix.routes.filter((r) => channelOf(r) === ch && valid(r))
      : [];
    routes.push(
      ...(kept.length === 0 ? theirs : keepRoutes(kept, theirs, rng, rate * drift.motion)),
    );
  }
  // Internal routes (LFOs, chaos, hits, dials): the previous ones, or now and then the fresh set.
  const internal = (rs: readonly Route[]) => rs.filter((r) => channelOf(r) === undefined);
  const prevInternal = internal(prev.matrix.routes).filter(valid);
  if (rng.chance(clamp(rate * 0.5 * drift.motion)) || prevInternal.length === 0) {
    routes.push(...internal(fresh));
  } else {
    routes.push(...prevInternal.map((r) => ({ ...r })));
    routes.push(...internal(fresh).filter((r) => slotsOf(r).some((s) => newSlots.has(s))));
  }
  // Dedupe identical (source, dest) pairs a swap may have doubled.
  const seen = new Set<string>();
  next.matrix.routes = routes.filter((r) => {
    const k = `${r.source}>${r.dest}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  next.matrix.lfos = Object.fromEntries(tracks.map((t) => [t.slot, { ...t.lfo }]));
  const walk = (a: number, b: number, k: number) =>
    reflect(a + (b - a) * clamp(k) + rng.range(-0.05, 0.05) * k, 0.3, 0.95);
  next.matrix.chaos = {
    a: {
      start: cand.matrix.chaos.a.start,
      r: walk(prev.matrix.chaos.a.r, cand.matrix.chaos.a.r, rate * drift.motion),
    },
    b: {
      start: cand.matrix.chaos.b.start,
      r: walk(prev.matrix.chaos.b.r, cand.matrix.chaos.b.r, rate * drift.motion),
    },
  };

  // Harmony genes: modes and forms swap one at a time, the progression bends toward the fresh take.
  const h = rate * drift.harmony;
  const modes = evolveModes<ModeId>(prev.harmony.modes, cand.harmony.modes, rng, clamp(h * 0.6));
  next.harmony = {
    modes: byBrightness(modes),
    forms: evolveModes(prev.harmony.forms, cand.harmony.forms, rng, clamp(h * 0.6)),
    chordRateBars: rng.chance(clamp(h * 0.3))
      ? cand.harmony.chordRateBars
      : prev.harmony.chordRateBars,
    progressionBias: prev.harmony.progressionBias.map((b, i) =>
      lerp(b, cand.harmony.progressionBias[i] ?? b, clamp(h * 1.5)),
    ),
  };
  if (modes.join() !== prev.harmony.modes.join())
    changes.push(`modes: ${next.harmony.modes.join(', ')}`);
  next.swing = clamp(prev.swing + (cand.swing - prev.swing) * clamp(rate * drift.rhythm));
  next.density = clamp(lerp(prev.density, cand.density, clamp(rate)));
  if (prev.fx && cand.fx) next.fx = rng.chance(clamp(rate * 0.3)) ? { ...cand.fx } : { ...prev.fx };
  return { genome: next, changes };
}
