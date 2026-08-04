import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { workbenchConnectionEpoch } from '../state/canvas-store';
import { iframeMode } from '../state/iframe-mode';
import { surfaceContentHash } from './surface-url';

interface FrameDocumentCreateResponse {
  ok: boolean;
  url?: string;
  error?: string;
}

function isFrameDocumentCreateResponse(value: unknown): value is FrameDocumentCreateResponse {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'ok' in value &&
    typeof (value as { ok: unknown }).ok === 'boolean'
  );
}

export async function createIframeDocumentUrl(html: string, sandbox: string): Promise<string> {
  const response = await fetch('/api/canvas/frame-documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, sandbox }),
  });
  const json = (await response.json()) as unknown;
  if (!response.ok || !isFrameDocumentCreateResponse(json) || !json.ok || typeof json.url !== 'string') {
    const message =
      isFrameDocumentCreateResponse(json) && json.error
        ? json.error
        : `Frame document request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return json.url;
}

export function useIframeDocument(
  html: string,
  sandbox: string,
): { attributes: { src?: string; srcdoc?: string }; ready: boolean; key: string } {
  // Boot-wide embed probe (state/iframe-mode.ts): srcdoc mode means src-URL
  // iframes are blocked here (nested-iframe hosts like Amp orb portals), so the
  // frame-documents round-trip would produce a URL the browser refuses to load.
  const mode = iframeMode.value;
  const [src, setSrc] = useState<string | null>(null);
  const [remintNonce, setRemintNonce] = useState(0);
  const mintEpochRef = useRef(0);

  useEffect(() => {
    setSrc(null);
    if (!html || mode !== 'src') return;
    let cancelled = false;
    mintEpochRef.current = workbenchConnectionEpoch.value;
    void createIframeDocumentUrl(html, sandbox)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch((error) => {
        console.error('[iframe-document] failed to create frame document:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [html, sandbox, mode, remintNonce]);

  // Finding S: frame documents live in server memory, so a daemon restart turns
  // this mount's URL into a 404 while the panel keeps showing the dead frame.
  // Every reconnect frame (SSE reconnect or poll snapshot reset) revalidates the
  // minted URL and re-mints a fresh document when the server no longer has it —
  // no full workbench reload required.
  const epoch = workbenchConnectionEpoch.value;
  useEffect(() => {
    if (mode !== 'src' || epoch === mintEpochRef.current) return;
    if (!src) {
      // A previous mint failed outright (e.g. the daemon flapped down between
      // the HEAD 404 and the re-mint POST). A fresh connection epoch means the
      // server is reachable again — retry the mint instead of stranding the
      // tile until a manual reload.
      setRemintNonce((n) => n + 1);
      return;
    }
    let cancelled = false;
    void fetch(src, { method: 'HEAD' })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          mintEpochRef.current = epoch;
          return;
        }
        setRemintNonce((n) => n + 1);
      })
      .catch(() => {
        // Transient network failure — the next reconnect epoch retries.
      });
    return () => {
      cancelled = true;
    };
  }, [epoch, src, mode]);

  return useMemo(() => {
    if (mode === 'srcdoc' && html) {
      // The document already lives client-side, so serve it inline. Consumers
      // always render the iframe `sandbox` attribute, which supplies the
      // sandboxing the frame-document CSP header would have.
      return {
        attributes: { srcdoc: html },
        ready: true,
        key: `srcdoc-${surfaceContentHash(html)}`,
      };
    }
    return {
      attributes: src ? { src } : {},
      ready: Boolean(src),
      key: src ?? '',
    };
  }, [src, mode, html]);
}
