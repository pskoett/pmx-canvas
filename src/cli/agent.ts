#!/usr/bin/env bun
/**
 * Agent-native CLI for pmx-canvas.
 *
 * Designed for non-interactive use by coding agents:
 * - Every input is a flag (no interactive prompts)
 * - JSON output by default
 * - Progressive --help discovery
 * - Fail fast with actionable errors
 * - Idempotent operations where possible
 * - --yes for destructive actions, --dry-run for preview
 */

// ── Helpers ──────────────────────────────────────────────────

const DEFAULT_PORT = 4313;

function getBaseUrl(): string {
  const envUrl = process.env.PMX_CANVAS_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  const port = process.env.PMX_CANVAS_PORT || DEFAULT_PORT;
  return `http://localhost:${port}`;
}

function die(message: string, hint?: string): never {
  const out: Record<string, string> = { error: message };
  if (hint) out.hint = hint;
  console.error(JSON.stringify(out));
  process.exit(1);
}

function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const base = getBaseUrl();
  const url = `${base}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(url, opts);
  } catch (error) {
    die(
      `Cannot connect to pmx-canvas at ${base}: ${error instanceof Error ? error.message : String(error)}`,
      `Start the server first: pmx-canvas serve --no-open`,
    );
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    if (!res.ok) die(`HTTP ${res.status}: ${text}`);
    console.debug('[cli] response was not JSON', error);
    return text;
  }

  if (!res.ok) {
    const err = json as Record<string, unknown>;
    die(
      err.error ? String(err.error) : `HTTP ${res.status}`,
      typeof err.hint === 'string' ? err.hint : undefined,
    );
  }
  return json;
}

// ── Flag parsing ─────────────────────────────────────────────

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  // Boolean-only flags (never take a value argument)
  const BOOL_FLAGS = new Set(['help', 'h', 'ids', 'stdin', 'yes', 'list', 'clear', 'set', 'animated', 'dry-run']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        // If not a boolean flag and next arg exists and isn't a flag, consume it as value
        if (!BOOL_FLAGS.has(key) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
          flags[key] = args[++i];
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function requireFlag(flags: Record<string, string | true>, name: string, hint: string): string {
  const val = flags[name];
  if (!val || val === true) {
    die(`Missing required flag: --${name}`, hint);
  }
  return val;
}

// ── Commands ─────────────────────────────────────────────────

const COMMANDS: Record<string, { run: (args: string[]) => Promise<void>; help: string; examples: string[] }> = {};

function cmd(
  name: string,
  help: string,
  examples: string[],
  run: (args: string[]) => Promise<void>,
) {
  COMMANDS[name] = { run, help, examples };
}

// ── node add ─────────────────────────────────────────────────
cmd('node add', 'Add a node to the canvas', [
  'pmx-canvas node add --type markdown --title "Design Doc" --content "# Overview"',
  'pmx-canvas node add --type status --title "Build" --content "passing"',
  'pmx-canvas node add --type file --title "src/index.ts" --content "$(cat src/index.ts)"',
  'pmx-canvas node add --type markdown --title "Note" --x 100 --y 200',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node add');

  const type = (flags.type as string) || 'markdown';
  const body: Record<string, unknown> = { type };
  if (flags.title) body.title = flags.title;
  if (flags.content) body.content = flags.content;
  if (flags.x) body.x = Number(flags.x);
  if (flags.y) body.y = Number(flags.y);
  if (flags.width) body.width = Number(flags.width);
  if (flags.height) body.height = Number(flags.height);

  // Support --stdin for piping content
  if (flags.stdin) {
    body.content = await readStdin();
  }

  const result = await api('POST', '/api/canvas/node', body);
  output(result);
});

// ── node list ────────────────────────────────────────────────
cmd('node list', 'List all nodes on the canvas', [
  'pmx-canvas node list',
  'pmx-canvas node list --type markdown',
  'pmx-canvas node list --ids',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node list');

  const layout = (await api('GET', '/api/canvas/state')) as { nodes: Array<Record<string, unknown>> };
  let nodes = layout.nodes;

  if (flags.type && flags.type !== true) {
    nodes = nodes.filter((n) => n.type === flags.type);
  }

  if (flags.ids) {
    output(nodes.map((n) => n.id));
  } else {
    output(nodes.map((n) => ({
      id: n.id,
      type: n.type,
      title: (n.data as Record<string, unknown>)?.title ?? null,
      position: n.position,
    })));
  }
});

// ── node get ─────────────────────────────────────────────────
cmd('node get', 'Get a node by ID', [
  'pmx-canvas node get <node-id>',
  'pmx-canvas node get node-abc123',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node get');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas node get <node-id>');

  const result = await api('GET', `/api/canvas/node/${encodeURIComponent(id)}`);
  output(result);
});

// ── node update ──────────────────────────────────────────────
cmd('node update', 'Update a node by ID', [
  'pmx-canvas node update <node-id> --title "New Title"',
  'pmx-canvas node update <node-id> --content "Updated content"',
  'pmx-canvas node update <node-id> --title "Moved" --x 500 --y 300',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node update');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas node update <node-id> --title "New Title"');

  const body: Record<string, unknown> = {};
  if (flags.title && flags.title !== true) body.title = flags.title;
  if (flags.content && flags.content !== true) body.content = flags.content;
  if (flags.stdin) body.content = await readStdin();
  if (flags.x || flags.y) {
    body.position = {
      ...(flags.x ? { x: Number(flags.x) } : {}),
      ...(flags.y ? { y: Number(flags.y) } : {}),
    };
  }

  const result = await api('PATCH', `/api/canvas/node/${encodeURIComponent(id)}`, body);
  output(result);
});

// ── node remove ──────────────────────────────────────────────
cmd('node remove', 'Remove a node from the canvas', [
  'pmx-canvas node remove <node-id>',
  'pmx-canvas node remove node-abc123',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node remove');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas node remove <node-id>');

  const result = await api('DELETE', `/api/canvas/node/${encodeURIComponent(id)}`);
  output(result);
});

// ── edge add ─────────────────────────────────────────────────
cmd('edge add', 'Add an edge between two nodes', [
  'pmx-canvas edge add --from <node-id> --to <node-id> --type flow',
  'pmx-canvas edge add --from n1 --to n2 --type depends-on --label "imports"',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('edge add');

  const from = requireFlag(flags, 'from', 'pmx-canvas edge add --from <id> --to <id> --type flow');
  const to = requireFlag(flags, 'to', 'pmx-canvas edge add --from <id> --to <id> --type flow');
  const type = (flags.type as string) || 'flow';

  const body: Record<string, unknown> = { from, to, type };
  if (flags.label && flags.label !== true) body.label = flags.label;
  if (flags.animated) body.animated = true;

  const result = await api('POST', '/api/canvas/edge', body);
  output(result);
});

// ── edge list ────────────────────────────────────────────────
cmd('edge list', 'List all edges on the canvas', [
  'pmx-canvas edge list',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('edge list');

  const layout = (await api('GET', '/api/canvas/state')) as { edges: unknown[] };
  output(layout.edges);
});

// ── edge remove ──────────────────────────────────────────────
cmd('edge remove', 'Remove an edge by ID', [
  'pmx-canvas edge remove <edge-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('edge remove');

  const id = positional[0];
  if (!id) die('Missing edge ID', 'pmx-canvas edge remove <edge-id>');

  const result = await api('DELETE', '/api/canvas/edge', { edge_id: id });
  output(result);
});

// ── search ───────────────────────────────────────────────────
cmd('search', 'Search nodes by title or content', [
  'pmx-canvas search "design doc"',
  'pmx-canvas search --query "TODO"',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('search');

  const query = positional[0] || (typeof flags.query === 'string' ? flags.query : '');
  if (!query) die('Missing search query', 'pmx-canvas search "query"');

  const result = await api('GET', `/api/canvas/search?q=${encodeURIComponent(query)}`);
  output(result);
});

// ── layout ───────────────────────────────────────────────────
cmd('layout', 'Get the full canvas layout (nodes, edges, viewport)', [
  'pmx-canvas layout',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('layout');

  const result = await api('GET', '/api/canvas/state');
  output(result);
});

// ── status ───────────────────────────────────────────────────
cmd('status', 'Quick canvas summary', [
  'pmx-canvas status',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('status');

  const layout = (await api('GET', '/api/canvas/state')) as {
    nodes: Array<Record<string, unknown>>;
    edges: unknown[];
    viewport: unknown;
  };
  const pinned = (await api('GET', '/api/canvas/pinned-context')) as { count: number; nodeIds: string[] };

  const typeCounts: Record<string, number> = {};
  for (const n of layout.nodes) {
    const t = n.type as string;
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
cmd('arrange', 'Auto-arrange nodes on the canvas', [
  'pmx-canvas arrange',
  'pmx-canvas arrange --layout column',
  'pmx-canvas arrange --layout flow',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('arrange');

  const body: Record<string, unknown> = {};
  if (flags.layout && flags.layout !== true) body.layout = flags.layout;

  const result = await api('POST', '/api/canvas/arrange', body);
  output(result);
});

// ── focus ────────────────────────────────────────────────────
cmd('focus', 'Pan viewport to center on a node', [
  'pmx-canvas focus <node-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('focus');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas focus <node-id>');

  const result = await api('POST', '/api/canvas/focus', { id });
  output(result);
});

// ── pin ──────────────────────────────────────────────────────
cmd('pin', 'Manage context pins', [
  'pmx-canvas pin --set node1 node2 node3',
  'pmx-canvas pin --list',
  'pmx-canvas pin --clear',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('pin');

  if (flags.list) {
    const result = await api('GET', '/api/canvas/pinned-context');
    output(result);
    return;
  }

  if (flags.clear) {
    const result = await api('POST', '/api/canvas/context-pins', { nodeIds: [] });
    output(result);
    return;
  }

  // --set: positional args are node IDs
  if (positional.length > 0 || flags.set) {
    const result = await api('POST', '/api/canvas/context-pins', { nodeIds: positional });
    output(result);
    return;
  }

  // Default: list
  const result = await api('GET', '/api/canvas/pinned-context');
  output(result);
});

// ── undo ─────────────────────────────────────────────────────
cmd('undo', 'Undo the last canvas mutation', [
  'pmx-canvas undo',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('undo');

  const result = await api('POST', '/api/canvas/undo');
  output(result);
});

// ── redo ─────────────────────────────────────────────────────
cmd('redo', 'Redo the last undone mutation', [
  'pmx-canvas redo',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('redo');

  const result = await api('POST', '/api/canvas/redo');
  output(result);
});

// ── history ──────────────────────────────────────────────────
cmd('history', 'Show canvas mutation history', [
  'pmx-canvas history',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('history');

  const result = await api('GET', '/api/canvas/history');
  output(result);
});

// ── snapshot save ────────────────────────────────────────────
cmd('snapshot save', 'Save a named snapshot of the current canvas', [
  'pmx-canvas snapshot save --name "before-refactor"',
  'pmx-canvas snapshot save --name checkpoint-1',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot save');

  const name = requireFlag(flags, 'name', 'pmx-canvas snapshot save --name "my-snapshot"');
  const result = await api('POST', '/api/canvas/snapshots', { name });
  output(result);
});

// ── snapshot list ────────────────────────────────────────────
cmd('snapshot list', 'List all saved snapshots', [
  'pmx-canvas snapshot list',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot list');

  const result = await api('GET', '/api/canvas/snapshots');
  output(result);
});

// ── snapshot restore ─────────────────────────────────────────
cmd('snapshot restore', 'Restore canvas from a snapshot', [
  'pmx-canvas snapshot restore <snapshot-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot restore');

  const id = positional[0];
  if (!id) die('Missing snapshot ID', 'pmx-canvas snapshot restore <snapshot-id>');

  const result = await api('POST', `/api/canvas/snapshots/${encodeURIComponent(id)}`);
  output(result);
});

// ── snapshot delete ──────────────────────────────────────────
cmd('snapshot delete', 'Delete a saved snapshot', [
  'pmx-canvas snapshot delete <snapshot-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot delete');

  const id = positional[0];
  if (!id) die('Missing snapshot ID', 'pmx-canvas snapshot delete <snapshot-id>');

  const result = await api('DELETE', `/api/canvas/snapshots/${encodeURIComponent(id)}`);
  output(result);
});

// ── diff ─────────────────────────────────────────────────────
cmd('diff', 'Compare current canvas against a snapshot', [
  'pmx-canvas diff <snapshot-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('diff');

  // Diff is only available via MCP — use snapshot list + layout comparison
  // For now, show snapshots and current state side by side
  die('diff requires the MCP server', 'Use: pmx-canvas --mcp with canvas_diff tool, or compare snapshots manually');
});

// ── group create ─────────────────────────────────────────────
cmd('group create', 'Create a group node', [
  'pmx-canvas group create --title "API Layer" --children node1 node2',
  'pmx-canvas group create --title "Frontend" --color "#ff6b6b"',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('group create');

  const body: Record<string, unknown> = {};
  if (flags.title && flags.title !== true) body.title = flags.title;
  if (flags.color && flags.color !== true) body.color = flags.color;
  if (positional.length > 0) body.childIds = positional;

  const result = await api('POST', '/api/canvas/group', body);
  output(result);
});

// ── group add ────────────────────────────────────────────────
cmd('group add', 'Add nodes to an existing group', [
  'pmx-canvas group add --group <group-id> node1 node2',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('group add');

  const groupId = requireFlag(flags, 'group', 'pmx-canvas group add --group <group-id> node1 node2');
  if (positional.length === 0) die('No node IDs provided', 'pmx-canvas group add --group <group-id> node1 node2');

  const result = await api('POST', '/api/canvas/group/add', { groupId, childIds: positional });
  output(result);
});

// ── group remove ─────────────────────────────────────────────
cmd('group remove', 'Ungroup all children from a group', [
  'pmx-canvas group remove <group-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('group remove');

  const id = positional[0];
  if (!id) die('Missing group ID', 'pmx-canvas group remove <group-id>');

  const result = await api('POST', '/api/canvas/group/ungroup', { groupId: id });
  output(result);
});

// ── clear ────────────────────────────────────────────────────
cmd('clear', 'Remove all nodes and edges from the canvas', [
  'pmx-canvas clear --yes',
  'pmx-canvas clear --dry-run',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('clear');

  if (flags['dry-run']) {
    const layout = (await api('GET', '/api/canvas/state')) as { nodes: unknown[]; edges: unknown[] };
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

  const result = await api('POST', '/api/canvas/clear');
  output(result);
});

// ── code-graph ───────────────────────────────────────────────
cmd('code-graph', 'Show auto-detected file dependency graph', [
  'pmx-canvas code-graph',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('code-graph');

  const result = await api('GET', '/api/canvas/code-graph');
  output(result);
});

// ── spatial ──────────────────────────────────────────────────
cmd('spatial', 'Spatial analysis: clusters, reading order, neighborhoods', [
  'pmx-canvas spatial',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('spatial');

  const result = await api('GET', '/api/canvas/spatial-context');
  output(result);
});

// ── serve (delegates back to original CLI) ───────────────────
cmd('serve', 'Start the canvas server', [
  'pmx-canvas serve',
  'pmx-canvas serve --port=8080 --no-open',
  'pmx-canvas serve --demo --theme=light',
], async (_args) => {
  // This is handled by the main CLI entry point — just show help
  console.log('Use: pmx-canvas [--port=PORT] [--demo] [--no-open] [--theme=THEME]');
  console.log('Or:  pmx-canvas serve --port=8080 --demo');
});

// ── Help ─────────────────────────────────────────────────────

function showCommandHelp(name: string): void {
  const cmd = COMMANDS[name];
  if (!cmd) return;
  console.log(`\npmx-canvas ${name} — ${cmd.help}\n`);
  console.log('Examples:');
  for (const ex of cmd.examples) {
    console.log(`  ${ex}`);
  }
  console.log('');
}

function showTopLevelHelp(): void {
  console.log(`
pmx-canvas — Agent-native CLI for spatial canvas workbench

Usage:
  pmx-canvas <command> [options]
  pmx-canvas [server-options]

Server:
  pmx-canvas                          Start server + open browser
  pmx-canvas --no-open --demo         Start server headless with sample data
  pmx-canvas --mcp                    Run as MCP server (stdio)

Node commands:
  pmx-canvas node add [options]       Add a node
  pmx-canvas node list [--type TYPE]  List all nodes
  pmx-canvas node get <id>            Get a node by ID
  pmx-canvas node update <id> [opts]  Update a node
  pmx-canvas node remove <id>         Remove a node

Edge commands:
  pmx-canvas edge add [options]       Add an edge between nodes
  pmx-canvas edge list                List all edges
  pmx-canvas edge remove <id>         Remove an edge

Canvas commands:
  pmx-canvas layout                   Full canvas state (JSON)
  pmx-canvas status                   Quick summary
  pmx-canvas search <query>           Search nodes by content
  pmx-canvas arrange [--layout MODE]  Auto-arrange (grid|column|flow)
  pmx-canvas focus <id>               Pan viewport to node
  pmx-canvas clear --yes              Clear all nodes and edges

Context pins:
  pmx-canvas pin <id1> <id2> ...      Set pinned nodes
  pmx-canvas pin --list               List pinned context
  pmx-canvas pin --clear              Clear all pins

History:
  pmx-canvas undo                     Undo last mutation
  pmx-canvas redo                     Redo last undone
  pmx-canvas history                  Show mutation timeline

Snapshots:
  pmx-canvas snapshot save --name X   Save a named snapshot
  pmx-canvas snapshot list            List snapshots
  pmx-canvas snapshot restore <id>    Restore from snapshot
  pmx-canvas snapshot delete <id>     Delete a snapshot

Groups:
  pmx-canvas group create [options]   Create a group
  pmx-canvas group add --group <id>   Add nodes to group
  pmx-canvas group remove <id>        Ungroup children

Analysis:
  pmx-canvas code-graph               File dependency graph
  pmx-canvas spatial                   Spatial clusters & neighborhoods

Global flags:
  --help, -h                          Show help for any command

Environment:
  PMX_CANVAS_URL    Server URL (default: http://localhost:4313)
  PMX_CANVAS_PORT   Server port (default: 4313)

Examples:
  pmx-canvas node add --type markdown --title "API Design" --content "# REST API"
  pmx-canvas node list --type file --ids
  pmx-canvas edge add --from node-abc --to node-def --type depends-on
  pmx-canvas search "authentication"
  pmx-canvas arrange --layout column
  pmx-canvas snapshot save --name "pre-refactor"
  pmx-canvas clear --dry-run
  cat design.md | pmx-canvas node add --type markdown --title "Design" --stdin
`);
}

// ── Stdin reader ─────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// ── Router ───────────────────────────────────────────────────

export async function runAgentCli(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showTopLevelHelp();
    return;
  }

  // Try two-word command first (e.g., "node add"), then one-word (e.g., "search")
  const twoWord = `${args[0]} ${args[1] ?? ''}`.trim();
  if (COMMANDS[twoWord]) {
    await COMMANDS[twoWord].run(args.slice(2));
    return;
  }

  const oneWord = args[0];
  if (COMMANDS[oneWord]) {
    await COMMANDS[oneWord].run(args.slice(1));
    return;
  }

  // Unknown command — show help for the resource if it exists
  const resourceCommands = Object.keys(COMMANDS).filter((k) => k.startsWith(oneWord + ' '));
  if (resourceCommands.length > 0) {
    console.log(`\nAvailable "${oneWord}" commands:\n`);
    for (const k of resourceCommands) {
      console.log(`  pmx-canvas ${k.padEnd(20)} ${COMMANDS[k].help}`);
    }
    console.log('\nRun any command with --help for details.\n');
    return;
  }

  die(`Unknown command: ${oneWord}`, 'Run: pmx-canvas --help');
}
