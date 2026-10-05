import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { nowSeconds, SourceError, type WebSensorSource } from './source';

/** The Compute Pressure API (Chrome), not yet in TypeScript's DOM types. */
interface PressureRecord {
  source: string;
  state: 'nominal' | 'fair' | 'serious' | 'critical';
}
interface PressureObserverLike {
  observe(source: 'cpu', options?: { sampleInterval?: number }): Promise<void>;
  disconnect(): void;
}
type PressureObserverCtor = new (
  callback: (records: PressureRecord[]) => void,
) => PressureObserverLike;

const STATES: Record<PressureRecord['state'], number> = {
  nominal: 0.1,
  fair: 0.4,
  serious: 0.75,
  critical: 1,
};

const CPU: SensorDescriptor = {
  id: 'computer.cpu',
  kind: 'cpu.load',
  label: 'CPU pressure',
  range: [0, 1],
  rateHz: 1,
  source: 'computer',
};

/**
 * How hard the computer is working, from the browser's Compute Pressure API:
 * nominal, fair, serious or critical. Busy machine, busier music.
 */
export class ComputePressureSource implements WebSensorSource {
  readonly id = 'cpu';
  readonly label = 'CPU pressure';
  readonly description = 'How hard the computer is working (Chrome, Edge)';
  private observer: PressureObserverLike | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private value = STATES.nominal;

  private get ctor(): PressureObserverCtor | undefined {
    return (window as Window & { PressureObserver?: PressureObserverCtor }).PressureObserver;
  }

  unsupportedReason(): string | undefined {
    return this.ctor ? undefined : 'Needs Chrome or Edge (Compute Pressure API).';
  }

  async start(hub: SensorHub): Promise<void> {
    const Ctor = this.ctor;
    if (!Ctor) throw new SourceError('This browser cannot report CPU pressure.');
    hub.announce(CPU);
    this.observer = new Ctor((records) => {
      const last = records.at(-1);
      if (last) this.value = STATES[last.state] ?? this.value;
    });
    try {
      await this.observer.observe('cpu', { sampleInterval: 1000 });
    } catch (err) {
      throw new SourceError(`CPU pressure is unavailable: ${(err as Error).message}`);
    }
    // Pressure changes rarely; repeat it so the channel stays live.
    this.timer = setInterval(() => hub.push({ id: CPU.id, t: nowSeconds(), v: this.value }), 1000);
  }

  stop(hub: SensorHub): void {
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    hub.remove(CPU.id);
  }
}
