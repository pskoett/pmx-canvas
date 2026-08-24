export const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

/** Platform-idiomatic modifier chord label: `modChord('K')` → "⌘K" on Mac, "Ctrl+K" elsewhere. */
export function modChord(key: string): string {
  return isMac ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`;
}
