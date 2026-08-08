/**
 * Surface-side renderer for `mermaid` nodes — the entry point of the separately
 * built dist/canvas/mermaid-entry.js bundle (see package.json build:client).
 * The server (handleNodeSurface) serves a themed surface document containing the
 * HTML-escaped diagram source in `<pre class="mermaid-source">`; this script
 * reads it back via textContent, renders it to SVG, and re-renders when the
 * parent canvas live-switches the theme (the theme bridge toggles the document's
 * `data-theme` attribute). Keeping mermaid out of the main SPA bundle keeps the
 * canvas boot lean — only mermaid-node surfaces pay for the library.
 */

import mermaid from 'mermaid';
import { canvasThemeScheme } from '../shared/themes.js';

function documentScheme(): 'dark' | 'light' {
  return canvasThemeScheme(document.documentElement.getAttribute('data-theme'));
}

function showError(container: HTMLElement, message: string): void {
  container.innerHTML = '';
  const block = document.createElement('pre');
  block.className = 'mermaid-error';
  block.style.cssText =
    'margin:12px;padding:12px;border-radius:6px;color:var(--c-dim,#8a93a6);' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;';
  block.textContent = message;
  container.appendChild(block);
}

let renderSeq = 0;

async function renderDiagram(source: string, container: HTMLElement): Promise<void> {
  const scheme = documentScheme();
  mermaid.initialize({
    startOnLoad: false,
    theme: scheme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
  });
  renderSeq += 1;
  try {
    const { svg } = await mermaid.render(`pmx-mermaid-${renderSeq}`, source);
    container.innerHTML = svg;
  } catch (error) {
    // Never leave a blank/black frame: show the parse/render error instead.
    showError(container, error instanceof Error ? error.message : String(error));
  }
}

function boot(): void {
  const sourceEl = document.querySelector('.mermaid-source');
  const source = sourceEl?.textContent ?? '';
  const container = document.createElement('div');
  container.className = 'mermaid-diagram';
  document.body.appendChild(container);
  if (!source.trim()) {
    showError(container, 'Empty mermaid diagram');
    return;
  }
  void renderDiagram(source, container);
  // Live theme switching: the parent's theme bridge toggles data-theme on the
  // root element; re-render so the diagram palette follows the canvas theme.
  let lastScheme = documentScheme();
  const observer = new MutationObserver(() => {
    const scheme = documentScheme();
    if (scheme === lastScheme) return;
    lastScheme = scheme;
    void renderDiagram(source, container);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
