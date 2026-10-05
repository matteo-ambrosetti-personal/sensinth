import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { nowSeconds, SourceError, type WebSensorSource } from './source';

/** A channel as the Android plugin describes it. */
export interface NativeChannel {
  id: string;
  kind: string;
  label: string;
  unit?: string;
  range?: [number, number];
  adaptive?: boolean;
  minSpan?: number;
  rateHz?: number;
}

/** The latest value of every channel that changed, sent every 50 ms. */
export interface NativeReadings {
  r: [string, number][];
}

export interface NativeSensorsPlugin {
  describe(): Promise<{ channels: NativeChannel[] }>;
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: 'readings',
    listener: (batch: NativeReadings) => void,
  ): Promise<PluginListenerHandle>;
}

/** Implemented in android/app/src/main/java/com/sensinth/app/SensorsPlugin.java. */
const NativeSensors = registerPlugin<NativeSensorsPlugin>('NativeSensors');

/** Browser tests install a fake plugin here to drive this source without a phone. */
function stub(): NativeSensorsPlugin | undefined {
  return (window as Window & { sensinthNativeStub?: NativeSensorsPlugin }).sensinthNativeStub;
}

function plugin(): NativeSensorsPlugin {
  return stub() ?? NativeSensors;
}

export const isNativeApp = (): boolean => Capacitor.isNativePlatform() || !!stub();

/**
 * Every sensor the phone has that browsers hide (light, barometer, proximity,
 * magnetic field, steps, the hall sensor and the maker's own sensors), plus
 * battery, heat, Wi-Fi, brightness and volume. The app lists what this phone
 * has; each becomes a channel.
 */
export class NativeSensorsSource implements WebSensorSource {
  readonly id = 'native';
  readonly label = 'Phone sensors (app)';
  readonly description = 'Every hidden sensor, plus battery, heat, Wi-Fi, brightness and volume';
  private handle: PluginListenerHandle | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly last = new Map<string, number>();
  private active: SensorDescriptor[] = [];

  unsupportedReason(): string | undefined {
    return isNativeApp() ? undefined : 'Only in the Android app: browsers hide these sensors.';
  }

  async start(hub: SensorHub): Promise<void> {
    const { channels } = await plugin().describe();
    this.active = channels.map(toDescriptor);
    if (this.active.length === 0) throw new SourceError('This phone reports no extra sensors.');
    const known = new Set(this.active.map((d) => d.id));
    for (const d of this.active) hub.announce(d);
    this.handle = await plugin().addListener('readings', ({ r }) => {
      const t = nowSeconds();
      for (const [id, v] of r) {
        if (!known.has(id) || !Number.isFinite(v)) continue;
        this.last.set(id, v);
        hub.push({ id, t, v });
      }
    });
    // Android reports many sensors only when they change; repeat the latest
    // value so a steady reading still counts as live.
    this.timer = setInterval(() => {
      const t = nowSeconds();
      for (const [id, v] of this.last) hub.push({ id, t, v });
    }, 1000);
    await plugin().start();
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    void this.handle?.remove();
    this.handle = undefined;
    if (isNativeApp())
      void plugin()
        .stop()
        .catch(() => {});
    for (const d of this.active) hub.remove(d.id);
    this.active = [];
    this.last.clear();
  }
}

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
    source: 'native',
  };
}
