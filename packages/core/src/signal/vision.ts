export interface FrameStats {
  /** Mean brightness, 0..1. */
  luma: number;
  /** Dominant hue, 0..1 around the color wheel (0 red, 1/3 green, 2/3 blue). */
  hue: number;
  /** Mean saturation, 0..1. */
  saturation: number;
  /** Mean pixel change since the previous frame, 0..1, ignoring global exposure shifts. */
  motion: number;
}

/**
 * Summarizes small camera frames (RGBA bytes). Works on any frame source:
 * a phone camera through a canvas, or a Pi camera later. Feed it frames of
 * a constant size, e.g. 32×24.
 */
export class FrameAnalyzer {
  private prev: Float32Array | undefined;
  private prevMean = 0;
  private lastHue = 0;

  analyze(rgba: ArrayLike<number>, width: number, height: number): FrameStats {
    const n = width * height;
    const luma = new Float32Array(n);
    let lumaSum = 0;
    let satSum = 0;
    let hx = 0;
    let hy = 0;
    let hw = 0;
    for (let i = 0; i < n; i++) {
      const r = (rgba[i * 4] as number) / 255;
      const g = (rgba[i * 4 + 1] as number) / 255;
      const b = (rgba[i * 4 + 2] as number) / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luma[i] = l;
      lumaSum += l;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      const sat = max > 0 ? delta / max : 0;
      satSum += sat;
      if (delta > 1e-6) {
        let h: number;
        if (max === r) h = ((g - b) / delta + 6) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        const angle = (h / 6) * 2 * Math.PI;
        // Colorful, bright pixels count most toward the dominant hue.
        const w = sat * max;
        hx += Math.cos(angle) * w;
        hy += Math.sin(angle) * w;
        hw += w;
      }
    }
    const mean = n > 0 ? lumaSum / n : 0;

    let motion = 0;
    if (this.prev && this.prev.length === n) {
      let diff = 0;
      for (let i = 0; i < n; i++) {
        diff += Math.abs(luma[i] - mean - ((this.prev[i] as number) - this.prevMean));
      }
      motion = Math.min(1, diff / n);
    }
    this.prev = luma;
    this.prevMean = mean;

    if (hw > n * 0.01) {
      const angle = Math.atan2(hy, hx);
      this.lastHue = (angle / (2 * Math.PI) + 1) % 1;
    }
    return { luma: mean, hue: this.lastHue, saturation: n > 0 ? satSum / n : 0, motion };
  }
}
