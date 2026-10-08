/**
 * Pixel drawing on the stage's small canvas: whole-pixel rectangles, lines,
 * circles, a 3×5 bitmap font and a few colour helpers. Everything lands on
 * integer coordinates, so scaled up it stays crisp.
 */
export class Gfx {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly w: number,
    readonly h: number,
  ) {}

  rect(x: number, y: number, w: number, h: number, color: string): void {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  px(x: number, y: number, color: string): void {
    this.rect(x, y, 1, 1, color);
  }

  /** A line of square pixels (Bresenham), `size` pixels thick. */
  line(x0: number, y0: number, x1: number, y1: number, color: string, size = 1): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xe = Math.round(x1);
    const ye = Math.round(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    this.ctx.fillStyle = color;
    for (let guard = 0; guard < 512; guard++) {
      this.ctx.fillRect(x, y, size, size);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** A filled circle (or ellipse with `ry`). */
  circle(cx: number, cy: number, r: number, color: string, ry = r): void {
    if (r <= 0 || ry <= 0) return;
    this.ctx.fillStyle = color;
    const rr = Math.round(ry);
    for (let dy = -rr; dy <= rr; dy++) {
      const half = Math.round(r * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)));
      this.ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
    }
  }

  /** An ellipse outline. */
  ring(cx: number, cy: number, rx: number, ry: number, color: string): void {
    const steps = Math.max(12, Math.round((rx + ry) * 3));
    this.ctx.fillStyle = color;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      this.ctx.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
    }
  }

  /** Bands of colour from `top` to `bottom`, like a console's sky. */
  bands(y: number, h: number, colors: readonly string[]): void {
    const n = colors.length;
    for (let i = 0; i < n; i++) {
      const y0 = y + Math.round((i * h) / n);
      const y1 = y + Math.round(((i + 1) * h) / n);
      this.rect(0, y0, this.w, y1 - y0, colors[i] as string);
    }
  }

  /** Text in the 3×5 font, `scale` pixels per dot; returns the width drawn. */
  text(str: string, x: number, y: number, color: string, scale = 1, shadow?: string): number {
    if (shadow) this.text(str, x + scale, y + scale, shadow, scale);
    let cx = Math.round(x);
    this.ctx.fillStyle = color;
    for (const ch of str.toUpperCase()) {
      const glyph = FONT[ch] ?? FONT['?'];
      const rows = glyph as readonly string[];
      const gw = rows[0]?.length ?? 3;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r] as string;
        for (let c = 0; c < row.length; c++) {
          if (row[c] === '#')
            this.ctx.fillRect(cx + c * scale, Math.round(y) + r * scale, scale, scale);
        }
      }
      cx += (gw + 1) * scale;
    }
    return cx - Math.round(x);
  }

  textWidth(str: string, scale = 1): number {
    let w = 0;
    for (const ch of str.toUpperCase()) w += ((FONT[ch] ?? FONT['?'])?.[0]?.length ?? 3) + 1;
    return Math.max(0, w - 1) * scale;
  }
}

/** A colour between `a` and `b` (both #rrggbb), `t` 0..1. */
export function mix(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const pa = parse(a);
  const pb = parse(b);
  const c = pa.map((v, i) => Math.round(v + ((pb[i] as number) - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A colour made lighter (f > 0) or darker (f < 0). */
export function shade(c: string, f: number): string {
  return f >= 0 ? mix(c, '#ffffff', f) : mix(c, '#000000', -f);
}

function parse(c: string): [number, number, number] {
  const h = c.startsWith('#') ? c.slice(1) : c;
  const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number];
}

/** A cheap repeatable noise in 0..1 for an integer. */
export function noise(n: number): number {
  let x = (Math.imul(n | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  x ^= x >>> 12;
  return (x >>> 0) / 4294967296;
}

/** The 3×5 font: capitals, digits and a little punctuation. */
const FONT: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  ' ': ['..', '..', '..', '..', '..'],
  '.': ['.', '.', '.', '.', '#'],
  ',': ['.', '.', '.', '#', '#'],
  ':': ['.', '#', '.', '#', '.'],
  '!': ['#', '#', '#', '.', '#'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
  '·': ['.', '.', '#', '.', '.'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '▶': ['#..', '##.', '###', '##.', '#..'],
  '♪': ['.##', '.#.', '.#.', '##.', '##.'],
  '★': ['.#.', '###', '.#.', '#.#', '...'],
  '×': ['...', '#.#', '.#.', '#.#', '...'],
  "'": ['#', '#', '.', '.', '.'],
  '’': ['#', '#', '.', '.', '.'],
};
