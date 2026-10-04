/** Rolling median over the last `size` samples: removes single-sample spikes. */
export class MedianFilter {
  private buf: number[] = [];

  constructor(public readonly size = 5) {}

  update(x: number): number {
    this.buf.push(x);
    if (this.buf.length > this.size) this.buf.shift();
    const sorted = [...this.buf].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  }

  reset(): void {
    this.buf = [];
  }
}
