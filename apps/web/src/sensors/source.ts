import type { SensorHub } from '@sensinth/core';

/** A browser-side producer of sensor channels (phone hardware, simulator, replay, …). */
export interface WebSensorSource {
  readonly id: string;
  readonly label: string;
  /** What it reads, in a few words. */
  readonly description: string;
  /** Permission checked before restoring the source on page load without a tap. */
  readonly permission?: PermissionName;
  /** Why the source cannot run here, or undefined when it can. */
  unsupportedReason(): string | undefined;
  /** Announces channels on the hub and starts pushing samples. Throws `SourceError` on failure. */
  start(hub: SensorHub): Promise<void>;
  /** Stops sampling and removes its channels from the hub. */
  stop(hub: SensorHub): void;
  /** Optional element to show while running (e.g. a camera thumbnail). */
  readonly preview?: HTMLElement;
  /** Where to go when the source is unavailable here, e.g. the Mac app's download. */
  helpLink?(): { href: string; label: string } | undefined;
}

/** A failure with a message written for the user. */
export class SourceError extends Error {}

/** Seconds on the clock every web source stamps samples with. */
export function nowSeconds(): number {
  return performance.now() / 1000;
}

/** Turns getUserMedia / sensor errors into a sentence for the user. */
export function describeMediaError(err: unknown, what: string): SourceError {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new SourceError(`${what} access is blocked. Allow it in the browser's site settings.`);
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new SourceError(`No ${what.toLowerCase()} found on this device.`);
  }
  if (name === 'NotReadableError') {
    return new SourceError(`The ${what.toLowerCase()} is in use by another app.`);
  }
  return new SourceError(`${what} could not start: ${(err as Error)?.message ?? String(err)}`);
}

/** True when a permission is already granted, so starting will not show a prompt. */
export async function permissionGranted(name: PermissionName): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name });
    return status.state === 'granted';
  } catch {
    return false;
  }
}
