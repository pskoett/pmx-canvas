import { activeBoard } from '../state/boards-store';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { reportClientViewportSize } from '../state/intent-bridge';
import { focusNode, groupContents, groupPath, groupViewNodes, leaveGroup, nodes } from '../state/canvas-store';

export function GroupBreadcrumbs() {
  const path = groupPath.value;
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = new ResizeObserver(() => void reportClientViewportSize());
    resize.observe(element);
    return () => resize.disconnect();
  }, [path.length > 0]);
  if (!path.length) return null;
  return (
    <nav
      ref={ref}
      class="group-breadcrumbs"
      aria-label="Group navigation"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={() => leaveGroup(0)}>
        {activeBoard()?.name ?? 'Board'}
      </button>
      {path.map((visit, index) => (
        <span key={visit.id}>
          <span aria-hidden="true"> / </span>
          <button
            type="button"
            aria-current={index === path.length - 1 ? 'location' : undefined}
            disabled={index === path.length - 1}
            onClick={() => leaveGroup(index + 1)}
          >
            {String(nodes.value.get(visit.id)?.data.title ?? 'Group')}
          </button>
        </span>
      ))}
      <button type="button" onClick={() => leaveGroup()} aria-label="Leave group">
        Esc · goes up
      </button>
    </nav>
  );
}

export function GroupOutsideLinks() {
  const inside = groupContents.value;
  if (!inside) return null;
  const outside = [...groupViewNodes.value.values()].filter((node) => !inside.has(node.id));
  const children = [...nodes.value.values()].filter((node) => inside.has(node.id));
  const root = nodes.value.get(groupPath.value.at(-1)!.id)!;
  const left = children.length ? Math.min(...children.map((node) => node.position.x)) - 24 : root.position.x;
  const top = children.length ? Math.min(...children.map((node) => node.position.y)) - 40 : root.position.y;
  const right = children.length
    ? Math.max(...children.map((node) => node.position.x + node.size.width)) + 24
    : left + 320;
  const bottom = children.length
    ? Math.max(...children.map((node) => node.position.y + node.size.height)) + 24
    : top + 120;
  return (
    <>
      <div class="group-inside-frame" style={{ left, top, width: right - left, height: bottom - top }}>
        <span>Inside {String(root.data.title ?? 'Group')}</span>
      </div>
      {outside.map((node, index) => (
        <div key={node.id} class="group-outside-endpoint" style={{ left: node.position.x, top: node.position.y }}>
          {index === 0 && <span class="group-outside-label">Outside</span>}
          <button
            type="button"
            class="group-outside-stub"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              focusNode(node.id, { recordHistory: false, persistStacking: false });
            }}
          >
            ↗ {String(node.data.title ?? node.type)}
            <span>{node.type} · Show on canvas</span>
          </button>
        </div>
      ))}
    </>
  );
}
