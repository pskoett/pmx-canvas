import type { ComponentChildren } from 'preact';
/** Shared docking only. Map and Graph own their selection and actions. */
export declare function MemoryInspector({ children, initiallyCollapsed, reveal, }: {
    children: ComponentChildren;
    initiallyCollapsed?: boolean;
    reveal?: number;
}): import("preact").JSX.Element;
