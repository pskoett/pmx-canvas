import { useEffect, useState } from 'preact/hooks';
import { iframeMode } from '../state/iframe-mode';
import { isHostedWorkbench, workbenchFetch } from '../state/workbench-transport';
import { VIEWER_LOAD_DEADLINE_MS, type ViewerSource } from './ViewerFrame';

function isSameOriginUrl(url: string): boolean {
  if (isHostedWorkbench()) return url.startsWith('/') && !url.startsWith('//');
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Attributes for a surface iframe, honoring the boot-wide iframe mode
 * (state/iframe-mode.ts): `src` by default, fetch() + `srcdoc` when src-URL
 * iframes are blocked by the embedding context (nested-iframe hosts like Amp
 * orb portals). Cross-origin URLs always stay `src` — they cannot be fetched
 * from here. While the probe is pending, same-origin frames stay empty rather
 * than loading a src that may show the broken placeholder. Preparation failures
 * use the shared host's Retry, never a second load path the embed probe rejected.
 */
export function useSurfaceFrame(url: string): ViewerSource {
  const mode = iframeMode.value;
  const [doc, setDoc] = useState<{ url: string; html: string } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sameOrigin = Boolean(url) && isSameOriginUrl(url);
  const wantsSrcdoc = mode === 'srcdoc' && sameOrigin;

  useEffect(() => {
    setError(false);
    if (!wantsSrcdoc) return;
    let cancelled = false;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), VIEWER_LOAD_DEADLINE_MS);
    // Ask the server to inline bundle assets (the mermaid renderer): hosts
    // that force srcdoc mode block sub-frame subresource requests too.
    void workbenchFetch(`${url}${url.includes('?') ? '&' : '?'}inline-assets=1`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((html) => {
        if (!cancelled) setDoc({ url, html });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[surface-frame] document fetch failed:', url, error);
        setError(true);
      })
      .finally(() => clearTimeout(deadline));
    return () => {
      cancelled = true;
      clearTimeout(deadline);
      controller.abort();
    };
  }, [wantsSrcdoc, url, attempt]);

  if (!url) return {};
  if (!wantsSrcdoc) {
    return mode === null && sameOrigin ? {} : { src: url };
  }
  // Keep the previous document visible while a newer URL is being fetched —
  // same UX as src mode, where the old document stays until the new one loads.
  return { srcdoc: doc?.html, error, retry: () => setAttempt((value) => value + 1) };
}
