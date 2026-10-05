/** Loudness of a block of samples in dBFS (a full-scale sine is about −3 dB), floored at −100. */
export function rmsDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i] as number;
    sum += x * x;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 1e-5 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

/**
 * Spectral centroid in Hz (the "center of mass" of the spectrum: higher
 * means brighter). `magnitudesDb` is one value per FFT bin in dB, as from
 * `AnalyserNode.getFloatFrequencyData`. Returns 0 for silence.
 */
export function spectralCentroid(magnitudesDb: ArrayLike<number>, sampleRate: number): number {
  const bins = magnitudesDb.length;
  const binHz = sampleRate / 2 / bins;
  let num = 0;
  let den = 0;
  for (let k = 1; k < bins; k++) {
    const db = magnitudesDb[k] as number;
    if (!Number.isFinite(db)) continue;
    const m = Math.pow(10, db / 20);
    num += k * binHz * m;
    den += m;
  }
  return den > 1e-9 ? num / den : 0;
}
