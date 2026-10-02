import DOMPurify from 'dompurify';

/** Sanitize rendered Markdown before it enters the privileged workbench DOM. */
export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // Markdown does not need these active document surfaces. Keep regular
    // inputs so marked's GFM task checkboxes remain interactive.
    FORBID_TAGS: ['form', 'svg', 'math'],
  });
}
