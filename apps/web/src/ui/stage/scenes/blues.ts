import { mix, noise } from '../gfx';
import { figure, guitar, twinkle } from '../kit';
import type { Scene } from '../stage';
import { agingSky, asleep, dim } from './common';

/**
 * Blues: a porch at night. The guitarist rocks in a chair, strumming the
 * chords; someone blows the harmonica lead, stamping the snare on the
 * boards; the dog's tail thumps the kick, fireflies blink on the hats, the
 * double bass hums with the bass line and the window glows with the organ.
 */
export const blues: Scene = {
  id: 'blues',
  name: 'Blues',
  cast: [
    { key: 'dog', want: ['kick', 'drums'] },
    { key: 'flies', want: ['hats', 'perc'] },
    { key: 'stomp', want: ['snare', 'perc'] },
    { key: 'guitar', want: ['chords', 'pad', 'arp'] },
    { key: 'harp', want: ['lead', 'arp', 'tonal'] },
    { key: 'bass', want: ['bass'] },
    { key: 'window', want: ['pad', 'chords'] },
  ],
  draw(s) {
    const { g, t } = s;
    agingSky(
      g,
      s.drift,
      [
        ['#182448', '#20305a', '#283c6c', '#304880'],
        ['#141834', '#1a2040', '#20284c', '#283058'],
        ['#0c0c18', '#10101e', '#141426', '#18182e'],
      ],
      0,
      64,
    );
    for (let i = 0; i < 20; i++)
      twinkle(
        g,
        Math.floor(noise(i) * g.w),
        Math.floor(noise(i + 9) * 40),
        (t + i) % 5 > 4.7 ? 1 : 0,
        '#c0c8e0',
      );
    // The yard under the night sky, out to the porch.
    g.rect(0, 64, g.w, 14, mix('#121a12', '#0a0e0a', s.drift));
    for (let x = 0; x < 96; x += 6)
      g.rect(x, 64 - Math.floor(noise(x + 70) * 3), 6, 3, mix('#18241a', '#0e140e', s.drift));
    g.circle(28, 18, 6, '#f0e8c0');
    g.circle(30, 17, 6, mix('#182448', '#0c0c18', s.drift));
    // The house: wall, window, porch posts and roof.
    g.rect(96, 20, 96, 52, '#5a4030');
    for (let y = 22; y < 72; y += 4) g.rect(96, y, 96, 1, '#4a3424');
    const win = s.actor('window');
    const glow = (win.on || !s.playing ? 0.5 : 0.2) + win.hit * 0.5;
    g.rect(140, 32, 18, 14, mix('#2a2018', '#ffc860', glow));
    g.rect(148, 32, 2, 14, '#3a2a1a');
    g.rect(140, 38, 18, 2, '#3a2a1a');
    s.place('window', { x: 149, y: 28 });
    g.rect(90, 14, 102, 6, '#3a2a20');
    g.rect(98, 20, 3, 52, '#2a1c14');
    g.rect(184, 20, 3, 52, '#2a1c14');
    // The porch boards.
    g.rect(80, 72, 112, 6, '#7a5a3a');
    for (let x = 80; x < g.w; x += 9) g.rect(x, 72, 1, 6, '#5a3a22');
    g.rect(0, 78, g.w, 30, '#1a2414');
    for (let i = 0; i < 30; i++)
      g.rect(Math.floor(noise(i + 40) * g.w), 78 + Math.floor(noise(i + 41) * 28), 1, 2, '#2a3a1e');
    // Fireflies over the grass.
    const flies = s.actor('flies');
    for (let i = 0; i < 5; i++) {
      const fx = 10 + i * 16 + Math.round(Math.sin(t * 0.8 + i) * 6);
      const fy = 66 + Math.round(Math.sin(t * 1.3 + i * 2) * 6);
      const lit = flies.on && flies.count % 5 === i ? flies.hit : 0.05;
      g.px(fx, fy, lit > 0.2 ? '#e8ff60' : '#384018');
      if (lit > 0.6) twinkle(g, fx, fy, 1, '#e8ff60');
    }
    s.place('flies', { x: 40, y: 58 });
    // The rocking chair and the guitarist.
    const gtr = s.actor('guitar');
    const rock = Math.round(Math.sin(s.beats * Math.PI) * (gtr.on ? 1.5 : 0.5));
    g.line(108 + rock, 72, 128 + rock, 72, '#3a2414');
    g.line(112, 60, 110 + rock, 71, '#3a2414');
    const player = figure(
      g,
      118 + rock,
      72,
      dim(
        {
          skin: '#7a4a2a',
          hair: '#e0e0e0',
          shirt: '#8a3030',
          pants: '#2a3048',
          hat: 'brim',
          hatColor: '#3a2a1a',
        },
        gtr,
        s.playing,
      ),
      {
        sitting: true,
        armL: [5, 3],
        armR: [3, gtr.hit > 0.3 ? 4 : 2],
        nod: gtr.hit > 0.6 ? 1 : 0,
        eyesClosed: asleep(gtr, s.playing),
      },
    );
    guitar(g, 122 + rock, 66, '#b06020', gtr.hit);
    s.place('guitar', player);
    // The harmonica.
    const harp = s.actor('harp');
    const blower = figure(
      g,
      168,
      72,
      dim(
        {
          skin: '#a86a40',
          hair: '#202020',
          shirt: '#3a5a8a',
          pants: '#3a3a3a',
          hat: 'cap',
          hatColor: '#5a5a2a',
        },
        harp,
        s.playing,
      ),
      {
        armL: [2, -2],
        armR: [2, -2],
        mouth: harp.hit > 0.2,
        bob: harp.hit > 0.5 ? 1 : 0,
        flip: true,
        eyesClosed: asleep(harp, s.playing),
      },
    );
    g.rect(163, blower.y + 7, 4, 1, '#d0d0d8');
    // The boards under the harmonica player give with every stamp of the snare.
    const stomp = s.actor('stomp');
    if (stomp.on && stomp.hit > 0.4) g.rect(160, 72, 16, 1, '#a07a50');
    if (stomp.fresh) s.float({ x: 172, y: 71, color: '#c0a070', kind: 'spark', life: 0.4 });
    s.place('stomp', blower);
    if (harp.fresh) s.float({ x: 160, y: blower.y + 4, color: '#a0c0ff', kind: 'note' });
    s.place('harp', blower);
    // The double bass leans on the wall, its strings humming with the bass line.
    const bass = s.actor('bass');
    g.circle(184, 66, 3, '#7a3a14', 5);
    g.rect(184, 46, 1, 16, '#4a2208');
    if (bass.hit > 0.3) g.rect(185, 52, 1, 14, '#ffe0a0');
    s.place('bass', { x: 184, y: 44 });
    // The dog's tail thumps the kick.
    const dog = s.actor('dog');
    const dogC = dog.on || !s.playing ? '#a07040' : '#504840';
    g.rect(52, 84, 14, 6, dogC);
    g.rect(64, 80, 6, 6, dogC);
    g.rect(68, 82, 3, 2, '#3a2a1a');
    g.px(66, 82, '#000');
    g.rect(54, 90, 2, 3, dogC);
    g.rect(62, 90, 2, 3, dogC);
    const wag = dog.hit > 0.4 ? -5 : -2;
    g.line(52, 85, 47, 85 + wag, dogC);
    if (dog.fresh) s.float({ x: 46, y: 80, color: '#e0c080', kind: 'spark', life: 0.5 });
    s.place('dog', { x: 66, y: 76 });
  },
};
