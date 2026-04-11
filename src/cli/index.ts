#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentCli } from './agent.js';
import { createCanvas } from '../server/index.js';

const args = process.argv.slice(2);

// ── Agent CLI subcommands ────────────────────────────────────
// If first arg is a known subcommand (not a --flag), route to the agent CLI.
const AGENT_COMMANDS = new Set([
  'node', 'edge', 'search', 'layout', 'status', 'arrange', 'focus',
  'pin', 'undo', 'redo', 'history', 'snapshot', 'diff', 'group',
  'clear', 'code-graph', 'spatial', 'serve',
]);

const firstArg = args[0] ?? '';
const cliDir = dirname(fileURLToPath(import.meta.url));
const mcpServerEntry = resolve(cliDir, '..', 'mcp', 'server.ts');

function runMcpServerProcess(): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['run', mcpServerEntry], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(
        signal
          ? `MCP server exited via signal ${signal}`
          : `MCP server exited with code ${code ?? 'unknown'}`,
      ));
    });
  });
}

if (AGENT_COMMANDS.has(firstArg)) {
  await runAgentCli(args);
} else if (args.includes('--mcp')) {
  // MCP server mode: stdio transport, auto-starts canvas on first tool call
  await runMcpServerProcess();
} else {
  // "serve" is also accessible via flags (backward compat)
  const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] ?? '4313');
  const demo = args.includes('--demo');
  const noOpen = args.includes('--no-open');
  const themeArg = args.find(a => a.startsWith('--theme='))?.split('=')[1];
  if (themeArg && ['dark', 'light', 'high-contrast'].includes(themeArg)) {
    process.env.PMX_CANVAS_THEME = themeArg;
  }
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
pmx-canvas — Spatial canvas workbench for coding agents

Usage:
  pmx-canvas [server-options]         Start the canvas server
  pmx-canvas <command> [options]      Run agent CLI commands

Server options:
  --port=PORT    Server port (default: 4313)
  --demo         Start with sample nodes
  --no-open      Don't open browser automatically
  --theme=THEME  Theme: dark (default), light, high-contrast
  --mcp          Run as MCP server (stdio transport)
  --help, -h     Show this help

Agent CLI (works against running server):
  node add|list|get|update|remove     Manage nodes
  edge add|list|remove                Manage edges
  search <query>                      Search nodes
  layout                              Full canvas state
  status                              Quick summary
  arrange [--layout grid|column|flow] Auto-arrange nodes
  focus <node-id>                     Pan to node
  pin <ids...> | --list | --clear     Manage context pins
  undo / redo / history               Time travel
  snapshot save|list|restore|delete   Manage snapshots
  group create|add|remove             Manage groups
  clear --yes                         Clear canvas
  code-graph                          File dependencies
  spatial                             Spatial analysis

Run any command with --help for details and examples:
  pmx-canvas node add --help
  pmx-canvas edge --help

MCP Integration:
  Add to your agent's MCP config:
  {
    "mcpServers": {
      "canvas": {
        "command": "bunx",
        "args": ["pmx-canvas", "--mcp"]
      }
    }
  }

Examples:
  pmx-canvas                                                  Start server + browser
  pmx-canvas --no-open --demo                                 Headless with sample data
  pmx-canvas node add --type markdown --title "Hello World"   Add a node
  pmx-canvas node list                                        List all nodes
  pmx-canvas search "auth"                                    Find nodes
  pmx-canvas arrange --layout column                          Auto-arrange
  pmx-canvas clear --dry-run                                  Preview destructive op
`);
    process.exit(0);
  }

  const canvas = createCanvas({ port });
  await canvas.start({ open: !noOpen });

  if (demo && canvas.getLayout().nodes.length === 0) {
    const n1 = canvas.addNode({
      type: 'markdown',
      title: 'Welcome to PMX Canvas',
      content: '# PMX Canvas Workbench\n\nA spatial canvas for coding agents.\n\n## Features\n- Infinite 2D canvas with pan/zoom\n- Multiple node types\n- Edges between nodes\n- Real-time SSE updates\n- HTTP API for agent control',
    });

    const n2 = canvas.addNode({
      type: 'markdown',
      title: 'Getting Started',
      content: `# Quick Start\n\n\`\`\`bash\n# Add a node via CLI\npmx-canvas node add --type markdown --title "Hello" --content "# World"\n\n# List nodes\npmx-canvas node list\n\n# Get canvas state\npmx-canvas layout\n\`\`\``,
    });

    const n3 = canvas.addNode({
      type: 'status',
      title: 'Agent Status',
      content: 'Ready',
    });

    canvas.addEdge({ from: n1, to: n2, type: 'flow', label: 'next' });
    canvas.addEdge({ from: n2, to: n3, type: 'flow' });
    canvas.arrange('grid');
  }

  console.log(`\n  PMX Canvas running at http://localhost:${canvas.port}\n`);
  console.log('  Agent CLI:');
  console.log('    pmx-canvas node add --type markdown --title "Hello"');
  console.log('    pmx-canvas node list');
  console.log('    pmx-canvas search "query"');
  console.log('    pmx-canvas --help          (all commands)');
  console.log('\n  Press Ctrl+C to stop\n');

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    canvas.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    canvas.stop();
    process.exit(0);
  });
}
