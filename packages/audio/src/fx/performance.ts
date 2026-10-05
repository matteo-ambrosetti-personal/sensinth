import { clamp, expLerp, lerp, type FxId } from '@sensinth/core';

/** Where the effects tap into the renderer. */
export interface PerformanceFxPorts {
  /** The tracks' mix before the reverb and delay returns; the wash and the throw send from here. */
  mix: AudioNode;
  /** Straight into the reverb, past the style's return level. */
  reverbIn: AudioNode;
  /** Straight into the delay line. */
  delayIn: AudioNode;
  /** The delay's feedback, which a dub throw pushes up. */
  delayFeedback: AudioParam;
  /** Feedback when no throw is playing. */
  feedbackRest: number;
  noise: AudioBuffer;
}

/** An effect that is playing or about to, for the UI. */
export interface FxPlaying {
  fx: FxId;
  start: number;
  end: number;
  depth: number;
}

/** Seconds of fade at every switch, so nothing clicks. */
const FADE = 0.005;
/** Longest tape stop the delay line can hold (it reaches up to ⅔ of the stop). */
const MAX_TAPE_SECONDS = 5.5;
const HP_REST = 20;
const LP_REST = 20000;

/**
 * Momentary effects on the whole mix, each scheduled on the audio clock:
 *
 *   mix ─► high-pass ─► low-pass ─► gate ─┬─► duck ─► wash duck ─────────────► out
 *   (riser)   (dive)     (chop)           ├─► stutter loop ─────────────────► out
 *                                         ├─► tape delay (stop, brake) ─────► out
 *                                         ├─► bit crusher ──────────────────► out
 *                                         └─► ring modulator ───────────────► out
 *
 * The exclusive ones (stutter, tape stop, brake, crush, ring) take over from
 * the dry mix while they play; the engine never overlaps two of them. The
 * wash and the dub throw send the mix into the reverb and the delay.
 */
export class PerformanceFx {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly hp: BiquadFilterNode;
  private readonly lp: BiquadFilterNode;
  private readonly gate: GainNode;
  private readonly duck: GainNode;
  private readonly washDuck: GainNode;
  private readonly stutterIn: GainNode;
  private readonly stutterLoop: DelayNode;
  private readonly stutterFeedback: GainNode;
  private readonly stutterOut: GainNode;
  private readonly tape: DelayNode;
  private readonly tapeTone: BiquadFilterNode;
  private readonly tapeOut: GainNode;
  private readonly crushOut: GainNode;
  private readonly ringOsc: OscillatorNode;
  private readonly ringOut: GainNode;
  private readonly washSend: GainNode;
  private readonly throwSend: GainNode;
  private playing: FxPlaying[] = [];

  constructor(
    readonly ctx: BaseAudioContext,
    private readonly ports: PerformanceFxPorts,
  ) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = HP_REST;
    this.hp.Q.value = 0.7;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = LP_REST;
    this.lp.Q.value = 0.7;
    this.gate = ctx.createGain();
    this.duck = ctx.createGain();
    this.washDuck = ctx.createGain();
    this.input.connect(this.hp).connect(this.lp).connect(this.gate);
    const post = this.gate;
    post.connect(this.duck).connect(this.washDuck).connect(this.output);

    // Stutter: record one slice into a loop, then let it go round.
    this.stutterIn = gain(ctx, 0);
    this.stutterLoop = ctx.createDelay(2);
    this.stutterFeedback = gain(ctx, 0);
    this.stutterOut = gain(ctx, 0);
    post.connect(this.stutterIn).connect(this.stutterLoop).connect(this.stutterOut);
    this.stutterLoop.connect(this.stutterFeedback).connect(this.stutterLoop);
    this.stutterOut.connect(this.output);

    // Tape stop and brake: a delay line that slows down, so pitch and speed fall.
    this.tape = ctx.createDelay(4);
    this.tape.delayTime.value = 0;
    this.tapeTone = ctx.createBiquadFilter();
    this.tapeTone.type = 'lowpass';
    this.tapeTone.frequency.value = LP_REST;
    this.tapeOut = gain(ctx, 0);
    post.connect(this.tape).connect(this.tapeTone).connect(this.tapeOut).connect(this.output);

    // Bit crush: a staircase transfer curve.
    const crusher = ctx.createWaveShaper();
    crusher.curve = crushCurve(3);
    const crushDrive = gain(ctx, 1.2);
    this.crushOut = gain(ctx, 0);
    const crushLevel = gain(ctx, 0.8);
    post.connect(crushDrive).connect(crusher).connect(crushLevel).connect(this.crushOut);
    this.crushOut.connect(this.output);

    // Ring modulation: the mix times a sine.
    const ring = gain(ctx, 0);
    this.ringOsc = ctx.createOscillator();
    this.ringOsc.frequency.value = 220;
    this.ringOsc.connect(ring.gain);
    this.ringOsc.start();
    this.ringOut = gain(ctx, 0);
    post.connect(ring).connect(this.ringOut).connect(this.output);

    // Wash and dub throw send the tracks (not the returns, so there is no loop).
    this.washSend = gain(ctx, 0);
    ports.mix.connect(this.washSend).connect(ports.reverbIn);
    this.throwSend = gain(ctx, 0);
    ports.mix.connect(this.throwSend).connect(ports.delayIn);
  }

  /** Effects playing at `time` (audio clock). */
  activeAt(time: number): FxPlaying[] {
    return this.playing.filter((p) => p.start <= time && time < p.end);
  }

  /**
   * Plays an effect from `time` for `seconds`. `depth` (0..1) sets how hard
   * it hits; `stepSeconds` keeps rhythmic effects on the grid.
   */
  trigger(fx: FxId, time: number, seconds: number, depth: number, stepSeconds: number): void {
    const t = Math.max(time, this.ctx.currentTime);
    const d = clamp(depth);
    const dur = Math.max(stepSeconds, seconds);
    const end = t + dur;
    this.playing = this.playing.filter((p) => p.end > this.ctx.currentTime);
    this.playing.push({ fx, start: t, end, depth: d });
    switch (fx) {
      case 'stutter':
        return this.stutter(t, end, d, stepSeconds);
      case 'tapeStop':
        return this.tapeStop(t, Math.min(dur, MAX_TAPE_SECONDS), (u) => (u * u) / 2);
      case 'brake':
        // Slows fast at first, like a platter under a hand.
        return this.tapeStop(t, Math.min(dur, MAX_TAPE_SECONDS), (u) => u * u - (u * u * u) / 3);
      case 'sweep':
        return this.sweep(t, end, d);
      case 'dive':
        return this.dive(t, end, d);
      case 'wash':
        return this.wash(t, end, d);
      case 'dubThrow':
        return this.dubThrow(t, end, d, stepSeconds);
      case 'crush':
        return this.takeOver(this.crushOut.gain, t, end, 0.1);
      case 'gate':
        return this.chop(t, end, d, stepSeconds);
      case 'ring':
        return this.ring(t, end, d);
    }
  }

  /** Ends every effect at `time` and returns to the dry mix. */
  stop(time = this.ctx.currentTime): void {
    this.playing = [];
    const rest: [AudioParam, number][] = [
      [this.hp.frequency, HP_REST],
      [this.lp.frequency, LP_REST],
      [this.lp.Q, 0.7],
      [this.hp.Q, 0.7],
      [this.gate.gain, 1],
      [this.duck.gain, 1],
      [this.washDuck.gain, 1],
      [this.stutterIn.gain, 0],
      [this.stutterFeedback.gain, 0],
      [this.stutterOut.gain, 0],
      [this.tapeOut.gain, 0],
      [this.crushOut.gain, 0],
      [this.ringOut.gain, 0],
      [this.washSend.gain, 0],
      [this.throwSend.gain, 0],
      [this.ports.delayFeedback, this.ports.feedbackRest],
    ];
    for (const [param, value] of rest) {
      param.cancelScheduledValues(time);
      param.setValueAtTime(param.value, time);
      param.linearRampToValueAtTime(value, time + 0.02);
    }
    this.tape.delayTime.cancelScheduledValues(time);
    this.tape.delayTime.setValueAtTime(0, time + 0.03);
  }

  /** Records one sixteenth or eighth, then repeats it until the end. */
  private stutter(t: number, end: number, depth: number, step: number): void {
    const slice = Math.min(1.9, (depth > 0.7 || end - t < 4 * step ? 1 : 2) * step);
    const t1 = t + slice;
    if (t1 >= end) return;
    this.stutterLoop.delayTime.cancelScheduledValues(t);
    this.stutterLoop.delayTime.setValueAtTime(slice, t);
    pulse(this.stutterIn.gain, t, t1, 1);
    hold(this.stutterFeedback.gain, t, end, 0.97);
    this.takeOver(this.stutterOut.gain, t1, end, 0);
  }

  /**
   * Slows the mix to a halt over `seconds`. `delayAt(u)` is how far behind
   * the tape is (in stops) at fraction `u`; its slope is how slow it plays.
   */
  private tapeStop(t: number, seconds: number, delayAt: (u: number) => number): void {
    const end = t + seconds;
    const curve = new Float32Array(64);
    for (let i = 0; i < curve.length; i++) curve[i] = delayAt(i / (curve.length - 1)) * seconds;
    const delay = this.tape.delayTime;
    delay.cancelScheduledValues(t);
    try {
      delay.setValueAtTime(0, t);
      delay.setValueCurveAtTime(curve, t + 0.001, seconds - 0.002);
      delay.setValueAtTime(0, end + 0.02);
    } catch {
      return; // Overlaps an earlier stop still sliding; skip this one.
    }
    const tone = this.tapeTone.frequency;
    tone.cancelScheduledValues(t);
    tone.setValueAtTime(12000, t);
    tone.exponentialRampToValueAtTime(300, end);
    tone.setValueAtTime(LP_REST, end + 0.02);
    this.takeOver(this.tapeOut.gain, t, end, 0);
  }

  /** A high-pass riser, with a noise swell on top. */
  private sweep(t: number, end: number, depth: number): void {
    const top = expLerp(1200, 5000, depth);
    const f = this.hp.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(HP_REST, t);
    f.exponentialRampToValueAtTime(top, end);
    f.setTargetAtTime(HP_REST, end, 0.02);
    const q = this.hp.Q;
    q.cancelScheduledValues(t);
    q.setValueAtTime(0.7, t);
    q.linearRampToValueAtTime(lerp(2, 6, depth), end);
    q.setTargetAtTime(0.7, end, 0.02);

    const { ctx } = this;
    const noise = ctx.createBufferSource();
    noise.buffer = this.ports.noise;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2;
    band.frequency.setValueAtTime(400, t);
    band.frequency.exponentialRampToValueAtTime(9000, end);
    const level = gain(ctx, 0);
    level.gain.setValueAtTime(0, t);
    level.gain.linearRampToValueAtTime(0.05 + 0.08 * depth, end);
    level.gain.linearRampToValueAtTime(0, end + 0.03);
    noise.connect(band).connect(level).connect(this.output);
    noise.start(t);
    noise.stop(end + 0.05);
    noise.onended = () => level.disconnect();
  }

  /** A resonant low-pass that closes, then snaps open. */
  private dive(t: number, end: number, depth: number): void {
    const bottom = expLerp(900, 220, depth);
    const low = t + (end - t) * 0.7;
    const f = this.lp.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(LP_REST, t);
    f.exponentialRampToValueAtTime(bottom, low);
    f.setValueAtTime(bottom, end - 0.03);
    f.exponentialRampToValueAtTime(LP_REST, end);
    const q = this.lp.Q;
    q.cancelScheduledValues(t);
    q.setValueAtTime(0.7, t);
    q.linearRampToValueAtTime(lerp(3, 9, depth), low);
    q.linearRampToValueAtTime(0.7, end);
  }

  /** Floods the reverb with the mix while the dry mix sinks into it. */
  private wash(t: number, end: number, depth: number): void {
    hold(this.washSend.gain, t, end, lerp(0.35, 0.8, depth), 0.08, 0.4);
    const duck = this.washDuck.gain;
    duck.cancelScheduledValues(t);
    duck.setValueAtTime(1, t);
    duck.linearRampToValueAtTime(lerp(0.75, 0.45, depth), t + (end - t) * 0.6);
    duck.linearRampToValueAtTime(1, end + 0.3);
  }

  /** Throws a beat into the delay and lets its echoes run long. */
  private dubThrow(t: number, end: number, depth: number, step: number): void {
    hold(this.throwSend.gain, t, Math.min(end, t + 2 * step), lerp(0.5, 0.9, depth));
    const fb = this.ports.delayFeedback;
    fb.cancelScheduledValues(t);
    fb.setValueAtTime(this.ports.feedbackRest, t);
    fb.linearRampToValueAtTime(lerp(0.6, 0.78, depth), t + 0.05);
    fb.setValueAtTime(lerp(0.6, 0.78, depth), end);
    fb.linearRampToValueAtTime(this.ports.feedbackRest, end + 1.5);
  }

  /** Chops the mix into sixteenths. */
  private chop(t: number, end: number, depth: number, step: number): void {
    const g = this.gate.gain;
    const floor = lerp(0.35, 0, depth);
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    for (let s = t; s < end - 0.001; s += step) {
      const off = s + step * 0.55;
      g.setValueAtTime(1, off);
      g.linearRampToValueAtTime(floor, off + FADE);
      g.setValueAtTime(floor, Math.min(end, s + step) - FADE);
      g.linearRampToValueAtTime(1, Math.min(end, s + step));
    }
  }

  /** Metallic sidebands, the carrier rising as it plays. */
  private ring(t: number, end: number, depth: number): void {
    const from = expLerp(80, 600, depth);
    const f = this.ringOsc.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(from, t);
    f.exponentialRampToValueAtTime(from * 1.6, end);
    this.takeOver(this.ringOut.gain, t, end, 0.25);
  }

  /** Fades `wet` in and the dry mix down to `dryLevel` from `t` to `end`. */
  private takeOver(wet: AudioParam, t: number, end: number, dryLevel: number): void {
    hold(wet, t, end, 1);
    const dry = this.duck.gain;
    dry.cancelScheduledValues(t);
    dry.setValueAtTime(1, t);
    dry.linearRampToValueAtTime(dryLevel, t + FADE);
    dry.setValueAtTime(dryLevel, end - FADE);
    dry.linearRampToValueAtTime(1, end);
  }
}

function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Holds `param` at `value` from `t` to `end`, with fades in and out. */
function hold(
  param: AudioParam,
  t: number,
  end: number,
  value: number,
  fadeIn = FADE,
  fadeOut = FADE,
): void {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(value, t + fadeIn);
  param.setValueAtTime(value, Math.max(t + fadeIn, end - FADE));
  param.linearRampToValueAtTime(0, Math.max(t + fadeIn, end - FADE) + fadeOut);
}

/** Opens `param` to `value` between `t` and `end`, fading the edges so a loop has no seams. */
function pulse(param: AudioParam, t: number, end: number, value: number): void {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(value, t + FADE);
  param.setValueAtTime(value, end - FADE);
  param.linearRampToValueAtTime(0, end);
}

/** A transfer curve that keeps `bits` bits. */
export function crushCurve(bits: number): Float32Array<ArrayBuffer> {
  const n = 4096;
  const levels = 2 ** bits / 2;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}
