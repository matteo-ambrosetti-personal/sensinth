import { mod } from '../math';
import { hashString } from '../random';
import type { SensorDescriptor, SensorEvent, Timescale } from '../sensors/types';
import type { RepeatMode, SensorMode } from './edits';
import {
  KEY_CODES,
  KEY_EFFECTS,
  ONSET_EFFECTS,
  PRESS_CATALOGUE,
  SENSOR_EFFECTS,
  keyName,
  sensorEffect,
  type Effect,
  type EffectId,
  type SensorEffect,
} from './effects';
import { PRESS_KINDS } from './inputs';

/**
 * What you chose for one input, or one group of keys: another effect (or
 * none), and how it repeats. Anything left out keeps its default.
 */
export interface InputRule {
  /** The effect instead of the default; for keys that act on track n, without a target. */
  effect?: Effect | 'none';
  /** What pressing it again does, instead of the "Same key again" setting. */
  repeat?: RepeatMode;
  /** For continuous sensors: by zone or in steps, instead of the "Sensors" setting. */
  sensors?: SensorMode;
}

/** Your choices, by row id (see `INPUT_ROWS`). */
export type InputMap = Readonly<Record<string, InputRule>>;

/** Effects that change the instruments: off while the instruments stay the seed's. */
export const INSTRUMENT_EFFECTS: ReadonlySet<EffectId> = new Set<EffectId>(['machine', 'addTrack']);

/** Effects that work on tracks, so they take a target. */
export const TRACK_EFFECTS: ReadonlySet<EffectId> = new Set<EffectId>([
  'mute',
  'rewrite',
  'rotate',
  'octave',
  'thin',
  'fill',
  'reverse',
  'ratchet',
  'machine',
]);

/** Every effect an input can be given, in the order the menus list them. */
export const EFFECT_CHOICES: readonly Effect[] = [
  { id: 'mute' },
  { id: 'rewrite' },
  { id: 'rotate', dir: 1 },
  { id: 'rotate', dir: -1 },
  { id: 'octave' },
  { id: 'thin' },
  { id: 'fill' },
  { id: 'reverse' },
  { id: 'ratchet' },
  { id: 'machine' },
  { id: 'addTrack' },
  { id: 'drumsOut' },
  { id: 'fxThrow' },
  { id: 'halfTime' },
  { id: 'doubleTime' },
  { id: 'fifth' },
  { id: 'transpose', dir: 1 },
  { id: 'transpose', dir: -1 },
  { id: 'mode' },
  { id: 'chords' },
  { id: 'chordRate' },
  { id: 'swing' },
  { id: 'space' },
  { id: 'brightness' },
];

/** A row of the input map: one input or a group of keys, and what it does by default. */
export interface InputRow {
  id: string;
  section: 'keys' | 'controllers' | 'onsets' | 'sensors';
  /** As shown: "1–8", "O", "Tilt forward–back", "Shake". */
  name: string;
  /** Keys that act on tracks 1, 2, 3…, in that order; their effects take no target. */
  perTrack?: readonly string[];
  /**
   * The default effect, or undefined where each input has its own (other
   * keys, MIDI keys, buttons, other sensors).
   */
  effect?: Effect;
  /** True for continuous sensors, which act by zone or in steps. */
  continuous?: boolean;
}

const SENSOR_NAMES: Record<string, string> = {
  'orientation.pitch': 'Tilt forward–back',
  'orientation.roll': 'Tilt left–right',
  'pointer.y': 'Pointer up–down',
  'pointer.x': 'Pointer left–right',
  light: 'Light',
  'camera.luma': 'Camera brightness',
  'screen.brightness': 'Screen brightness',
  'camera.hue': 'Camera colour',
  heading: 'Compass',
  'lid.angle': 'Lid angle',
  'geo.place': 'Place',
};

const ONSET_NAMES: Record<string, string> = {
  'motion.accel': 'Shake',
  'sound.level': 'Clap or knock',
  'camera.motion': 'Movement on camera',
  'rotation.rate': 'Twist',
  cover: 'Cover closed',
  proximity: 'Hand over the phone',
  'pointer.force': 'Hard press',
  'motion.event': 'Started moving',
  'controller.trigger': 'Controller trigger',
};

function buildRows(): InputRow[] {
  const rows: InputRow[] = [];
  const groups = new Map<string, InputRow>();
  for (const [code, effect] of Object.entries(KEY_EFFECTS)) {
    if (typeof effect.target === 'number') {
      // Keys that do the same to tracks 1, 2, 3… share a row.
      const id = `keys:${effect.id}`;
      const row = groups.get(id);
      if (row) {
        (row.perTrack as string[]).push(code);
        continue;
      }
      const { target: _track, ...rest } = effect;
      const next: InputRow = { id, section: 'keys', name: '', perTrack: [code], effect: rest };
      groups.set(id, next);
      rows.push(next);
    } else {
      rows.push({ id: `key:${code}`, section: 'keys', name: keyName(code), effect });
    }
  }
  for (const row of groups.values()) {
    const keys = row.perTrack as string[];
    row.name = `${keyName(keys[0] as string)}–${keyName(keys[keys.length - 1] as string)}`;
  }
  rows.push({ id: 'keys:other', section: 'keys', name: 'Other keys' });
  rows.push({ id: 'notes', section: 'controllers', name: 'MIDI keys' });
  rows.push({ id: 'buttons', section: 'controllers', name: 'Controller buttons' });
  for (const [kind, effect] of Object.entries(ONSET_EFFECTS)) {
    rows.push({ id: `onset:${kind}`, section: 'onsets', name: ONSET_NAMES[kind] ?? kind, effect });
  }
  rows.push({ id: 'onset:other', section: 'onsets', name: 'Other sudden changes' });
  for (const [kind, s] of Object.entries(SENSOR_EFFECTS)) {
    rows.push({
      id: `sensor:${kind}`,
      section: 'sensors',
      name: SENSOR_NAMES[kind] ?? kind,
      effect: s.effect,
      continuous: true,
    });
  }
  rows.push({
    id: 'sensor:slow',
    section: 'sensors',
    name: 'Slow sensors (heat, battery, time…)',
    effect: { id: 'space' },
    continuous: true,
  });
  rows.push({ id: 'sensor:other', section: 'sensors', name: 'Other sensors', continuous: true });
  return rows;
}

/** Every input you can map, by section: keys, controllers, sudden changes, sensors. */
export const INPUT_ROWS: readonly InputRow[] = buildRows();

/** For each key, its row and, for keys that act on tracks, which track. */
const KEY_ROWS = new Map<string, { row: string; track?: number }>();
for (const row of INPUT_ROWS) {
  if (row.perTrack)
    row.perTrack.forEach((code, i) => KEY_ROWS.set(code, { row: row.id, track: i + 1 }));
  else if (row.id.startsWith('key:')) KEY_ROWS.set(row.id.slice(4), { row: row.id });
}

/** A press as the input map sees it: what it does, and how it repeats if not the default. */
export interface MappedPress {
  effect: Effect;
  repeat?: RepeatMode;
}

/** A continuous sensor as the input map sees it. */
export interface MappedSensor {
  map: SensorEffect;
  sensors?: SensorMode;
  repeat?: RepeatMode;
}

export interface MapperOptions {
  /** Your changes to the defaults. */
  mapping?: InputMap;
  /** False keeps the instruments the seed chose: no input swaps or adds one (default true). */
  instruments?: boolean;
}

/**
 * Decides what each input does: its default effect, or what you chose for
 * it, minus effects that change instruments when those stay fixed. The same
 * input always gets the same answer.
 */
export class InputMapper {
  private readonly mapping: InputMap;
  private readonly instruments: boolean;
  /** Effects inputs without one of their own pick from (other keys, MIDI keys…). */
  private readonly catalogue: readonly Effect[];

  constructor(options: MapperOptions = {}) {
    this.mapping = options.mapping ?? {};
    this.instruments = options.instruments ?? true;
    this.catalogue = this.instruments
      ? PRESS_CATALOGUE
      : PRESS_CATALOGUE.filter((e) => !INSTRUMENT_EFFECTS.has(e.id));
  }

  /** What a press does: a key, a MIDI key, a button or an onset of a sensor of this kind. */
  press(event: SensorEvent, kind: string): MappedPress | undefined {
    const v = Math.round(event.value);
    const n = this.catalogue.length;
    switch (event.kind) {
      case 'key': {
        const code = KEY_CODES[v];
        const at = code !== undefined ? KEY_ROWS.get(code) : undefined;
        if (code !== undefined && at) {
          return this.resolve(at.row, KEY_EFFECTS[code] as Effect, at.track);
        }
        return this.resolve('keys:other', this.catalogue[mod(v, n)] as Effect);
      }
      case 'note':
        return this.resolve('notes', this.catalogue[mod(v, n)] as Effect);
      case 'button':
        return this.resolve('buttons', this.catalogue[mod(v, n)] as Effect);
      case 'onset': {
        const own = ONSET_EFFECTS[kind];
        if (own) return this.resolve(`onset:${kind}`, own);
        return this.resolve('onset:other', this.catalogue[hashString(kind) % n] as Effect);
      }
    }
  }

  /** What a continuous sensor does, or undefined for inputs that act through presses. */
  sensor(desc: SensorDescriptor, timescale: Timescale): MappedSensor | undefined {
    const own = sensorEffect(desc, timescale);
    if (!own || PRESS_KINDS.has(desc.kind)) return undefined;
    const row =
      desc.kind in SENSOR_EFFECTS
        ? `sensor:${desc.kind}`
        : timescale === 'slow'
          ? 'sensor:slow'
          : 'sensor:other';
    const mapped = this.resolve(row, own.effect);
    if (!mapped) return undefined;
    const rule = this.mapping[row];
    return {
      map: { effect: mapped.effect, centered: own.centered },
      ...(rule?.sensors ? { sensors: rule.sensors } : {}),
      ...(mapped.repeat ? { repeat: mapped.repeat } : {}),
    };
  }

  private resolve(row: string, fallback: Effect, track?: number): MappedPress | undefined {
    const rule = this.mapping[row];
    if (rule?.effect === 'none') return undefined;
    let effect = fallback;
    if (rule?.effect) {
      const { target: _target, ...chosen } = rule.effect;
      effect =
        track !== undefined
          ? TRACK_EFFECTS.has(chosen.id)
            ? { ...chosen, target: track }
            : chosen
          : rule.effect;
    }
    if (!this.instruments && INSTRUMENT_EFFECTS.has(effect.id)) return undefined;
    return { effect, ...(rule?.repeat ? { repeat: rule.repeat } : {}) };
  }
}

/** True when an effect's target is a choice (track effects on single inputs). */
export function takesTarget(e: Effect): boolean {
  return TRACK_EFFECTS.has(e.id);
}
