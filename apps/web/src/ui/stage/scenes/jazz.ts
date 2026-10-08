import { mix } from '../gfx';
import { cymbal, drum, figure, keys, sax } from '../kit';
import type { Scene } from '../stage';
import { asleep, dim, sway, tint } from './common';

/**
 * Jazz: a club stage. The drummer rides the cymbal and kicks the bass drum,
 * the upright bass is plucked with each note, the pianist comps the chords
 * and the sax takes the lead; the spotlights follow whoever plays.
 */
export const jazz: Scene = {
  id: 'jazz',
  name: 'Jazz',
  cast: [
    { key: 'ride', want: ['hats', 'perc', 'drums'] },
    { key: 'kick', want: ['kick', 'snare', 'drums'] },
    { key: 'bass', want: ['bass'] },
    { key: 'piano', want: ['chords', 'pad', 'arp'] },
    { key: 'sax', want: ['lead', 'arp', 'tonal'] },
  ],
  draw(s) {
    const { g, t } = s;
    // Curtains, getting deeper red as the night goes on.
    const red = mix('#701820', '#401030', s.drift);
    g.rect(0, 0, g.w, 80, red);
    for (let x = 0; x < g.w; x += 6) g.rect(x + 4, 0, 2, 80, mix(red, '#000000', 0.35));
    g.rect(0, 0, g.w, 6, '#e0b040');
    g.rect(0, 6, g.w, 2, '#a07020');
    // The stage.
    g.rect(0, 80, g.w, 28, '#3a2414');
    for (let x = 0; x < g.w; x += 16) g.rect(x, 80, 1, 28, '#2a180c');
    g.rect(0, 80, g.w, 1, '#6a4428');
    // Spotlights on whoever is playing.
    const spot = (x: number, on: number) => {
      if (on <= 0.02) return;
      g.ctx.globalAlpha = 0.12 + on * 0.18;
      for (let y = 8; y < 92; y++) {
        const half = 3 + ((y - 8) / 84) * 16;
        g.rect(x - half, y, half * 2, 1, '#fff4c0');
      }
      g.ctx.globalAlpha = 1;
    };
    const ride = s.actor('ride');
    const kick = s.actor('kick');
    const bass = s.actor('bass');
    const piano = s.actor('piano');
    const saxA = s.actor('sax');
    spot(36, Math.max(ride.hit, kick.hit) * 0.8);
    spot(78, bass.hit);
    spot(118, piano.hit);
    spot(160, saxA.hit);

    // The drummer.
    const drumsOn = ride.on || kick.on || !s.playing;
    const drummer = figure(
      g,
      36,
      86,
      dim(
        {
          skin: '#c08860',
          hair: '#101010',
          shirt: '#202028',
          pants: '#202028',
          hat: 'brim',
          hatColor: '#181818',
        },
        drumsOn ? { ...ride, on: true } : ride,
        s.playing,
      ),
      {
        sitting: true,
        armL: [-4, ride.hit > 0.4 ? -2 : 2],
        armR: [4, kick.hit > 0.4 ? 1 : 3],
        nod: kick.hit > 0.5 ? 1 : 0,
        eyesClosed: asleep(drumsOn ? { ...ride, on: true } : ride, s.playing),
      },
    );
    cymbal(g, 22, 66, 6, ride.hit);
    drum(g, 30, 78, 12, 8, tint('#a02020', kick, s.playing), kick.hit);
    drum(g, 44, 74, 7, 4, '#a02020', ride.hit * 0.5);
    s.place('ride', { x: 22, y: 60 });
    s.place('kick', drummer);

    // The upright bass.
    const bassist = figure(
      g,
      74,
      92,
      dim(
        { skin: '#7a4a2a', hair: '#202020', shirt: '#4a3a5a', pants: '#202028' },
        bass,
        s.playing,
      ),
      {
        armL: [5, 0],
        armR: [5, bass.hit > 0.3 ? 9 : 7],
        bob: bass.hit > 0.6 ? 1 : 0,
        eyesClosed: asleep(bass, s.playing),
      },
    );
    g.circle(84, 84, 4, '#8a4a1a', 6);
    g.rect(83, 58, 2, 24, '#5a2a0a');
    if (bass.hit > 0.3) g.rect(84 + (bass.count % 2), 64, 1, 20, '#fff0c0');
    s.place('bass', bassist);

    // The piano.
    g.rect(104, 74, 30, 12, '#101014');
    g.rect(104, 70, 30, 4, '#202024');
    keys(g, 106, 70, 9, piano.on ? piano.hit : 0);
    const pianist = figure(
      g,
      120,
      94,
      dim(
        { skin: '#e8c0a0', hair: '#c8c8c8', shirt: '#303860', pants: '#202028' },
        piano,
        s.playing,
      ),
      {
        sitting: true,
        armL: [-4, piano.hit > 0.3 ? -4 : -2],
        armR: [4, piano.hit > 0.3 ? -4 : -2],
        nod: piano.hit > 0.5 ? 1 : 0,
        eyesClosed: asleep(piano, s.playing),
      },
    );
    s.place('piano', pianist);

    // The sax.
    const player = figure(
      g,
      160,
      92,
      dim(
        { skin: '#d89a68', hair: '#301810', shirt: '#802830', pants: '#202028', shades: true },
        saxA,
        s.playing,
      ),
      {
        armL: [3, 4],
        armR: [2, 7],
        bob: saxA.hit > 0.5 ? 1 : sway(t, 2, 0),
        nod: saxA.hit > 0.4 ? -1 : 0,
        mouth: saxA.hit > 0.2,
        flip: true,
        eyesClosed: asleep(saxA, s.playing),
      },
    );
    sax(g, 156, player.y + 9, saxA.hit * 2);
    if (saxA.fresh)
      s.float({
        x: 152,
        y: player.y + 6 - Math.round(saxA.pitch * 10),
        color: '#f0e0a0',
        kind: 'note',
      });
    s.place('sax', player);
  },
};
