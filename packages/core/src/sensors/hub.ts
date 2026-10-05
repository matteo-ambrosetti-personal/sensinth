import { FeatureExtractor } from '../signal/features';
import { timescaleOf } from './kinds';
import type { Features, SensorDescriptor, SensorEvent, SensorSample, Timescale } from './types';

export interface ChannelState {
  desc: SensorDescriptor;
  timescale: Timescale;
  /** Latest raw value. */
  raw: number;
  features: Features;
  /** Timestamp of the latest sample, seconds. */
  lastT: number;
  /** No samples for a while: its routes are ignored. */
  stale: boolean;
  /** Timestamp of the latest onset, seconds. */
  lastOnsetT: number;
  /** Intermediate signals, for inspecting how a channel is processed. */
  debug: {
    /** Normalized value before smoothing, 0..1. */
    normalized: number;
    /** Raw-unit range currently mapped onto 0..1. */
    bounds: [number, number] | undefined;
  };
}

export interface OnsetEvent {
  id: string;
  t: number;
  strength: number;
}

const MAX_PENDING_ONSETS = 32;

/** Observes what flows through a hub, e.g. a recorder. */
export interface HubListener {
  announce?(desc: SensorDescriptor): void;
  push?(sample: SensorSample): void;
  /** A discrete event: a key press, a MIDI key, a button. */
  event?(event: SensorEvent): void;
  remove?(id: string): void;
}

/**
 * Collects every sensor channel, from any source, and keeps its features up
 * to date. Sources call `announce` once per channel, then `push` samples.
 */
export class SensorHub {
  private readonly channels = new Map<string, { state: ChannelState; fx: FeatureExtractor }>();
  private pending: OnsetEvent[] = [];
  private readonly listeners = new Set<HubListener>();
  /** Increments whenever channels are added or removed. */
  version = 0;
  /**
   * Decides whether an onset on a channel may raise triggers. Used to ignore
   * the microphone hearing the music's own drum hits.
   */
  onsetGate: ((id: string, t: number) => boolean) | undefined;

  /** Registers a listener; returns a function that removes it. */
  tap(listener: HubListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  announce(desc: SensorDescriptor): void {
    const timescale = timescaleOf(desc);
    this.channels.set(desc.id, {
      state: {
        desc,
        timescale,
        raw: NaN,
        features: { level: 0.5, trend: 0, activity: 0, onset: 0 },
        lastT: -Infinity,
        stale: true,
        lastOnsetT: -Infinity,
        debug: { normalized: 0.5, bounds: undefined },
      },
      fx: new FeatureExtractor(desc, timescale),
    });
    this.version++;
    for (const l of this.listeners) l.announce?.(desc);
  }

  remove(id: string): void {
    if (!this.channels.delete(id)) return;
    this.version++;
    for (const l of this.listeners) l.remove?.(id);
  }

  /** Feeds one sample. Samples for unknown channels or going back in time are ignored. */
  push(sample: SensorSample): void {
    const ch = this.channels.get(sample.id);
    if (!ch || !Number.isFinite(sample.t)) return;
    const { state } = ch;
    if (sample.t < state.lastT) return;
    const dt = Number.isFinite(state.lastT) ? sample.t - state.lastT : 0;
    state.features = ch.fx.update(sample.v, dt);
    state.debug = { normalized: ch.fx.normalized, bounds: ch.fx.bounds };
    state.raw = sample.v;
    state.lastT = sample.t;
    state.stale = false;
    for (const l of this.listeners) l.push?.(sample);
    if (state.features.onset > 0 && (this.onsetGate?.(sample.id, sample.t) ?? true)) {
      state.lastOnsetT = sample.t;
      this.pending.push({ id: sample.id, t: sample.t, strength: state.features.onset });
      if (this.pending.length > MAX_PENDING_ONSETS) this.pending.shift();
    }
  }

  /**
   * Passes on a discrete event (a key press, a MIDI key, a button) of a known
   * channel. Its readings still arrive through `push`; events only add when
   * exactly each press happened and what it was.
   */
  emit(event: SensorEvent): void {
    if (!this.channels.has(event.id) || !Number.isFinite(event.t)) return;
    for (const l of this.listeners) l.event?.(event);
  }

  pushAll(samples: readonly SensorSample[]): void {
    for (const s of samples) this.push(s);
  }

  /**
   * Marks channels with no sample in the last `timeout` seconds as stale.
   * Slow channels get at least three of their sample periods.
   */
  markStale(now: number, timeout = 5): void {
    for (const { state } of this.channels.values()) {
      const rate = state.desc.rateHz;
      const limit = rate && rate > 0 ? Math.max(timeout, 3 / rate) : timeout;
      state.stale = now - state.lastT > limit;
    }
  }

  get(id: string): ChannelState | undefined {
    return this.channels.get(id)?.state;
  }

  /** All channels, sorted by id so routing is deterministic. */
  list(): ChannelState[] {
    return [...this.channels.values()]
      .map((c) => c.state)
      .sort((a, b) => (a.desc.id < b.desc.id ? -1 : a.desc.id > b.desc.id ? 1 : 0));
  }

  /** Returns and clears the onsets detected since the last call. */
  consumeOnsets(): OnsetEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}
