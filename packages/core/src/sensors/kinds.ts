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
  'pointer.speed': { timescale: 'fast', description: 'Mouse or trackpad speed, and scrolling' },
  'keys.rate': { timescale: 'fast', description: 'Key presses per second' },
  'pointer.x': { timescale: 'medium', description: 'Pointer position, left to right' },
  'pointer.y': { timescale: 'medium', description: 'Pointer position, bottom to top' },
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
  'geo.place': { timescale: 'slow', description: 'Which ≈500 m cell you are in, as a value 0..1' },
  // Laptops and phones: hinges, covers, the body and the machine itself.
  'lid.angle': { timescale: 'medium', description: 'Laptop lid or foldable hinge angle' },
  proximity: { timescale: 'fast', description: 'Something near the screen (0 far, 1 near)' },
  cover: { timescale: 'fast', description: 'A flip cover or magnet closing (hall sensor)' },
  'pointer.force': { timescale: 'fast', description: 'Trackpad or pen pressure' },
  'magnetic.field': { timescale: 'medium', description: 'Magnetic field strength' },
  'steps.rate': { timescale: 'medium', description: 'Walking pace, steps per minute' },
  'motion.event': { timescale: 'fast', description: 'The phone started moving (one-off)' },
  'battery.power': { timescale: 'medium', description: 'Power drawn from or into the battery' },
  'battery.temperature': { timescale: 'slow', description: 'Battery temperature' },
  'temperature.device': { timescale: 'slow', description: 'Chip or component temperature' },
  thermal: { timescale: 'slow', description: 'How close the device is to throttling' },
  'cpu.load': { timescale: 'medium', description: 'How hard the processor is working' },
  'memory.pressure': { timescale: 'slow', description: 'How full the memory is' },
  'fan.speed': { timescale: 'medium', description: 'Cooling fan speed' },
  'wifi.rssi': { timescale: 'medium', description: 'Wi-Fi signal strength' },
  'bluetooth.devices': { timescale: 'slow', description: 'Bluetooth devices nearby' },
  'network.rate': { timescale: 'medium', description: 'Network traffic' },
  idle: { timescale: 'medium', description: 'Seconds since the last key or pointer input' },
  'screen.brightness': { timescale: 'slow', description: 'Screen brightness setting' },
  volume: { timescale: 'slow', description: 'Media volume setting' },
  charging: { timescale: 'slow', description: 'Plugged in (1) or on battery (0)' },
  // Controllers: each axis or knob is its own channel and is routed by timescale.
  'controller.axis': { timescale: 'medium', description: 'Game controller stick' },
  'controller.trigger': { timescale: 'fast', description: 'Game controller trigger' },
  'controller.buttons': { timescale: 'fast', description: 'Game controller buttons held' },
  'midi.cc': { timescale: 'medium', description: 'MIDI knob, fader or pitch bend' },
  'midi.note': { timescale: 'fast', description: 'MIDI key velocity' },
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
