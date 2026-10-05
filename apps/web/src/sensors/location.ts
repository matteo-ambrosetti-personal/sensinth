import { placeKey, type SensorDescriptor, type SensorHub } from '@sensinth/core';
import { nowSeconds, SourceError, type WebSensorSource } from './source';

const SPEED: SensorDescriptor = {
  id: 'phone.speed',
  kind: 'geo.speed',
  label: 'Speed',
  unit: 'm/s',
  minSpan: 3,
  rateHz: 1,
  source: 'phone',
};
const ALTITUDE: SensorDescriptor = {
  id: 'phone.altitude',
  kind: 'geo.altitude',
  label: 'Altitude',
  unit: 'm',
  minSpan: 20,
  rateHz: 1,
  source: 'phone',
};

/**
 * GPS: speed (walking, cycling, driving), altitude, and the place itself,
 * which picks the key of each new piece. Positions are only used on the
 * phone, never stored or sent.
 */
export class LocationSource implements WebSensorSource {
  readonly id = 'location';
  readonly label = 'Location';
  readonly description = 'Speed, altitude; the place picks the key';
  readonly permission = 'geolocation' as PermissionName;
  private watch: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private last:
    { lat: number; lon: number; t: number; speed: number; alt: number | null } | undefined;

  unsupportedReason(): string | undefined {
    return 'geolocation' in navigator ? undefined : 'This browser has no location access.';
  }

  /** Key (pitch class) of the current place, once there is a fix. */
  keyHint(): number | undefined {
    return this.last ? placeKey(this.last.lat, this.last.lon) : undefined;
  }

  start(hub: SensorHub): Promise<void> {
    hub.announce(SPEED);
    hub.announce(ALTITUDE);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: SourceError) => {
        if (settled) return;
        settled = true;
        if (err) {
          this.stop(hub);
          reject(err);
        } else resolve();
      };
      this.watch = navigator.geolocation.watchPosition(
        (pos) => {
          this.update(pos);
          settle();
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            settle(
              new SourceError(
                "Location access is blocked. Allow it in the browser's site settings.",
              ),
            );
          }
        },
        { enableHighAccuracy: true, maximumAge: 1000 },
      );
      // GPS may take a while; the switch stays on and values appear with the first fix.
      setTimeout(() => settle(), 4000);
      // Positions arrive irregularly; repeat the latest so the channels stay live.
      this.timer = setInterval(() => {
        if (!this.last) return;
        const t = nowSeconds();
        hub.push({ id: SPEED.id, t, v: this.last.speed });
        if (this.last.alt !== null) hub.push({ id: ALTITUDE.id, t, v: this.last.alt });
      }, 1000);
    });
  }

  stop(hub: SensorHub): void {
    if (this.watch !== undefined) navigator.geolocation.clearWatch(this.watch);
    this.watch = undefined;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    hub.remove(SPEED.id);
    hub.remove(ALTITUDE.id);
  }

  private update(pos: GeolocationPosition): void {
    const { latitude: lat, longitude: lon, speed, altitude } = pos.coords;
    const t = pos.timestamp / 1000;
    let v = speed ?? NaN;
    if (!Number.isFinite(v) && this.last && t > this.last.t) {
      v = distanceMeters(this.last.lat, this.last.lon, lat, lon) / (t - this.last.t);
    }
    this.last = { lat, lon, t, speed: Number.isFinite(v) ? v : 0, alt: altitude };
  }
}

/** Great-circle distance (haversine). */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
