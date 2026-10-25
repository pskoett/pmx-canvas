import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { renderMermaid } from '../mermaid-render';
import { canvasTheme, nodes, updateNode } from '../state/canvas-store';
import { pushCanvasUpdate } from '../state/intent-bridge';
import { computeContentGrowHeight, contentFitPosition } from '../canvas/auto-fit';
import type { CanvasNodeState } from '../types';

export function MermaidNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const source = typeof node.data.content === 'string' ? node.data.content : '';
  const theme = canvasTheme.value;
  const fit = node.data.fit !== 'none';
  // Fit is layout, not content: it resizes the painted SVG in place. Re-rendering
  // on a fit change replaced the element and left a detached SVG mid-update.
  const fitRef = useRef(fit);
  fitRef.current = fit;

  const fitDiagram = () => {
    const element = container.current;
    const svg = element?.querySelector('svg');
    const box = svg?.viewBox.baseVal;
    if (!element || !svg || !box?.width || !box.height) return;
    const scale = fitRef.current ? Math.min(1, element.clientWidth / box.width, element.clientHeight / box.height) : 1;
    svg.style.maxWidth = 'none';
    svg.style.width = `${box.width * scale}px`;
    svg.style.height = `${box.height * scale}px`;
    svg.style.margin = fitRef.current ? '0 auto' : '0';
  };

  const growToDiagram = () => {
    const element = container.current;
    const box = element?.querySelector('svg')?.viewBox.baseVal;
    const current = nodes.value.get(node.id);
    if (expanded || !element || !box?.width || !current) return;
    const naturalHeight = box.height * (fitRef.current ? Math.min(1, element.clientWidth / box.width) : 1);
    const card = element.closest<HTMLElement>('.canvas-node')!;
    const height = computeContentGrowHeight(current, naturalHeight, card.offsetHeight - element.clientHeight);
    if (height === null) return;
    const position = contentFitPosition(current, height, Array.from(nodes.value.values()));
    const patch = { size: { width: current.size.width, height }, position };
    updateNode(node.id, patch);
    void pushCanvasUpdate([{ id: node.id, ...patch }], { recordHistory: false });
  };

  useEffect(() => {
    let cancelled = false;
    const element = container.current;
    if (!element || !source) return;
    const observer = new ResizeObserver(fitDiagram);
    observer.observe(element);
    const render = async () => {
      try {
        const svg = await renderMermaid(source);
        if (cancelled) return;
        element.innerHTML = svg;
        setError('');
        element.querySelector('svg')?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        fitDiagram();
        growToDiagram();
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    void render();
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [source, theme, expanded, attempt]);

  // Same commit as data-fit, so the attribute and the painted size never disagree.
  useLayoutEffect(() => {
    fitDiagram();
    growToDiagram();
  }, [fit]);

  if (!source) return <div class="viewer-placeholder">No diagram source set</div>;
  return (
    <div class="mermaid-viewer" data-fit={fit ? 'contain' : 'none'}>
      <div ref={container} class="mermaid-diagram" />
      {error && (
        <div class="viewer-fallback" role="status">
          <span>{error}</span>
          <button type="button" onClick={() => setAttempt(attempt + 1)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
