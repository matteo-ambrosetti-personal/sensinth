import {
  clamp,
  expLerp,
  midiToFreq,
  type NoteEvent,
  type Patch,
  type TrackParams,
} from '@sensinth/core';
import { applyEnvelope } from '../envelope';
import { octaves, shapeEnvelope } from '../params';
import type { WaveTable } from '../waves';
import type { Instrument } from './types';
import { addVibrato, connectDetune, VoiceLimiter } from './voice';

type TonalPatch = Extract<Patch, { type: 'pulse' | 'osc' }>;

/**
 * Pulse and basic-oscillator voices with ADSR, optional detune and delayed
 * vibrato. `timbre` picks the pulse width or widens the detune. Optional:
 * - a per-note resonant low-pass with its own envelope, opened further by
 *   accents (loud notes): the acid squelch;
 * - glide: a note marked `slide` bends from the previous note;
 * - a pitch envelope: each note drops into place (808s).
 */
export class TonalInstrument implements Instrument {
  readonly output: GainNode;
  private readonly limiter = new VoiceLimiter();
  private lastFreq: number | undefined;
  private lastEnd = -Infinity;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly patch: TonalPatch,
    private readonly waves: WaveTable,
    private readonly detuneMod?: AudioNode,
  ) {
    this.output = ctx.createGain();
  }

  play(ev: NoteEvent, time: number, duration: number, params: Readonly<TrackParams>): void {
    if (ev.midi === undefined) return;
    const { ctx, patch } = this;
    const gate = Math.max(0.01, duration * (patch.gate ?? 0.9));
    const vca = ctx.createGain();
    vca.gain.value = 0;
    vca.connect(this.output);
    const end = applyEnvelope(vca.gain, time, gate, shapeEnvelope(patch.env, params), ev.vel);

    // Per-note filter with an envelope; accents open it further.
    let input: AudioNode = vca;
    if (patch.filter) {
      const f = patch.filter;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = f.q;
      const base = expLerp(f.range[0], f.range[1], clamp(params.timbre * 0.7));
      const accent = ev.vel > 0.85 ? 1.6 : 1;
      const peak = expLerp(base, f.range[1], clamp(f.env * accent));
      filter.frequency.setValueAtTime(peak, time);
      filter.frequency.setTargetAtTime(
        base,
        time + 0.004,
        (f.decay * octaves(params.decay, 2)) / 3,
      );
      filter.connect(vca);
      input = filter;
    }

    const detune = patch.type === 'osc' ? (patch.detune ?? 0) * (0.25 + 1.5 * params.timbre) : 0;
    const spread = detune > 0 ? [-detune / 2, detune / 2] : [0];
    const freq = midiToFreq(ev.midi);
    const from =
      patch.glide && ev.slide && this.lastFreq !== undefined && time <= this.lastEnd + 0.05
        ? this.lastFreq
        : undefined;
    this.lastFreq = freq;
    this.lastEnd = time + gate;
    for (const cents of spread) {
      const osc = ctx.createOscillator();
      if (patch.type === 'pulse') {
        const duties = patch.duty;
        const idx = Math.min(duties.length - 1, Math.floor(params.timbre * duties.length));
        osc.setPeriodicWave(this.waves.pulse(duties[idx] ?? 0.5));
      } else {
        osc.type = patch.wave;
      }
      if (from !== undefined && patch.glide) {
        osc.frequency.setValueAtTime(from, time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + Math.max(0.005, patch.glide.time));
      } else if (patch.type === 'osc' && patch.pitchEnv) {
        const { semitones, time: fall } = patch.pitchEnv;
        osc.frequency.setValueAtTime(freq * Math.pow(2, semitones / 12), time);
        osc.frequency.exponentialRampToValueAtTime(freq, time + Math.max(0.005, fall));
      } else {
        osc.frequency.setValueAtTime(freq, time);
      }
      osc.detune.setValueAtTime(cents, time);
      addVibrato(ctx, osc, patch.vibrato, time, gate, end);
      connectDetune(osc, this.detuneMod);
      osc.connect(input);
      osc.start(time);
      osc.stop(end);
    }
    this.limiter.track(vca, time, end);
  }
}
