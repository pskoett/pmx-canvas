import type { AnnotationTool } from '../types';
/** Prompt-driven creates for node kinds that need a source (url / path). */
export declare function promptedCreate(kind: 'image' | 'file' | 'webpage'): void;
/**
 * The persistent 52px left tool rail (rail-chrome-v2 phase 1): brand → tools →
 * node palette → utilities. Every button's `title` carries its shortcut — the
 * rail is the shortcut discovery surface.
 */
export declare function ToolRail({ minimapVisible, onToggleMinimap, snapshotOpen, onToggleSnapshot, snapshotBtnRef, onOpenPalette, onOpenShortcuts, annotationTool, onSetAnnotationTool, }: {
    minimapVisible: boolean;
    onToggleMinimap: () => void;
    snapshotOpen: boolean;
    onToggleSnapshot: () => void;
    snapshotBtnRef: {
        current: HTMLButtonElement | null;
    };
    onOpenPalette: () => void;
    onOpenShortcuts: () => void;
    annotationTool: AnnotationTool;
    onSetAnnotationTool: (tool: AnnotationTool) => void;
}): import("preact/src").JSX.Element;
