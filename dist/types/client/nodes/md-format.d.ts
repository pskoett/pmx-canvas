/**
 * Markdown formatting helpers for textarea elements.
 * Handles: wrap-style formatting (bold, italic, code, strikethrough),
 * prefix-style formatting (headings, lists, quotes),
 * Tab/Shift+Tab indentation, and floating toolbar positioning.
 */
export interface FormatAction {
    key: string;
    label: string;
    icon: string;
    shortcut?: string;
    action: (ta: HTMLTextAreaElement) => void;
}
/** Handle Tab/Shift+Tab for indentation on current line(s). */
export declare function handleTab(ta: HTMLTextAreaElement, shiftKey: boolean): void;
/** Format actions available in the toolbar. */
export declare const FORMAT_ACTIONS: FormatAction[];
/** Handle Cmd/Ctrl+key formatting shortcuts in a textarea. Returns true if handled. */
export declare function handleFormatShortcut(e: KeyboardEvent, ta: HTMLTextAreaElement): boolean;
/** Get the screen rect of the current text selection for positioning a floating toolbar. */
export declare function getSelectionRect(ta: HTMLTextAreaElement): {
    top: number;
    left: number;
    width: number;
} | null;
