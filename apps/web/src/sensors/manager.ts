import type { SensorHub } from '@sensinth/core';
import { permissionGranted, SourceError, type WebSensorSource } from './source';

export type SourceStatus = 'off' | 'starting' | 'on' | 'error' | 'unsupported';

export interface SourceState {
  status: SourceStatus;
  /** Shown under the source name: an error, a hint, or why it is unavailable. */
  message?: string;
}

/** Turns sources on and off, and keeps a user-readable status for each. */
export class SourceManager {
  readonly sources: WebSensorSource[] = [];
  private readonly states = new Map<string, SourceState>();
  /** Called whenever a source is added, removed or changes state. */
  onChange: () => void = () => {};

  constructor(
    private readonly hub: SensorHub,
    sources: readonly WebSensorSource[],
  ) {
    for (const s of sources) this.add(s);
  }

  add(source: WebSensorSource): void {
    this.remove(source.id);
    this.sources.push(source);
    const reason = source.unsupportedReason();
    this.states.set(
      source.id,
      reason ? { status: 'unsupported', message: reason } : { status: 'off' },
    );
    this.onChange();
  }

  remove(id: string): void {
    const i = this.sources.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.disable(id);
    this.sources.splice(i, 1);
    this.states.delete(id);
    this.onChange();
  }

  get(id: string): WebSensorSource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  state(id: string): SourceState {
    return this.states.get(id) ?? { status: 'off' };
  }

  isOn(id: string): boolean {
    const s = this.state(id).status;
    return s === 'on' || s === 'starting';
  }

  /** Starts a source. Call from a tap when it may show a permission prompt. */
  async enable(id: string): Promise<boolean> {
    const source = this.get(id);
    if (!source || this.isOn(id) || this.state(id).status === 'unsupported') return false;
    this.set(id, { status: 'starting', message: 'Starting…' });
    try {
      await source.start(groupedHub(this.hub, id));
      if (this.state(id).status !== 'starting') {
        // Turned off while starting.
        source.stop(this.hub);
        return false;
      }
      this.set(id, { status: 'on' });
      return true;
    } catch (err) {
      source.stop(this.hub);
      const message =
        err instanceof SourceError
          ? err.message
          : `Could not start: ${(err as Error)?.message ?? err}`;
      this.set(id, { status: 'error', message });
      return false;
    }
  }

  /**
   * Restores a source on page load, without a tap. Sources that would show
   * a permission prompt stay off until the user taps them.
   */
  async restore(id: string): Promise<void> {
    const source = this.get(id);
    if (!source) return;
    if (source.permission && !(await permissionGranted(source.permission))) {
      this.set(id, { status: 'off', message: 'Tap to turn on (asks for permission).' });
      return;
    }
    await this.enable(id);
  }

  disable(id: string): void {
    const source = this.get(id);
    if (!source) return;
    const status = this.state(id).status;
    if (status === 'on' || status === 'starting') source.stop(this.hub);
    if (status !== 'unsupported') this.set(id, { status: 'off' });
  }

  private set(id: string, state: SourceState): void {
    this.states.set(id, state);
    this.onChange();
  }
}

/**
 * The hub as a source sees it: every channel it announces is marked as
 * coming from that source (unless it says otherwise, like a replay of a
 * recording), so the music can share out what each source controls.
 */
function groupedHub(hub: SensorHub, group: string): SensorHub {
  return new Proxy(hub, {
    get(target, prop) {
      if (prop === 'announce') {
        return (desc: Parameters<SensorHub['announce']>[0]) =>
          target.announce({ ...desc, group: desc.group ?? group });
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
