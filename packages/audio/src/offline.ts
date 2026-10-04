import { Engine, SimulatedSource, STEPS_PER_BAR, stepDuration, type Style } from '@sensinth/core';
import { Renderer } from './renderer';

export interface OfflineRenderOptions {
  style: Style;
  bars: number;
  bpm?: number;
  seed?: number;
  sensorSeed?: number;
  sampleRate?: number;
}

export interface RenderStats {
  seconds: number;
  /** Absolute peak sample, 1.0 = 0 dBFS. */
  peak: number;
  rms: number;
  /** Count of NaN or infinite samples. */
  nonFinite: number;
  events: number;
}

/**
 * Renders a piece faster than real time with simulated sensors. Used by the
 * CI audio test and handy for exporting clips.
 */
export async function renderOffline(
  opts: OfflineRenderOptions,
): Promise<{ buffer: AudioBuffer; stats: RenderStats }> {
  const { style, bars } = opts;
  const bpm = opts.bpm ?? style.defaultTempo;
  const sampleRate = opts.sampleRate ?? 44100;
  const stepSeconds = stepDuration(bpm);
  const steps = bars * STEPS_PER_BAR;
  const start = 0.05;
  const seconds = start + steps * stepSeconds + 2.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);

  const engine = new Engine({ style, seed: opts.seed ?? 1 });
  const sim = new SimulatedSource(opts.sensorSeed ?? 7);
  for (const d of sim.descriptors) engine.hub.announce(d);
  const renderer = new Renderer(ctx, style);
  renderer.setTempo(bpm);

  let events = 0;
  for (let step = 0; step < steps; step++) {
    const t = start + step * stepSeconds;
    engine.hub.pushAll(sim.sampleAt(t));
    const evs = engine.tick(stepSeconds);
    events += evs.length;
    renderer.update(engine.router.macros, t);
    renderer.schedule(evs, t, stepSeconds);
  }
  const buffer = await ctx.startRendering();
  return { buffer, stats: { ...analyze(buffer), events } };
}

export function analyze(buffer: AudioBuffer): Omit<RenderStats, 'events'> {
  let peak = 0;
  let sumSq = 0;
  let nonFinite = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const x = data[i] as number;
      if (!Number.isFinite(x)) {
        nonFinite++;
        continue;
      }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      sumSq += x * x;
      count++;
    }
  }
  return { seconds: buffer.duration, peak, rms: Math.sqrt(sumSq / Math.max(1, count)), nonFinite };
}

/** 16-bit PCM WAV encoding of an AudioBuffer. */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const x = Math.max(-1, Math.min(1, (data[ch] as Float32Array)[i] as number));
      view.setInt16(offset, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      offset += 2;
    }
  }
  return view.buffer;
}
