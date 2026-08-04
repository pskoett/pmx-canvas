/**
 * Nested-iframe embedding detection (Amp orb portals).
 *
 * When the canvas page itself runs inside an iframe (ampcode.com embeds the
 * portal URL on *.onamp.dev), Chrome refuses to load child iframes from `src`
 * URLs — even same-origin relative ones — leaving every iframe-backed node a
 * gray "refused to connect" placeholder. Inline documents (`srcdoc`) still
 * render. This module probes the real behavior once per boot: a hidden 1px
 * iframe navigates to the tiny /api/canvas/iframe-probe document; if `load`
 * fires the host is normal (`src` mode), otherwise same-origin surfaces fall
 * back to fetch() + `srcdoc` (see nodes/use-surface-frame.ts and
 * nodes/iframe-document-url.ts).
 *
 * `src` stays the default everywhere it works: URL-loaded surfaces keep real
 * document URLs, and the frame-document transport exists precisely because
 * attribute-sized srcdoc documents were the worse default (v0.1.24). srcdoc is
 * the blocked-embed fallback, not the new normal.
 *
 * Force a mode with `?iframe-mode=srcdoc` (or `=src`) for debugging.
 */
import { signal } from '@preact/signals';

export type IframeMode = 'src' | 'srcdoc';

export const IFRAME_PROBE_PATH = '/api/canvas/iframe-probe';
const PROBE_TIMEOUT_MS = 3000;

/** Boot-wide iframe transport mode; null until the probe (or override) resolves. */
export const iframeMode = signal<IframeMode | null>(null);

export function forcedIframeMode(): IframeMode | null {
  const value = new URLSearchParams(window.location.search).get('iframe-mode');
  return value === 'srcdoc' || value === 'src' ? value : null;
}

/**
 * Probe whether `src`-URL iframes load in this embedding context. Resolves true
 * when the hidden probe iframe fires `load`; false on error or timeout. The
 * blocked-portal case shows its placeholder without reliably firing either
 * event, so the timeout is the real signal there — and a false negative is
 * safe, because srcdoc rendering works in normal hosts too.
 */
export function probeSrcIframes(timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const test = document.createElement('iframe');
    test.setAttribute('data-pmx-iframe-probe', '');
    test.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;border:none';
    test.setAttribute('sandbox', 'allow-scripts');
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      test.remove();
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), timeoutMs);
    test.addEventListener('load', () => done(true));
    test.addEventListener('error', () => done(false));
    test.src = IFRAME_PROBE_PATH;
    (document.body ?? document.documentElement).appendChild(test);
  });
}

let pending: Promise<IframeMode> | null = null;

function isEmbeddedDocument(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Amp orb services run with AMP_ORB=1 and the server stamps that into the page
 * as window.__PMX_AMP_ORB (see canvasSpaHtml). The orb portal's nested-iframe
 * embed blocks src-URL child iframes, but the probe is unreliable there — a
 * tiny probe iframe sometimes loads even though node-sized ones will not — so
 * a known orb host must skip the probe and go straight to srcdoc.
 */
function isAmpOrbHost(): boolean {
  return (window as Window & { __PMX_AMP_ORB?: unknown }).__PMX_AMP_ORB === true;
}

/**
 * Resolve the boot-wide iframe mode once; all surface hooks share the result.
 * The blocked-src condition only exists when the canvas page itself runs
 * inside an iframe, so top-level documents resolve `src` synchronously — the
 * normal path pays zero probe latency before surfaces mount. Only embedded
 * documents run the probe (`embedded` is overridable for tests).
 */
export function resolveIframeMode(opts: { embedded?: boolean; ampOrb?: boolean } = {}): Promise<IframeMode> {
  if (iframeMode.value) return Promise.resolve(iframeMode.value);
  if (pending) return pending;
  const forced = forcedIframeMode();
  if (forced) {
    iframeMode.value = forced;
    return Promise.resolve(forced);
  }
  if (!(opts.embedded ?? isEmbeddedDocument())) {
    iframeMode.value = 'src';
    return Promise.resolve('src');
  }
  if (opts.ampOrb ?? isAmpOrbHost()) {
    iframeMode.value = 'srcdoc';
    return Promise.resolve('srcdoc');
  }
  pending = probeSrcIframes().then((srcWorks) => {
    const mode: IframeMode = srcWorks ? 'src' : 'srcdoc';
    iframeMode.value = mode;
    return mode;
  });
  return pending;
}

/** Test hook: clear the memoized probe so each test starts unresolved. */
export function resetIframeModeForTests(): void {
  iframeMode.value = null;
  pending = null;
}
