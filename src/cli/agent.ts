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

import {
  COMMANDS,
  RESOURCE_COMMAND_ALIASES,
  RESOURCE_SUBCOMMAND_HINTS,
  die,
  extractGlobalTargetFlags,
} from './shared.js';
// Importing a command module registers its commands into COMMANDS (side effect).
// Command implementations live in src/cli/commands/, shared helpers in shared.ts.
import './commands/nodes.js';
import './commands/edges.js';
import './commands/groups.js';
import './commands/view.js';
import './commands/query.js';
import './commands/pins.js';
import './commands/history.js';
import './commands/ax.js';
import './commands/pump.js';
import './commands/webview.js';
import './commands/apps.js';
import './commands/copilot.js';
import './commands/skills.js';
import './commands/smoke.js';

// Re-exported for existing importers (tests import it from this module).
export { extractGlobalTargetFlags };

function showTopLevelHelp(): void {
  console.log(`
  pmx-canvas — Agent-native CLI for spatial canvas workbench

Usage:
  pmx-canvas <command> [options]
  pmx-canvas [server-options]

Server:
  pmx-canvas                          Start server + open browser
  pmx-canvas --no-open --demo         Start server headless with sample data
  pmx-canvas --no-open --webview-automation  Start server + headless Bun.WebView automation
  pmx-canvas --mcp                    Run as MCP server (stdio)

Node commands:
  pmx-canvas node add [options]       Add a node
  pmx-canvas node list [--type TYPE]  List all nodes
  pmx-canvas node get <id>            Get a node by ID
  pmx-canvas node update <id> [opts]  Update a node
  pmx-canvas node remove <id>         Remove a node
  pmx-canvas json-render              Show json-render schema/examples
  pmx-canvas graph add [options]      Add a graph node
  pmx-canvas html primitive add        Add an HTML communication primitive
  pmx-canvas html primitive schema     List HTML primitive kinds and shapes
  pmx-canvas diagram add               Add an Excalidraw diagram node

Edge commands:
  pmx-canvas edge add [options]       Add an edge between nodes
  pmx-canvas edge list                List all edges
  pmx-canvas edge remove <id>         Remove an edge

Canvas commands:
  pmx-canvas layout                   Full canvas state (JSON)
  pmx-canvas status                   Quick summary
  pmx-canvas search <query>           Search nodes by content
  pmx-canvas open                     Open the current workbench in a browser
  pmx-canvas arrange [--layout MODE]  Auto-arrange (grid|column|flow)
  pmx-canvas batch [--file FILE]      Run many canvas operations at once
  pmx-canvas validate                 Check collisions and containment issues
  pmx-canvas smoke                    One-command environment check of a running canvas
  pmx-canvas validate spec            Validate json-render/graph payloads without creating nodes
  pmx-canvas watch [options]          Watch semantic canvas changes over SSE
  pmx-canvas focus <id>               Pan viewport to node
  pmx-canvas fit [id ...]             Fit viewport to canvas or selected nodes
  pmx-canvas screenshot               Save automation screenshot to disk
  pmx-canvas external-app add          Add hosted external apps like Excalidraw
  pmx-canvas webview status           Show WebView automation status
  pmx-canvas webview start [options]  Start or replace automation session
  pmx-canvas webview evaluate         Evaluate JS in automation session
  pmx-canvas webview resize           Resize automation viewport
  pmx-canvas webview screenshot       Save automation screenshot to disk
  pmx-canvas webview stop             Stop automation session
  pmx-canvas web-artifact build       Build bundled web artifact HTML
  pmx-canvas clear --yes              Clear all nodes and edges
  pmx-canvas node schema              Describe running-server node schemas

Context pins:
  pmx-canvas pin <id1> <id2> ...      Set pinned nodes (same as --set)
  pmx-canvas pin --list               List pinned context
  pmx-canvas pin --clear              Clear all pins

History:
  pmx-canvas undo                     Undo last mutation
  pmx-canvas redo                     Redo last undone
  pmx-canvas history                  Show mutation timeline

Snapshots:
  pmx-canvas snapshot save --name X   Save a named snapshot
  pmx-canvas snapshot list            List snapshots
  pmx-canvas snapshot gc --keep 20    Delete old snapshots
  pmx-canvas snapshot restore <id>    Restore from snapshot
  pmx-canvas snapshot diff <id>       Compare current canvas to snapshot
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
  --port <n>                          Target daemon port for this invocation (overrides PMX_CANVAS_PORT)
  --server-url <url>                  Target server URL for this invocation (overrides PMX_CANVAS_URL; wins over --port)

Environment:
  PMX_CANVAS_URL    Server URL (default: http://localhost:4313)
  PMX_CANVAS_PORT   Client target port when PMX_CANVAS_URL is unset (default: 4313)

Examples:
  pmx-canvas node add --type markdown --title "API Design" --content "# REST API"
  pmx-canvas node add --type webpage --url "https://example.com/docs"
  pmx-canvas node add --type json-render --title "Dashboard" --spec-file ./dashboard.json
  pmx-canvas json-render --schema --summary
  pmx-canvas json-render --example --component Table
  pmx-canvas node add --type web-artifact --title "Dashboard" --app-file ./App.tsx
  pmx-canvas node add --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value
  pmx-canvas graph add --graph-type bar --data-file ./metrics.json --x-key label --y-key value
  pmx-canvas html primitive add --kind choice-grid --data-file ./options.json --title "Options"
  pmx-canvas html primitive schema --summary
  pmx-canvas diagram add --title "Architecture"
  pmx-canvas node add --help --type webpage
  pmx-canvas node schema --type json-render
  pmx-canvas node schema --type json-render --component Table --summary
  pmx-canvas node list --type file --ids
  pmx-canvas node get node-abc123 --summary
  pmx-canvas node get node-abc123 --field title --field graphConfig
  pmx-canvas edge add --from node-abc --to node-def --type depends-on
  pmx-canvas edge add --from-search "DVT O3 — GitOps" --to-search "deep work trend" --type relation
  pmx-canvas search "authentication"
  pmx-canvas open
  pmx-canvas fit --width 1440 --height 900
  pmx-canvas layout --summary
  pmx-canvas arrange --layout column
  pmx-canvas batch --file ./canvas-ops.json
  pmx-canvas validate
  pmx-canvas validate spec --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value
  pmx-canvas validate spec --type json-render --spec-file ./dashboard.json --summary
  pmx-canvas history --summary
  pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx
  pmx-canvas external-app add --kind excalidraw --title "Diagram"
  pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx --include-logs
  pmx-canvas webview evaluate --script "const title = document.title; return title"
  pmx-canvas snapshot save --name "pre-refactor"
  pmx-canvas clear --dry-run
  cat design.md | pmx-canvas node add --type markdown --title "Design" --stdin
`);
}

// ── Router ───────────────────────────────────────────────────

export async function runAgentCli(rawArgs: string[]): Promise<void> {
  const args = extractGlobalTargetFlags(rawArgs);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showTopLevelHelp();
    return;
  }

  const threeWord = `${args[0]} ${args[1] ?? ''} ${args[2] ?? ''}`.trim();
  if (COMMANDS[threeWord]) {
    await COMMANDS[threeWord].run(args.slice(3));
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
    if (args[1] === '--help' || args[1] === '-h') {
      console.log(`\nAvailable "${oneWord}" commands:\n`);
      for (const k of resourceCommands) {
        console.log(`  pmx-canvas ${k.padEnd(20)} ${COMMANDS[k].help}`);
      }
      console.log('\nRun any command with --help for details.\n');
      return;
    }
    const subcommand = args[1];
    const suggestion = subcommand ? RESOURCE_COMMAND_ALIASES[oneWord]?.[subcommand] : undefined;
    const extraHint = subcommand ? RESOURCE_SUBCOMMAND_HINTS[oneWord]?.[subcommand] : undefined;
    const available = resourceCommands
      .map((k) => k.slice(oneWord.length + 1))
      .sort()
      .join(', ');
    const hints = [
      suggestion ? `Did you mean: pmx-canvas ${oneWord} ${suggestion}?` : undefined,
      extraHint,
      `Available subcommands: ${available}`,
    ].filter((hint): hint is string => typeof hint === 'string');
    die(
      subcommand ? `Unknown ${oneWord} subcommand: "${subcommand}".` : `Missing ${oneWord} subcommand.`,
      hints.join(' '),
    );
  }

  die(`Unknown command: ${oneWord}`, 'Run: pmx-canvas --help');
}
