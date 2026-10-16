import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memoryKey, type MemoryGraph, type MemoryGraphEdge, type MemoryGraphNode } from '../../shared/memory-graph.js';
import { relationDefinition, relationText } from '../../shared/relations.js';
import { boardList, browsingMemory, memoryGraphRevision, openMemoryTarget, updateBoard } from '../state/boards-store';
import { requestJson } from '../state/intent-bridge';
import { isSelectionEscape } from '../utils/keyboard';
import { BoardPinButton } from './BoardPinButton';
import { graphRadius, graphSimulation, MAP_CARD, mapLayout, type GraphParticle, type Point } from './memory-layout';

const linkNames = {
  member: 'Membership',
  portal: 'Portals',
  wiki: 'Wiki links',
  card: 'Card relations',
  previous: 'Previous boards',
};
type LinkKind = keyof typeof linkNames;
const kinds = Object.keys(linkNames) as LinkKind[];

function Filter({
  label,
  count,
  checked,
  change,
}: {
  label: string;
  count: number;
  checked: boolean;
  change: () => void;
}) {
  return (
    <label class="home-memory-check">
      <input type="checkbox" aria-label={label} checked={checked} onChange={change} />
      <span>{label}</span>
      <small>{count}</small>
    </label>
  );
}

export function HomeMemoryView({ mode }: { mode: 'Map' | 'Graph' }) {
  const map = mode === 'Map';
  const boards = boardList.value;
  const liveRevision = memoryGraphRevision.value;
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [focus, setFocus] = useState('');
  const [depth, setDepth] = useState(2);
  const [query, setQuery] = useState('');
  const [showBoards, setShowBoards] = useState(true);
  const [showCards, setShowCards] = useState(true);
  const [context, setContext] = useState(false);
  const [unfiled, setUnfiled] = useState(true);
  const [hiddenFolders, setHiddenFolders] = useState(new Set<string>());
  const [hiddenLinks, setHiddenLinks] = useState(new Set<LinkKind>());
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [details, setDetails] = useState<{ key: string; graph: MemoryGraph | null } | null>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [moved, setMoved] = useState<Record<string, Point>>({});
  const [size, setSize] = useState(1);
  const [repel, setRepel] = useState(1);
  const [distance, setDistance] = useState(160);
  const [labelFade, setLabelFade] = useState(15);
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [sidebar, setSidebar] = useState(false);
  const [paint, setPaint] = useState(0);
  const particles = useRef(new Map<string, GraphParticle>());
  const simulation = useRef<ReturnType<typeof graphSimulation> | null>(null);
  const fitPending = useRef(true);
  const viewport = useRef<HTMLDivElement>(null);
  const sidebarElement = useRef<HTMLElement>(null);
  const gesture = useRef<{
    id: number;
    start: Point;
    origin: Point;
    key?: string;
    boardId?: string;
    current?: Point;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const refresh = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    browsingMemory.value = true;
  }, []);
  useLayoutEffect(() => {
    if (!selectedKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isSelectionEscape(event)) return;
      event.preventDefault();
      setSelectedKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKey]);
  useLayoutEffect(() => {
    const stage = viewport.current;
    const region = stage?.closest<HTMLElement>('.canvas-region');
    if (!stage || !region) return;
    // Tabs and counts can wrap independently. Updates follows their actual
    // bottom edge, including after a resize, rather than a fixed header height.
    const measure = () => {
      region.style.setProperty(
        '--home-memory-content-top',
        `${stage.getBoundingClientRect().top - region.getBoundingClientRect().top}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => {
      observer.disconnect();
      region.style.removeProperty('--home-memory-content-top');
    };
  }, []);
  useEffect(() => {
    if (selectedKey) sidebarElement.current?.querySelector('.home-memory-details')?.scrollIntoView({ block: 'start' });
  }, [selectedKey]);

  // Graph reads are summaries, not content reads. Refresh from the shared projection
  // without remounting the view, replacing the camera or interrupting a held node.
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let dirty = false;
    let timer: number | undefined;
    const schedule = () => {
      dirty = true;
      if (!running && timer === undefined) timer = window.setTimeout(load, 120);
    };
    const load = async () => {
      timer = undefined;
      dirty = false;
      running = true;
      setLoading(true);
      const params = new URLSearchParams({ depth: String(depth) });
      if (map) params.set('projection', 'boards');
      if (!map && focus) params.set('focus', focus);
      const result = await requestJson<MemoryGraph | null>('memoryGraph', `/api/canvas/memory-graph?${params}`, null);
      if (cancelled) return;
      if (result && Array.isArray(result.nodes) && Array.isArray(result.edges)) {
        setGraph(result);
        setError(false);
      } else setError(true);
      setLoading(false);
      running = false;
      if (dirty) schedule();
    };
    refresh.current = schedule;
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [map, focus, depth]);
  useEffect(() => {
    refresh.current();
  }, [liveRevision, boards, revision]);

  useEffect(() => {
    if (!map || !selectedKey) return;
    let cancelled = false;
    setDetails(null);
    const params = new URLSearchParams({ focus: selectedKey, depth: '2' });
    void requestJson<MemoryGraph | null>('memoryGraph', `/api/canvas/memory-graph?${params}`, null).then((result) => {
      if (!cancelled) setDetails({ key: selectedKey, graph: result });
    });
    return () => {
      cancelled = true;
    };
  }, [map, selectedKey, graph]);

  const allNodes = useMemo(
    () =>
      (graph?.nodes ?? [])
        .filter((node) => !map || node.kind === 'board')
        .map((node) => {
          const board = boards.find((entry) => entry.id === node.boardId);
          if (!board) return node;
          return {
            ...node,
            folder: board.folder,
            ...(node.kind === 'board'
              ? {
                  title: board.name,
                  inContext: !!board.pin,
                  nodeCount: board.nodeCount,
                  position: board.mapPosition ?? undefined,
                }
              : {}),
          };
        }),
    [graph, map, boards],
  );
  const generated = useMemo(() => mapLayout(allNodes, collapsed), [allNodes, collapsed]);
  const folderCounts = new Map<string, number>();
  for (const node of new Map(allNodes.map((node) => [node.boardId, node])).values()) {
    const folder = node.folder?.split('/')[0] ?? '';
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }
  const visible = allNodes.filter(
    (node) =>
      (node.kind === 'board' ? showBoards : showCards) &&
      (!context || node.inContext) &&
      (unfiled || !!node.folder) &&
      !hiddenFolders.has(node.folder?.split('/')[0] ?? '') &&
      (!map || !generated.hidden.has(node.key)) &&
      `${node.title} ${node.summary} ${node.folder ?? ''}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const visibleKeys = new Set(visible.map((node) => node.key));
  const position = (key: string) => moved[key] ?? (map ? generated.positions.get(key) : particles.current.get(key));
  const edges = (graph?.edges ?? []).filter((edge) => {
    if (hiddenLinks.has(edge.kind) || (map && edge.kind === 'member')) return false;
    const from = map ? memoryKey({ boardId: edge.source.boardId }) : edge.from;
    const to = map ? memoryKey({ boardId: edge.target.boardId }) : edge.to;
    return visibleKeys.has(from) && (edge.missing || visibleKeys.has(to)) && (edge.missing || from !== to);
  });
  const selected = allNodes.find((node) => node.key === selectedKey);
  const emphasized = allNodes.find((node) => node.key === (hoverKey ?? selectedKey));
  const neighbors = new Set<string>(emphasized ? [emphasized.key] : []);
  for (const edge of edges) {
    if (!emphasized) break;
    if (
      emphasized.kind === 'board'
        ? edge.source.boardId === emphasized.boardId || edge.target.boardId === emphasized.boardId
        : edge.from === emphasized.key || edge.to === emphasized.key
    ) {
      neighbors.add(map ? memoryKey({ boardId: edge.source.boardId }) : edge.from);
      neighbors.add(map ? memoryKey({ boardId: edge.target.boardId }) : edge.to);
      neighbors.add(memoryKey({ boardId: edge.source.boardId }));
      neighbors.add(memoryKey({ boardId: edge.target.boardId }));
    }
  }
  const detailGraph = map ? (details?.key === selectedKey ? details.graph : null) : graph;
  const selectedBoard = boards.find((board) => board.id === selected?.boardId);
  // Overview aggregates cross-board connections; selection reveals exact card
  // endpoints. Local relations remain in the inspector, never discarded from data.
  const drawingEdges = new Map<string, { edge: MemoryGraphEdge; from: string; to: string; count: number }>();
  for (const edge of edges) {
    const aggregate =
      map ||
      (!emphasized &&
        edge.kind !== 'member' &&
        !edge.missing &&
        visibleKeys.has(memoryKey({ boardId: edge.source.boardId })) &&
        visibleKeys.has(memoryKey({ boardId: edge.target.boardId })));
    const from = aggregate ? memoryKey({ boardId: edge.source.boardId }) : edge.from;
    const to = aggregate ? memoryKey({ boardId: edge.target.boardId }) : edge.to;
    if (aggregate && from === to && !edge.missing) continue;
    const key = aggregate ? JSON.stringify([from, to, edge.kind, edge.relationKind, edge.missing]) : edge.id;
    const old = drawingEdges.get(key);
    if (old) old.count++;
    else drawingEdges.set(key, { edge, from, to, count: 1 });
  }
  const graphFolders = new Map<string, Point[]>();
  if (!map)
    for (const node of visible) {
      const point = position(node.key);
      if (!point) continue;
      const folder = node.folder?.split('/')[0] ?? '';
      const group = graphFolders.get(folder) ?? [];
      group.push(point);
      graphFolders.set(folder, group);
    }
  // Only topology and force settings restart the simulation. Content/pin refreshes
  // repaint the same particles; dragged positions are retained across topology edits.
  const topology = JSON.stringify([
    allNodes.map((node) => [node.key, node.folder, node.nodeCount]),
    graph?.edges.map((edge) => [edge.from, edge.to, edge.kind, edge.missing]),
  ]);
  useEffect(() => {
    simulation.current?.stop();
    if (map) return;
    const sim = graphSimulation(allNodes, graph?.edges ?? [], particles.current, { repel, distance, size });
    simulation.current = sim;
    particles.current = new Map(sim.nodes().map((node) => [node.key, node]));
    sim.stop().tick(allNodes.length > 1000 ? 1 : 25);
    setPaint((value) => value + 1);
    sim.on('tick', () => setPaint((value) => value + 1));
    if (!paused) sim.restart();
    return () => {
      sim.stop();
    };
  }, [map, topology, repel, distance, size]);
  useEffect(() => {
    if (paused) simulation.current?.stop();
    else simulation.current?.alpha(0.35).restart();
  }, [paused]);

  const fitView = () => {
    const stage = viewport.current;
    if (!stage?.clientWidth || !stage.clientHeight) return;
    const bounds = visible.flatMap((node) => {
      const point = position(node.key);
      if (!point) return [];
      const halfWidth = map ? MAP_CARD.width / 2 : node.kind === 'board' ? 100 : 12;
      const halfHeight = map ? MAP_CARD.height / 2 : 38;
      return [
        { x: point.x - halfWidth, y: point.y - halfHeight },
        { x: point.x + halfWidth, y: point.y + halfHeight },
      ];
    });
    if (map)
      for (const region of generated.regions) {
        if (hiddenFolders.has(region.path.split('/')[0] ?? '') || (!unfiled && !region.path)) continue;
        bounds.push({ x: region.x, y: region.y }, { x: region.x + region.width, y: region.y + region.height });
      }
    if (!bounds.length) return;
    const x = Math.min(...bounds.map((p) => p.x)),
      y = Math.min(...bounds.map((p) => p.y));
    const width = Math.max(...bounds.map((p) => p.x)) - x,
      height = Math.max(...bounds.map((p) => p.y)) - y;
    const scale = Math.min(
      1.25,
      Math.max(
        0.08,
        Math.min((stage.clientWidth - 64) / Math.max(1, width), (stage.clientHeight - 100) / Math.max(1, height)),
      ),
    );
    setZoom(scale);
    setOffset({
      x: (stage.clientWidth - width * scale) / 2 - x * scale,
      y: (stage.clientHeight - height * scale) / 2 - y * scale - 12,
    });
  };
  useEffect(() => {
    fitPending.current = true;
  }, [map, focus, depth, collapsed]);
  useEffect(() => {
    if (
      fitPending.current &&
      graph &&
      (map || (graph.focus === (focus || null) && graph.depth === depth)) &&
      (visible.length || (map && generated.regions.length)) &&
      !gesture.current
    ) {
      fitPending.current = false;
      fitView();
    }
  }, [graph, map, paint, collapsed]);
  const zoomAt = (next: number, center?: Point) => {
    const stage = viewport.current;
    if (!stage) return;
    const p = center ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const scale = Math.min(3, Math.max(0.08, next));
    setOffset({ x: p.x - ((p.x - offset.x) * scale) / zoom, y: p.y - ((p.y - offset.y) * scale) / zoom });
    setZoom(scale);
  };
  const selectNode = (node: MemoryGraphNode, recenter = false) => {
    setSelectedKey(node.key);
    const point = position(node.key);
    if (recenter && point && viewport.current)
      setOffset({
        x: viewport.current.clientWidth / 2 - point.x * zoom,
        y: viewport.current.clientHeight / 2 - point.y * zoom,
      });
  };
  const endGesture = (cancelled: boolean) => {
    const drag = gesture.current;
    gesture.current = null;
    if (!drag) return;
    suppressClick.current = drag.moved;
    if (!drag.key) return;
    const key = drag.key;
    const clear = () =>
      setMoved((old) => {
        const next = { ...old };
        delete next[key];
        return next;
      });
    if (map && drag.boardId && drag.moved && !cancelled) {
      const p = drag.current ?? drag.origin;
      void updateBoard(drag.boardId, {
        mapPosition: { x: p.x - MAP_CARD.width / 2, y: p.y - MAP_CARD.height / 2 },
      }).finally(clear);
    } else clear();
    if (!map && cancelled) {
      const p = particles.current.get(key);
      if (p) {
        p.fx = drag.origin.x;
        p.fy = drag.origin.y;
        p.x = drag.origin.x;
        p.y = drag.origin.y;
        setPaint((value) => value + 1);
      }
    }
  };
  const connectionCount = (node: MemoryGraphNode) =>
    new Set(
      (graph?.edges ?? [])
        .filter(
          (edge) =>
            edge.kind !== 'member' && (edge.source.boardId === node.boardId || edge.target.boardId === node.boardId),
        )
        .map((edge) => (edge.source.boardId === node.boardId ? edge.target.boardId : edge.source.boardId))
        .filter((id) => id !== node.boardId),
    ).size;

  return (
    <main
      class={`home-memory is-${mode.toLowerCase()}${sidebar ? ' sidebar-open' : ''}`}
      aria-label={`Library ${mode}`}
    >
      <div class="home-memory-toolbar">
        <span>
          {allNodes.filter((node) => node.kind === 'board').length} boards ·{' '}
          {map
            ? boards.reduce((total, board) => total + board.nodeCount, 0)
            : allNodes.filter((node) => node.kind === 'card').length}{' '}
          cards · {graph?.edges.filter((edge) => edge.kind !== 'member').length ?? 0} links
        </span>
        <span class={`home-memory-live${error ? ' is-error' : ''}`} role="status">
          {error ? 'Update failed' : loading ? 'Updating…' : 'Live'}
        </span>
        <button
          type="button"
          class="home-button home-memory-sidebar-toggle"
          aria-expanded={sidebar}
          onClick={() => setSidebar(!sidebar)}
        >
          Filters & details
        </button>
      </div>
      <div class="home-memory-body">
        <div
          class="home-memory-stage"
          ref={viewport}
          aria-label="Pan the memory view"
          onWheel={(event) => {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            zoomAt(zoom * Math.exp(-event.deltaY * 0.0015), {
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            });
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
            suppressClick.current = false;
            gesture.current = {
              id: event.pointerId,
              start: { x: event.clientX, y: event.clientY },
              origin: offset,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = gesture.current;
            if (!drag || drag.id !== event.pointerId) return;
            const dx = event.clientX - drag.start.x,
              dy = event.clientY - drag.start.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
            if (!drag.moved) return;
            const point = {
              x: drag.origin.x + dx / (drag.key ? zoom : 1),
              y: drag.origin.y + dy / (drag.key ? zoom : 1),
            };
            drag.current = point;
            if (!drag.key) setOffset(point);
            else if (map) setMoved((old) => ({ ...old, [drag.key!]: point }));
            else {
              const p = particles.current.get(drag.key);
              if (p) {
                p.fx = point.x;
                p.fy = point.y;
                p.x = point.x;
                p.y = point.y;
                setPaint((value) => value + 1);
              }
            }
          }}
          onPointerUp={() => endGesture(false)}
          onPointerCancel={() => endGesture(true)}
        >
          <div
            class="home-memory-world"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, '--memory-zoom': zoom }}
          >
            {!map &&
              [...graphFolders].map(([folder, points]) => {
                const left = Math.min(...points.map((p) => p.x)) - 36;
                const top = Math.min(...points.map((p) => p.y)) - 52;
                return (
                  <div
                    key={folder}
                    class="home-memory-cluster"
                    style={{
                      left,
                      top,
                      width: Math.max(...points.map((p) => p.x)) - left + 36,
                      height: Math.max(...points.map((p) => p.y)) - top + 46,
                    }}
                  >
                    <span>{folder || 'Unfiled'}</span>
                  </div>
                );
              })}
            {map &&
              generated.regions
                .filter((region) => !hiddenFolders.has(region.path.split('/')[0] ?? '') && (unfiled || region.path))
                .map((region) => (
                  <div
                    key={region.path}
                    class={`home-memory-region${region.depth ? ' is-nested' : ''}`}
                    style={{ left: region.x, top: region.y, width: region.width, height: region.height }}
                  >
                    <button
                      type="button"
                      aria-expanded={!region.collapsed}
                      onClick={() =>
                        setCollapsed((old) => {
                          const next = new Set(old);
                          if (next.has(region.path)) next.delete(region.path);
                          else next.add(region.path);
                          return next;
                        })
                      }
                    >
                      {region.collapsed ? '▸' : '▾'} {region.path.split('/').at(-1) || 'Unfiled'}{' '}
                      <small>{region.count} boards</small>
                    </button>
                  </div>
                ))}
            <svg class="home-memory-links" aria-hidden="true">
              {[...drawingEdges.values()].map(({ edge, from, to, count }) => {
                const a = position(from),
                  b = position(to);
                if (!a) return null;
                const hi =
                  emphasized &&
                  (emphasized.kind === 'board'
                    ? edge.source.boardId === emphasized.boardId || edge.target.boardId === emphasized.boardId
                    : edge.from === emphasized.key || edge.to === emphasized.key);
                const end = b ?? { x: a.x + 100, y: a.y - 70 };
                const startY = map ? a.y + (end.y > a.y ? MAP_CARD.height / 2 : -MAP_CARD.height / 2) : a.y;
                const endY = map && b ? end.y + (end.y > a.y ? -MAP_CARD.height / 2 : MAP_CARD.height / 2) : end.y;
                return (
                  <g
                    key={edge.id}
                    style={
                      edge.kind === 'card' && !edge.missing
                        ? {
                            stroke: `var(--c-rel-${relationDefinition({ kind: edge.relationKind, type: edge.type }, boards.find((board) => board.id === edge.source.boardId)?.relationVocabulary).ink})`,
                          }
                        : undefined
                    }
                    class={`memory-edge edge-${edge.kind}${edge.missing ? ' is-missing' : ''}${hi ? ' is-emphasized' : emphasized ? ' is-dimmed' : ''}`}
                  >
                    <path
                      d={
                        map
                          ? `M ${a.x} ${startY} C ${a.x} ${(startY + endY) / 2}, ${end.x} ${(startY + endY) / 2}, ${end.x} ${endY}`
                          : `M ${a.x} ${a.y} Q ${(a.x + end.x) / 2 + (edge.kind === 'member' ? 0 : 12)} ${(a.y + end.y) / 2 - (edge.kind === 'member' ? 0 : 12)} ${end.x} ${end.y}`
                      }
                    />
                    {count > 1 && (
                      <text class="home-memory-link-count" x={(a.x + end.x) / 2} y={(a.y + end.y) / 2 - 6}>
                        {count} links
                      </text>
                    )}
                    {edge.missing && (
                      <text x={end.x} y={end.y - 5}>
                        ⚠ Missing {edge.kind} link
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {visible.map((node, index) => {
              const point = position(node.key);
              if (!point) return null;
              const board = boards.find((entry) => entry.id === node.boardId);
              const radius = graphRadius(node, size);
              const hi = neighbors.has(node.key);
              return (
                <article
                  key={node.key}
                  class={`home-memory-node is-${node.kind}${node.inContext ? ' in-context' : ''}${selectedKey === node.key ? ' is-selected' : ''}${hi ? ' is-emphasized' : emphasized ? ' is-dimmed' : ''}`}
                  style={{
                    left: point.x,
                    top: point.y,
                    ...(!map
                      ? {
                          width: Math.max(radius * 2, (node.kind === 'board' ? 16 : 4) / zoom),
                          height: Math.max(radius * 2, (node.kind === 'board' ? 16 : 4) / zoom),
                          '--label-opacity': Math.max(0.15, 1 - labelFade / 100),
                        }
                      : {}),
                  }}
                  onPointerEnter={() => {
                    if (!gesture.current) setHoverKey(node.key);
                  }}
                  onPointerLeave={() => setHoverKey(null)}
                >
                  <button
                    type="button"
                    class="home-memory-select"
                    aria-label={`${node.kind}: ${node.title}`}
                    aria-pressed={selectedKey === node.key}
                    onFocus={(event) => {
                      if (!gesture.current && event.currentTarget.matches(':focus-visible')) selectNode(node, true);
                    }}
                    onClick={() => {
                      if (!suppressClick.current) {
                        selectNode(node);
                        setSidebar(true);
                      }
                      suppressClick.current = false;
                    }}
                    onDblClick={() => void openMemoryTarget(node)}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      suppressClick.current = false;
                      gesture.current = {
                        id: event.pointerId,
                        start: { x: event.clientX, y: event.clientY },
                        origin: { x: point.x, y: point.y },
                        key: node.key,
                        boardId: node.boardId,
                        moved: false,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void openMemoryTarget(node);
                      }
                      if (event.key.startsWith('Arrow')) {
                        event.preventDefault();
                        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
                        const nextIndex = (index + step + visible.length) % visible.length;
                        const next = visible[nextIndex];
                        if (next) {
                          selectNode(next, true);
                          viewport.current
                            ?.querySelectorAll<HTMLButtonElement>('.home-memory-select')
                            [nextIndex]?.focus();
                        }
                      }
                    }}
                  >
                    <strong>{node.title}</strong>
                    <span>
                      {node.kind === 'board'
                        ? `${node.nodeCount ?? 0} cards · ${connectionCount(node)} connected boards`
                        : (node.type ?? 'card')}
                    </span>
                    {map && <span class="home-memory-summary">{node.summary || 'No summary yet'}</span>}
                    {node.inContext && <span class="home-memory-context">⌖ In context</span>}
                  </button>
                  {map && board && <BoardPinButton board={board} />}
                </article>
              );
            })}
          </div>
          <div class="home-memory-zoom">
            <button type="button" class="home-button" aria-label="Zoom out" onClick={() => zoomAt(zoom / 1.2)}>
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" class="home-button" aria-label="Zoom in" onClick={() => zoomAt(zoom * 1.2)}>
              +
            </button>
            <button type="button" class="home-button" onClick={fitView}>
              Fit view
            </button>
          </div>
          {(!graph || !visible.length || error) && (
            <div class="home-memory-status" role="status">
              {error ? (
                <>
                  Memory update failed.{' '}
                  <button type="button" class="home-button" onClick={() => setRevision(revision + 1)}>
                    Retry
                  </button>
                </>
              ) : !graph ? (
                'Loading memory…'
              ) : map && generated.hidden.size ? (
                'Folders collapsed. Expand a folder to see its boards.'
              ) : (
                'No matching nodes.'
              )}
            </div>
          )}
        </div>
        <aside ref={sidebarElement} class="home-memory-sidebar" aria-label={`${mode} settings`}>
          <section>
            <h2>Filters</h2>
            <label class="home-memory-search">
              <span class="sr-only">Find boards and cards</span>
              <input
                type="search"
                value={query}
                placeholder="Search boards and cards…"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <Filter
              label="Boards"
              count={allNodes.filter((node) => node.kind === 'board').length}
              checked={showBoards}
              change={() => setShowBoards(!showBoards)}
            />
            {!map && (
              <Filter
                label="Cards"
                count={allNodes.filter((node) => node.kind === 'card').length}
                checked={showCards}
                change={() => setShowCards(!showCards)}
              />
            )}
            <Filter
              label="Only in context"
              count={allNodes.filter((node) => node.inContext).length}
              checked={context}
              change={() => setContext(!context)}
            />
            <Filter
              label="Include unfiled"
              count={allNodes.filter((node) => node.kind === 'board' && !node.folder).length}
              checked={unfiled}
              change={() => setUnfiled(!unfiled)}
            />
          </section>
          <section>
            <h2>Groups · by folder</h2>
            {[...folderCounts]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([folder, count]) => (
                <Filter
                  key={folder}
                  label={folder || 'Unfiled'}
                  count={count}
                  checked={!hiddenFolders.has(folder)}
                  change={() =>
                    setHiddenFolders((old) => {
                      const next = new Set(old);
                      if (next.has(folder)) next.delete(folder);
                      else next.add(folder);
                      return next;
                    })
                  }
                />
              ))}
          </section>
          <section>
            <h2>Links</h2>
            {kinds
              .filter((kind) => !map || kind !== 'member')
              .map((kind) => (
                <div key={kind} class={`memory-legend-${kind}`}>
                  <Filter
                    label={linkNames[kind]}
                    count={graph?.edges.filter((edge) => edge.kind === kind).length ?? 0}
                    checked={!hiddenLinks.has(kind)}
                    change={() =>
                      setHiddenLinks((old) => {
                        const next = new Set(old);
                        if (next.has(kind)) next.delete(kind);
                        else next.add(kind);
                        return next;
                      })
                    }
                  />
                </div>
              ))}
          </section>
          {!map && (
            <>
              <section>
                <h2>Local graph</h2>
                <label>
                  Focus
                  <select
                    value={focus}
                    onChange={(event) => {
                      fitPending.current = true;
                      setFocus(event.currentTarget.value);
                    }}
                  >
                    <option value="">Whole library</option>
                    <option value="pins">Workspace pins</option>
                    {boards.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.name}
                      </option>
                    ))}
                    {focus && focus !== 'pins' && !boards.some((board) => board.id === focus) && (
                      <option value={focus}>Selected node</option>
                    )}
                  </select>
                </label>
                <label>
                  Depth
                  <select
                    value={depth}
                    onChange={(event) => {
                      fitPending.current = true;
                      setDepth(Number(event.currentTarget.value));
                    }}
                  >
                    {[0, 1, 2, 3, 4].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </section>
              <section>
                <h2>Display and forces</h2>
                <label>
                  Label fade
                  <input
                    type="range"
                    min="0"
                    max="85"
                    value={labelFade}
                    onInput={(event) => setLabelFade(Number(event.currentTarget.value))}
                  />
                </label>
                <label>
                  Node size
                  <input
                    type="range"
                    min="0.6"
                    max="1.8"
                    step="0.1"
                    value={size}
                    onInput={(event) => setSize(Number(event.currentTarget.value))}
                  />
                </label>
                <label>
                  Repel
                  <input
                    type="range"
                    min="0.2"
                    max="3"
                    step="0.1"
                    value={repel}
                    onInput={(event) => setRepel(Number(event.currentTarget.value))}
                  />
                </label>
                <label>
                  Link distance
                  <input
                    type="range"
                    min="60"
                    max="300"
                    step="10"
                    value={distance}
                    onInput={(event) => setDistance(Number(event.currentTarget.value))}
                  />
                </label>
                <div class="home-memory-actions">
                  <button type="button" class="home-button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
                    {paused ? 'Resume layout' : 'Pause layout'}
                  </button>
                  <button
                    type="button"
                    class="home-button"
                    onClick={() => {
                      for (const p of particles.current.values()) {
                        p.fx = null;
                        p.fy = null;
                      }
                      setPaused(false);
                      simulation.current?.alpha(0.7).restart();
                    }}
                  >
                    Rearrange
                  </button>
                </div>
              </section>
            </>
          )}
          {selected ? (
            <section class="home-memory-details" role="complementary" aria-label="Selection details">
              <button
                type="button"
                class="home-memory-clear"
                aria-label="Close details"
                onClick={() => setSelectedKey(null)}
              >
                ×
              </button>
              <h3>{selected.title}</h3>
              <p>
                {selected.folder || 'Unfiled'} · {selected.type ?? selected.kind}
              </p>
              <p>
                {selected.kind === 'board'
                  ? `${selected.nodeCount ?? 0} cards · ${connectionCount(selected)} connected boards`
                  : selected.summary}
              </p>
              <p class={selected.inContext ? 'memory-context-legend' : ''}>
                {selected.inContext ? '⌖ In context' : 'Not in context'}
              </p>
              <div class="home-memory-actions">
                <button type="button" class="home-button is-primary" onClick={() => void openMemoryTarget(selected)}>
                  Open {selected.kind}
                </button>
                {selectedBoard && <BoardPinButton board={selectedBoard} />}
                {!map && (
                  <button
                    type="button"
                    class="home-button"
                    onClick={() => {
                      fitPending.current = true;
                      setFocus(selected.key);
                    }}
                  >
                    Focus here
                  </button>
                )}
                {map && (
                  <button
                    type="button"
                    class="home-button"
                    onClick={() => void updateBoard(selected.boardId, { mapPosition: null })}
                  >
                    Reset position
                  </button>
                )}
              </div>
              {map && <p>{selected.summary || 'No summary yet.'}</p>}
              <details class="home-memory-connections" open>
                <summary>Connections</summary>
                {map && !detailGraph && (
                  <p role="status">
                    {details?.key === selectedKey ? 'Connections could not be loaded.' : 'Loading connections…'}
                  </p>
                )}
                <ul>
                  {(detailGraph?.edges ?? [])
                    .filter(
                      (edge) =>
                        edge.kind !== 'member' &&
                        (selected.kind === 'board'
                          ? edge.source.boardId === selected.boardId || edge.target.boardId === selected.boardId
                          : edge.from === selected.key || edge.to === selected.key),
                    )
                    .map((edge) => {
                      const outgoing =
                        selected.kind === 'board'
                          ? edge.source.boardId === selected.boardId
                          : edge.from === selected.key;
                      const target = outgoing ? edge.target : edge.source;
                      const other = detailGraph?.nodes.find((node) => node.key === memoryKey(target));
                      return (
                        <li key={edge.id}>
                          <span>
                            {outgoing ? '→' : '←'}{' '}
                            {edge.kind === 'card'
                              ? relationText({ ...edge, kind: edge.relationKind })
                              : `${edge.kind}${edge.label ? ` · ${edge.label}` : ''}`}
                          </span>
                          {edge.missing ? (
                            <span class="home-memory-missing">
                              ⚠ Missing target: {target.boardId}
                              {target.cardId ? ` / ${target.cardId}` : ''}
                            </span>
                          ) : (
                            <button type="button" class="home-button" onClick={() => void openMemoryTarget(target)}>
                              {other?.title ?? target.boardId}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  {(detailGraph?.unresolvedLinks ?? [])
                    .filter((link) =>
                      selected.kind === 'board'
                        ? link.source.boardId === selected.boardId
                        : memoryKey(link.source) === selected.key,
                    )
                    .map((link) => (
                      <li key={`${memoryKey(link.source)}:${link.ref}`} class="home-memory-missing">
                        ⚠ Unresolved wiki: [[{link.ref}]]
                      </li>
                    ))}
                </ul>
              </details>
            </section>
          ) : (
            <p class="home-memory-help">
              Overview groups links between boards. Select a board or card to see exact connections. Double-click to
              open.
            </p>
          )}
        </aside>
      </div>
      <div class="home-memory-legend" aria-label="Legend">
        <span>{map ? '▣' : '●'} Board</span>
        {!map && <span>• Card</span>}
        <span class="memory-context-legend">⌖ In context</span>
        <span class="memory-legend-portal">━ Portal</span>
        <span class="memory-legend-wiki">┄ Wiki</span>
        <span class="memory-legend-card">━ Relation</span>
        <span>
          {map ? 'Drag boards to save positions' : 'Drag nodes to arrange'} · drag background to pan · scroll to zoom
        </span>
      </div>
    </main>
  );
}
