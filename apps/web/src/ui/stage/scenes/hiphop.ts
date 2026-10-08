import { mix, noise } from '../gfx';
import { figure, speaker, twinkle } from '../kit';
import type { Scene } from '../stage';
import { agingSky, alternate, asleep, dim, sway } from './common';

/** The breakdancer's moves, one per snare hit. */
const MOVES: readonly {
  armL: [number, number];
  armR: [number, number];
  bob: number;
  stride: number;
}[] = [
  { armL: [-3, -4], armR: [3, -4], bob: 0, stride: 0 },
  { armL: [-5, 0], armR: [2, 5], bob: 1, stride: 1 },
  { armL: [-2, 5], armR: [5, 0], bob: 1, stride: -1 },
  { armL: [-4, -5], armR: [4, 2], bob: 3, stride: 0.5 },
];

/**
 * Hip-hop: a street corner. The boombox pumps on the kick, a breakdancer
 * hits a new move on each snare, spray-paint sparkles on the hats, the
 * lowrider bounces with the 808 and the windows light up with the keys.
 */
export const hiphop: Scene = {
  id: 'hiphop',
  name: 'Hip-hop',
  cast: [
    { key: 'boombox', want: ['kick', 'drums'] },
    { key: 'dancer', want: ['snare', 'perc', 'drums'] },
    { key: 'spray', want: ['hats', 'perc'] },
    { key: 'car', want: ['bass'] },
    { key: 'windows', want: ['chords', 'pad', 'arp'] },
    { key: 'mc', want: ['lead', 'arp', 'tonal'] },
  ],
  draw(s) {
    const { g, t } = s;
    agingSky(
      g,
      s.drift,
      [
        ['#f0a060', '#e88058', '#d06050'],
        ['#603070', '#402868', '#282058'],
        ['#101028', '#141434', '#181840'],
      ],
      0,
      30,
    );
    // The brick wall, with windows.
    g.rect(0, 30, g.w, 58, '#7a3a2a');
    for (let y = 30; y < 88; y += 4) {
      g.rect(0, y, g.w, 1, '#5a2a1e');
      for (let x = (y / 4) % 2 ? 0 : 4; x < g.w; x += 8) g.rect(x, y, 1, 4, '#5a2a1e');
    }
    const win = s.actor('windows');
    for (let i = 0; i < 5; i++) {
      const lit = win.on && (win.count + i) % 3 === 0 && win.hit > 0.15;
      g.rect(12 + i * 38, 36, 14, 10, lit ? '#ffd870' : '#1a1a2a');
      g.rect(18 + i * 38, 36, 1, 10, '#3a2020');
    }
    s.place('windows', { x: 50, y: 32 });
    // Graffiti that grows with the drift.
    const tag = ['#40e0f0', '#f040c0', '#f0e040'];
    for (let i = 0; i < Math.round(3 + s.drift * 12); i++) {
      g.rect(
        20 + Math.floor(noise(i) * 150),
        52 + Math.floor(noise(i + 4) * 22),
        4,
        2,
        tag[i % 3] as string,
      );
    }
    // Spray sparkles on the hats.
    const spray = s.actor('spray');
    if (spray.on && spray.hit > 0.2) {
      for (let i = 0; i < 4; i++) {
        twinkle(
          g,
          120 + Math.floor(noise(spray.count * 5 + i) * 30),
          54 + Math.floor(noise(spray.count * 5 + i + 1) * 14),
          spray.hit,
          tag[i % 3],
        );
      }
    }
    s.place('spray', { x: 134, y: 50 });
    // The street.
    g.rect(0, 88, g.w, 20, '#303038');
    for (let x = ((-s.beats * 6) % 20) - 20; x < g.w; x += 20) g.rect(x, 98, 10, 1, '#c0c040');
    // The street lamp.
    g.rect(176, 40, 2, 48, '#202024');
    g.rect(170, 38, 10, 3, '#202024');
    g.ctx.globalAlpha = 0.2;
    g.circle(172, 60, 14, '#fff0b0', 26);
    g.ctx.globalAlpha = 1;
    // The lowrider: bounces with the 808.
    const car = s.actor('car');
    const lift = car.on ? Math.round(car.hit * 5) : 0;
    const cx = 128;
    const cy = 92 - lift;
    const body = car.on || !s.playing ? '#a02868' : '#504050';
    g.rect(cx, cy - 6, 40, 6, body);
    g.rect(cx + 8, cy - 11, 20, 5, mix(body, '#000000', 0.2));
    g.rect(cx + 10, cy - 10, 7, 3, '#80c0f0');
    g.rect(cx + 19, cy - 10, 7, 3, '#80c0f0');
    g.circle(cx + 8, 94, 3, '#101010');
    g.circle(cx + 32, 94, 3, '#101010');
    g.px(cx + 39, cy - 4, '#ffe080');
    s.place('car', { x: cx + 18, y: cy - 14 });
    // The boombox: pumps with the kick.
    const box = s.actor('boombox');
    speaker(g, 18, 78, 9, 10, box.hit);
    speaker(g, 38, 78, 9, 10, box.hit);
    g.rect(27, 79, 11, 9, '#2a2a30');
    g.rect(28, 81, 9, 3, box.hit > 0.4 ? '#40f060' : '#205030');
    g.line(22, 78, 28, 72, '#808088');
    g.line(42, 78, 36, 72, '#808088');
    g.line(28, 72, 36, 72, '#808088');
    s.place('boombox', { x: 32, y: 70 });
    // The breakdancer.
    const dancer = s.actor('dancer');
    const move = MOVES[dancer.on ? dancer.count % MOVES.length : 0] as (typeof MOVES)[number];
    const at = figure(
      g,
      74,
      92,
      dim(
        {
          skin: '#a86a40',
          hair: '#101010',
          shirt: '#f0c020',
          pants: '#2050c0',
          hat: 'cap',
          hatColor: '#202020',
        },
        dancer,
        s.playing,
      ),
      {
        armL: move.armL,
        armR: move.armR,
        bob: Math.round(move.bob * (0.4 + dancer.hit)) + (s.playing ? 0 : sway(t, 0, 1)),
        stride: move.stride,
        flip: alternate(dancer) < 0,
        eyesClosed: asleep(dancer, s.playing),
      },
    );
    s.place('dancer', at);
    // The MC on the lead.
    const mc = s.actor('mc');
    if (mc.on || !s.playing) {
      const mcAt = figure(
        g,
        100,
        92,
        dim(
          { skin: '#7a4a2a', hair: '#101010', shirt: '#e8e8e8', pants: '#303030', shades: true },
          mc,
          s.playing,
        ),
        {
          armR: [3, mc.hit > 0.3 ? -6 : -2],
          armL: [-2, 5],
          mouth: mc.hit > 0.3,
          bob: mc.hit > 0.6 ? 1 : 0,
          flip: true,
        },
      );
      if (mc.fresh) s.float({ x: mcAt.x - 4, y: mcAt.y, color: '#ffffff', kind: 'note' });
      s.place('mc', mcAt);
    }
  },
};
