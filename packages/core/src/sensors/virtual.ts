import { hashString } from '../random';

/** Daylight curve from the local clock: 0 at midnight, 1 at noon. */
export function daylight(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  return 0.5 - 0.5 * Math.cos((hours / 24) * 2 * Math.PI);
}

/**
 * "Every place has its key": a pitch class (0..11) derived from a location
 * cell of about 500 m, so the same spot always starts in the same key.
 */
export function placeKey(lat: number, lon: number, cellDegrees = 0.005): number {
  const a = Math.floor(lat / cellDegrees);
  const b = Math.floor(lon / cellDegrees);
  return hashString(`${a},${b}`) % 12;
}
