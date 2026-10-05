import { ReplaySource, type SensorHub, type SensorRecording } from '@sensinth/core';
import { nowSeconds, type WebSensorSource } from './source';

/** Plays a recorded sensor session back in real time, looping: readings and presses. */
export class ReplayWebSource implements WebSensorSource {
  readonly id = 'replay';
  readonly label: string;
  readonly description: string;
  private replay: ReplaySource | undefined;
  private hub: SensorHub | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly recording: SensorRecording,
    fileName: string,
  ) {
    this.label = `Replay: ${fileName}`;
    const seconds = recording.samples.at(-1)?.[0] ?? 0;
    this.description = `${recording.descriptors.length} channels, ${formatDuration(seconds)}, looping`;
  }

  unsupportedReason(): string | undefined {
    return undefined;
  }

  async start(hub: SensorHub): Promise<void> {
    this.hub = hub;
    this.play(nowSeconds());
  }

  /**
   * Starts the recording over at `origin` (sensor clock), as if it had just
   * been switched on: deterministic mode replays it from Play, so a
   * recording always gives the same piece.
   */
  rewind(origin: number): void {
    if (!this.hub) return;
    this.halt();
    this.play(origin);
  }

  stop(hub: SensorHub): void {
    this.hub ??= hub;
    this.halt();
    this.hub = undefined;
  }

  private play(origin: number): void {
    const hub = this.hub;
    if (!hub) return;
    const replay = new ReplaySource(this.recording);
    this.replay = replay;
    for (const d of replay.descriptors) hub.announce(d);
    this.timer = setInterval(() => {
      const elapsed = nowSeconds() - origin;
      if (elapsed < 0) return;
      hub.pushAll(replay.samplesUntil(elapsed, origin));
      for (const e of replay.eventsUntil(elapsed, origin)) hub.emit(e);
    }, 33);
  }

  private halt(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const d of this.replay?.descriptors ?? []) this.hub?.remove(d.id);
    this.replay = undefined;
  }
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
