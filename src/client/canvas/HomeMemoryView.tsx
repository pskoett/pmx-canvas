import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memoryKey, type MemoryGraph, type MemoryGraphNode, type MemoryTarget } from '../../shared/memory-graph.js';
import { relationDefinition, relationText } from '../../shared/relations.js';
import {
  boardList,
  browsingMemory,
  catalogEpoch,
  memoryGraphRevision,
  openMemoryTarget,
  updateBoard,
} from '../state/boards-store';
import { requestJson } from '../state/intent-bridge';
import { isSelectionEscape } from '../utils/keyboard';
import { BoardPinButton } from './BoardPinButton';
import { graphLayout, graphRadius, MAP_CARD, mapLayout, type GraphLayout, type Point } from './memory-layout';
import { graphDisplay, type GraphConnection } from './graph-display';

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
  const [labelFade, setLabelFade] = useState(15);
  const [sidebar, setSidebar] = useState(false);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [revealed, setRevealed] = useState(new Set<string>());
  const [trail, setTrail] = useState<Array<{ key: string; focus: string; depth: number }>>([]);
  const [navigationError, setNavigationError] = useState('');
  const [following, setFollowing] = useState(false);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const layoutCache = useRef<GraphLayout>();
  const navigation = useRef(0);
  const focusAfterReveal = useRef<string | null>(null);
  const preserveCamera = useRef(false);
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
  const clearSelection = () => {
    navigation.current++;
    setSelectedKey(null);
    setRevealed(new Set());
    setTrail([]);
    setFollowing(false);
    setNavigationError('');
  };

  useLayoutEffect(() => {
    browsingMemory.value = true;
  }, []);
  useLayoutEffect(() => {
    if (!selectedKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isSelectionEscape(event)) return;
      event.preventDefault();
      clearSelection();
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
      const epoch = catalogEpoch;
      const sourceRevision = memoryGraphRevision.peek();
      const catalog = boardList.peek();
      const result = await requestJson<MemoryGraph | null>('memoryGraph', `/api/canvas/memory-graph?${params}`, null);
      if (cancelled) return;
      if (
        !map &&
        (epoch !== catalogEpoch || sourceRevision !== memoryGraphRevision.peek() || catalog !== boardList.peek())
      ) {
        running = false;
        schedule();
        return;
      }
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
    if (!selectedKey) return;
    const chosen = graph?.nodes.find((node) => node.key === selectedKey);
    if (!map && chosen?.linksComplete !== false) return;
    let cancelled = false;
    setDetails(null);
    const params = new URLSearchParams({ focus: selectedKey, depth: chosen?.kind === 'card' ? '1' : '2' });
    const epoch = catalogEpoch;
    const sourceRevision = memoryGraphRevision.peek();
    void requestJson<MemoryGraph | null>('memoryGraph', `/api/canvas/memory-graph?${params}`, null).then((result) => {
      if (!cancelled && epoch === catalogEpoch && sourceRevision === memoryGraphRevision.peek())
        setDetails({
          key: selectedKey,
          graph: result && Array.isArray(result.nodes) && Array.isArray(result.edges) ? result : null,
        });
    });
    return () => {
      cancelled = true;
    };
  }, [map, selectedKey, graph, liveRevision]);

  const catalogNodes: MemoryGraphNode[] = useMemo(
    () =>
      boards.map((board) => ({
        key: memoryKey({ boardId: board.id }),
        boardId: board.id,
        kind: 'board',
        title: board.name,
        summary: '',
        folder: board.folder,
        inContext: !!board.pin,
        summaryOnly: true,
        nodeCount: board.nodeCount,
        linksComplete: false,
      })),
    [boards],
  );
  const allNodes = useMemo(() => {
    const source = [...(graph?.nodes ?? [])];
    if (!map)
      for (const node of catalogNodes)
        if (source.some((entry) => entry.boardId === node.boardId) && !source.some((entry) => entry.key === node.key))
          source.push(node);
    return source
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
      });
  }, [graph, map, boards, catalogNodes]);
  const generated = useMemo(() => mapLayout(allNodes, collapsed), [allNodes, collapsed]);
  const geometry = useMemo(() => {
    if (map) return null;
    const nodes = new Map(catalogNodes.map((node) => [node.key, node]));
    for (const node of allNodes) nodes.set(node.key, node);
    const next = graphLayout([...nodes.values()], layoutCache.current);
    layoutCache.current = next;
    return next;
  }, [map, catalogNodes, allNodes, layoutRevision]);
  const folderCounts = new Map<string, number>();
  for (const node of new Map(allNodes.map((node) => [node.boardId, node])).values()) {
    const folder = node.folder?.split('/')[0] ?? '';
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }
  const eligible = new Set(
    allNodes
      .filter(
        (node) =>
          (!map && (revealed.has(node.key) || revealed.has(memoryKey({ boardId: node.boardId })))) ||
          ((!context || node.inContext) &&
            (unfiled || !!node.folder) &&
            !hiddenFolders.has(node.folder?.split('/')[0] ?? '') &&
            (!map || !generated.hidden.has(node.key)) &&
            `${node.title} ${node.summary} ${node.folder ?? ''} ${!map ? (boards.find((board) => board.id === node.boardId)?.name ?? '') : ''}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())),
      )
      .map((node) => node.key),
  );
  // A matching card needs its structural board hub even before expansion.
  if (!map) for (const node of allNodes) if (eligible.has(node.key)) eligible.add(memoryKey({ boardId: node.boardId }));
  const display = graphDisplay(allNodes, graph?.edges ?? [], {
    expanded,
    eligible,
    hiddenLinks,
    selectedKey,
    showBoards: showBoards || revealed.size > 0,
    showCards: showCards || revealed.size > 0,
  });
  const visible = map
    ? allNodes.filter((node) => eligible.has(node.key) && (node.kind === 'board' ? showBoards : showCards))
    : display.nodes;
  const visibleKeys = new Set(visible.map((node) => node.key));
  const position = (key: string): Point | undefined => {
    if (moved[key]) return moved[key];
    if (map) return generated.positions.get(key);
    const point = geometry?.positions.get(key);
    const node = allNodes.find((entry) => entry.key === key);
    const parentKey = node?.kind === 'card' ? memoryKey({ boardId: node.boardId }) : '';
    const parent = geometry?.positions.get(parentKey);
    return point && parent && moved[parentKey]
      ? { x: point.x + moved[parentKey].x - parent.x, y: point.y + moved[parentKey].y - parent.y }
      : point;
  };
  const edges = (graph?.edges ?? []).filter((edge) => {
    if (hiddenLinks.has(edge.kind) || (map && edge.kind === 'member')) return false;
    const from = map ? memoryKey({ boardId: edge.source.boardId }) : edge.from;
    const to = map ? memoryKey({ boardId: edge.target.boardId }) : edge.to;
    return visibleKeys.has(from) && (edge.missing || visibleKeys.has(to)) && (edge.missing || from !== to);
  });
  const selected = allNodes.find((node) => node.key === selectedKey);
  const emphasized = allNodes.find((node) => node.key === (map ? (hoverKey ?? selectedKey) : selectedKey));
  const neighbors = map ? new Set<string>(emphasized ? [emphasized.key] : []) : display.neighbors;
  for (const edge of edges) {
    if (!map || !emphasized) break;
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
  const detailGraph =
    (map || selected?.linksComplete === false) && details?.key === selectedKey && details.graph
      ? details.graph
      : map
        ? null
        : graph;
  const selectedBoard = boards.find((board) => board.id === selected?.boardId);
  const mapEdges = new Map<string, GraphConnection>();
  for (const edge of edges) {
    if (!map) break;
    const from = memoryKey({ boardId: edge.source.boardId });
    const to = memoryKey({ boardId: edge.target.boardId });
    const key = JSON.stringify([from, to, edge.kind, edge.relationKind, edge.missing]);
    const old = mapEdges.get(key);
    if (old) old.edges.push(edge);
    else mapEdges.set(key, { key, from, to, kind: edge.kind, exact: false, edges: [edge], incident: 0 });
  }
  const drawingEdges = map ? [...mapEdges.values()] : display.connections;
  const graphRegions = (geometry?.regions ?? []).filter((region) =>
    visible.some(
      (node) => (node.folder ?? '') === region.path || (!!region.path && node.folder?.startsWith(`${region.path}/`)),
    ),
  );
  useEffect(() => {
    if (!graph || map || graph.focus !== (focus || null) || graph.depth !== depth) return;
    if (selectedKey && !allNodes.some((node) => node.key === selectedKey)) clearSelection();
    setRevealed((old) => new Set([...old].filter((key) => allNodes.some((node) => node.key === key))));
    setTrail((old) =>
      old.filter((entry) =>
        boards.some(
          (board) =>
            memoryKey({ boardId: board.id }) === entry.key || entry.key.startsWith(`[${JSON.stringify(board.id)},`),
        ),
      ),
    );
  }, [graph, boards]);

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
    else
      for (const region of graphRegions)
        bounds.push({ x: region.x, y: region.y }, { x: region.x + region.width, y: region.y + region.height });
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
    if (preserveCamera.current) preserveCamera.current = false;
    else fitPending.current = true;
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
  }, [graph, map, collapsed]);
  const zoomAt = (next: number, center?: Point) => {
    const stage = viewport.current;
    if (!stage) return;
    const p = center ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const scale = Math.min(3, Math.max(0.08, next));
    setOffset({ x: p.x - ((p.x - offset.x) * scale) / zoom, y: p.y - ((p.y - offset.y) * scale) / zoom });
    setZoom(scale);
  };
  const selectNode = (node: MemoryGraphNode, recenter = false) => {
    navigation.current++;
    setFollowing(false);
    setNavigationError('');
    setTrail([]);
    setSelectedKey(node.key);
    const point = position(node.key);
    if (recenter && point && viewport.current) {
      const stage = viewport.current;
      const x = point.x * zoom + offset.x,
        y = point.y * zoom + offset.y;
      setOffset(
        map
          ? { x: stage.clientWidth / 2 - point.x * zoom, y: stage.clientHeight / 2 - point.y * zoom }
          : {
              x: offset.x + Math.max(32 - x, 0) - Math.max(x - stage.clientWidth + 32, 0),
              y: offset.y + Math.max(40 - y, 0) - Math.max(y - stage.clientHeight + 60, 0),
            },
      );
    }
  };
  const follow = async (target: MemoryTarget, back?: { key: string; focus: string; depth: number }) => {
    const token = ++navigation.current;
    const epoch = catalogEpoch;
    const sourceRevision = memoryGraphRevision.peek();
    const key = memoryKey(target);
    const nextFocus = back ? back.focus : allNodes.some((node) => node.key === key) ? focus : key;
    const nextDepth = back?.depth ?? depth;
    setFollowing(true);
    setNavigationError('');
    if (nextFocus !== focus || nextDepth !== depth || !allNodes.some((node) => node.key === key)) {
      const params = new URLSearchParams({ depth: String(nextDepth) });
      if (nextFocus) params.set('focus', nextFocus);
      const result = await requestJson<MemoryGraph | null>('memoryGraph', `/api/canvas/memory-graph?${params}`, null);
      if (token !== navigation.current) return;
      if (
        epoch !== catalogEpoch ||
        sourceRevision !== memoryGraphRevision.peek() ||
        !result?.nodes?.some((node) => node.key === key) ||
        !Array.isArray(result.edges)
      ) {
        setFollowing(false);
        setNavigationError('The library changed or this endpoint could not be loaded. Select the connection again.');
        return;
      }
      preserveCamera.current = true;
      fitPending.current = false;
      setGraph(result);
      setFocus(nextFocus);
      setDepth(nextDepth);
    }
    if (back) setTrail((old) => old.slice(0, -1));
    else if (selectedKey) setTrail((old) => [...old, { key: selectedKey, focus, depth }]);
    setExpanded((old) => new Set([...old, target.boardId]));
    setRevealed((old) => new Set([...old, key, memoryKey({ boardId: target.boardId })]));
    setSelectedKey(key);
    setFollowing(false);
    if (!back) focusAfterReveal.current = key;
    setSidebar(false);
  };
  useLayoutEffect(() => {
    const key = focusAfterReveal.current;
    const point = key ? position(key) : null;
    const stage = viewport.current;
    if (!key || !point || !stage || !visibleKeys.has(key)) return;
    focusAfterReveal.current = null;
    const x = point.x * zoom + offset.x,
      y = point.y * zoom + offset.y;
    setOffset({
      x: offset.x + Math.max(32 - x, 0) - Math.max(x - stage.clientWidth + 32, 0),
      y: offset.y + Math.max(40 - y, 0) - Math.max(y - stage.clientHeight + 60, 0),
    });
    const index = visible.findIndex((node) => node.key === key);
    stage.querySelectorAll<HTMLButtonElement>('.home-memory-select')[index]?.focus({ preventScroll: true });
  }, [selectedKey, graph, expanded]);
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
    } else if (map) clear();
    else if (cancelled) setMoved((old) => ({ ...old, [key]: drag.origin }));
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
        {!map && (
          <>
            <button
              type="button"
              class="home-button"
              onClick={() =>
                setExpanded(new Set(allNodes.filter((node) => node.kind === 'board').map((node) => node.boardId)))
              }
            >
              Expand all
            </button>
            <button
              type="button"
              class="home-button"
              onClick={() => {
                setExpanded(new Set());
                clearSelection();
              }}
            >
              Collapse all
            </button>
            <span class="home-memory-counts">
              {display.exactCount} exact · {display.bundledCount} bundled ·{' '}
              {[...display.internal.values()].reduce((a, b) => a + b, 0)} internal
            </span>
          </>
        )}
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
            else setMoved((old) => ({ ...old, [drag.key!]: point }));
          }}
          onPointerUp={() => endGesture(false)}
          onPointerCancel={() => endGesture(true)}
        >
          <div
            class="home-memory-world"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, '--memory-zoom': zoom }}
          >
            {!map &&
              graphRegions.map((region) => (
                <div
                  key={region.path}
                  class="home-memory-cluster"
                  data-folder={region.path}
                  style={{ left: region.x, top: region.y, width: region.width, height: region.height }}
                >
                  <span>
                    {region.path || 'Unfiled'} · {region.count} {region.count === 1 ? 'board' : 'boards'}
                  </span>
                </div>
              ))}
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
              {drawingEdges.map(({ key, edges: evidence, from, to, exact, incident }, index) => {
                const edge = evidence[0];
                const count = evidence.length;
                const a = position(from),
                  b = position(to);
                if (!a) return null;
                const hi = map
                  ? emphasized &&
                    (emphasized.kind === 'board'
                      ? edge.source.boardId === emphasized.boardId || edge.target.boardId === emphasized.boardId
                      : edge.from === emphasized.key || edge.to === emphasized.key)
                  : incident > 0;
                const definition = relationDefinition(
                  { kind: edge.relationKind, type: edge.type },
                  boards.find((board) => board.id === edge.source.boardId)?.relationVocabulary,
                );
                const ink = edge.missing
                  ? 'var(--c-warn)'
                  : (map || exact) && edge.kind === 'card'
                    ? `var(--c-rel-${definition.ink})`
                    : undefined;
                const endpoint = b ?? { x: a.x + 100, y: a.y - 70 };
                const length = Math.hypot(endpoint.x - a.x, endpoint.y - a.y) || 1;
                const targetNode = allNodes.find((node) => node.key === to);
                const radius = targetNode ? graphRadius(targetNode, size) + 4 : 0;
                const end =
                  !map && b
                    ? { x: b.x - ((b.x - a.x) * radius) / length, y: b.y - ((b.y - a.y) * radius) / length }
                    : endpoint;
                const bend = edge.kind === 'member' || !exact ? 0 : 24;
                const cx = (a.x + end.x) / 2 - ((end.y - a.y) * bend) / length;
                const cy = (a.y + end.y) / 2 + ((end.x - a.x) * bend) / length;
                const directed =
                  !map && exact && edge.kind !== 'member' && (edge.kind !== 'card' || definition.directed);
                const startY = map ? a.y + (end.y > a.y ? MAP_CARD.height / 2 : -MAP_CARD.height / 2) : a.y;
                const endY = map && b ? end.y + (end.y > a.y ? -MAP_CARD.height / 2 : MAP_CARD.height / 2) : end.y;
                // Stagger counts along bundles instead of stacking them at crossings.
                const fraction = map ? 0.5 : 0.58 + (index % 3) * 0.1;
                const labelAt = map || a.y <= end.y ? fraction : 1 - fraction;
                return (
                  <g
                    key={key}
                    data-from={from}
                    data-to={to}
                    data-count={count}
                    data-exact={exact}
                    style={ink ? { stroke: ink } : undefined}
                    class={`memory-edge edge-${edge.kind}${!map && !exact ? ' is-bundle' : ''}${edge.missing ? ' is-missing' : ''}${hi ? ' is-emphasized' : emphasized ? ' is-dimmed' : ''}`}
                  >
                    {directed && (
                      <defs>
                        <marker
                          id={`memory-arrow-${index}`}
                          viewBox="0 0 10 10"
                          refX="9"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: ink ?? 'var(--c-muted)', stroke: 'none' }} />
                        </marker>
                      </defs>
                    )}
                    {!map && (
                      <title>
                        {exact
                          ? relationText({ ...edge, kind: edge.relationKind ?? edge.kind })
                          : `${count} links, combined directions and types. Inspect individual connections in details.`}
                      </title>
                    )}
                    <path
                      marker-end={directed ? `url(#memory-arrow-${index})` : undefined}
                      d={
                        map
                          ? `M ${a.x} ${startY} C ${a.x} ${(startY + endY) / 2}, ${end.x} ${(startY + endY) / 2}, ${end.x} ${endY}`
                          : from === to
                            ? `M ${a.x} ${a.y} C ${a.x + 60} ${a.y - 80}, ${a.x - 60} ${a.y - 80}, ${a.x} ${a.y - radius}`
                            : `M ${a.x} ${a.y} Q ${cx} ${cy} ${end.x} ${end.y}`
                      }
                    />
                    {(count > 1 || (!map && !exact && edge.kind !== 'member' && !edge.missing)) && (
                      <text
                        class="home-memory-link-count"
                        x={a.x + (end.x - a.x) * labelAt}
                        y={a.y + (end.y - a.y) * labelAt - 6 / (map ? 1 : zoom)}
                      >
                        {count}
                        {map ? ' links' : ''}
                        {!map && emphasized && incident > 0 && incident < count ? ` (${incident} selected)` : ''}
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
                  data-key={node.key}
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
                    aria-expanded={!map && node.kind === 'board' ? expanded.has(node.boardId) : undefined}
                    onFocus={(event) => {
                      if (map && !gesture.current && event.currentTarget.matches(':focus-visible'))
                        selectNode(node, true);
                    }}
                    onClick={() => {
                      if (!suppressClick.current) {
                        selectNode(node);
                        if (!map && node.kind === 'board')
                          setExpanded((old) => {
                            const next = new Set(old);
                            if (next.has(node.boardId)) next.delete(node.boardId);
                            else next.add(node.boardId);
                            return next;
                          });
                        if (map || node.kind === 'card') setSidebar(true);
                      }
                      suppressClick.current = false;
                    }}
                    onDblClick={() => {
                      if (map) void openMemoryTarget(node);
                    }}
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
                      if (map && event.key === 'Enter') {
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
                            [nextIndex]?.focus({ preventScroll: true });
                        }
                      }
                    }}
                  >
                    <strong>
                      {node.title}
                      {!map && node.kind === 'board' ? (expanded.has(node.boardId) ? ' −' : ' +') : ''}
                    </strong>
                    <span>
                      {node.kind === 'board'
                        ? map
                          ? `${node.nodeCount ?? 0} cards · ${connectionCount(node)} connected boards`
                          : `${node.nodeCount ?? 0} cards${display.internal.get(node.boardId) ? ` · ${display.internal.get(node.boardId)} internal` : ''}`
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
                      clearSelection();
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
                      navigation.current++;
                      setFollowing(false);
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
                <h2>Display</h2>
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
                <div class="home-memory-actions">
                  <button
                    type="button"
                    class="home-button"
                    onClick={() => {
                      setMoved({});
                      layoutCache.current = undefined;
                      setLayoutRevision((old) => old + 1);
                    }}
                  >
                    Reset layout
                  </button>
                </div>
              </section>
            </>
          )}
          {!map && revealed.size > 0 && (
            <p class="home-memory-help" role="status">
              Follow reveals endpoints even when filters hide them. Clear selection to restore filters. Local Focus
              shows the query being browsed.
            </p>
          )}
          {navigationError && (
            <p class="home-memory-missing" role="alert">
              {navigationError}
            </p>
          )}
          {following && <p role="status">Finding endpoint…</p>}
          {selected ? (
            <section class="home-memory-details" role="complementary" aria-label="Selection details">
              <button type="button" class="home-memory-clear" aria-label="Close details" onClick={clearSelection}>
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
                {!map && trail.length > 0 && (
                  <button
                    type="button"
                    class="home-button"
                    disabled={following}
                    onClick={() => {
                      const previous = trail.at(-1)!;
                      const [boardId, cardId] = JSON.parse(previous.key) as [string, string | null];
                      void follow({ boardId, ...(cardId ? { cardId } : {}) }, previous);
                    }}
                  >
                    Back
                  </button>
                )}
                <button type="button" class="home-button is-primary" onClick={() => void openMemoryTarget(selected)}>
                  Open {selected.kind}
                </button>
                {selectedBoard && <BoardPinButton board={selectedBoard} />}
                {!map && (
                  <button
                    type="button"
                    class="home-button"
                    onClick={() => {
                      navigation.current++;
                      setFollowing(false);
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
              {!map && selected.linksComplete === false && (
                <p class="home-memory-help">
                  Partial local graph. Connection details may include endpoints outside this query; Follow changes Local
                  Focus when needed.
                </p>
              )}
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
                      const directed =
                        map ||
                        edge.kind !== 'card' ||
                        relationDefinition(
                          { kind: edge.relationKind, type: edge.type },
                          boards.find((board) => board.id === edge.source.boardId)?.relationVocabulary,
                        ).directed;
                      const sourceTitle =
                        detailGraph?.nodes.find((node) => node.key === edge.from)?.title ?? edge.source.boardId;
                      const targetTitle =
                        detailGraph?.nodes.find((node) => node.key === edge.to)?.title ?? edge.target.boardId;
                      return (
                        <li key={edge.id}>
                          <span>
                            {directed ? (outgoing ? '→' : '←') : '↔'}{' '}
                            {edge.kind === 'card'
                              ? relationText({ ...edge, kind: edge.relationKind })
                              : `${edge.kind}${edge.label ? ` · ${edge.label}` : ''}`}
                          </span>
                          {!map && (
                            <small>
                              {sourceTitle} {directed ? '→' : '↔'} {targetTitle} ·{' '}
                              {other?.folder ??
                                boards.find((board) => board.id === target.boardId)?.folder ??
                                'Unfiled'}{' '}
                              / {boards.find((board) => board.id === target.boardId)?.name ?? target.boardId}
                            </small>
                          )}
                          {edge.missing ? (
                            <span class="home-memory-missing">
                              ⚠ Missing target: {target.boardId}
                              {target.cardId ? ` / ${target.cardId}` : ''}
                            </span>
                          ) : (
                            <button
                              type="button"
                              class="home-button"
                              disabled={!map && following}
                              onClick={() => {
                                if (map) void openMemoryTarget(target);
                                else void follow(target);
                              }}
                            >
                              {!map ? 'Follow ' : ''}
                              {other?.title ?? (map ? target.boardId : (target.cardId ?? target.boardId))}
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
              {map
                ? 'Overview groups links between boards. Select a board to inspect connections. Double-click to open.'
                : 'Activate a board to expand or collapse its cards in place. Select a card to inspect incoming and outgoing evidence. Follow reveals an endpoint in its own folder; Open is separate. Bundles combine directions and types. Dotted membership is not evidence.'}
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
