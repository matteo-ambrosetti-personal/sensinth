/** How fast a signal carries meaning; decides which musical layer it may drive. */
export type Timescale = 'slow' | 'medium' | 'fast';

/**
 * Describes one scalar sensor channel. Multi-axis sensors are split into
 * several channels (e.g. tilt pitch and tilt roll), each with its own `kind`.
 */
export interface SensorDescriptor {
  /** Unique channel id, e.g. `phone.accel` or `pico-01.temperature`. */
  id: string;
  /** Semantic kind from the shared vocabulary (see `KNOWN_KINDS`), e.g. `light`. */
  kind: string;
  label: string;
  unit?: string;
  /** Physical range. Without `adaptive: true`, values are normalized against it as-is. */
  range?: [number, number];
  /** Learn the range from the data instead (default: true when `range` is missing). */
  adaptive?: boolean;
  /** Smallest raw span treated as full scale, so sensor noise at rest stays quiet. */
  minSpan?: number;
  /** Nominal samples per second. */
  rateHz?: number;
  /** Overrides the timescale inferred from `kind` and `rateHz`. */
  timescale?: Timescale;
  /** The value wraps around `range` (compass heading, hue). */
  circular?: boolean;
  /** The device or adapter that produces this channel. */
  source?: string;
  /**
   * The source you switch on that produces it (motion, camera, pointer…).
   * Sensors share out what they control by group: one group alone drives
   * everything, several split it.
   */
  group?: string;
}

/** A channel's group: its `group`, else its `source`. */
export function groupOf(desc: SensorDescriptor): string {
  return desc.group ?? desc.source ?? 'default';
}

export interface SensorSample {
  id: string;
  /** Seconds, monotonic. */
  t: number;
  v: number;
}

/** Per-channel features, all derived from the normalized signal. */
export interface Features {
  /** Smoothed value, 0..1. */
  level: number;
  /** Smoothed rate of change, -1..1. */
  trend: number;
  /** How much the signal is moving right now, 0..1. */
  activity: number;
  /** Strength of an onset detected on the latest sample, 0 when none. */
  onset: number;
}

/** What a discrete sensor event was: a key, a MIDI key, a controller button, or an onset. */
export type SensorEventKind = 'key' | 'note' | 'button' | 'onset';

/**
 * A discrete event on a channel: a key press, a MIDI note-on, a button
 * press, or an onset detected in a channel's readings. Deterministic mode
 * plays each one as a note at its own time.
 */
export interface SensorEvent {
  /** The channel it belongs to, e.g. `computer.keys`. */
  id: string;
  /** Seconds, on the same clock as samples. */
  t: number;
  kind: SensorEventKind;
  /** Key: its index (see `keyIndex`); note: the MIDI note; button: its index; onset: 0. */
  value: number;
  /** 0..1. */
  velocity: number;
}
