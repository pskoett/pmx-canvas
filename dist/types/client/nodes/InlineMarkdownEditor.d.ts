/** Fully inline WYSIWYG editor. The rendered HTML is the editor.
 *
 *  Two persistence signals:
 *  - `onChange(md)` — fires on every input. Caller typically debounces.
 *  - `onSave(md)`  — fires on ⌘S and blur. Caller should persist immediately
 *    and cancel any pending debounced save, since `md` is the authoritative
 *    latest content. Both receive freshly-serialized markdown so the caller
 *    never reads a stale state snapshot. */
export declare function InlineMarkdownEditor({ initialHtml, className, onChange, onSave, }: {
    initialHtml: string;
    className?: string;
    onChange: (markdown: string) => void;
    onSave?: (markdown: string) => void;
}): import("preact/src").JSX.Element;
