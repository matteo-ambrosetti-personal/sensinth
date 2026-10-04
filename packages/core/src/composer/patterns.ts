export interface PatternHit {
  /** Step within the pattern. */
  step: number;
  /** Length in steps, including `-` holds. */
  dur: number;
  char: string;
}

/**
 * Parses a step pattern. Any character other than `.` and `-` starts a hit;
 * following `-` characters extend it.
 */
export function parsePattern(pattern: string): (PatternHit | undefined)[] {
  const out: (PatternHit | undefined)[] = new Array(pattern.length).fill(undefined);
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '.' || c === '-') continue;
    let dur = 1;
    while (pattern[i + dur] === '-') dur++;
    out[i] = { step: i, dur, char: c };
  }
  return out;
}

/** `X` accent, `o` ghost, anything else a normal hit. */
export function velocityOf(char: string): number {
  if (char === 'X') return 1;
  if (char === 'o') return 0.4;
  return 0.75;
}

/**
 * Picks one of `n` levels from a 0..1 value, with hysteresis so the choice
 * does not flicker when the value hovers near a boundary.
 */
export class LevelSelector {
  private current: number | undefined;

  constructor(
    private readonly levels: number,
    private readonly hysteresis = 0.2,
  ) {}

  select(x: number): number {
    const n = this.levels;
    if (n <= 1) return 0;
    const target = Math.min(Math.max(x, 0), 1) * (n - 1);
    if (this.current === undefined || Math.abs(target - this.current) > 0.5 + this.hysteresis) {
      this.current = Math.min(n - 1, Math.max(0, Math.round(target)));
    }
    return this.current;
  }
}
