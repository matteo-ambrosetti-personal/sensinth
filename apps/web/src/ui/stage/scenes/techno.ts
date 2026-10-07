import { mix, noise } from '../gfx';
import { figure, speaker } from '../kit';
import type { Scene } from '../stage';
import { asleep, dim } from './common';

/**
 * Techno: a warehouse. Speaker stacks pump and the DJ nods on the kick,
 * strobes fire on the hats, the crowd's hands go up on the clap, acid
 * lasers sweep with the bass (longer as its filter opens) and the stabs
 * wash the room in colour.
 */
export const techno: Scene = {
  id: 'techno',
  name: 'Techno',
  cast: [
    { key: 'kick', want: ['kick', 'drums'] },
    { key: 'strobe', want: ['hats', 'perc'] },
    { key: 'crowd', want: ['snare', 'perc', 'drums'] },
    { key: 'laser', want: ['bass', 'lead'] },
    { key: 'stab', want: ['chords', 'pad', 'arp'] },
    { key: 'dj', want: ['lead', 'arp', 'tonal'] },
  ],
  draw(s) {
    const { g, t } = s;
    const kick = s.actor('kick');
    const stab = s.actor('stab');
    // The room: concrete, washed by the stabs.
    const wash = stab.on ? stab.hit : 0;
    const wall = mix(
      mix('#16161c', '#24102a', s.drift),
      ['#401060', '#104060', '#601030'][stab.count % 3] as string,
      wash * 0.6,
    );
    g.rect(0, 0, g.w, 108, wall);
    for (let x = 0; x < g.w; x += 24) g.rect(x, 0, 2, 70, mix(wall, '#000000', 0.4));
    g.rect(0, 14, g.w, 2, '#0c0c10');
    // Lasers from the rig, with the bass.
    const laser = s.actor('laser');
    if (laser.on && laser.hit > 0.1) {
      const len = 30 + laser.cutoff * 70;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI / 2 + Math.sin(t * 1.5 + i) * 0.9;
        const x0 = 40 + i * 28;
        g.ctx.globalAlpha = 0.4 + laser.hit * 0.6;
        g.line(
          x0,
          15,
          x0 + Math.cos(a) * len,
          15 + Math.sin(a) * len,
          i % 2 ? '#40ff60' : '#ff3050',
        );
      }
      g.ctx.globalAlpha = 1;
    }
    s.place('laser', { x: 96, y: 18 });
    // The strobe.
    const strobe = s.actor('strobe');
    if (strobe.on && strobe.hit > 0.75) {
      g.ctx.globalAlpha = 0.35;
      g.rect(0, 0, g.w, 108, '#ffffff');
      g.ctx.globalAlpha = 1;
    }
    for (let i = 0; i < 4; i++)
      g.rect(
        30 + i * 44,
        12,
        6,
        3,
        strobe.hit > 0.5 && strobe.count % 4 === i ? '#ffffff' : '#404048',
      );
    s.place('strobe', { x: 96, y: 8 });
    // The floor.
    g.rect(0, 80, g.w, 28, '#0c0c10');
    // Speaker stacks.
    for (const x of [4, 168]) {
      speaker(g, x, 44, 20, 18, kick.hit);
      speaker(g, x, 62, 20, 18, kick.hit);
    }
    s.place('kick', { x: 14, y: 40 });
    // The DJ booth.
    const dj = s.actor('dj');
    const djOn = dj.on || kick.on;
    const at = figure(
      g,
      96,
      70,
      dim(
        { skin: '#e0b090', hair: '#e8e8f0', shirt: '#101014', pants: '#101014', shades: true },
        djOn ? { ...dj, on: true } : dj,
        s.playing,
      ),
      {
        nod: kick.hit > 0.5 ? 2 : kick.hit > 0.2 ? 1 : 0,
        armL: [-3, dj.hit > 0.3 ? 2 : 4],
        armR: [3, strobe.hit > 0.4 ? -6 : 4],
        eyesClosed: asleep(djOn ? { ...dj, on: true } : dj, s.playing),
      },
    );
    g.rect(78, 66, 36, 14, '#202028');
    g.rect(78, 66, 36, 1, '#606070');
    g.circle(86, 69, 3, '#0a0a0a', 1);
    g.circle(106, 69, 3, '#0a0a0a', 1);
    g.px(86 + Math.round(Math.cos(s.beats * 3) * 2), 69, '#e03030');
    g.px(106 + Math.round(Math.cos(s.beats * 3 + 1) * 2), 69, '#e03030');
    for (let i = 0; i < 4; i++)
      g.rect(93 + i * 2, 72, 1, 4, dj.hit > 0.3 && i === dj.count % 4 ? '#40f060' : '#406040');
    if (dj.fresh) s.float({ x: 96, y: at.y - 2, color: '#40f0a0', kind: 'note' });
    s.place('dj', at);
    // The crowd: silhouettes whose hands go up on the clap.
    const crowd = s.actor('crowd');
    for (let i = 0; i < 12; i++) {
      const x = 8 + i * 15 + Math.floor(noise(i) * 6);
      const jump = Math.round(
        Math.abs(Math.sin(s.beats * Math.PI + i)) * (s.playing ? 2 : 0) * (0.3 + s.energy),
      );
      const up = crowd.on && crowd.hit > 0.3 && (crowd.count + i) % 2 === 0;
      const y = 104 - jump;
      g.rect(x - 3, y - 12, 7, 12, '#060608');
      g.rect(x - 2, y - 17, 5, 5, '#060608');
      if (up) {
        g.line(x - 3, y - 11, x - 5, y - 20, '#060608', 2);
        g.line(x + 3, y - 11, x + 5, y - 20, '#060608', 2);
      }
    }
    s.place('crowd', { x: 96, y: 84 });
    s.place('stab', { x: 150, y: 26 });
  },
};
