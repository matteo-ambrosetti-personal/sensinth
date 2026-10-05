import { expLerp, midiToFreq, type Macros, type NoteEvent, type Patch } from '@sensinth/core';
import { applyEnvelope } from '../envelope';
import type { Instrument } from './types';
import { connectDetune, VoiceLimiter } from './voice';

type PadPatch = Extract<Patch, { type: 'pad' }>;

/** Detuned oscillators through a low-pass that opens over the attack; cutoff follows brightness. */
export class PadInstrument implements Instrument {
  readonly output: GainNode;
  private readonly limiter = new VoiceLimiter(12);

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly patch: PadPatch,
    private readonly detuneMod?: AudioNode,
  ) {
    this.output = ctx.createGain();
  }

  play(ev: NoteEvent, time: number, duration: number, macros: Readonly<Macros>): void {
    if (ev.midi === undefined) return;
    const { ctx, patch } = this;
    const gate = Math.max(0.05, duration * (patch.gate ?? 1));
    const vca = ctx.createGain();
    vca.gain.value = 0;
    const end = applyEnvelope(vca.gain, time, gate, patch.env, ev.vel);

    const cutoff = expLerp(patch.cutoff[0], patch.cutoff[1], macros.brightness);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(cutoff * 0.35, time);
    filter.frequency.linearRampToValueAtTime(cutoff, time + Math.max(0.05, patch.env.a));
    const mix = ctx.createGain();
    const n = Math.max(1, Math.round(patch.voices));
    mix.gain.value = 1 / Math.sqrt(n);
    mix.connect(filter).connect(vca).connect(this.output);

    const freq = midiToFreq(ev.midi);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.type = patch.wave;
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime(
        n === 1 ? 0 : -patch.detune / 2 + (patch.detune * i) / (n - 1),
        time,
      );
      connectDetune(osc, this.detuneMod);
      osc.connect(mix);
      osc.start(time);
      osc.stop(end);
    }
    this.limiter.track(vca, time, end);
  }
}
