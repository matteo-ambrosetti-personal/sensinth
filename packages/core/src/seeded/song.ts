import { STEPS_PER_BAR } from '../clock/grid';
import { Harmony, type HarmonyInputs } from '../composer/harmony';
import { evolveTracks } from '../genome/evolve';
import type { HarmonyGenes } from '../genome/genome';
import { clamp, lerp, mod } from '../math';
import type { MatrixSpec } from '../mod/matrix';
import { Rng, hashInts } from '../random';
import { cloneTrack, type TrackSpec } from '../seq/types';
import { driftOf, type FxConfig, type Style } from '../styles/schema';
import type { Chord } from '../theory/chords';
import { DIATONIC_MODES, Scale, byBrightness, type ModeId } from '../theory/scales';
import { LEVELS, applyEffect, effectPhase, type Effect } from './effects';
import { buildSeededGenome } from './genome';

/** Loop lengths to choose from, in bars. */
export const LOOP_BARS: readonly number[] = [2, 4, 8, 12, 16];
export const DEFAULT_LOOP_BARS = 8;

/**
 * One version of the song: what loops while no input changes. It starts
 * from the seed and the style; every edit (a key, a zone of a sensor…)
 * changes a copy of it.
 */
export interface SongSpec {
  style: Style;
  seed: number;
  loopBars: number;
  /** The tracks, the FX lane last. */
  tracks: TrackSpec[];
  /** Muted track slots. */
  muted: Set<string>;
  /** Pitch class of the key. */
  root: number;
  /** Which mode (or, for blues and jazz, which form) of the palette, wrapping. */
  modeIndex: number;
  /** Which chord loop: each number is another progression. */
  chordVariant: number;
  /** The seed's bars per chord. */
  chordRateBars: number;
  /** How far the chord speed effect has moved it, cycling through `RATE_STEPS`. */
  chordRateIndex: number;
  /** Swing, space and brightness, each 0..LEVELS−1. */
  swingLevel: number;
  spaceLevel: number;
  brightnessLevel: number;
  /** Speed of every track: 0.5 half time, 2 double time. */
  timeScale: number;
  genes: HarmonyGenes;
  matrix: MatrixSpec;
  fx?: FxConfig;
  /** How many times the song has evolved (Evolve on), 0 for the seed's own song. */
  generation?: number;
}

/** One chord of the loop with everything a note needs to be realized against it. */
export interface ChordSlot {
  scale: Scale;
  chord: Chord;
  mode: ModeId;
  keyName: string;
  roman: string;
  name: string;
  /** Pitch class of the next chord's root (wrapping to the first). */
  nextRoot: number;
  chordMoves: boolean;
}

/** A song with its chords worked out. */
export interface Song extends SongSpec {
  chordSteps: number;
  chords: ChordSlot[];
}

/** Inputs the harmony is written with: fixed, so only the seed and the edits shape it. */
const HARMONY_INPUTS: HarmonyInputs = { tension: 0.4, brightness: 0.6, texture: 0.5, color: 0.5 };

/**
 * The modes (or forms, for blues and jazz) the mode effect steps through,
 * darkest first: every diatonic mode plus the palette's own, so each step
 * changes the scale.
 */
function modeOptions(style: Style): string[] {
  const cs = style.palette.chordScales;
  if (cs) return [...cs.forms].sort((a, b) => a.brightness - b.brightness).map((f) => f.id);
  return byBrightness([...new Set([...DIATONIC_MODES, ...style.palette.modes])]);
}

/** How the chord speed effect scales the chord length, cycling (lengths outside ½–8 bars are skipped). */
const RATE_STEPS = [1, 0.5, 2, 0.25, 4];

/** Bars per chord for a chord speed index: the seed's rate, then half, double, a quarter, four times. */
function chordRate(base: number, index: number): number {
  const rates = [...new Set(RATE_STEPS.map((f) => base * f).filter((r) => r >= 0.5 && r <= 8))];
  return rates[mod(index, rates.length)] ?? base;
}

/** The song the seed writes for a style, before any edit. */
export function baseSong(style: Style, seed: number, loopBars = DEFAULT_LOOP_BARS): SongSpec {
  const genome = buildSeededGenome(style, seed, 0);
  const options = modeOptions(style);
  const own = style.palette.chordScales
    ? options
    : style.palette.modes.filter((m) => options.includes(m));
  const start = own[hashInts(seed, 0x30de) % Math.max(1, own.length)];
  return {
    style,
    seed,
    loopBars,
    tracks: genome.tracks,
    muted: new Set(),
    root: hashInts(seed, 0x6b3) % 12,
    modeIndex: Math.max(0, options.indexOf(start ?? '')),
    chordVariant: 0,
    chordRateIndex: 0,
    chordRateBars: genome.harmony.chordRateBars,
    swingLevel: Math.min(LEVELS - 1, Math.floor(genome.swing * LEVELS)),
    spaceLevel: 2,
    brightnessLevel: 2 + (hashInts(seed, 0xb7) % 2),
    timeScale: 1,
    genes: genome.harmony,
    matrix: genome.matrix,
    ...(genome.fx ? { fx: genome.fx } : {}),
  };
}

/** How far one generation moves the song: about a quarter of its beats, a step of its sound. */
const EVOLVE_RATE = 0.3;

/** Bars per generation: whole loops, at least 16 bars. */
export function generationBars(loopBars: number): number {
  return loopBars * Math.ceil(16 / Math.max(1, loopBars));
}

/**
 * The next generation of a song (Evolve on): its tracks a step toward a
 * fresh take of the seed for generation `k`, now and then the key a fifth
 * up. It only depends on the song, the seed and `k`, so a seed always
 * evolves the same way. With `instruments` false, no track changes its
 * instrument.
 */
export function evolveBase(prev: SongSpec, k: number, instruments = true): SongSpec {
  const { style, seed } = prev;
  const donor = buildSeededGenome(style, seed, k);
  const rng = new Rng(hashInts(seed, k, 0xe701));
  const base = driftOf(style);
  const drift = instruments ? base : { ...base, machine: 0 };
  const { tracks } = evolveTracks(
    prev.tracks,
    donor.tracks,
    rng,
    { rate: EVOLVE_RATE, drift, palette: style.palette },
    donor.density,
  );
  const lane = prev.tracks.find((t) => t.role === 'fx');
  const all = lane ? [...tracks, cloneTrack(lane)] : tracks;
  const h = clamp(EVOLVE_RATE * drift.harmony);
  const genes: HarmonyGenes = {
    ...prev.genes,
    progressionBias: prev.genes.progressionBias.map((b, i) =>
      lerp(b, donor.harmony.progressionBias[i] ?? b, h),
    ),
  };
  const live = new Set(all.map((t) => t.slot));
  return {
    ...prev,
    tracks: all,
    muted: new Set(prev.muted),
    genes,
    root: rng.chance(0.25 * h) ? mod(prev.root + 7, 12) : prev.root,
    swingLevel: rng.chance(0.2 * drift.rhythm)
      ? mod(prev.swingLevel + (rng.chance(0.5) ? 1 : -1), LEVELS)
      : prev.swingLevel,
    matrix: {
      ...prev.matrix,
      routes: prev.matrix.routes.filter((r) => {
        const m = /^(?:lfo:)?(t\d+)\./.exec(r.dest);
        return !m || live.has(m[1] as string);
      }),
      lfos: Object.fromEntries(
        all.filter((t) => t.role !== 'fx').map((t) => [t.slot, { ...t.lfo }]),
      ),
    },
    generation: k,
  };
}

/** One edit of the song: an effect, applied `count` times. */
export interface SongEdit {
  /** Which input made it, e.g. `key:KeyA`; edits are applied sorted by phase, then input. */
  input: string;
  effect: Effect;
  count: number;
}

function copy(spec: SongSpec): SongSpec {
  return { ...spec, tracks: spec.tracks.map(cloneTrack), muted: new Set(spec.muted) };
}

/**
 * The song for a set of edits: the base with every edit applied, in a fixed
 * order (by phase, then by input), so the same edits always give the same
 * song whatever order they came in.
 */
export function buildSong(base: SongSpec, edits: readonly SongEdit[]): Song {
  const spec = copy(base);
  const sorted = [...edits].sort(
    (a, b) =>
      effectPhase(a.effect) - effectPhase(b.effect) ||
      (a.input < b.input ? -1 : a.input > b.input ? 1 : 0),
  );
  for (const e of sorted) applyEffect(spec, e.effect, e.count);
  if (spec.timeScale !== 1) {
    for (const t of spec.tracks) t.scale = Math.min(4, Math.max(0.25, t.scale * spec.timeScale));
  }
  return { ...spec, ...chordLoop(spec) };
}

/** The chords of the loop: written once with fixed inputs, then repeated. */
function chordLoop(spec: SongSpec): { chordSteps: number; chords: ChordSlot[] } {
  const { palette } = spec.style;
  const rate = chordRate(spec.chordRateBars, spec.chordRateIndex);
  const chordSteps = Math.max(1, Math.round(rate * STEPS_PER_BAR));
  const loopSteps = spec.loopBars * STEPS_PER_BAR;
  const count = Math.max(1, Math.ceil(loopSteps / chordSteps));
  const options = modeOptions(spec.style);
  const choice = options[mod(spec.modeIndex, Math.max(1, options.length))];
  const genes: HarmonyGenes = palette.chordScales
    ? { ...spec.genes, forms: choice ? [choice] : spec.genes.forms, chordRateBars: rate }
    : { ...spec.genes, modes: choice ? [choice as ModeId] : spec.genes.modes, chordRateBars: rate };
  const variant = spec.chordVariant;
  const harmony = new Harmony(
    palette,
    new Rng(hashInts(spec.seed, variant, 0x4a11)),
    genes,
    HARMONY_INPUTS,
    spec.root,
  );
  // Plan the second chord to move too; other variants start from another chord.
  harmony.startAt(variant, HARMONY_INPUTS);
  const phraseSteps = Math.max(1, palette.phraseBars) * STEPS_PER_BAR;
  const raw: Omit<ChordSlot, 'nextRoot' | 'chordMoves'>[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      harmony.reseed(hashInts(spec.seed, variant, i, 0xc4));
      harmony.advance(HARMONY_INPUTS, (i * chordSteps) % phraseSteps === 0, true);
    }
    const label = harmony.chordLabel;
    raw.push({
      scale: harmony.scale,
      chord: { ...harmony.chord },
      mode: harmony.mode,
      keyName: harmony.keyName,
      roman: label.roman,
      name: label.name,
    });
  }
  const rootOf = (c: (typeof raw)[number]) => mod(c.scale.degreeToMidi(c.chord.degree), 12);
  const chords = raw.map((c, i) => {
    const next = raw[(i + 1) % raw.length] as (typeof raw)[number];
    return {
      ...c,
      nextRoot: rootOf(next),
      chordMoves: rootOf(next) !== rootOf(c) || next.scale.mode !== c.scale.mode,
    };
  });
  return { chordSteps, chords };
}
