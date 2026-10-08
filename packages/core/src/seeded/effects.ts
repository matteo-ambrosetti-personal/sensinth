import { FX_IDS, FX_INFO } from '../fx/effects';
import type { Domain } from '../mapping/partition';
import { clamp, mod } from '../math';
import { hashInts, hashString, Rng } from '../random';
import { generateTrack, newTrigAt, writePattern } from '../seq/generate';
import type { TrackRole, TrackSpec } from '../seq/types';
import type { SensorDescriptor, Timescale } from '../sensors/types';
import type { Machine } from '../styles/schema';
import { PRESS_KINDS } from './inputs';
import type { SongSpec } from './song';

/** What an input does to the song. */
export type EffectId =
  | 'mute'
  | 'rewrite'
  | 'rotate'
  | 'octave'
  | 'thin'
  | 'fill'
  | 'reverse'
  | 'ratchet'
  | 'machine'
  | 'addTrack'
  | 'drumsOut'
  | 'fxThrow'
  | 'halfTime'
  | 'doubleTime'
  | 'fifth'
  | 'transpose'
  | 'mode'
  | 'chords'
  | 'chordRate'
  | 'swing'
  | 'space'
  | 'brightness';

/** Which tracks an effect works on: track n (1-based, wrapping) or a group. */
export type Target = number | 'drums' | 'melodic' | 'lead' | 'rhythmic' | 'all';

export interface Effect {
  id: EffectId;
  target?: Target;
  /** Direction for effects that can go either way (rotate, transpose). */
  dir?: 1 | -1;
  /**
   * A track number past the last track wraps round to the first. Inputs
   * without a key of their own (MIDI keys, other keys, sensors) wrap; the
   * number keys don't: 6 on a four-track song does nothing.
   */
  wrap?: true;
}

/** The part of the music each effect changes. */
export const EFFECT_DOMAIN: Readonly<Record<EffectId, Domain>> = {
  rotate: 'rhythm',
  thin: 'rhythm',
  fill: 'rhythm',
  reverse: 'rhythm',
  ratchet: 'rhythm',
  halfTime: 'rhythm',
  doubleTime: 'rhythm',
  swing: 'rhythm',
  drumsOut: 'rhythm',
  fifth: 'harmony',
  transpose: 'harmony',
  mode: 'harmony',
  chords: 'harmony',
  chordRate: 'harmony',
  octave: 'harmony',
  rewrite: 'sound',
  machine: 'sound',
  brightness: 'sound',
  space: 'space',
  fxThrow: 'space',
  addTrack: 'motion',
  mute: 'motion',
};

/** Levels of swing, space and brightness the song moves between. */
export const LEVELS = 5;
const MAX_TRACKS = 8;
/** Most tracks an effect can name. */
export const MAX_TRACK_TARGET = MAX_TRACKS;
/** Effects that stop the music; FX throws leave them out. */
const NO_THROW = new Set(['tapeStop', 'brake']);

/**
 * Edits run in phases, so the result never depends on the order of the
 * presses: tracks are added first, then machines, patterns, their sound,
 * mutes and speed, and finally the harmony and the mix.
 */
const PHASE: Record<EffectId, number> = {
  addTrack: 0,
  machine: 1,
  rewrite: 2,
  thin: 3,
  fill: 3,
  rotate: 3,
  reverse: 3,
  ratchet: 3,
  fxThrow: 3,
  octave: 4,
  mute: 5,
  drumsOut: 5,
  halfTime: 5,
  doubleTime: 5,
  fifth: 6,
  transpose: 6,
  mode: 6,
  chords: 6,
  chordRate: 6,
  swing: 6,
  space: 6,
  brightness: 6,
};

export function effectPhase(e: Effect): number {
  return PHASE[e.id];
}

/**
 * The keyboard, by physical key (`KeyboardEvent.code`), so it is the same on
 * every layout and for every seed: the number row mutes tracks, the top row
 * rewrites them, the home row rotates them, the bottom row moves them up and
 * down; the keys around them change the harmony and the mix.
 */
export const KEY_EFFECTS: Readonly<Record<string, Effect>> = {
  Digit1: { id: 'mute', target: 1 },
  Digit2: { id: 'mute', target: 2 },
  Digit3: { id: 'mute', target: 3 },
  Digit4: { id: 'mute', target: 4 },
  Digit5: { id: 'mute', target: 5 },
  Digit6: { id: 'mute', target: 6 },
  Digit7: { id: 'mute', target: 7 },
  Digit8: { id: 'mute', target: 8 },
  Digit9: { id: 'ratchet', target: 'drums' },
  Digit0: { id: 'fxThrow' },
  Minus: { id: 'thin', target: 'rhythmic' },
  Equal: { id: 'fill', target: 'rhythmic' },
  Backquote: { id: 'reverse', target: 'all' },
  KeyQ: { id: 'rewrite', target: 1 },
  KeyW: { id: 'rewrite', target: 2 },
  KeyE: { id: 'rewrite', target: 3 },
  KeyR: { id: 'rewrite', target: 4 },
  KeyT: { id: 'rewrite', target: 5 },
  KeyY: { id: 'rewrite', target: 6 },
  KeyU: { id: 'rewrite', target: 7 },
  KeyI: { id: 'rewrite', target: 8 },
  KeyO: { id: 'fifth' },
  KeyP: { id: 'mode' },
  BracketLeft: { id: 'halfTime' },
  BracketRight: { id: 'doubleTime' },
  Backslash: { id: 'drumsOut' },
  KeyA: { id: 'rotate', target: 1, dir: 1 },
  KeyS: { id: 'rotate', target: 2, dir: 1 },
  KeyD: { id: 'rotate', target: 3, dir: 1 },
  KeyF: { id: 'rotate', target: 4, dir: 1 },
  KeyG: { id: 'rotate', target: 5, dir: 1 },
  KeyH: { id: 'rotate', target: 6, dir: 1 },
  KeyJ: { id: 'rotate', target: 7, dir: 1 },
  KeyK: { id: 'rotate', target: 8, dir: 1 },
  KeyL: { id: 'chords' },
  Semicolon: { id: 'chordRate' },
  Quote: { id: 'swing' },
  Enter: { id: 'addTrack' },
  KeyZ: { id: 'octave', target: 1 },
  KeyX: { id: 'octave', target: 2 },
  KeyC: { id: 'octave', target: 3 },
  KeyV: { id: 'octave', target: 4 },
  KeyB: { id: 'octave', target: 5 },
  KeyN: { id: 'octave', target: 6 },
  KeyM: { id: 'octave', target: 7 },
  Comma: { id: 'octave', target: 8 },
  Period: { id: 'space' },
  Slash: { id: 'brightness' },
  Space: { id: 'fill', target: 'drums' },
  Backspace: { id: 'machine', target: 'all' },
  ArrowUp: { id: 'transpose', dir: 1 },
  ArrowDown: { id: 'transpose', dir: -1 },
  ArrowLeft: { id: 'rotate', target: 'all', dir: -1 },
  ArrowRight: { id: 'rotate', target: 'all', dir: 1 },
};

/** Every effect a press can have, in a fixed order: MIDI keys, buttons and other keys pick from it. */
export const PRESS_CATALOGUE: readonly Effect[] = Object.values(KEY_EFFECTS);

/** Physical keys by number, so a key travels as a number in events and recordings. */
export const KEY_CODES: readonly string[] = Object.keys(KEY_EFFECTS);

/** A key's number: its place in `KEY_CODES`, or 1000 + a hash for any other key. */
export function keyCodeIndex(code: string): number {
  const i = KEY_CODES.indexOf(code);
  return i >= 0 ? i : 1000 + (hashString(code) % 1000);
}

/** The effect of a key, by its number from `keyCodeIndex`. */
export function keyEffect(index: number): Effect {
  const code = KEY_CODES[index];
  if (code) return KEY_EFFECTS[code] as Effect;
  return PRESS_CATALOGUE[mod(index, PRESS_CATALOGUE.length)] as Effect;
}

const KEY_NAMES: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** What a key is called on the keyboard: `KeyA` → "A", `Digit1` → "1", `Slash` → "/". */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return KEY_NAMES[code] ?? code;
}

/** Onsets of fast sensors, by kind: a shake rewrites the drums, a clap fills them… */
export const ONSET_EFFECTS: Readonly<Record<string, Effect>> = {
  'motion.accel': { id: 'rewrite', target: 'drums' },
  'sound.level': { id: 'fill', target: 'drums' },
  'camera.motion': { id: 'rotate', target: 'all', dir: 1 },
  'rotation.rate': { id: 'octave', target: 'lead' },
  cover: { id: 'drumsOut' },
  proximity: { id: 'mute', target: 'lead' },
  'pointer.force': { id: 'ratchet', target: 'drums' },
  'motion.event': { id: 'fifth' },
  'controller.trigger': { id: 'fxThrow' },
};

/** How a continuous sensor acts: an effect, and whether its zones lean either way around the middle. */
export interface SensorEffect {
  effect: Effect;
  centered: boolean;
}

/** Continuous sensors by kind; the others act by timescale (see `sensorEffect`). */
export const SENSOR_EFFECTS: Readonly<Record<string, SensorEffect>> = {
  'orientation.pitch': { effect: { id: 'fifth' }, centered: true },
  'orientation.roll': { effect: { id: 'mode' }, centered: true },
  'pointer.y': { effect: { id: 'octave', target: 'melodic' }, centered: true },
  'pointer.x': { effect: { id: 'rotate', target: 'drums', dir: 1 }, centered: true },
  light: { effect: { id: 'brightness' }, centered: false },
  'camera.luma': { effect: { id: 'brightness' }, centered: false },
  'screen.brightness': { effect: { id: 'brightness' }, centered: false },
  'camera.hue': { effect: { id: 'chords' }, centered: false },
  heading: { effect: { id: 'chords' }, centered: false },
  'lid.angle': { effect: { id: 'addTrack' }, centered: false },
  'geo.place': { effect: { id: 'fifth' }, centered: false },
};

/** What a continuous sensor may do in each domain, when its kind's own effect lies elsewhere. */
const DOMAIN_SENSOR_EFFECTS: Readonly<Record<Domain, readonly SensorEffect[]>> = {
  rhythm: [
    { effect: { id: 'rotate', target: 'drums', dir: 1 }, centered: true },
    { effect: { id: 'swing' }, centered: false },
  ],
  harmony: [
    { effect: { id: 'fifth' }, centered: true },
    { effect: { id: 'mode' }, centered: true },
    { effect: { id: 'chords' }, centered: false },
  ],
  sound: [
    { effect: { id: 'brightness' }, centered: false },
    { effect: { id: 'rewrite', target: 'melodic' }, centered: false },
  ],
  space: [{ effect: { id: 'space' }, centered: false }],
  motion: [
    { effect: { id: 'addTrack' }, centered: false },
    { effect: { id: 'thin', target: 'rhythmic' }, centered: false },
  ],
};

/**
 * The effect of a continuous sensor, or undefined for channels that act
 * through presses instead (keys, buttons, and fast sensors such as a shake,
 * whose onsets are presses; pointer speed does nothing). With `owned`, the
 * domains the sensor's areas lie in: it keeps its kind's own effect when
 * that is one of them, else picks one from them, leaving out `exclude`d
 * effects (the instrument changes, when the instruments are fixed).
 */
export function sensorEffect(
  desc: SensorDescriptor,
  timescale: Timescale,
  owned?: readonly Domain[],
  exclude?: ReadonlySet<EffectId>,
): SensorEffect | undefined {
  if (PRESS_KINDS.has(desc.kind) || timescale === 'fast') return undefined;
  const [lo, hi] = desc.range ?? [0, 1];
  const own: SensorEffect =
    SENSOR_EFFECTS[desc.kind] ??
    (timescale === 'slow'
      ? { effect: { id: 'space' }, centered: false }
      : {
          effect: { id: 'rewrite', target: 1 + (hashString(desc.id) % MAX_TRACKS), wrap: true },
          centered: lo < 0 && hi > 0,
        });
  if (!owned || owned.length === 0 || owned.includes(EFFECT_DOMAIN[own.effect.id])) return own;
  const pool = owned
    .flatMap((d) => DOMAIN_SENSOR_EFFECTS[d])
    .filter((e) => !exclude?.has(e.effect.id));
  return pool.length > 0 ? (pool[hashString(desc.id) % pool.length] as SensorEffect) : own;
}

const TARGET_NAMES: Record<Exclude<Target, number>, string> = {
  drums: 'the drums',
  melodic: 'the melody',
  lead: 'the lead',
  rhythmic: 'every pattern',
  all: 'every track',
};

function targetName(t: Target | undefined): string {
  if (t === undefined) return '';
  return typeof t === 'number' ? `T${t}` : TARGET_NAMES[t];
}

/** A short description of an effect, e.g. "Rotate T1" or "Key up a fifth". */
export function effectLabel(e: Effect): string {
  const t = targetName(e.target);
  switch (e.id) {
    case 'mute':
      return `Mute ${t}`;
    case 'rewrite':
      return `Rewrite ${t}`;
    case 'rotate':
      return `Rotate ${t} ${e.dir === -1 ? 'left' : 'right'}`;
    case 'octave':
      return `Octave ${t}`;
    case 'thin':
      return `Thin ${t}`;
    case 'fill':
      return `Fill ${t}`;
    case 'reverse':
      return `Reverse ${t}`;
    case 'ratchet':
      return `Rolls on ${t}`;
    case 'machine':
      return `Swap the instruments of ${t}`;
    case 'addTrack':
      return 'Add a track';
    case 'drumsOut':
      return 'Drums out';
    case 'fxThrow':
      return 'Effect throws';
    case 'halfTime':
      return 'Half time';
    case 'doubleTime':
      return 'Double time';
    case 'fifth':
      return 'Key up a fifth';
    case 'transpose':
      return `Key ${e.dir === -1 ? 'down' : 'up'} a semitone`;
    case 'mode':
      return 'Brighter mode';
    case 'chords':
      return 'Other chords';
    case 'chordRate':
      return 'Chord speed';
    case 'swing':
      return 'More swing';
    case 'space':
      return 'More space';
    case 'brightness':
      return 'Brighter';
  }
}

/**
 * What an effect does to this song, naming the tracks it lands on: "Rewrite
 * T1 · Triangle bass", "Mute T6 · no such track".
 */
export function describeEffect(song: SongSpec, e: Effect): string {
  const label = effectLabel(e);
  if (e.target === undefined) return label;
  const tracks = effectTargets(song, e);
  if (tracks.length === 0) return `${label} · no such track`;
  const names = tracks.map((t) => machineOf(song, t)?.label ?? t.machine);
  return `${label} · ${names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ')}`;
}

/** What an effect does, without its target: "Rotate right", "Key up a fifth". */
export function effectName(e: Effect): string {
  switch (e.id) {
    case 'mute':
      return 'Mute';
    case 'rewrite':
      return 'Rewrite';
    case 'rotate':
      return e.dir === -1 ? 'Rotate left' : 'Rotate right';
    case 'octave':
      return 'Octave';
    case 'thin':
      return 'Thin';
    case 'fill':
      return 'Fill';
    case 'reverse':
      return 'Reverse';
    case 'ratchet':
      return 'Rolls';
    case 'machine':
      return 'Swap instruments';
    default:
      return effectLabel(e);
  }
}

const MELODIC: readonly TrackRole[] = ['lead', 'arp', 'chords', 'pad', 'bass', 'drone'];
const RHYTHMIC: readonly TrackRole[] = ['drum', 'bass', 'lead', 'arp', 'chords'];

/** The tracks an effect works on: none for a track number past the last, unless it wraps. */
export function effectTargets(song: SongSpec, e: Effect): TrackSpec[] {
  const playing = song.tracks.filter((t) => t.role !== 'fx');
  if (playing.length === 0) return [];
  const target = e.target;
  if (typeof target === 'number') {
    if (target > playing.length && !e.wrap) return [];
    return [playing[(target - 1) % playing.length] as TrackSpec];
  }
  switch (target ?? 'all') {
    case 'drums': {
      const drums = playing.filter((t) => t.role === 'drum');
      if (drums.length > 0) return drums;
      const rhythmic = playing.filter((t) => RHYTHMIC.includes(t.role));
      return rhythmic.length > 0 ? rhythmic : playing;
    }
    case 'melodic': {
      const melodic = playing.filter((t) => MELODIC.includes(t.role));
      return melodic.length > 0 ? melodic : playing;
    }
    case 'lead': {
      const lead = ['lead', 'arp', 'chords', 'pad', 'bass']
        .map((r) => playing.find((t) => t.role === r))
        .find((t) => t);
      return [lead ?? (playing[0] as TrackSpec)];
    }
    case 'rhythmic': {
      const rhythmic = playing.filter((t) => RHYTHMIC.includes(t.role));
      return rhythmic.length > 0 ? rhythmic : playing;
    }
    default:
      return playing;
  }
}

/** A number per track, stable across edits. */
function slotNumber(spec: TrackSpec): number {
  return Number(spec.slot.slice(1)) || hashString(spec.slot);
}

/** −2..2, cycling as the count grows: up, further up, down, a little down, back. */
function cycle5(c: number): number {
  return mod(c + 2, 5) - 2;
}

/** The positions of a track's steps that pass a test. */
function indices(spec: TrackSpec, test: (i: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < spec.length; i++) if (test(i)) out.push(i);
  return out;
}

function rotate(spec: TrackSpec, by: number): void {
  const n = Math.max(1, spec.length);
  const shift = mod(by, n);
  if (shift === 0) return;
  const old = spec.trigs.slice(0, n);
  for (let i = 0; i < n; i++) spec.trigs[i] = old[mod(i - shift, n)];
}

function machineOf(song: SongSpec, spec: TrackSpec): Machine | undefined {
  return song.style.palette.machines[spec.machine];
}

/**
 * Applies one effect `c` times to the song, in place. `c` comes from the
 * input: 1 for a single press, the press count when presses accumulate, or a
 * zone (−2..2 or 0..4) for a continuous sensor. Every effect cycles, so each
 * further press changes something, and `c = 0` changes nothing.
 */
export function applyEffect(song: SongSpec, e: Effect, c: number): void {
  if (c === 0) return;
  const odd = mod(c, 2) === 1;
  const k = Math.min(3, Math.abs(c));
  const { palette } = song.style;
  switch (e.id) {
    case 'mute':
      if (odd) for (const t of effectTargets(song, e)) song.muted.add(t.slot);
      return;
    case 'drumsOut': {
      if (!odd) return;
      const drums = song.tracks.filter((t) => t.role === 'drum');
      // No drums: the busiest track drops out instead.
      const busiest = song.tracks
        .filter((t) => t.role !== 'fx')
        .sort(
          (a, b) => indices(b, (i) => !!b.trigs[i]).length - indices(a, (i) => !!a.trigs[i]).length,
        )[0];
      for (const t of drums.length > 0 ? drums : busiest ? [busiest] : []) song.muted.add(t.slot);
      return;
    }
    case 'rewrite':
      for (const t of effectTargets(song, e)) {
        const machine = machineOf(song, t);
        if (!machine) continue;
        if (t.role === 'drone') {
          // A drone holds one note: rewriting it changes how long it holds, and its fifth.
          const lengths = [16, 32, 24, 64, 48];
          t.length = lengths[mod(c, lengths.length)] as number;
          t.trigs = writePattern(new Rng(hashInts(song.seed, c)), t, machine, 0.6);
          if (odd) t.fifth = !t.fifth;
          continue;
        }
        const before = indices(t, (i) => !!t.trigs[i]).join();
        const rng = new Rng(hashInts(song.seed, slotNumber(t), c, 0x7e));
        t.trigs = writePattern(rng, t, machine, 0.6);
        // A pattern that came out on the same steps (a pad, a pulse) moves instead.
        if (indices(t, (i) => !!t.trigs[i]).join() === before)
          rotate(t, 1 + mod(c, Math.max(1, t.length - 1)));
      }
      return;
    case 'rotate':
      for (const t of effectTargets(song, e)) rotate(t, c * (e.dir ?? 1));
      return;
    case 'reverse':
      if (!odd) return;
      for (const t of effectTargets(song, e)) {
        const n = Math.max(1, t.length);
        const old = t.trigs.slice(0, n);
        for (let i = 0; i < n; i++) t.trigs[i] = old[n - 1 - i];
      }
      return;
    case 'octave': {
      const k = cycle5(c);
      for (const t of effectTargets(song, e)) {
        if (t.role === 'drum') {
          t.base.tune = clamp(t.base.tune + 0.18 * k);
          continue;
        }
        // Whole octaves, kept inside what instruments can play.
        const shift = Math.max(24 - t.range[0], Math.min(108 - t.range[1], 12 * k));
        t.range = [t.range[0] + shift, t.range[1] + shift];
      }
      return;
    }
    case 'thin':
      for (const t of effectTargets(song, e)) {
        const placed = indices(t, (i) => i > 0 && !!t.trigs[i]);
        const drop = placed.filter((i) => hashInts(song.seed, slotNumber(t), i, 0x7417) % 4 < k);
        // At least one step changes, however short the pattern.
        for (const i of drop.length > 0 ? drop : placed.slice(0, 1)) t.trigs[i] = undefined;
      }
      return;
    case 'fill':
      for (const t of effectTargets(song, e)) {
        const empty = indices(t, (i) => !t.trigs[i]);
        const add = empty.filter((i) => hashInts(song.seed, slotNumber(t), i, 0xf111) % 4 < k);
        for (const i of add.length > 0 ? add : empty.slice(0, 1)) {
          t.trigs[i] = newTrigAt(new Rng(hashInts(song.seed, slotNumber(t), i, 0xf112)), t, i);
        }
      }
      return;
    case 'ratchet':
      for (const t of effectTargets(song, e)) {
        const placed = indices(t, (i) => !!t.trigs[i]);
        const rolled = placed.filter(
          (i) => hashInts(song.seed, slotNumber(t), i, 0x7a7c) % 2 === 0,
        );
        for (const i of rolled.length > 0 ? rolled : placed.slice(0, 1)) {
          const trig = t.trigs[i];
          if (trig) t.trigs[i] = { ...trig, retrig: { count: 1 + k, rate: 0.5, curve: -0.3 } };
        }
      }
      return;
    case 'machine':
      for (const t of effectTargets(song, e)) {
        const own = palette.slots.find((s) => s.machines.includes(t.machine))?.machines ?? [];
        // A slot with one machine borrows the palette's other machines of the same role.
        const options =
          own.length > 1
            ? own
            : Object.keys(palette.machines)
                .sort()
                .filter((id) => palette.machines[id]?.role === t.role);
        if (options.length < 2) continue;
        const id = options[mod(options.indexOf(t.machine) + c, options.length)] as string;
        const machine = palette.machines[id];
        if (!machine) continue;
        t.machine = id;
        t.range = machine.range ?? [48, 84];
        if (machine.patch.type === 'drum') t.voice = machine.patch.voice;
      }
      return;
    case 'addTrack': {
      const used = new Set(song.tracks.map((t) => t.machine));
      const free = palette.slots.filter((s) => !s.machines.some((m) => used.has(m)));
      // Every slot taken: another take of an optional one (a second lead, more percussion).
      const unused = free.length > 0 ? free : palette.slots.filter((s) => !s.required);
      const playing = song.tracks.filter((t) => t.role !== 'fx').length;
      const n = Math.min(Math.abs(c), unused.length, MAX_TRACKS - playing);
      const next = Math.max(0, ...song.tracks.map(slotNumber).filter((x) => x < 100)) + 1;
      for (let j = 0; j < n; j++) {
        const option = unused[j] as (typeof unused)[number];
        const machineId = option.machines[
          hashInts(song.seed, j, 0xadd) % option.machines.length
        ] as string;
        const machine = palette.machines[machineId];
        if (!machine) continue;
        const track = generateTrack(new Rng(hashInts(song.seed, j, 0xadd1)), {
          slot: `t${next + j}`,
          machineId,
          machine,
          palette,
          density: 0.55,
        });
        const fx = song.tracks.findIndex((t) => t.role === 'fx');
        song.tracks.splice(fx < 0 ? song.tracks.length : fx, 0, track);
      }
      return;
    }
    case 'fxThrow': {
      const lane = song.tracks.find((t) => t.role === 'fx');
      const pool = (palette.effects ?? FX_IDS).filter((f) => !NO_THROW.has(f));
      if (!lane || pool.length === 0) return;
      const throws = Math.min(4, Math.abs(c));
      const bars = Math.max(1, Math.floor(lane.length / 16));
      for (let j = 0; j < throws; j++) {
        const bar = Math.floor((j * bars) / throws);
        const at = Math.min(lane.length - 1, bar * 16 + 14);
        const fx = pool[hashInts(song.seed, j, 0xf7) % pool.length] as (typeof pool)[number];
        lane.trigs[at] = {
          fx,
          vel: 0.9,
          len: FX_INFO[fx].steps,
          prob: 1,
          cond: { kind: 'always' },
          micro: 0,
        };
      }
      return;
    }
    case 'halfTime':
      if (odd) song.timeScale *= 0.5;
      return;
    case 'doubleTime':
      if (odd) song.timeScale *= 2;
      return;
    case 'fifth':
      song.root = mod(song.root + 7 * c, 12);
      return;
    case 'transpose':
      song.root = mod(song.root + c * (e.dir ?? 1), 12);
      return;
    case 'mode':
      // Two steps along the ladder, so the scale clearly changes (often minor ↔ major).
      song.modeIndex += 2 * c;
      return;
    case 'chords':
      song.chordVariant += c;
      return;
    case 'chordRate':
      song.chordRateIndex += c;
      return;
    case 'swing':
      song.swingLevel = mod(song.swingLevel + c, LEVELS);
      return;
    case 'space':
      song.spaceLevel = mod(song.spaceLevel + c, LEVELS);
      return;
    case 'brightness':
      song.brightnessLevel = mod(song.brightnessLevel + c, LEVELS);
      return;
  }
}
