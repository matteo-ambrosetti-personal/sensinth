import { onePoleAlpha } from '../math';

/** One-pole low-pass (exponential moving average) that accepts irregular time steps. */
export class Ema {
  private y: number | undefined;

  constructor(public tau: number) {}

  update(x: number, dt: number): number {
    if (this.y === undefined) this.y = x;
    else this.y += (x - this.y) * onePoleAlpha(dt, this.tau);
    return this.y;
  }

  get value(): number | undefined {
    return this.y;
  }

  reset(): void {
    this.y = undefined;
  }
}
