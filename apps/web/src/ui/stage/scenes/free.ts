import { mix, noise } from '../gfx';
import { drum, figure, keys, type Pose } from '../kit';
import type { ActorState, Scene } from '../stage';
import { sway } from './common';

const COLORS = ['#c04040', '#4070d0', '#40a050', '#d0a030', '#9050c0', '#30a0b0'];

/**
 * Free: a band of robots in a lab, one robot per track, whatever it plays:
 * a drum pad for the drums, keys for chords and arps, a wave on a screen
 * for pads, a bass, a microphone for the lead. Each robot's antenna blinks
 * with its notes.
 */
export const free: Scene = {
  id: 'free',
  name: 'Free',
  cast: [0, 1, 2, 3, 4, 5].map((i) => ({ key: `r${i}`, want: ['any'] as const })),
  draw(s) {
    const { g, t } = s;
    // The lab: tiled wall, monitors, a bench.
    const wall = mix('#1a2a3a', '#2a1a3a', Math.min(1, s.drift * 1.6));
    g.rect(0, 0, g.w, 108, wall);
    for (let y = 0; y < 76; y += 8) g.rect(0, y, g.w, 1, mix(wall, '#000000', 0.3));
    for (let x = 0; x < g.w; x += 8) g.rect(x, 0, 1, 76, mix(wall, '#000000', 0.3));
    for (let i = 0; i < 4; i++) {
      const x = 12 + i * 46;
      g.rect(x, 12, 28, 18, '#101418');
      g.rect(x + 2, 14, 24, 14, '#0a2018');
      for (let k = 0; k < 24; k += 2) {
        const v = Math.sin(k / 3 + t * (2 + i) + i) * 4 * (0.4 + s.energy);
        g.px(x + 2 + k, 21 + Math.round(v), '#40f080');
      }
      g.rect(x + 12, 30, 4, 4, '#202428');
    }
    g.rect(0, 76, g.w, 32, '#2a2a30');
    g.rect(0, 76, g.w, 2, '#4a4a54');
    for (let i = 0; i < 10; i++)
      g.px(Math.floor(noise(i + 3) * g.w), 80 + Math.floor(noise(i + 4) * 24), '#3a3a44');

    const robots = [0, 1, 2, 3, 4, 5].map((i) => [i, s.actor(`r${i}`)] as [number, ActorState]);
    const shown = s.playing ? robots.filter(([, a]) => a.on) : robots.slice(0, 4);
    const n = Math.max(1, shown.length);
    shown.forEach(([i, a], k) => {
      const x = Math.round(((k + 0.5) / n) * g.w);
      const color = COLORS[i % COLORS.length] as string;
      const look = {
        skin: '#c0c0c8',
        hair: '#c0c0c8',
        shirt: a.muted ? '#505058' : color,
        pants: '#606068',
        robot: true,
      };
      const hitArm = a.hit > 0.4;
      let pose: Pose;
      switch (a.role) {
        case 'drum':
          drum(g, x - 6, 74, 12, 6, '#606070', a.hit);
          pose = {
            armL: [-2, hitArm && a.count % 2 ? 6 : 3],
            armR: [2, hitArm && a.count % 2 === 0 ? 6 : 3],
          };
          break;
        case 'chords':
        case 'arp':
          keys(g, x - 8, 72, 6, a.hit);
          pose = { armL: [-2, hitArm ? 7 : 5], armR: [2, hitArm ? 7 : 5] };
          break;
        case 'pad':
        case 'drone': {
          g.rect(x + 6, 62, 12, 10, '#101418');
          for (let k = 0; k < 10; k++) {
            g.px(
              x + 7 + k,
              67 + Math.round(Math.sin(k / 2 + t * 3) * 3 * (0.3 + a.hit)),
              '#60f0ff',
            );
          }
          pose = { armR: [6, 1] };
          break;
        }
        case 'bass':
          g.line(x - 4, 74, x + 8, 64, '#80502a', 2);
          if (hitArm) g.line(x - 3, 73, x + 7, 64, '#ffe0a0');
          pose = { armL: [4, 2], armR: [2, hitArm ? 6 : 4] };
          break;
        default:
          g.line(x - 5, 80, x - 5, 66, '#808088');
          g.rect(x - 6, 64, 3, 3, '#303034');
          pose = { armL: [-1, -2], armR: [2, 5] };
      }
      const at = figure(g, x, 92, look, {
        ...pose,
        bob: (a.hit > 0.6 ? 1 : 0) + (s.playing ? 0 : sway(t, i, 1)),
        light: a.hit,
        lightColor: color,
        eyesClosed: s.playing && a.muted,
      });
      if (a.fresh && a.role !== 'drum') s.float({ x: at.x + 4, y: at.y, color, kind: 'note' });
      s.place(`r${i}`, at);
    });
  },
};
