# Product Review — September 2026

**Status:** Proposed
**Date:** 2026-09-03
**Scope:** Product-level review of `pmx-canvas` v0.5.1 at `main` `e17776f6` (working tree clean, so committed state and the Mac's tree are identical).
**Method:** Read the README, docs, skills, changelog, `.learnings/` and the two tech-debt assessments; ran the unit suite (1035 pass / 0 fail), `pmx-canvas smoke` (all four checks ok), and the demo and empty boards in a browser; read the maintainer's own live board over MCP (`canvas_query`, `canvas://summary`, `canvas://pinned-context`, `canvas://ax-context`); probed the approval-gate HTTP API on a scratch server. Four parallel audits fed the findings (onboarding, API surface, client UX, field-report synthesis). This is a *product* review, not a tech-debt audit; `plan-009` already tracks the engineering backlog.

## Verdict

The one-sentence idea is excellent and still true: *spatial curation is a context channel; the human pins what matters and the agent reads it.* The engineering behind it is unusually disciplined for a solo project (registry-derived transports, a frozen tool surface, a real e2e gate, honest changelogs).

The product problem is that this idea is now buried under a second product. Roughly 40 concepts, 73 MCP entry points, 86 CLI commands, and 109 HTTP routes describe two things at once: a spatial context surface for one agent, and a multi-agent orchestration control plane (gates, steering queues, pumps, scope fences, presence, ghost intents). Section 04 of the README introduces a dozen primitives before a first-time reader has created a node. The headline feature of the second product, the human approval gate, does not actually require a human (see finding 2).

Adoption evidence is thin and self-referential. The repo has 18 stars and two forks; every PR is the maintainer's; the one issue ever filed was closed the same week. The board in this repository is a test board by design (the maintainer's correction, 2026-09-05). The real boards live in the snapshot history of the board the globally installed MCP server writes to: nine real PM boards between April and August 2026 (OKRs, DX charts, discovery, an org overview, slide decks), each overwritten by the next test session because a workspace has exactly one board. See the opening section of [`product-vision-2026-09.md`](product-vision-2026-09.md). The "field reports" that drive each release are the maintainer running Amp, Copilot, Codex and Claude against the product. That is good dogfooding, but the boards I can see cannot show whether the product works on a problem that is not `pmx-canvas`. Everything below should be read in that light: the fastest way to find out what the product is, is to use it for two weeks on something else.

## What is genuinely good

- **The core loop works and is cheap.** `--demo` gives a full board in one command; the MCP config is five lines; the canvas auto-starts on first tool call; `smoke` verifies the whole stack in one command and passes.
- **The human chrome is considered, not missing.** Empty state with four working actions, a `?` shortcut overlay (25 shortcuts), a ⌘K palette, in-canvas tooltips that survive embedded panes, and a reconnect banner that tells the human the real consequence of a dropped stream.
- **State lives in the server, and it is honest.** Incremental fsynced saves, a single write path with undo actors, a bundle-stamp self-reload for stale tabs.
- **Quality practice is improving.** The July backlog is mostly closed and dated: the CLI monolith went from 3,337 lines to 231, raw CLI fetches from 60 to 0, hand-written routes from about 50 to 21. Themes that got a machine check (tool-surface freeze, doc byte-identity, daemon lifecycle) stopped recurring.

## Findings, ranked by product impact

### 1. Two products share one README, and the smaller one is the good one

The README's first paragraph is right. It is followed by about 230 lines of feature sections and four host-adapter subsections before Quick start (line 256 of 477). The `pmx-canvas` skill is 5,400 words plus a 14,700-word reference, and it hands an agent a nine-step "Required Operating Sequence" (with three items numbered 7) before it may create a node. Ghost intents are mandatory by default on every mutation.

Concept inventory: about eight things are core (node, edge, group, pin, `canvas.db`, workspace root, one composite tool, `canvas://pinned-context`). About thirty belong to the control plane: work items, approval gates, elicitations, mode requests, policy, host capability, delivery queues, consumer keys, pumps, scope fences, agent and human presence, ghost intents, materialized flows, a five-tier rendering taxonomy (`html`, `html-primitive`, `json-render`, `web-artifact`, `mcp-app`/`ext-app`). 42% of the HTTP surface is `/api/canvas/ax/*`.

The maintainer's stated direction is a two-way working surface for humans and agents, not an orchestrator. Read against that direction the AX layer is integral, and the problem is narrower than "two products": the vocabulary is mechanism-first (gates, queues, pumps, fences, consumer keys) where the direction calls for conversation-first, and the fleet mechanics that headlined 0.5.0 are the part that does not fit. See the Proposal section at the end.

### 2. The approval gate does not require a human (verified live)

README: *"gate high-impact actions behind a human `pending → approved/rejected` decision."* On a scratch server, an agent created a gate over plain HTTP with no workbench marker and then resolved it:

```
POST /api/canvas/ax/approval                       → 200, status "pending"
POST /api/canvas/ax/approval/:id/resolve
     {"decision":"approved","agentId":"probe-agent"} → 200, status "approved", source "api"
```

`ax.approval.resolve` (`src/server/operations/ops/ax-work.ts:490`) checks the decision enum and nothing about the caller. The scope fence and the human grab lock both already key on the workbench marker, so the pattern exists; the gate simply does not use it. The `source: "api"` stamp makes self-approval auditable after the fact, not prevented. Until resolve is human-only, the gate is a status field, and the `held` policy sweeper is the only real safety property. *Correction (2026-09-05):* keying human-only resolution on the workbench marker alone is not enough, because the marker is a plain request header any agent with `curl` can set (`src/server/operations/http.ts:91`, no auth anywhere in `server.ts`). The real fix mints a per-boot secret served only in the workbench HTML; see [`product-vision-2026-09.md`](product-vision-2026-09.md), move 7.

### 3. A human's failed write is silent

`requestJson` in `src/client/state/intent-bridge.ts:38` never reads `res.ok`; a 400 or 500 body is parsed and returned as if it succeeded, and the fallback path goes to `console.error`. *Correction (2026-09-05, from the adversarial pass on the vision):* a human's own write cannot hit the 403 scope fence or the 409 edit lock, both sit behind `if (!meta.fromWorkbench)` in the registry; the defect is real for validation errors and server failures, but smaller than first stated. The most visible case is `ContextMenu.tsx:370`, where finished user-facing copy ("Could not create webpage node. Enter a valid http(s) URL.") is sent to the console. `showToast` exists and is used by two files. The board is built to show the human what agents are doing, and it does not show the human when their own click failed.

### 4. The agent's "working memory" has no compaction

The thesis is that the canvas is the agent's extended memory. Measured on the maintainer's own 25-node board:

| Read surface | Size | What dominates it |
|---|---|---|
| `canvas://ax-context` (injected per Copilot prompt) | 26.5 KB, roughly 7k tokens | 20 work items, 19 of them `done`; 20 timeline events, 8 of them system "re-anchored" notes; 10 "pendingSteering" entries of which 8 are `delivered: true`; a `host` block from a June smoke run. The `pinned` block, the product's headline, is empty. |
| `GET /api/canvas/state` (what `canvas_query layout` wraps) | 67 KB (25 nodes), 386 KB (69-node demo) | Full markdown bodies; `full` is ignored on the HTTP route; the MCP "compact" form strips `data` but never truncates `content`. |
| `pmx-canvas layout` (CLI) | 449 KB on the demo board | Same, plus blobs. |

There is no content preview length, no "open items only", no event budget, and no way for an agent to ask for the board at a token budget. `canvas://summary` (272 bytes) is the only bounded read, and it carries titles only for pinned nodes. For a product about context, this is the gap that matters most after finding 2.

### 5. The MCP schemas are hard for a model to use reliably

- `canvas_node` exposes 50+ flattened optional fields for four actions; per-action requirements exist only in prose, so `{action:"add"}` without `type` passes schema validation and fails in the handler (the July M6 finding, still open).
- 18 alias fields survive in the ops schemas (`verbose`/`full`, `q`/`query`, `kind`/`primitive`, `children`/`childIds`, `path`/`content`, `edge_id`/`id`, `heightPx`/`nodeHeight`, snapshot `id`/`name`). The project's own CLAUDE.md rule is "no deprecation aliases".
- Two descriptions are wrong in the live schema: `canvas_edge` tells the model its actions are `add | remove` while `update` shipped in 0.5.0 (`composites.ts:174`); `canvas_view` `fit` describes `padding` as "World-space" while the 0.5.1 changelog says screen pixels (`ops/viewport.ts:149`). The second one is architecture rule 9 leaking into the contract.
- 14 registry ops are reachable over HTTP, CLI and SDK but not MCP, with no error explaining the gap: `history.get`, `annotation.add`, `theme.get/set`, `summary.get`, `spatial.get`, `viewport.set`, `ax.review.update`, `ax.approval.reopen`, `human.presence.*` among them. `canvas_view` can remove an annotation but not add one.
- Four naming conventions for one operation (`set-focus` / `ax focus` / `/ax/focus` / `setAxFocus`) and four spellings for one feature (`canvas_pin_nodes`, `pin.set`, `/context-pins`, `canvas://pinned-context`). Nothing lets an agent translate between transports mechanically.

### 6. The docs disagree with each other and with the product

Concrete, all verified:

- `SKILL.md:120` tells the agent to call `canvas_render { action: "workboard" }`; the composite table on the same page (`:142`) and `full-reference.md:438` omit `workboard`; `docs/mcp.md:41` has it.
- `full-reference.md:346-360` lists 14 node types and is missing `diff`, `mermaid`, `webpage`, `web-artifact` and `html-primitive` while listing internal `prompt`/`response`.
- `SKILL.md:90` and `docs/environment.md:11` state opposite things about whether `PMX_CANVAS_PORT` drives the server.
- `installing-pmx-canvas.md`, the file loaded when the command is missing, says `npm install -g` and never mentions Bun, which is the reason the command is missing.
- `full-reference.md:35` cites a README use-case list that no longer exists.
- The shortcut overlay still says "Context menu — dock, focus, connect" (`ShortcutOverlay.tsx:55`); docking was removed in 0.5.0.
- CLAUDE.md rule 5 (and its byte-identical twin AGENTS.md, which Codex, Copilot and Amp read) still mandates keeping four hand-written layers in sync; three of them are registry-derived now, so an agent following it writes a parallel implementation.
- `docs/screenshots/welcome-dark.png` exists and is referenced nowhere; the README leads with a dense expert board instead of the first screen a user sees.
- No troubleshooting page, no uninstall or cleanup, no stated local security model (the server binds localhost with no auth; `file` nodes read any path the server user can read; nothing says so).

### 7. Scale has no defined behaviour

`CanvasViewport.tsx:912` renders every node with no viewport culling and no node-count guard. Seven node types mount iframes; the showcase board loads **40 iframes** on first paint (25 `surface/*` documents plus 15 json-render views, from the network log). It works at 69 nodes on a fast Mac. At 200 nodes with a few dozen live iframes the product has not been measured, and the embedded hosts (Copilot panel, Codex browser, Amp portal) are the slowest surfaces it runs in.

### 8. The same three bugs keep shipping, and the fix has been a paragraph

From the changelog and `.learnings/`:

| Theme | Times shipped | What fixed it |
|---|---|---|
| Embedded-host blank or black tile | about 9 (0.2.4 through Unreleased) | Escalating paint oracles; the architectural fix (portal-layer mount) is still a plan-009 contingency whose trigger has been met |
| Screen-space vs world-space viewport math | 4 (0.4.6, 0.4.7, 0.5.1, Unreleased) | CLAUDE.md rule 9, which still says "twice" |
| Native browser UI no-ops in embedded panes | 3 in 0.5.0 alone | CLAUDE.md note; `ToolRail.tsx` still calls `window.prompt` |

Themes that got a test stopped. Rules 3, 7 and 9 have each grown a paragraph per recurrence. CLAUDE.md and AGENTS.md, kept identical on purpose so every agent reads the same rules, are becoming the incident log.

### 9. Packaging and footprint

- 539 files, 14.7 MB unpacked; ships `src/` and `dist/` both; 227 `dist/` files are tracked in git (160 in July).
- Runtime dependencies carry React 19, `react-dom`, `recharts` and seven `@json-render/*` packages beside Preact; mermaid alone is a 3.5 MB bundle. `node_modules` is 456 MB.
- `bin` is a raw `.ts`, so `npm install -g` produces a command that fails without Bun (see finding 6).
- On this machine one Copilot host is holding ten `pmx-canvas --mcp` processes spawned ten seconds apart (about 170 MB). The server exits on stdin end, so the duplication is the host's, but the product cannot tell the human that ten copies of it are running.

### 10. The multi-host story is only as strong as its weakest host

Four hosts, each with bespoke behaviour (srcdoc iframes, polling transport, visibility-blind paint recovery, extension pump vs CLI pump vs native heartbeat). Codex desktop steering did not work end to end until an app-native adapter shipped; the pump documentation had described a command that started a different session. None of this is visible to CI, so every release re-discovers it through field reports.

## What I would do, in order

1. **Reorganize the product around the two-way surface.** Keep AX; fold its mechanisms into the moves in the Proposal section; move fleet mechanics (pump, consumer keys, fences, rollups, census chips) to a separate page and off the default path. The README leads with the welcome screenshot, one scenario that shows both directions, Quick start, then `smoke`. Host adapters move to one linked page. The skill's operating sequence shrinks to what a first session needs; ghost intents become opt-in.
2. **Make the gate real.** `ax.approval.resolve` requires the workbench marker (or a human-only token); agent calls get 403 exactly like the scope fence. One afternoon, and the README sentence becomes true.
3. **Surface failures to the human.** `requestJson` checks `res.ok`, and every helper routes `errorMessage` to `showToast`. One afternoon.
4. **Budget the reads.** `canvas://ax-context` carries open items, the last N events, undelivered steers only, and a content preview; `layout` takes a preview length; `canvas://summary` carries titles for every node. Then the memory thesis has a compaction story. About a day.
5. **Schema hygiene.** Delete the 18 aliases (the repo's own rule), fix the two wrong descriptions, make per-action required fields explicit in the schema, and either expose the 14 missing ops over MCP or say why not. Add the registry-derived checks that catch the next drift.
6. **Reconcile the docs.** Fix the six contradictions above in one pass; delete rule 5 from CLAUDE.md and AGENTS.md; add a troubleshooting page and a three-line security model.
7. **Turn the three recurring paragraphs into checks.** A Biome rule or unit test that fails on `window.prompt`/`alert`/`confirm`/`title=` in `src/client`; a unit test that pins screen-space margins for `focus`/`fit` at scale 0.5 and 2; an assertion that `onMutation` is registered once.
8. **Use it on something that is not `pmx-canvas` for two weeks**, with one agent, and log what breaks. That will settle finding 1 better than any review.

## Evidence

| Claim | Where |
|---|---|
| Unit suite green | `bun run test:unit`: 1035 pass, 0 fail, 88 files, 67 s |
| Smoke green | `PMX_CANVAS_PORT=4779 pmx-canvas smoke`: health, mcp-initialize, node-lifecycle, validate all ok |
| Gate self-approval | scratch server on 4779, `POST .../approval` then `POST .../approval/:id/resolve` with `{"decision":"approved"}` and no workbench header: 200, `status: "approved"` |
| Silent failures | `src/client/state/intent-bridge.ts:38-63`, `src/client/canvas/ContextMenu.tsx:370` |
| Read sizes | `curl` of `/api/canvas/ax/context` (26,536 B) and `/api/canvas/state` (67,097 B on the live board, 386,533 B on the demo, identical with `?full=true`); `pmx-canvas layout` 449,053 B |
| Aliases | `grep -c "alias" src/server/operations/ops/*.ts` = 18 |
| Wrong descriptions | `src/server/operations/composites.ts:174`, `src/server/operations/ops/viewport.ts:149` |
| Ops missing from MCP | `history.get`, `annotation.add`, `theme.set`, `summary.get`, `spatial.get` absent from `composites.ts` |
| 40 iframes on demo load | browser network log on `http://localhost:4779` (25 `surface/*` + 15 `json-render/view`) |
| No culling | no visibility filtering in `src/client/canvas/CanvasViewport.tsx` |
| Stale dock string | `src/client/canvas/ShortcutOverlay.tsx:55` |
| Packaging | `bun pm pack --dry-run`: 539 files, 14.73 MB; `git ls-files dist | wc -l` = 227 |
| MCP process pile-up | `ps` on this Mac: ten `pmx-canvas --mcp` children of one Copilot CLI pid |
| Adoption | `gh repo view`: 18 stars, 2 forks, created 2026-03-25; 1 issue ever; 14 npm releases between 2026-08-03 and 2026-08-28; npm reports 2,331 downloads in the last month and 382 in the last week, a large share of which is plausibly the release smoke (`bunx` cold boots), CI, and the maintainer's own hosts |

## Proposal: the board as a two-way surface

*Superseded on 2026-09-05 by [`product-vision-2026-09.md`](product-vision-2026-09.md), which keeps the two-way framing but starts from the finding that the pin-to-agent loop has never been observed and folds the AX side tables into cards on the board.*

*Added 2026-09-03 after discussion with the maintainer. Direction as stated: the canvas is a two-way working surface for humans and agents, not an orchestrator. This section replaces the "two products" recommendation in finding 1.*

### The model: every mark is addressed to the other side

| Direction | Move | What exists today | What changes |
|---|---|---|---|
| Human → agent | **Pin** (focus here) | context pins, `canvas://pinned-context`, AX focus | AX focus folds into pin; an agent-proposed focus is a pin with `source: agent`. One read surface. |
| Human → agent | **Steer** (do this) | composer, steering messages, delivery claim/mark, pump, consumer keys | Steering stays. "Delivery", "claim", "consumer key" leave the user-facing vocabulary; the agent has an inbox. |
| Human → agent | **Answer** (yes/no, choice, text, mode) | approval gates, elicitations, mode requests, three resolvers | One `ask` with an answer type. Answers are human-only (finding 2). One TTL and one `held` policy. |
| Human → agent | **Hold** (hands off) | grab lock, undo of agent edits, ghost veto, scope fence | Grab and undo are the human's hold. Scope fence moves to the fleet page. |
| Human → agent | **Mark** (look at this) | freehand annotations, review annotations | One annotation with an optional node anchor. |
| Agent → human | **Show** (put it on the board) | node, render, app, edge, group | Unchanged now; render and app fold into node types over time. |
| Agent → human | **Ask** | approval gate, elicitation, mode request | One primitive, one panel row. |
| Agent → human | **Report** (what I did, what is open) | work items, agent events, evidence, session receipts | One timeline; work items are its open loops; presence phase derives from it. |
| Agent → human | **Signal** (where I am, where I am about to write) | presence cursor, ghost intent, focus, park-at | One signal with an optional "about to write" horizon. Intents opt-in, never mandatory. |

Nine moves. Multi-agent is "more than one agent making the same moves"; identity color is the only extra concept the human needs.

### What changes concretely

1. **Trust first, as a prerequisite.** A two-way surface that lies in either direction is worse than chat. Asks are answered only by humans; a failed human action is visible; the agent's read of the board is a budgeted `canvas://context` that carries pins, open asks, open work and the last N events, never done items or delivered steers.
2. **The agent surface.** The nine AX-shaped tools (`canvas_ax_state`, `canvas_ax_work`, `canvas_ax_gate`, `canvas_ax_timeline`, `canvas_ax_delivery`, `canvas_ax_interaction`, `canvas_ingest_activity`, `canvas_invoke_command`, `canvas_intent`) become four: `canvas_ask`, `canvas_report`, `canvas_signal`, `canvas_inbox`. Board tools stay. Ship it as 0.6.0 with the 0.3.0 discipline: freeze test, per-tool migration map, no aliases.
3. **The human chrome.** The session panel is regrouped as the conversation: *Waiting on you* (asks), *Happening* (report and signal), *You said* (pins, steers, holds). The composer is steer. This is naming and grouping, not new UI.
4. **The docs.** README: thesis, one scenario that shows both directions, Quick start, `smoke`. One "Conversation" page replaces section 04. One "Fleet" page holds pump, consumer keys, fences, rollups and census chips, marked advanced.
5. **Demoted, not deleted.** `pmx-canvas pump`, consumer keys, `parentAgentId` rollups, scope fence, census chips, ghost-intent-by-default keep working and leave the default path.

### Sequence

1. Trust fixes (gate, toasts, budgeted context): days.
2. 0.6.0 vocabulary consolidation and docs restructure: one to two weeks, one release.
3. Two weeks of use on a project that is not `pmx-canvas`, one agent first, then two.
