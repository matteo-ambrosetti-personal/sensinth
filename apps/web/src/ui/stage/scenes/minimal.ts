import { mix } from '../gfx';
import { figure } from '../kit';
import type { ActorState, Scene } from '../stage';
import { agingSky, asleep, dim } from './common';

const LOOKS = [
  { skin: '#f0c8a0', hair: '#303030', shirt: '#202020', pants: '#202020' },
  { skin: '#c89070', hair: '#5a3a1a', shirt: '#303040', pants: '#202020' },
  { skin: '#e0b088', hair: '#c0a060', shirt: '#282828', pants: '#202020' },
  { skin: '#a87050', hair: '#101010', shirt: '#343434', pants: '#202020' },
  { skin: '#f8d8b8', hair: '#802010', shirt: '#2a2a2a', pants: '#202020' },
];

/** The phase dials hang above the players, clear of the title. */
const DIAL_Y = 46;

/**
 * Minimal: a row of players behind their marimbas, each with a dial that
 * goes round once per loop of its track. Tracks at slightly different
 * speeds drift apart and back together: you can watch the phasing.
 */
export const minimal: Scene = {
  id: 'minimal',
  name: 'Minimal',
  cast: [0, 1, 2, 3, 4].map((i) => ({ key: `p${i}`, want: ['any'] as const })),
  draw(s) {
    const { g } = s;
    agingSky(
      g,
      s.drift,
      [
        ['#e8e4d8', '#e0dccc', '#d8d4c0'],
        ['#d8d0c0', '#ccc4b0', '#c0b8a0'],
        ['#282830', '#24242c', '#202028'],
      ],
      0,
      76,
    );
    g.rect(0, 76, g.w, 32, mix('#a89878', '#30302c', Math.min(1, s.drift * 1.6)));
    g.rect(0, 76, g.w, 1, '#6a5a40');
    const players = [0, 1, 2, 3, 4].map((i) => [i, s.actor(`p${i}`)] as [number, ActorState]);
    const shown = s.playing ? players.filter(([, a]) => a.on) : players.slice(0, 3);
    const n = Math.max(1, shown.length);
    shown.forEach(([i, a], k) => {
      const x = Math.round(((k + 0.5) / n) * g.w);
      // The phase dial: once round per loop of the track.
      const ink = '#404048';
      g.ring(x, DIAL_Y, 7, 7, ink);
      const ang = a.pos * Math.PI * 2 - Math.PI / 2;
      g.line(
        x,
        DIAL_Y,
        x + Math.round(Math.cos(ang) * 6),
        DIAL_Y + Math.round(Math.sin(ang) * 6),
        a.hit > 0.4 ? '#e03030' : ink,
      );
      // The player, the mallets, the marimba.
      const look = dim(LOOKS[i % LOOKS.length] as (typeof LOOKS)[number], a, s.playing);
      const down = a.hit > 0.4;
      const hand: 1 | -1 = a.count % 2 === 0 ? 1 : -1;
      const at = figure(g, x, 80, look, {
        armL: [-3, down && hand < 0 ? 7 : 4],
        armR: [3, down && hand > 0 ? 7 : 4],
        nod: a.hit > 0.6 ? 1 : 0,
        eyesClosed: asleep(a, s.playing),
      });
      g.rect(x - 12, 76, 24, 3, '#6a3a1a');
      for (let b = 0; b < 8; b++) {
        const lit = down && b === Math.round(a.pitch * 7);
        g.rect(x - 12 + b * 3, 75, 2, 2, lit ? '#ffe080' : mix('#a05a2a', '#c87a3a', b / 8));
      }
      g.rect(x - 11, 79, 1, 8, '#3a2a1a');
      g.rect(x + 10, 79, 1, 8, '#3a2a1a');
      if (a.fresh) s.float({ x: x + hand * 6, y: 70, color: '#404048', kind: 'spark', life: 0.5 });
      s.place(`p${i}`, at);
    });
  },
};
