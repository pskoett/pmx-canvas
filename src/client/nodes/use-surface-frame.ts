import { useEffect, useState } from 'preact/hooks';
import { iframeMode } from '../state/iframe-mode';

function isSameOriginUrl(url: string): boolean {
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
 * than loading a src that may show the broken placeholder; a failed srcdoc
 * fetch falls back to `src` (no worse than before).
 */
export function useSurfaceFrame(url: string): { src?: string; srcdoc?: string } {
  const mode = iframeMode.value;
  const [doc, setDoc] = useState<{ url: string; html: string } | null>(null);
  const sameOrigin = Boolean(url) && isSameOriginUrl(url);
  const wantsSrcdoc = mode === 'srcdoc' && sameOrigin;

  useEffect(() => {
    if (!wantsSrcdoc) return;
    let cancelled = false;
    void fetch(url, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((html) => {
        if (!cancelled) setDoc({ url, html });
      })
      .catch((error) => {
        console.error('[surface-frame] srcdoc fetch failed, falling back to src:', url, error);
        // Empty html marks the src fallback below.
        if (!cancelled) setDoc({ url, html: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [wantsSrcdoc, url]);

  if (!url) return {};
  if (!wantsSrcdoc) {
    return mode === null && sameOrigin ? {} : { src: url };
  }
  // Keep the previous document visible while a newer URL is being fetched —
  // same UX as src mode, where the old document stays until the new one loads.
  if (doc) return doc.html ? { srcdoc: doc.html } : { src: doc.url };
  return {};
}
