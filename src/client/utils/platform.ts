export const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? '\u2318' : 'Ctrl';
