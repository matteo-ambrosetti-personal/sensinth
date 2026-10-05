import { midiToFreq, type NoteEvent, type Patch, type TrackParams } from '@sensinth/core';
import { applyEnvelope } from '../envelope';
import { shapeEnvelope } from '../params';
import type { Instrument } from './types';
import { addTremolo, connectDetune, VoiceLimiter } from './voice';

type OrganPatch = Extract<Patch, { type: 'organ' }>;

/**
 * Harmonics of the nine drawbars (16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1'),
 * counted from the sub-octave: the oscillator runs an octave below the note
 * so the 16' bar fits in one periodic wave.
 */
const DRAWBAR_HARMONICS = [1, 3, 2, 4, 6, 8, 10, 12, 16];

/**
 * Additive tonewheel-style organ. `timbre` brings in the upper drawbars and
 * speeds up the Leslie-like tremolo.
 */
export class OrganInstrument implements Instrument {
  readonly output: GainNode;
  private readonly limiter = new VoiceLimiter(10);
  private readonly waves = new Map<number, PeriodicWave>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly patch: OrganPatch,
    private readonly detuneMod?: AudioNode,
  ) {
    this.output = ctx.createGain();
  }

  play(ev: NoteEvent, time: number, duration: number, params: Readonly<TrackParams>): void {
    if (ev.midi === undefined) return;
    const { ctx, patch } = this;
    const gate = Math.max(0.02, duration * (patch.gate ?? 0.95));
    const vca = ctx.createGain();
    vca.gain.value = 0;
    const end = applyEnvelope(vca.gain, time, gate, shapeEnvelope(patch.env, params), ev.vel);

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave(params.timbre));
    osc.frequency.setValueAtTime(midiToFreq(ev.midi) / 2, time);
    connectDetune(osc, this.detuneMod);
    osc.connect(vca);
    if (patch.tremolo) {
      const tremolo = { ...patch.tremolo, rate: patch.tremolo.rate * (0.6 + 1.2 * params.timbre) };
      addTremolo(ctx, vca, this.output, tremolo, time, end);
    } else {
      vca.connect(this.output);
    }
    osc.start(time);
    osc.stop(end);
    this.limiter.track(vca, time, end);
  }

  /** The drawbar mix as a periodic wave, cached per (quantized) timbre. */
  private wave(timbre: number): PeriodicWave {
    const key = Math.round(Math.max(0, Math.min(1, timbre)) * 8);
    let wave = this.waves.get(key);
    if (!wave) {
      const size = Math.max(...DRAWBAR_HARMONICS) + 1;
      const real = new Float32Array(size);
      const imag = new Float32Array(size);
      this.patch.drawbars.forEach((level, i) => {
        const h = DRAWBAR_HARMONICS[i];
        if (h === undefined) return;
        // Upper drawbars (from 2⅔' on) fade in with timbre.
        const lift = i >= 4 ? 0.3 + 0.7 * (key / 8) : 1;
        imag[h] = (imag[h] ?? 0) + Math.max(0, level) * lift;
      });
      wave = this.ctx.createPeriodicWave(real, imag);
      this.waves.set(key, wave);
    }
    return wave;
  }
}
