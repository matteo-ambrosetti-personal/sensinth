const HARMONICS = 64;

/**
 * Band-limited pulse waves (Fourier series), cached per context and duty
 * cycle. Duty 0.5 is a square; 0.125 and 0.25 are the thin NES timbres.
 */
export class WaveTable {
  private readonly cache = new Map<number, PeriodicWave>();

  constructor(private readonly ctx: BaseAudioContext) {}

  pulse(duty: number): PeriodicWave {
    const key = Math.round(duty * 1000);
    let wave = this.cache.get(key);
    if (!wave) {
      const real = new Float32Array(HARMONICS);
      const imag = new Float32Array(HARMONICS);
      for (let n = 1; n < HARMONICS; n++) {
        real[n] = Math.sin(2 * Math.PI * n * duty) / (Math.PI * n);
        imag[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (Math.PI * n);
      }
      wave = this.ctx.createPeriodicWave(real, imag);
      this.cache.set(key, wave);
    }
    return wave;
  }
}
