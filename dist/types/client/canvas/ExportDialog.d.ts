export declare const exportDialogOpen: import("@preact/signals-core").Signal<boolean>;
/**
 * Export the open board as one HTML file (plan 013). An export is a share, so
 * the dialog lists what goes into the file before it is written; file contents
 * stay out unless the owner ticks them in.
 */
export declare function ExportDialog(): import("preact/src").JSX.Element | null;
