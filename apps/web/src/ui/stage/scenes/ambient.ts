import { mix, noise } from '../gfx';
import { figure, twinkle } from '../kit';
import type { Scene } from '../stage';
import { agingSky, asleep, dim, sway } from './common';

/** Rings on the water, one per pluck. */
let ripplesAt: { x: number; y: number; age: number }[] = [];

/**
 * Ambient: a lake at night. The pads breathe as an aurora, bells twinkle as
 * stars, the drone is the moon's glow, plucks ripple the water and the soft
 * rim is a firefly; someone sits on the jetty, listening.
 */
export const ambient: Scene = {
  id: 'ambient',
  name: 'Ambient',
  cast: [
    { key: 'aurora', want: ['pad', 'chords'] },
    { key: 'moon', want: ['drone', 'pad', 'chords', 'bass'] },
    { key: 'stars', want: ['lead', 'arp'] },
    { key: 'ripples', want: ['arp', 'lead', 'tonal'] },
    { key: 'firefly', want: ['drums'] },
    { key: 'sitter', want: ['bass', 'tonal'] },
  ],
  draw(s) {
    const { g, t } = s;
    agingSky(
      g,
      s.drift,
      [
        ['#0a0e2e', '#101848', '#18245e', '#203070', '#283c80'],
        ['#060818', '#0a1030', '#101a48', '#18245a', '#20306a'],
        ['#140818', '#200c30', '#2c1448', '#381c58', '#442468'],
      ],
      0,
      70,
    );
    // Stars: each bell lights one.
    const stars = s.actor('stars');
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(noise(i * 3) * g.w);
      const y = Math.floor(noise(i * 3 + 1) * 46) + 2;
      const lit = stars.on && stars.count % 26 === i ? stars.hit : 0;
      const shimmer = (t * 0.7 + noise(i)) % 4 > 3.7 ? 0.6 : 0.2;
      twinkle(g, x, y, Math.max(lit, shimmer), lit > 0.2 ? '#fff6c0' : '#a0a8d0');
    }
    // The aurora: bands that wave and brighten with the pads.
    const aurora = s.actor('aurora');
    const glow = (aurora.on || !s.playing ? 0.35 : 0.1) + aurora.hit * 0.5;
    for (let x = 0; x < g.w; x += 2) {
      const y = 18 + Math.sin(x / 17 + t * 0.6) * 6 + Math.sin(x / 7 - t) * 2;
      const h = 8 + Math.sin(x / 11 + t * 0.4) * 4;
      for (let k = 0; k < h; k++) {
        const c = mix('#40f0a0', '#a060f0', k / h);
        g.ctx.globalAlpha = glow * (1 - k / h) * 0.8;
        g.rect(x, y + k, 2, 1, c);
      }
    }
    g.ctx.globalAlpha = 1;
    // The moon glows with the drone.
    const moon = s.actor('moon');
    const halo = 7 + Math.round(moon.hit * 4 + (moon.on ? Math.sin(t) : 0));
    g.ctx.globalAlpha = 0.25;
    g.circle(150, 22, halo + 3, '#c0c8ff');
    g.ctx.globalAlpha = 1;
    g.circle(150, 22, 7, '#f0f0e0');
    g.circle(147, 20, 2, '#d0d0c0');
    // Mountains.
    for (let x = 0; x < g.w; x++) {
      const h = 14 + Math.abs(Math.sin(x / 23)) * 16 + Math.sin(x / 7) * 2;
      g.rect(x, 70 - h, 1, h, '#0a0c22');
    }
    // The lake: the sky upside down, with ripples.
    g.bands(70, 38, ['#0c1438', '#0a1030', '#080c28', '#060820']);
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(noise(i + 50) * g.w);
      const y = 74 + Math.floor(noise(i + 60) * 30);
      g.rect(x + sway(t, i, 2), y, 6, 1, '#1c2860');
    }
    g.rect(148 + sway(t, 2, 1), 76, 5, 1, '#c0c0b0');
    g.rect(147 + sway(t, 3, 1), 80, 7, 1, '#9090a0');
    const ripples = s.actor('ripples');
    if (ripples.fresh) {
      ripplesAt.push({
        x: 30 + Math.floor(noise(ripples.count) * 130),
        y: 82 + Math.floor(noise(ripples.count + 9) * 18),
        age: 0,
      });
    }
    for (const r of ripplesAt) {
      r.age += s.dt;
      g.ring(r.x, r.y, 2 + r.age * 14, 1 + r.age * 4, mix('#a0b0ff', '#0c1438', r.age / 1.4));
    }
    ripplesAt = ripplesAt.filter((r) => r.age < 1.4);
    // The jetty and who sits on it.
    g.rect(0, 82, 48, 3, '#3a2a1a');
    g.rect(8, 85, 2, 10, '#2a1a0a');
    g.rect(38, 85, 2, 10, '#2a1a0a');
    const sitter = s.actor('sitter');
    const at = figure(
      g,
      28,
      82,
      dim(
        {
          skin: '#d8a070',
          hair: '#202030',
          shirt: '#405080',
          pants: '#203040',
          hat: 'beanie',
          hatColor: '#a04040',
        },
        sitter,
        s.playing,
      ),
      {
        sitting: true,
        nod: sitter.hit > 0.6 ? 1 : 0,
        armL: [3, 3],
        armR: [3, 3],
        eyesClosed: asleep(sitter, s.playing),
      },
    );
    s.place('sitter', at);
    // A firefly over the shore.
    const fly = s.actor('firefly');
    if (fly.on) {
      const fx = 60 + Math.round(Math.sin(t * 0.9) * 20);
      const fy = 66 + Math.round(Math.sin(t * 1.7) * 5);
      g.px(fx, fy, fly.hit > 0.2 ? '#f0ff60' : '#506020');
      if (fly.hit > 0.5) twinkle(g, fx, fy, 1, '#f0ff60');
      s.place('firefly', { x: fx, y: fy - 2 });
    }
    s.place('stars', { x: 96, y: 10 });
    s.place('aurora', { x: 60, y: 14 });
    s.place('moon', { x: 150, y: 12 });
  },
};
