import { daylight, type SensorDescriptor, type SensorHub } from '@sensinth/core';
import { nowSeconds, type WebSensorSource } from './source';

const DAYLIGHT: SensorDescriptor = {
  id: 'clock.daylight',
  kind: 'time.daylight',
  label: 'Time of day',
  range: [0, 1],
  rateHz: 1,
  source: 'clock',
};
const BATTERY: SensorDescriptor = {
  id: 'phone.battery',
  kind: 'battery',
  label: 'Battery',
  unit: '%',
  range: [0, 100],
  rateHz: 1,
  source: 'phone',
};

interface BatteryLike {
  level: number;
}

/** Slow "sensors" every device has: the time of day and the battery level. */
export class DeviceSource implements WebSensorSource {
  readonly id = 'device';
  readonly label = 'Clock & battery';
  readonly description = 'Time of day and battery level';
  private timer: ReturnType<typeof setInterval> | undefined;

  unsupportedReason(): string | undefined {
    return undefined;
  }

  async start(hub: SensorHub): Promise<void> {
    hub.announce(DAYLIGHT);
    let battery: BatteryLike | undefined;
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    try {
      battery = await nav.getBattery?.();
    } catch {
      battery = undefined;
    }
    if (battery) hub.announce(BATTERY);
    const tick = () => {
      const t = nowSeconds();
      hub.push({ id: DAYLIGHT.id, t, v: daylight(new Date()) });
      if (battery) hub.push({ id: BATTERY.id, t, v: battery.level * 100 });
    };
    tick();
    this.timer = setInterval(tick, 1000);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    hub.remove(DAYLIGHT.id);
    hub.remove(BATTERY.id);
  }
}
