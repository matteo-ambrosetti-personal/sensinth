import { mix, noise } from '../gfx';
import { figure, keys } from '../kit';
import type { Scene } from '../stage';
import { agingSky, alternate, asleep, dim, sway } from './common';

/**
 * Lo-fi: a desk by a rainy window. The student nods on the kick and taps
 * the pencil on the snare, the cat's tail flicks on the hats, steam rises
 * from the mug with the keys, the record turns with the bass, and the rain
 * gets heavier as the music moves.
 */
export const lofi: Scene = {
  id: 'lofi',
  name: 'Lo-fi',
  cast: [
    { key: 'student', want: ['kick', 'drums'] },
    { key: 'pencil', want: ['snare', 'perc'] },
    { key: 'cat', want: ['hats', 'perc', 'drums'] },
    { key: 'keys', want: ['chords', 'pad', 'lead'] },
    { key: 'record', want: ['bass'] },
    { key: 'lamp', want: ['lead', 'arp', 'pad', 'tonal'] },
  ],
  draw(s) {
    const { g, t } = s;
    // The room.
    g.bands(0, 108, ['#3a2a3a', '#40303e', '#463442', '#4c3846']);
    // The window: the night city in the rain.
    agingSky(
      g,
      s.drift,
      [
        ['#28305c', '#303868', '#384074'],
        ['#3a2850', '#4a305c', '#5a3868'],
        ['#101828', '#141c30', '#182038'],
      ],
      12,
      46,
    );
    g.ctx.save();
    g.ctx.beginPath();
    g.ctx.rect(20, 12, 100, 46);
    g.ctx.clip();
    for (let i = 0; i < 9; i++) {
      const bx = 20 + i * 12;
      const bh = 16 + Math.floor(noise(i + 7) * 20);
      g.rect(bx, 58 - bh, 11, bh, '#141826');
      for (let wy = 58 - bh + 3; wy < 56; wy += 5) {
        for (let wx = bx + 2; wx < bx + 10; wx += 4) {
          if (noise(wx * 31 + wy + Math.floor(t / 4)) > 0.55) g.rect(wx, wy, 2, 2, '#f0c060');
        }
      }
    }
    const rain = 30 + Math.round(s.energy * 50 + s.drift * 40);
    for (let i = 0; i < rain; i++) {
      const x = 20 + Math.floor(noise(i * 7) * 100);
      const y = 12 + ((noise(i * 7 + 1) * 46 + t * 60) % 46);
      g.rect(x, y, 1, 3, 'rgba(180,200,255,0.55)');
    }
    g.ctx.restore();
    g.rect(18, 10, 104, 2, '#20141c');
    g.rect(18, 58, 104, 3, '#20141c');
    g.rect(18, 10, 2, 50, '#20141c');
    g.rect(120, 10, 2, 50, '#20141c');
    g.rect(69, 10, 2, 50, '#20141c');

    // The cat on the sill: its tail flicks with the hats.
    const cat = s.actor('cat');
    const catC = cat.on || !s.playing ? '#5a4a58' : '#3a3440';
    // A rim of light from the street, so the cat shows against the window.
    g.rect(91, 51, 12, 8, '#8a7a90');
    g.rect(99, 47, 7, 7, '#8a7a90');
    g.rect(92, 52, 10, 6, catC);
    g.rect(100, 48, 5, 5, catC);
    g.px(100, 46, catC);
    g.px(104, 46, catC);
    g.px(102, 50, cat.hit > 0.4 ? '#f8f040' : '#a0a020');
    const flick = cat.hit > 0.3 ? alternate(cat) * 3 : sway(t, 0, 1);
    g.line(92, 56, 88 + flick, 50, catC);
    s.place('cat', { x: 101, y: 45 });

    // The desk, the record player, the keys, the mug, the lamp.
    g.rect(0, 80, g.w, 4, '#6a4428');
    g.rect(0, 84, g.w, 24, '#4a2e1a');
    const rec = s.actor('record');
    g.rect(130, 72, 26, 8, '#2a2a30');
    g.circle(141, 75, 6, '#101010', 3);
    const spin = rec.on ? s.beats * 2 : 0;
    g.px(141 + Math.round(Math.cos(spin) * 4), 75 + Math.round(Math.sin(spin) * 2), '#e04040');
    g.line(152, 72, 147, 76 - Math.round(rec.hit * 1), '#c0c0c8');
    s.place('record', { x: 141, y: 66 });

    const k = s.actor('keys');
    keys(g, 60, 76, 14, k.on ? k.hit : 0, '#3a2a20');
    s.place('keys', { x: 80, y: 68 });
    // Steam from the mug, puffs on each chord.
    g.rect(112, 73, 6, 7, '#e8e0d0');
    g.rect(118, 75, 2, 3, '#e8e0d0');
    if (k.fresh) s.float({ x: 114, y: 70, color: '#d0d0d8', kind: 'spark', life: 1.6 });

    const lamp = s.actor('lamp');
    const glow = (lamp.on || !s.playing ? 0.18 : 0.05) + lamp.hit * 0.25;
    g.ctx.globalAlpha = glow;
    g.circle(170, 70, 22, '#ffd080', 14);
    g.ctx.globalAlpha = 1;
    g.line(172, 80, 168, 62, '#202020');
    g.rect(162, 58, 12, 5, mix('#c06030', '#ffd080', lamp.hit));
    if (lamp.fresh)
      s.float({
        x: 160 + Math.floor(noise(lamp.count) * 20),
        y: 54,
        color: '#ffe0a0',
        kind: 'note',
      });
    s.place('lamp', { x: 168, y: 52 });

    // The student: nods on the kick, taps the pencil on the snare.
    const st = s.actor('student');
    const pen = s.actor('pencil');
    const at = figure(
      g,
      40,
      84,
      dim(
        {
          skin: '#e8b890',
          hair: '#2a1a14',
          shirt: '#7a8a50',
          pants: '#3a3a4a',
          hat: 'beanie',
          hatColor: '#c05040',
        },
        st,
        s.playing,
      ),
      {
        sitting: true,
        nod: st.hit > 0.5 ? 2 : st.hit > 0.2 ? 1 : 0,
        armL: [4, 6],
        armR: [6, pen.hit > 0.4 ? 3 : 6],
        eyesClosed: asleep(st, s.playing) || st.hit > 0.7,
      },
    );
    s.place('student', at);
    // The pencil in the hand.
    g.line(50, 73 + (pen.hit > 0.4 ? -3 : 0), 54, 70 + (pen.hit > 0.4 ? -3 : 0), '#f0c020');
    s.place('pencil', { x: 52, y: 64 });
  },
};
