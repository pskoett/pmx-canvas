import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { CanvasNodeState } from '../types';
import { getImageNodeWarnings } from './image-warnings';

/**
 * Image node renderer.
 * Supports: file paths (served via /api/canvas/image/:nodeId), data URIs, and URLs.
 * Features: fit-to-container, zoom in/out within node, pan when zoomed.
 */
export function ImageNode({
  node,
  expanded = false,
}: { node: CanvasNodeState; expanded?: boolean }) {
  const src = (node.data.src as string) || '';
  const alt = (node.data.alt as string) || (node.data.title as string) || 'Image';
  const caption = (node.data.caption as string) || '';
  const warnings = getImageNodeWarnings(node);

  // Determine the image source URL
  const imageSrc = src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')
    ? src
    : `/api/canvas/image/${node.id}`;

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleLoad = useCallback((e: Event) => {
    const img = e.target as HTMLImageElement;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setLoaded(true);
    setError(false);
  }, []);

  const handleError = useCallback(() => {
    setError(true);
    setLoaded(false);
  }, []);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [src]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.25, Math.min(10, z * delta)));
  }, []);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (zoom <= 1) return;
    e.stopPropagation();
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [zoom]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }, []);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  if (!src) {
    return (
      <div class="image-node-empty">
        <div class="image-node-empty-icon">🖼</div>
        <div class="image-node-empty-text">No image source</div>
      </div>
    );
  }

  const sizeLabel = naturalSize.w > 0 ? `${naturalSize.w}×${naturalSize.h}` : '';
  const zoomPct = Math.round(zoom * 100);

  return (
    <div
      class={`image-node ${expanded ? 'image-node-expanded' : ''}`}
      ref={containerRef}
    >
      {warnings.length > 0 && (
        <div class="image-node-warning-stack">
          {warnings.map((warning) => (
            <div class="image-node-warning" key={`${warning.title}-${warning.detail}`}>
              <span class="image-node-warning-title">{warning.title}</span>
              <span class="image-node-warning-detail">{warning.detail}</span>
            </div>
          ))}
        </div>
      )}
      <div
        class="image-node-viewport"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
      >
        {!loaded && !error && (
          <div class="image-node-loading">Loading…</div>
        )}
        {error && (
          <div class="image-node-error">
            <div class="image-node-error-icon">⚠</div>
            <div>Failed to load image</div>
            <div class="image-node-error-path">{src}</div>
          </div>
        )}
        <img
          src={imageSrc}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          draggable={false}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            opacity: loaded ? 1 : 0,
            display: error ? 'none' : 'block',
          }}
        />
      </div>
      {(caption || sizeLabel || zoom !== 1) && (
        <div class="image-node-footer">
          {caption && <span class="image-node-caption">{caption}</span>}
          <span class="image-node-meta">
            {sizeLabel && <span>{sizeLabel}</span>}
            {zoom !== 1 && (
              <button
                type="button"
                class="image-node-zoom-reset"
                onClick={resetView}
                title="Reset zoom"
              >
                {zoomPct}% ↺
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
