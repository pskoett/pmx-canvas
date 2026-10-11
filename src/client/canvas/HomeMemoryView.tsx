import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memoryKey, type MemoryGraph, type MemoryGraphNode } from '../../shared/memory-graph.js';
import { relationText } from '../../shared/relations.js';
import { boardList, openMemoryTarget, updateBoard } from '../state/boards-store';
import { requestJson } from '../state/intent-bridge';
import { BoardPinButton } from './BoardPinButton';

type Point = { x: number; y: number };
const kinds = ['member', 'portal', 'wiki', 'card', 'previous'] as const;

/** Neutral folder tiles on Map; board/card clusters on Graph, independent of filters. */
function layout(nodes: MemoryGraphNode[], map: boolean) {
  const positions = new Map<string, Point>();
  const regions: Array<{ folder: string; x: number; y: number; width: number; height: number }> = [];
  if (!map) {
    const boardIds = [...new Set(nodes.map((node) => node.boardId))].sort();
    const columns = Math.max(1, Math.ceil(Math.sqrt(boardIds.length)));
    boardIds.forEach((boardId, index) => {
      const center = { x: 185 + (index % columns) * 400, y: 170 + Math.floor(index / columns) * 360 };
      const cards = nodes
        .filter((node) => node.boardId === boardId && node.kind === 'card')
        .sort((a, b) => a.key.localeCompare(b.key));
      const board = nodes.find((node) => node.boardId === boardId && node.kind === 'board');
      if (board) positions.set(board.key, { x: center.x - 95, y: center.y - 35 });
      cards.forEach((card, cardIndex) => {
        const angle = cardIndex * 2.399963229728653;
        const radius = 42 + Math.sqrt((cardIndex + 1) / cards.length) * 100;
        positions.set(card.key, {
          x: center.x + Math.cos(angle) * radius - 95,
          y: center.y + Math.sin(angle) * radius - 35,
        });
      });
    });
    return { positions, regions };
  }
  const folders = [...new Set(nodes.map((node) => node.folder ?? ''))].sort();
  let y = 40;
  for (const folder of folders) {
    const group = nodes
      .filter((node) => (node.folder ?? '') === folder)
      .sort((a, b) => a.boardId.localeCompare(b.boardId) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
    const height = Math.ceil(group.length / 3) * 180 + 60;
    for (let i = 0; i < group.length; i++) {
      const node = group[i]!;
      positions.set(
        node.key,
        node.position ? node.position : { x: 60 + (i % 3) * 320, y: y + 55 + Math.floor(i / 3) * 180 },
      );
    }
    regions.push({ folder: folder || 'Unfiled', x: 35, y, width: Math.min(3, group.length) * 320 - 60, height });
    y += height + 30;
  }
  return { positions, regions };
}

export function HomeMemoryView({ mode }: { mode: 'Map' | 'Graph' }) {
  const map = mode === 'Map';
  const boards = boardList.value;
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [focus, setFocus] = useState('');
  const [depth, setDepth] = useState(2);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [linkType, setLinkType] = useState('');
  const [context, setContext] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [details, setDetails] = useState<{ key: string; graph: MemoryGraph | null } | null>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [moved, setMoved] = useState<Record<string, Point>>({});
  const gesture = useRef<{
    id: number;
    start: Point;
    origin: Point;
    key?: string;
    boardId?: string;
    current?: Point;
    moved: boolean;
  } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  // Metadata-only updates are rendered below, not a reason to reload relationships.
  const relationshipRevision = JSON.stringify(
    [...boards]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((board) => [
        board.id,
        board.nodeCount,
        board.readmeNodeId,
        board.previousBoardId,
        !map ? !!board.pin : null,
      ]),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ depth: String(depth) });
    if (map) params.set('projection', 'boards');
    if (!map && focus) params.set('focus', focus);
    void requestJson<MemoryGraph | null>('memoryGraph', `/api/canvas/memory-graph?${params}`, null).then((result) => {
      if (cancelled) return;
      if (result && Array.isArray(result.nodes) && Array.isArray(result.edges)) {
        setGraph(result);
        if (!gesture.current) setMoved({});
      } else {
        setGraph(null);
        setError(true);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [map, focus, depth, relationshipRevision, revision]);

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
      (map ? (graph?.nodes ?? []).filter((node) => node.kind === 'board') : (graph?.nodes ?? [])).map((node) => {
        const board = boards.find((entry) => entry.id === node.boardId);
        if (!board || node.kind !== 'board') return node;
        return {
          ...node,
          title: board.name,
          folder: board.folder,
          inContext: !!board.pin,
          nodeCount: board.nodeCount,
          position: board.mapPosition ?? undefined,
        };
      }),
    [graph, map, boards],
  );
  const generated = useMemo(() => layout(allNodes, map), [allNodes, map]);
  const position = (key: string) => moved[key] ?? generated.positions.get(key);
  const visible = allNodes.filter(
    (node) =>
      (!type || (node.type ?? node.kind) === type) &&
      (!context || node.inContext) &&
      `${node.title} ${node.summary} ${node.folder ?? ''}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const visibleKeys = new Set(visible.map((node) => node.key));
  const edges = (graph?.edges ?? []).filter((edge) => {
    if (linkType && edge.kind !== linkType) return false;
    if (map && edge.kind === 'member') return false;
    const from = map ? memoryKey({ boardId: edge.source.boardId }) : edge.from;
    const to = map ? memoryKey({ boardId: edge.target.boardId }) : edge.to;
    return visibleKeys.has(from) && (edge.missing || visibleKeys.has(to)) && (edge.missing || from !== to);
  });
  const selected = allNodes.find((node) => node.key === selectedKey);
  const detailGraph = map ? (details?.key === selectedKey ? details.graph : null) : graph;
  const selectedBoard = boards.find((board) => board.id === selected?.boardId);
  const selectNode = (node: MemoryGraphNode, recenter = false) => {
    setSelectedKey(node.key);
    const p = position(node.key);
    if (recenter && p && viewport.current)
      setOffset({
        x: viewport.current.clientWidth / 2 - (p.x + 95) * zoom,
        y: viewport.current.clientHeight / 2 - (p.y + 35) * zoom,
      });
  };

  return (
    <main class={`home-memory is-${mode.toLowerCase()}`} aria-label={`Library ${mode}`}>
      <div class="home-memory-filters">
        <label>
          Find{' '}
          <input
            type="search"
            value={query}
            placeholder="Boards, cards, folders…"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label>
          Links{' '}
          <select value={linkType} onChange={(event) => setLinkType(event.currentTarget.value)}>
            <option value="">All links</option>
            {kinds.map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </label>
        <label>
          Type{' '}
          <select value={type} onChange={(event) => setType(event.currentTarget.value)}>
            <option value="">All types</option>
            {[...new Set(allNodes.map((node) => node.type ?? node.kind))].sort().map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={context} onChange={(event) => setContext(event.currentTarget.checked)} /> In
          context only
        </label>
        {!map && (
          <>
            <label>
              Focus{' '}
              <select
                value={focus}
                onChange={(event) => {
                  setFocus(event.currentTarget.value);
                  setOffset({ x: 0, y: 0 });
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
                  <option value={focus}>Selected card</option>
                )}
              </select>
            </label>
            <label>
              Depth{' '}
              <select value={depth} onChange={(event) => setDepth(Number(event.currentTarget.value))}>
                {[0, 1, 2, 3, 4].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="button" class="home-button" onClick={() => setRevision(revision + 1)}>
          Refresh
        </button>
      </div>
      <div class="home-memory-body">
        <div
          class="home-memory-stage"
          ref={viewport}
          aria-label="Pan the memory view"
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
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
            const p = { x: drag.origin.x + dx / (drag.key ? zoom : 1), y: drag.origin.y + dy / (drag.key ? zoom : 1) };
            drag.current = p;
            if (drag.key) setMoved((old) => ({ ...old, [drag.key!]: p }));
            else setOffset(p);
          }}
          onPointerUp={() => {
            const drag = gesture.current;
            gesture.current = null;
            if (drag?.key && drag.boardId && drag.moved)
              void updateBoard(drag.boardId, { mapPosition: drag.current ?? drag.origin }).finally(() =>
                setMoved((old) => {
                  const next = { ...old };
                  delete next[drag.key!];
                  return next;
                }),
              );
          }}
          onPointerCancel={() => {
            const key = gesture.current?.key;
            gesture.current = null;
            if (key)
              setMoved((old) => {
                const next = { ...old };
                delete next[key];
                return next;
              });
          }}
        >
          <div
            class="home-memory-world"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          >
            {map &&
              generated.regions.map((region) => {
                const points = allNodes
                  .filter((node) => (node.folder || 'Unfiled') === region.folder)
                  .map((node) => position(node.key)!);
                const x = Math.min(region.x, ...points.map((p) => p.x - 20)),
                  y = Math.min(region.y, ...points.map((p) => p.y - 40));
                return (
                  <div
                    key={region.folder}
                    class="home-memory-region"
                    style={{
                      left: x,
                      top: y,
                      width: Math.max(region.x + region.width, ...points.map((p) => p.x + 210)) - x,
                      height: Math.max(region.y + region.height, ...points.map((p) => p.y + 90)) - y,
                    }}
                  >
                    {region.folder}
                  </div>
                );
              })}
            <svg class="home-memory-links" aria-hidden="true">
              {edges.map((edge, index) => {
                const a = position(map ? memoryKey({ boardId: edge.source.boardId }) : edge.from);
                const b = position(map ? memoryKey({ boardId: edge.target.boardId }) : edge.to);
                if (!a) return null;
                return (
                  <g key={edge.id} class={`memory-edge edge-${edge.kind}${edge.missing ? ' is-missing' : ''}`}>
                    <path
                      d={
                        map && b
                          ? `M ${a.x} ${a.y + 35} H ${Math.min(a.x, b.x) - 24 - (index % 5) * 9} V ${b.y + 35} H ${b.x}`
                          : `M ${a.x + 95} ${a.y + 35} Q ${(a.x + (b?.x ?? a.x + 210)) / 2 + 95} ${Math.min(a.y, b?.y ?? a.y - 55) + 10} ${b ? b.x + 95 : a.x + 210} ${b ? b.y + 35 : a.y - 20}`
                      }
                    />
                    {edge.missing && (
                      <text x={a.x + 210} y={a.y - 24}>
                        ⚠ Missing {edge.kind} link
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {visible.map((node, index) => {
              const p = position(node.key)!;
              const board = boards.find((entry) => entry.id === node.boardId);
              return (
                <article
                  key={node.key}
                  class={`home-memory-node is-${node.kind}${node.inContext ? ' in-context' : ''}${selectedKey === node.key ? ' is-selected' : ''}`}
                  style={{
                    left: p.x + (map ? 0 : node.kind === 'board' ? 85 : 90),
                    top: p.y + (map ? 0 : node.kind === 'board' ? 25 : 30),
                  }}
                >
                  <button
                    type="button"
                    class="home-memory-select"
                    aria-label={`${node.kind}: ${node.title}`}
                    aria-pressed={selectedKey === node.key}
                    onFocus={(event) => {
                      if (!gesture.current) selectNode(node, event.currentTarget.matches(':focus-visible'));
                    }}
                    onClick={() => setSelectedKey(node.key)}
                    onDblClick={() => void openMemoryTarget(node)}
                    onPointerDown={(event) => {
                      if (!map || event.button !== 0) return;
                      event.stopPropagation();
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
                        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
                        const next = visible[(index + step + visible.length) % visible.length];
                        if (next) {
                          selectNode(next, true);
                          const buttons = viewport.current?.querySelectorAll<HTMLButtonElement>('.home-memory-select');
                          buttons?.[(index + step + visible.length) % visible.length]?.focus();
                        }
                      }
                    }}
                  >
                    <strong>{node.title}</strong>
                    <span>
                      {node.kind === 'board' ? `${node.nodeCount ?? 0} cards` : (node.type ?? 'card')}
                      {node.inContext ? ' · In context' : ''}
                    </span>
                  </button>
                  {node.kind === 'board' && board && <BoardPinButton board={board} />}
                </article>
              );
            })}
          </div>
          <div class="home-memory-zoom">
            <button
              type="button"
              class="home-button"
              aria-label="Zoom out"
              onClick={() => setZoom(Math.max(0.6, zoom - 0.1))}
            >
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              class="home-button"
              aria-label="Zoom in"
              onClick={() => setZoom(Math.min(1.8, zoom + 0.1))}
            >
              +
            </button>
            <button
              type="button"
              class="home-button"
              onClick={() => {
                setZoom(1);
                setOffset({ x: 0, y: 0 });
              }}
            >
              Reset view
            </button>
          </div>
          {(loading || error || !visible.length) && (
            <div class="home-memory-status" role="status">
              {loading ? 'Loading memory…' : error ? 'Memory could not be loaded. Try Refresh.' : 'No matching nodes.'}
            </div>
          )}
        </div>
        {selected && (
          <aside class="home-memory-details" aria-label="Selection details">
            <button type="button" class="home-button" onClick={() => setSelectedKey(null)}>
              Close details
            </button>
            <h2>{selected.title}</h2>
            <p>
              {selected.folder || 'Unfiled'} · {selected.type ?? selected.kind}
            </p>
            <p>{selected.summary || 'No summary yet.'}</p>
            <p>{selected.inContext ? 'In context' : 'Not in context'}</p>
            <div class="home-memory-actions">
              <button type="button" class="home-button" onClick={() => void openMemoryTarget(selected)}>
                Open {selected.kind}
              </button>
              {selectedBoard && <BoardPinButton board={selectedBoard} />}
              {!map && (
                <button
                  type="button"
                  class="home-button"
                  onClick={() => {
                    setFocus(selected.key);
                    setOffset({ x: 0, y: 0 });
                  }}
                >
                  Focus here
                </button>
              )}
              {map && (
                <button
                  type="button"
                  class="home-button"
                  onClick={() => {
                    void updateBoard(selected.boardId, { mapPosition: null });
                  }}
                >
                  Reset position
                </button>
              )}
            </div>
            <h3>Connections</h3>
            {map && !detailGraph && (
              <p role="status">
                {details?.key === selectedKey
                  ? 'Connections could not be loaded. Try Refresh.'
                  : 'Loading connections…'}
              </p>
            )}
            <ul>
              {(detailGraph?.edges ?? [])
                .filter((edge) =>
                  map
                    ? edge.kind !== 'member' &&
                      (edge.source.boardId === selected.boardId || edge.target.boardId === selected.boardId)
                    : edge.from === selected.key || edge.to === selected.key,
                )
                .map((edge) => {
                  const target =
                    edge.from === selected.key || (map && edge.source.boardId === selected.boardId)
                      ? edge.target
                      : edge.source;
                  const other = detailGraph?.nodes.find((node) => node.key === memoryKey(target));
                  return (
                    <li key={edge.id}>
                      {edge.source.boardId === selected.boardId && (map || edge.from === selected.key) ? '→' : '←'}{' '}
                      {edge.kind === 'card'
                        ? relationText({ ...edge, kind: edge.relationKind })
                        : `${edge.kind} · ${edge.label ?? ''}`}{' '}
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
                  map ? link.source.boardId === selected.boardId : memoryKey(link.source) === selected.key,
                )
                .map((link) => (
                  <li key={link.ref} class="home-memory-missing">
                    ⚠ Unresolved wiki: [[{link.ref}]]
                  </li>
                ))}
            </ul>
          </aside>
        )}
      </div>
      <div class="home-memory-legend" aria-label="Legend">
        <span>{map ? '▣' : '●'} Board</span>
        {!map && <span>• Card</span>}
        <span class="memory-context-legend">● In context</span>
        {kinds.map((kind) => (
          <span key={kind} class={`memory-legend-${kind}`}>
            {kind === 'member' || kind === 'previous' ? '┄' : '—'} {kind}
          </span>
        ))}
        <span class="home-memory-missing">⚠ Missing link</span>
        <span>{map ? 'Drag boards to save positions. ' : ''}Drag background to pan · arrows select · Enter opens</span>
      </div>
    </main>
  );
}
