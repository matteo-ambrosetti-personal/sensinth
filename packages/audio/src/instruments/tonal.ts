import { midiToFreq, type Macros, type NoteEvent, type Patch } from '@sensinth/core';
import { applyEnvelope } from '../envelope';
import type { WaveTable } from '../waves';
import type { Instrument } from './types';
import { addVibrato, connectDetune, VoiceLimiter } from './voice';

type TonalPatch = Extract<Patch, { type: 'pulse' | 'osc' }>;

/** Pulse and basic-oscillator voices with ADSR, optional detune and delayed vibrato. */
export class TonalInstrument implements Instrument {
  readonly output: GainNode;
  private readonly limiter = new VoiceLimiter();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly patch: TonalPatch,
    private readonly waves: WaveTable,
    private readonly detuneMod?: AudioNode,
  ) {
    this.output = ctx.createGain();
  }

  play(ev: NoteEvent, time: number, duration: number, macros: Readonly<Macros>): void {
    if (ev.midi === undefined) return;
    const { ctx, patch } = this;
    const gate = Math.max(0.01, duration * (patch.gate ?? 0.9));
    const vca = ctx.createGain();
    vca.gain.value = 0;
    vca.connect(this.output);
    const end = applyEnvelope(vca.gain, time, gate, patch.env, ev.vel);

    const detune = patch.type === 'osc' ? (patch.detune ?? 0) : 0;
    const spread = detune > 0 ? [-detune / 2, detune / 2] : [0];
    const freq = midiToFreq(ev.midi);
    for (const cents of spread) {
      const osc = ctx.createOscillator();
      if (patch.type === 'pulse') {
        const duties = patch.duty;
        const idx = Math.min(duties.length - 1, Math.floor(macros.texture * duties.length));
        osc.setPeriodicWave(this.waves.pulse(duties[idx] ?? 0.5));
      } else {
        osc.type = patch.wave;
      }
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime(cents, time);
      addVibrato(ctx, osc, patch.vibrato, time, gate, end);
      connectDetune(osc, this.detuneMod);
      osc.connect(vca);
      osc.start(time);
      osc.stop(end);
    }
    this.limiter.track(vca, time, end);
  }
}
