import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** The Android app's background playback (android/…/PlaybackPlugin.java). */
export interface PlaybackPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'stopRequested', listener: () => void): Promise<PluginListenerHandle>;
}

const Playback = registerPlugin<PlaybackPlugin>('Playback');

/** Browser tests install a fake plugin here to check the calls without a phone. */
function stub(): PlaybackPlugin | undefined {
  return (window as Window & { sensinthPlaybackStub?: PlaybackPlugin }).sensinthPlaybackStub;
}

function plugin(): PlaybackPlugin | undefined {
  return stub() ?? (Capacitor.getPlatform() === 'android' ? Playback : undefined);
}

/**
 * Keeps the music going in the Android app with the screen off or another
 * app in front: a "Sensinth is playing" notification, with Stop, while it
 * plays. Browsers and the Mac app need nothing, so there it does nothing.
 */
export class BackgroundPlayback {
  /** Called when Stop is pressed in the notification. */
  onStopRequested: () => void = () => {};
  private listening = false;
  private on = false;

  enable(): void {
    const p = plugin();
    if (!p || this.on) return;
    this.on = true;
    if (!this.listening) {
      this.listening = true;
      void p.addListener('stopRequested', () => {
        this.on = false;
        this.onStopRequested();
      });
    }
    p.start().catch(() => {
      // Not allowed now: the music plays while the app is open.
      this.on = false;
    });
  }

  disable(): void {
    const p = plugin();
    if (!p || !this.on) return;
    this.on = false;
    void p.stop().catch(() => {});
  }
}
