import { rmsDb, spectralCentroid, type SensorDescriptor, type SensorHub } from '@sensinth/core';
import { describeMediaError, nowSeconds, type WebSensorSource } from './source';

const LEVEL: SensorDescriptor = {
  id: 'phone.sound',
  kind: 'sound.level',
  label: 'Sound',
  unit: 'dB',
  minSpan: 12,
  rateHz: 30,
  source: 'phone',
};
const BRIGHTNESS: SensorDescriptor = {
  id: 'phone.soundColor',
  kind: 'sound.brightness',
  label: 'Sound brightness',
  unit: 'Hz',
  minSpan: 400,
  rateHz: 30,
  source: 'phone',
};

/**
 * Microphone loudness (and its onsets: claps, knocks) plus spectral
 * brightness. Echo cancellation is requested so the phone hears less of its
 * own music; headphones work best.
 */
export class MicrophoneSource implements WebSensorSource {
  readonly id = 'mic';
  readonly label = 'Microphone';
  readonly description = 'Loudness, claps and brightness of sound';
  readonly permission = 'microphone' as PermissionName;
  private stream: MediaStream | undefined;
  private ctx: AudioContext | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private resumeOnTap: (() => void) | undefined;

  unsupportedReason(): string | undefined {
    return 'mediaDevices' in navigator
      ? undefined
      : 'Microphone access needs a secure (HTTPS) page.';
  }

  async start(hub: SensorHub): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      throw describeMediaError(err, 'Microphone');
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(this.stream).connect(analyser);
    if (ctx.state === 'suspended') {
      // Restored on page load without a tap: audio starts on the first touch.
      this.resumeOnTap = () => void ctx.resume();
      document.addEventListener('pointerdown', this.resumeOnTap, { once: true });
      void ctx.resume();
    }

    hub.announce(LEVEL);
    hub.announce(BRIGHTNESS);
    const time = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    const freq = new Float32Array(new ArrayBuffer(analyser.frequencyBinCount * 4));
    this.timer = setInterval(() => {
      if (ctx.state !== 'running') return;
      const t = nowSeconds();
      analyser.getFloatTimeDomainData(time);
      analyser.getFloatFrequencyData(freq);
      const level = rmsDb(time);
      hub.push({ id: LEVEL.id, t, v: level });
      if (level > -70)
        hub.push({ id: BRIGHTNESS.id, t, v: spectralCentroid(freq, ctx.sampleRate) });
    }, 33);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    if (this.resumeOnTap) document.removeEventListener('pointerdown', this.resumeOnTap);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
    hub.remove(LEVEL.id);
    hub.remove(BRIGHTNESS.id);
  }
}
