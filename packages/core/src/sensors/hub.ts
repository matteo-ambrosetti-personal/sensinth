import { FeatureExtractor } from '../signal/features';
import { timescaleOf } from './kinds';
import type { Features, SensorDescriptor, SensorSample, Timescale } from './types';

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
}

export interface OnsetEvent {
  id: string;
  t: number;
  strength: number;
}

const MAX_PENDING_ONSETS = 32;

/**
 * Collects every sensor channel, from any source, and keeps its features up
 * to date. Sources call `announce` once per channel, then `push` samples.
 */
export class SensorHub {
  private readonly channels = new Map<string, { state: ChannelState; fx: FeatureExtractor }>();
  private pending: OnsetEvent[] = [];
  /** Increments whenever channels are added or removed. */
  version = 0;

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
      },
      fx: new FeatureExtractor(desc, timescale),
    });
    this.version++;
  }

  remove(id: string): void {
    if (this.channels.delete(id)) this.version++;
  }

  /** Feeds one sample. Samples for unknown channels or going back in time are ignored. */
  push(sample: SensorSample): void {
    const ch = this.channels.get(sample.id);
    if (!ch || !Number.isFinite(sample.t)) return;
    const { state } = ch;
    if (sample.t < state.lastT) return;
    const dt = Number.isFinite(state.lastT) ? sample.t - state.lastT : 0;
    state.features = ch.fx.update(sample.v, dt);
    state.raw = sample.v;
    state.lastT = sample.t;
    state.stale = false;
    if (state.features.onset > 0) {
      state.lastOnsetT = sample.t;
      this.pending.push({ id: sample.id, t: sample.t, strength: state.features.onset });
      if (this.pending.length > MAX_PENDING_ONSETS) this.pending.shift();
    }
  }

  pushAll(samples: readonly SensorSample[]): void {
    for (const s of samples) this.push(s);
  }

  /** Marks channels with no sample in the last `timeout` seconds as stale. */
  markStale(now: number, timeout = 5): void {
    for (const { state } of this.channels.values()) {
      state.stale = now - state.lastT > timeout;
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
