import { midiToFreq, type Macros, type NoteEvent, type Patch } from '@sensinth/core';
import { applyEnvelope } from '../envelope';
import type { WaveTable } from '../waves';
import type { Instrument } from './types';

type TonalPatch = Extract<Patch, { type: 'pulse' | 'osc' }>;

const MAX_VOICES = 8;

/** Pulse and basic-oscillator voices with ADSR, optional detune and delayed vibrato. */
export class TonalInstrument implements Instrument {
  readonly output: GainNode;
  private voices: { gain: GainNode; end: number }[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly patch: TonalPatch,
    private readonly waves: WaveTable,
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
    const oscs = detune > 0 ? [-detune / 2, detune / 2] : [0];
    const freq = midiToFreq(ev.midi);
    for (const cents of oscs) {
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
      if (patch.vibrato && gate > patch.vibrato.delay) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = patch.vibrato.rate;
        depth.gain.setValueAtTime(0, time);
        depth.gain.setValueAtTime(0, time + patch.vibrato.delay);
        depth.gain.linearRampToValueAtTime(patch.vibrato.depth, time + patch.vibrato.delay + 0.2);
        lfo.connect(depth).connect(osc.detune);
        lfo.start(time);
        lfo.stop(end);
      }
      osc.connect(vca);
      osc.start(time);
      osc.stop(end);
    }
    this.track(vca, time, end);
  }

  /** Caps polyphony by quickly fading the oldest voice still sounding. */
  private track(gain: GainNode, time: number, end: number): void {
    this.voices = this.voices.filter((v) => v.end > time);
    this.voices.push({ gain, end });
    if (this.voices.length > MAX_VOICES) {
      const oldest = this.voices.shift();
      oldest?.gain.gain.setTargetAtTime(0, time, 0.005);
    }
  }
}
