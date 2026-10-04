import type { Macros, NoteEvent } from '@sensinth/core';
import type { Instrument } from './types';

/** Noise-channel and pitch-sweep drums in the style of 8-bit consoles. */
export class ChipDrums implements Instrument {
  readonly output: GainNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly noise: AudioBuffer,
  ) {
    this.output = ctx.createGain();
  }

  play(ev: NoteEvent, time: number, _duration: number, _macros: Readonly<Macros>): void {
    const v = ev.vel;
    switch (ev.voice) {
      case 'kick':
        this.tone(time, v * 1.3, 'triangle', 160, 42, 0.07, 0.2);
        this.noiseHit(time, v * 0.25, 'lowpass', 1800, 0.012, ev.step);
        break;
      case 'snare':
        this.noiseHit(time, v * 0.75, 'highpass', 900, 0.13, ev.step);
        this.tone(time, v * 0.5, 'triangle', 220, 140, 0.05, 0.07);
        break;
      case 'hat':
        this.noiseHit(time, v * 0.32, 'highpass', 7000, 0.035, ev.step);
        break;
      case 'ohat':
        this.noiseHit(time, v * 0.32, 'highpass', 4500, 0.28, ev.step);
        break;
      case 'tom':
        this.tone(time, v, 'triangle', 220, 90, 0.12, 0.22);
        break;
      default:
        this.noiseHit(time, v * 0.4, 'bandpass', 2500, 0.08, ev.step);
    }
  }

  private tone(
    time: number,
    vel: number,
    type: OscillatorType,
    from: number,
    to: number,
    sweep: number,
    decay: number,
  ): void {
    const osc = this.ctx.createOscillator();
    const vca = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, time);
    osc.frequency.exponentialRampToValueAtTime(to, time + sweep);
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(vel, time + 0.002);
    vca.gain.setTargetAtTime(0, time + 0.002, decay / 3);
    osc.connect(vca).connect(this.output);
    osc.start(time);
    osc.stop(time + decay * 2.5);
  }

  private noiseHit(
    time: number,
    vel: number,
    filterType: BiquadFilterType,
    freq: number,
    decay: number,
    step: number,
  ): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(vel, time + 0.001);
    vca.gain.setTargetAtTime(0, time + 0.001, decay / 3);
    src.connect(filter).connect(vca).connect(this.output);
    // Different offsets per step so repeated hits are not identical.
    const offset = ((step * 0.137) % 0.7) + 0.05;
    src.start(time, offset);
    src.stop(time + decay * 2.5);
  }
}
