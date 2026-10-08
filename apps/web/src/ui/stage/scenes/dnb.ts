import { mix, noise } from '../gfx';
import { figure } from '../kit';
import type { Scene } from '../stage';
import { agingSky, asleep, dim } from './common';

/**
 * Drum & bass: a run through the city at night. The runner's stride
 * follows the breaks, the windows blink on the hats, the buildings wobble
 * with the reese, the ground shakes on the sub and the moon hazes with the
 * pads.
 */
export const dnb: Scene = {
  id: 'dnb',
  name: 'Drum & bass',
  cast: [
    { key: 'runner', want: ['kick', 'snare', 'drums'] },
    { key: 'windows', want: ['hats', 'perc', 'drums'] },
    { key: 'reese', want: ['bass'] },
    { key: 'moon', want: ['pad', 'chords'] },
    { key: 'sign', want: ['lead', 'arp', 'tonal'] },
    { key: 'feet', want: ['snare', 'perc'] },
  ],
  draw(s) {
    const { g, t } = s;
    const reese = s.actor('reese');
    const shake =
      reese.on && reese.hit > 0.6 ? Math.round((noise(Math.floor(t * 30)) - 0.5) * 2) : 0;
    agingSky(
      g,
      s.drift,
      [
        ['#0a0a20', '#10102c', '#181838', '#202044'],
        ['#140a24', '#1c1030', '#24163c', '#2c1c48'],
        ['#04040c', '#080812', '#0c0c18', '#10101e'],
      ],
      0,
      80,
    );
    const moon = s.actor('moon');
    g.ctx.globalAlpha = 0.15 + moon.hit * 0.3;
    g.circle(160, 18, 14, '#a0b0ff');
    g.ctx.globalAlpha = 1;
    g.circle(160, 18, 7, '#e0e4ff');
    s.place('moon', { x: 160, y: 8 });
    // Buildings in two layers, scrolling past; the near ones wobble with the reese.
    const speed = s.playing ? s.beats * 10 : t * 4;
    const windows = s.actor('windows');
    for (const layer of [0, 1]) {
      const scroll = speed * (layer ? 1 : 0.4);
      const base = layer ? 84 : 76;
      const colour = layer ? '#0c0c1c' : '#16163a';
      for (let i = -1; i < 12; i++) {
        const n = i + Math.floor(scroll / 24);
        const x = i * 24 - (scroll % 24);
        const h = 26 + Math.floor(noise(n * 3 + layer * 50) * (layer ? 40 : 30));
        const wob = layer && reese.on ? Math.round(Math.sin(t * 9 + n) * reese.hit * 2) : 0;
        g.rect(x + wob, base - h + shake, 22, h, colour);
        if (layer) {
          for (let wy = base - h + 4; wy < base - 4; wy += 6) {
            for (let wx = 3; wx < 20; wx += 5) {
              const lit = noise(n * 97 + wy * 7 + wx) > 0.62;
              const blink =
                windows.on && windows.hit > 0.3 && noise(n + wy + wx + windows.count) > 0.7;
              if (lit || blink)
                g.rect(x + wob + wx, wy + shake, 2, 3, blink ? '#60f0ff' : '#c0a040');
            }
          }
        }
      }
    }
    s.place('windows', { x: 60, y: 30 });
    // A neon sign flickering with the lead.
    const sign = s.actor('sign');
    g.rect(120, 40 + shake, 30, 9, '#100818');
    g.text('DNB', 126, 42 + shake, sign.on ? mix('#601060', '#ff40f0', sign.hit) : '#401040');
    if (sign.fresh) s.float({ x: 150, y: 38, color: '#ff80f0', kind: 'note' });
    s.place('sign', { x: 135, y: 36 });
    // The road, rushing.
    g.rect(0, 84 + shake, g.w, 24, '#18181e');
    for (let x = -((speed * 2.5) % 24); x < g.w; x += 24) g.rect(x, 96 + shake, 12, 1, '#e0e050');
    s.place('reese', { x: 30, y: 60 });
    // The runner: one step per hit of the break.
    const runner = s.actor('runner');
    const feet = s.actor('feet');
    const step = runner.count + feet.count;
    const at = figure(
      g,
      70,
      92 + shake,
      dim(
        {
          skin: '#c08060',
          hair: '#101010',
          shirt: '#30d0a0',
          pants: '#202030',
          hat: 'cap',
          hatColor: '#f04080',
        },
        runner,
        s.playing,
      ),
      {
        stride: s.playing && runner.on ? (step % 2 === 0 ? 1 : -1) : 0,
        bob: runner.hit > 0.5 ? 1 : 0,
        armL: step % 2 === 0 ? [-4, 2] : [3, 3],
        armR: step % 2 === 0 ? [4, 2] : [-3, 3],
        eyesClosed: asleep(runner, s.playing),
      },
    );
    s.place('runner', at);
    s.place('feet', { x: 70, y: 96 });
  },
};
