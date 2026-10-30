/** Fully inline WYSIWYG editor. The rendered HTML is the editor.
 *
 *  Two persistence signals:
 *  - `onChange(md)` — fires on every input. Caller typically debounces.
 *  - `onSave(md)`  — fires on ⌘S and blur. Caller should persist dirty drafts immediately
 *    and cancel any pending debounced save, since `md` is the authoritative
 *    latest content: the exact caller draft until input, serialized DOM after it. */
export declare function InlineMarkdownEditor({ markdown, initialHtml, className, onChange, onSave, }: {
    markdown: string;
    initialHtml: string;
    className?: string;
    onChange: (markdown: string) => void;
    onSave?: (markdown: string) => void;
}): import("preact/src").JSX.Element;
