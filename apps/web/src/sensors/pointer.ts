import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { nowSeconds, type WebSensorSource } from './source';

const SPEED: SensorDescriptor = {
  id: 'computer.pointerSpeed',
  kind: 'pointer.speed',
  label: 'Pointer speed',
  unit: 'px/s',
  range: [0, 20000],
  adaptive: true,
  minSpan: 400,
  rateHz: 30,
  source: 'computer',
};
const POINTER_X: SensorDescriptor = {
  id: 'computer.pointerX',
  kind: 'pointer.x',
  label: 'Pointer left–right',
  range: [0, 1],
  rateHz: 30,
  source: 'computer',
};
const POINTER_Y: SensorDescriptor = {
  id: 'computer.pointerY',
  kind: 'pointer.y',
  label: 'Pointer height',
  range: [0, 1],
  rateHz: 30,
  source: 'computer',
};
const KEYS: SensorDescriptor = {
  id: 'computer.keys',
  kind: 'keys.rate',
  label: 'Typing',
  unit: 'keys/s',
  range: [0, 15],
  adaptive: true,
  minSpan: 3,
  rateHz: 30,
  source: 'computer',
};

/**
 * A laptop has no motion sensor, so the trackpad, mouse and keyboard stand
 * in: pointer speed (and scrolling) drives energy, its height the melody's
 * register, left–right the timbre, and typing raises accents.
 */
export class PointerSource implements WebSensorSource {
  readonly id = 'pointer';
  readonly label = 'Pointer & keys';
  readonly description = 'Trackpad, mouse, scrolling and typing';
  private distance = 0;
  private x = 0.5;
  private y = 0.5;
  private lastPos: { x: number; y: number } | undefined;
  private keyTimes: number[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = 0;

  private readonly onMove = (e: PointerEvent) => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    if (this.lastPos)
      this.distance += Math.hypot(e.clientX - this.lastPos.x, e.clientY - this.lastPos.y);
    this.lastPos = { x: e.clientX, y: e.clientY };
    this.x = Math.min(1, Math.max(0, e.clientX / w));
    this.y = Math.min(1, Math.max(0, 1 - e.clientY / h));
  };
  private readonly onWheel = (e: WheelEvent) => {
    this.distance += Math.min(400, Math.hypot(e.deltaX, e.deltaY));
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (!e.repeat) this.keyTimes.push(nowSeconds());
  };

  unsupportedReason(): string | undefined {
    return 'PointerEvent' in window ? undefined : 'This browser has no pointer events.';
  }

  async start(hub: SensorHub): Promise<void> {
    for (const d of [SPEED, POINTER_X, POINTER_Y, KEYS]) hub.announce(d);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('keydown', this.onKey);
    this.lastTick = nowSeconds();
    this.timer = setInterval(() => {
      const t = nowSeconds();
      const dt = Math.max(0.001, t - this.lastTick);
      this.lastTick = t;
      this.keyTimes = this.keyTimes.filter((k) => t - k < 1);
      hub.push({ id: SPEED.id, t, v: this.distance / dt });
      hub.push({ id: POINTER_X.id, t, v: this.x });
      hub.push({ id: POINTER_Y.id, t, v: this.y });
      hub.push({ id: KEYS.id, t, v: this.keyTimes.length });
      this.distance = 0;
    }, 33);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKey);
    for (const d of [SPEED, POINTER_X, POINTER_Y, KEYS]) hub.remove(d.id);
  }
}
