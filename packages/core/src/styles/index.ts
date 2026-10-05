import { ambient } from './ambient';
import { chiptune } from './chiptune';
import { lofi } from './lofi';
import type { Style } from './schema';

/** Every built-in style, in display order. */
export const STYLES: readonly Style[] = [chiptune, ambient, lofi];

export function getStyle(id: string): Style | undefined {
  return STYLES.find((s) => s.id === id);
}

export { ambient, chiptune, lofi };
