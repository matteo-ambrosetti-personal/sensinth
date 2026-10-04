/** Per-device preferences. Storage can be unavailable, so every access is guarded. */
export interface Prefs {
  bpm?: number;
  styleId?: string;
  simulated?: boolean;
}

const KEY = 'sensinth.prefs.v1';

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not persisted; the app still works.
  }
}
