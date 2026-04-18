---
title: Semantic Watch CLI MVP
status: draft
date: 2026-04-18
---

# Semantic Watch CLI MVP

## Summary

Add a new agent-facing CLI command:

```bash
pmx-canvas watch
```

The command connects to the existing `/api/workbench/events` SSE stream and emits
compact, low-token summaries of **meaningful human intent changes** on the canvas.

This is **not** a raw browser telemetry tap. The watcher consumes authoritative
server events, keeps prior layout state locally, computes semantic diffs locally,
and emits one compact line or one JSON object only when the canvas state makes a
changed intent legible.

## Problem

PMX Canvas promises that spatial arrangement is communication and that pinned
context closes the human-to-agent loop. In practice, only pins cross that
boundary reliably today.

The current gap:

- agents can poll resources like `canvas://pinned-context` and
  `canvas://spatial-context`
- browsers receive rich SSE updates
- there is no CLI primitive that turns those updates into a low-noise,
  low-token stream that an agent or hook can follow

## Goals

- Provide a long-running `watch` command for agents and hooks.
- Reuse the existing `/api/workbench/events` SSE stream.
- Reduce full layout snapshots into compact semantic deltas locally.
- Keep token cost low by suppressing raw gesture noise.
- Expose a machine-readable mode for hooks and automation.

## Non-Goals

- No new browser-only collaboration protocol.
- No raw pointer, drag-frame, or selection telemetry.
- No `select` event in v1.
- No `collapse` event in v1 until collapsed state is synced immediately and
  authoritatively to the server.
- No node content/body text in watch output.
- No attempt to narrate every movement; only semantic movement changes.

## Authoritative Signal Sources

The command must only depend on signals the server can already observe.

### Existing sources

- `GET /api/workbench/events`
  - initial `canvas-layout-update` snapshot on connect
  - subsequent `canvas-layout-update` envelopes on node/edge/layout mutations
  - `context-pins-changed` on pin updates
- `GET /api/canvas/pinned-context`
  - initial current pin set on watcher startup
- local semantic derivation using `buildSpatialContext(...)`

### Explicitly excluded from v1

- client-only `selectedNodeIds`
- locally toggled `collapsed` state that has not yet been persisted

## CLI UX

### Command

```bash
pmx-canvas watch [options]
```

### Output modes

- Default: compact human-readable lines
- `--compact`: explicit compact mode (same as default)
- `--json`: emit one JSON object per semantic event, JSONL-style

`--compact` and `--json` are mutually exclusive.

### Filters

```bash
--events context-pin,move-end,group,connect,remove
```

Supported semantic event kinds in v1:

- `context-pin`
- `move-end`
- `group`
- `connect`
- `remove`

If omitted, all v1 semantic kinds are enabled.

### Control flags

```bash
--max-events 3
```

Stop after emitting N semantic events. This exists mainly to support scripted
usage and unit tests without changing the default streaming behavior.

## Event Model

### 1. `context-pin`

Source:

- direct `context-pins-changed` SSE event

Payload:

- added pinned node IDs/titles
- removed pinned node IDs/titles

Rules:

- emit only when the pin set actually changed
- do not emit on startup bootstrap

Compact example:

```text
context-pin +2 -1: "Bug report", "auth.ts" | removed: "old note"
```

JSON example:

```json
{"type":"context-pin","added":[{"id":"n1","title":"Bug report","nodeType":"markdown"}],"removed":[]}
```

### 2. `connect`

Source:

- added edges in a `canvas-layout-update` diff

Payload:

- added edges with `from`, `to`, edge type, and node titles when available

Rules:

- emit for newly added edges only
- ignore unchanged edges

Compact example:

```text
connect 1: "Bug report" -> "auth.ts" (relation)
```

### 3. `remove`

Source:

- removed nodes and removed edges in a `canvas-layout-update` diff

Payload:

- removed node summaries
- removed edge summaries

Rules:

- emit only for removals after bootstrap
- group all removals from one layout update into one semantic event

Compact example:

```text
remove 2 nodes: "Old note", "scratch.ts"
```

### 4. `group`

Source:

- group node creation or group membership change detected from layout diffs

Payload:

- created groups
- membership changes for existing groups
- child additions/removals by group

Rules:

- treat new `group` nodes as group creation
- compare `group.data.children` arrays for membership deltas
- emit one grouped summary per layout update

Compact examples:

```text
group created: "API Group" (2 children)
group updated: "API Group" +1 -0 children
```

### 5. `move-end`

Source:

- node position changes between two `canvas-layout-update` snapshots

Important:

- derive from **layout diffs**, not pointer events
- emit only when movement caused a semantic change

Semantic triggers:

- the moved node’s proximity-cluster peers changed
- the moved node entered or left a pinned neighborhood
- a pinned node moved and its neighborhood changed

Rules:

- suppress pure coordinate churn
- suppress movement that did not change spatial meaning
- ignore newly created or removed nodes when computing move-end

Compact examples:

```text
move-end: "auth.ts" cluster changed
move-end: "session.ts" entered pinned neighborhood of "Bug report"
```

## Bootstrap Behavior

On startup:

1. fetch current pins from `/api/canvas/pinned-context`
2. connect to `/api/workbench/events`
3. accept the initial `canvas-layout-update` snapshot as the baseline
4. emit nothing during bootstrap

This avoids startup noise and prevents the watcher from replaying the whole
canvas as if it were a fresh user action stream.

## Local Reduction Algorithm

Maintain local watcher state:

- `currentLayout`
- `currentPinnedIds`
- derived `previousSpatialContext`

On each relevant SSE event:

### `context-pins-changed`

- diff old pin set vs new pin set
- emit `context-pin` if changed
- update `currentPinnedIds`
- recompute local spatial context baseline

### `canvas-layout-update`

- if no baseline exists, store it and stop
- diff previous layout vs next layout
- emit `connect`, `remove`, and `group` events from structural diffs
- compute old/new spatial context with the current pin set
- detect moved nodes
- emit `move-end` only for nodes whose movement changed:
  - cluster peers
  - pinned-neighborhood membership
- replace baseline with the new layout/spatial context

## Token Budget Rules

The watcher exists to save tokens, so its output contract must stay strict.

Rules:

- no full layout snapshots in emitted output
- no node body text or file content
- no duplicate emission for unchanged semantic state
- one semantic event object/line per meaning change, not per low-level SSE frame
- compact mode should usually stay under one short line per event

## Implementation Plan

### Files

- add a new CLI watcher module for:
  - SSE parsing
  - semantic reduction
  - compact/JSON formatting
- wire the command into `src/cli/agent.ts`
- add `watch` to `src/cli/index.ts` command help/router
- add unit coverage for:
  - context pin diffs
  - connect/remove diffs
  - group diffs
  - move-end semantic suppression and emission

### Reuse

- reuse `/api/workbench/events`
- reuse `/api/canvas/pinned-context`
- reuse `buildSpatialContext(...)`

## Verification Plan

- unit tests for semantic reducer behavior
- unit tests for CLI watch output/filtering
- `bun run test`

If implementation touches browser-visible UI or client code later, escalate
verification. For this MVP, CLI/server-side verification is expected to be
sufficient.

## Deferred Work

- watchable `collapse` after immediate server sync exists
- explicit `cluster-changed` or `neighborhood-changed` top-level event kinds
- reconnect/backoff behavior for long-lived watches
- MCP-side semantic watcher surface if needed later
