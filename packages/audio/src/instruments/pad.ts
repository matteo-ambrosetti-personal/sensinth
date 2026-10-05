import { expLerp, midiToFreq, type NoteEvent, type Patch, type TrackParams } from '@sensinth/core';
import { applyEnvelope } from '../envelope';
import { shapeEnvelope } from '../params';
import type { Instrument } from './types';
import { connectDetune, VoiceLimiter } from './voice';

type PadPatch = Extract<Patch, { type: 'pad' }>;

/**
 * Detuned oscillators through a low-pass that opens over the attack. The
 * track's `cutoff` sets how far it opens and `timbre` the detune spread.
 */
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

  play(ev: NoteEvent, time: number, duration: number, params: Readonly<TrackParams>): void {
    if (ev.midi === undefined) return;
    const { ctx, patch } = this;
    const gate = Math.max(0.05, duration * (patch.gate ?? 1));
    const vca = ctx.createGain();
    vca.gain.value = 0;
    const env = shapeEnvelope(patch.env, params);
    const end = applyEnvelope(vca.gain, time, gate, env, ev.vel);

    const cutoff = expLerp(patch.cutoff[0], patch.cutoff[1], params.cutoff);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(cutoff * 0.35, time);
    filter.frequency.linearRampToValueAtTime(cutoff, time + Math.max(0.05, env.a));
    const mix = ctx.createGain();
    const n = Math.max(1, Math.round(patch.voices));
    mix.gain.value = 1 / Math.sqrt(n);
    mix.connect(filter).connect(vca).connect(this.output);

    const freq = midiToFreq(ev.midi);
    const spread = patch.detune * (0.3 + 1.4 * params.timbre);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.type = patch.wave;
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime(n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1), time);
      connectDetune(osc, this.detuneMod);
      osc.connect(mix);
      osc.start(time);
      osc.stop(end);
    }
    this.limiter.track(vca, time, end);
  }
}
