/**
 * Oscilloscope of the live output. At rest it shows the grid and a flat
 * trace, so the panel is never empty.
 */
export class Scope {
  private readonly ctx: CanvasRenderingContext2D;
  private data = new Float32Array(new ArrayBuffer(2048 * 4));
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      this.width = Math.max(1, Math.round(rect.width * dpr));
      this.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = this.width;
      canvas.height = this.height;
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
  }

  draw(analyser: AnalyserNode | undefined): void {
    const { ctx, width: w, height: h } = this;
    const css = getComputedStyle(this.canvas);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = css.getPropertyValue('--scope-grid').trim() || 'rgba(128,128,128,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const cell = h / 6;
    for (let x = cell; x < w; x += cell) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = cell; y < h; y += cell) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#3fd0b8';
    ctx.lineWidth = Math.max(1.5, h / 90);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (!analyser) {
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
    } else {
      if (this.data.length !== analyser.fftSize) {
        this.data = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      }
      analyser.getFloatTimeDomainData(this.data);
      // Start at a rising zero crossing so the trace stands still.
      let start = 0;
      for (let i = 1; i < this.data.length / 2; i++) {
        if ((this.data[i - 1] as number) < 0 && (this.data[i] as number) >= 0) {
          start = i;
          break;
        }
      }
      const n = this.data.length / 2;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = h / 2 - (this.data[start + i] as number) * h * 0.42;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}
