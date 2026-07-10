// Viewport/canvas commands: open, layout, status, arrange, focus, fit, clear,
// and the serve usage stub.

import { openUrlInExternalBrowser } from '../../server/server.js';
import {
  cmd,
  die,
  getBaseUrl,
  invokeOperation,
  isRecord,
  optionalPositiveFiniteFlag,
  output,
  parseFlags,
  showCommandHelp,
} from '../shared.js';

cmd('open', 'Open the current workbench in the browser', ['pmx-canvas open'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('open');

  const base = getBaseUrl();
  try {
    const response = await fetch(`${base}/health`);
    if (!response.ok) {
      die(`Cannot reach pmx-canvas health endpoint at ${base}: HTTP ${response.status}`);
    }
  } catch (error) {
    die(
      `Cannot connect to pmx-canvas at ${base}: ${error instanceof Error ? error.message : String(error)}`,
      'Start the server first: pmx-canvas --no-open',
    );
  }

  const url = `${base}/workbench`;
  if (!openUrlInExternalBrowser(url)) {
    die(`Failed to open browser for ${url}`);
  }
  output({ ok: true, url });
});

// ── layout ───────────────────────────────────────────────────
cmd(
  'layout',
  'Get the full canvas layout (nodes, edges, viewport)',
  ['pmx-canvas layout', 'pmx-canvas layout --summary'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('layout');

    if (flags.summary || flags.compact) {
      output(await invokeOperation('summary.get', {}));
      return;
    }
    const result = await invokeOperation('layout.get', {});
    output(result);
  },
);

// ── status ───────────────────────────────────────────────────
cmd('status', 'Quick canvas summary', ['pmx-canvas status'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('status');

  const layout = (await invokeOperation('layout.get', {})) as {
    nodes: Array<Record<string, unknown>>;
    edges: unknown[];
    viewport: unknown;
  };
  const pinned = (await invokeOperation('pinned-context.get', {})) as { count: number; nodeIds: string[] };

  const typeCounts: Record<string, number> = {};
  for (const n of layout.nodes) {
    const data = isRecord(n.data) ? n.data : {};
    const t =
      typeof n.kind === 'string'
        ? n.kind
        : n.type === 'mcp-app' && data.hostMode === 'hosted' && typeof data.path === 'string'
          ? 'web-artifact'
          : (n.type as string);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  output({
    nodes: layout.nodes.length,
    edges: layout.edges.length,
    pinned: pinned.count,
    types: typeCounts,
    viewport: layout.viewport,
  });
});

// ── arrange ──────────────────────────────────────────────────
cmd(
  'arrange',
  'Auto-arrange nodes on the canvas',
  ['pmx-canvas arrange', 'pmx-canvas arrange --layout column', 'pmx-canvas arrange --layout flow'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('arrange');

    const body: Record<string, unknown> = {};
    if (flags.layout && flags.layout !== true) body.layout = flags.layout;

    const result = await invokeOperation('arrange', body);
    output(result);
  },
);

// ── focus ────────────────────────────────────────────────────
cmd('focus', 'Pan viewport to center on a node', ['pmx-canvas focus <node-id>'], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('focus');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas focus <node-id>');

  const result = await invokeOperation('node.focus', { id, ...(flags['no-pan'] ? { noPan: true } : {}) });
  output(result);
});

cmd(
  'fit',
  'Fit the viewport to all nodes or a selected subset',
  ['pmx-canvas fit', 'pmx-canvas fit --width 1440 --height 900 --padding 80', 'pmx-canvas fit node-a node-b'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('fit');

    const body: Record<string, unknown> = {};
    const width = optionalPositiveFiniteFlag(flags, 'width', 'Use a positive number, e.g. --width 1440');
    const height = optionalPositiveFiniteFlag(flags, 'height', 'Use a positive number, e.g. --height 900');
    const padding = optionalPositiveFiniteFlag(flags, 'padding', 'Use a positive number, e.g. --padding 80');
    const maxScale = optionalPositiveFiniteFlag(flags, 'max-scale', 'Use a positive number, e.g. --max-scale 1');
    if (width !== undefined) body.width = width;
    if (height !== undefined) body.height = height;
    if (padding !== undefined) body.padding = padding;
    if (maxScale !== undefined) body.maxScale = maxScale;
    if (positional.length > 0) body.nodeIds = positional;

    const result = await invokeOperation('view.fit', body);
    output(result);
  },
);

// ── clear ────────────────────────────────────────────────────
cmd(
  'clear',
  'Remove all nodes and edges from the canvas',
  ['pmx-canvas clear --yes', 'pmx-canvas clear --dry-run'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('clear');

    if (flags['dry-run']) {
      const layout = (await invokeOperation('layout.get', {})) as { nodes: unknown[]; edges: unknown[] };
      output({
        dry_run: true,
        would_remove: { nodes: layout.nodes.length, edges: layout.edges.length },
        message: 'No changes made. Pass --yes to confirm.',
      });
      return;
    }

    if (!flags.yes) {
      die('Destructive operation requires --yes flag', 'pmx-canvas clear --yes (or preview with --dry-run)');
    }

    const result = await invokeOperation('canvas.clear', {});
    output(result);
  },
);

// ── serve (delegates back to original CLI) ───────────────────
cmd(
  'serve',
  'Start the canvas server',
  [
    'pmx-canvas serve',
    'pmx-canvas serve --port=8080 --no-open',
    'pmx-canvas serve --demo --theme=light',
    'pmx-canvas --no-open --webview-automation',
  ],
  async (_args) => {
    console.log('Use: pmx-canvas [--port=PORT] [--demo] [--no-open] [--theme=THEME] [--webview-automation]');
  },
);
