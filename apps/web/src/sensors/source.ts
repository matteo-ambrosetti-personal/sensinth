import type { SensorHub } from '@sensinth/core';

/** A browser-side producer of sensor channels (simulated, phone hardware, BLE node, …). */
export interface WebSensorSource {
  readonly id: string;
  readonly label: string;
  /** Announces channels on the hub and starts pushing samples. */
  start(hub: SensorHub): Promise<void> | void;
  /** Stops sampling and removes its channels from the hub. */
  stop(hub: SensorHub): void;
}

/** Seconds on the clock every web source stamps samples with. */
export function nowSeconds(): number {
  return performance.now() / 1000;
}
