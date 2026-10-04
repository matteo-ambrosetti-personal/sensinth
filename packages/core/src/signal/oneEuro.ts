/**
 * One Euro filter (Casiez et al., 2012): smooths jitter strongly when the
 * signal is still and follows quickly when it moves. Units of `beta` match the
 * input, so we run it on normalized 0..1 values.
 */
export class OneEuroFilter {
  private x: number | undefined;
  private dx = 0;

  constructor(
    public minCutoff = 1,
    public beta = 1,
    public dCutoff = 1,
  ) {}

  update(value: number, dt: number): number {
    if (this.x === undefined || dt <= 0) {
      this.x ??= value;
      return this.x;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += (rawDx - this.dx) * alpha(dt, this.dCutoff);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (value - this.x) * alpha(dt, cutoff);
    return this.x;
  }

  reset(): void {
    this.x = undefined;
    this.dx = 0;
  }
}

function alpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
