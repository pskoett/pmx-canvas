import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memoryKey, type MemoryGraph, type MemoryGraphEdge, type MemoryGraphNode } from '../../shared/memory-graph.js';
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
import { MemoryInspector } from './MemoryInspector';
import { MAP_CARD, mapLayout, type Point } from './memory-layout';
import { useMemoryGraph } from './use-memory-graph';

const linkNames = { portal: 'Portals', wiki: 'Wiki links', card: 'Card relations', previous: 'Previous boards' };
type LinkKind = keyof typeof linkNames;

export function HomeMapView() {
  const boards = boardList.value;
  const liveRevision = memoryGraphRevision.value;
  const { graph, loading, error, retry } = useMemoryGraph('boards');
  const [query, setQuery] = useState('');
  const [showBoards, setShowBoards] = useState(true);
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
  const [sidebar, setSidebar] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const fitPending = useRef(true);
  const suppressClick = useRef(false);
  const gesture = useRef<{
    id: number;
    start: Point;
    origin: Point;
    key?: string;
    boardId?: string;
    current?: Point;
    moved: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    browsingMemory.value = true;
  }, []);
  useLayoutEffect(() => {
    if (!selectedKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (isSelectionEscape(event)) {
        event.preventDefault();
        setSelectedKey(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKey]);
  useEffect(() => {
    if (!selectedKey) return;
    let cancelled = false;
    setDetails(null);
    const epoch = catalogEpoch;
    const revision = memoryGraphRevision.peek();
    const params = new URLSearchParams({ focus: selectedKey, depth: '2' });
    void requestJson<MemoryGraph | null>('memoryGraph', `/api/canvas/memory-graph?${params}`, null).then((result) => {
      if (!cancelled && epoch === catalogEpoch && revision === memoryGraphRevision.peek())
        setDetails({
          key: selectedKey,
          graph: result && Array.isArray(result.nodes) && Array.isArray(result.edges) ? result : null,
        });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedKey, graph, liveRevision]);
  const nodes = useMemo(
    () =>
      (graph?.nodes ?? [])
        .filter((node) => node.kind === 'board')
        .map((node) => {
          const board = boards.find((entry) => entry.id === node.boardId);
          return board
            ? {
                ...node,
                title: board.name,
                folder: board.folder,
                inContext: !!board.pin,
                nodeCount: board.nodeCount,
                position: board.mapPosition ?? undefined,
              }
            : node;
        }),
    [graph, boards],
  );
  const generated = useMemo(() => mapLayout(nodes, collapsed), [nodes, collapsed]);
  const folderCounts = new Map<string, number>();
  for (const node of nodes) {
    const folder = node.folder?.split('/')[0] ?? '';
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }
  const visible = nodes.filter(
    (node) =>
      showBoards &&
      (!context || node.inContext) &&
      (unfiled || !!node.folder) &&
      !hiddenFolders.has(node.folder?.split('/')[0] ?? '') &&
      !generated.hidden.has(node.key) &&
      `${node.title} ${node.summary} ${node.folder ?? ''}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const keys = new Set(visible.map((node) => node.key));
  const position = (key: string) => moved[key] ?? generated.positions.get(key);
  const selected = nodes.find((node) => node.key === selectedKey);
  const emphasized = nodes.find((node) => node.key === (hoverKey ?? selectedKey));
  const bundles = new Map<string, { from: string; to: string; edges: MemoryGraphEdge[] }>();
  for (const edge of graph?.edges ?? []) {
    if (edge.kind === 'member' || hiddenLinks.has(edge.kind)) continue;
    const from = memoryKey({ boardId: edge.source.boardId }),
      to = memoryKey({ boardId: edge.target.boardId });
    if (!keys.has(from) || (!edge.missing && (!keys.has(to) || from === to))) continue;
    const key = JSON.stringify([from, to, edge.kind, edge.relationKind, edge.missing]);
    const old = bundles.get(key);
    if (old) old.edges.push(edge);
    else bundles.set(key, { from, to, edges: [edge] });
  }
  const neighbors = new Set<string>(emphasized ? [emphasized.key] : []);
  for (const { from, to } of bundles.values())
    if (emphasized && (from === emphasized.key || to === emphasized.key)) {
      neighbors.add(from);
      neighbors.add(to);
    }
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
  const fitView = () => {
    const stage = viewport.current;
    if (!stage?.clientWidth || !stage.clientHeight) return;
    const bounds = visible.flatMap((node) => {
      const p = position(node.key);
      return p
        ? [
            { x: p.x - 110, y: p.y - 46 },
            { x: p.x + 110, y: p.y + 46 },
          ]
        : [];
    });
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
  }, [collapsed]);
  useEffect(() => {
    if (fitPending.current && graph && (visible.length || generated.regions.length) && !gesture.current) {
      fitPending.current = false;
      fitView();
    }
  }, [graph, collapsed]);
  const zoomAt = (next: number, center?: Point) => {
    const stage = viewport.current;
    if (!stage) return;
    const p = center ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 },
      scale = Math.min(3, Math.max(0.08, next));
    setOffset({ x: p.x - ((p.x - offset.x) * scale) / zoom, y: p.y - ((p.y - offset.y) * scale) / zoom });
    setZoom(scale);
  };
  const select = (node: MemoryGraphNode, recenter = false) => {
    setSelectedKey(node.key);
    const p = position(node.key),
      stage = viewport.current;
    if (recenter && p && stage)
      setOffset({ x: stage.clientWidth / 2 - p.x * zoom, y: stage.clientHeight / 2 - p.y * zoom });
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
    if (drag.boardId && drag.moved && !cancelled) {
      const p = drag.current ?? drag.origin;
      void updateBoard(drag.boardId, {
        mapPosition: { x: p.x - MAP_CARD.width / 2, y: p.y - MAP_CARD.height / 2 },
      }).finally(clear);
    } else clear();
  };
  const detailGraph = details?.key === selectedKey ? details.graph : null;
  const selectedConnections = (detailGraph?.edges ?? []).filter(
    (edge) =>
      selected &&
      edge.kind !== 'member' &&
      (edge.source.boardId === selected.boardId || edge.target.boardId === selected.boardId),
  );
  const selectedBoard = boards.find((board) => board.id === selected?.boardId);
  const filter = (label: string, count: number, checked: boolean, change: () => void) => (
    <label class="home-memory-check">
      <input type="checkbox" aria-label={label} checked={checked} onChange={change} />
      <span>{label}</span>
      <small>{count}</small>
    </label>
  );
  return (
    <main class={`home-memory is-map${sidebar ? ' sidebar-open' : ''}`} aria-label="Library Map">
      <div class="home-memory-toolbar">
        <span>
          {nodes.length} boards · {boards.reduce((sum, board) => sum + board.nodeCount, 0)} cards ·{' '}
          {graph?.edges.filter((edge) => edge.kind !== 'member').length ?? 0} links
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
          Filters
        </button>
      </div>
      <div class="home-memory-body">
        <div
          class="home-memory-stage"
          ref={viewport}
          aria-label="Pan the memory view"
          onWheel={(event) => {
            event.preventDefault();
            const r = event.currentTarget.getBoundingClientRect();
            zoomAt(zoom * Math.exp(-event.deltaY * 0.0015), { x: event.clientX - r.left, y: event.clientY - r.top });
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
            const p = { x: drag.origin.x + dx / (drag.key ? zoom : 1), y: drag.origin.y + dy / (drag.key ? zoom : 1) };
            drag.current = p;
            if (drag.key) setMoved((old) => ({ ...old, [drag.key!]: p }));
            else setOffset(p);
          }}
          onPointerUp={() => endGesture(false)}
          onPointerCancel={() => endGesture(true)}
        >
          <div
            class="home-memory-world"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, '--memory-zoom': zoom }}
          >
            {generated.regions
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
              {[...bundles].map(([key, { from, to, edges }]) => {
                const edge = edges[0],
                  a = position(from),
                  b = position(to);
                if (!a) return null;
                const end = b ?? { x: a.x + 100, y: a.y - 70 },
                  startY = a.y + (end.y > a.y ? 46 : -46),
                  endY = b ? end.y + (end.y > a.y ? -46 : 46) : end.y;
                const hi =
                  emphasized &&
                  (edge.source.boardId === emphasized.boardId || edge.target.boardId === emphasized.boardId);
                const definition = relationDefinition(
                  { kind: edge.relationKind, type: edge.type },
                  boards.find((board) => board.id === edge.source.boardId)?.relationVocabulary,
                );
                const ink = edge.missing
                  ? 'var(--c-warn)'
                  : edge.kind === 'card'
                    ? `var(--c-rel-${definition.ink})`
                    : undefined;
                return (
                  <g
                    key={key}
                    data-from={from}
                    data-to={to}
                    data-count={edges.length}
                    style={ink ? { stroke: ink } : undefined}
                    class={`memory-edge edge-${edge.kind}${edge.missing ? ' is-missing' : ''}${hi ? ' is-emphasized' : emphasized ? ' is-dimmed' : ''}`}
                  >
                    <path
                      d={`M ${a.x} ${startY} C ${a.x} ${(startY + endY) / 2}, ${end.x} ${(startY + endY) / 2}, ${end.x} ${endY}`}
                    />
                    {edges.length > 1 && (
                      <text x={(a.x + end.x) / 2} y={(a.y + end.y) / 2 - 6}>
                        {edges.length} links
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
              const p = position(node.key);
              if (!p) return null;
              const board = boards.find((entry) => entry.id === node.boardId);
              return (
                <article
                  key={node.key}
                  data-key={node.key}
                  class={`home-memory-node is-board${node.inContext ? ' in-context' : ''}${selectedKey === node.key ? ' is-selected' : ''}${neighbors.has(node.key) ? ' is-emphasized' : emphasized ? ' is-dimmed' : ''}`}
                  style={{ left: p.x, top: p.y }}
                  onPointerEnter={() => {
                    if (!gesture.current) setHoverKey(node.key);
                  }}
                  onPointerLeave={() => setHoverKey(null)}
                >
                  <button
                    type="button"
                    class="home-memory-select"
                    aria-label={`board: ${node.title}`}
                    aria-pressed={selectedKey === node.key}
                    onFocus={(event) => {
                      if (!gesture.current && event.currentTarget.matches(':focus-visible')) select(node, true);
                    }}
                    onClick={() => {
                      if (!suppressClick.current) select(node);
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
                        origin: p,
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
                        const nextIndex =
                          (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + visible.length) %
                          visible.length;
                        const next = visible[nextIndex];
                        if (next) {
                          select(next, true);
                          viewport.current
                            ?.querySelectorAll<HTMLButtonElement>('.home-memory-select')
                            [nextIndex]?.focus({ preventScroll: true });
                        }
                      }
                    }}
                  >
                    <strong>{node.title}</strong>
                    <span>
                      {node.nodeCount ?? 0} cards · {connectionCount(node)} connected boards
                    </span>
                    <span class="home-memory-summary">{node.summary || 'No summary yet'}</span>
                    {node.inContext && <span class="home-memory-context">⌖ In context</span>}
                  </button>
                  {board && <BoardPinButton board={board} />}
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
                  <button type="button" class="home-button" onClick={retry}>
                    Retry
                  </button>
                </>
              ) : !graph ? (
                'Loading memory…'
              ) : generated.hidden.size ? (
                'Folders collapsed. Expand a folder to see its boards.'
              ) : (
                'No matching nodes.'
              )}
            </div>
          )}
        </div>
        <aside class="home-memory-sidebar" aria-label="Map settings">
          <section>
            <h2>Filters</h2>
            <label class="home-memory-search">
              <span>Find boards and cards</span>
              <input
                type="search"
                value={query}
                placeholder="Search boards and cards…"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            {filter('Boards', nodes.length, showBoards, () => setShowBoards(!showBoards))}
            {filter('Only in context', nodes.filter((node) => node.inContext).length, context, () =>
              setContext(!context),
            )}
            {filter('Include unfiled', nodes.filter((node) => !node.folder).length, unfiled, () =>
              setUnfiled(!unfiled),
            )}
          </section>
          <section>
            <h2>Groups · by folder</h2>
            {[...folderCounts]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([folder, count]) => (
                <div key={folder}>
                  {filter(folder || 'Unfiled', count, !hiddenFolders.has(folder), () =>
                    setHiddenFolders((old) => {
                      const next = new Set(old);
                      if (next.has(folder)) next.delete(folder);
                      else next.add(folder);
                      return next;
                    }),
                  )}
                </div>
              ))}
          </section>
          <section>
            <h2>Links</h2>
            {(Object.keys(linkNames) as LinkKind[]).map((kind) => (
              <div key={kind} class={`memory-legend-${kind}`}>
                {filter(
                  linkNames[kind],
                  graph?.edges.filter((edge) => edge.kind === kind).length ?? 0,
                  !hiddenLinks.has(kind),
                  () =>
                    setHiddenLinks((old) => {
                      const next = new Set(old);
                      if (next.has(kind)) next.delete(kind);
                      else next.add(kind);
                      return next;
                    }),
                )}
              </div>
            ))}
          </section>
        </aside>
      </div>
      <div class="home-memory-legend" aria-label="Legend">
        <span>▣ Board</span>
        <span class="memory-context-legend">⌖ In context</span>
        <span class="memory-legend-portal">━ Portal</span>
        <span class="memory-legend-wiki">┄ Wiki</span>
        <span class="memory-legend-card">━ Relation</span>
        <span>Drag boards to save positions · drag background to pan · scroll to zoom</span>
      </div>
      <MemoryInspector>
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
            <div class="home-memory-detail-header">
              <div class="home-memory-selection-title">
                <h3>
                  {selected.title} · {selectedConnections.length} connections
                </h3>
                <p>{selected.folder || 'Unfiled'} · board</p>
              </div>
              <div class="home-memory-actions">
                <button type="button" class="home-button is-primary" onClick={() => void openMemoryTarget(selected)}>
                  Open board
                </button>
                {selectedBoard && <BoardPinButton board={selectedBoard} />}
                <button
                  type="button"
                  class="home-button"
                  onClick={() => void updateBoard(selected.boardId, { mapPosition: null })}
                >
                  Reset position
                </button>
              </div>
            </div>
            <div class="home-memory-detail-body">
              <p>
                {selected.nodeCount ?? 0} cards · {connectionCount(selected)} connected boards
              </p>
              <p>{selected.summary || 'No summary yet.'}</p>
              <p class={selected.inContext ? 'memory-context-legend' : ''}>
                {selected.inContext ? '⌖ In context' : 'Not in context'}
              </p>
              <details class="home-memory-connections" open>
                <summary>Connections</summary>
                {!detailGraph && (
                  <p role="status">
                    {details?.key === selectedKey ? 'Connections could not be loaded.' : 'Loading connections…'}
                  </p>
                )}
                <ul>
                  {selectedConnections.map((edge) => {
                    const outgoing = edge.source.boardId === selected.boardId,
                      target = outgoing ? edge.target : edge.source;
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
                    .filter((link) => link.source.boardId === selected.boardId)
                    .map((link) => (
                      <li key={`${memoryKey(link.source)}:${link.ref}`} class="home-memory-missing">
                        ⚠ Unresolved wiki: [[{link.ref}]]
                      </li>
                    ))}
                </ul>
              </details>
            </div>
          </section>
        ) : (
          <div class="home-memory-empty-details">
            <h3>Relations</h3>
            <p class="home-memory-help">
              Overview groups links between boards. Select a board to inspect connections. Double-click to open.
            </p>
          </div>
        )}
      </MemoryInspector>
    </main>
  );
}
