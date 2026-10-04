import {
  expLerp,
  lerp,
  stepDuration,
  swingOffset,
  defaultMacros,
  type Macros,
  type NoteEvent,
  type Style,
} from '@sensinth/core';
import { createImpulse, createSoftClipCurve } from './fx/reverb';
import { ChipDrums } from './instruments/chipDrums';
import { TonalInstrument } from './instruments/tonal';
import type { Instrument } from './instruments/types';
import { createNoiseBuffer } from './noise';
import { WaveTable } from './waves';

interface PartChain {
  instrument: Instrument;
  gain: GainNode;
  pan: StereoPannerNode;
}

const MASTER_GAIN = 0.75;

/**
 * Turns composer note events into sound. Owns the mix: per-part gain and
 * pan, reverb and tempo-synced delay sends, a master low-pass that follows
 * `brightness`, a compressor and a soft clipper so output never clips.
 * Uses only standard Web Audio, so it also works with an OfflineAudioContext.
 */
export class Renderer {
  private parts = new Map<string, PartChain>();
  private style: Style;
  private macros: Macros = defaultMacros();
  private stepSeconds = stepDuration(120);
  private readonly waves: WaveTable;
  private readonly noise: AudioBuffer;
  private readonly dryBus: GainNode;
  private readonly reverbSend: GainNode;
  private readonly delaySend: GainNode;
  private readonly delay: DelayNode;
  private readonly filter: BiquadFilterNode;
  readonly output: GainNode;

  constructor(
    readonly ctx: BaseAudioContext,
    style: Style,
    destination: AudioNode = ctx.destination,
  ) {
    this.style = style;
    this.waves = new WaveTable(ctx);
    this.noise = createNoiseBuffer(ctx);

    this.dryBus = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.15;
    const clip = ctx.createWaveShaper();
    clip.curve = createSoftClipCurve();
    clip.oversample = '2x';
    this.output = ctx.createGain();
    this.output.gain.value = MASTER_GAIN;
    this.dryBus.connect(this.filter).connect(comp).connect(clip).connect(this.output);
    this.output.connect(destination);

    // Reverb send.
    this.reverbSend = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = createImpulse(ctx);
    this.reverbSend.connect(convolver).connect(this.dryBus);

    // Tempo-synced feedback delay, darkened on every repeat.
    this.delaySend = ctx.createGain();
    this.delay = ctx.createDelay(2);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 3500;
    this.delaySend.connect(this.delay);
    this.delay.connect(damp).connect(feedback).connect(this.delay);
    damp.connect(this.dryBus);

    this.loadStyle(style);
    this.setTempo(style.defaultTempo);
    this.update(this.macros, ctx.currentTime);
  }

  /** Builds the instruments for a style. Parts of the previous style fade out. */
  loadStyle(style: Style): void {
    const old = this.parts;
    this.style = style;
    this.parts = new Map();
    for (const part of style.parts) {
      const patch = style.instruments[part.instrument];
      if (!patch) continue;
      const instrument =
        patch.type === 'chipDrums'
          ? new ChipDrums(this.ctx, this.noise)
          : new TonalInstrument(this.ctx, patch, this.waves);
      const gain = this.ctx.createGain();
      gain.gain.value = patch.gain;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = patch.pan ?? 0;
      instrument.output.connect(gain).connect(pan);
      pan.connect(this.dryBus);
      pan.connect(this.reverbSend);
      if (patch.type !== 'chipDrums') pan.connect(this.delaySend);
      this.parts.set(part.id, { instrument, gain, pan });
    }
    if (old.size > 0) {
      const t = this.ctx.currentTime;
      for (const chain of old.values()) chain.gain.gain.setTargetAtTime(0, t + 0.5, 0.3);
      if ('close' in this.ctx) {
        setTimeout(() => old.forEach((c) => c.pan.disconnect()), 4000);
      }
    }
  }

  setTempo(bpm: number): void {
    this.stepSeconds = stepDuration(bpm);
    const t = this.ctx.currentTime;
    this.delay.delayTime.setTargetAtTime(
      Math.min(1.9, this.style.fx.delaySteps * this.stepSeconds),
      t,
      0.05,
    );
  }

  /** Follows the macros: master filter, reverb and delay amounts. */
  update(macros: Readonly<Macros>, time: number): void {
    this.macros = { ...macros };
    const { fx } = this.style;
    const t = Math.max(time, this.ctx.currentTime);
    this.filter.frequency.setTargetAtTime(
      expLerp(fx.filter[0], fx.filter[1], macros.brightness),
      t,
      0.2,
    );
    this.reverbSend.gain.setTargetAtTime(lerp(fx.reverb[0], fx.reverb[1], macros.space), t, 0.3);
    this.delaySend.gain.setTargetAtTime(lerp(fx.delay[0], fx.delay[1], macros.space), t, 0.3);
  }

  /**
   * Plays the events of one step. `gridTime` is the unswung step time; swing
   * is applied here from the style.
   */
  schedule(events: readonly NoteEvent[], gridTime: number, stepSeconds = this.stepSeconds): void {
    for (const ev of events) {
      const chain = this.parts.get(ev.part);
      if (!chain) continue;
      const time = gridTime + swingOffset(ev.step, this.style.swing, stepSeconds);
      chain.instrument.play(ev, time, ev.durSteps * stepSeconds, this.macros);
    }
  }

  /** Fades out and disconnects everything. */
  dispose(): void {
    const t = this.ctx.currentTime;
    this.output.gain.setTargetAtTime(0, t, 0.05);
    if ('close' in this.ctx) setTimeout(() => this.output.disconnect(), 300);
  }
}
