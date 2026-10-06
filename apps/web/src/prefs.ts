import type { InputMap } from '@sensinth/core';

/** Per-device preferences. Storage can be unavailable, so every access is guarded. */
export interface Prefs {
  bpm?: number;
  styleId?: string;
  /** Which sensor sources were on, by source id. */
  sources?: Record<string, boolean>;
  /** Deterministic mode, and its settings. */
  deterministic?: boolean;
  seed?: number;
  loopBars?: number;
  repeat?: string;
  sensors?: string;
  /** False keeps the seed's instruments. */
  instruments?: boolean;
  /** Your own effect and repeat per input, by row id. */
  inputMap?: InputMap;
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
