import { shade } from '../gfx';
import { bricks, figure, twinkle } from '../kit';
import type { Scene } from '../stage';
import { agingSky, asleep, dim, sway } from './common';

/**
 * Chiptune: a platform level. The hero jumps on the kick, the ? block
 * bounces on the snare, coins spin on the hats, a plant rises out of the
 * pipe with the bass, a bird sings the lead and a sparkle runs the arp.
 */
export const chiptune: Scene = {
  id: 'chiptune',
  name: 'Chiptune',
  cast: [
    { key: 'hero', want: ['kick', 'drums'] },
    { key: 'block', want: ['snare', 'perc'] },
    { key: 'coins', want: ['hats', 'perc'] },
    { key: 'plant', want: ['bass'] },
    { key: 'bird', want: ['lead', 'arp', 'tonal'] },
    { key: 'hills', want: ['pad', 'chords'] },
    { key: 'spark', want: ['arp', 'chords', 'lead'] },
  ],
  draw(s) {
    const { g, t } = s;
    agingSky(s.g, s.drift, [
      ['#5c94fc', '#6ca0fc', '#7cacfc', '#8cb8fc'],
      ['#f88838', '#f8a050', '#f8b868', '#f8d080'],
      ['#101040', '#182058', '#202870', '#283088'],
    ]);
    // Stars come out as the level ages.
    if (s.drift > 0.35)
      for (let i = 0; i < 18; i++)
        twinkle(g, (i * 37) % g.w, (i * 13) % 50, (t + i) % 3 > 2.6 ? 1 : 0);

    // Clouds drifting by with the beat.
    for (let i = 0; i < 3; i++) {
      const x = ((((i * 80 - s.beats * 3) % (g.w + 40)) + g.w + 40) % (g.w + 40)) - 20;
      const y = 14 + i * 9;
      g.circle(x, y, 6, '#ffffff', 3);
      g.circle(x + 7, y - 2, 6, '#ffffff', 4);
      g.circle(x + 14, y, 5, '#ffffff', 3);
    }

    // Hills breathe with the chords.
    const hills = s.actor('hills');
    const grow = Math.round(hills.hit * 3);
    g.circle(30, 92, 26, '#2c9c3c', 18 + grow);
    g.circle(140, 92, 34, '#38b048', 14 + grow);

    bricks(g, 92, '#c84c0c', '#000000', s.playing ? s.beats * 2 : 0);

    // The pipe and its plant.
    const plant = s.actor('plant');
    const rise = plant.on ? Math.round(4 + plant.hit * (8 + plant.pitch * 6)) : 0;
    if (rise > 0) {
      const py = 76 - rise;
      g.rect(156, py + 4, 2, rise, '#28a028');
      g.circle(157, py + 2, 4, plant.muted ? '#606060' : '#e02020', 3);
      g.px(155, py, '#ffffff');
      g.px(159, py + 1, '#ffffff');
      if (plant.hit > 0.5) g.rect(155, py + 3, 5, 1, '#000');
      s.place('plant', { x: 157, y: py - 3 });
    }
    g.rect(148, 76, 18, 16, '#20a020');
    g.rect(146, 74, 22, 5, '#30c030');
    g.rect(148, 76, 3, 16, '#60e060');

    // The ? block, the coins above.
    const block = s.actor('block');
    const by = 44 - Math.round(block.hit * 4);
    g.rect(88, by, 12, 12, block.on || !s.playing ? '#f8b800' : '#a07020');
    g.rect(88, by, 12, 1, '#000');
    g.rect(88, by + 11, 12, 1, '#000');
    g.text('?', 93, by + 3, block.hit > 0.5 ? '#ffffff' : '#c86000');
    if (block.fresh) s.float({ x: 93, y: by - 4, color: '#f8d030', kind: 'spark' });
    s.place('block', { x: 94, y: by - 2 });

    const coins = s.actor('coins');
    for (let i = 0; i < 4; i++) {
      const cx = 118 + i * 12;
      const lit = coins.on && coins.count % 4 === i && coins.hit > 0.3;
      const w = Math.max(1, Math.round(Math.abs(Math.cos(t * 5 + i)) * 3));
      const y = 34 - (lit ? Math.round(coins.hit * 5) : 0);
      g.rect(
        cx - w + 1,
        y,
        w * 2,
        7,
        coins.on || !s.playing ? (lit ? '#ffffff' : '#f8d030') : '#806020',
      );
      if (lit && coins.fresh)
        s.float({ x: cx, y: y - 2, color: '#fff080', kind: 'spark', life: 0.6 });
    }
    s.place('coins', { x: 136, y: 30 });

    // The sparkle runs round the block.
    const spark = s.actor('spark');
    if (spark.on) {
      const a = spark.count * 0.9;
      twinkle(
        g,
        94 + Math.round(Math.cos(a) * 14),
        50 + Math.round(Math.sin(a) * 10),
        spark.hit,
        '#ffffa0',
      );
    }

    // The bird sings the lead.
    const bird = s.actor('bird');
    if (bird.on || !s.playing) {
      const bx = Math.round(20 + bird.pitch * 140);
      const bY = 22 + sway(t, 1, 2);
      const flap = Math.floor(t * 8) % 2 === 0;
      g.rect(bx, bY, 6, 4, bird.muted ? '#808080' : '#f8f8f8');
      g.rect(bx + 5, bY + 1, 2, 1, '#f8a000');
      g.px(bx + 4, bY + 1, '#000');
      g.rect(bx + 1, bY + (flap ? -2 : 3), 3, 2, '#d0d0d0');
      if (bird.fresh)
        s.float({ x: bx + 6, y: bY - 2, color: shade('#f8f8f8', -0.1), kind: 'note' });
      s.place('bird', { x: bx + 3, y: bY - 3 });
    }

    // The hero.
    const hero = s.actor('hero');
    const jump = Math.round(
      16 * Math.sin(Math.PI * Math.min(1, (1 - hero.hit) * 1.15)) * (hero.hit > 0.05 ? 1 : 0),
    );
    const look = dim(
      {
        skin: '#f8b878',
        hair: '#6a3a10',
        shirt: '#e03028',
        pants: '#2038c8',
        hat: 'cap',
        hatColor: '#e03028',
        shoes: '#6a3a10',
      },
      hero,
      s.playing,
    );
    const at = figure(g, 50, 92, look, {
      bob: jump + (s.playing ? 0 : Math.abs(sway(t, 0, 1))),
      armR: jump > 4 ? [2, -5] : [2, 5],
      armL: [-2, 5],
      stride: s.playing && hero.on ? Math.sin(s.beats * Math.PI) : 0,
      eyesClosed: asleep(hero, s.playing),
    });
    s.place('hero', at);
  },
};
