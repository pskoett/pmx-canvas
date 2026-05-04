import { useMemo } from 'preact/hooks';
import { getCanvasTokens } from '../theme/tokens';
import type { CanvasNodeState } from '../types';

/**
 * Strip characters that could break out of a CSS custom-property value context
 * before interpolating into a `<style>` block. The expected token shape is a
 * CSS color (`#abc`, `rgb(...)`) or font-family list, neither of which needs
 * `<`, `>`, `{`, `}`, `;`, or backticks. Defense-in-depth against a future
 * scenario where theme tokens become runtime-editable.
 */
function sanitizeCssTokenValue(value: string): string {
  return value.replace(/[<>{};`\\]/g, '').trim();
}

/**
 * Build a `<style>` block that exposes canvas theme tokens to the iframe under
 * both the canonical `--c-*` names and common `--color-*` aliases. Also sets
 * sensible body defaults (font, bg, color) so authored HTML inherits the look.
 */
function buildThemeStyleBlock(): string {
  const raw = getCanvasTokens();
  const t = {
    bg: sanitizeCssTokenValue(raw.bg),
    panel: sanitizeCssTokenValue(raw.panel),
    panelSoft: sanitizeCssTokenValue(raw.panelSoft),
    line: sanitizeCssTokenValue(raw.line),
    text: sanitizeCssTokenValue(raw.text),
    textSoft: sanitizeCssTokenValue(raw.textSoft),
    muted: sanitizeCssTokenValue(raw.muted),
    dim: sanitizeCssTokenValue(raw.dim),
    accent: sanitizeCssTokenValue(raw.accent),
    ok: sanitizeCssTokenValue(raw.ok),
    warn: sanitizeCssTokenValue(raw.warn),
    warnAlt: sanitizeCssTokenValue(raw.warnAlt),
    danger: sanitizeCssTokenValue(raw.danger),
    purple: sanitizeCssTokenValue(raw.purple),
    font: sanitizeCssTokenValue(raw.font),
    mono: sanitizeCssTokenValue(raw.mono),
  };
  return `
    :root {
      --c-bg: ${t.bg};
      --c-panel: ${t.panel};
      --c-panel-soft: ${t.panelSoft};
      --c-line: ${t.line};
      --c-text: ${t.text};
      --c-text-soft: ${t.textSoft};
      --c-muted: ${t.muted};
      --c-dim: ${t.dim};
      --c-accent: ${t.accent};
      --c-ok: ${t.ok};
      --c-warn: ${t.warn};
      --c-warn-alt: ${t.warnAlt};
      --c-danger: ${t.danger};
      --c-purple: ${t.purple};

      /* Common aliases authored HTML might use. */
      --color-bg: ${t.bg};
      --color-panel: ${t.panel};
      --color-surface: ${t.panelSoft};
      --color-border: ${t.line};
      --color-text: ${t.text};
      --color-text-primary: ${t.text};
      --color-text-secondary: ${t.textSoft};
      --color-text-muted: ${t.muted};
      --color-text-dim: ${t.dim};
      --color-accent: ${t.accent};
      --color-success: ${t.ok};
      --color-warning: ${t.warn};
      --color-danger: ${t.danger};

      --font: ${t.font};
      --font-sans: ${t.font};
      --font-mono: ${t.mono};

      color-scheme: dark light;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: ${t.bg};
      color: ${t.text};
      font-family: ${t.font || 'system-ui, sans-serif'};
      font-size: 14px;
      line-height: 1.5;
    }
    body { padding: 16px; box-sizing: border-box; }
    a { color: ${t.accent}; }
  `;
}

/**
 * Inject the theme style block into the user-supplied HTML. If the document has
 * a `<head>`, inject at the top of head; otherwise wrap the content in a full
 * document. Returns a complete HTML string suitable for `srcdoc`.
 */
function buildSrcDoc(userHtml: string): string {
  const styleBlock = `<style data-pmx-canvas-theme>${buildThemeStyleBlock()}</style>`;
  const trimmed = userHtml.trim();
  const isFullDoc = /<html[\s>]/i.test(trimmed);
  if (isFullDoc) {
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head([^>]*)>/i, `<head$1>${styleBlock}`);
    }
    // Has <html> but no <head> — inject one.
    return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${styleBlock}</head>`);
  }
  // Fragment — wrap in full document.
  return `<!doctype html><html><head><meta charset="utf-8">${styleBlock}</head><body>${userHtml}</body></html>`;
}

export function HtmlNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const html = typeof node.data.html === 'string'
    ? node.data.html
    : typeof node.data.content === 'string'
      ? node.data.content
      : '';
  const srcDoc = useMemo(() => (html ? buildSrcDoc(html) : ''), [html]);

  if (!html) {
    return (
      <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>
        No HTML content set
      </div>
    );
  }

  // SECURITY: sandbox is intentionally `allow-scripts` ONLY. Do NOT add
  // `allow-same-origin` (would grant the iframe access to parent localStorage
  // and credentialed requests to the canvas origin), `allow-top-navigation`
  // (would let scripts redirect the parent window), or `allow-forms` (would
  // let the iframe POST back to the host). The whole html-node tier assumes
  // arbitrary author code runs inside this exact sandbox.
  return (
    <iframe
      title={typeof node.data.title === 'string' ? node.data.title : 'HTML node'}
      sandbox="allow-scripts"
      srcdoc={srcDoc}
      style={{
        width: '100%',
        height: '100%',
        minHeight: expanded ? '70vh' : '300px',
        border: 'none',
        background: 'var(--c-bg)',
        borderRadius: '6px',
        display: 'block',
      }}
    />
  );
}
