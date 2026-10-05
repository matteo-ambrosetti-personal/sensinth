import type { SensorHub } from './hub';
import type { SensorDescriptor, SensorEvent, SensorEventKind, SensorSample } from './types';

/** A sensor session saved to JSON, replayable on any device. */
export interface SensorRecording {
  format: 'sensinth-recording';
  version: 1;
  /** ISO date of the start of the recording. */
  startedAt: string;
  descriptors: SensorDescriptor[];
  /** `[seconds since start, index into descriptors, value]`, in time order. */
  samples: [number, number, number][];
  /**
   * Presses (keys, MIDI keys, buttons): `[seconds since start, index into
   * descriptors, kind, value, velocity]`, in time order. Older recordings have none.
   */
  events?: [number, number, SensorEventKind, number, number][];
}

const EVENT_KINDS: readonly SensorEventKind[] = ['key', 'note', 'button', 'onset'];

/** Records everything a hub receives until `stop` is called. */
export class SensorRecorder {
  private descriptors: SensorDescriptor[] = [];
  private readonly index = new Map<string, number>();
  private samples: [number, number, number][] = [];
  private events: [number, number, SensorEventKind, number, number][] = [];
  private t0: number | undefined;
  private untap: (() => void) | undefined;
  private startedAt = '';

  start(hub: SensorHub, startedAt = new Date()): void {
    this.stop();
    this.descriptors = [];
    this.index.clear();
    this.samples = [];
    this.events = [];
    this.t0 = undefined;
    this.startedAt = startedAt.toISOString();
    for (const ch of hub.list()) this.addDescriptor(ch.desc);
    this.untap = hub.tap({
      announce: (desc) => this.addDescriptor(desc),
      push: (s) => this.addSample(s),
      event: (e) => this.addEvent(e),
    });
  }

  get recording(): boolean {
    return this.untap !== undefined;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Seconds covered so far. */
  get duration(): number {
    const last = this.samples[this.samples.length - 1];
    return last ? last[0] : 0;
  }

  stop(): SensorRecording {
    this.untap?.();
    this.untap = undefined;
    const used = new Set([...this.samples.map((s) => s[1]), ...this.events.map((e) => e[1])]);
    // Keep only channels that produced samples, re-indexed.
    const remap = new Map<number, number>();
    const descriptors: SensorDescriptor[] = [];
    this.descriptors.forEach((d, i) => {
      if (used.has(i)) {
        remap.set(i, descriptors.length);
        descriptors.push(d);
      }
    });
    return {
      format: 'sensinth-recording',
      version: 1,
      startedAt: this.startedAt,
      descriptors,
      samples: this.samples.map(([t, i, v]) => [t, remap.get(i) as number, v]),
      ...(this.events.length > 0
        ? {
            events: this.events.map(
              ([t, i, k, v, vel]) =>
                [t, remap.get(i) as number, k, v, vel] as [
                  number,
                  number,
                  SensorEventKind,
                  number,
                  number,
                ],
            ),
          }
        : {}),
    };
  }

  private addDescriptor(desc: SensorDescriptor): void {
    if (this.index.has(desc.id)) return;
    this.index.set(desc.id, this.descriptors.length);
    this.descriptors.push(desc);
  }

  private addSample(s: SensorSample): void {
    const i = this.index.get(s.id);
    if (i === undefined || !Number.isFinite(s.v)) return;
    this.t0 ??= s.t;
    const t = Math.round((s.t - this.t0) * 1000) / 1000;
    this.samples.push([t, i, Number(s.v.toPrecision(6))]);
  }

  private addEvent(e: SensorEvent): void {
    const i = this.index.get(e.id);
    if (i === undefined || !Number.isFinite(e.value)) return;
    this.t0 ??= e.t;
    const t = Math.round((e.t - this.t0) * 1000) / 1000;
    this.events.push([t, i, e.kind, e.value, Number(e.velocity.toPrecision(4))]);
  }
}

/** Validates parsed JSON as a recording; throws an Error with a readable message. */
export function parseRecording(data: unknown): SensorRecording {
  const r = data as Partial<SensorRecording> | null;
  if (!r || r.format !== 'sensinth-recording') throw new Error('Not a Sensinth sensor recording.');
  if (r.version !== 1) throw new Error(`Unsupported recording version ${String(r.version)}.`);
  if (!Array.isArray(r.descriptors) || !Array.isArray(r.samples)) {
    throw new Error('The recording is missing its channels or samples.');
  }
  for (const d of r.descriptors) {
    if (typeof d?.id !== 'string' || typeof d?.kind !== 'string') {
      throw new Error('The recording has a malformed channel.');
    }
  }
  let lastT = -Infinity;
  for (const s of r.samples) {
    if (
      !Array.isArray(s) ||
      typeof s[0] !== 'number' ||
      typeof s[1] !== 'number' ||
      typeof s[2] !== 'number' ||
      s[1] < 0 ||
      s[1] >= r.descriptors.length ||
      s[0] < lastT
    ) {
      throw new Error('The recording has malformed or out-of-order samples.');
    }
    lastT = s[0];
  }
  if (r.events !== undefined) {
    if (!Array.isArray(r.events)) throw new Error('The recording has malformed events.');
    let lastE = -Infinity;
    for (const e of r.events) {
      if (
        !Array.isArray(e) ||
        typeof e[0] !== 'number' ||
        typeof e[1] !== 'number' ||
        !EVENT_KINDS.includes(e[2]) ||
        typeof e[3] !== 'number' ||
        typeof e[4] !== 'number' ||
        e[1] < 0 ||
        e[1] >= r.descriptors.length ||
        e[0] < lastE
      ) {
        throw new Error('The recording has malformed or out-of-order events.');
      }
      lastE = e[0];
    }
  }
  return r as SensorRecording;
}

export interface ReplayOptions {
  /** Prefix for channel ids, so replayed channels never clash with live ones. */
  idPrefix?: string;
  /** Appended to channel labels. */
  labelSuffix?: string;
  /** Start over at the end (default true). */
  loop?: boolean;
}

/** Plays a recording back. The caller advances time; samples come out in order. */
export class ReplaySource {
  readonly descriptors: SensorDescriptor[];
  readonly duration: number;
  private readonly ids: string[];
  private readonly loop: boolean;
  private next = 0;
  private offset = 0;
  private nextEvent = 0;
  private eventOffset = 0;

  constructor(
    private readonly rec: SensorRecording,
    opts: ReplayOptions = {},
  ) {
    const prefix = opts.idPrefix ?? 'replay:';
    const suffix = opts.labelSuffix ?? ' (replay)';
    this.descriptors = rec.descriptors.map((d) => ({
      ...d,
      id: prefix + d.id,
      label: d.label + suffix,
      source: 'replay',
    }));
    this.ids = this.descriptors.map((d) => d.id);
    const last = rec.samples[rec.samples.length - 1];
    const lastEvent = rec.events?.[rec.events.length - 1];
    this.duration = Math.max(last ? last[0] : 0, lastEvent ? lastEvent[0] : 0);
    this.loop = (opts.loop ?? true) && this.duration > 0;
  }

  /** Starts again from the beginning. */
  rewind(): void {
    this.next = 0;
    this.offset = 0;
    this.nextEvent = 0;
    this.eventOffset = 0;
  }

  /** The recording's presses up to `elapsed` seconds into playback, stamped like `samplesUntil`. */
  eventsUntil(elapsed: number, origin = 0): SensorEvent[] {
    const out: SensorEvent[] = [];
    const events = this.rec.events ?? [];
    if (events.length === 0) return out;
    const loopLength = this.duration + 0.05;
    for (;;) {
      const e = events[this.nextEvent];
      if (!e) break;
      const t = e[0] + this.eventOffset;
      if (t > elapsed) break;
      out.push({
        id: this.ids[e[1]] as string,
        t: origin + t,
        kind: e[2],
        value: e[3],
        velocity: e[4],
      });
      this.nextEvent++;
      if (this.nextEvent >= events.length) {
        if (!this.loop) break;
        this.nextEvent = 0;
        this.eventOffset += loopLength;
      }
    }
    return out;
  }

  /**
   * Returns the samples up to `elapsed` seconds into playback (looping if
   * enabled), stamped with `origin + elapsed time`.
   */
  samplesUntil(elapsed: number, origin = 0): SensorSample[] {
    const out: SensorSample[] = [];
    const samples = this.rec.samples;
    if (samples.length === 0) return out;
    // A small gap between loops keeps time strictly increasing.
    const loopLength = this.duration + 0.05;
    for (;;) {
      const s = samples[this.next];
      if (!s) break;
      const t = s[0] + this.offset;
      if (t > elapsed) break;
      out.push({ id: this.ids[s[1]] as string, t: origin + t, v: s[2] });
      this.next++;
      if (this.next >= samples.length) {
        if (!this.loop) break;
        this.next = 0;
        this.offset += loopLength;
      }
    }
    return out;
  }
}
