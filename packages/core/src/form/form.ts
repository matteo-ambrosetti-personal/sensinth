import type { Macros } from '../mapping/macros';
import type { Rng } from '../random';
import type { TrackSpec } from '../seq/types';

/**
 * The parts of a piece. Every piece opens with an intro, states its riff,
 * then moves between riff, voice, solo and break as the sensors decide, and
 * closes with an outro and a last chord.
 */
export type SectionKind = 'intro' | 'riff' | 'voice' | 'solo' | 'break' | 'outro';

export const SECTION_KINDS: readonly SectionKind[] = [
  'intro',
  'riff',
  'voice',
  'solo',
  'break',
  'outro',
];

export const SECTION_INFO: Record<SectionKind, { label: string; description: string }> = {
  intro: { label: 'Intro', description: 'The instruments come in one after another' },
  riff: { label: 'Riff', description: 'The theme: the whole band on its pattern' },
  voice: { label: 'Voice', description: 'A sung line over the band, on other chords' },
  solo: { label: 'Solo', description: 'One instrument improvises, the others accompany' },
  break: { label: 'Break', description: 'The drums and the bass step out' },
  outro: { label: 'Outro', description: 'The instruments leave, then a last chord' },
};

/** How long a piece lasts. The sensors pick the length inside the range. */
export interface FormOptions {
  /** Shortest piece, in seconds (default 180). */
  minSeconds?: number;
  /** Longest piece, in seconds (default 300). */
  maxSeconds?: number;
  /** Which piece of the session this is, from 0; shown and logged. */
  piece?: number;
}

export const DEFAULT_MIN_SECONDS = 180;
export const DEFAULT_MAX_SECONDS = 300;
/** Bars after the outro: the last chord rings, then a bar of silence. */
export const FINAL_BARS = 2;

/** A sensor that tipped a decision, and how. */
export interface ChosenBy {
  channelId: string;
  label: string;
  /** In words: "calm", "restless", "moved". */
  why: string;
}

/** One section of the piece playing, as the app shows it. */
export interface SectionView {
  kind: SectionKind;
  /** "Riff", "Riff 2", "Solo: Tenor sax". */
  label: string;
  /** Bar of the piece it starts on, from 0. */
  startBar: number;
  bars: number;
  /** The track it puts forward: the riff's instrument, the voice, the soloist. */
  featured?: { slot: string; label: string };
  /** The sensor whose reading tipped the choice. */
  chosenBy?: ChosenBy;
}

/** Where the piece is in its form. */
export interface FormView {
  /** Which piece of the session, from 0. */
  piece: number;
  /** Every section so far; the last one is playing. */
  sections: readonly SectionView[];
  /** Bars into the section playing. */
  barInSection: number;
  /** Bars into the piece. */
  bar: number;
  /** Bars the piece plans to last, the last chord included. */
  totalBars: number;
  /** Track slots resting in this bar, by arrangement. */
  resting: readonly string[];
  /** The last chord is ringing. */
  ending: boolean;
  /** The piece is over: nothing more will play. */
  ended: boolean;
}

/** What kind of part a track plays in an arrangement. */
export type Part =
  'kick' | 'snare' | 'hats' | 'perc' | 'bass' | 'chords' | 'pad' | 'drone' | 'arp' | 'lead';

const HAT_VOICES = ['hat', 'ohat', 'shaker', 'ride', 'brush', 'crash'];
const SNARE_VOICES = ['snare', 'clap', 'rim'];

export function partOf(t: Pick<TrackSpec, 'role' | 'voice'>): Part | undefined {
  switch (t.role) {
    case 'drum': {
      const v = t.voice ?? '';
      if (v === 'kick') return 'kick';
      if (SNARE_VOICES.includes(v)) return 'snare';
      if (HAT_VOICES.includes(v)) return 'hats';
      return 'perc';
    }
    case 'fx':
      return undefined;
    default:
      return t.role;
  }
}

/** Orders in which the parts of a band may come in (and, backwards, leave). */
const ENTRIES: Record<'air' | 'beat' | 'riff', readonly (readonly Part[])[]> = {
  // From the air down: a held sound, then harmony, time, the low end, the drums.
  air: [['drone', 'pad'], ['chords', 'arp'], ['hats', 'perc'], ['bass'], ['kick', 'snare']],
  // From the beat up: time first, then the low end, then harmony.
  beat: [['hats', 'perc'], ['kick'], ['bass', 'snare'], ['chords', 'pad', 'drone'], ['arp']],
  // The riff alone, then the band around it.
  riff: [
    ['arp', 'bass'],
    ['hats', 'perc'],
    ['chords', 'pad', 'drone'],
    ['kick', 'snare'],
  ],
};

export type EntryOrder = keyof typeof ENTRIES;

/** How one section is played: who rests on each bar, who is put forward. */
export interface Arrangement {
  /** Slots resting on bar `bar` of the section (from 0). */
  resting(bar: number): ReadonlySet<string>;
  /** The track put forward. */
  featured?: string;
  /** Added to a track's level, −1..1 on the 0..1 param scale. */
  trim(slot: string): number;
}

interface Arranged {
  kind: SectionKind;
  bars: number;
  tracks: readonly TrackSpec[];
  /** How many sections of this kind came before. */
  nth: number;
  /** Picks among equals; seeded by the sensors. */
  rng: Rng;
  energy: number;
  /** The soloist of the section, if it is a solo. */
  soloist?: string;
}

const FEATURE_BOOST = 0.1;
const BACKING_CUT = -0.07;

/** The track a riff or a voice is carried by, in order of preference. */
export function pickFeatured(
  tracks: readonly TrackSpec[],
  order: readonly Part[],
): TrackSpec | undefined {
  for (const part of order) {
    const t = tracks.find((x) => partOf(x) === part);
    if (t) return t;
  }
  return undefined;
}

/** Who may take a solo, most likely first; `taken` already had one. */
export function pickSoloist(
  tracks: readonly TrackSpec[],
  rng: Rng,
  taken: readonly string[],
): TrackSpec | undefined {
  const weights: Partial<Record<Part, number>> = {
    lead: 5,
    arp: 3,
    chords: 2,
    bass: 2,
    perc: 1,
    snare: 0.6,
  };
  const pool = tracks.filter((t) => (weights[partOf(t) as Part] ?? 0) > 0);
  if (pool.length === 0) return undefined;
  // The first solo goes to the lead when there is one.
  const lead = pool.find((t) => partOf(t) === 'lead');
  if (lead && taken.length === 0) return lead;
  const fresh = pool.filter((t) => !taken.includes(t.slot));
  const from = fresh.length > 0 ? fresh : pool;
  return from[rng.weightedIndex(from.map((t) => weights[partOf(t) as Part] ?? 1))];
}

/** Which way the band comes in: from the beat when the sensors are busy, else as they pick. */
export function pickEntry(tracks: readonly TrackSpec[], rng: Rng, energy: number): EntryOrder {
  const has = (p: Part) => tracks.some((t) => partOf(t) === p);
  const options: EntryOrder[] = [];
  if (has('drone') || has('pad') || has('chords')) options.push('air');
  if (has('hats') || has('perc') || has('kick')) options.push('beat');
  if (has('arp') || has('bass')) options.push('riff');
  if (options.length === 0) return 'air';
  if (energy > 0.62 && options.includes('beat')) return 'beat';
  if (energy < 0.3 && options.includes('air')) return 'air';
  return rng.pick(options);
}

/** The tracks in the order they come in, one group per stage; empty stages are dropped. */
function stages(tracks: readonly TrackSpec[], order: EntryOrder): string[][] {
  const left = new Map(tracks.map((t) => [t.slot, partOf(t)]));
  const out: string[][] = [];
  for (const group of ENTRIES[order]) {
    const slots = [...left].filter(([, p]) => p !== undefined && group.includes(p)).map(([s]) => s);
    for (const s of slots) left.delete(s);
    if (slots.length > 0) out.push(slots);
  }
  // Whatever the order does not name (the lead, other parts) comes last.
  const rest = [...left].filter(([, p]) => p !== 'lead').map(([s]) => s);
  if (rest.length > 0) out.push(rest);
  return out;
}

/**
 * Writes the arrangement of a section: an intro brings the tracks in stage
 * by stage, a riff plays the band on its theme, a voice puts the lead in
 * front, a solo thins the band around one player, a break takes the drums
 * and the bass out, an outro lets the tracks go one stage at a time.
 */
export function arrange(a: Arranged): Arrangement {
  const { kind, bars, tracks, rng } = a;
  const all = tracks.filter((t) => t.role !== 'fx');
  const slotsOf = (...parts: Part[]) =>
    all.filter((t) => parts.includes(partOf(t) as Part)).map((t) => t.slot);
  const none: ReadonlySet<string> = new Set();
  const flat = (featured: string | undefined, rest: Iterable<string>, backing = 0): Arrangement => {
    const resting = new Set(rest);
    if (featured) resting.delete(featured);
    // Never an empty stage: with everyone resting, everyone plays.
    const silent = all.every((t) => resting.has(t.slot));
    return {
      resting: () => (silent ? none : resting),
      ...(featured ? { featured } : {}),
      trim: (slot) => (slot === featured ? FEATURE_BOOST : featured ? backing : 0),
    };
  };

  switch (kind) {
    case 'intro':
    case 'outro': {
      const order = pickEntry(all, rng, a.energy);
      const seq = stages(all, kind === 'outro' ? 'air' : order);
      const lead = slotsOf('lead');
      const n = Math.max(1, seq.length);
      // An intro keeps its last stage (often the drums) for the downbeat of what follows,
      // when it is long enough to make that a drop.
      const hold = kind === 'intro' && bars >= 8 && n >= 4 ? 1 : 0;
      const at = (bar: number): ReadonlySet<string> => {
        const k = Math.min(1, Math.max(0, bar) / Math.max(1, bars));
        const resting = new Set<string>(kind === 'intro' ? lead : []);
        if (kind === 'intro') {
          const inNow = Math.min(n - hold, 1 + Math.floor(k * (n - hold)));
          for (const group of seq.slice(inNow)) for (const s of group) resting.add(s);
        } else {
          // The lead goes first, then one stage after another, the first stage staying to the end.
          const gone = Math.min(n - 1, Math.floor(k * n));
          if (bar >= Math.max(1, Math.floor(bars / 4))) for (const s of lead) resting.add(s);
          for (const group of seq.slice(n - gone)) for (const s of group) resting.add(s);
        }
        return all.every((t) => resting.has(t.slot)) ? none : resting;
      };
      const cache = new Map<number, ReadonlySet<string>>();
      return {
        resting: (bar) => {
          let r = cache.get(bar);
          if (!r) cache.set(bar, (r = at(bar)));
          return r;
        },
        trim: () => 0,
      };
    }
    case 'riff': {
      const riff = pickFeatured(all, ['arp', 'bass', 'chords', 'lead']);
      // The lead waits while the riff is stated; from its second return the whole band plays.
      const rest = riff && partOf(riff) !== 'lead' && a.nth < 2 ? slotsOf('lead') : [];
      return flat(riff?.slot, rest);
    }
    case 'voice': {
      const voice = pickFeatured(all, ['lead', 'arp', 'chords', 'pad']);
      const rest = [...slotsOf('perc')];
      if (voice && partOf(voice) === 'lead' && a.nth % 2 === 0) rest.push(...slotsOf('arp'));
      return flat(voice?.slot, rest, BACKING_CUT / 2);
    }
    case 'solo': {
      const solo = all.find((t) => t.slot === a.soloist);
      const part = solo ? partOf(solo) : undefined;
      const rest = new Set<string>([...slotsOf('lead', 'arp', 'perc')]);
      // A drum solo: only the bass stays under it.
      if (part === 'perc' || part === 'snare') {
        for (const s of slotsOf('chords', 'pad', 'drone', 'hats')) rest.add(s);
      }
      return flat(solo?.slot, rest, BACKING_CUT);
    }
    case 'break': {
      const out = new Set(slotsOf('kick', 'snare', 'perc', 'bass'));
      const half = new Set(slotsOf('kick', 'snare', 'perc'));
      const resting = (bar: number): ReadonlySet<string> => {
        const r = bar < bars / 2 ? out : half;
        return all.every((t) => r.has(t.slot)) ? none : r;
      };
      return { resting, trim: (slot) => (slotsOf('hats').includes(slot) ? BACKING_CUT : 0) };
    }
  }
}

export interface ChoiceInput {
  /** Kinds played so far, in order. */
  history: readonly SectionKind[];
  /** Bars left before the outro must start. */
  barsLeft: number;
  macros: Readonly<Macros>;
  rng: Rng;
  /** The surroundings changed: the next section is of another kind than the last. */
  contrast?: boolean;
}

/** The dial each kind of section listens to, and the words for it. */
export const SECTION_DIAL: Record<
  Exclude<SectionKind, 'intro' | 'outro'>,
  { macro: keyof Macros; high: boolean; why: string }
> = {
  riff: { macro: 'energy', high: true, why: 'busy' },
  voice: { macro: 'brightness', high: true, why: 'bright' },
  solo: { macro: 'variation', high: true, why: 'restless' },
  break: { macro: 'energy', high: false, why: 'calm' },
};

/**
 * Which section comes next. The sensors' dials weigh the options: busy
 * sensors bring the riff back, bright ones the voice, restless ones a solo,
 * calm ones a break. No kind repeats at once except the riff, a solo waits
 * for the riff to be stated, a break for the piece to be under way.
 */
export function chooseSection(c: ChoiceInput): Exclude<SectionKind, 'intro'> {
  const { history, macros, rng } = c;
  if (history.length === 0) return 'riff';
  const prev = history[history.length - 1] as SectionKind;
  if (prev === 'intro') return 'riff';
  if (c.barsLeft <= 0) return 'outro';
  const count = (k: SectionKind) => history.filter((h) => h === k).length;
  const lean = (k: keyof typeof SECTION_DIAL) => {
    const d = SECTION_DIAL[k];
    const v = macros[d.macro];
    return 0.45 + 1.1 * (d.high ? v : 1 - v);
  };
  const played = history.length;
  const weights: [Exclude<SectionKind, 'intro' | 'outro'>, number][] = [
    ['riff', (prev === 'riff' ? (c.contrast ? 0 : 0.2) : 1.3) * lean('riff')],
    [
      'voice',
      (prev === 'voice' ? (c.contrast ? 0 : 0.15) : 1.2) *
        lean('voice') *
        (count('voice') === 0 && played >= 2 ? 2 : 1),
    ],
    [
      'solo',
      (prev === 'solo' || played < 2 ? 0 : 0.9) *
        lean('solo') *
        (count('solo') === 0 && played >= 4 ? 1.8 : 1),
    ],
    ['break', (prev === 'break' || played < 3 ? 0 : 0.6) * lean('break')],
  ];
  const i = rng.weightedIndex(weights.map(([, w]) => w));
  return (weights[i] as [Exclude<SectionKind, 'intro' | 'outro'>, number])[0];
}

/** Seconds a section of each kind aims for; the bars follow from the tempo. */
const SECTION_SECONDS: Record<SectionKind, number> = {
  intro: 14,
  riff: 26,
  voice: 30,
  solo: 30,
  break: 15,
  outro: 18,
};

/**
 * How many bars a section lasts: about its kind's length in seconds at this
 * tempo, in whole units (phrases; a blues chorus for the blues), stretched
 * a little by `lean` (0..1).
 */
export function sectionBars(
  kind: SectionKind,
  barSeconds: number,
  unit: number,
  lean = 0.5,
): number {
  const u = Math.max(1, Math.round(unit));
  // Intros, outros and breaks may be shorter than a chorus: they count in phrases of four.
  const step = kind === 'intro' || kind === 'outro' || kind === 'break' ? Math.min(u, 4) : u;
  const want = (SECTION_SECONDS[kind] * (0.8 + 0.5 * lean)) / Math.max(0.2, barSeconds);
  const bars = Math.max(1, Math.round(want / step)) * step;
  const most = kind === 'intro' || kind === 'break' ? 16 : 32;
  return Math.max(step, Math.min(Math.max(step, Math.floor(most / step) * step), bars));
}

/** Bars a piece plans to last: the sensors pick a length inside the range. */
export function planBars(
  barSeconds: number,
  pick: number,
  minSeconds = DEFAULT_MIN_SECONDS,
  maxSeconds = DEFAULT_MAX_SECONDS,
): number {
  const lo = Math.min(minSeconds, maxSeconds);
  const hi = Math.max(minSeconds, maxSeconds);
  const bar = Math.max(0.2, barSeconds);
  // Leave room at the top: the last section may run a few bars over its plan.
  const top = Math.max(lo, hi - 6 * bar);
  const seconds = lo + (top - lo) * Math.min(1, Math.max(0, pick));
  return Math.max(8, Math.round(seconds / bar));
}

/** A section's label: its kind, numbered from its second appearance, with who is put forward. */
export function sectionLabel(kind: SectionKind, nth: number, featured?: string): string {
  const name = SECTION_INFO[kind].label + (nth > 0 ? ` ${nth + 1}` : '');
  return kind === 'solo' && featured ? `${name}: ${featured}` : name;
}

/**
 * The style of the next piece, picked by the sensors: busy sensors go for
 * the faster styles, calm ones for the slower, and the chain of readings
 * picks among the nearest few. Never the style just played, when there is
 * another.
 */
export function chooseStyle<T extends { id: string; defaultTempo: number }>(
  styles: readonly T[],
  energy: number,
  chain: number,
  current?: string,
): T {
  const pool = styles.filter((s) => s.id !== current);
  const from = (pool.length > 0 ? pool : [...styles]).sort(
    (a, b) => a.defaultTempo - b.defaultTempo || (a.id < b.id ? -1 : 1),
  );
  if (from.length === 0) throw new Error('chooseStyle: no styles');
  const centre = Math.min(1, Math.max(0, energy)) * (from.length - 1);
  const near = from
    .map((s, i) => ({ s, d: Math.abs(i - centre) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.min(4, from.length));
  return (near[(chain >>> 0) % near.length] as { s: T }).s;
}
