import { clamp, mod, onePoleAlpha } from '../math';
import type { SensorHub } from '../sensors/hub';
import { timescaleOf } from '../sensors/kinds';
import type { SensorDescriptor, SensorEvent, Timescale } from '../sensors/types';
import { OnsetDetector } from '../signal/onset';

/** Kinds whose channels are presses: their events count, not their readings. */
export const EVENT_KINDS: ReadonlySet<string> = new Set([
  'keys.rate',
  'midi.note',
  'controller.buttons',
]);

/** Fast kinds whose rises are not events of their own (moving the mouse is not a hit). */
const NO_ONSETS: ReadonlySet<string> = new Set(['pointer.speed', ...EVENT_KINDS]);

/** Seconds of the kernel that turns press times into a rate. */
export const EVENT_TAU = 1;
/** Presses per second at which an event channel reads 0.5. */
const RATE_HALF = 3;
/** Onset threshold on the scaled reading, 0..1. */
const ONSET_THRESHOLD = 0.25;
/** Per-step decay of a channel's onset envelope. */
const ONSET_DECAY = 0.6;
/** Ranges this many times wider than `minSpan` are read on a log scale. */
const LOG_RANGE = 50;

/** One channel as deterministic mode reads it on a step, every value 0..1 (trend −1..1). */
export interface InputChannel {
  id: string;
  kind: string;
  timescale: Timescale;
  level: number;
  activity: number;
  trend: number;
  /** Envelope of the latest event or onset, 1 on its step, then decaying. */
  onset: number;
  /** A channel of presses (keys, MIDI keys, buttons): level and activity are the press rate. */
  presses: boolean;
}

interface Smoothing {
  /** Seconds for the level to follow the reading. */
  level: number;
  /** Seconds for activity to follow movement. */
  activity: number;
  /** Change per second of the scaled reading that counts as quite active. */
  move: number;
  trendTau: number;
  trendGain: number;
}

const SMOOTHING: Record<Timescale, Smoothing> = {
  fast: { level: 0.08, activity: 0.4, move: 2, trendTau: 0.2, trendGain: 1 },
  medium: { level: 0.3, activity: 2, move: 0.5, trendTau: 1, trendGain: 3 },
  slow: { level: 2, activity: 30, move: 0.02, trendTau: 20, trendGain: 60 },
};

/**
 * Maps a raw reading onto 0..1 with a fixed, monotonic curve, so the same
 * reading always gives the same value and a reading 2% higher gives a value a
 * little higher:
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

/** Rate of presses at `t` from a smooth kernel: every press time moves it continuously. */
export function pressRate(times: readonly number[], t: number, tau = EVENT_TAU): number {
  let rate = 0;
  for (const ti of times) {
    const d = t - ti;
    if (d < 0 || d > 12 * tau) continue;
    rate += (d / (tau * tau)) * Math.exp(-d / tau);
  }
  return rate;
}

class ChannelLog {
  readonly timescale: Timescale;
  readonly presses: boolean;
  private readonly onsets: OnsetDetector | undefined;
  private scale: ((v: number) => number) | undefined;
  private samples: { t: number; v: number }[] = [];
  /** Press times, and events with their strength, oldest first. */
  private events: { t: number; vel: number }[] = [];
  private lastPushT: number | undefined;
  private started = false;
  private x = 0;
  private level = 0;
  private activity = 0;
  private trendRaw = 0;
  private env = 0;
  private evalT = -Infinity;

  constructor(readonly desc: SensorDescriptor) {
    this.timescale = timescaleOf(desc);
    this.presses = EVENT_KINDS.has(desc.kind);
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

  addEvent(t: number, vel: number): void {
    const last = this.events[this.events.length - 1];
    if (last && t < last.t) return;
    this.events.push({ t, vel: clamp(vel) });
  }

  /** The channel at time `t`, `dt` seconds after the previous evaluation; undefined before its first reading. */
  evaluate(t: number, dt: number): InputChannel | undefined {
    const from = this.evalT;
    this.evalT = t;
    let x: number;
    if (this.presses) {
      if (!this.hasValueAt(t)) return undefined;
      const rate = pressRate(
        this.events.filter((e) => e.t <= t).map((e) => e.t),
        t,
      );
      x = rate / (rate + RATE_HALF);
    } else {
      const v = this.hold(t);
      if (v === undefined || !this.scale) return undefined;
      x = this.scale(v);
    }
    const s = SMOOTHING[this.timescale];
    this.env *= ONSET_DECAY;
    for (const e of this.events) if (e.t > from && e.t <= t) this.env = Math.max(this.env, e.vel);
    if (!this.started) {
      this.started = true;
      this.level = x;
      this.activity = this.timescale === 'fast' ? x : 0;
      this.trendRaw = 0;
    } else {
      const prevLevel = this.level;
      this.level += (x - this.level) * onePoleAlpha(dt, s.level);
      const moving =
        this.timescale === 'fast'
          ? x
          : 1 - Math.exp(-Math.abs(x - this.x) / Math.max(1e-6, dt) / s.move);
      this.activity += (moving - this.activity) * onePoleAlpha(dt, s.activity);
      const deriv = dt > 0 ? (this.level - prevLevel) / dt : 0;
      this.trendRaw += (deriv - this.trendRaw) * onePoleAlpha(dt, s.trendTau);
    }
    this.x = x;
    this.prune(t);
    const presses = this.presses;
    return {
      id: this.desc.id,
      kind: this.desc.kind,
      timescale: this.timescale,
      level: presses ? x : clamp(this.level),
      activity: presses ? x : clamp(this.activity),
      trend: Math.tanh(this.trendRaw * s.trendGain),
      onset: this.env,
      presses,
    };
  }

  /** The latest reading at or before `t`. */
  private hold(t: number): number | undefined {
    let v: number | undefined;
    for (const s of this.samples) {
      if (s.t > t) break;
      v = s.v;
    }
    return v;
  }

  private hasValueAt(t: number): boolean {
    return (this.samples[0]?.t ?? Infinity) <= t || (this.events[0]?.t ?? Infinity) <= t;
  }

  /** Drops what no later evaluation can need. */
  private prune(t: number): void {
    let keep = 0;
    while (keep + 1 < this.samples.length && (this.samples[keep + 1] as { t: number }).t <= t) {
      keep++;
    }
    if (keep > 0) this.samples = this.samples.slice(keep);
    const cut = t - 12 * EVENT_TAU;
    if (this.events.length > 0 && (this.events[0] as { t: number }).t < cut) {
      this.events = this.events.filter((e) => e.t >= cut);
    }
  }
}

export interface InputModelOptions {
  /** Sensor-clock seconds at which the music starts. */
  origin: number;
}

/**
 * The inputs of deterministic mode. It keeps a timestamped log of every
 * channel's readings and events and reads them at a given time, so what the
 * music hears depends only on what the sensors did and when, never on when
 * a timer happened to fire:
 * - readings are held from the latest sample at that time and scaled by a
 *   fixed curve, then smoothed step by step;
 * - presses (keys, MIDI keys, buttons) become a rate from a smooth kernel
 *   over their exact times, so pressing 2% slower reads about 2% lower;
 * - onsets of fast sensors (a shake, a clap) are found in the readings since
 *   Play, sample by sample.
 * Every press and onset is also handed to `onEvent` as it happens.
 */
export class InputModel {
  readonly origin: number;
  /** Called with every press and every onset found in the readings. */
  onEvent: ((event: SensorEvent) => void) | undefined;
  private readonly logs = new Map<string, ChannelLog>();
  private readonly untap: () => void;
  private lastT: number | undefined;

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
      remove: (id) => this.logs.delete(id),
      push: (s) => {
        const log = this.logs.get(s.id);
        if (!log) return;
        const strength = log.push(s.t, s.v);
        if (strength > 0 && (this.hub.onsetGate?.(s.id, s.t) ?? true)) {
          log.addEvent(s.t, strength);
          this.onEvent?.({ id: s.id, t: s.t, kind: 'onset', value: 0, velocity: strength });
        }
      },
      event: (e) => {
        const log = this.logs.get(e.id);
        if (!log) return;
        log.addEvent(e.t, e.velocity);
        this.onEvent?.(e);
      },
    });
  }

  /** Every channel with a reading at time `t` (sensor clock), sorted by id. */
  evaluate(t: number): InputChannel[] {
    const dt = this.lastT === undefined ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    const out: InputChannel[] = [];
    const ids = [...this.logs.keys()].sort();
    for (const id of ids) {
      const ch = (this.logs.get(id) as ChannelLog).evaluate(t, dt);
      if (ch) out.push(ch);
    }
    return out;
  }

  dispose(): void {
    this.untap();
    this.logs.clear();
    this.onEvent = undefined;
  }
}
