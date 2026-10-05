import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { nowSeconds, SourceError, type WebSensorSource } from './source';

interface NativeSensorsPlugin {
  available(): Promise<{ sensors: string[] }>;
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: 'reading',
    listener: (reading: { sensor: string; value: number }) => void,
  ): Promise<PluginListenerHandle>;
}

/** Implemented in android/app/src/main/java/com/sensinth/app/SensorsPlugin.java. */
const NativeSensors = registerPlugin<NativeSensorsPlugin>('NativeSensors');

const DESCRIPTORS: Record<string, SensorDescriptor> = {
  light: {
    id: 'native.light',
    kind: 'light',
    label: 'Light',
    unit: 'lx',
    range: [0, 100000],
    adaptive: true,
    minSpan: 30,
    rateHz: 5,
    source: 'native',
  },
  pressure: {
    id: 'native.pressure',
    kind: 'pressure',
    label: 'Air pressure',
    unit: 'hPa',
    minSpan: 1.5,
    rateHz: 5,
    source: 'native',
  },
  temperature: {
    id: 'native.temperature',
    kind: 'temperature',
    label: 'Temperature',
    unit: '°C',
    minSpan: 2,
    rateHz: 1,
    source: 'native',
  },
  humidity: {
    id: 'native.humidity',
    kind: 'humidity',
    label: 'Humidity',
    unit: '%',
    range: [0, 100],
    rateHz: 1,
    source: 'native',
  },
};

/**
 * Sensors only the Android app can read (browsers hide them): ambient light,
 * barometer, and temperature/humidity where the phone has them.
 */
export class NativeSensorsSource implements WebSensorSource {
  readonly id = 'native';
  readonly label = 'Phone sensors (app)';
  readonly description = 'Light, air pressure, temperature, humidity';
  private handle: PluginListenerHandle | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly last = new Map<string, number>();
  private active: SensorDescriptor[] = [];

  unsupportedReason(): string | undefined {
    return Capacitor.isNativePlatform()
      ? undefined
      : 'Only in the Android app: browsers hide these sensors.';
  }

  async start(hub: SensorHub): Promise<void> {
    const { sensors } = await NativeSensors.available();
    this.active = sensors.map((s) => DESCRIPTORS[s]).filter((d): d is SensorDescriptor => !!d);
    if (this.active.length === 0) throw new SourceError('This phone has none of these sensors.');
    for (const d of this.active) hub.announce(d);
    this.handle = await NativeSensors.addListener('reading', ({ sensor, value }) => {
      const desc = DESCRIPTORS[sensor];
      if (!desc) return;
      this.last.set(desc.id, value);
      hub.push({ id: desc.id, t: nowSeconds(), v: value });
    });
    // Android reports light and pressure only when they change; repeat the
    // latest value so a steady reading still counts as live.
    this.timer = setInterval(() => {
      const t = nowSeconds();
      for (const [id, v] of this.last) hub.push({ id, t, v });
    }, 1000);
    await NativeSensors.start();
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    void this.handle?.remove();
    this.handle = undefined;
    if (Capacitor.isNativePlatform()) void NativeSensors.stop().catch(() => {});
    for (const d of this.active) hub.remove(d.id);
    this.last.clear();
  }
}

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
