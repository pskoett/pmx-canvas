import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Shared docking only. Map and Graph own their selection and actions. */
export function MemoryInspector({
  children,
  initiallyCollapsed = false,
  reveal = 0,
}: {
  children: ComponentChildren;
  initiallyCollapsed?: boolean;
  reveal?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(280);
  const [max, setMax] = useState(400);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (reveal) setCollapsed(false);
  }, [reveal]);
  useLayoutEffect(() => {
    const view = root.current!.closest<HTMLElement>('.home-memory')!;
    const stage = view.querySelector<HTMLElement>('.home-memory-stage')!;
    const region = view.closest<HTMLElement>('.canvas-region');
    const toolbar = view.querySelector<HTMLElement>('.home-memory-toolbar')!;
    const legend = view.querySelector<HTMLElement>('.home-memory-legend')!;
    const measure = () => {
      region?.style.setProperty(
        '--home-memory-content-top',
        `${stage.getBoundingClientRect().top - (region?.getBoundingClientRect().top ?? 0)}px`,
      );
      setMax(Math.max(120, view.clientHeight - toolbar.offsetHeight - legend.offsetHeight - 160));
    };
    const observer = new ResizeObserver(measure);
    for (const element of [view, stage, toolbar, legend]) observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      region?.style.removeProperty('--home-memory-content-top');
    };
  }, []);
  return (
    <div
      ref={root}
      class={`home-memory-inspector${collapsed ? ' is-collapsed' : ''}`}
      style={collapsed ? undefined : { height: Math.min(height, max) }}
    >
      {!collapsed && (
        <div
          class="home-memory-inspector-resize"
          role="separator"
          tabIndex={0}
          aria-label="Resize relation details"
          aria-orientation="horizontal"
          aria-controls="home-memory-details"
          aria-valuemin={120}
          aria-valuemax={max}
          aria-valuenow={Math.min(height, max)}
          onKeyDown={(event) => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            setHeight(
              event.key === 'Home'
                ? 120
                : event.key === 'End'
                  ? max
                  : Math.max(120, Math.min(max, Math.min(height, max) + (event.key === 'ArrowUp' ? 32 : -32))),
            );
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            drag.current = { id: event.pointerId, y: event.clientY, height: Math.min(height, max) };
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start?.id === event.pointerId)
              setHeight(Math.max(120, Math.min(max, start.height + start.y - event.clientY)));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            if (drag.current) setHeight(drag.current.height);
            drag.current = null;
          }}
        />
      )}
      <button
        type="button"
        class="home-button home-memory-inspector-toggle"
        aria-expanded={!collapsed}
        aria-controls="home-memory-details"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? 'Expand details' : 'Collapse details'}
      </button>
      <div id="home-memory-details">{children}</div>
    </div>
  );
}
