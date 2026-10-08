import { clamp, mod } from '../math';
import type { SensorHub } from '../sensors/hub';
import { timescaleOf } from '../sensors/kinds';
import type { SensorDescriptor, SensorEvent, Timescale } from '../sensors/types';
import { OnsetDetector } from '../signal/onset';

/** Kinds whose channels are presses: their events count, not their readings. */
export const PRESS_KINDS: ReadonlySet<string> = new Set([
  'keys.rate',
  'midi.note',
  'controller.buttons',
]);

/** Fast kinds whose rises are not events of their own (moving the mouse is not a hit). */
const NO_ONSETS: ReadonlySet<string> = new Set(['pointer.speed', ...PRESS_KINDS]);

/** Onset threshold on the scaled reading, 0..1. */
const ONSET_THRESHOLD = 0.25;
/** Ranges this many times wider than `minSpan` are read on a log scale. */
const LOG_RANGE = 50;

/** One channel's reading at a moment, on its fixed scale. */
export interface InputReading {
  id: string;
  kind: string;
  label: string;
  timescale: Timescale;
  /** The reading scaled to 0..1 by `absoluteScale`. */
  x: number;
}

/**
 * Maps a raw reading onto 0..1 with a fixed, monotonic curve, so the same
 * reading always lands in the same place:
 * - a fixed range is read linearly (circular ones wrap);
 * - a wide learned range (light in lux, speeds) is read on a log scale;
 * - a channel with no range is read around its value when Play was pressed.
 */
export function absoluteScale(desc: SensorDescriptor, ref: number): (v: number) => number {
  const range = desc.range;
  if (range) {
    const [lo, hi] = range;
    const span = hi - lo;
    if (!(span > 0)) return () => 0.5;
    if (desc.circular) return (v) => mod(v - lo, span) / span;
    const adaptive = desc.adaptive ?? false;
    const unit = desc.minSpan ?? 0;
    if (adaptive && lo >= 0 && unit > 0 && span / unit >= LOG_RANGE) {
      const top = Math.log1p(span / unit);
      return (v) => clamp(Math.log1p(Math.max(0, v - lo) / unit) / top);
    }
    return (v) => clamp((v - lo) / span);
  }
  const width = Math.max(desc.minSpan ?? 0, Math.abs(ref) * 0.25) || 1;
  return (v) => 0.5 + 0.5 * Math.tanh((v - ref) / width);
}

class ChannelLog {
  readonly timescale: Timescale;
  private readonly onsets: OnsetDetector | undefined;
  private scale: ((v: number) => number) | undefined;
  private samples: { t: number; v: number }[] = [];
  private events: SensorEvent[] = [];
  private lastPushT: number | undefined;

  constructor(readonly desc: SensorDescriptor) {
    this.timescale = timescaleOf(desc);
    if (this.timescale === 'fast' && !NO_ONSETS.has(desc.kind) && !desc.circular) {
      this.onsets = new OnsetDetector({ threshold: ONSET_THRESHOLD });
    }
  }

  /** Adds a reading; returns the strength of an onset it starts, or 0. */
  push(t: number, v: number): number {
    if (!Number.isFinite(t) || !Number.isFinite(v)) return 0;
    const last = this.samples[this.samples.length - 1];
    if (last && t < last.t) return 0;
    this.samples.push({ t, v });
    this.scale ??= absoluteScale(this.desc, v);
    const dt = this.lastPushT === undefined ? 0 : t - this.lastPushT;
    this.lastPushT = t;
    return this.onsets ? this.onsets.update(this.scale(v), dt) : 0;
  }

  addEvent(e: SensorEvent): void {
    const last = this.events[this.events.length - 1];
    if (last && e.t < last.t) return;
    this.events.push(e);
  }

  /** The latest reading at or before `t`, scaled; undefined before the first. */
  readingAt(t: number): number | undefined {
    let v: number | undefined;
    for (const s of this.samples) {
      if (s.t > t) break;
      v = s.v;
    }
    if (v === undefined || !this.scale) return undefined;
    // Older samples are no longer needed: readings are asked for in time order.
    let keep = 0;
    while (keep + 1 < this.samples.length && (this.samples[keep + 1] as { t: number }).t <= t) {
      keep++;
    }
    if (keep > 0) this.samples = this.samples.slice(keep);
    return this.scale(v);
  }

  /**
   * Events up to `to`, dropping them from the log. One stamped at or before
   * `from` arrived late (a slow timer, a throttled replay): it counts now
   * rather than never.
   */
  takeEvents(from: number, to: number): SensorEvent[] {
    const out = this.events
      .filter((e) => e.t <= to)
      .map((e) => (e.t > from ? e : { ...e, t: Math.min(to, Math.max(from, e.t)) }));
    this.events = this.events.filter((e) => e.t > to);
    return out;
  }
}

export interface InputModelOptions {
  /** Sensor-clock seconds at which the music starts. */
  origin: number;
}

/**
 * The inputs of deterministic mode. It keeps a timestamped log of every
 * channel's readings and events and reads them at given times, so what the
 * music hears depends only on what the sensors did and when, never on when
 * a timer happened to fire:
 * - a reading is the latest sample at that time, scaled by a fixed curve;
 * - presses are key presses, MIDI keys and buttons, plus onsets of fast
 *   sensors (a shake, a clap) found in the readings sample by sample.
 */
export class InputModel {
  readonly origin: number;
  private readonly logs = new Map<string, ChannelLog>();
  private readonly untap: () => void;
  /** Channels removed since `takeRemoved` was last called. */
  private removed: string[] = [];

  constructor(
    private readonly hub: SensorHub,
    opts: InputModelOptions,
  ) {
    this.origin = opts.origin;
    for (const ch of hub.list()) {
      const log = new ChannelLog(ch.desc);
      // What the channel read when Play was pressed.
      if (Number.isFinite(ch.raw) && Number.isFinite(ch.lastT)) log.push(ch.lastT, ch.raw);
      this.logs.set(ch.desc.id, log);
    }
    this.untap = hub.tap({
      announce: (desc) => this.logs.set(desc.id, new ChannelLog(desc)),
      remove: (id) => {
        if (this.logs.delete(id)) this.removed.push(id);
      },
      push: (s) => {
        const log = this.logs.get(s.id);
        if (!log) return;
        const strength = log.push(s.t, s.v);
        if (strength > 0 && (this.hub.onsetGate?.(s.id, s.t) ?? true)) {
          log.addEvent({ id: s.id, t: s.t, kind: 'onset', value: 0, velocity: strength });
        }
      },
      event: (e) => this.logs.get(e.id)?.addEvent(e),
    });
  }

  /** The label and kind of a channel, if it is still there. */
  describe(id: string): SensorDescriptor | undefined {
    return this.logs.get(id)?.desc;
  }

  /** Every channel with a reading at time `t` (sensor clock), sorted by id. */
  readings(t: number): InputReading[] {
    const out: InputReading[] = [];
    for (const id of [...this.logs.keys()].sort()) {
      const log = this.logs.get(id) as ChannelLog;
      const x = log.readingAt(t);
      if (x === undefined) continue;
      const { kind, label } = log.desc;
      out.push({ id, kind, label, timescale: log.timescale, x });
    }
    return out;
  }

  /** Channels that went away since the last call. */
  takeRemoved(): string[] {
    const out = this.removed;
    this.removed = [];
    return out;
  }

  /** Every channel in the log, sorted by id, with its timescale. */
  channels(): { desc: SensorDescriptor; timescale: Timescale }[] {
    return [...this.logs.keys()].sort().map((id) => {
      const log = this.logs.get(id) as ChannelLog;
      return { desc: log.desc, timescale: log.timescale };
    });
  }

  /** Presses and onsets up to `to` (see `takeEvents`), in time order (ties by channel id). */
  presses(from: number, to: number): SensorEvent[] {
    const out: SensorEvent[] = [];
    for (const log of this.logs.values()) out.push(...log.takeEvents(from, to));
    return out.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  dispose(): void {
    this.untap();
    this.logs.clear();
  }
}
