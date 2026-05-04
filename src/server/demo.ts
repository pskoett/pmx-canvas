import { canvasState, type CanvasEdge, type CanvasNodeState } from './canvas-state.js';
import { EXCALIDRAW_CREATE_VIEW_TOOL, EXCALIDRAW_SERVER_NAME, buildExcalidrawCheckpointId, normalizeExcalidrawElementsForToolInput } from './diagram-presets.js';
import { createJsonRenderNodeData, buildGraphConfig, buildGraphSpec, type GraphNodeInput, type JsonRenderSpec } from '../json-render/server.js';

type DemoNodeType = CanvasNodeState['type'];

interface DemoNodeInput {
  id: string;
  type: DemoNodeType;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: Record<string, unknown>;
  content?: string;
  zIndex?: number;
}

const DEMO_NODE_TYPES = [
  'markdown',
  'status',
  'context',
  'ledger',
  'trace',
  'file',
  'image',
  'webpage',
  'json-render',
  'graph',
  'mcp-app',
  'group',
] satisfies DemoNodeType[];

const groupDefinitions = [
  {
    id: 'demo-group-overview',
    title: '1. Project Overview',
    x: 20,
    y: 20,
    width: 1260,
    height: 1450,
    color: '#46b6ff',
    children: ['demo-md-welcome', 'demo-status-health', 'demo-image-architecture', 'demo-excalidraw-architecture'],
  },
  {
    id: 'demo-group-control-surfaces',
    title: '2. Control Surfaces',
    x: 1320,
    y: 20,
    width: 1610,
    height: 1270,
    color: '#a855f7',
    children: ['demo-md-surfaces', 'demo-json-dashboard', 'demo-graph-capabilities'],
  },
  {
    id: 'demo-group-persistence',
    title: '3. Persistence + Data',
    x: 20,
    y: 1480,
    width: 1260,
    height: 1190,
    color: '#22c55e',
    children: ['demo-ledger-persistence', 'demo-file-server', 'demo-webpage-docs', 'demo-graph-mix'],
  },
  {
    id: 'demo-group-agent-context',
    title: '4. Agent Context Loop',
    x: 1320,
    y: 1300,
    width: 1610,
    height: 820,
    color: '#f59e0b',
    children: ['demo-context-pins', 'demo-mcp-app', 'demo-trace-api', 'demo-trace-build'],
  },
] as const;

function makeNode(input: DemoNodeInput): CanvasNodeState {
  return {
    id: input.id,
    type: input.type,
    position: { x: input.x, y: input.y },
    size: { width: input.width, height: input.height },
    zIndex: input.zIndex ?? (input.type === 'group' ? 0 : 1),
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: {
      ...(input.data ?? {}),
      title: input.title,
      ...(input.content !== undefined ? { content: input.content } : {}),
    },
  };
}

function makeEdge(
  id: string,
  from: string,
  to: string,
  type: CanvasEdge['type'],
  label: string,
  options: Pick<CanvasEdge, 'style' | 'animated'> = {},
): CanvasEdge {
  return { id, from, to, type, label, ...options };
}

function buildProjectTourSpec(): JsonRenderSpec {
  return {
    root: 'card',
    elements: {
      card: {
        type: 'Card',
        props: {
          title: 'PMX Canvas Capability Map',
          description: 'Native json-render components inside a canvas node.',
          maxWidth: 'full',
          centered: false,
        },
        children: ['stack'],
      },
      stack: {
        type: 'Stack',
        props: { direction: 'vertical', gap: 'md', align: 'stretch' },
        children: ['lede', 'badges', 'progress', 'table'],
      },
      lede: {
        type: 'Text',
        props: {
          text: 'Use the canvas as shared spatial memory: agents mutate state, humans curate context, and the browser renders a persistent workspace.',
          variant: 'lead',
        },
        children: [],
      },
      badges: {
        type: 'Stack',
        props: { direction: 'horizontal', gap: 'sm', align: 'center', justify: 'start' },
        children: ['b1', 'b2', 'b3', 'b4'],
      },
      b1: { type: 'Badge', props: { text: 'HTTP API', variant: 'default' }, children: [] },
      b2: { type: 'Badge', props: { text: 'MCP tools', variant: 'secondary' }, children: [] },
      b3: { type: 'Badge', props: { text: 'Bun SDK', variant: 'outline' }, children: [] },
      b4: { type: 'Badge', props: { text: 'SSE sync', variant: 'outline' }, children: [] },
      progress: {
        type: 'Progress',
        props: { value: 100, max: 100, label: 'All core surfaces share the same server-side state' },
        children: [],
      },
      table: {
        type: 'Table',
        props: {
          columns: ['Layer', 'What it demonstrates', 'Why it matters'],
          rows: [
            ['CanvasStateManager', 'authoritative layout + persistence', 'refresh-safe collaboration'],
            ['Browser renderer', 'nodes, edges, groups, minimap', 'humans see agent work live'],
            ['MCP/HTTP/SDK', 'same operations through different clients', 'agents pick the right integration'],
            ['Pinned context', 'human-curated agent grounding', 'less prompt stuffing'],
          ],
          caption: 'This dashboard is schema-driven; no custom web artifact build is needed.',
        },
        children: [],
      },
    },
  };
}

function buildGraphNode(input: Omit<GraphNodeInput, 'heightPx'> & { id: string; heightPx?: number }): CanvasNodeState {
  const spec = buildGraphSpec(input);
  const title = input.title ?? 'Graph';
  const chartHeight = input.height ?? 320;
  return makeNode({
    id: input.id,
    type: 'graph',
    title,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? 760,
    height: input.heightPx ?? chartHeight + 300,
    data: createJsonRenderNodeData(input.id, title, spec, {
      viewerType: 'graph',
      graphConfig: buildGraphConfig(input),
      strictSize: true,
    }),
  });
}

function buildExcalidrawDemoElements(): Array<Record<string, unknown>> {
  return [
    {
      type: 'rectangle',
      id: 'agent',
      x: 80,
      y: 110,
      width: 190,
      height: 92,
      roundness: { type: 3 },
      backgroundColor: '#a5d8ff',
      fillStyle: 'solid',
      label: { text: 'Agent\nMCP / HTTP / SDK', fontSize: 19 },
    },
    {
      type: 'rectangle',
      id: 'server',
      x: 350,
      y: 92,
      width: 220,
      height: 128,
      roundness: { type: 3 },
      backgroundColor: '#b2f2bb',
      fillStyle: 'solid',
      label: { text: 'CanvasStateManager\nauthoritative state', fontSize: 19 },
    },
    {
      type: 'rectangle',
      id: 'browser',
      x: 660,
      y: 110,
      width: 190,
      height: 92,
      roundness: { type: 3 },
      backgroundColor: '#d0bfff',
      fillStyle: 'solid',
      label: { text: 'Browser\nlive renderer', fontSize: 19 },
    },
    {
      type: 'diamond',
      id: 'pins',
      x: 382,
      y: 300,
      width: 156,
      height: 116,
      backgroundColor: '#ffec99',
      fillStyle: 'solid',
      label: { text: 'Pins\nhuman intent', fontSize: 18 },
    },
    {
      type: 'rectangle',
      id: 'disk',
      x: 650,
      y: 306,
      width: 200,
      height: 98,
      roundness: { type: 3 },
      backgroundColor: '#ffd8a8',
      fillStyle: 'solid',
      label: { text: '.pmx-canvas\nstate + blobs', fontSize: 18 },
    },
    {
      type: 'arrow',
      id: 'agent-server',
      x: 272,
      y: 155,
      points: [[0, 0], [74, 0]],
      strokeColor: '#1971c2',
      endArrowhead: 'arrow',
    },
    {
      type: 'arrow',
      id: 'server-browser',
      x: 572,
      y: 155,
      points: [[0, 0], [84, 0]],
      strokeColor: '#7048e8',
      endArrowhead: 'arrow',
    },
    {
      type: 'arrow',
      id: 'browser-pins',
      x: 718,
      y: 205,
      points: [[0, 0], [-166, 112]],
      strokeColor: '#e67700',
      endArrowhead: 'arrow',
    },
    {
      type: 'arrow',
      id: 'pins-agent',
      x: 383,
      y: 342,
      points: [[0, 0], [-196, -132]],
      strokeColor: '#087f5b',
      endArrowhead: 'arrow',
    },
    {
      type: 'arrow',
      id: 'server-disk',
      x: 562,
      y: 218,
      points: [[0, 0], [118, 84]],
      strokeColor: '#5c940d',
      endArrowhead: 'arrow',
    },
    {
      type: 'text',
      id: 'caption',
      x: 86,
      y: 470,
      width: 760,
      height: 34,
      text: 'Every client mutates the same server state; pins turn human spatial curation into agent-readable context.',
      fontSize: 22,
      strokeColor: '#ced4da',
    },
  ];
}

function buildExcalidrawDemoHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0f1e; color: #e2e8f0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    main { width: min(100%, 1080px); padding: 24px; }
    .canvas { position: relative; height: 540px; border: 1px solid rgba(148, 163, 184, 0.26); border-radius: 22px; background: radial-gradient(circle at 24px 24px, rgba(148, 163, 184, 0.14) 2px, transparent 0) 0 0 / 32px 32px, linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.88)); overflow: hidden; }
    .node { position: absolute; display: grid; place-items: center; text-align: center; border: 2px solid rgba(15, 23, 42, 0.75); border-radius: 22px; padding: 12px; color: #07111f; font-weight: 800; line-height: 1.22; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.26); }
    .agent { left: 76px; top: 118px; width: 184px; height: 90px; background: #a5d8ff; }
    .server { left: 420px; top: 92px; width: 240px; height: 132px; background: #b2f2bb; }
    .browser { right: 76px; top: 118px; width: 184px; height: 90px; background: #d0bfff; }
    .pins { left: 446px; top: 342px; width: 150px; height: 102px; border-radius: 30px; rotate: 45deg; background: #ffec99; }
    .pins span { rotate: -45deg; }
    .disk { right: 82px; top: 350px; width: 190px; height: 90px; background: #ffd8a8; }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    path { fill: none; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 8 8; }
    header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 14px; align-items: end; }
    h1 { margin: 0; font-size: 22px; letter-spacing: -0.03em; }
    p { margin: 0; max-width: 680px; color: #94a3b8; font-size: 13px; line-height: 1.5; }
    .badge { color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.36); border-radius: 999px; padding: 6px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>How PMX Canvas Works</h1><p>Static Excalidraw-style preview for the fast demo. Open with canvas_add_diagram for an editable hosted Excalidraw board.</p></div>
      <div class="badge">Excalidraw</div>
    </header>
    <div class="canvas" aria-label="PMX Canvas architecture diagram">
      <svg viewBox="0 0 1080 540" aria-hidden="true">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7dd3fc" stroke="none"/></marker></defs>
        <path d="M260 160 C330 118 372 118 420 152" stroke="#7dd3fc" marker-end="url(#arrow)"/>
        <path d="M660 152 C724 118 798 118 828 160" stroke="#c4b5fd" marker-end="url(#arrow)"/>
        <path d="M828 208 C744 290 672 336 596 394" stroke="#fbbf24" marker-end="url(#arrow)"/>
        <path d="M446 394 C330 330 238 260 168 208" stroke="#86efac" marker-end="url(#arrow)"/>
        <path d="M660 210 C754 282 816 318 808 350" stroke="#fdba74" marker-end="url(#arrow)"/>
      </svg>
      <div class="node agent">Agent<br/>MCP / HTTP / SDK</div>
      <div class="node server">CanvasStateManager<br/>authoritative state</div>
      <div class="node browser">Browser<br/>live renderer</div>
      <div class="node pins"><span>Pins<br/>human intent</span></div>
      <div class="node disk">.pmx-canvas<br/>state + blobs</div>
    </div>
  </main>
</body>
</html>`;
}

function buildDemoMcpAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #e5f7ff;
      background:
        radial-gradient(circle at 18% 16%, rgba(70, 182, 255, 0.32), transparent 36%),
        radial-gradient(circle at 88% 12%, rgba(168, 85, 247, 0.22), transparent 30%),
        linear-gradient(145deg, #08111f 0%, #0e1629 52%, #111827 100%);
    }
    main { padding: 18px; display: grid; gap: 14px; }
    .eyebrow { color: #7dd3fc; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 24px; line-height: 1.05; letter-spacing: -0.04em; }
    p { margin: 0; color: rgba(229, 247, 255, 0.72); line-height: 1.45; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .metric { border: 1px solid rgba(125, 211, 252, 0.22); border-radius: 14px; padding: 10px; background: rgba(8, 17, 31, 0.58); }
    .metric strong { display: block; color: #ffffff; font-size: 21px; }
    .metric span { color: rgba(229, 247, 255, 0.58); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
    .rail { height: 8px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,0.08); }
    .fill { height: 100%; width: 86%; background: linear-gradient(90deg, #22c55e, #46b6ff); }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">custom mcp-app node</div>
    <h1>Embedded agents can bring their own UI.</h1>
    <p>This lightweight iframe stands in for an MCP App: fast to load, self-contained, and paired with native graph/context nodes so agents still have semantic context.</p>
    <div class="grid">
      <div class="metric"><strong>39</strong><span>MCP tools</span></div>
      <div class="metric"><strong>${DEMO_NODE_TYPES.length}</strong><span>demo node types</span></div>
      <div class="metric"><strong>7</strong><span>resources</span></div>
    </div>
    <div class="rail" aria-label="demo readiness"><div class="fill"></div></div>
  </main>
</body>
</html>`;
}

function buildArchitectureSvgDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07111f"/><stop offset="1" stop-color="#16213a"/></linearGradient>
    <linearGradient id="node" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#12324f"/><stop offset="1" stop-color="#0f766e"/></linearGradient>
  </defs>
  <rect width="720" height="360" rx="28" fill="url(#bg)"/>
  <g fill="none" stroke="#46b6ff" stroke-width="4" opacity="0.7">
    <path d="M170 110h140M410 110h140M360 145v78M220 250h280"/>
  </g>
  <g font-family="Menlo, monospace" text-anchor="middle">
    <g transform="translate(80 70)"><rect width="140" height="82" rx="16" fill="url(#node)"/><text x="70" y="37" fill="#e5f7ff" font-size="17">MCP</text><text x="70" y="58" fill="#9bdcff" font-size="11">tools + resources</text></g>
    <g transform="translate(290 70)"><rect width="140" height="82" rx="16" fill="#1d4ed8"/><text x="70" y="37" fill="#fff" font-size="17">Server</text><text x="70" y="58" fill="#bfdbfe" font-size="11">single source</text></g>
    <g transform="translate(500 70)"><rect width="140" height="82" rx="16" fill="#7c3aed"/><text x="70" y="37" fill="#fff" font-size="17">Browser</text><text x="70" y="58" fill="#ddd6fe" font-size="11">live renderer</text></g>
    <g transform="translate(180 220)"><rect width="160" height="82" rx="16" fill="#15803d"/><text x="80" y="37" fill="#fff" font-size="17">Persistence</text><text x="80" y="58" fill="#bbf7d0" font-size="11">state + snapshots</text></g>
    <g transform="translate(390 220)"><rect width="160" height="82" rx="16" fill="#b45309"/><text x="80" y="37" fill="#fff" font-size="17">Pins</text><text x="80" y="58" fill="#fde68a" font-size="11">human intent</text></g>
  </g>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

function createDemoNodes(): CanvasNodeState[] {
  const projectSpec = buildProjectTourSpec();
  const nodes: CanvasNodeState[] = [
    ...groupDefinitions.map((group) => makeNode({
      id: group.id,
      type: 'group',
      title: group.title,
      x: group.x,
      y: group.y,
      width: group.width,
      height: group.height,
      zIndex: 0,
      data: { children: group.children, frameMode: 'manual', color: group.color },
    })),
    makeNode({
      id: 'demo-md-welcome',
      type: 'markdown',
      title: 'Start Here: PMX Canvas',
      x: 70,
      y: 90,
      width: 560,
      height: 420,
      content: [
        '# PMX Canvas',
        '',
        'A spatial workbench where humans and coding agents share the same visible state.',
        '',
        'Read this board left-to-right, then down:',
        '- native nodes explain the project without a build step',
        '- labeled edges show how server state, browser UI, MCP, and persistence connect',
        '- json-render, graph, file, webpage, image, trace, and MCP-app nodes show the real surfaces',
        '- translucent groups label the four regions without covering the content',
        '',
        '> Pin nodes to turn human spatial curation into agent-readable context.',
      ].join('\n'),
    }),
    makeNode({
      id: 'demo-status-health',
      type: 'status',
      title: 'Workbench Health',
      x: 670,
      y: 90,
      width: 560,
      height: 190,
      data: {
        phase: 'review',
        detail: 'demo seed loaded',
        message: 'One server-side canvas state powers HTTP, MCP, SDK, browser rendering, pins, and persistence.',
        level: 'ok',
        activeTool: 'pmx-canvas --demo',
      },
    }),
    makeNode({
      id: 'demo-image-architecture',
      type: 'image',
      title: 'Architecture Sketch',
      x: 670,
      y: 330,
      width: 560,
      height: 300,
      data: {
        src: buildArchitectureSvgDataUri(),
        alt: 'PMX Canvas architecture sketch',
        caption: 'MCP, HTTP, SDK, browser, and persistence all meet at server-side canvas state.',
      },
    }),
    makeNode({
      id: 'demo-excalidraw-architecture',
      type: 'mcp-app',
      title: 'Excalidraw: How It Works',
      x: 70,
      y: 650,
      width: 1160,
      height: 780,
      data: {
        mode: 'ext-app',
        html: buildExcalidrawDemoHtml(),
        serverName: EXCALIDRAW_SERVER_NAME,
        toolName: EXCALIDRAW_CREATE_VIEW_TOOL,
        toolCallId: 'demo-excalidraw-architecture',
        resourceUri: 'ui://excalidraw/pmx-canvas-demo.html',
        sessionStatus: 'ready',
        sessionError: null,
        toolInput: { elements: normalizeExcalidrawElementsForToolInput(buildExcalidrawDemoElements()) },
        toolResult: {
          content: [{ type: 'text', text: 'PMX Canvas architecture diagram loaded.' }],
          structuredContent: { checkpointId: buildExcalidrawCheckpointId('demo-excalidraw-architecture') },
        },
        toolDefinition: {
          name: EXCALIDRAW_CREATE_VIEW_TOOL,
          title: 'Create Excalidraw View',
          description: 'Static fast-demo payload shaped like the hosted Excalidraw MCP app result.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        resourceMeta: {
          name: 'Excalidraw PMX Canvas Demo',
          description: 'Architecture diagram showing PMX Canvas data flow.',
        },
      },
    }),
    makeNode({
      id: 'demo-md-surfaces',
      type: 'markdown',
      title: 'How To Drive It',
      x: 1370,
      y: 90,
      width: 540,
      height: 360,
      content: [
        '## Control Surfaces',
        '',
        'Every client mutates the same server-side canvas state:',
        '',
        '```bash',
        'pmx-canvas node add --type markdown --title "Note"',
        'pmx-canvas pin --list',
        'pmx-canvas snapshot list --limit 10',
        '```',
        '',
        'MCP tools expose the same core operations for agent harnesses.',
      ].join('\n'),
    }),
    makeNode({
      id: 'demo-json-dashboard',
      type: 'json-render',
      title: 'Native UI Dashboard',
      x: 1950,
      y: 90,
      width: 940,
      height: 700,
      data: createJsonRenderNodeData('demo-json-dashboard', 'Native UI Dashboard', projectSpec, {
        viewerType: 'json-render',
        strictSize: true,
      }),
    }),
    buildGraphNode({
      id: 'demo-graph-capabilities',
      title: 'Capability Coverage Radar',
      graphType: 'radar',
      data: [
        { capability: 'State', native: 5, agent: 4 },
        { capability: 'UI', native: 4, agent: 3 },
        { capability: 'MCP', native: 4, agent: 5 },
        { capability: 'Persistence', native: 5, agent: 4 },
        { capability: 'Review', native: 3, agent: 5 },
      ],
      axisKey: 'capability',
      metrics: ['native', 'agent'],
      x: 1370,
      y: 520,
      width: 540,
      height: 360,
      heightPx: 720,
      showLegend: true,
    }),
    makeNode({
      id: 'demo-ledger-persistence',
      type: 'ledger',
      title: 'Persistence Ledger',
      x: 70,
      y: 1550,
      width: 420,
      height: 280,
      data: {
        stateFile: '.pmx-canvas/state.json',
        snapshots: '.pmx-canvas/snapshots',
        blobSidecars: 'large app payloads',
        undoRedoEntries: 200,
        defaultSnapshotList: '20 newest',
      },
    }),
    makeNode({
      id: 'demo-file-server',
      type: 'file',
      title: 'src/server/canvas-state.ts',
      x: 540,
      y: 1550,
      width: 690,
      height: 320,
      content: 'src/server/canvas-state.ts',
      data: { path: 'src/server/canvas-state.ts' },
    }),
    makeNode({
      id: 'demo-webpage-docs',
      type: 'webpage',
      title: 'Docs Snapshot',
      x: 70,
      y: 1910,
      width: 420,
      height: 330,
      data: {
        url: 'https://github.com/pskoett/pmx-canvas',
        pageTitle: 'PMX Canvas repository',
        description: 'Persisted webpage nodes keep URL context and cached text available for later agent grounding.',
        excerpt: 'PMX Canvas is a spatial canvas workbench for coding agents with nodes, edges, groups, MCP tools, HTTP API, and a Bun SDK.',
        content: 'PMX Canvas is a spatial canvas workbench for coding agents with nodes, edges, groups, MCP tools, HTTP API, and a Bun SDK.',
        fetchedAt: '2026-05-04T00:00:00.000Z',
        status: 'ready',
        statusCode: 200,
        contentType: 'text/html; charset=utf-8',
        frameBlocked: true,
        frameBlockedReason: 'Demo uses a cached snapshot so startup never waits on the network.',
      },
    }),
    buildGraphNode({
      id: 'demo-graph-mix',
      title: 'Node Mix In This Demo',
      graphType: 'bar',
      data: [
        { type: 'Narrative', count: 4 },
        { type: 'Structured', count: 2 },
        { type: 'Telemetry', count: 4 },
        { type: 'Collaboration', count: 4 },
      ],
      xKey: 'type',
      yKey: 'count',
      color: '#46b6ff',
      x: 540,
      y: 1910,
      width: 690,
      heightPx: 700,
      height: 340,
      showLegend: false,
    }),
    makeNode({
      id: 'demo-context-pins',
      type: 'context',
      title: 'Human Curated Context',
      x: 1370,
      y: 1380,
      width: 540,
      height: 540,
      data: {
        currentTokens: 18400,
        tokenLimit: 128000,
        utilization: 0.14,
        messagesLength: 9,
        cards: [
          { label: 'Pinned intent', summary: 'Humans pin the nodes an agent should treat as current context.', category: 'planning', state: 'loaded', sourceKind: 'workspace', required: true },
          { label: 'Spatial memory', summary: 'Nearby unpinned nodes are exposed as neighborhoods instead of pasted prompt text.', category: 'memory', state: 'loaded', sourceKind: 'workspace' },
          { label: 'Fast honest demo', summary: 'The tour uses native nodes only; no fake ask/answer flow or web-artifact build.', category: 'profile', state: 'loaded', sourceKind: 'global' },
        ],
      },
    }),
    makeNode({
      id: 'demo-trace-api',
      type: 'trace',
      title: 'Trace: canvas_get_layout',
      x: 1940,
      y: 1830,
      width: 250,
      height: 120,
      data: {
        toolName: 'canvas_get_layout',
        category: 'mcp',
        status: 'success',
        duration: '18ms',
        resultSummary: 'Compact default layout returned for agents',
      },
    }),
    makeNode({
      id: 'demo-trace-build',
      type: 'trace',
      title: 'Trace: browser SSE',
      x: 2210,
      y: 1830,
      width: 250,
      height: 120,
      data: {
        toolName: 'workbench/events',
        category: 'other',
        status: 'running',
        duration: 'live',
        resultSummary: 'Canvas updates stream to the browser',
      },
    }),
    makeNode({
      id: 'demo-mcp-app',
      type: 'mcp-app',
      title: 'Custom MCP App Preview',
      x: 1940,
      y: 1380,
      width: 950,
      height: 420,
      data: {
        mode: 'ext-app',
        html: buildDemoMcpAppHtml(),
        serverName: 'PMX Demo App',
        toolName: 'demo_canvas_overview',
        toolCallId: 'demo-canvas-overview',
        resourceUri: 'ui://pmx-demo/overview.html',
        sessionStatus: 'ready',
        sessionError: null,
        toolInput: { nodeTypes: DEMO_NODE_TYPES.length, fastStart: true },
        toolResult: {
          content: [{ type: 'text', text: 'PMX Canvas demo app loaded.' }],
          structuredContent: { tools: 39, nodeTypes: DEMO_NODE_TYPES.length, resources: 7 },
        },
        toolDefinition: {
          name: 'demo_canvas_overview',
          title: 'PMX Canvas Demo Overview',
          description: 'Static custom MCP app payload used by the built-in demo.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        resourceMeta: {
          name: 'PMX Canvas Demo Overview',
          description: 'Self-contained iframe preview for the demo board.',
        },
      },
    }),
  ];
  return withGroupMembership(nodes);
}

function withGroupMembership(nodes: CanvasNodeState[]): CanvasNodeState[] {
  const parentByChild = new Map<string, string>();
  for (const group of groupDefinitions) {
    for (const childId of group.children) parentByChild.set(childId, group.id);
  }

  return nodes.map((node) => {
    const parentGroup = parentByChild.get(node.id);
    if (!parentGroup) return node;
    return {
      ...node,
      data: {
        ...node.data,
        parentGroup,
      },
    };
  });
}

function createDemoEdges(): CanvasEdge[] {
  return [
    makeEdge('demo-edge-welcome-health', 'demo-md-welcome', 'demo-status-health', 'flow', 'starts server'),
    makeEdge('demo-edge-health-sketch', 'demo-status-health', 'demo-image-architecture', 'references', 'architecture'),
    makeEdge('demo-edge-surfaces-dashboard', 'demo-md-surfaces', 'demo-json-dashboard', 'references', 'renders structured UI'),
    makeEdge('demo-edge-dashboard-radar', 'demo-json-dashboard', 'demo-graph-capabilities', 'references', 'radar variant'),
    makeEdge('demo-edge-excalidraw-state', 'demo-excalidraw-architecture', 'demo-ledger-persistence', 'references', 'diagram explains state'),
    makeEdge('demo-edge-state-file', 'demo-ledger-persistence', 'demo-file-server', 'depends-on', 'source of truth'),
    makeEdge('demo-edge-ledger-webpage', 'demo-ledger-persistence', 'demo-webpage-docs', 'references', 'cached context'),
    makeEdge('demo-edge-file-graph', 'demo-file-server', 'demo-graph-mix', 'references', 'node mix'),
    makeEdge('demo-edge-context-trace', 'demo-context-pins', 'demo-trace-api', 'references', 'agent grounding'),
    makeEdge('demo-edge-app-context', 'demo-mcp-app', 'demo-context-pins', 'relation', 'opaque app paired with context', { style: 'dotted' }),
    makeEdge('demo-edge-app-trace-api', 'demo-mcp-app', 'demo-trace-api', 'references', 'tool evidence'),
    makeEdge('demo-edge-trace-stream', 'demo-trace-api', 'demo-trace-build', 'flow', 'streams updates', { animated: true }),
  ];
}

export function seedDemoCanvas(): { nodes: number; edges: number; groups: number } {
  const nodes = createDemoNodes();
  const edges = createDemoEdges();
  canvasState.withSuppressedRecording(() => {
    for (const node of nodes) canvasState.addNode(node);
    for (const edge of edges) canvasState.addEdge(edge);
    canvasState.setContextPins(['demo-md-welcome', 'demo-json-dashboard', 'demo-context-pins']);
    canvasState.setViewport({ x: 80, y: 52, scale: 0.58 });
  });
  canvasState.flushToDisk();
  return {
    nodes: nodes.length,
    edges: edges.length,
    groups: groupDefinitions.length,
  };
}
