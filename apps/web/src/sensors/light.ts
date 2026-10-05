import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { describeMediaError, nowSeconds, SourceError, type WebSensorSource } from './source';

const LIGHT: SensorDescriptor = {
  id: 'phone.light',
  kind: 'light',
  label: 'Light',
  unit: 'lx',
  minSpan: 30,
  rateHz: 10,
  source: 'phone',
};

interface AmbientLightSensorLike extends EventTarget {
  illuminance: number | null;
  start(): void;
  stop(): void;
}
type AmbientLightSensorCtor = new (opts?: { frequency?: number }) => AmbientLightSensorLike;

/**
 * The real ambient light sensor, via the Generic Sensor API. Chrome only
 * exposes it with chrome://flags/#enable-generic-sensor-extra-classes, so
 * the camera's brightness is the usual stand-in.
 */
export class LightSource implements WebSensorSource {
  readonly id = 'light';
  readonly label = 'Light sensor';
  readonly description = 'Ambient light in lux';
  readonly permission = 'ambient-light-sensor' as PermissionName;
  private sensor: AmbientLightSensorLike | undefined;

  private get ctor(): AmbientLightSensorCtor | undefined {
    return (window as unknown as { AmbientLightSensor?: AmbientLightSensorCtor })
      .AmbientLightSensor;
  }

  unsupportedReason(): string | undefined {
    return this.ctor
      ? undefined
      : 'Chrome hides it unless "Generic Sensor Extra Classes" is on in chrome://flags. The camera stands in for it.';
  }

  start(hub: SensorHub): Promise<void> {
    const Ctor = this.ctor;
    if (!Ctor) return Promise.reject(new SourceError(this.unsupportedReason()));
    return new Promise((resolve, reject) => {
      const sensor = new Ctor({ frequency: 10 });
      this.sensor = sensor;
      sensor.addEventListener('reading', () => {
        if (sensor.illuminance !== null) {
          hub.push({ id: LIGHT.id, t: nowSeconds(), v: sensor.illuminance });
        }
        resolve();
      });
      sensor.addEventListener('error', (e) => {
        this.stop(hub);
        reject(describeMediaError((e as Event & { error?: unknown }).error, 'Light sensor'));
      });
      hub.announce(LIGHT);
      sensor.start();
    });
  }

  stop(hub: SensorHub): void {
    this.sensor?.stop();
    this.sensor = undefined;
    hub.remove(LIGHT.id);
  }
}
