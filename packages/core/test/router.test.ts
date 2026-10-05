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

  it('darkens the music when the camera is covered', () => {
    const hub = new SensorHub();
    hub.announce({
      id: 'cam',
      kind: 'camera.luma',
      label: 'Camera',
      range: [0, 1],
      adaptive: true,
      minSpan: 0.15,
    });
    const router = new Router(hub);
    feed(hub, 'cam', (t) => 0.45 + 0.05 * Math.sin(t), 20);
    for (let i = 0; i < 200; i++) router.update(0.05);
    const open = router.macros.brightness;
    feed(hub, 'cam', () => 0.01, 4, 20.05);
    for (let i = 0; i < 200; i++) router.update(0.05);
    expect(open).toBeGreaterThan(0.4);
    expect(router.macros.brightness).toBeLessThan(0.1);
  });

  it('maps the lid, the body and the machine itself', () => {
    const hub = new SensorHub();
    const kinds: Record<string, string> = {
      'lid.angle': 'space',
      'steps.rate': 'energy',
      thermal: 'tension',
      'cpu.load': 'variation',
      'wifi.rssi': 'color',
      'magnetic.field': 'color',
      idle: 'energy',
    };
    for (const kind of Object.keys(kinds)) hub.announce({ id: kind, kind, label: kind });
    const { macros, triggers } = new Router(hub).getRoutes();
    for (const [kind, macro] of Object.entries(kinds)) {
      expect(macros.find((r) => r.channelId === kind && !r.auto)?.macro).toBe(macro);
    }
    expect(macros.find((r) => r.channelId === 'idle')?.invert).toBe(true);
    expect(triggers.find((r) => r.channelId === 'lid.angle')?.trigger).toBe('fill');
  });

  it('spreads knobs and sticks over different dials', () => {
    const hub = new SensorHub();
    for (let i = 0; i < 4; i++) {
      hub.announce({ id: `knob${i}`, kind: 'midi.cc', label: `CC ${i}`, range: [0, 127] });
    }
    const { macros } = new Router(hub).getRoutes();
    const dials = new Set(macros.filter((r) => r.channelId.startsWith('knob')).map((r) => r.macro));
    expect(dials.size).toBe(4);
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

describe('Router solo', () => {
  it('lets one channel drive the music alone', () => {
    const hub = new SensorHub();
    hub.announce({ id: 'light', kind: 'light', label: 'Light', range: [0, 1] });
    hub.announce({ id: 'acc', kind: 'motion.accel', label: 'Shake', minSpan: 3 });
    const router = new Router(hub);
    feed(hub, 'light', () => 1, 3);
    feed(hub, 'acc', (t) => 8 * Math.abs(Math.sin(t * 9)), 3);
    router.setSolo('acc');
    expect(router.solo).toBe('acc');
    for (let i = 0; i < 400; i++) router.update(0.05);
    expect(router.macros.brightness).toBeCloseTo(MACRO_INFO.brightness.fallback, 2);
    router.setSolo(undefined);
    for (let i = 0; i < 400; i++) router.update(0.05);
    expect(router.macros.brightness).toBeGreaterThan(0.9);
  });
});

describe('channel debug signals', () => {
  it('exposes the normalized value and the learned range', () => {
    const hub = new SensorHub();
    hub.announce({ id: 'p', kind: 'pressure', label: 'Pressure', minSpan: 2 });
    feed(hub, 'p', (t) => 1010 + 5 * Math.sin(t), 10);
    const ch = hub.get('p')!;
    expect(ch.debug.normalized).toBeGreaterThanOrEqual(0);
    expect(ch.debug.normalized).toBeLessThanOrEqual(1);
    const [lo, hi] = ch.debug.bounds!;
    expect(lo).toBeLessThanOrEqual(ch.raw);
    expect(hi).toBeGreaterThanOrEqual(ch.raw);
    expect(hi - lo).toBeGreaterThanOrEqual(2);
  });
});
