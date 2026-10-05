import { FrameAnalyzer, type SensorDescriptor, type SensorHub } from '@sensinth/core';
import { describeMediaError, nowSeconds, type WebSensorSource } from './source';

const LUMA: SensorDescriptor = {
  id: 'phone.luma',
  kind: 'camera.luma',
  label: 'Camera brightness',
  range: [0, 1],
  adaptive: true,
  minSpan: 0.15,
  rateHz: 12,
  source: 'phone',
};
const HUE: SensorDescriptor = {
  id: 'phone.hue',
  kind: 'camera.hue',
  label: 'Camera color',
  range: [0, 1],
  circular: true,
  rateHz: 12,
  source: 'phone',
};
const MOTION: SensorDescriptor = {
  id: 'phone.camMotion',
  kind: 'camera.motion',
  label: 'Camera movement',
  minSpan: 0.03,
  rateHz: 12,
  source: 'phone',
};

const W = 32;
const H = 24;

/**
 * The rear camera, reduced to a 32×24 thumbnail a dozen times a second:
 * brightness (stands in for the light sensor browsers hide), dominant color
 * and movement. Frames never leave the phone.
 */
export class CameraSource implements WebSensorSource {
  readonly id = 'camera';
  readonly label = 'Camera';
  readonly description = 'Brightness, color and movement';
  readonly permission = 'camera' as PermissionName;
  readonly preview: HTMLVideoElement;
  private stream: MediaStream | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly canvas = document.createElement('canvas');

  constructor() {
    this.preview = document.createElement('video');
    this.preview.className = 'cam-preview';
    this.preview.muted = true;
    this.preview.playsInline = true;
    this.preview.setAttribute('aria-label', 'Camera preview');
    this.canvas.width = W;
    this.canvas.height = H;
  }

  unsupportedReason(): string | undefined {
    return 'mediaDevices' in navigator ? undefined : 'Camera access needs a secure (HTTPS) page.';
  }

  async start(hub: SensorHub): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 160 },
          height: { ideal: 120 },
          frameRate: { ideal: 15 },
        },
        audio: false,
      });
    } catch (err) {
      throw describeMediaError(err, 'Camera');
    }
    this.preview.srcObject = this.stream;
    await this.preview.play().catch(() => {});

    const g = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw describeMediaError(new Error('no 2D canvas'), 'Camera');
    const analyzer = new FrameAnalyzer();
    for (const d of [LUMA, HUE, MOTION]) hub.announce(d);
    this.timer = setInterval(() => {
      if (this.preview.readyState < 2) return;
      g.drawImage(this.preview, 0, 0, W, H);
      const stats = analyzer.analyze(g.getImageData(0, 0, W, H).data, W, H);
      const t = nowSeconds();
      hub.push({ id: LUMA.id, t, v: stats.luma });
      hub.push({ id: HUE.id, t, v: stats.hue });
      hub.push({ id: MOTION.id, t, v: stats.motion });
    }, 83);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.preview.srcObject = null;
    for (const d of [LUMA, HUE, MOTION]) hub.remove(d.id);
  }
}
