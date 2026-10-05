import { ReplaySource, type SensorHub, type SensorRecording } from '@sensinth/core';
import { nowSeconds, type WebSensorSource } from './source';

/** Plays a recorded sensor session back in real time, looping. */
export class ReplayWebSource implements WebSensorSource {
  readonly id = 'replay';
  readonly label: string;
  readonly description: string;
  private replay: ReplaySource | undefined;
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
    const replay = new ReplaySource(this.recording);
    this.replay = replay;
    for (const d of replay.descriptors) hub.announce(d);
    const origin = nowSeconds();
    this.timer = setInterval(
      () => hub.pushAll(replay.samplesUntil(nowSeconds() - origin, origin)),
      33,
    );
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const d of this.replay?.descriptors ?? []) hub.remove(d.id);
    this.replay = undefined;
  }
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
