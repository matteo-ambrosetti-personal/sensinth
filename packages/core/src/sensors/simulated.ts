import { clamp, mod } from '../math';
import { Rng } from '../random';
import type { SensorDescriptor, SensorSample } from './types';

/**
 * Fake sensors for desktop development and tests. Uses the same kinds as
 * real phone and Pico sensors, so the same mapping applies. Slow channels
 * move faster than real weather so changes are audible within minutes.
 */
export class SimulatedSource {
  readonly id = 'sim';
  readonly descriptors: readonly SensorDescriptor[] = [
    {
      id: 'sim.accel',
      kind: 'motion.accel',
      label: 'Shake (sim)',
      unit: 'm/s²',
      minSpan: 3,
      rateHz: 30,
      source: 'sim',
    },
    {
      id: 'sim.tilt',
      kind: 'orientation.pitch',
      label: 'Tilt (sim)',
      unit: '°',
      range: [-90, 90],
      rateHz: 30,
      source: 'sim',
    },
    {
      id: 'sim.roll',
      kind: 'orientation.roll',
      label: 'Roll (sim)',
      unit: '°',
      range: [-90, 90],
      rateHz: 30,
      source: 'sim',
    },
    {
      id: 'sim.heading',
      kind: 'heading',
      label: 'Compass (sim)',
      unit: '°',
      range: [0, 360],
      circular: true,
      rateHz: 30,
      source: 'sim',
    },
    {
      id: 'sim.light',
      kind: 'light',
      label: 'Light (sim)',
      unit: 'lx',
      minSpan: 30,
      rateHz: 30,
      source: 'sim',
    },
    {
      id: 'sim.sound',
      kind: 'sound.level',
      label: 'Sound (sim)',
      unit: 'dB',
      minSpan: 8,
      rateHz: 30,
      source: 'sim',
    },
    {
      id: 'sim.motion',
      kind: 'camera.motion',
      label: 'Camera motion (sim)',
      range: [0, 1],
      rateHz: 30,
      source: 'sim',
    },
    {
      id: 'sim.temperature',
      kind: 'temperature',
      label: 'Temperature (sim)',
      unit: '°C',
      minSpan: 2,
      rateHz: 30,
      source: 'sim',
    },
    {
      id: 'sim.pressure',
      kind: 'pressure',
      label: 'Pressure (sim)',
      unit: 'hPa',
      minSpan: 4,
      rateHz: 30,
      source: 'sim',
    },
    {
      id: 'sim.humidity',
      kind: 'humidity',
      label: 'Humidity (sim)',
      unit: '%',
      range: [0, 100],
      rateHz: 30,
      source: 'sim',
    },
  ];

  private readonly rng: Rng;
  private lastT: number | undefined;
  private tilt = 0;
  private roll = 0;
  private heading = 0;
  private temperature = 22;
  private pressure = 1013;
  private humidity = 50;
  private shakeUntil = -1;
  private shakeAmp = 0;
  private nextShake: number;
  private clapUntil = -1;
  private nextClap: number;
  private motionUntil = -1;
  private nextMotion: number;

  constructor(seed = 7) {
    this.rng = new Rng(seed);
    this.nextShake = this.rng.range(4, 10);
    this.nextClap = this.rng.range(2, 6);
    this.nextMotion = this.rng.range(8, 20);
  }

  /** Samples every channel at time `t` (seconds, non-decreasing). */
  sampleAt(t: number): SensorSample[] {
    const dt = this.lastT === undefined ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    const r = this.rng;
    const walk = (x: number, speed: number, lo: number, hi: number) =>
      clamp(x + r.range(-1, 1) * speed * Math.sqrt(dt) * 10, lo, hi);

    this.tilt = walk(this.tilt + Math.sin(t / 9) * dt * 4, 2.5, -60, 60);
    this.roll = walk(this.roll + Math.cos(t / 13) * dt * 3, 2, -60, 60);
    this.heading = mod(this.heading + r.range(-1, 1.6) * dt * 6, 360);
    this.temperature = walk(this.temperature, 0.05, 15, 30);
    this.pressure = walk(this.pressure + Math.sin(t / 70) * dt * 0.08, 0.06, 990, 1030);
    this.humidity = walk(this.humidity + Math.sin(t / 50) * dt * 0.4, 0.15, 25, 85);

    if (t >= this.nextShake) {
      this.shakeUntil = t + r.range(1.5, 4);
      this.shakeAmp = r.range(3, 12);
      this.nextShake = this.shakeUntil + r.range(6, 16);
    }
    const shaking = t < this.shakeUntil;
    const accel =
      0.08 * r.next() + (shaking ? this.shakeAmp * Math.abs(Math.sin(t * Math.PI * 4)) : 0);

    if (t >= this.nextClap) {
      this.clapUntil = t + 0.06;
      this.nextClap = t + r.range(2, 7);
    }
    const sound = -50 + 3 * r.next() + (t < this.clapUntil ? 28 : 0);

    if (t >= this.nextMotion) {
      this.motionUntil = t + r.range(1, 3);
      this.nextMotion = this.motionUntil + r.range(8, 25);
    }
    const motion = t < this.motionUntil ? 0.5 + 0.4 * r.next() : 0.02 * r.next();
    const light = 400 + 350 * Math.sin(t / 25) + 20 * r.next();

    const v: Record<string, number> = {
      'sim.accel': accel,
      'sim.tilt': this.tilt,
      'sim.roll': this.roll,
      'sim.heading': this.heading,
      'sim.light': light,
      'sim.sound': sound,
      'sim.motion': motion,
      'sim.temperature': this.temperature,
      'sim.pressure': this.pressure,
      'sim.humidity': this.humidity,
    };
    return this.descriptors.map((d) => ({ id: d.id, t, v: v[d.id] as number }));
  }
}
