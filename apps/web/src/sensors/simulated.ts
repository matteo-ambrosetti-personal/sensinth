import { SimulatedSource, type SensorHub } from '@sensinth/core';
import { nowSeconds, type WebSensorSource } from './source';

/** Fake sensors on a 30 Hz timer, for trying the app on a computer. */
export class SimulatedWebSource implements WebSensorSource {
  readonly id = 'sim';
  readonly label = 'Simulated';
  readonly description = 'Fake sensors, for computers';
  private readonly sim = new SimulatedSource(Math.floor(Math.random() * 1e9));
  private timer: ReturnType<typeof setInterval> | undefined;

  unsupportedReason(): string | undefined {
    return undefined;
  }

  async start(hub: SensorHub): Promise<void> {
    if (this.timer !== undefined) return;
    for (const d of this.sim.descriptors) hub.announce(d);
    const tick = () => hub.pushAll(this.sim.sampleAt(nowSeconds()));
    tick();
    this.timer = setInterval(tick, 33);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const d of this.sim.descriptors) hub.remove(d.id);
  }
}
