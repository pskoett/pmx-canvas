import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memoryKey, type MemoryGraphEdge, type MemoryGraphNode } from '../../shared/memory-graph.js';
import { relationDefinition, relationText } from '../../shared/relations.js';
import { boardList, browsingMemory, openMemoryTarget } from '../state/boards-store';
import { isSelectionEscape } from '../utils/keyboard';
import { BoardPinButton } from './BoardPinButton';
import { MemoryInspector } from './MemoryInspector';
import { GRAPH_NODE, graphRoutes } from './graph-geometry';
import { graphEvidence, graphPositions, graphSceneKey, relaxGraphPositions, type GraphScene } from './graph-model';
import type { Point } from './memory-layout';
import { useMemoryGraph } from './use-memory-graph';

const linkNames = { portal: 'Portals', wiki: 'Wiki links', card: 'Card relations', previous: 'Previous boards' };
type LinkKind = keyof typeof linkNames;
type Camera = Point & { scale: number };
interface Frame {
  scene: GraphScene;
  camera: Camera | null;
  query: string;
  context: boolean;
  folders: Set<string>;
  hiddenLinks: Set<LinkKind>;
  inspection: string | null;
  limit: number;
}
interface GraphLink {
  id: string;
  from: string;
  to: string;
  edges: MemoryGraphEdge[];
  bundle: boolean;
}
const newFrame = (scene: GraphScene): Frame => ({
  scene,
  camera: null,
  query: '',
  context: false,
  folders: new Set(),
  hiddenLinks: new Set(),
  inspection: null,
  limit: 80,
});

/** One explorer. Ownership defines scope; authored relationships define geometry. */
export function HomeGraphView() {
  const boards = boardList.value;
  const { graph, loading, error, retry } = useMemoryGraph('full');
  const [frames, setFrames] = useState<Frame[]>([newFrame({ kind: 'overview' })]);
  const frame = frames.at(-1)!;
  const scene = frame.scene;
  const sceneKey = graphSceneKey(scene);
  const [sidebar, setSidebar] = useState(false);
  const [reveal, setReveal] = useState(0);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const layouts = useRef(new Map<string, Map<string, Point>>());
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: number;
    start: Point;
    origin: Point;
    key?: string;
    layout?: Map<string, Point>;
    moved: boolean;
  } | null>(null);
  const motion = useRef<number | null>(null);
  const motionTarget = useRef<Point | null>(null);
  const stopMotion = () => {
    if (motion.current !== null) cancelAnimationFrame(motion.current);
    motion.current = null;
    motionTarget.current = null;
  };
  const suppressClick = useRef(false);
  const update = (patch: Partial<Frame>) => setFrames((old) => [...old.slice(0, -1), { ...old.at(-1)!, ...patch }]);
  const back = () => {
    setFrames((old) => (old.length > 1 ? old.slice(0, -1) : old));
    setSidebar(false);
    setHover(null);
    setNotice('');
  };
  const go = (next: GraphScene) => {
    if (graphSceneKey(next) === sceneKey) {
      setReveal((value) => value + 1);
      return;
    }
    setFrames((old) => [...old, newFrame(next)]);
    setSidebar(false);
    setHover(null);
    setNotice('');
  };
  const breadcrumb = (next: GraphScene) => {
    const index = frames.map((entry) => graphSceneKey(entry.scene)).lastIndexOf(graphSceneKey(next));
    if (index >= 0) setFrames((old) => old.slice(0, index + 1));
    else go(next);
    setSidebar(false);
  };
  useLayoutEffect(() => {
    browsingMemory.value = true;
  }, []);
  useLayoutEffect(() => {
    const stage = viewport.current!;
    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!isSelectionEscape(event)) return;
      if (frame.inspection || frames.length > 1) {
        event.preventDefault();
        if (frame.inspection) update({ inspection: null });
        else back();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [frame.inspection, frames.length]);
  const nodes = useMemo(
    () =>
      (graph?.nodes ?? []).map((node) => {
        const board = boards.find((entry) => entry.id === node.boardId);
        return board
          ? {
              ...node,
              folder: board.folder,
              ...(node.kind === 'board'
                ? { title: board.name, nodeCount: board.nodeCount, inContext: !!board.pin }
                : {}),
            }
          : node;
      }),
    [graph, boards],
  );
  const byKey = useMemo(() => new Map(nodes.map((node) => [node.key, node])), [nodes]);
  const facts = useMemo(() => graphEvidence(graph?.edges ?? []), [graph]);
  const focusKey = scene.kind === 'overview' ? null : memoryKey(scene);
  const focus = focusKey ? byKey.get(focusKey) : undefined;
  const boardName = (id: string) => boards.find((board) => board.id === id)?.name ?? id;
  const own = (node: MemoryGraphNode) => scene.kind !== 'overview' && node.boardId === scene.boardId;
  const evidence =
    scene.kind === 'overview'
      ? facts.evidence
      : facts.evidence.filter((edge) =>
          scene.kind === 'board'
            ? edge.source.boardId === scene.boardId || edge.target.boardId === scene.boardId
            : edge.from === focusKey || edge.to === focusKey,
        );
  const scope = useMemo(() => {
    if (scene.kind === 'overview')
      return {
        nodes: nodes.filter((node) => node.kind === 'board'),
        links: [...facts.pairs].map(
          ([id, entry]): GraphLink => ({
            id,
            from: memoryKey({ boardId: entry.boardId }),
            to: memoryKey({ boardId: entry.peerId }),
            edges: entry.edges,
            bundle: true,
          }),
        ),
      };
    const keys = new Set<string>();
    if (scene.kind === 'board') {
      for (const node of nodes) if (own(node) && node.kind === 'card') keys.add(node.key);
    } else if (focusKey && byKey.has(focusKey)) keys.add(focusKey);
    const grouped = new Map<string, GraphLink>();
    for (const edge of evidence) {
      if (edge.missing || !byKey.has(edge.from) || !byKey.has(edge.to)) continue;
      const from =
        scene.kind === 'board' && edge.source.boardId !== scene.boardId
          ? memoryKey({ boardId: edge.source.boardId })
          : edge.from;
      const to =
        scene.kind === 'board' && edge.target.boardId !== scene.boardId
          ? memoryKey({ boardId: edge.target.boardId })
          : edge.to;
      keys.add(from);
      keys.add(to);
      const id = scene.kind === 'card' ? edge.id : JSON.stringify([from, to].sort());
      const old = grouped.get(id);
      if (old) {
        old.edges.push(edge);
        old.bundle = true;
      } else grouped.set(id, { id, from, to, edges: [edge], bundle: from !== edge.from || to !== edge.to });
    }
    return { nodes: nodes.filter((node) => keys.has(node.key)), links: [...grouped.values()] };
  }, [nodes, graph, sceneKey]);
  const degree = new Map<string, number>();
  for (const link of scope.links)
    for (const key of [link.from, link.to]) degree.set(key, (degree.get(key) ?? 0) + link.edges.length);
  const connected = scope.nodes.filter((node) => degree.has(node.key) || node.key === focusKey);
  const unlinked = scope.nodes.filter((node) => !degree.has(node.key) && node.key !== focusKey);
  const matches = (node: MemoryGraphNode) =>
    node.key === focusKey ||
    ((!frame.context || node.inContext) &&
      !frame.folders.has(node.folder?.split('/')[0] ?? '') &&
      `${node.title} ${node.summary} ${boardName(node.boardId)} ${node.folder ?? ''}`
        .toLocaleLowerCase()
        .includes(frame.query.trim().toLocaleLowerCase()));
  const ranked = connected
    .filter(matches)
    .sort(
      (a, b) =>
        Number(b.key === focusKey) - Number(a.key === focusKey) ||
        (degree.get(b.key) ?? 0) - (degree.get(a.key) ?? 0) ||
        a.key.localeCompare(b.key),
    );
  const visible = ranked.slice(0, frame.limit);
  const keys = new Set(visible.map((node) => node.key));
  const tray = unlinked.filter(matches);
  const links = scope.links
    .map((link) => ({ ...link, edges: link.edges.filter((edge) => !frame.hiddenLinks.has(edge.kind as LinkKind)) }))
    .filter((link) => link.edges.length && keys.has(link.from) && keys.has(link.to));
  useEffect(
    () => () => {
      stopMotion();
      suppressClick.current ||= !!gesture.current?.moved;
      gesture.current = null;
    },
    [scope, frame.limit, frame.query, frame.context, frame.folders, frame.hiddenLinks],
  );
  const animate = (held: string) => {
    if (motion.current !== null) return;
    let remaining = 180;
    const step = () => {
      const dragging = gesture.current?.key === held;
      const retained = layouts.current.get(sceneKey)!;
      if (motionTarget.current) retained.set(held, motionTarget.current);
      motionTarget.current = null;
      const moving = new Map(visible.map((node) => [node.key, retained.get(node.key)!]));
      const movement = relaxGraphPositions(
        moving,
        links.map((link) => ({ ...link, weight: link.edges.length })),
        held,
        dragging ? 1 : remaining / 180,
      );
      for (const [key, point] of moving) retained.set(key, point);
      setLayoutRevision((value) => value + 1);
      if (dragging || (--remaining > 0 && movement > 0.02)) motion.current = requestAnimationFrame(step);
      else motion.current = null;
    };
    motion.current = requestAnimationFrame(step);
  };
  const positions = useMemo(() => {
    let retained = layouts.current.get(sceneKey);
    if (!retained) {
      retained = new Map();
      layouts.current.set(sceneKey, retained);
    }
    if (scene.kind !== 'card')
      return graphPositions(
        connected,
        scope.links.map((link) => ({ ...link, weight: link.edges.length })),
        retained,
      );
    if (!retained.has(focusKey!)) retained.set(focusKey!, { x: 0, y: 0 });
    const directed = evidence.filter(
      (edge) =>
        edge.kind !== 'card' ||
        relationDefinition(
          { kind: edge.relationKind, type: edge.type },
          boards.find((board) => board.id === edge.source.boardId)?.relationVocabulary,
        ).directed,
    );
    const incoming = new Set(directed.filter((edge) => edge.to === focusKey).map((edge) => edge.from));
    const outgoing = new Set(directed.filter((edge) => edge.from === focusKey).map((edge) => edge.to));
    const peers = connected.filter((node) => node.key !== focusKey).sort((a, b) => a.key.localeCompare(b.key));
    const xStep = GRAPH_NODE.width + GRAPH_NODE.gap,
      yStep = GRAPH_NODE.height + GRAPH_NODE.gap;
    for (const bankId of ['incoming', 'outgoing', 'mutual'] as const) {
      const bank = peers.filter(
        (node) =>
          (incoming.has(node.key) && !outgoing.has(node.key)
            ? 'incoming'
            : outgoing.has(node.key) && !incoming.has(node.key)
              ? 'outgoing'
              : 'mutual') === bankId,
      );
      const existing = bank.filter((node) => retained.has(node.key)).map((node) => retained.get(node.key)!);
      const mutualY = retained.get(focusKey!)!.y + yStep;
      let added = 0;
      for (const [index, node] of bank.entries())
        if (!retained.has(node.key)) {
          const offset = existing.length
            ? Math.max(...existing.map((point) => (bankId === 'mutual' ? point.x : point.y))) +
              (added + 1) * (bankId === 'mutual' ? xStep : yStep)
            : (index - (bank.length - 1) / 2) * (bankId === 'mutual' ? xStep : yStep);
          const point =
            bankId === 'mutual' ? { x: offset, y: mutualY } : { x: bankId === 'incoming' ? -360 : 360, y: offset };
          while ([...retained.values()].some((p) => Math.abs(p.x - point.x) < xStep && Math.abs(p.y - point.y) < yStep))
            point.y += yStep;
          retained.set(node.key, point);
          added++;
        }
    }
    return new Map(retained);
  }, [scope, sceneKey, layoutRevision]);
  const labelFor = (link: GraphLink) =>
    link.bundle
      ? `${link.edges.length} links`
      : link.edges[0].kind === 'card'
        ? relationDefinition(
            { kind: link.edges[0].relationKind, type: link.edges[0].type },
            boards.find((board) => board.id === link.edges[0].source.boardId)?.relationVocabulary,
          ).kind
        : link.edges[0].kind;
  const routes = useMemo(
    () =>
      graphRoutes(
        new Map(visible.map((node) => [node.key, positions.get(node.key)!])),
        links
          .map((link) => ({ ...link, label: link.edges.length > 1 || scene.kind === 'card' ? labelFor(link) : '' }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    [positions, scope, frame.limit, frame.query, frame.context, frame.folders, frame.hiddenLinks],
  );
  const camera = frame.camera ?? { x: 0, y: 0, scale: 1 };
  const outside = visible.filter((node) => {
    const p = positions.get(node.key)!;
    return (
      (p.x - GRAPH_NODE.width / 2) * camera.scale + camera.x < 8 ||
      (p.x + GRAPH_NODE.width / 2) * camera.scale + camera.x > stageSize.width - 8 ||
      (p.y - GRAPH_NODE.height / 2) * camera.scale + camera.y < (scene.kind === 'card' ? 40 : 8) ||
      (p.y + GRAPH_NODE.height / 2) * camera.scale + camera.y > stageSize.height - 64
    );
  }).length;
  const fit = (initial = false) => {
    const stage = viewport.current;
    if (!stage || !visible.length) return;
    const topMargin = scene.kind === 'card' ? 40 : 16;
    // Fit inside the usable area, not exactly on its bottom counting boundary.
    const availableHeight = stage.clientHeight - topMargin - 64 - 8;
    const points = visible.flatMap((node) => {
      const p = positions.get(node.key)!;
      return [
        { x: p.x - GRAPH_NODE.width / 2, y: p.y - GRAPH_NODE.height / 2 },
        { x: p.x + GRAPH_NODE.width / 2, y: p.y + GRAPH_NODE.height / 2 },
      ];
    });
    for (const route of routes.values()) {
      points.push(...route.points);
      if (route.label)
        points.push({ x: route.label.left, y: route.label.top }, { x: route.label.right, y: route.label.bottom });
    }
    const left = Math.min(...points.map((p) => p.x)),
      top = Math.min(...points.map((p) => p.y));
    const width = Math.max(...points.map((p) => p.x)) - left,
      height = Math.max(...points.map((p) => p.y)) - top;
    const scale = Math.min(
      1,
      Math.max(initial ? 1 : 0.005, Math.min((stage.clientWidth - 64) / width, availableHeight / height)),
    );
    update({
      camera:
        initial && scene.kind === 'card'
          ? {
              x: stage.clientWidth / 2 - positions.get(focusKey!)!.x,
              y: topMargin + availableHeight / 2 - positions.get(focusKey!)!.y,
              scale: 1,
            }
          : {
              x: (stage.clientWidth - width * scale) / 2 - left * scale,
              y: topMargin + (availableHeight - height * scale) / 2 - top * scale,
              scale,
            },
    });
  };
  useLayoutEffect(() => {
    if (graph && !frame.camera && visible.length) fit(true);
  }, [graph, sceneKey, frame.camera]);
  useEffect(() => {
    if (!graph || scene.kind === 'overview' || focus) return;
    const boardExists = byKey.has(memoryKey({ boardId: scene.boardId }));
    setFrames((old) => {
      const valid = old.filter((entry) => entry.scene.kind === 'overview' || byKey.has(memoryKey(entry.scene)));
      const next: GraphScene =
        scene.kind === 'card' && boardExists ? { kind: 'board', boardId: scene.boardId } : { kind: 'overview' };
      return graphSceneKey(valid.at(-1)!.scene) === graphSceneKey(next) ? valid : [...valid, newFrame(next)];
    });
    setNotice('The focused endpoint was removed. Returned to its nearest available level.');
  }, [graph, focusKey, focus]);
  const panTo = (node: MemoryGraphNode) => {
    const p = positions.get(node.key),
      stage = viewport.current;
    if (!p || !stage) return;
    const scale = Math.max(1, camera.scale);
    update({
      camera: { x: stage.clientWidth / 2 - p.x * scale, y: stage.clientHeight / 2 - p.y * scale - 20, scale },
      limit: Math.max(frame.limit, ranked.indexOf(node) + 1),
    });
    setSidebar(false);
  };
  const activate = (node: MemoryGraphNode) => {
    if (node.kind === 'card' && node.cardId) go({ kind: 'card', boardId: node.boardId, cardId: node.cardId });
    else go({ kind: 'board', boardId: node.boardId });
  };
  const zoomAt = (scale: number, center?: Point) => {
    const stage = viewport.current;
    if (!stage) return;
    const point = center ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const next = Math.max(0.005, Math.min(3, scale));
    update({
      camera: {
        x: point.x - ((point.x - camera.x) * next) / camera.scale,
        y: point.y - ((point.y - camera.y) * next) / camera.scale,
        scale: next,
      },
    });
  };
  const inspection = scope.links.find((link) => link.id === frame.inspection);
  const detailEdges = inspection?.edges ?? evidence;
  const selectedBoard = focus ? boards.find((board) => board.id === focus.boardId) : undefined;
  const inspect = (link: GraphLink) => {
    update({ inspection: link.id });
    setReveal((value) => value + 1);
  };
  const filter = (label: string, checked: boolean, change: () => void) => (
    <label class="home-memory-check">
      <input type="checkbox" aria-label={label} checked={checked} onChange={change} />
      <span>{label}</span>
    </label>
  );
  const unavailable = scene.kind !== 'overview' && !focus;
  const title =
    scene.kind === 'overview'
      ? 'Library'
      : scene.kind === 'board'
        ? boardName(scene.boardId)
        : (focus?.title ?? 'Missing card');
  return (
    <main
      class={`home-memory graph-view${sidebar ? ' sidebar-open' : ''}`}
      aria-label="Library Graph"
      style={{ '--graph-node-width': `${GRAPH_NODE.width}px`, '--graph-node-height': `${GRAPH_NODE.height}px` }}
    >
      <div class="home-memory-toolbar">
        {frames.length > 1 && (
          <button type="button" class="home-button" onClick={back}>
            Back
          </button>
        )}
        <nav class="graph-breadcrumb" aria-label="Graph path">
          <button type="button" class="home-button" onClick={() => breadcrumb({ kind: 'overview' })}>
            Library
          </button>
          {scene.kind !== 'overview' && (
            <>
              <span>›</span>
              <button
                type="button"
                class="home-button"
                onClick={() => breadcrumb({ kind: 'board', boardId: scene.boardId })}
              >
                {boardName(scene.boardId)}
              </button>
            </>
          )}
          {scene.kind === 'card' && (
            <>
              <span>›</span>
              <strong>{title}</strong>
            </>
          )}
        </nav>
        <span>
          {visible.length} of {connected.length} connected drawn · {outside} partly/outside view ·{' '}
          {connected.length - ranked.length} filtered · {Math.max(0, ranked.length - visible.length)} hidden ·{' '}
          {unlinked.length} without links
        </span>
        {ranked.length > frame.limit && (
          <button type="button" class="home-button" onClick={() => update({ limit: frame.limit + 80 })}>
            Show more connections
          </button>
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
            zoomAt(camera.scale * Math.exp(-event.deltaY * 0.0015), {
              x: event.clientX - r.left,
              y: event.clientY - r.top,
            });
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as Element).closest('button, [role="button"]')) return;
            stopMotion();
            suppressClick.current = false;
            gesture.current = {
              id: event.pointerId,
              start: { x: event.clientX, y: event.clientY },
              origin: camera,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = gesture.current;
            if (!drag || drag.id !== event.pointerId || !(event.buttons & 1)) return;
            const dx = event.clientX - drag.start.x,
              dy = event.clientY - drag.start.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
            if (!drag.moved) return;
            const point = {
              x: drag.origin.x + dx / (drag.key ? camera.scale : 1),
              y: drag.origin.y + dy / (drag.key ? camera.scale : 1),
            };
            if (drag.key) {
              motionTarget.current = point;
              animate(drag.key);
            } else update({ camera: { ...point, scale: camera.scale } });
          }}
          onPointerUp={() => {
            if (!gesture.current) return;
            suppressClick.current = gesture.current.moved;
            gesture.current = null;
          }}
          onPointerCancel={() => {
            const drag = gesture.current;
            stopMotion();
            if (drag?.layout) {
              layouts.current.set(sceneKey, drag.layout);
              setLayoutRevision((value) => value + 1);
            } else if (drag) update({ camera: { ...drag.origin, scale: camera.scale } });
            suppressClick.current = !!drag?.moved;
            gesture.current = null;
          }}
        >
          {scene.kind === 'card' && (
            <div class="graph-direction-caption">Incoming starts left · outgoing starts right · drag to rearrange</div>
          )}
          <div
            class="home-memory-world"
            style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
          >
            <svg class="home-memory-links graph-links" aria-label="Graph connections">
              {links.map((link, index) => {
                const route = routes.get(link.id);
                if (!route) return null;
                const edge = link.edges[0];
                const definition = relationDefinition(
                  { kind: edge.relationKind, type: edge.type },
                  boards.find((board) => board.id === edge.source.boardId)?.relationVocabulary,
                );
                const directed = !link.bundle && (edge.kind !== 'card' || definition.directed);
                const ink = link.bundle
                  ? 'var(--c-muted)'
                  : edge.kind === 'card'
                    ? `var(--c-rel-${definition.ink})`
                    : edge.kind === 'wiki'
                      ? 'var(--c-rel-cites)'
                      : 'var(--c-rel-derived)';
                const name = `${link.edges.length} ${link.bundle ? 'links' : 'link'} between ${byKey.get(link.from)?.title} and ${byKey.get(link.to)?.title}`;
                return (
                  <g
                    key={link.id}
                    class={`graph-link${link.bundle ? ' is-bundle' : ' is-exact'}${link.from === hover || link.to === hover ? ' is-highlighted' : ''}${frame.inspection === link.id ? ' is-selected' : ''}`}
                    data-from={link.from}
                    data-to={link.to}
                    data-count={link.edges.length}
                    data-link-id={link.id}
                    role="button"
                    tabindex={0}
                    aria-label={`Inspect ${name}`}
                    style={{ stroke: ink }}
                    onClick={() => inspect(link)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        inspect(link);
                      }
                    }}
                  >
                    <defs>
                      <marker
                        id={`graph-arrow-${index}`}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: ink, stroke: 'none' }} />
                      </marker>
                    </defs>
                    <path class="graph-link-hit" d={route.path} />
                    <path
                      class="graph-link-line"
                      d={route.path}
                      marker-end={directed ? `url(#graph-arrow-${index})` : undefined}
                    />
                    {route.label && (link.edges.length > 1 || scene.kind === 'card') && (
                      <text x={route.label.x} y={route.label.y}>
                        {labelFor(link)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {visible.map((node, index) => {
              const point = positions.get(node.key)!;
              const board = boards.find((entry) => entry.id === node.boardId);
              const marked =
                node.kind === 'board'
                  ? node.inContext
                  : !!board?.pinnedTitles?.some((entry) => entry.nodeId === node.cardId) ||
                    (node.inContext && !board?.pin);
              return (
                <article
                  key={node.key}
                  data-key={node.key}
                  class={`graph-node is-${node.kind}${focusKey === node.key ? ' is-selected' : ''}${marked ? ' in-context' : ''}${scene.kind !== 'overview' && !own(node) ? ' is-external' : ''}`}
                  style={{ left: point.x, top: point.y }}
                  onPointerEnter={() => setHover(node.key)}
                  onPointerLeave={() => setHover(null)}
                >
                  <button
                    type="button"
                    class="home-memory-select"
                    aria-label={`${node.kind}: ${node.title}`}
                    aria-pressed={focusKey === node.key}
                    onClick={() => {
                      if (!suppressClick.current) activate(node);
                      suppressClick.current = false;
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      stopMotion();
                      suppressClick.current = false;
                      gesture.current = {
                        id: event.pointerId,
                        start: { x: event.clientX, y: event.clientY },
                        origin: point,
                        key: node.key,
                        layout: new Map(layouts.current.get(sceneKey)),
                        moved: false,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onKeyDown={(event) => {
                      if (!event.key.startsWith('Arrow')) return;
                      event.preventDefault();
                      const nextIndex =
                        (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + visible.length) %
                        visible.length;
                      const next = visible[nextIndex];
                      if (next) {
                        panTo(next);
                        viewport.current
                          ?.querySelectorAll<HTMLButtonElement>('.home-memory-select')
                          [nextIndex]?.focus({ preventScroll: true });
                      }
                    }}
                  >
                    <span class="graph-glyph" aria-hidden="true" />
                    <strong>{node.title}</strong>
                    <span>
                      {node.kind === 'board'
                        ? `${node.nodeCount ?? 0} cards · ${facts.internal.get(node.boardId) ?? 0} internal`
                        : `${boardName(node.boardId)} · ${node.type ?? 'card'}`}
                    </span>
                    <span class={marked ? 'memory-context-legend' : ''}>
                      {marked ? '⌖ In context' : node.folder || 'Unfiled'}
                    </span>
                  </button>
                </article>
              );
            })}
          </div>
          <div class="home-memory-zoom">
            <button type="button" class="home-button" aria-label="Zoom out" onClick={() => zoomAt(camera.scale / 1.2)}>
              −
            </button>
            <span>{Math.round(camera.scale * 100)}%</span>
            <button type="button" class="home-button" aria-label="Zoom in" onClick={() => zoomAt(camera.scale * 1.2)}>
              +
            </button>
            <button type="button" class="home-button" onClick={() => fit()}>
              Fit view
            </button>
          </div>
          {(notice || unavailable || !graph || !visible.length || error) && (
            <div class="home-memory-status" role="status">
              {notice ||
                (unavailable ? (
                  'This endpoint is no longer available. Use Back to return.'
                ) : error ? (
                  <>
                    Memory update failed.{' '}
                    <button type="button" class="home-button" onClick={retry}>
                      Retry
                    </button>
                  </>
                ) : !graph ? (
                  'Loading memory…'
                ) : tray.length ? (
                  'No linked nodes in this view. Choose a node in No connections below.'
                ) : (
                  'No matching nodes.'
                ))}
            </div>
          )}
        </div>
        <aside class="home-memory-sidebar" aria-label="Graph settings">
          <section>
            <h2>{scene.kind === 'overview' ? 'Find boards' : 'Find cards and neighbors'}</h2>
            <label class="home-memory-search">
              <span>Search graph</span>
              <input
                type="search"
                value={frame.query}
                placeholder="Search this graph…"
                onInput={(event) => update({ query: event.currentTarget.value })}
              />
            </label>
            {frame.query && (
              <ul class="graph-search-results">
                {[...connected, ...unlinked]
                  .filter(matches)
                  .slice(0, 30)
                  .map((node) => (
                    <li key={node.key}>
                      <button
                        type="button"
                        class="home-button"
                        onClick={() => {
                          if (degree.has(node.key) || node.key === focusKey) panTo(node);
                          else activate(node);
                        }}
                      >
                        {node.title}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            {filter('Only in context', frame.context, () => update({ context: !frame.context }))}
          </section>
          <section>
            <h2>Folders</h2>
            {[...new Set(scope.nodes.map((node) => node.folder?.split('/')[0] ?? ''))].sort().map((folder) => (
              <div key={folder}>
                {filter(folder || 'Unfiled', !frame.folders.has(folder), () => {
                  const next = new Set(frame.folders);
                  if (next.has(folder)) next.delete(folder);
                  else next.add(folder);
                  update({ folders: next });
                })}
              </div>
            ))}
          </section>
          <section>
            <h2>Links</h2>
            {(Object.keys(linkNames) as LinkKind[]).map((kind) => (
              <div key={kind}>
                {filter(linkNames[kind], !frame.hiddenLinks.has(kind), () => {
                  const next = new Set(frame.hiddenLinks);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  update({ hiddenLinks: next });
                })}
              </div>
            ))}
          </section>
          <section>
            <h2>Library evidence</h2>
            <p class="graph-accounting">
              {facts.evidence.length} links ·{' '}
              {[...facts.pairs.values()].reduce((sum, entry) => sum + entry.edges.length, 0)} between boards ·{' '}
              {[...facts.internal.values()].reduce((sum, count) => sum + count, 0)} inside boards ·{' '}
              {facts.missing.length} missing
            </p>
            <p class="home-memory-help">
              Counts retain original evidence. Folder membership is not a relation. Filters change the drawing, not the
              totals.
            </p>
          </section>
        </aside>
      </div>
      {tray.length > 0 && (
        <details class="graph-unlinked" open>
          <summary>No connections ({tray.length})</summary>
          <div>
            {tray.map((node) => (
              <button
                key={node.key}
                type="button"
                class="home-button graph-tray-node"
                aria-label={`${node.kind}: ${node.title}`}
                onClick={() => activate(node)}
              >
                {node.title}
                <small>{node.kind === 'board' ? `${node.nodeCount ?? 0} cards` : boardName(node.boardId)}</small>
              </button>
            ))}
          </div>
        </details>
      )}
      <div class="home-memory-legend" aria-label="Legend">
        <span>
          Click nodes to drill · drag nodes to rearrange · lines for evidence · drag background to pan · scroll to zoom
          · Fit shows extent · search reveals at readable size
        </span>
        <span class="memory-context-legend">⌖ In context</span>
      </div>
      <MemoryInspector key="inspector" initiallyCollapsed reveal={reveal}>
        {focus || inspection ? (
          <section class="home-memory-details" role="complementary" aria-label="Selection details">
            {inspection && (
              <button
                type="button"
                class="home-memory-clear"
                aria-label="Close details"
                onClick={() => update({ inspection: null })}
              >
                ×
              </button>
            )}
            <div class="home-memory-detail-header">
              <div class="home-memory-selection-title">
                <h3>
                  {inspection ? `${byKey.get(inspection.from)?.title} ↔ ${byKey.get(inspection.to)?.title}` : title} ·{' '}
                  {detailEdges.length} connections
                </h3>
                <p>
                  {inspection
                    ? 'Original evidence, not a new aggregate relation'
                    : `${focus?.folder || 'Unfiled'} / ${boardName(focus!.boardId)}`}
                </p>
              </div>
              <div class="home-memory-actions">
                {focus && (
                  <>
                    <button type="button" class="home-button is-primary" onClick={() => void openMemoryTarget(focus)}>
                      Open {focus.kind}
                    </button>
                    {selectedBoard && <BoardPinButton board={selectedBoard} />}
                  </>
                )}
              </div>
            </div>
            <div class="home-memory-detail-body">
              {focus && (
                <p class={focus.inContext ? 'memory-context-legend' : ''}>
                  {focus.inContext ? '⌖ In context' : 'Not in context'}
                  {focus.linksComplete === false ? ' · Partial discovery' : ''}
                </p>
              )}
              <details class="home-memory-connections" open>
                <summary>Connections{inspection ? ' within this pair' : ''}</summary>
                <ul>
                  {detailEdges.map((edge) => {
                    const outgoing =
                      scene.kind === 'card'
                        ? edge.from === focusKey
                        : scene.kind === 'board'
                          ? edge.source.boardId === scene.boardId
                          : true;
                    const target = outgoing ? edge.target : edge.source;
                    const other = byKey.get(memoryKey(target));
                    const definition = relationDefinition(
                      { kind: edge.relationKind, type: edge.type },
                      boards.find((board) => board.id === edge.source.boardId)?.relationVocabulary,
                    );
                    const directed = edge.kind !== 'card' || definition.directed;
                    return (
                      <li key={edge.id}>
                        <span>
                          {directed ? (outgoing ? '→' : '←') : '↔'}{' '}
                          {edge.kind === 'card'
                            ? relationText({ ...edge, kind: edge.relationKind })
                            : `${edge.kind}${edge.label ? ` · ${edge.label}` : ''}`}
                        </span>
                        <small>
                          {byKey.get(edge.from)?.title ?? edge.source.cardId ?? boardName(edge.source.boardId)}{' '}
                          {directed ? '→' : '↔'}{' '}
                          {byKey.get(edge.to)?.title ?? edge.target.cardId ?? boardName(edge.target.boardId)} ·{' '}
                          {boardName(target.boardId)}
                        </small>
                        {!other || edge.missing ? (
                          <span class="home-memory-missing">
                            ⚠ Missing target: {target.boardId}
                            {target.cardId ? ` / ${target.cardId}` : ''}
                          </span>
                        ) : (
                          <button type="button" class="home-button" onClick={() => activate(other)}>
                            Follow {other.title}
                          </button>
                        )}
                      </li>
                    );
                  })}
                  {(graph?.unresolvedLinks ?? [])
                    .filter((link) =>
                      scene.kind === 'board'
                        ? link.source.boardId === scene.boardId
                        : memoryKey(link.source) === focusKey,
                    )
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
            <h3>Connections</h3>
            <p class="home-memory-help">
              Click a board to explore, then a card to see its exact neighbors. Click a connection line to read the
              original evidence. Open content is always separate.
            </p>
          </div>
        )}
      </MemoryInspector>
    </main>
  );
}
