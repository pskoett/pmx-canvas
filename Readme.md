# pmx-canvas

**A moldable canvas for agent-assisted thinking.** An infinite 2D surface
where files, plans, status, charts, fetched web pages, annotations, and
hand-drawn diagrams live side by side. Every node carries its own renderer; agents
(and you) build new views in the middle of a session, not as a separate
tooling project. Pin what matters and the agent reads your spatial
curation as structured context.

<p align="center">
  <img src="docs/screenshots/welcome-dark.png" alt="Empty canvas — dark theme" width="49%" />
  <img src="docs/screenshots/welcome-light.png" alt="Empty canvas — light theme" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/demo-workbench-dark.png" alt="Structured workbench demo — dark theme" width="49%" />
  <img src="docs/screenshots/demo-workbench-light.png" alt="Structured workbench demo — light theme" width="49%" />
</p>

PMX Canvas is a collaborative spatial workspace that humans and agents share
in real time. Either side adds material; the human curates spatial structure
(grouping, positioning, pinning); the agent reads that curation through
`canvas://pinned-context` and acts on it. Spatial arrangement is
communication — proximity means relatedness, pinning means *focus here*.

## Main features

### 01 / Curate

Drag, group, arrange, and **pin** nodes spatially. Curation is the channel
from human intent to agent context — the agent reads `canvas://pinned-context`
and `canvas://spatial-context` (proximity clusters, reading order, pinned
neighborhoods) and uses your layout to ground its next action.

### 02 / Mix any data source

Files, web pages, screenshots, structured panels, charts, hand-drawn
diagrams, embedded MCP Apps, and bundled web artifacts all live on the same
surface. The reach of the canvas is the union of its
[built-in node types](docs/node-types.md) and **whatever your agent's harness
already has access to** — MCP servers, CLIs, file reads, web fetch, anything
on its toolbelt.

### 03 / Annotate

Draw freehand marks directly on the canvas to circle, underline, connect, or
call out what matters without turning the markup into another node. Annotations
persist with state and snapshots, can be erased in the browser, and appear to
agents as compact spatial context: target, bounds, and nearby canvas content.

### 04 / Control your context

Pinning is an explicit, low-noise control over what the agent sees next. No
prompt engineering, no copy-paste — pin a node in the browser and the MCP
server fires a `notifications/resources/updated` event the agent's harness
picks up immediately.

### 05 / Save

Spatial state auto-saves to `.pmx-canvas/state.json` (debounced ~500 ms) —
git-committable, shareable across machines, and survives both browser
refresh and server restart. Named [snapshots](docs/mcp.md#tools), full
undo/redo, and an auto-detected code graph (JS/TS, Python, Go, Rust) make
the canvas durable rather than throwaway.

### 06 / Any agent

Harness-agnostic. Drive the canvas from [MCP](docs/mcp.md) (41 tools,
8 resources, change notifications), the [CLI](docs/cli.md), the
[HTTP API](docs/http-api.md), or the [Bun SDK](docs/sdk.md). Works with
Claude Code, GitHub Copilot CLI, Codex, Cursor, Windsurf, or any agent
that can spawn an MCP stdio server, call a CLI, or hit an HTTP endpoint.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.12

The published SDK entrypoint is Bun-first. Node.js consumers should use the
CLI, MCP server, or HTTP API.

## Install

```bash
bunx pmx-canvas              # Run without installing (recommended for one-off use)
bun add -g pmx-canvas        # Install globally — exposes the `pmx-canvas` command
bun add pmx-canvas           # Install into a project (needed for the Bun SDK)
```

To work on the canvas itself, clone the repo — see [Development](#development).

## Quick start

### Run the canvas

```bash
bunx pmx-canvas              # Start canvas, open browser
bunx pmx-canvas --demo       # Start with the project-tour demo board
bunx pmx-canvas --no-open    # Headless (good for daemons / CI)
bunx pmx-canvas --mcp        # Run as MCP server (stdio)
bunx pmx-canvas --help       # All commands
```

The canvas opens at `http://localhost:4313`. Try `--demo` first — it seeds a
project tour with grouped markdown, status, file, image, webpage,
json-render, graph, html, Excalidraw diagram, and MCP App nodes connected by
labeled edges.

### Connect your agent (MCP)

Add to your agent's MCP config:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "bunx",
      "args": ["pmx-canvas", "--mcp"]
    }
  }
}
```

The canvas auto-starts on first tool call.

### Install the agent skill (recommended)

The fastest way to get a working canvas is to install the `pmx-canvas` agent
skill. It teaches the agent how to install the package, start the server, and
drive every node type, group, snapshot, and search the canvas exposes.

```bash
# 1. GitHub CLI extension (gh >= 2.90)
gh skill install pskoett/pmx-canvas pmx-canvas

# 2. Agent Skills CLI (runtime-agnostic)
npx skills add pskoett/pmx-canvas/skills/pmx-canvas

# 3. Manual clone + copy
git clone https://github.com/pskoett/pmx-canvas.git
cp -r pmx-canvas/skills/pmx-canvas <your-agent-skills-dir>
```

Common harness skill directories: `.claude/skills/` (Claude Code),
`.github/skills/` or `.copilot/skills/` (Copilot CLI),
`.agents/skills/` (cross-harness convention). Once the canvas is running,
the agent can read `canvas://skills` and pull in companion skills
(`web-artifacts-builder`, `json-render-*`, `pmx-canvas-testing`,
`playwright-cli`, etc.) as the work demands.

## Documentation

- **[Node types](docs/node-types.md)** — every node type, edge types, and
  the three-tier visual matrix (json-render → html → web-artifact)
- **[CLI reference](docs/cli.md)** — full command surface, daemon mode,
  watch streams, WebView automation
- **[MCP reference](docs/mcp.md)** — 41 tools, 8 resources, change
  notifications, node-type routing
- **[HTTP API](docs/http-api.md)** — REST endpoints, SSE, batch operations
- **[Bun SDK](docs/sdk.md)** — `createCanvas()` for TypeScript on Bun
- **[Release process](docs/RELEASE.md)** — maintainer-only

## Scope

- **Single-machine, today.** One canvas per `bunx pmx-canvas` instance, on
  one machine. No built-in multi-user auth or presence — collaboration means
  human ↔ agent on the same machine, plus any other browser tab/agent
  pointed at the same `localhost:4313`. To share across machines, commit
  `.pmx-canvas/state.json`.
- **What leaves your machine.** The core canvas runs entirely on
  `localhost`. Network egress only happens for explicit, opt-in flows:
  `webpage` nodes fetch the URL you give them; `mcp-app` /
  `canvas_add_diagram` calls go to whatever MCP server URL you configure
  (the Excalidraw preset uses `https://mcp.excalidraw.com/mcp`); `bunx`
  itself reads the npm registry on first install. Nothing else phones home.

## Tech stack

- **Runtime:** [Bun](https://bun.sh)
- **UI:** [Preact](https://preactjs.com) + [@preact/signals](https://github.com/preactjs/signals)
- **Styling:** CSS custom properties + Tailwind (json-render bundle only)
- **Server:** Bun.serve (HTTP + SSE)
- **MCP:** [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) (stdio)

## Development

```bash
git clone https://github.com/pskoett/pmx-canvas.git
cd pmx-canvas
bun install
bun run build
bun run dev            # Start + open browser
bun run dev:demo       # Start with the demo board
bun run test           # Unit tests
bun run test:e2e       # Playwright end-to-end tests
bun run test:all       # Unit tests + browser smoke
```

For developer flows on the `pmx-canvas` repo itself (release process,
contribution gates, agent-skill mirroring) see
[`AGENTS.md`](AGENTS.md) and [`docs/RELEASE.md`](docs/RELEASE.md).

## Contributing

Contributions welcome. Please open an issue first to discuss what you'd like
to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Run `bun run test:all` before submitting
4. Open a pull request

## License

[MIT](LICENSE)
