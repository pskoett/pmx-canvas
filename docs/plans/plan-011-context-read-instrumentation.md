# Plan 011 — Context read instrumentation

**Status:** Done (2026-09-26)
**Date:** 2026-09-26
**Source:** [Product vision, Part 1 item 4](../product-vision-2026-09.md#part-1-the-foundation), the *delivery* half. Part of 0.7.
**Done when:** agent reads are being recorded — for each read, which surface was read, by whom, and which pinned nodes were in what came back — and the record can be read per consumer.

## Question it answers

"Does the brief reach the agent?" per host. A miss here is plumbing (skill, adapter, MCP client), not
evidence against the thesis. The *effect* half (does curation change the work) is a separate eval.

## What is recorded

One row per context read in a new `context_reads` table (diagnostics, like the AX timeline: never
snapshotted, never cleared by `canvas_view clear`, bounded to the newest 5,000 rows, and recording never
emits a change notification — a read must not cause more reads).

| Field | Meaning |
|---|---|
| `at` | When |
| `channel` | `operation` (HTTP/CLI/MCP tool through the registry), `mcp-resource`, `mcp-prompt`, `adapter` |
| `resource` | Operation name (`ax.context.get`) or URI (`canvas://pinned-context`) |
| `source`, `consumer`, `agentId` | Who: transport label, MCP `clientInfo.name` or `?consumer=`, agent id when given |
| `pinnedNodeIds` | Pins at read time |
| `deliveredNodeIds` | Pinned nodes whose serialized node is in what the reader received |
| `bytes` | Size of what the reader received |

"Delivered" means a serialized node carrying that id (`"id": "<id>"`) is in the payload — a bare id list,
a title, or a node clipped off by an adapter's size budget does not count. `canvas://summary` carries only
pinned titles, so it delivers no pins, which is the honest answer for that surface.

## Where it is recorded

- **Registry reads** (`pinned-context.get`, `ax.context.get`, `ax.get`, `summary.get`, `spatial.get`,
  `layout.get`) in `executeOperation`, which covers HTTP, the CLI and MCP tools. The workbench's own reads
  are skipped.
- **MCP resources and the `pmx-current-context` prompt** in `src/mcp/server.ts`, with the client's
  `clientInfo.name` as consumer. When the MCP server is attached to a daemon, its internal fetches send
  `x-pmx-proxied-read: 1` (not recorded) and it posts one record for the read the agent actually made.
- **The Copilot extension** does the same for its per-prompt injection, computing delivery from the text
  it injects *after* its 16k truncation — the one place that knows what the agent actually got.

## Surfaces

- `GET /api/canvas/ax/context-reads?limit=` → `{ reads, summary }`, summary per consumer: reads, reads with
  pins, reads that delivered every pin, last read, resources used.
- `POST /api/canvas/ax/context-reads` — records a read for proxies and adapters (presence-exempt).
- MCP: `canvas_ax_timeline { action: "reads" }`. SDK: `getContextReads()`. CLI: `pmx-canvas ax reads`.

## Not in scope

The effect eval under `docs/evals/`, hosts without an adapter in this repo (Claude Code hooks, Codex), and
reading the measurement against the decision rule (0.8).
