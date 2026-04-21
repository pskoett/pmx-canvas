import type { RefObject } from 'preact';
/** Floating selection toolbar for a contentEditable host. Mounts once; while
 *  visible, positions itself above the current selection's viewport rect. */
export declare function InlineFormatBar({ hostRef, onChange, }: {
    hostRef: RefObject<HTMLElement>;
    onChange: () => void;
}): import("preact").JSX.Element | null;
