import type { Vibrato } from '@sensinth/core';

const MAX_VOICES = 8;

/**
 * Connects a shared modulation source (the tape-wobble LFO) to a voice's
 * detune, and disconnects it when the voice ends so stopped voices can be
 * garbage-collected.
 */
export function connectDetune(osc: OscillatorNode, mod: AudioNode | undefined): void {
  if (!mod) return;
  mod.connect(osc.detune);
  osc.addEventListener('ended', () => {
    try {
      mod.disconnect(osc.detune);
    } catch {
      // Already disconnected.
    }
  });
}

/** Delayed vibrato on an oscillator's detune. */
export function addVibrato(
  ctx: BaseAudioContext,
  osc: OscillatorNode,
  vibrato: Vibrato | undefined,
  time: number,
  gate: number,
  end: number,
): void {
  if (!vibrato || gate <= vibrato.delay) return;
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.value = vibrato.rate;
  depth.gain.setValueAtTime(0, time);
  depth.gain.setValueAtTime(0, time + vibrato.delay);
  depth.gain.linearRampToValueAtTime(vibrato.depth, time + vibrato.delay + 0.2);
  lfo.connect(depth).connect(osc.detune);
  lfo.start(time);
  lfo.stop(end);
}

/** Caps polyphony per instrument by quickly fading the oldest voice still sounding. */
export class VoiceLimiter {
  private voices: { gain: GainNode; end: number }[] = [];

  constructor(private readonly max = MAX_VOICES) {}

  track(gain: GainNode, time: number, end: number): void {
    this.voices = this.voices.filter((v) => v.end > time);
    this.voices.push({ gain, end });
    if (this.voices.length > this.max) {
      const oldest = this.voices.shift();
      oldest?.gain.gain.setTargetAtTime(0, time, 0.005);
    }
  }
}
