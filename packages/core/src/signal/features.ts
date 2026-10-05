import { clamp, mod } from '../math';
import type { Features, SensorDescriptor, Timescale } from '../sensors/types';
import { Ema } from './ema';
import { MedianFilter } from './median';
import { AdaptiveNormalizer } from './normalizer';
import { OneEuroFilter } from './oneEuro';
import { OnsetDetector } from './onset';

interface Preset {
  median: number;
  minCutoff: number;
  beta: number;
  relaxTau: number;
  trendTau: number;
  trendGain: number;
  activityTau: number;
  activityBaseTau: number;
  activityGain: number;
  onsetThreshold: number;
}

const PRESETS: Record<Timescale, Preset> = {
  // Fast channels skip the median: a one-sample spike (a clap, a tap) is the signal.
  fast: {
    median: 1,
    minCutoff: 3,
    beta: 4,
    relaxTau: 20,
    trendTau: 0.2,
    trendGain: 1,
    activityTau: 0.4,
    activityBaseTau: 0.5,
    activityGain: 4,
    onsetThreshold: 0.25,
  },
  medium: {
    median: 5,
    minCutoff: 0.8,
    beta: 2,
    relaxTau: 60,
    trendTau: 1,
    trendGain: 3,
    activityTau: 2,
    activityBaseTau: 3,
    activityGain: 5,
    onsetThreshold: 0.3,
  },
  slow: {
    median: 5,
    minCutoff: 0.1,
    beta: 0.5,
    relaxTau: 900,
    trendTau: 20,
    trendGain: 60,
    activityTau: 30,
    activityBaseTau: 60,
    activityGain: 8,
    onsetThreshold: 0.4,
  },
};

/**
 * Turns one raw channel into features:
 * median (spikes) → normalize to 0..1 → One-Euro smoothing → level,
 * plus trend (derivative), activity (recent movement) and onsets.
 */
export class FeatureExtractor {
  private readonly median: MedianFilter;
  private readonly normalizer: AdaptiveNormalizer | undefined;
  private readonly smoother: OneEuroFilter;
  private readonly trendEma: Ema;
  private readonly activityBase: Ema;
  private readonly activityEma: Ema;
  private readonly onset: OnsetDetector;
  private readonly preset: Preset;
  private readonly circular: { lo: number; period: number } | undefined;
  private unwrapped: number | undefined;
  private prevLevel: number | undefined;
  private features: Features = { level: 0.5, trend: 0, activity: 0, onset: 0 };

  constructor(desc: SensorDescriptor, timescale: Timescale) {
    this.preset = PRESETS[timescale];
    this.median = new MedianFilter(this.preset.median);
    if (desc.circular && desc.range) {
      this.circular = { lo: desc.range[0], period: desc.range[1] - desc.range[0] };
    } else {
      this.normalizer = new AdaptiveNormalizer({
        ...(desc.range ? { range: desc.range } : {}),
        ...(desc.adaptive !== undefined ? { adaptive: desc.adaptive } : {}),
        ...(desc.minSpan !== undefined ? { minSpan: desc.minSpan } : {}),
        relaxTau: this.preset.relaxTau,
      });
    }
    this.smoother = new OneEuroFilter(this.preset.minCutoff, this.preset.beta);
    this.trendEma = new Ema(this.preset.trendTau);
    this.activityBase = new Ema(this.preset.activityBaseTau);
    this.activityEma = new Ema(this.preset.activityTau);
    this.onset = new OnsetDetector({ threshold: this.preset.onsetThreshold });
  }

  update(raw: number, dt: number): Features {
    if (!Number.isFinite(raw)) return { ...this.features, onset: 0 };
    const p = this.preset;

    // 1. Normalize to 0..1 (circular channels are unwrapped so 359° → 1° is a small step).
    let x: number;
    if (this.circular) {
      const { lo, period } = this.circular;
      if (this.unwrapped === undefined) this.unwrapped = raw;
      else this.unwrapped += mod(raw - this.unwrapped + period / 2, period) - period / 2;
      x = (this.median.update(this.unwrapped) - lo) / period;
    } else {
      x = (this.normalizer as AdaptiveNormalizer).update(this.median.update(raw), dt);
    }

    // 2. Smooth into a level; circular levels wrap back into 0..1.
    const smooth = this.smoother.update(x, dt);
    const level = this.circular ? mod(smooth, 1) : clamp(smooth);

    // 3. Trend: smoothed derivative of the (unwrapped) level.
    const deriv = this.prevLevel === undefined || dt <= 0 ? 0 : (smooth - this.prevLevel) / dt;
    this.prevLevel = smooth;
    const trend = Math.tanh(this.trendEma.update(deriv, dt) * p.trendGain);

    // 4. Activity: average deviation from a slow baseline.
    const base = this.activityBase.update(x, dt);
    const activity = clamp(this.activityEma.update(Math.abs(x - base), dt) * p.activityGain);

    // 5. Onsets on the unsmoothed normalized value, so short events are not blurred away.
    const onset = this.circular ? 0 : this.onset.update(x, dt);

    this.features = { level, trend, activity, onset };
    return this.features;
  }

  get current(): Features {
    return this.features;
  }
}
