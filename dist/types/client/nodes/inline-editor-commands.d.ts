/** Shared contentEditable command helpers used by both the inline editor
 *  and its floating toolbar. Kept in a module that neither component
 *  depends on transitively so we don't get a circular import. */
/** Prompt for a URL and insert it as a link on the current selection.
 *  Rejects `javascript:` and `data:` schemes so a link can't execute script
 *  when clicked. */
export declare function promptAndInsertLink(): void;
/** Wrap the current non-empty selection in an inline `<code>` element and
 *  place the caret immediately after the new element. No-op on collapsed
 *  selections. */
export declare function wrapSelectionInCode(): void;
