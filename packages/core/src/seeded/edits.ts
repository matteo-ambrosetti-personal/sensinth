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
 * - `zones`: their range is split into zones; each zone is one version of
 *   their effect, and coming back to a zone brings back the same song;
 * - `steps`: entering another zone counts as one press of their effect.
 */
export type SensorMode = 'zones' | 'steps';
export const SENSOR_MODES: readonly SensorMode[] = ['zones', 'steps'];

export interface EditOptions {
  repeat: RepeatMode;
  sensors: SensorMode;
}

/** An edit as the user sees it: which input, what it does, how many times. */
export interface EditView extends SongEdit {
  /** The input, e.g. "Key A" or "Tilt forward–back". */
  source: string;
  /** For zones: the zone, −2..2 or 0..4. */
  zone?: number;
}

/** Zones a continuous sensor's range is split into. */
export const ZONES = 5;
/** How far past a zone's edge a reading must go before the zone changes. */
const HYSTERESIS = 0.04;

/** The zone of a reading 0..1, keeping the previous zone while the reading stays near it. */
export function zoneOf(x: number, previous: number | undefined): number {
  if (previous !== undefined) {
    const lo = previous / ZONES - HYSTERESIS;
    const hi = (previous + 1) / ZONES + HYSTERESIS;
    if (x >= lo && x <= hi) return previous;
  }
  return Math.min(ZONES - 1, Math.max(0, Math.floor(x * ZONES)));
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
    own: { sensors?: SensorMode; repeat?: RepeatMode } = {},
  ): void {
    const before = this.zones.get(id);
    const zone = zoneOf(x, before?.zone);
    if (!before) {
      const sensors = own.sensors ?? this.options.sensors;
      this.zones.set(id, {
        source,
        map,
        zone,
        sensors,
        ...(own.repeat ? { repeat: own.repeat } : {}),
      });
      return;
    }
    if (zone === before.zone) return;
    if (before.sensors === 'steps') {
      for (let i = Math.abs(zone - before.zone); i > 0; i--) {
        this.press(`step:${id}`, source, map.effect, before.repeat);
      }
    }
    before.zone = zone;
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
        const count = z.map.centered ? z.zone - Math.floor(ZONES / 2) : z.zone;
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
