import { type Gfx, shade } from './gfx';

/** What a figure looks like. */
export interface Look {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes?: string;
  /** A cap, a beanie, a hat with a brim, a crown of antennas (robots), or nothing. */
  hat?: 'cap' | 'beanie' | 'brim' | 'antenna';
  hatColor?: string;
  /** A boxy robot head and body instead of a person. */
  robot?: boolean;
  /** Sunglasses. */
  shades?: boolean;
}

/** How a figure stands this frame. Arm ends are relative to the shoulders. */
export interface Pose {
  /** Pixels up (a hop, a nod). */
  bob?: number;
  /** Head down by this many pixels (a nod). */
  nod?: number;
  armL?: [number, number];
  armR?: [number, number];
  /** 0 standing, 1 one leg forward, −1 the other: a stride. */
  stride?: number;
  /** Sitting on something: legs bent forward. */
  sitting?: boolean;
  /** Mouth open (singing, blowing). */
  mouth?: boolean;
  eyesClosed?: boolean;
  /** Mirror it: facing left. */
  flip?: boolean;
  /** The robot's antenna light, 0..1. */
  light?: number;
  lightColor?: string;
}

/** Where a figure's head is, for a "!" or a "z" above it. */
export interface Placed {
  x: number;
  y: number;
}

/**
 * A little figure about 16 pixels tall, its feet at (x, y): legs, body,
 * arms reaching for the hands' positions, a head with hair and eyes.
 */
export function figure(g: Gfx, x: number, y: number, look: Look, pose: Pose = {}): Placed {
  const bob = Math.round(pose.bob ?? 0);
  const f = pose.flip ? -1 : 1;
  const ox = Math.round(x);
  const base = Math.round(y) - bob;
  const shoes = look.shoes ?? '#202020';
  // Legs.
  if (pose.sitting) {
    g.rect(ox - 3, base - 5, 6, 2, look.pants);
    g.rect(ox - 3 + (f > 0 ? 4 : -2), base - 4, 2, 4, look.pants);
    g.rect(ox - 3 + (f > 0 ? 0 : 2), base - 4, 2, 4, look.pants);
    g.rect(ox - 3 + (f > 0 ? 4 : -3), base - 1, 3, 1, shoes);
  } else {
    const s = Math.round((pose.stride ?? 0) * 2);
    g.rect(ox - 3 + s, base - 5, 2, 5, look.pants);
    g.rect(ox + 1 - s, base - 5, 2, 5, look.pants);
    g.rect(ox - 4 + s, base - 1, 3, 1, shoes);
    g.rect(ox + 1 - s, base - 1, 3, 1, shoes);
  }
  // Body.
  const top = base - 11;
  if (look.robot) {
    g.rect(ox - 4, top, 8, 6, look.shirt);
    g.rect(ox - 2, top + 2, 4, 2, shade(look.shirt, -0.35));
    g.px(ox - 1, top + 2, '#40f070');
  } else {
    g.rect(ox - 3, top, 6, 6, look.shirt);
    g.rect(ox - 3, top + 5, 6, 1, shade(look.shirt, -0.3));
  }
  // Arms: from the shoulders to the hands.
  const armColor = look.robot ? shade(look.shirt, -0.2) : look.shirt;
  const hand = look.robot ? shade(look.shirt, 0.3) : look.skin;
  const [lx, ly] = pose.armL ?? [-2, 5];
  const [rx, ry] = pose.armR ?? [2, 5];
  const shoulderL = ox - 3 * f - (f > 0 ? 1 : 0);
  const shoulderR = ox + 3 * f - (f > 0 ? 0 : 1);
  g.line(shoulderL, top + 1, shoulderL + lx * f, top + 1 + ly, armColor);
  g.px(shoulderL + lx * f, top + 1 + ly, hand);
  g.line(shoulderR, top + 1, shoulderR + rx * f, top + 1 + ry, armColor);
  g.px(shoulderR + rx * f, top + 1 + ry, hand);
  // Head.
  const nod = Math.round(pose.nod ?? 0);
  const hy = top - 6 + nod;
  if (look.robot) {
    g.rect(ox - 3, hy, 7, 6, shade(look.shirt, 0.15));
    g.rect(ox - 2, hy + 2, 5, 2, '#101018');
    g.px(ox - 1 + (f > 0 ? 1 : 0), hy + 2, pose.eyesClosed ? '#101018' : '#60f0ff');
    g.px(ox + 1 + (f > 0 ? 1 : 0), hy + 2, pose.eyesClosed ? '#101018' : '#60f0ff');
    g.line(ox, hy - 1, ox, hy - 3, '#c0c0c8');
    g.px(ox, hy - 4, (pose.light ?? 0) > 0.3 ? (pose.lightColor ?? '#ff4040') : '#602020');
    return { x: ox, y: hy - 5 };
  }
  g.rect(ox - 3, hy, 6, 6, look.skin);
  // Hair or hat.
  g.rect(ox - 3, hy, 6, 2, look.hair);
  g.px(ox - 3 * f + (f > 0 ? 0 : -1), hy + 2, look.hair);
  if (look.hat === 'cap') {
    g.rect(ox - 3, hy - 1, 6, 2, look.hatColor ?? '#e03030');
    g.rect(ox + (f > 0 ? 2 : -5), hy + 1, 3, 1, look.hatColor ?? '#e03030');
  } else if (look.hat === 'beanie') {
    g.rect(ox - 3, hy - 2, 6, 3, look.hatColor ?? '#3050e0');
    g.px(ox, hy - 3, shade(look.hatColor ?? '#3050e0', 0.3));
  } else if (look.hat === 'brim') {
    g.rect(ox - 2, hy - 3, 4, 3, look.hatColor ?? '#303030');
    g.rect(ox - 4, hy - 1, 8, 1, look.hatColor ?? '#303030');
  }
  // Face.
  const ex = ox + (f > 0 ? 0 : -1);
  if (look.shades) {
    g.rect(ex - 2, hy + 3, 5, 1, '#000');
  } else if (pose.eyesClosed) {
    g.px(ex - 1, hy + 3, shade(look.skin, -0.45));
    g.px(ex + 2, hy + 3, shade(look.skin, -0.45));
  } else {
    g.px(ex - 1, hy + 3, '#000');
    g.px(ex + 2, hy + 3, '#000');
  }
  if (pose.mouth) g.px(ex + 1, hy + 5, '#601010');
  return { x: ox, y: hy - 3 };
}

/** A drum: a shell with a lighter head, struck brighter. */
export function drum(g: Gfx, x: number, y: number, w: number, h: number, color: string, hit = 0) {
  g.rect(x, y, w, h, shade(color, -0.2));
  g.rect(x, y, w, 2, shade('#f0f0e8', -0.1 + hit * 0.1));
  g.rect(x, y + h - 1, w, 1, shade(color, -0.5));
  if (hit > 0.3) g.rect(x + 1, y - 1, w - 2, 1, '#ffffff');
}

/** A cymbal on a stand, tilting when hit. */
export function cymbal(g: Gfx, x: number, y: number, r: number, hit = 0) {
  const tilt = Math.round(hit * 2);
  g.line(x - r, y + tilt, x + r, y - tilt, hit > 0.4 ? '#fff6a0' : '#d8b840');
  g.line(x, y, x, y + 14, '#808088');
}

/** A keyboard: white keys, black keys, pressed keys lit. */
export function keys(g: Gfx, x: number, y: number, n: number, lit: number, color = '#202028') {
  g.rect(x - 1, y - 1, n * 3 + 2, 6, color);
  for (let i = 0; i < n; i++) {
    const on = lit > 0 && (i * 7 + Math.floor(lit * 20)) % 5 === 0;
    g.rect(x + i * 3, y, 2, 4, on ? '#ffe060' : '#f0f0f0');
    if (i % 7 !== 2 && i % 7 !== 6 && i < n - 1) g.rect(x + i * 3 + 2, y, 1, 2, '#000');
  }
}

/** A speaker box whose cone pumps with `pump`. */
export function speaker(g: Gfx, x: number, y: number, w: number, h: number, pump = 0) {
  g.rect(x, y, w, h, '#18181c');
  g.rect(x, y, w, 1, '#30303a');
  const r = Math.max(2, Math.floor(Math.min(w, h / 2) / 2) - 1);
  for (const cy of [y + Math.round(h * 0.3), y + Math.round(h * 0.72)]) {
    g.circle(x + w / 2, cy, r + Math.round(pump * 1.5), '#404048');
    g.circle(x + w / 2, cy, Math.max(1, r - 2), pump > 0.4 ? '#9090a0' : '#606068');
  }
}

/** A guitar held across the body; the strings shine when strummed. */
export function guitar(g: Gfx, x: number, y: number, color: string, strum = 0, flip = false) {
  const f = flip ? -1 : 1;
  g.circle(x, y, 3, color, 2);
  g.circle(x + 3 * f, y - 1, 2, color, 2);
  g.line(x + 4 * f, y - 2, x + 11 * f, y - 6, '#5a3a1a', 1);
  g.px(x, y, '#000');
  if (strum > 0.3) g.line(x - 2 * f, y + 1, x + 6 * f, y - 3, '#fff6c0');
}

/** A saxophone, bell up, held at the mouth. */
export function sax(g: Gfx, x: number, y: number, blow = 0) {
  g.line(x, y, x, y + 7, '#e0b030');
  g.line(x, y + 7, x + 3, y + 7, '#e0b030');
  g.line(x + 3, y + 7, x + 4, y + 4 - Math.round(blow), '#e0b030', 2);
}

/** An eighth note, for melodies floating up. */
export function note(g: Gfx, x: number, y: number, color: string) {
  g.rect(x, y + 3, 2, 2, color);
  g.rect(x + 1, y, 1, 4, color);
  g.px(x + 2, y, color);
  g.px(x + 3, y + 1, color);
}

/** A twinkling star: a dot, or a cross when bright. */
export function twinkle(g: Gfx, x: number, y: number, bright: number, color = '#ffffff') {
  g.px(x, y, color);
  if (bright > 0.5) {
    g.px(x - 1, y, color);
    g.px(x + 1, y, color);
    g.px(x, y - 1, color);
    g.px(x, y + 1, color);
  }
}

/** A floor of pixel bricks from `y` down. */
export function bricks(g: Gfx, y: number, color: string, mortar: string, scroll = 0) {
  g.rect(0, y, g.w, g.h - y, color);
  for (let row = 0; y + row * 5 < g.h; row++) {
    const yy = y + row * 5;
    g.rect(0, yy, g.w, 1, mortar);
    const off = (row % 2) * 4 - (Math.floor(scroll) % 8);
    for (let x = off; x < g.w; x += 8) g.rect(x, yy, 1, 5, mortar);
  }
}

/** Floating text that rises and fades, for melodies and "z"s. */
export interface Floater {
  x: number;
  y: number;
  age: number;
  life: number;
  color: string;
  kind: 'note' | 'z' | 'spark';
}

export function drawFloaters(g: Gfx, list: Floater[], dt: number): Floater[] {
  const out: Floater[] = [];
  for (const f of list) {
    f.age += dt;
    if (f.age >= f.life) continue;
    const k = f.age / f.life;
    const y = f.y - k * 14;
    const x = f.x + Math.sin(f.age * 6) * 1.5;
    if (k > 0.75 && Math.floor(f.age * 20) % 2 === 0) {
      out.push(f);
      continue;
    }
    if (f.kind === 'note') note(g, x, y, f.color);
    else if (f.kind === 'z') g.text('Z', x, y, f.color);
    else twinkle(g, x, y, 1 - k, f.color);
    out.push(f);
  }
  return out;
}
