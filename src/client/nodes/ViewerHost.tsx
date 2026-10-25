import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { expandNode } from '../state/canvas-store';
import type { CanvasNodeState } from '../types';

// Mount on first approach at any zoom, then retain the document's arbitrary
// live state. A lifetime cap starves later regions of a populated board.
export function ViewerHost({ node, children }: { node: CanvasNodeState; children: ComponentChildren }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!anchor.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry!.isIntersecting) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={anchor} class="viewer-host" data-viewer-mounted={mounted}>
      {mounted ? (
        children
      ) : (
        <div class="viewer-placeholder">
          <span>{String(node.data.title || node.type)}</span>
          <button type="button" onClick={() => expandNode(node.id)}>
            Open viewer
          </button>
        </div>
      )}
    </div>
  );
}
