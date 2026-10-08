import { KIND_FX } from '../fx/effects';
import { hashInts, hashString } from '../random';
import type { Timescale } from '../sensors/types';
import type { MacroId, TriggerId } from './macros';
import { DEFAULT_MAPPING, type MappingRules } from './rules';

/**
 * What sensors control, in five domains of two areas each. One source on
 * its own controls every area; several sources share them out, so each one
 * has its own job: one the rhythm, another the harmony, another the sound…
 */
export type Domain = 'rhythm' | 'harmony' | 'sound' | 'space' | 'motion';
export const DOMAINS: readonly Domain[] = ['rhythm', 'harmony', 'sound', 'space', 'motion'];

export type Area =
  | 'rhythm.drums'
  | 'rhythm.groove'
  | 'harmony.chords'
  | 'harmony.melody'
  | 'sound.drums'
  | 'sound.tonal'
  | 'space.room'
  | 'space.fx'
  | 'motion.lfo'
  | 'motion.form';

export const DOMAIN_AREAS: Readonly<Record<Domain, readonly [Area, Area]>> = {
  rhythm: ['rhythm.drums', 'rhythm.groove'],
  harmony: ['harmony.chords', 'harmony.melody'],
  sound: ['sound.drums', 'sound.tonal'],
  space: ['space.room', 'space.fx'],
  motion: ['motion.lfo', 'motion.form'],
};

export const AREAS: readonly Area[] = DOMAINS.flatMap((d) => DOMAIN_AREAS[d]);

export function domainOf(area: Area): Domain {
  return area.slice(0, area.indexOf('.')) as Domain;
}

/** What each area moves, as the app shows it. */
export const AREA_INFO: Readonly<Record<Area, { label: string; description: string }>> = {
  'rhythm.drums': { label: 'Drums', description: 'which drum hits play, rolls, accents, energy' },
  'rhythm.groove': { label: 'Groove', description: 'swing, fills, how busy the other parts are' },
  'harmony.chords': { label: 'Chords', description: 'tension, the chords and the key' },
  'harmony.melody': { label: 'Melody', description: 'register and notes of the lead and arps' },
  'sound.drums': { label: 'Drum sound', description: 'pitch, decay and grit of the drums' },
  'sound.tonal': { label: 'Tone', description: 'filters, timbre and drive, brightness' },
  'space.room': { label: 'Room', description: 'reverb, delay and space' },
  'space.fx': { label: 'Effects', description: 'stutters, washes and throws, panning' },
  'motion.lfo': { label: 'Wobble', description: 'LFO speed and depth, chaos' },
  'motion.form': { label: 'Form', description: 'levels, variation, how much each phrase changes' },
};

export const DOMAIN_INFO: Readonly<Record<Domain, { label: string }>> = {
  rhythm: { label: 'Rhythm' },
  harmony: { label: 'Harmony' },
  sound: { label: 'Sound' },
  space: { label: 'Space' },
  motion: { label: 'Motion' },
};

/** The area each dial belongs to: only that area's owners move it. */
export const MACRO_AREA: Readonly<Record<MacroId, Area>> = {
  energy: 'rhythm.drums',
  variation: 'motion.form',
  tension: 'harmony.chords',
  color: 'harmony.chords',
  register: 'harmony.melody',
  brightness: 'sound.tonal',
  texture: 'sound.drums',
  space: 'space.room',
};

/** The area each trigger belongs to. */
export const TRIGGER_AREA: Readonly<Record<TriggerId, Area>> = {
  accent: 'rhythm.drums',
  fill: 'rhythm.groove',
};

/** A channel as the partition sees it. */
export interface PartitionChannel {
  id: string;
  kind: string;
  /** The source it comes from (see `SensorDescriptor.group`). */
  group: string;
  timescale: Timescale;
}

/**
 * How the areas are shared out:
 * - `all`: one source controls everything;
 * - `domains`: two to five sources, each with whole domains;
 * - `areas`: six to ten sources, each with its own areas;
 * - `shared`: more sources than areas, so some share.
 */
export type PartitionLevel = 'all' | 'domains' | 'areas' | 'shared';

export interface Partition {
  /** The channels it was made for: the same key, the same partition. */
  key: string;
  level: PartitionLevel;
  /** Each source and its areas, sorted by source. */
  groups: { group: string; areas: Area[] }[];
  /** Each channel's areas. */
  channels: Record<string, Area[]>;
  /** Each area's channels, best suited first. */
  owners: Record<Area, string[]>;
}

/** Bonus for keeping what a source or channel had, so a new source moves as little as possible. */
const STICKY = 0.5;
/** How much each unit already held lowers a holder's claim on the next. */
const SPREAD = 0.15;

/** Kinds that suit areas beyond what their dial rules say. */
const KIND_AFFINITY: readonly [RegExp, Partial<Record<Area, number>>][] = [
  [/^sound\./, { 'space.room': 0.4, 'space.fx': 0.3 }],
  [/^(time\.daylight|geo\.place|geo\.altitude|heading)$/, { 'harmony.chords': 0.6 }],
  [/^(light|camera\.luma|screen\.brightness)$/, { 'sound.tonal': 0.6 }],
  [
    /^(motion\.accel|rotation\.rate|pointer\.speed|keys\.rate|steps\.rate|controller\.buttons)$/,
    { 'rhythm.drums': 0.4 },
  ],
  [/^orientation\./, { 'harmony.melody': 0.3 }],
  [/^camera\.hue$/, { 'harmony.chords': 0.3 }],
  [/^(lid\.angle|cover|proximity)$/, { 'space.fx': 0.3 }],
];

/** Fast channels suit the rhythm, slow ones the harmony and the room. */
const TIMESCALE_AFFINITY: Readonly<Record<Timescale, Partial<Record<Area, number>>>> = {
  fast: { 'rhythm.drums': 0.3, 'rhythm.groove': 0.2, 'space.fx': 0.2 },
  medium: { 'sound.tonal': 0.2, 'harmony.melody': 0.2, 'motion.lfo': 0.2, 'sound.drums': 0.1 },
  slow: { 'harmony.chords': 0.2, 'space.room': 0.2, 'motion.form': 0.2 },
};

/** How well a channel suits each area, from its dial and trigger rules, its kind and its timescale. */
export function affinity(
  ch: PartitionChannel,
  rules: MappingRules = DEFAULT_MAPPING,
): Record<Area, number> {
  const score = Object.fromEntries(AREAS.map((a) => [a, 0])) as Record<Area, number>;
  for (const r of rules.macros) if (r.kind === ch.kind) score[MACRO_AREA[r.macro]] += r.weight ?? 1;
  for (const r of rules.triggers) if (r.kind === ch.kind) score[TRIGGER_AREA[r.trigger]] += 0.3;
  if (Object.hasOwn(KIND_FX, ch.kind)) score['space.fx'] += 0.5;
  for (const [pattern, extra] of KIND_AFFINITY) {
    if (!pattern.test(ch.kind)) continue;
    for (const [a, v] of Object.entries(extra) as [Area, number][]) score[a] += v;
  }
  for (const [a, v] of Object.entries(TIMESCALE_AFFINITY[ch.timescale]) as [Area, number][]) {
    score[a] += v;
  }
  // A whisker of the id, so ties never depend on the order channels came in.
  for (const a of AREAS) score[a] += (hashInts(hashString(ch.id), hashString(a)) % 1000) * 1e-6;
  return score;
}

/**
 * Shares `units` out among `holders`, each scored by `score`. With one
 * holder it gets everything. Otherwise every holder first gets its best
 * unit still free (the best pairs first); the rest go one by one to the
 * holder that wants each most, less a little for what it already has. With
 * more holders than units, those left over share their best unit.
 */
export function deal<U>(
  holders: readonly string[],
  units: readonly U[],
  score: (holder: string, unit: U) => number,
): Map<string, U[]> {
  const out = new Map<string, U[]>(holders.map((h) => [h, []]));
  if (holders.length === 0 || units.length === 0) return out;
  if (holders.length === 1) {
    out.set(holders[0] as string, [...units]);
    return out;
  }
  const order = (u: U) => units.indexOf(u);
  const free = new Set(units);
  const waiting = new Set(holders);
  // Round one: the best (holder, unit) pairs, one unit per holder.
  while (waiting.size > 0 && free.size > 0) {
    let best: [string, U, number] | undefined;
    for (const h of waiting) {
      for (const u of free) {
        const s = score(h, u);
        if (
          !best ||
          s > best[2] ||
          (s === best[2] && (h < best[0] || (h === best[0] && order(u) < order(best[1]))))
        ) {
          best = [h, u, s];
        }
      }
    }
    const [h, u] = best as [string, U, number];
    (out.get(h) as U[]).push(u);
    waiting.delete(h);
    free.delete(u);
  }
  // More holders than units: the rest share their best unit.
  for (const h of waiting) {
    let pick = units[0] as U;
    for (const u of units) if (score(h, u) > score(h, pick)) pick = u;
    (out.get(h) as U[]).push(pick);
  }
  // The units left go to whoever wants each most.
  for (const u of units.filter((x) => free.has(x))) {
    let pick = holders[0] as string;
    let top = -Infinity;
    for (const h of holders) {
      const s = score(h, u) - SPREAD * (out.get(h) as U[]).length;
      if (s > top || (s === top && h < pick)) {
        pick = h;
        top = s;
      }
    }
    (out.get(pick) as U[]).push(u);
  }
  for (const list of out.values()) list.sort((a, b) => order(a) - order(b));
  return out;
}

function levelFor(groups: number): PartitionLevel {
  if (groups <= 1) return 'all';
  if (groups <= DOMAINS.length) return 'domains';
  if (groups <= AREAS.length) return 'areas';
  return 'shared';
}

/**
 * Shares the areas out among the live channels: first among their sources
 * (whole domains while there are at most five, single areas beyond), then
 * within each source among its channels. Deterministic and independent of
 * the order channels are listed in; with `prev`, sources and channels keep
 * what they had where they suit it about as well.
 */
export function partitionAreas(
  channels: readonly PartitionChannel[],
  rules: MappingRules = DEFAULT_MAPPING,
  prev?: Partition,
): Partition {
  const sorted = [...channels].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const key = sorted.map((c) => `${c.group}/${c.id}`).join('|');
  const scores = new Map(sorted.map((c) => [c.id, affinity(c, rules)]));
  const byGroup = new Map<string, PartitionChannel[]>();
  for (const c of sorted) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
  const groupIds = [...byGroup.keys()].sort();
  const level = levelFor(groupIds.length);

  const prevGroup = new Map(prev?.groups.map((g) => [g.group, new Set(g.areas)]) ?? []);
  const groupScore = (g: string, area: Area) => {
    let s = 0;
    for (const c of byGroup.get(g) ?? []) s += (scores.get(c.id) as Record<Area, number>)[area];
    return s + (prevGroup.get(g)?.has(area) ? STICKY : 0);
  };

  let groupAreas: Map<string, Area[]>;
  if (level === 'domains') {
    const dealt = deal(groupIds, DOMAINS, (g, d) =>
      DOMAIN_AREAS[d].reduce((s, a) => s + groupScore(g, a), 0),
    );
    groupAreas = new Map([...dealt].map(([g, ds]) => [g, ds.flatMap((d) => [...DOMAIN_AREAS[d]])]));
  } else {
    groupAreas = deal(groupIds, AREAS, groupScore);
  }

  const owned: Record<string, Area[]> = {};
  for (const g of groupIds) {
    const members = byGroup.get(g) as PartitionChannel[];
    const areas = groupAreas.get(g) ?? [];
    const dealt = deal(
      members.map((c) => c.id),
      areas,
      (id, a) =>
        (scores.get(id) as Record<Area, number>)[a] +
        (prev?.channels[id]?.includes(a) ? STICKY : 0),
    );
    for (const [id, list] of dealt) owned[id] = list;
  }

  const owners = Object.fromEntries(AREAS.map((a) => [a, [] as string[]])) as Record<
    Area,
    string[]
  >;
  for (const c of sorted) for (const a of owned[c.id] ?? []) owners[a].push(c.id);
  for (const a of AREAS) {
    owners[a].sort(
      (x, y) =>
        (scores.get(y) as Record<Area, number>)[a] - (scores.get(x) as Record<Area, number>)[a] ||
        (x < y ? -1 : 1),
    );
  }
  return {
    key,
    level,
    groups: groupIds.map((g) => ({ group: g, areas: groupAreas.get(g) ?? [] })),
    channels: owned,
    owners,
  };
}

/**
 * The area a modulation destination belongs to: `g.swing` is the groove, a
 * drum's cutoff its sound, a lead's tune the melody… `roleOf` gives the role
 * of a track slot.
 */
export function destArea(
  dest: string,
  roleOf: (slot: string) => string | undefined,
): Area | undefined {
  if (dest.startsWith('g.')) {
    switch (dest.slice(2)) {
      case 'swing':
        return 'rhythm.groove';
      case 'tension':
        return 'harmony.chords';
      case 'space':
        return 'space.room';
      case 'fx':
        return 'space.fx';
      case 'brightness':
        return 'sound.tonal';
      default:
        return undefined;
    }
  }
  if (dest.startsWith('chaos:') || dest.startsWith('lfo:')) return 'motion.lfo';
  const dot = dest.indexOf('.');
  if (dot < 0) return undefined;
  const role = roleOf(dest.slice(0, dot));
  if (role === undefined || role === 'fx') return undefined;
  const drum = role === 'drum';
  const melody = role === 'lead' || role === 'arp';
  switch (dest.slice(dot + 1)) {
    case 'prob':
    case 'retrig':
    case 'micro':
      return drum ? 'rhythm.drums' : melody ? 'harmony.melody' : 'rhythm.groove';
    case 'tune':
      return drum ? 'sound.drums' : melody ? 'harmony.melody' : 'harmony.chords';
    case 'sendReverb':
    case 'sendDelay':
      return 'space.room';
    case 'pan':
      return 'space.fx';
    case 'level':
      return 'motion.form';
    default:
      return drum ? 'sound.drums' : 'sound.tonal';
  }
}

/** True when a channel controls an area. Without a partition every channel controls everything. */
export function owns(p: Partition | undefined, channelId: string, area: Area): boolean {
  if (!p) return true;
  return p.channels[channelId]?.includes(area) ?? false;
}

/** The domains a channel's areas belong to. */
export function domainsOf(p: Partition | undefined, channelId: string): Domain[] {
  if (!p) return [...DOMAINS];
  const areas = p.channels[channelId] ?? [];
  return DOMAINS.filter((d) => DOMAIN_AREAS[d].some((a) => areas.includes(a)));
}
