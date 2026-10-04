import { chiptune } from './chiptune';
import type { Style } from './schema';

/** Every built-in style, in display order. */
export const STYLES: readonly Style[] = [chiptune];

export function getStyle(id: string): Style | undefined {
  return STYLES.find((s) => s.id === id);
}

export { chiptune };
