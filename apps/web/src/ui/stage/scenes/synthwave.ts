import { mix, noise } from '../gfx';
import { twinkle } from '../kit';
import type { Scene } from '../stage';
import { agingSky } from './common';

/**
 * Synthwave: a drive into the sunset. The grid pulses on the kick, the palm
 * trees sway on the snare, the sun's stripes shimmer with the pads, the car
 * bounces with the bass and flashes its lights on the lead, stars twinkle
 * on the arp. The sun sinks as the music drifts.
 */
export const synthwave: Scene = {
  id: 'synthwave',
  name: 'Synthwave',
  cast: [
    { key: 'grid', want: ['kick', 'drums'] },
    { key: 'palms', want: ['snare', 'perc', 'hats'] },
    { key: 'sun', want: ['pad', 'chords'] },
    { key: 'car', want: ['bass'] },
    { key: 'lights', want: ['lead', 'tonal'] },
    { key: 'stars', want: ['arp', 'hats', 'lead'] },
  ],
  draw(s) {
    const { g, t } = s;
    const horizon = 62;
    agingSky(
      g,
      s.drift,
      [
        ['#200838', '#3a0c50', '#701860', '#c03070', '#f86870'],
        ['#100420', '#200838', '#40104c', '#80205c', '#c04060'],
        ['#06020e', '#0c0418', '#180828', '#301040', '#501850'],
      ],
      0,
      horizon,
    );
    const stars = s.actor('stars');
    for (let i = 0; i < 22; i++) {
      const lit = stars.on && stars.count % 22 === i ? stars.hit : 0;
      twinkle(
        g,
        Math.floor(noise(i * 5) * g.w),
        Math.floor(noise(i * 5 + 2) * 30),
        Math.max(lit, (t + i) % 4 > 3.8 ? 0.6 : 0),
        lit > 0.2 ? '#80f0ff' : '#b080c0',
      );
    }
    // The sun, sinking with the drift, its stripes moving with the pads.
    const sun = s.actor('sun');
    const sy = 40 + Math.round(s.drift * 18);
    g.ctx.save();
    g.ctx.beginPath();
    g.ctx.rect(0, 0, g.w, horizon);
    g.ctx.clip();
    for (let dy = -18; dy <= 18; dy++) {
      const half = Math.round(18 * Math.sqrt(Math.max(0, 1 - (dy / 18) ** 2)));
      const stripe = dy > 0 && Math.floor((dy + (sun.on ? sun.hit * 3 + t * 2 : t)) / 3) % 2 === 0;
      if (stripe) continue;
      g.rect(96 - half, sy + dy, half * 2, 1, mix('#fff060', '#ff3080', (dy + 18) / 36));
    }
    g.ctx.restore();
    s.place('sun', { x: 96, y: sy - 22 });
    // Mountains.
    for (let x = 0; x < g.w; x++) {
      const h = Math.abs(((x * 7) % 46) - 23) * 0.6 + Math.sin(x / 9) * 2;
      if (x < 60 || x > 132) g.rect(x, horizon - h, 1, h, '#180830');
    }
    // The grid, rushing at the tempo, pulsing on the kick.
    const grid = s.actor('grid');
    g.rect(0, horizon, g.w, g.h - horizon, '#0c0418');
    const line = mix('#c020c0', '#ff80ff', grid.on ? grid.hit : 0);
    const speed = s.playing ? s.beats : t * 0.5;
    for (let i = 0; i < 12; i++) {
      const z = ((i + (speed % 1)) / 12) ** 2;
      g.rect(0, horizon + Math.round(z * (g.h - horizon)), g.w, 1, line);
    }
    for (let i = -12; i <= 12; i++) g.line(96 + i * 4, horizon, 96 + i * 26, g.h, line);
    s.place('grid', { x: 96, y: horizon + 4 });
    // Palm trees, swaying on the snare.
    const palms = s.actor('palms');
    for (const [x, dir] of [
      [16, 1],
      [176, -1],
    ] as const) {
      const bend = Math.round((palms.on ? palms.hit * 4 : 0) * dir + Math.sin(t) * dir);
      g.line(x, g.h, x + bend, 50, '#100418', 3);
      for (const a of [-1.4, -0.8, -0.3, 0.3, 0.8, 1.4]) {
        const ex = x + bend + Math.round(Math.sin(a) * 16);
        const ey = 50 + Math.round((1 - Math.cos(a)) * 8) - 3;
        g.line(x + bend, 50, ex, ey, '#100418', 2);
        g.line(ex, ey, ex + Math.sign(a) * 2, ey + 3, '#100418', 2);
      }
    }
    s.place('palms', { x: 16, y: 44 });
    // The car, from behind.
    const car = s.actor('car');
    const lights = s.actor('lights');
    const bounce = car.on ? Math.round(car.hit * 2) : 0;
    const cy = 92 - bounce;
    g.rect(80, cy - 8, 32, 8, '#18102a');
    g.rect(84, cy - 13, 24, 5, '#241838');
    g.rect(86, cy - 12, 20, 3, '#402868');
    const tail = lights.on ? mix('#601020', '#ff4060', lights.hit) : '#601020';
    g.rect(81, cy - 6, 6, 2, tail);
    g.rect(105, cy - 6, 6, 2, tail);
    if (lights.on && lights.hit > 0.5) {
      g.ctx.globalAlpha = 0.3;
      g.circle(84, cy - 5, 5, '#ff4060', 3);
      g.circle(108, cy - 5, 5, '#ff4060', 3);
      g.ctx.globalAlpha = 1;
    }
    g.rect(82, cy, 6, 3, '#080808');
    g.rect(104, cy, 6, 3, '#080808');
    if (lights.fresh) s.float({ x: 96, y: cy - 16, color: '#80f0ff', kind: 'note' });
    s.place('car', { x: 96, y: cy - 16 });
    s.place('lights', { x: 108, y: cy - 10 });
    s.place('stars', { x: 40, y: 8 });
  },
};
