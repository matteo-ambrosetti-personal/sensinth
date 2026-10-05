import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { nowSeconds, SourceError, type WebSensorSource } from './source';

interface PermissionRequestable {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

const ACCEL: SensorDescriptor = {
  id: 'phone.accel',
  kind: 'motion.accel',
  label: 'Shake',
  unit: 'm/s²',
  range: [0, 40],
  adaptive: true,
  minSpan: 3,
  rateHz: 60,
  source: 'phone',
};
const ROTATION: SensorDescriptor = {
  id: 'phone.rotation',
  kind: 'rotation.rate',
  label: 'Spin',
  unit: '°/s',
  range: [0, 2000],
  adaptive: true,
  minSpan: 90,
  rateHz: 60,
  source: 'phone',
};
const TILT: SensorDescriptor = {
  id: 'phone.tilt',
  kind: 'orientation.pitch',
  label: 'Tilt',
  unit: '°',
  range: [-90, 90],
  rateHz: 60,
  source: 'phone',
};
const ROLL: SensorDescriptor = {
  id: 'phone.roll',
  kind: 'orientation.roll',
  label: 'Roll',
  unit: '°',
  range: [-90, 90],
  rateHz: 60,
  source: 'phone',
};
const HEADING: SensorDescriptor = {
  id: 'phone.heading',
  kind: 'heading',
  label: 'Compass',
  unit: '°',
  range: [0, 360],
  circular: true,
  rateHz: 60,
  source: 'phone',
};

const FIRST_EVENT_TIMEOUT_MS = 2000;

/**
 * Accelerometer, gyroscope, tilt and compass through the `devicemotion` and
 * `deviceorientation` events, which Chrome on Android delivers without a
 * prompt (iOS asks once, on a tap).
 */
export class MotionSource implements WebSensorSource {
  readonly id = 'motion';
  readonly label = 'Motion & tilt';
  readonly description = 'Shake, spin, tilt and compass';
  private hub: SensorHub | undefined;
  private gravity = [0, 0, 0];
  private haveHeading = false;
  private gotData = false;
  private readonly onMotion = (e: DeviceMotionEvent) => this.handleMotion(e);
  private readonly onOrientation = (e: DeviceOrientationEvent) => this.handleOrientation(e, false);
  private readonly onAbsolute = (e: DeviceOrientationEvent) => this.handleOrientation(e, true);

  unsupportedReason(): string | undefined {
    return 'DeviceMotionEvent' in window ? undefined : 'This browser has no motion sensor access.';
  }

  async start(hub: SensorHub): Promise<void> {
    await requestIosPermission(DeviceMotionEvent as unknown as PermissionRequestable);
    await requestIosPermission(DeviceOrientationEvent as unknown as PermissionRequestable);
    this.hub = hub;
    this.haveHeading = false;
    for (const d of [ACCEL, ROTATION, TILT, ROLL]) hub.announce(d);

    this.gotData = false;
    window.addEventListener('devicemotion', this.onMotion);
    window.addEventListener('deviceorientation', this.onOrientation);
    window.addEventListener('deviceorientationabsolute', this.onAbsolute as EventListener);
    // Desktop browsers may send one empty event; wait for real readings.
    const deadline = performance.now() + FIRST_EVENT_TIMEOUT_MS;
    while (!this.gotData && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!this.gotData) {
      this.stop(hub);
      throw new SourceError('No motion sensor answered. Is this a phone or tablet?');
    }
  }

  stop(hub: SensorHub): void {
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('deviceorientationabsolute', this.onAbsolute as EventListener);
    for (const d of [ACCEL, ROTATION, TILT, ROLL, HEADING]) hub.remove(d.id);
    this.hub = undefined;
  }

  private handleMotion(e: DeviceMotionEvent): void {
    const hub = this.hub;
    if (!hub) return;
    const t = nowSeconds();
    let a = e.acceleration;
    if (!a || a.x === null) {
      // No gravity-free reading: remove gravity with a slow low-pass.
      const g = e.accelerationIncludingGravity;
      if (g && g.x !== null) {
        const raw = [g.x ?? 0, g.y ?? 0, g.z ?? 0];
        this.gravity = this.gravity.map((v, i) => v + ((raw[i] as number) - v) * 0.1);
        a = {
          x: (raw[0] as number) - (this.gravity[0] as number),
          y: (raw[1] as number) - (this.gravity[1] as number),
          z: (raw[2] as number) - (this.gravity[2] as number),
        };
      }
    }
    if (a && a.x !== null) {
      hub.push({ id: ACCEL.id, t, v: Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0) });
      this.gotData = true;
    }
    const r = e.rotationRate;
    if (r && r.alpha !== null) {
      hub.push({ id: ROTATION.id, t, v: Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0) });
    }
  }

  private handleOrientation(e: DeviceOrientationEvent, absolute: boolean): void {
    const hub = this.hub;
    if (!hub) return;
    const t = nowSeconds();
    if (!absolute && e.beta !== null && e.gamma !== null) {
      hub.push({ id: TILT.id, t, v: Math.max(-90, Math.min(90, e.beta)) });
      hub.push({ id: ROLL.id, t, v: e.gamma });
      this.gotData = true;
    }
    // Compass: Chrome sends absolute alpha; Safari sends webkitCompassHeading.
    const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
      .webkitCompassHeading;
    let heading: number | undefined;
    if (typeof webkit === 'number') heading = webkit;
    else if ((absolute || e.absolute) && e.alpha !== null) heading = (360 - e.alpha) % 360;
    if (heading !== undefined) {
      if (!this.haveHeading) {
        hub.announce(HEADING);
        this.haveHeading = true;
      }
      hub.push({ id: HEADING.id, t, v: heading });
    }
  }
}

async function requestIosPermission(api: PermissionRequestable): Promise<void> {
  if (typeof api.requestPermission !== 'function') return;
  let result: string;
  try {
    result = await api.requestPermission();
  } catch {
    throw new SourceError('Tap the switch to allow motion access.');
  }
  if (result !== 'granted') throw new SourceError('Motion access was denied.');
}
