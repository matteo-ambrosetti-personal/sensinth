import type { SensorHub } from '@sensinth/core';

/** Seconds of history each channel keeps for its sparklines. */
export const FLOW_WINDOW = 12;

/** One reading and what the engine made of it. */
export interface FlowSample {
  t: number;
  raw: number;
  /** Normalized before smoothing, 0..1. */
  normalized: number;
  level: number;
  activity: number;
  onset: boolean;
}

/**
 * The last few seconds of every channel, raw and processed, recorded as
 * samples arrive.
 */
export class FlowHistory {
  private readonly samples = new Map<string, FlowSample[]>();
  paused = false;

  constructor(private readonly hub: SensorHub) {
    hub.tap({
      push: (s) => this.record(s.id, s.t, s.v),
      remove: (id) => this.samples.delete(id),
    });
  }

  get(id: string): readonly FlowSample[] {
    return this.samples.get(id) ?? [];
  }

  /** Onsets of a channel since `t`. */
  onsetsSince(id: string, t: number): number {
    let n = 0;
    for (const s of this.get(id)) if (s.onset && s.t >= t) n++;
    return n;
  }

  private record(id: string, t: number, raw: number): void {
    if (this.paused) return;
    const ch = this.hub.get(id);
    if (!ch) return;
    let list = this.samples.get(id);
    if (!list) {
      list = [];
      this.samples.set(id, list);
    }
    list.push({
      t,
      raw,
      normalized: ch.debug.normalized,
      level: ch.features.level,
      activity: ch.features.activity,
      onset: ch.lastOnsetT === t,
    });
    // Trim in batches, so busy channels do not shift the array on every sample.
    const cutoff = t - FLOW_WINDOW - 1;
    if (list.length > 64 && (list[0] as FlowSample).t < cutoff) {
      const keep = list.findIndex((s) => s.t >= cutoff);
      list.splice(0, keep < 0 ? list.length : keep);
    }
  }
}
