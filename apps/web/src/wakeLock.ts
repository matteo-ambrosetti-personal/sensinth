/** Keeps the screen on while playing (sensors and audio pause when it sleeps). */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | undefined;
  private wanted = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') void this.acquire();
    });
  }

  async enable(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = undefined;
    await s?.release().catch(() => {});
  }

  private async acquire(): Promise<void> {
    if (!('wakeLock' in navigator) || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => (this.sentinel = undefined));
    } catch {
      // Denied (battery saver, unsupported). Playback continues without it.
    }
  }
}
