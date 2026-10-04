import { describe, expect, it } from 'vitest';
import { MACRO_INFO, Router, SensorHub } from '../src';

function feed(hub: SensorHub, id: string, values: (t: number) => number, seconds: number, t0 = 0) {
  for (let t = t0; t <= t0 + seconds; t += 1 / 30) hub.push({ id, t, v: values(t) });
}

describe('Router', () => {
  it('routes known kinds through the default mapping', () => {
    const hub = new SensorHub();
    hub.announce({ id: 'phone.light', kind: 'light', label: 'Light', range: [0, 1000] });
    const router = new Router(hub);
    const routes = router.getRoutes().macros.filter((r) => r.channelId === 'phone.light');
    expect(routes).toEqual([
      expect.objectContaining({ macro: 'brightness', feature: 'level', auto: false }),
    ]);

    feed(hub, 'phone.light', () => 1000, 2);
    for (let i = 0; i < 400; i++) router.update(0.05);
    expect(router.macros.brightness).toBeGreaterThan(0.95);
  });

  it('auto-assigns unknown sensors by timescale', () => {
    const hub = new SensorHub();
    hub.announce({ id: 'pico.soil', kind: 'soil.moisture', label: 'Soil', timescale: 'slow' });
    hub.announce({ id: 'pico.piezo', kind: 'piezo', label: 'Piezo', rateHz: 100 });
    const { macros, triggers } = new Router(hub).getRoutes();
    expect(macros.find((r) => r.channelId === 'pico.soil')).toMatchObject({
      macro: 'space',
      auto: true,
    });
    expect(macros.find((r) => r.channelId === 'pico.piezo')).toMatchObject({
      macro: 'energy',
      feature: 'activity',
      auto: true,
    });
    expect(triggers.find((r) => r.channelId === 'pico.piezo')).toMatchObject({ trigger: 'accent' });
  });

  it('falls back to defaults when channels go stale', () => {
    const hub = new SensorHub();
    hub.announce({ id: 'l', kind: 'light', label: 'l', range: [0, 1] });
    const router = new Router(hub);
    feed(hub, 'l', () => 0, 1);
    hub.markStale(100);
    for (let i = 0; i < 2000; i++) router.update(0.05);
    expect(router.macros.brightness).toBeCloseTo(MACRO_INFO.brightness.fallback, 2);
  });

  it('turns onsets into triggers once', () => {
    const hub = new SensorHub();
    hub.announce({ id: 'acc', kind: 'motion.accel', label: 'acc', minSpan: 3 });
    const router = new Router(hub);
    feed(hub, 'acc', () => 0.05, 3);
    feed(hub, 'acc', () => 15, 0.1, 3.05);
    const first = router.update(0.05).triggers;
    expect(first.accent).toBeGreaterThan(0);
    expect(first.fill).toBeGreaterThan(0);
    expect(router.update(0.05).triggers.accent).toBe(0);
  });
});
