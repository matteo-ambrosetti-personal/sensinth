import { mod } from '../math';
import { hashString } from '../random';
import type { Effect, SensorEffect } from './effects';
import type { SongEdit } from './song';

/**
 * What pressing the same input again does:
 * - `toggle`: undoes it, so the song depends only on which effects are on;
 * - `accumulate`: applies it once more, so the song keeps moving;
 * - `once`: nothing; only the first press counts.
 */
export type RepeatMode = 'toggle' | 'accumulate' | 'once';
export const REPEAT_MODES: readonly RepeatMode[] = ['toggle', 'accumulate', 'once'];

/**
 * How continuous sensors (tilt, light, the lid…) act:
 * - `zones`: their range is split into zones; each zone away from where the
 *   sensor was at Play is one version of their effect, and coming back to a
 *   zone brings back the same song;
 * - `steps`: entering another zone counts as one press of their effect;
 * - `off`: they change nothing; only keys and other presses edit the song.
 */
export type SensorMode = 'zones' | 'steps' | 'off';
export const SENSOR_MODES: readonly SensorMode[] = ['zones', 'steps', 'off'];

export interface EditOptions {
  repeat: RepeatMode;
  sensors: SensorMode;
}

/** An edit as the user sees it: which input, what it does, how many times. */
export interface EditView extends SongEdit {
  /** The input, e.g. "Key A" or "Tilt forward–back". */
  source: string;
  /** For zones: how many zones the sensor is from where it was at Play, −4..4. */
  zone?: number;
  /** What it does to this song, e.g. "Rewrite T1 · Triangle bass". */
  description?: string;
}

/** A continuous sensor's zones, for the zone meters. */
export interface SensorZones {
  id: string;
  source: string;
  /** The zone it is in now, 0..ZONES−1, and the one it was in at Play. */
  zone: number;
  start: number;
  effect: Effect;
  sensors: SensorMode;
}

/** Zones a continuous sensor's range is split into. */
export const ZONES = 5;
/** How far past a zone's edge a reading must go before the zone changes. */
const HYSTERESIS = 0.04;

/**
 * The zone of a reading 0..1, keeping the previous zone while the reading
 * stays near it. For a circular reading (a compass, a hue) the band around
 * the previous zone wraps, so wobbling around north does not flip zones.
 */
export function zoneOf(x: number, previous: number | undefined, circular = false): number {
  if (previous !== undefined) {
    const lo = previous / ZONES - HYSTERESIS;
    const hi = (previous + 1) / ZONES + HYSTERESIS;
    const near = (v: number) => v >= lo && v <= hi;
    if (near(x) || (circular && (near(x + 1) || near(x - 1)))) return previous;
  }
  const v = circular ? mod(x, 1) : x;
  return Math.min(ZONES - 1, Math.max(0, Math.floor(v * ZONES)));
}

interface Pressed {
  source: string;
  effect: Effect;
  count: number;
  /** This input's own repeat setting, if the input map gives one. */
  repeat?: RepeatMode;
}

interface Zoned {
  source: string;
  map: SensorEffect;
  zone: number;
  /** The zone at the first reading (Play): being there changes nothing. */
  start: number;
  circular: boolean;
  sensors: SensorMode;
  repeat?: RepeatMode;
}

/**
 * Keeps track of what every input has done since Play, and turns it into
 * edits of the song. Feed it presses and readings in time order; ask for
 * the edits at a bar line.
 */
export class EditTracker {
  private readonly pressed = new Map<string, Pressed>();
  private readonly zones = new Map<string, Zoned>();
  /** Changes whenever anything that could change the edits happens. */
  version = 0;

  constructor(readonly options: EditOptions) {}

  /**
   * One press of an input (a key, a MIDI key, a button, an onset), with its
   * own repeat setting if it has one.
   */
  press(input: string, source: string, effect: Effect, repeat?: RepeatMode): void {
    const p = this.pressed.get(input) ?? {
      source,
      effect,
      count: 0,
      ...(repeat ? { repeat } : {}),
    };
    p.count++;
    this.pressed.set(input, p);
    this.version++;
  }

  /**
   * A continuous sensor's reading, 0..1, with what it does, and its own
   * zones-or-steps and repeat settings if it has them.
   */
  reading(
    id: string,
    source: string,
    x: number,
    map: SensorEffect,
    own: { sensors?: SensorMode; repeat?: RepeatMode; circular?: boolean } = {},
  ): void {
    const before = this.zones.get(id);
    const circular = before?.circular ?? own.circular ?? false;
    const zone = zoneOf(x, before?.zone, circular);
    if (!before) {
      const sensors = own.sensors ?? this.options.sensors;
      this.zones.set(id, {
        source,
        map,
        zone,
        start: zone,
        circular,
        sensors,
        ...(own.repeat ? { repeat: own.repeat } : {}),
      });
      this.version++;
      return;
    }
    if (zone === before.zone) return;
    if (before.sensors === 'steps') {
      for (let i = this.zonesApart(before, before.zone, zone); i > 0; i--) {
        this.press(`step:${id}`, source, map.effect, before.repeat);
      }
    }
    before.zone = zone;
    this.version++;
  }

  /** A channel went away: its zone stops counting (presses it made stay). */
  forget(id: string): void {
    if (this.zones.delete(id)) this.version++;
  }

  /** Every continuous sensor's zones, sorted by channel. */
  sensors(): SensorZones[] {
    return [...this.zones]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, z]) => ({
        id,
        source: z.source,
        zone: z.zone,
        start: z.start,
        effect: z.map.effect,
        sensors: z.sensors,
      }));
  }

  /** How many zones from `a` to `b`, the short way round for circular sensors. */
  private zonesApart(z: Zoned, a: number, b: number): number {
    const d = Math.abs(b - a);
    return z.circular ? Math.min(d, ZONES - d) : d;
  }

  /** Zones from the start, signed; the short way round for circular sensors. */
  private offset(z: Zoned): number {
    const d = z.zone - z.start;
    return z.circular ? mod(d + 2, ZONES) - 2 : d;
  }

  /** Every edit in effect now, sorted by input. */
  edits(): EditView[] {
    const out: EditView[] = [];
    for (const [input, p] of this.pressed) {
      const count = this.countOf(p.count, p.repeat ?? this.options.repeat);
      if (count !== 0) out.push({ input, source: p.source, effect: p.effect, count });
    }
    for (const [id, z] of this.zones) {
      if (z.sensors === 'zones') {
        const count = this.offset(z);
        if (count !== 0) {
          out.push({
            input: `zone:${id}`,
            source: z.source,
            effect: z.map.effect,
            count,
            zone: count,
          });
        }
      }
    }
    return out.sort((a, b) => (a.input < b.input ? -1 : a.input > b.input ? 1 : 0));
  }

  private countOf(presses: number, repeat: RepeatMode): number {
    switch (repeat) {
      case 'toggle':
        return presses % 2;
      case 'accumulate':
        return presses;
      case 'once':
        return Math.min(1, presses);
    }
  }
}

/** A short id for a set of edits: the same edits always give the same id. */
export function editsVersion(edits: readonly SongEdit[]): string {
  if (edits.length === 0) return 'base';
  const text = edits
    .map(
      (e) =>
        `${e.input}=${e.effect.id}:${String(e.effect.target ?? '')}:${e.effect.dir ?? ''}:${e.count}`,
    )
    .join('|');
  return hashString(text).toString(16).padStart(8, '0').slice(0, 6);
}
