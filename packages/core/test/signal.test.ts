import { describe, expect, it } from 'vitest';
import {
  AdaptiveNormalizer,
  FeatureExtractor,
  MedianFilter,
  OneEuroFilter,
  OnsetDetector,
} from '../src';

describe('AdaptiveNormalizer', () => {
  it('handles constant, NaN and spiky input without leaving 0..1', () => {
    const n = new AdaptiveNormalizer({ minSpan: 1 });
    const inputs = [5, 5, 5, NaN, 5, Infinity, -Infinity, 1e9, 5, -1e9, 5, 5];
    for (const x of inputs) {
      const y = n.update(x, 0.05);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('maps a steady value to the middle and keeps small noise small', () => {
    const n = new AdaptiveNormalizer({ minSpan: 3 });
    let y = 0;
    for (let i = 0; i < 1000; i++) y = n.update(0.05 * Math.sin(i), 0.03);
    expect(Math.abs(y - 0.5)).toBeLessThan(0.05);
  });

  it('uses a fixed range when given one', () => {
    const n = new AdaptiveNormalizer({ range: [-90, 90] });
    expect(n.update(0, 0.1)).toBeCloseTo(0.5);
    expect(n.update(90, 0.1)).toBeCloseTo(1);
    expect(n.update(-200, 0.1)).toBe(0);
  });

  it('learns an unknown range', () => {
    const n = new AdaptiveNormalizer();
    for (let i = 0; i < 200; i++) n.update(1000 + 200 * Math.sin(i / 10), 0.05);
    expect(n.update(1200, 0.05)).toBeGreaterThan(0.9);
    expect(n.update(800, 0.05)).toBeLessThan(0.1);
  });
});

describe('filters', () => {
  it('median removes single spikes', () => {
    const m = new MedianFilter(3);
    m.update(1);
    m.update(1);
    expect(m.update(100)).toBe(1);
  });

  it('One-Euro converges to a constant', () => {
    const f = new OneEuroFilter(1, 1);
    let y = 0;
    f.update(0, 0.02);
    for (let i = 0; i < 300; i++) y = f.update(1, 0.02);
    expect(y).toBeCloseTo(1, 3);
  });

  it('onset detector fires on a jump but not on noise, and respects hysteresis', () => {
    const o = new OnsetDetector({ threshold: 0.2, refractory: 0.1 });
    let fired = 0;
    for (let i = 0; i < 100; i++) if (o.update(0.1 + 0.02 * Math.sin(i), 0.02) > 0) fired++;
    expect(fired).toBe(0);
    if (o.update(0.9, 0.02) > 0) fired++;
    for (let i = 0; i < 5; i++) if (o.update(0.9, 0.02) > 0) fired++;
    expect(fired).toBe(1);
  });
});

describe('FeatureExtractor', () => {
  it('reports high activity while shaking and low at rest', () => {
    const fx = new FeatureExtractor(
      { id: 'a', kind: 'motion.accel', label: 'a', minSpan: 3 },
      'fast',
    );
    let rest = 1;
    for (let i = 0; i < 300; i++) rest = fx.update(0.05 * Math.random(), 1 / 30).activity;
    let shake = 0;
    for (let i = 0; i < 60; i++)
      shake = Math.max(shake, fx.update(10 * Math.abs(Math.sin(i / 2)), 1 / 30).activity);
    expect(rest).toBeLessThan(0.15);
    expect(shake).toBeGreaterThan(0.6);
  });

  it('treats a circular channel as continuous across the wrap', () => {
    const fx = new FeatureExtractor(
      { id: 'h', kind: 'heading', label: 'h', range: [0, 360], circular: true },
      'medium',
    );
    let f = fx.update(350, 0.1);
    for (let i = 0; i < 100; i++) f = fx.update(mod360(350 + i * 0.4), 0.1);
    expect(f.level).toBeGreaterThanOrEqual(0);
    expect(f.level).toBeLessThan(1);
    expect(f.trend).toBeGreaterThan(0);
    expect(Math.abs(f.trend)).toBeLessThan(0.5);
  });
});

function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}
