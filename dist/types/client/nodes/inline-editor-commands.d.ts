/** Prompt for a URL and insert it as a link on the current selection.
 *  Rejects `javascript:` and `data:` schemes so a link can't execute script
 *  when clicked. Uses the in-canvas prompt (`window.prompt` is a silent no-op
 *  in embedded panes); the selection is saved before the dialog takes focus
 *  and restored before inserting. */
export declare function promptAndInsertLink(): void;
/** Wrap the current non-empty selection in an inline `<code>` element and
 *  place the caret immediately after the new element. No-op on collapsed
 *  selections. */
export declare function wrapSelectionInCode(): void;
