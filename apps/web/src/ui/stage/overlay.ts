import type { EngineView } from '@sensinth/core';
import { noise, type Gfx } from './gfx';
import type { Placed } from './kit';
import type { SceneState } from './stage';

interface OverlayInput {
  g: Gfx;
  state: SceneState;
  /** The view while music plays, else undefined. */
  view: EngineView | undefined;
  dt: number;
  /** performance.now(), ms. */
  now: number;
  /** What makes this piece's picture its own. */
  seed: number;
  /** Where the figure the section puts forward stands. */
  featured: Placed | undefined;
  sensors: readonly { id: string; level: number; color: string }[];
}

type Weather = 'clear' | 'rain' | 'snow' | 'fireflies' | 'dust' | 'petals' | 'embers';
const WEATHERS: readonly Weather[] = [
  'clear',
  'dust',
  'rain',
  'fireflies',
  'snow',
  'petals',
  'embers',
  'dust',
];
/** A wash of colour over the whole picture: the hour this piece plays at. */
const HOURS: readonly (readonly [string, number])[] = [
  ['#000000', 0],
  ['#ff9040', 0.1],
  ['#2040a0', 0.14],
  ['#ff60a0', 0.07],
  ['#40c0a0', 0.07],
  ['#000000', 0],
];

interface Caption {
  text: string;
  color: string;
  age: number;
}

/** Seconds a section's name card and a sensor's caption stay up. */
const CARD_SECONDS = 2.6;
const CAPTION_SECONDS = 2.2;

/**
 * What every scene shares, drawn over it. Each piece has its own weather and
 * its own hour; the section's name comes up as it starts, with the sensor
 * that chose it; a light falls on whoever is put forward; a break cools the
 * picture and a solo darkens it around the soloist; what a sensor just did is
 * written out ("SHAKE > STUTTER"); every live sensor has a little meter along
 * the bottom; the piece opens through an iris and closes on "THE END".
 */
export class Overlay {
  private sectionKey = '';
  private card = 0;
  private cardTitle = '';
  private cardBy = '';
  private captions: Caption[] = [];
  private flashes = new Map<string, number>();
  private iris = 0;
  private pieceKey = -1;
  private ending = 0;
  private burst = 0;

  draw(o: OverlayInput): void {
    const { g, state, view, dt } = o;
    const form = view?.form;
    const t = state.t;
    this.weather(o);
    this.visitor(o);

    // The hour of the piece.
    const [hour, alpha] = HOURS[state.vary('hour', HOURS.length)] as readonly [string, number];
    if (alpha > 0) this.wash(g, hour, alpha);
    if (state.section === 'break') this.wash(g, '#102060', 0.2);

    // A light on whoever the section puts forward; a solo darkens the rest.
    if (o.featured && form && !form.ending) {
      this.spot(g, o.featured, state.section === 'solo' ? 0.34 : 0, t);
    }

    // A section starts: its name, and who chose it.
    const section = form?.sections[form.sections.length - 1];
    const key = form ? `${form.piece}:${form.sections.length}` : '';
    if (key !== this.sectionKey) {
      this.sectionKey = key;
      if (section && form) {
        this.card = CARD_SECONDS;
        this.cardTitle = section.label.toUpperCase();
        this.cardBy = section.chosenBy
          ? `${section.chosenBy.label} ${section.chosenBy.why}`.toUpperCase()
          : form.sections.length === 1
            ? `PIECE ${form.piece + 1}`
            : '';
        // The riff coming back is a little celebration.
        if (section.kind === 'riff' && form.sections.length > 2) this.burst = 1;
      }
    }
    if (form && form.piece !== this.pieceKey && form.sections.length === 1) {
      this.pieceKey = form.piece;
      this.iris = 1;
      this.ending = 0;
    }
    if (!form) this.pieceKey = -1;

    if (this.burst > 0) {
      for (let i = 0; i < 26; i++) {
        const n = i * 31 + 5;
        const x = noise(n) * g.w;
        const y = (1 - this.burst) * (40 + noise(n + 1) * 60) + noise(n + 2) * 10;
        g.px(
          x + Math.sin(t * 6 + i) * 2,
          y,
          ['#ffd040', '#ff6060', '#60d0ff', '#80f080'][i % 4] as string,
        );
      }
      this.burst = Math.max(0, this.burst - dt * 0.7);
    }

    // What the sensors just did.
    for (const n of view?.news ?? []) {
      this.flashes.set(n.channelId, 1);
      if (n.what === 'accent' || n.what === 'section') continue;
      const text = `${n.sensor} > ${n.text}`.toUpperCase();
      if (this.captions.some((c) => c.text === text && c.age < 0.5)) continue;
      this.captions.push({ text, color: n.what === 'scene' ? '#ffffff' : '#ffd060', age: 0 });
      if (this.captions.length > 2) this.captions.shift();
    }
    this.captions = this.captions.filter((c) => (c.age += dt) < CAPTION_SECONDS);
    this.captions.forEach((c, i) => {
      const fade = c.age > CAPTION_SECONDS - 0.4 && Math.floor(c.age * 16) % 2 === 0;
      if (fade) return;
      const text = fit(g, c.text, g.w - 8);
      const w = g.textWidth(text);
      const y = 12 + i * 8;
      g.rect((g.w - w) / 2 - 2, y - 1, w + 4, 7, '#000000');
      g.text(text, (g.w - w) / 2, y, c.color);
    });

    this.meters(o);

    if (this.card > 0 && this.cardTitle) {
      // The card slides up from the bottom edge, stays, and slides away.
      const k = Math.min(1, (CARD_SECONDS - this.card) * 5, this.card * 5);
      const h = this.cardBy ? 18 : 11;
      const y = g.h - Math.round(k * (h + 6));
      const title = fit(g, this.cardTitle, g.w - 12);
      g.rect(0, y, g.w, h, '#000000');
      g.rect(0, y, g.w, 1, '#ffb347');
      g.text(title, (g.w - g.textWidth(title)) / 2, y + 3, '#ffd060');
      if (this.cardBy) {
        const by = fit(g, `BY ${this.cardBy}`, g.w - 8);
        g.text(by, (g.w - g.textWidth(by)) / 2, y + 11, '#c0a070');
      }
      this.card = Math.max(0, this.card - dt);
    }

    // The piece opens through an iris.
    if (this.iris > 0) {
      const r = (1 - this.iris) * 120;
      for (let y = 0; y < g.h; y++) {
        const dy = y - g.h / 2;
        const half = r * r > dy * dy ? Math.sqrt(r * r - dy * dy) : 0;
        g.rect(0, y, g.w / 2 - half, 1, '#000000');
        g.rect(g.w / 2 + half, y, g.w / 2 - half + 1, 1, '#000000');
      }
      this.iris = Math.max(0, this.iris - dt * 0.9);
    }
    // And closes on its last chord.
    if (form?.ending) {
      this.ending = Math.min(1, this.ending + dt * 0.45);
      g.ctx.globalAlpha = this.ending * 0.8;
      g.rect(0, 0, g.w, g.h, '#000000');
      g.ctx.globalAlpha = 1;
      if (this.ending > 0.25) {
        const msg = 'THE END';
        const w = g.textWidth(msg, 2);
        g.text(msg, (g.w - w) / 2, 44, '#ffd060', 2, '#000000');
        const next = 'THE SENSORS WRITE THE NEXT ONE';
        g.text(next, (g.w - g.textWidth(next)) / 2, 60, '#c0a070');
      }
    } else if (this.ending > 0) {
      this.ending = 0;
    }
  }

  /** A translucent colour over everything. */
  private wash(g: Gfx, color: string, alpha: number): void {
    g.ctx.globalAlpha = alpha;
    g.rect(0, 0, g.w, g.h, color);
    g.ctx.globalAlpha = 1;
  }

  /** A cone of light from above onto a figure, an arrow over its head, and the rest dimmed by `dark`. */
  private spot(g: Gfx, at: Placed, dark: number, t: number): void {
    const top = 9;
    const foot = Math.min(g.h - 8, at.y + 26);
    if (dark > 0) {
      g.ctx.globalAlpha = dark;
      for (let y = 0; y < g.h; y++) {
        const k = Math.min(1, Math.max(0, (y - top) / Math.max(1, foot - top)));
        const half = y < top ? 0 : y > foot ? 0 : 4 + k * 13;
        if (half === 0) g.rect(0, y, g.w, 1, '#000010');
        else {
          g.rect(0, y, at.x - half, 1, '#000010');
          g.rect(at.x + half, y, g.w - at.x - half, 1, '#000010');
        }
      }
      g.ctx.globalAlpha = 1;
    }
    g.ctx.globalAlpha = 0.1;
    for (let y = top; y < foot; y++) {
      const half = 4 + ((y - top) / Math.max(1, foot - top)) * 13;
      g.rect(at.x - half, y, half * 2, 1, '#fff4c0');
    }
    g.ctx.globalAlpha = 1;
    // The arrow bobs over its head.
    const ay = at.y - 6 + Math.round(Math.sin(t * 5));
    g.rect(at.x - 2, ay - 2, 5, 1, '#ffd060');
    g.rect(at.x - 1, ay - 1, 3, 1, '#ffd060');
    g.px(at.x, ay, '#ffd060');
  }

  /** The weather of this piece: the same from its first bar to its last, busier when the music is. */
  private weather({ g, state }: OverlayInput): void {
    const kind = WEATHERS[state.vary('weather', WEATHERS.length)] as Weather;
    if (kind === 'clear') return;
    const t = state.t;
    const n = Math.round(10 + 26 * state.energy);
    for (let i = 0; i < n; i++) {
      const a = noise(i * 13 + 1);
      const b = noise(i * 13 + 2);
      const c = noise(i * 13 + 3);
      switch (kind) {
        case 'rain': {
          const y = (b * g.h + t * (70 + 40 * c)) % g.h;
          const x = (a * (g.w + 20) - y * 0.25 + g.w) % g.w;
          g.rect(x, y, 1, 3, 'rgba(170,200,255,0.45)');
          break;
        }
        case 'snow': {
          const y = (b * g.h + t * (7 + 9 * c)) % g.h;
          g.px(a * g.w + Math.sin(t + i) * 3, y, 'rgba(255,255,255,0.8)');
          break;
        }
        case 'fireflies': {
          if (i > n / 2) break;
          const on = Math.sin(t * (1 + c * 2) + i) > 0.2;
          if (on) {
            g.px(
              a * g.w + Math.sin(t * 0.7 + i) * 8,
              18 + b * 62 + Math.cos(t * 0.9 + i * 2) * 6,
              '#e8ff80',
            );
          }
          break;
        }
        case 'dust': {
          if (i > n / 2) break;
          const y = (b * g.h - t * (2 + 3 * c) + g.h * 8) % g.h;
          g.px(a * g.w + Math.sin(t * 0.5 + i) * 5, y, 'rgba(255,240,200,0.35)');
          break;
        }
        case 'petals': {
          if (i > n / 2) break;
          const y = (b * g.h + t * (9 + 8 * c)) % g.h;
          const x = (a * g.w + Math.sin(t * 1.3 + i) * 7 + t * 4) % g.w;
          g.rect(x, y, 2, 1, i % 2 ? '#ffb0c8' : '#ffd8e4');
          break;
        }
        case 'embers': {
          if (i > n / 2) break;
          const y = (g.h * 8 + b * g.h - t * (12 + 14 * c)) % g.h;
          g.px(a * g.w + Math.sin(t * 2 + i) * 3, y, y < 40 ? '#a04020' : '#ffa040');
          break;
        }
      }
    }
  }

  /**
   * Now and then something crosses the picture, another thing in each
   * piece: a paper plane, a balloon, a butterfly, a string of bubbles, a
   * comet. It comes more often when the music is busy.
   */
  private visitor({ g, state }: OverlayInput): void {
    const kind = state.vary('visitor', 6);
    if (kind === 5 || !state.playing) return;
    const period = 26 - 10 * state.energy;
    const k = (state.t % period) / 7;
    if (k > 1) return;
    const lap = Math.floor(state.t / period);
    const fromLeft = (lap + kind) % 2 === 0;
    const x = fromLeft ? -10 + k * (g.w + 20) : g.w + 10 - k * (g.w + 20);
    const y0 = 16 + noise(lap * 17 + kind) * 26;
    const f = fromLeft ? 1 : -1;
    switch (kind) {
      case 0: {
        // A paper plane, gliding in shallow dips.
        const y = y0 + Math.sin(k * 9) * 4;
        g.line(x - 4 * f, y - 1, x + 4 * f, y + 1, '#f0f0f0');
        g.line(x - 4 * f, y + 2, x + 4 * f, y + 1, '#c8c8d0');
        g.px(x - 3 * f, y + 3, '#a0a0a8');
        break;
      }
      case 1: {
        // A balloon, rising as it drifts.
        const y = y0 + 20 - k * 30;
        g.circle(x, y, 3, ['#ff5060', '#50a0ff', '#ffd040'][lap % 3] as string, 4);
        g.px(x - 1, y - 2, '#ffffff');
        g.line(x, y + 4, x + Math.sin(state.t * 3) * 2, y + 10, '#d0d0d0');
        break;
      }
      case 2: {
        // A butterfly, wings beating.
        const y = y0 + Math.sin(k * 20) * 6;
        const open = Math.floor(state.t * 10) % 2 === 0;
        g.px(x, y, '#302010');
        g.rect(x - (open ? 2 : 1), y - 1, open ? 2 : 1, 2, '#ffb040');
        g.rect(x + 1, y - 1, open ? 2 : 1, 2, '#ff8030');
        break;
      }
      case 3: {
        // Bubbles, wobbling upward.
        for (let i = 0; i < 4; i++) {
          const bx = x - i * 7 * f + Math.sin(state.t * 2 + i) * 2;
          const by = y0 + 10 - k * 18 + i * 4;
          g.ring(bx, by, 2, 2, 'rgba(200,240,255,0.8)');
          g.px(bx - 1, by - 1, '#ffffff');
        }
        break;
      }
      case 4: {
        // A comet, fast and high.
        const cx = fromLeft
          ? -10 + Math.min(1, k * 2.4) * (g.w + 40)
          : g.w + 10 - Math.min(1, k * 2.4) * (g.w + 40);
        const cy = 10 + k * 22;
        for (let i = 0; i < 9; i++) {
          g.px(
            cx - i * 2 * f,
            cy - i,
            i < 2 ? '#ffffff' : i < 5 ? '#ffe090' : 'rgba(255,200,120,0.4)',
          );
        }
        break;
      }
    }
  }

  /** A little meter per live sensor along the bottom edge; it flashes when the sensor does something. */
  private meters({ g, sensors, dt }: OverlayInput): void {
    const n = Math.min(sensors.length, 24);
    if (n === 0) return;
    const gap = 5;
    const x0 = Math.round((g.w - n * gap) / 2);
    for (let i = 0; i < n; i++) {
      const s = sensors[i] as (typeof sensors)[number];
      const flash = this.flashes.get(s.id) ?? 0;
      const h = 1 + Math.round(Math.min(1, Math.max(0, s.level)) * 6);
      const x = x0 + i * gap;
      g.rect(x, g.h - 8, 3, 8, 'rgba(0,0,0,0.55)');
      g.rect(x, g.h - h, 3, h, flash > 0.5 ? '#ffffff' : s.color);
      if (flash > 0) {
        g.px(x + 1, g.h - 10 - Math.round((1 - flash) * 5), '#ffffff');
        const left = flash - dt * 1.8;
        if (left > 0) this.flashes.set(s.id, left);
        else this.flashes.delete(s.id);
      }
    }
  }
}

/** A caption cut to fit a width, ending in ".." when it had to be. */
function fit(g: Gfx, text: string, width: number): string {
  if (g.textWidth(text) <= width) return text;
  let out = text;
  while (out.length > 3 && g.textWidth(`${out}..`) > width) out = out.slice(0, -1);
  return `${out.trimEnd()}..`;
}
