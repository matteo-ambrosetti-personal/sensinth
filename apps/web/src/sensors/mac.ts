import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { nowSeconds, SourceError, type WebSensorSource } from './source';
import type { NativeChannel } from './native';

/** Messages the Mac app sends to the page (see apps/mac/Sources/Bridge.swift). */
type MacMessage =
  | { type: 'describe'; channels: NativeChannel[]; motion: boolean }
  | { type: 'readings'; r: [string, number][] }
  | { type: 'motion'; status: 'on' | 'error'; message?: string; channels?: NativeChannel[] };

interface MacWindow {
  webkit?: { messageHandlers?: { sensinth?: { postMessage(message: unknown): void } } };
  sensinthNative?: { receive(message: MacMessage): void };
}

const macWindow = window as unknown as MacWindow;

/** True inside the Mac app, whose web view has the `sensinth` message handler. */
export const isMacApp = (): boolean => !!macWindow.webkit?.messageHandlers?.sensinth;

/** The page's end of the bridge: one place that posts to the app and fans out its replies. */
class MacBridge {
  private readonly listeners = new Set<(message: MacMessage) => void>();
  private description: Promise<{ channels: NativeChannel[]; motion: boolean }> | undefined;

  constructor() {
    macWindow.sensinthNative = { receive: (message) => this.listeners.forEach((l) => l(message)) };
  }

  post(message: { type: string; on?: boolean }): void {
    macWindow.webkit?.messageHandlers?.sensinth?.postMessage(message);
  }

  on(listener: (message: MacMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** What this Mac has, asked once. */
  describe(): Promise<{ channels: NativeChannel[]; motion: boolean }> {
    this.description ??= new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new SourceError('The Mac app did not answer.')), 5000);
      const off = this.on((m) => {
        if (m.type !== 'describe') return;
        clearTimeout(timer);
        off();
        resolve({ channels: m.channels, motion: m.motion });
      });
      this.post({ type: 'describe' });
    });
    return this.description;
  }
}

let bridge: MacBridge | undefined;
const macBridge = (): MacBridge => (bridge ??= new MacBridge());

function toDescriptor(c: NativeChannel): SensorDescriptor {
  return {
    id: c.id,
    kind: c.kind,
    label: c.label,
    ...(c.unit ? { unit: c.unit } : {}),
    ...(c.range ? { range: c.range } : {}),
    ...(c.adaptive !== undefined ? { adaptive: c.adaptive } : {}),
    ...(c.minSpan ? { minSpan: c.minSpan } : {}),
    rateHz: c.rateHz ?? 1,
    source: 'mac',
  };
}

/** Feeds readings for a set of channels into the hub, repeating steady ones so they stay live. */
class Feed {
  private readonly last = new Map<string, number>();
  private off: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  start(hub: SensorHub, ids: ReadonlySet<string>): void {
    this.off = macBridge().on((m) => {
      if (m.type !== 'readings') return;
      const t = nowSeconds();
      for (const [id, v] of m.r) {
        if (!ids.has(id) || !Number.isFinite(v)) continue;
        this.last.set(id, v);
        hub.push({ id, t, v });
      }
    });
    this.timer = setInterval(() => {
      const t = nowSeconds();
      for (const [id, v] of this.last) hub.push({ id, t, v });
    }, 1000);
  }

  stop(): void {
    this.off?.();
    this.off = undefined;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.last.clear();
  }
}

/**
 * Sensors only the Mac app can read: the lid angle (fast), ambient light,
 * chip and battery temperatures, power draw, heat, CPU load, memory, idle
 * time, network traffic, Wi-Fi and Bluetooth nearby.
 */
export class MacSensorsSource implements WebSensorSource {
  readonly id = 'mac';
  readonly label = 'Mac sensors (app)';
  readonly description = 'Lid, light, battery, heat, CPU, Wi-Fi, Bluetooth and more';
  private readonly feed = new Feed();
  private active: SensorDescriptor[] = [];

  unsupportedReason(): string | undefined {
    return isMacApp() ? undefined : 'Only in the Mac app (see the README).';
  }

  async start(hub: SensorHub): Promise<void> {
    const { channels } = await macBridge().describe();
    this.active = channels.map(toDescriptor);
    if (this.active.length === 0) throw new SourceError('This Mac reports no extra sensors.');
    for (const d of this.active) hub.announce(d);
    this.feed.start(hub, new Set(this.active.map((d) => d.id)));
    macBridge().post({ type: 'start' });
  }

  stop(hub: SensorHub): void {
    if (isMacApp()) macBridge().post({ type: 'stop' });
    this.feed.stop();
    for (const d of this.active) hub.remove(d.id);
    this.active = [];
  }
}

/**
 * The accelerometer and gyroscope of Apple Silicon MacBooks: shake, rotation
 * and tilt. Reading them needs root, so macOS asks for your password.
 */
export class MacMotionSource implements WebSensorSource {
  readonly id = 'macMotion';
  readonly label = 'Mac motion';
  readonly description = 'Accelerometer and gyroscope; macOS asks for your password';
  private readonly feed = new Feed();
  private active: SensorDescriptor[] = [];

  unsupportedReason(): string | undefined {
    return isMacApp() ? undefined : 'Only in the Mac app (see the README).';
  }

  async start(hub: SensorHub): Promise<void> {
    const { motion } = await macBridge().describe();
    if (!motion) throw new SourceError('This build of the app has no motion helper.');
    const channels = await new Promise<NativeChannel[]>((resolve, reject) => {
      // The password prompt waits for the user, so allow plenty of time.
      const timer = setTimeout(() => {
        off();
        reject(new SourceError('No answer from the password prompt.'));
      }, 120_000);
      const off = macBridge().on((m) => {
        if (m.type !== 'motion') return;
        clearTimeout(timer);
        off();
        if (m.status === 'on') resolve(m.channels ?? []);
        else reject(new SourceError(m.message ?? 'Motion could not start.'));
      });
      macBridge().post({ type: 'motion', on: true });
    });
    this.active = channels.map(toDescriptor);
    for (const d of this.active) hub.announce(d);
    this.feed.start(hub, new Set(this.active.map((d) => d.id)));
  }

  stop(hub: SensorHub): void {
    if (isMacApp()) macBridge().post({ type: 'motion', on: false });
    this.feed.stop();
    for (const d of this.active) hub.remove(d.id);
    this.active = [];
  }
}
