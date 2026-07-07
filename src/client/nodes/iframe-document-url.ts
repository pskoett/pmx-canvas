import { useEffect, useMemo, useState } from 'preact/hooks';

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
): { attributes: { src?: string }; ready: boolean; key: string } {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    if (!html) return;
    let cancelled = false;
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
  }, [html, sandbox]);

  return useMemo(
    () => ({
      attributes: src ? { src } : {},
      ready: Boolean(src),
      key: src ?? '',
    }),
    [src],
  );
}
