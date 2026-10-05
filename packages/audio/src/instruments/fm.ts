import { midiToFreq, type Macros, type NoteEvent, type Patch } from '@sensinth/core';
import { applyEnvelope } from '../envelope';
import type { Instrument } from './types';
import { addVibrato, connectDetune, VoiceLimiter } from './voice';

type FmPatch = Extract<Patch, { type: 'fm' }>;

/**
 * Two-operator FM: a sine modulator bends a sine carrier. A ratio of 1 with
 * a falling index gives electric-piano keys; 3.5 gives bells. Harder notes
 * and higher `texture` make the attack brighter.
 */
export class FmInstrument implements Instrument {
  readonly output: GainNode;
  private readonly limiter = new VoiceLimiter();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly patch: FmPatch,
    private readonly detuneMod?: AudioNode,
  ) {
    this.output = ctx.createGain();
  }

  play(ev: NoteEvent, time: number, duration: number, macros: Readonly<Macros>): void {
    if (ev.midi === undefined) return;
    const { ctx, patch } = this;
    const gate = Math.max(0.01, duration * (patch.gate ?? 1));
    const vca = ctx.createGain();
    vca.gain.value = 0;
    vca.connect(this.output);
    const end = applyEnvelope(vca.gain, time, gate, patch.env, ev.vel);

    const freq = midiToFreq(ev.midi);
    const modFreq = freq * patch.ratio;
    const brightness = (0.5 + macros.texture) * (0.6 + 0.4 * ev.vel);
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const depth = ctx.createGain();
    carrier.frequency.setValueAtTime(freq, time);
    modulator.frequency.setValueAtTime(modFreq, time);
    // Frequency deviation = index × modulator frequency.
    depth.gain.setValueAtTime(patch.index[0] * modFreq * brightness, time);
    depth.gain.setTargetAtTime(
      patch.index[1] * modFreq * brightness,
      time,
      Math.max(0.01, patch.indexDecay / 3),
    );
    modulator.connect(depth).connect(carrier.frequency);
    carrier.connect(vca);
    addVibrato(ctx, carrier, patch.vibrato, time, gate, end);
    for (const osc of [carrier, modulator]) {
      connectDetune(osc, this.detuneMod);
      osc.start(time);
      osc.stop(end);
    }
    this.limiter.track(vca, time, end);
  }
}
