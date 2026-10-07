import { clamp } from '../math';
import { hashString } from '../random';
import type { ChannelState } from '../sensors/hub';
import { groupOf, type Timescale } from '../sensors/types';

/** One live channel as seen by the genome. */
export interface ChannelPrint {
  id: string;
  kind: string;
  label: string;
  /** The source it comes from; not part of either hash. */
  group: string;
  timescale: Timescale;
  level: number;
  activity: number;
  trend: number;
  /** Coarse level bin, with hysteresis; −1 for fast channels (their level is too jumpy). */
  levelBin: number;
  /** Coarse activity bin: still, moving, busy. */
  activityBin: number;
  /** Fine level bin, 0..63. */
  fine: number;
  /** Hash of the latest raw reading's digits, 0..1: changes with the smallest difference. */
  jitter: number;
}

/**
 * A summary of every live sensor at one moment. The coarse hash only
 * changes when something moved a lot (a new place, another background
 * colour, a sensor switched on); the fine hash changes with almost anything.
 */
export interface Fingerprint {
  channels: ChannelPrint[];
  coarseHash: number;
  fineHash: number;
}

const LEVEL_BINS = 6;
const ACTIVITY_EDGES = [0.12, 0.4];
const FINE_BINS = 64;
/** How far past a bin edge a value must go before its bin changes. */
const HYSTERESIS = 0.04;

/** Takes fingerprints, remembering bins so values sitting on an edge do not flicker. */
export class Fingerprinter {
  private readonly levelBins = new Map<string, number>();
  private readonly activityBins = new Map<string, number>();

  take(live: readonly ChannelState[]): Fingerprint {
    const channels = [...live]
      .sort((a, b) => (a.desc.id < b.desc.id ? -1 : a.desc.id > b.desc.id ? 1 : 0))
      .map((ch) => this.print(ch));
    const coarse = channels.map((c) => `${c.kind}:${c.levelBin}:${c.activityBin}`).join('|');
    const fine = channels
      .map((c) => `${c.kind}:${c.fine}:${Math.floor(c.jitter * 2 ** 20)}`)
      .join('|');
    return { channels, coarseHash: hashString(coarse), fineHash: hashString(fine) };
  }

  private print(ch: ChannelState): ChannelPrint {
    const { id, kind, label } = ch.desc;
    const level = finite01(ch.features.level);
    const activity = finite01(ch.features.activity);
    const levelBin =
      ch.timescale === 'fast'
        ? -1
        : this.bin(
            this.levelBins,
            id,
            level,
            (v) => Math.min(LEVEL_BINS - 1, Math.floor(v * LEVEL_BINS)),
            (b) => [b / LEVEL_BINS, (b + 1) / LEVEL_BINS],
          );
    const activityBin = this.bin(
      this.activityBins,
      id,
      activity,
      (v) => ACTIVITY_EDGES.filter((e) => v >= e).length,
      (b) => [ACTIVITY_EDGES[b - 1] ?? 0, ACTIVITY_EDGES[b] ?? 1],
    );
    return {
      id,
      kind,
      label,
      group: groupOf(ch.desc),
      timescale: ch.timescale,
      level,
      activity,
      trend: Number.isFinite(ch.features.trend) ? clamp(ch.features.trend, -1, 1) : 0,
      levelBin,
      activityBin,
      fine: Math.min(FINE_BINS - 1, Math.floor(level * FINE_BINS)),
      jitter: jitterOf(ch.raw),
    };
  }

  private bin(
    memory: Map<string, number>,
    id: string,
    v: number,
    binOf: (v: number) => number,
    edges: (bin: number) => [number, number],
  ): number {
    const prev = memory.get(id);
    if (prev !== undefined) {
      const [lo, hi] = edges(prev);
      if (v >= lo - HYSTERESIS && v <= hi + HYSTERESIS) return prev;
    }
    const bin = binOf(v);
    memory.set(id, bin);
    return bin;
  }
}

/** A value in 0..1 that depends on every digit of a raw reading. */
export function jitterOf(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return hashString(raw.toString()) / 2 ** 32;
}

export interface FingerprintChange {
  /** 0 (same) .. 1 (a sensor appeared, vanished or swung end to end). */
  distance: number;
  /** The channel that moved most. */
  channel: ChannelPrint | undefined;
}

/**
 * Kinds that describe the surroundings rather than a gesture: moving them
 * far means being somewhere else (another room, another light, pointing the
 * camera at another colour). Every slow channel counts too.
 */
export const SCENE_KINDS: ReadonlySet<string> = new Set([
  'light',
  'camera.luma',
  'camera.hue',
  'geo.place',
  'geo.altitude',
]);

function describesScene(c: ChannelPrint): boolean {
  return c.timescale === 'slow' || SCENE_KINDS.has(c.kind);
}

/**
 * How far apart two fingerprints are: the largest level move among channels
 * that describe the surroundings, or 1 when a channel appeared or vanished.
 * Gestures (shaking, tilting, the pointer) only count when they appear or
 * vanish; their movement is for the modulation matrix, not for rewriting
 * the track.
 */
export function fingerprintChange(a: Fingerprint, b: Fingerprint): FingerprintChange {
  const before = new Map(a.channels.map((c) => [c.id, c]));
  const after = new Map(b.channels.map((c) => [c.id, c]));
  let distance = 0;
  let channel: ChannelPrint | undefined;
  for (const [id, c] of after) {
    const prev = before.get(id);
    const d = prev === undefined ? 1 : describesScene(c) ? Math.abs(c.level - prev.level) : 0;
    if (d > distance) {
      distance = d;
      channel = c;
    }
  }
  for (const [id, c] of before) {
    if (!after.has(id) && distance < 1) {
      distance = 1;
      channel = c;
    }
  }
  return { distance, channel };
}

function finite01(v: number): number {
  return Number.isFinite(v) ? clamp(v) : 0.5;
}
