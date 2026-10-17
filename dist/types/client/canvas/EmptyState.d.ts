/**
 * Empty board (rail-chrome-v2 phase 7, design item 11): centered onboarding
 * with direct starter actions and a separate way to start with your agent.
 * Every action is real: Start a note creates the same blank note as M, Drop files
 * opens a picker onto the viewport's import path, Paste a link asks for a URL,
 * and the optional Start agent session attaches a browser-keyed session.
 * Agent guidance stays visible independently of the session beta.
 */
export declare function EmptyState({ onOpenPalette }: {
    onOpenPalette: () => void;
}): import("preact/src").JSX.Element;
