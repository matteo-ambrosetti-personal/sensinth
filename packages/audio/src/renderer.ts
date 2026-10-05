import {
  Rng,
  clamp,
  expLerp,
  lerp,
  neutralParams,
  stepDuration,
  swingOffset,
  type GlobalParams,
  type Machine,
  type Macros,
  type NoteEvent,
  type Style,
  type TrackParams,
} from '@sensinth/core';
import { createImpulse, createSoftClipCurve } from './fx/reverb';
import { DrumMachine } from './instruments/drums';
import { FmInstrument } from './instruments/fm';
import { PadInstrument } from './instruments/pad';
import { TonalInstrument } from './instruments/tonal';
import type { Instrument } from './instruments/types';
import { createCrackleBuffer, createNoiseBuffer } from './noise';
import { cutoffHz, levelGain, panValue, resonanceQ, sendGain } from './params';
import { WaveTable } from './waves';

/** What the renderer follows every step. */
export interface RenderState {
  macros: Readonly<Macros>;
  globals: Readonly<GlobalParams>;
  /** 0.5 straight .. 0.66 shuffled. */
  swing: number;
  tracks: readonly { slot: string; params: Readonly<TrackParams> }[];
}

/** A track's machine, as the engine reports it. */
export interface TrackMachine {
  slot: string;
  machineId: string;
  machine: Machine;
}

/**
 * One track's signal path:
 * instrument → filter → (clean + driven) → level → mute → pan → mix and sends.
 * The analyser listens after the mute, so a muted track's scope goes flat.
 */
interface TrackChain {
  machineId: string;
  instrument: Instrument;
  filter: BiquadFilterNode;
  dry: GainNode;
  wet: GainNode;
  level: GainNode;
  mute: GainNode;
  pan: StereoPannerNode;
  reverb: GainNode;
  delay: GainNode;
  analyser: AnalyserNode;
  patchGain: number;
  filterRange: [number, number] | undefined;
  params: TrackParams;
}

const MASTER_GAIN = 0.75;
const DEFAULT_REVERB_SECONDS = 2.4;
/** Seconds for param changes to glide, so modulation never clicks. */
const GLIDE = 0.025;
/** Most a track's drive pushes into the shaper. */
const MAX_DRIVE = 8;

/**
 * Turns note events into sound. Each track has its own filter, drive,
 * level, pan, reverb and delay sends and analyser, all following the
 * modulation matrix every step. The mix ends in a master low-pass that
 * follows `brightness`, a compressor and a soft clipper, so output never
 * clips. Uses only standard Web Audio, so it also works offline.
 */
export class Renderer {
  private tracks = new Map<string, TrackChain>();
  private readonly muted = new Set<string>();
  private style: Style;
  private swing = 0.5;
  private stepSeconds = stepDuration(120);
  private readonly waves: WaveTable;
  private readonly noise: AudioBuffer;
  private readonly dryBus: GainNode;
  private readonly reverbBus: GainNode;
  private readonly delayBus: GainNode;
  private readonly delay: DelayNode;
  private readonly filter: BiquadFilterNode;
  private readonly driveCurve: Float32Array<ArrayBuffer>;
  private convolver: ConvolverNode;
  private reverbSeconds = DEFAULT_REVERB_SECONDS;
  /** Tape wobble: slow drift plus faster flutter, summed into every tonal voice's detune. */
  private readonly wobble: GainNode;
  private readonly wobbleDrift: GainNode;
  private readonly wobbleFlutter: GainNode;
  private readonly crackle: GainNode;
  private readonly jitter = new Rng(17);
  readonly output: GainNode;

  constructor(
    readonly ctx: BaseAudioContext,
    style: Style,
    destination: AudioNode = ctx.destination,
  ) {
    this.style = style;
    this.waves = new WaveTable(ctx);
    this.noise = createNoiseBuffer(ctx);
    this.driveCurve = createSoftClipCurve(2);

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

    // Reverb bus: tracks send into it, `space` sets its return.
    this.reverbBus = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createImpulse(ctx, this.reverbSeconds);
    this.reverbBus.connect(this.convolver).connect(this.dryBus);

    // Tempo-synced feedback delay, darkened on every repeat.
    this.delayBus = ctx.createGain();
    this.delay = ctx.createDelay(2);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 3500;
    this.delayBus.connect(this.delay);
    this.delay.connect(damp).connect(feedback).connect(this.delay);
    damp.connect(this.dryBus);

    // Tape wobble LFOs (depth set per style in `update`).
    this.wobble = ctx.createGain();
    this.wobbleDrift = ctx.createGain();
    this.wobbleFlutter = ctx.createGain();
    this.wobbleDrift.gain.value = 0;
    this.wobbleFlutter.gain.value = 0;
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.55;
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 3.3;
    drift.connect(this.wobbleDrift).connect(this.wobble);
    flutter.connect(this.wobbleFlutter).connect(this.wobble);
    drift.start();
    flutter.start();

    // Vinyl crackle bed.
    this.crackle = ctx.createGain();
    this.crackle.gain.value = 0;
    const crackleSrc = ctx.createBufferSource();
    crackleSrc.buffer = createCrackleBuffer(ctx);
    crackleSrc.loop = true;
    const crackleHp = ctx.createBiquadFilter();
    crackleHp.type = 'highpass';
    crackleHp.frequency.value = 900;
    crackleSrc.connect(crackleHp).connect(this.crackle).connect(this.dryBus);
    crackleSrc.start();

    this.setStyle(style);
    this.setTempo(style.defaultTempo);
  }

  /** Effects for a style; its tracks arrive through `setTracks`. */
  setStyle(style: Style): void {
    this.style = style;
    this.setReverbLength(style.fx.reverbSeconds ?? DEFAULT_REVERB_SECONDS);
    this.setTempo(60 / (this.stepSeconds * 4));
  }

  /**
   * Builds a chain per track. A track that keeps its machine keeps its chain;
   * a new machine fades the old one out.
   */
  setTracks(machines: readonly TrackMachine[]): void {
    const next = new Map<string, TrackChain>();
    for (const m of machines) {
      const old = this.tracks.get(m.slot);
      if (old && old.machineId === m.machineId) {
        next.set(m.slot, old);
        this.tracks.delete(m.slot);
      } else {
        next.set(m.slot, this.createChain(m));
      }
    }
    // Whatever is left is gone or replaced: let it ring out, then drop it.
    const t = this.ctx.currentTime;
    for (const chain of this.tracks.values()) {
      chain.level.gain.setTargetAtTime(0, t + 0.05, 0.15);
      if ('close' in this.ctx) setTimeout(() => chain.pan.disconnect(), 2500);
    }
    this.tracks = next;
  }

  /** Silences a track (or brings it back). The music keeps evolving underneath. */
  setMuted(slot: string, muted: boolean): void {
    if (muted) this.muted.add(slot);
    else this.muted.delete(slot);
    const chain = this.tracks.get(slot);
    chain?.mute.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  isMuted(slot: string): boolean {
    return this.muted.has(slot);
  }

  /** The analyser after a track's mute and pan, for its scope. */
  analyser(slot: string): AnalyserNode | undefined {
    return this.tracks.get(slot)?.analyser;
  }

  setTempo(bpm: number): void {
    this.stepSeconds = stepDuration(bpm);
    this.delay.delayTime.setTargetAtTime(
      Math.min(1.9, this.style.fx.delaySteps * this.stepSeconds),
      this.ctx.currentTime,
      0.05,
    );
  }

  /** Follows the engine: master filter, sends, wobble, crackle and every track's params. */
  update(state: RenderState, time: number): void {
    this.swing = state.swing;
    const { fx } = this.style;
    const { globals, macros } = state;
    const t = Math.max(time, this.ctx.currentTime);
    this.filter.frequency.setTargetAtTime(
      expLerp(fx.filter[0], fx.filter[1], globals.brightness),
      t,
      0.2,
    );
    this.reverbBus.gain.setTargetAtTime(lerp(fx.reverb[0], fx.reverb[1], globals.space), t, 0.3);
    this.delayBus.gain.setTargetAtTime(lerp(fx.delay[0], fx.delay[1], globals.space), t, 0.3);
    const wobble = fx.wobble ? lerp(fx.wobble[0], fx.wobble[1], macros.texture) : 0;
    this.wobbleDrift.gain.setTargetAtTime(wobble, t, 0.5);
    this.wobbleFlutter.gain.setTargetAtTime(wobble * 0.15, t, 0.5);
    const crackle = fx.crackle ? lerp(fx.crackle[0], fx.crackle[1], macros.variation) : 0;
    this.crackle.gain.setTargetAtTime(crackle, t, 0.5);

    for (const { slot, params } of state.tracks) {
      const chain = this.tracks.get(slot);
      if (!chain) continue;
      chain.params = { ...params };
      chain.filter.frequency.setTargetAtTime(cutoffHz(params.cutoff, chain.filterRange), t, GLIDE);
      chain.filter.Q.setTargetAtTime(resonanceQ(params.reso), t, GLIDE);
      const drive = clamp(params.drive) ** 2;
      chain.dry.gain.setTargetAtTime(1 - drive, t, GLIDE);
      chain.wet.gain.setTargetAtTime(drive / Math.sqrt(1 + drive * MAX_DRIVE), t, GLIDE);
      chain.level.gain.setTargetAtTime(chain.patchGain * levelGain(params.level), t, GLIDE);
      chain.pan.pan.setTargetAtTime(panValue(params.pan), t, GLIDE);
      chain.reverb.gain.setTargetAtTime(sendGain(params.sendReverb), t, GLIDE);
      chain.delay.gain.setTargetAtTime(sendGain(params.sendDelay), t, GLIDE);
    }
  }

  /**
   * Plays the events of one step. `gridTime` is the unswung step time; swing,
   * micro timing, retrigs and humanizing are applied here.
   */
  schedule(events: readonly NoteEvent[], gridTime: number, stepSeconds = this.stepSeconds): void {
    const humanize = this.style.fx.humanize ?? 0;
    for (const ev of events) {
      const chain = this.tracks.get(ev.part);
      if (!chain) continue;
      let time =
        gridTime + swingOffset(ev.step, this.swing, stepSeconds) + (ev.micro ?? 0) * stepSeconds;
      if (humanize > 0) time += ((this.jitter.next() * 2 - 1) * humanize) / 1000;
      const params = ev.params ?? chain.params;
      const duration = ev.durSteps * stepSeconds;
      const r = ev.retrig;
      if (!r || r.count <= 1) {
        chain.instrument.play(ev, Math.max(time, this.ctx.currentTime), duration, params);
        continue;
      }
      const gap = Math.max(0.01, r.rate * stepSeconds);
      for (let i = 0; i < r.count; i++) {
        const slope = 1 + r.curve * (i / (r.count - 1) - 0.5);
        const hit = { ...ev, vel: clamp(ev.vel * slope, 0.05, 1) };
        const at = Math.max(time + i * gap, this.ctx.currentTime);
        chain.instrument.play(hit, at, Math.min(duration, gap), params);
      }
    }
  }

  /** Fades out and disconnects everything. */
  dispose(): void {
    const t = this.ctx.currentTime;
    this.output.gain.setTargetAtTime(0, t, 0.05);
    if ('close' in this.ctx) setTimeout(() => this.output.disconnect(), 300);
  }

  private createChain(m: TrackMachine): TrackChain {
    const { ctx } = this;
    const instrument = this.createInstrument(m.machine);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const dry = ctx.createGain();
    const pre = ctx.createGain();
    pre.gain.value = 1 + MAX_DRIVE;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.driveCurve;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    const level = ctx.createGain();
    const mute = ctx.createGain();
    mute.gain.value = this.muted.has(m.slot) ? 0 : 1;
    const pan = ctx.createStereoPanner();
    const reverb = ctx.createGain();
    const delay = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;

    instrument.output.connect(filter);
    filter.connect(dry).connect(level);
    filter.connect(pre).connect(shaper).connect(wet).connect(level);
    level.connect(mute).connect(pan);
    pan.connect(this.dryBus);
    pan.connect(reverb).connect(this.reverbBus);
    pan.connect(delay).connect(this.delayBus);
    pan.connect(analyser);

    const chain: TrackChain = {
      machineId: m.machineId,
      instrument,
      filter,
      dry,
      wet,
      level,
      mute,
      pan,
      reverb,
      delay,
      analyser,
      patchGain: m.machine.patch.gain,
      filterRange: m.machine.filter,
      params: neutralParams(),
    };
    // Start from neutral values; the next `update` glides to the real ones.
    const p = chain.params;
    filter.frequency.value = cutoffHz(p.cutoff, chain.filterRange);
    filter.Q.value = resonanceQ(p.reso);
    level.gain.value = chain.patchGain * levelGain(p.level);
    reverb.gain.value = sendGain(p.sendReverb);
    delay.gain.value = sendGain(p.sendDelay);
    return chain;
  }

  private createInstrument(machine: Machine): Instrument {
    const { patch } = machine;
    switch (patch.type) {
      case 'pulse':
      case 'osc':
        return new TonalInstrument(this.ctx, patch, this.waves, this.wobble);
      case 'fm':
        return new FmInstrument(this.ctx, patch, this.wobble);
      case 'pad':
        return new PadInstrument(this.ctx, patch, this.wobble);
      case 'drum':
        return new DrumMachine(this.ctx, this.noise, patch.voice, patch.flavor);
    }
  }

  /** Swaps in a new impulse response when a style wants a longer or shorter tail. */
  private setReverbLength(seconds: number): void {
    if (seconds === this.reverbSeconds) return;
    this.reverbSeconds = seconds;
    const next = this.ctx.createConvolver();
    next.buffer = createImpulse(this.ctx, seconds);
    this.reverbBus.connect(next).connect(this.dryBus);
    const old = this.convolver;
    this.reverbBus.disconnect(old);
    this.convolver = next;
    // Let the old tail ring out before dropping it.
    if ('close' in this.ctx) setTimeout(() => old.disconnect(), seconds * 1000);
  }
}
