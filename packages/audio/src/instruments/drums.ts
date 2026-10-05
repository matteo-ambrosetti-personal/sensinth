import type { Macros, NoteEvent } from '@sensinth/core';
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
    }
  | {
      kind: 'noise';
      filter: BiquadFilterType;
      freq: number;
      q?: number;
      decay: number;
      gain: number;
    };

/** Layers per drum voice; `default` plays for any voice the kit does not define. */
export type DrumKitDefinition = Record<string, readonly DrumLayer[]> & {
  default: readonly DrumLayer[];
};

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
  hat: [{ kind: 'noise', filter: 'highpass', freq: 7000, decay: 0.035, gain: 0.32 }],
  ohat: [{ kind: 'noise', filter: 'highpass', freq: 4500, decay: 0.28, gain: 0.32 }],
  tom: [{ kind: 'tone', wave: 'triangle', from: 220, to: 90, sweep: 0.12, decay: 0.22, gain: 1 }],
  default: [{ kind: 'noise', filter: 'bandpass', freq: 2500, decay: 0.08, gain: 0.4 }],
};

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
  hat: [{ kind: 'noise', filter: 'highpass', freq: 7000, decay: 0.04, gain: 0.22 }],
  ohat: [{ kind: 'noise', filter: 'highpass', freq: 6000, decay: 0.22, gain: 0.2 }],
  rim: [
    { kind: 'tone', wave: 'triangle', from: 1050, to: 1000, sweep: 0.01, decay: 0.035, gain: 0.5 },
    { kind: 'noise', filter: 'bandpass', freq: 2500, q: 2, decay: 0.02, gain: 0.3 },
  ],
  default: [{ kind: 'noise', filter: 'bandpass', freq: 2500, q: 2, decay: 0.02, gain: 0.3 }],
};

/** Synthesized drum kit: every hit is built from the voice's layers. */
export class DrumKit implements Instrument {
  readonly output: GainNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly noise: AudioBuffer,
    private readonly kit: DrumKitDefinition,
  ) {
    this.output = ctx.createGain();
  }

  play(ev: NoteEvent, time: number, _duration: number, _macros: Readonly<Macros>): void {
    const layers = (ev.voice && this.kit[ev.voice]) || this.kit.default;
    for (const layer of layers) {
      if (layer.kind === 'tone') this.tone(time, ev.vel * layer.gain, layer);
      else this.noiseHit(time, ev.vel * layer.gain, layer, ev.step);
    }
  }

  private tone(time: number, vel: number, l: Extract<DrumLayer, { kind: 'tone' }>): void {
    const osc = this.ctx.createOscillator();
    const vca = this.ctx.createGain();
    osc.type = l.wave;
    osc.frequency.setValueAtTime(l.from, time);
    osc.frequency.exponentialRampToValueAtTime(l.to, time + l.sweep);
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(vel, time + 0.002);
    vca.gain.setTargetAtTime(0, time + 0.002, l.decay / 3);
    osc.connect(vca).connect(this.output);
    osc.start(time);
    osc.stop(time + l.decay * 2.5);
  }

  private noiseHit(
    time: number,
    vel: number,
    l: Extract<DrumLayer, { kind: 'noise' }>,
    step: number,
  ): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = l.filter;
    filter.frequency.value = l.freq;
    if (l.q !== undefined) filter.Q.value = l.q;
    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(vel, time + 0.001);
    vca.gain.setTargetAtTime(0, time + 0.001, l.decay / 3);
    src.connect(filter).connect(vca).connect(this.output);
    // Different offsets per step so repeated hits are not identical.
    const offset = ((step * 0.137) % 0.7) + 0.05;
    src.start(time, offset);
    src.stop(time + l.decay * 2.5);
  }
}
