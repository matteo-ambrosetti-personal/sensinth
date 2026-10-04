import type { SensorDescriptor, Timescale } from './types';

/**
 * Shared vocabulary of sensor kinds. Adapters on every platform (phone,
 * Pico, Pi) use these names so the default mapping applies everywhere.
 * Unknown kinds still work: they are routed automatically by timescale.
 */
export const KNOWN_KINDS: Record<string, { timescale: Timescale; description: string }> = {
  'motion.accel': {
    timescale: 'fast',
    description: 'Linear acceleration magnitude (shake, steps)',
  },
  'rotation.rate': { timescale: 'fast', description: 'Gyroscope rotation speed' },
  'sound.level': { timescale: 'fast', description: 'Microphone loudness' },
  'camera.motion': { timescale: 'fast', description: 'Movement seen by the camera' },
  'orientation.pitch': { timescale: 'medium', description: 'Forward/back tilt' },
  'orientation.roll': { timescale: 'medium', description: 'Left/right tilt' },
  heading: { timescale: 'medium', description: 'Compass heading' },
  light: { timescale: 'medium', description: 'Ambient light' },
  'camera.luma': { timescale: 'medium', description: 'Camera brightness' },
  'camera.hue': { timescale: 'medium', description: 'Dominant camera hue' },
  'sound.brightness': { timescale: 'medium', description: 'Microphone spectral centroid' },
  'geo.speed': { timescale: 'medium', description: 'GPS ground speed' },
  temperature: { timescale: 'slow', description: 'Air temperature' },
  humidity: { timescale: 'slow', description: 'Relative humidity' },
  pressure: { timescale: 'slow', description: 'Barometric pressure' },
  battery: { timescale: 'slow', description: 'Battery level' },
  'time.daylight': {
    timescale: 'slow',
    description: 'Time of day as daylight, 0 midnight to 1 noon',
  },
  'geo.altitude': { timescale: 'slow', description: 'GPS altitude' },
};

export function timescaleOf(desc: SensorDescriptor): Timescale {
  if (desc.timescale) return desc.timescale;
  const known = KNOWN_KINDS[desc.kind];
  if (known) return known.timescale;
  const rate = desc.rateHz ?? 1;
  if (rate >= 15) return 'fast';
  if (rate >= 0.5) return 'medium';
  return 'slow';
}
