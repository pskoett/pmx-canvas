/**
 * Empty board (rail-chrome-v2 phase 7, design item 11): centered onboarding
 * with the ghost mark, a 2×2 grid of starter actions, and the shortcut hint.
 * Every action is real: New note creates the same blank note as M, Drop files
 * opens a picker onto the viewport's import path, Paste a link asks for a URL,
 * Start agent session attaches a browser-keyed session. Tokens only, so it
 * reads the same in dark and light.
 */
export declare function EmptyState({ onOpenPalette }: {
    onOpenPalette: () => void;
}): import("preact/src").JSX.Element;
