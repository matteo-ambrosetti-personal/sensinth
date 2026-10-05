import type { DrumFlavor, DrumVoice, NoteEvent, TrackParams } from '@sensinth/core';
import { octaves } from '../params';
import type { Instrument } from './types';

/** One sound in a drum voice: a pitch-swept tone or filtered noise, both with a fast decay. */
export type DrumLayer =
  | {
      kind: 'tone';
      wave: OscillatorType;
      from: number;
      to: number;
      sweep: number;
      decay: number;
      gain: number;
      /** Start delay in seconds (claps are several bursts). */
      at?: number;
    }
  | {
      kind: 'noise';
      filter: BiquadFilterType;
      freq: number;
      q?: number;
      decay: number;
      gain: number;
      at?: number;
    };

export type DrumKitDefinition = Record<DrumVoice, readonly DrumLayer[]>;

const clap = (filter: BiquadFilterType, freq: number, q: number, tail: number) =>
  [0, 0.011, 0.022]
    .map((at): DrumLayer => ({ kind: 'noise', filter, freq, q, decay: 0.012, gain: 0.55, at }))
    .concat([{ kind: 'noise', filter, freq, q, decay: tail, gain: 0.7, at: 0.03 }]);

/** 8-bit noise-channel drums. */
export const CHIP_KIT: DrumKitDefinition = {
  kick: [
    { kind: 'tone', wave: 'triangle', from: 160, to: 42, sweep: 0.07, decay: 0.2, gain: 1.3 },
    { kind: 'noise', filter: 'lowpass', freq: 1800, decay: 0.012, gain: 0.25 },
  ],
  snare: [
    { kind: 'noise', filter: 'highpass', freq: 900, decay: 0.13, gain: 0.75 },
    { kind: 'tone', wave: 'triangle', from: 220, to: 140, sweep: 0.05, decay: 0.07, gain: 0.5 },
  ],
  clap: clap('highpass', 1200, 0.7, 0.1),
  rim: [{ kind: 'tone', wave: 'square', from: 900, to: 850, sweep: 0.01, decay: 0.03, gain: 0.4 }],
  hat: [{ kind: 'noise', filter: 'highpass', freq: 7000, decay: 0.035, gain: 0.32 }],
  ohat: [{ kind: 'noise', filter: 'highpass', freq: 4500, decay: 0.28, gain: 0.32 }],
  shaker: [{ kind: 'noise', filter: 'bandpass', freq: 6000, q: 1.5, decay: 0.05, gain: 0.4 }],
  tom: [{ kind: 'tone', wave: 'triangle', from: 220, to: 90, sweep: 0.12, decay: 0.22, gain: 1 }],
  perc: [
    { kind: 'tone', wave: 'square', from: 520, to: 480, sweep: 0.02, decay: 0.06, gain: 0.45 },
  ],
  zap: [{ kind: 'tone', wave: 'square', from: 2400, to: 120, sweep: 0.09, decay: 0.12, gain: 0.4 }],
  noise: [{ kind: 'noise', filter: 'bandpass', freq: 2500, q: 0.8, decay: 0.09, gain: 0.6 }],
  brush: [{ kind: 'noise', filter: 'bandpass', freq: 3000, q: 0.6, decay: 0.16, gain: 0.45 }],
  ride: [
    { kind: 'noise', filter: 'highpass', freq: 6000, decay: 0.45, gain: 0.22 },
    { kind: 'tone', wave: 'square', from: 3100, to: 3050, sweep: 0.02, decay: 0.25, gain: 0.05 },
  ],
  crash: [{ kind: 'noise', filter: 'highpass', freq: 3500, decay: 1.1, gain: 0.35 }],
  cowbell: [
    { kind: 'tone', wave: 'square', from: 560, to: 560, sweep: 0.01, decay: 0.12, gain: 0.22 },
    { kind: 'tone', wave: 'square', from: 845, to: 845, sweep: 0.01, decay: 0.1, gain: 0.18 },
  ],
};

/** Shared by the lo-fi and soft kits. */
const ACOUSTIC_EXTRAS = {
  brush: [
    { kind: 'noise', filter: 'bandpass', freq: 2600, q: 0.5, decay: 0.22, gain: 0.4 },
    { kind: 'noise', filter: 'highpass', freq: 5000, decay: 0.08, gain: 0.15, at: 0.01 },
  ],
  ride: [
    { kind: 'noise', filter: 'bandpass', freq: 7000, q: 1.4, decay: 0.55, gain: 0.25 },
    { kind: 'tone', wave: 'triangle', from: 820, to: 810, sweep: 0.02, decay: 0.35, gain: 0.08 },
  ],
  crash: [
    { kind: 'noise', filter: 'highpass', freq: 3000, decay: 1.6, gain: 0.32 },
    { kind: 'noise', filter: 'bandpass', freq: 6000, q: 0.7, decay: 0.9, gain: 0.15 },
  ],
  cowbell: [
    { kind: 'tone', wave: 'triangle', from: 560, to: 556, sweep: 0.02, decay: 0.18, gain: 0.35 },
    { kind: 'tone', wave: 'triangle', from: 845, to: 840, sweep: 0.02, decay: 0.14, gain: 0.25 },
  ],
} satisfies Partial<Record<DrumVoice, readonly DrumLayer[]>>;

/** Soft, round boom-bap drums. */
export const LOFI_KIT: DrumKitDefinition = {
  kick: [
    { kind: 'tone', wave: 'sine', from: 120, to: 42, sweep: 0.09, decay: 0.35, gain: 1.4 },
    { kind: 'noise', filter: 'lowpass', freq: 900, decay: 0.01, gain: 0.15 },
  ],
  snare: [
    { kind: 'noise', filter: 'bandpass', freq: 1800, q: 0.8, decay: 0.16, gain: 0.8 },
    { kind: 'tone', wave: 'triangle', from: 200, to: 170, sweep: 0.04, decay: 0.09, gain: 0.45 },
  ],
  clap: clap('bandpass', 1400, 1.2, 0.14),
  rim: [
    { kind: 'tone', wave: 'triangle', from: 1050, to: 1000, sweep: 0.01, decay: 0.035, gain: 0.5 },
    { kind: 'noise', filter: 'bandpass', freq: 2500, q: 2, decay: 0.02, gain: 0.3 },
  ],
  hat: [{ kind: 'noise', filter: 'highpass', freq: 7000, decay: 0.04, gain: 0.22 }],
  ohat: [{ kind: 'noise', filter: 'highpass', freq: 6000, decay: 0.22, gain: 0.2 }],
  shaker: [{ kind: 'noise', filter: 'bandpass', freq: 5000, q: 1.2, decay: 0.06, gain: 0.35 }],
  tom: [{ kind: 'tone', wave: 'sine', from: 180, to: 95, sweep: 0.1, decay: 0.25, gain: 1 }],
  perc: [
    { kind: 'tone', wave: 'sine', from: 700, to: 620, sweep: 0.03, decay: 0.08, gain: 0.5 },
    { kind: 'noise', filter: 'bandpass', freq: 3000, q: 3, decay: 0.015, gain: 0.2 },
  ],
  zap: [{ kind: 'tone', wave: 'sine', from: 1500, to: 200, sweep: 0.12, decay: 0.12, gain: 0.4 }],
  noise: [{ kind: 'noise', filter: 'bandpass', freq: 2500, q: 2, decay: 0.02, gain: 0.3 }],
  ...ACOUSTIC_EXTRAS,
};

/** Round and quiet: felt kicks, brushed noise, wooden rims. */
export const SOFT_KIT: DrumKitDefinition = {
  ...LOFI_KIT,
  kick: [{ kind: 'tone', wave: 'sine', from: 90, to: 45, sweep: 0.12, decay: 0.4, gain: 1.2 }],
  rim: [{ kind: 'tone', wave: 'sine', from: 1200, to: 1150, sweep: 0.01, decay: 0.05, gain: 0.45 }],
  shaker: [{ kind: 'noise', filter: 'bandpass', freq: 4000, q: 0.9, decay: 0.08, gain: 0.3 }],
};

const KITS: Record<DrumFlavor, DrumKitDefinition> = {
  chip: CHIP_KIT,
  lofi: LOFI_KIT,
  soft: SOFT_KIT,
};

/**
 * One synthesized drum voice, reshaped per hit by the track's params:
 * `tune` shifts pitch (±1 octave), `decay` stretches the tail, `timbre`
 * balances body against noise.
 */
export class DrumMachine implements Instrument {
  readonly output: GainNode;
  private readonly layers: readonly DrumLayer[];

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly noise: AudioBuffer,
    voice: DrumVoice,
    flavor: DrumFlavor,
  ) {
    this.output = ctx.createGain();
    this.layers = KITS[flavor][voice] ?? KITS[flavor].perc;
  }

  play(ev: NoteEvent, time: number, _duration: number, p: Readonly<TrackParams>): void {
    const pitch = octaves(p.tune, 2);
    const decay = octaves(p.decay, 3);
    const body = 1.5 - p.timbre;
    const air = 0.5 + p.timbre;
    for (const layer of this.layers) {
      const t = time + (layer.at ?? 0);
      if (layer.kind === 'tone') {
        this.tone(t, ev.vel * layer.gain * body, layer, pitch, decay);
      } else {
        this.noiseHit(t, ev.vel * layer.gain * air, layer, Math.sqrt(pitch), decay, ev.step);
      }
    }
  }

  private tone(
    time: number,
    vel: number,
    l: Extract<DrumLayer, { kind: 'tone' }>,
    pitch: number,
    decay: number,
  ): void {
    const osc = this.ctx.createOscillator();
    const vca = this.ctx.createGain();
    const d = l.decay * decay;
    osc.type = l.wave;
    osc.frequency.setValueAtTime(l.from * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(l.to * pitch, time + l.sweep);
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(vel, time + 0.002);
    vca.gain.setTargetAtTime(0, time + 0.002, d / 3);
    osc.connect(vca).connect(this.output);
    osc.start(time);
    osc.stop(time + d * 2.5);
  }

  private noiseHit(
    time: number,
    vel: number,
    l: Extract<DrumLayer, { kind: 'noise' }>,
    pitch: number,
    decay: number,
    step: number,
  ): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = l.filter;
    filter.frequency.value = Math.min(18000, l.freq * pitch);
    if (l.q !== undefined) filter.Q.value = l.q;
    const vca = this.ctx.createGain();
    const d = l.decay * decay;
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(vel, time + 0.001);
    vca.gain.setTargetAtTime(0, time + 0.001, d / 3);
    src.connect(filter).connect(vca).connect(this.output);
    // Different offsets per step so repeated hits are not identical.
    const offset = ((step * 0.137) % 0.7) + 0.05;
    src.start(time, offset);
    src.stop(time + d * 2.5);
  }
}
