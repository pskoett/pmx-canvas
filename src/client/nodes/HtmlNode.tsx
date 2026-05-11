import { useEffect, useMemo, useRef } from 'preact/hooks';
import { canvasTheme } from '../state/canvas-store';
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
function buildPresentationEscapeBridge(exitToken?: string): string {
  const token = JSON.stringify(exitToken ?? '');
  return `<script data-pmx-canvas-presentation-bridge>
const PMX_CANVAS_PRESENTATION_EXIT_TOKEN = ${token};
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.parent.postMessage({ source: 'pmx-canvas-html-node', type: 'presentation-exit', token: PMX_CANVAS_PRESENTATION_EXIT_TOKEN }, '*');
  }
}, true);
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.source !== 'pmx-canvas-html-node' || message.type !== 'presentation-key' || message.token !== PMX_CANVAS_PRESENTATION_EXIT_TOKEN) return;
  if (typeof message.key !== 'string') return;
  if (typeof window.PMX_CANVAS_PRESENTATION_HANDLE_KEY === 'function') {
    window.PMX_CANVAS_PRESENTATION_HANDLE_KEY(message.key);
    return;
  }
  document.dispatchEvent(new CustomEvent('pmx-presentation-key', { detail: { key: message.key }, bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: message.key, bubbles: true, cancelable: true }));
});
</script>`;
}

function buildThemeBridge(themeToken: string): string {
  const token = JSON.stringify(themeToken);
  return `<script data-pmx-canvas-theme-bridge>
const PMX_CANVAS_THEME_TOKEN = ${token};
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.source !== 'pmx-canvas-html-node' || message.type !== 'theme-update' || message.token !== PMX_CANVAS_THEME_TOKEN) return;
  if (typeof message.css !== 'string' || typeof message.theme !== 'string') return;
  let style = document.querySelector('style[data-pmx-canvas-theme]');
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('data-pmx-canvas-theme', '');
    document.head.prepend(style);
  }
  style.textContent = message.css;
  document.documentElement.setAttribute('data-pmx-canvas-theme', message.theme);
  document.documentElement.setAttribute('data-theme', message.theme);
});
</script>`;
}

function injectIntoHead(html: string, content: string): string {
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${content}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${content}</head>`);
  }
  return html;
}

function buildSrcDoc(userHtml: string, options: { presentation?: boolean; presentationExitToken?: string; themeToken: string; themeCss: string; theme: string }): string {
  const styleBlock = `<style data-pmx-canvas-theme>${options.themeCss}</style>`;
  const themeBridge = buildThemeBridge(options.themeToken);
  const presentationBridge = options.presentation ? buildPresentationEscapeBridge(options.presentationExitToken) : '';
  const injectedHeadContent = `${styleBlock}${themeBridge}${presentationBridge}`;
  const presentationAttr = options.presentation ? ' data-pmx-presentation-mode="present"' : '';
  const trimmed = userHtml.trim();
  const isFullDoc = /<html[\s>]/i.test(trimmed);
  if (isFullDoc) {
    const withTheme = trimmed.replace(/<html([^>]*)>/i, `<html$1 data-pmx-canvas-theme="${options.theme}" data-theme="${options.theme}"${presentationAttr}>`);
    return injectIntoHead(withTheme, injectedHeadContent);
  }
  // Fragment — wrap in full document.
  return `<!doctype html><html data-pmx-canvas-theme="${options.theme}" data-theme="${options.theme}"${presentationAttr}><head><meta charset="utf-8">${injectedHeadContent}</head><body>${userHtml}</body></html>`;
}

export function createHtmlNodeSrcDocForTest(userHtml: string, options: { theme: string; themeCss: string; themeToken?: string; presentation?: boolean; presentationExitToken?: string }): string {
  return buildSrcDoc(userHtml, {
    themeToken: options.themeToken ?? 'test-theme-token',
    theme: options.theme,
    themeCss: options.themeCss,
    presentation: options.presentation,
    presentationExitToken: options.presentationExitToken,
  });
}

export function shouldShowPresentationControls(node: CanvasNodeState): boolean {
  return node.type === 'html' && node.data.presentation === true;
}

export function HtmlNode({
  node,
  expanded = false,
  presentation = false,
  presentationExitToken,
  autoFocus = false,
}: { node: CanvasNodeState; expanded?: boolean; presentation?: boolean; presentationExitToken?: string; autoFocus?: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const theme = canvasTheme.value;
  const themeToken = useMemo(() => `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, []);
  const themeCss = useMemo(() => buildThemeStyleBlock(), [theme]);
  const html = typeof node.data.html === 'string'
    ? node.data.html
    : typeof node.data.content === 'string'
      ? node.data.content
      : '';
  const srcDoc = useMemo(() => (html ? buildSrcDoc(html, { presentation, presentationExitToken, themeToken, themeCss, theme }) : ''), [html, presentation, presentationExitToken, themeToken]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({
      source: 'pmx-canvas-html-node',
      type: 'theme-update',
      token: themeToken,
      theme,
      css: themeCss,
    }, '*');
    if (autoFocus) iframeRef.current?.focus();
  }, [theme, themeCss, themeToken]);

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => iframeRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [autoFocus, srcDoc]);

  const handleFrameLoad = () => {
    iframeRef.current?.contentWindow?.postMessage({
      source: 'pmx-canvas-html-node',
      type: 'theme-update',
      token: themeToken,
      theme,
      css: themeCss,
    }, '*');
    if (autoFocus) iframeRef.current?.focus();
  };

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
      ref={iframeRef}
      class={presentation ? 'html-node-frame html-node-frame-presentation' : 'html-node-frame'}
      title={typeof node.data.title === 'string' ? node.data.title : 'HTML node'}
      sandbox="allow-scripts"
      srcdoc={srcDoc}
      tabIndex={autoFocus ? 0 : undefined}
      onLoad={handleFrameLoad}
      style={{
        width: '100%',
        height: '100%',
        minHeight: presentation ? 0 : expanded ? '70vh' : '300px',
        border: 'none',
        background: 'var(--c-bg)',
        borderRadius: presentation ? '18px' : '6px',
        display: 'block',
      }}
    />
  );
}
