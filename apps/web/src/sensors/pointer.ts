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
const FORCE: SensorDescriptor = {
  id: 'computer.force',
  kind: 'pointer.force',
  label: 'Press force',
  range: [0, 1],
  rateHz: 30,
  source: 'computer',
};
const CHANNELS = [SPEED, POINTER_X, POINTER_Y, FORCE];

/** Safari's Force Touch event: 1 at a click, 2 at a deep (force) click, up to 3. */
type ForceEvent = MouseEvent & { webkitForce?: number };

/**
 * A laptop has no motion sensor, so the trackpad or mouse stands in:
 * pointer speed (and scrolling) drives energy, its height the melody's
 * register, left–right the timbre, and how hard you press (Force Touch in
 * Safari and the Mac app, pens elsewhere) raises accents. The keyboard is a
 * source of its own.
 */
export class PointerSource implements WebSensorSource {
  readonly id = 'pointer';
  readonly label = 'Pointer';
  readonly description = 'Trackpad or mouse: movement, position, scrolling and press force';
  private distance = 0;
  private x = 0.5;
  private y = 0.5;
  private lastPos: { x: number; y: number } | undefined;
  private force = 0;
  private forceTouch = false;
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
  private readonly onPress = (e: PointerEvent) => {
    // Force Touch reports through its own event; elsewhere a mouse button reads 0.5.
    if (!this.forceTouch) this.force = e.buttons ? e.pressure : 0;
  };
  private readonly onRelease = () => {
    this.force = 0;
  };
  private readonly onForce = (e: Event) => {
    this.forceTouch = true;
    this.force = Math.min(1, Math.max(0, ((e as ForceEvent).webkitForce ?? 0) / 3));
  };
  private readonly onWheel = (e: WheelEvent) => {
    this.distance += Math.min(400, Math.hypot(e.deltaX, e.deltaY));
  };

  unsupportedReason(): string | undefined {
    return 'PointerEvent' in window ? undefined : 'This browser has no pointer events.';
  }

  async start(hub: SensorHub): Promise<void> {
    for (const d of CHANNELS) hub.announce(d);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerdown', this.onPress, { passive: true });
    window.addEventListener('pointermove', this.onPress, { passive: true });
    window.addEventListener('pointerup', this.onRelease, { passive: true });
    window.addEventListener('webkitmouseforcechanged', this.onForce);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    this.lastTick = nowSeconds();
    this.timer = setInterval(() => {
      const t = nowSeconds();
      const dt = Math.max(0.001, t - this.lastTick);
      this.lastTick = t;
      hub.push({ id: SPEED.id, t, v: this.distance / dt });
      hub.push({ id: POINTER_X.id, t, v: this.x });
      hub.push({ id: POINTER_Y.id, t, v: this.y });
      hub.push({ id: FORCE.id, t, v: this.force });
      this.distance = 0;
    }, 33);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerdown', this.onPress);
    window.removeEventListener('pointermove', this.onPress);
    window.removeEventListener('pointerup', this.onRelease);
    window.removeEventListener('webkitmouseforcechanged', this.onForce);
    window.removeEventListener('wheel', this.onWheel);
    for (const d of CHANNELS) hub.remove(d.id);
  }
}
