import { useEffect, useState } from 'preact/hooks';
import { isHostedWorkbench, workbenchFetch } from '../state/workbench-transport';

/**
 * Asset bytes travel through the host, not a localhost URL in the user's browser.
 * `undefined` while a hosted read is in flight, `null` once it failed.
 */
export function useWorkbenchAsset(path: string): string | null | undefined {
  const hosted = isHostedWorkbench() && path.startsWith('/');
  const [asset, setAsset] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!hosted) return;
    let cancelled = false;
    void workbenchFetch(path)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Asset read failed: ${response.status}`);
        const reader = new FileReader();
        reader.onload = () => {
          if (!cancelled && typeof reader.result === 'string') setAsset({ path, url: reader.result });
        };
        reader.readAsDataURL(await response.blob());
      })
      .catch((error: unknown) => {
        console.error('[workbench-asset]', error);
        if (!cancelled) setAsset({ path, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [path, hosted]);
  return hosted ? (asset?.path === path ? asset.url : undefined) : path;
}
