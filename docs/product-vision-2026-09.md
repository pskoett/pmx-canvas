# Product Vision — September 2026

**Status:** Direction accepted. Decisions are recorded where they were made (2026-09-06, 2026-09-23, 2026-09-24); a move not marked decided is still a proposal.
**Date:** 2026-09-05, revised 2026-09-23 and 2026-09-24
**Scope:** Where `pmx-canvas` should go, what must be fixed now, what to add, what to delete, and what is architecturally wrong. Written against `main` `e17776f6` (clean tree); revised against `561e6ec5` (v0.6.3).
**Revision, 2026-09-23:** Folds in [`product-vision-review-2026-09.md`](product-vision-review-2026-09.md) and the maintainer's decisions on it: the destination is "share this board", boards are the wiki, and four moves are added (static export, tours, recipe cards, new board from this board). The review keeps the reasoning and the full design sketch; this document is the plan.
**Revision, 2026-09-24:** A second re-review. Decided with the maintainer: gate answers are human-only and the requesting agent may withdraw (move 7), and the reference surface is Chromium at 600 px for now (move 5). Also fixes the fetcher rule, the stage-1 active board, export leakage, workspace-level map pins, what the one read keeps, and the status of session projection.
**Method:** My own position, drafted first, then stress-tested by a 54-agent panel: four fact-finders, six independent visions from different angles (context engineering, systems, product strategy, rendering, developer experience, minimalism), a merge into 14 moves, three adversarial refuters per move (evidence, feasibility, value), and a completeness critic. Where the panel refuted me, this document says so. Companion: [`product-review-2026-09.md`](product-review-2026-09.md) (the audit).

## The one-line vision

**The board is the human's extended memory and the agent's working memory—a shared surface for doing work and building understanding.** The human uses it to research, analyze, monitor dashboards, explore ideas, and start, plan, and orchestrate coding or other work. People and agents bring sources, questions, relationships, plans, and results onto the board. **Boards are the wiki:** every session lands on a named board, boards link to each other and nest into levels, and the board map shows the whole library as one more board. Relevant boards return to the agent's brief to support the next task. The human is a worker and thinker here, not merely a curator of agent context.

> **Think with your agents on boards that are still there next week.** Every session lands on a named board, the boards link into a wiki you can see as a map, the agent reads what you curated, and you can share or present a board with anyone.

Human attention helps select the agent's context; it does not define the whole product. Explicit steering directs agents; annotations, pins, connections, and grouping inform relevance, while spatial layout and human camera attention can contribute weaker cues. The server compiles one budgeted brief for every agent turn. Everything the agent has to say to the human is a card on the board, never a row in a side table. The board owns its own store and its own history, and reaches remote agents through its own authenticated network mode. One journal records every write by either side, so time on the board can be scrubbed like a video. In the long run a board is shared: first as an exported file, then as a link, then with comments and a second writer. That is the destination, not hosted multi-tenant multiplayer (Part 3).

**Purpose clarification:** pmx-canvas supports **knowledge work broadly**, including research, analysis, dashboards, planning, discovery, coordination, and orchestrating coding or other work. These are examples, not a closed list or a coding-only boundary. Its promise is to help humans and agents do the work, carry useful understanding into the next task, and see known changes and uncertainty in the context they use. The [companion vision](product-context-vision-2026-09.md#position) explored a separate memory graph and wiki; as of 2026-09-23 that role is played by the boards themselves (move 0), and its publication and audience guidance waits until sharing reaches a second writer. Contributing to memory does not automatically make every item a confirmed fact or shared organizational knowledge; attention does not grant approval or sharing permission.

## Status at 0.6.3 (2026-09-23)

- **None of the 0.6 plan below shipped.** 0.6.0–0.6.3 carried the Bun 1.4.2 upgrade, field-report fixes, the MCP Skills extension and json-render updates. The original 0.6 bundled five moves into 2–3 weeks; the revised sequence ships smaller releases, each with a check for when it is done.
- **The trust defects are still open.** An agent can resolve its own approval gate, the client bridge ignores `res.ok`, the webpage fetcher follows redirects with no host filter. Many boards (move 0) has not started either: there is no boards table.
- **The black tile is on round ten.** 0.6.2 ships it as a known limitation for Copilot/WebKit Excalidraw tiles; `ExtAppFrame.tsx` is 1,591 lines.
- **The live board is plain and curated.** `C4 2026 OKR planning`: 26 markdown cards, 4 groups, 29 edges, 8 pins, written from Copilot sessions. Pins show up when the board is the human's own work.
- **Canvas steering has gone quiet.** 2 of 152 recorded steers were sent in September; the host's own chat sits beside the board and carries the conversation. Steering and the fleet layer stay (move 3); they are not the growth path.
- **The thesis is unmeasured.** Nothing records whether a pin changes what an agent reads or does (Part 1, item 4).
- **There is no second user yet.** Every long-term claim here is untested until someone else depends on a board, which is why the sharing path starts with a static export (move 11).

## What the real boards show

Two corrections from the maintainer shaped this section. First, boards inside the `pmx-canvas` repository are test boards by design. Second, the real boards are mixed in with test boards on the board the globally installed MCP server writes to. That board lives in the directory the host spawns the MCP server from, plus a worktree copy. Its live state on 2026-09-05 was a fixture set (`F Graph`, `Excal A` to `E`; since 2026-09-21 it is the live C4 OKR board in the table), but its snapshot history holds every board that came before, and that is where the real work is. Read-only, titles only, snapshot ids decoded to dates:

| Date | Real board (from snapshot history) | Content |
|---|---|---|
| 2026-04-15 | A quarterly OKR and developer-metrics board | 8 objective cards, 8 metric charts, 1 dashboard app |
| 2026-05-11 | A workshop deck on working with agents | 1 HTML deck, 15 slides |
| 2026-05-27 | Vibe cluster feedback, agent dev environment | 2 HTML surfaces |
| 2026-06-22 | A product discovery board | 17 markdown cards in 4 groups, 1 double-diamond HTML |
| 2026-06-25 to 07-08 | Vibe coding cluster model, agent kanban | 1 Excalidraw app, 2 HTML surfaces |
| 2026-07-07 | Two training tracks for a workplace rollout | 2 markdown outlines, 2 HTML slide decks, 1 file |
| 2026-08-03 | A metrics read on delivery cycle times | 1 markdown, 5 charts, 1 file |
| 2026-08-07 | A department-wide planning overview | about 30 markdown cards, a status card, a six-step flow |
| 2026-08-10 to 08-28 | Work board | 1 json-render surface, the longest-lived real node |
| 2026-09-21 to now | C4 OKR planning (live board, added 2026-09-23) | 26 markdown cards, 4 groups, 29 edges, 8 pins |

Three things follow, and they change the vision more than anything the panel produced.

1. **The product is used for real, by a PM, for thinking and presenting with agents:** OKR boards, metric charts, discovery boards, org overviews, slide decks. Nine sessions over four and a half months, almost all agent-written from the maintainer's prompts.
2. **Every real board was destroyed by the next session.** One board per workspace means the planning overview, the discovery board and the OKR board exist today only as snapshot rows. The product's own persistence model is what makes real use invisible. It is the first thing to fix, and nobody on the panel saw it because nobody looked in the snapshot tables.
3. **The rich surfaces are real-use surfaces.** Thirteen real chart nodes, five real HTML decks and surfaces, two real Excalidraw apps, one long-lived json-render board. My earlier cut of `graph` and json-render was wrong on the evidence, and the maintainer's broader point stands: his own usage is not evidence that any type is unused. No node type is cut anywhere in this document; move 5 changes only how they render.

What still holds from the test boards: steering is the most exercised human verb (84 to 89 browser-sent steers per board), pins are rare (1 or 2 live), and snapshots accumulate without bound (273 and 337 on boards of 14 and 16 live nodes, 24 MB each), which is now doubly telling, since snapshots are the only place the real work survived. The live board revises two of these (2026-09-23): it carries 8 pins, and September brought 2 steers; 108 session snapshots put its database at 29.6 MB for 30 nodes.

## Part 1: The foundation

Move 0 comes first, so real boards stop being overwritten. Then three changes that everything in Part 2 stands on (items 1, 3 and 4), each worth shipping on its own, and one that waits (item 2).

1. **One read.** `canvas://context?budget=N` is the only thing an agent reads per turn: pinned nodes first, then what changed since this consumer's last read (a stable seq cursor), then human-authored nodes, then open asks and undelivered steers for this consumer, then boards pinned on the board map and boards one link away (move 0), each as its README summary and pinned card titles. Finished work-item chatter, delivered steers and system notes never enter it; decisions and outcomes do, including those on past boards, because a completed decision can be the most important context a month later. Everything else stays reachable by explicit pull. It folds 10 of 14 resources into the one read and turns spatial analysis (clusters, neighborhoods, reading order) into an input to the ranker rather than a separate resource.
2. **The board fills itself (later, opt-in).** Scheduled after 1.0 and off by default: files, diffs and test output fit coding sessions, not PM boards, so a board opts in and the projection lands collapsed. Nobody on the panel proposed this and it is the cheapest radical move available: stop requiring the agent to remember to call `canvas_node`. A Claude Code hook, the Copilot extension and the Codex heartbeat project the session onto the board, meaning files touched, diffs, test output and the plan, into a session lane the human then curates from abundance. Today a node exists only when an agent decides to write one.
3. **Author on every node.** The `nodes` table has no writer column. Source provenance is persisted in node data (`canvas-provenance.ts`: where the content came from and how it refreshes), but who wrote a node lives only in the in-memory mutation history, which dies on restart. Add `author`, human or agent id, beside the existing provenance rather than as a second provenance system. The compiler ranks human-written above agent-written, the board can show who wrote what, and a shared board needs it later anyway.
4. **Measure the thesis.** Record which resources each agent session reads and whether the pinned nodes were in it, and add one fixed eval under `docs/evals/`: the same task on a curated and an uncurated board. Until this exists, "pins shape the agent's context" is a belief, not a finding.

## Part 2: The shape I believe in

Sixteen moves, numbered from the one the evidence demands first. Move 3 was rewritten and move 6 split after the maintainer's decisions on 2026-09-06; move 0 was widened and moves 11–14 added after the decisions on 2026-09-23; moves 5 and 7 record the decisions of 2026-09-24. Each carries the panel's strongest objection and my answer, because several of them changed the move.

### 0. Many boards, and boards are the wiki (S, then M, then L)

The move the evidence demands before any other. A workspace holds many named boards, switchable from the top bar and addressable from every transport (`board` on the MCP session, `--board` on the CLI, one journal per board once move 4 lands). A new session starts on a board the human chose or created; test runs get their own boards; nothing is overwritten. Recovery for the maintainer today: the nine real boards above can be restored from snapshot history into named boards in an afternoon. Deletes nothing.

**Decided with the maintainer, 2026-09-23: boards are the wiki.** No separate knowledge store is built; the boards link and nest into one. The full design is in the [review's sketch](product-vision-review-2026-09.md#design-sketch-boards-are-the-wiki); in short:

- **Home and levels.** Home is the board a workspace opens on (level 0). A **portal**, a new `board` node type, is a card that stands for another board, and a board's level is its shortest distance from Home through portals. Levels are derived, never stored; there are no fixed tiers; a board may sit under several parents; cycles are allowed; boards no portal reaches appear in an "Unplaced" lane.
- **Links.** Portals, plus `[[Board]]` and `[[Board#Card]]` in markdown cards, resolved to ids on save so renames do not break them. Unresolved links offer "Create board"; every board lists its backlinks. Portals render text only (title, README summary, last touched, pinned card titles), never a live board, so nesting cannot multiply iframes.
- **The board map is a board.** A generated board of boards and links, built like the code graph (`boardmap-` auto-edges, out of history, debounced), with positions the human drags kept. Pinning a board on the map pulls it into the brief (Part 1, item 1). Map pins are workspace-level: they belong to the library, not to the map board, so they feed the brief whichever board is active. It is called the board map to avoid confusion with the `graph` chart node type.
- **Growth by gesture.** "Make board" turns a group into a board and leaves a portal; "Inline board" reverses it. Group, board and board of boards are one scale.
- **Agent surface.** `canvas://boards` (the library: README summary, parents, level, links, backlinks, last touched), a `board` target on every operation with the MCP session bound to one board, and a `canvas_board` composite (22 → 23 tools, with the freeze test and all four transports updated together).
- **Data.** A `boards` table, `board_id` on nodes, edges, annotations, pins and snapshots, and a `board_links` projection rebuilt from portals and parsed links. The README summary is a flagged card, not a field.
- **State, in two stages.** Stage 1 (S): one active board per server; opening a board saves and loads; other boards are read straight from SQLite; agent writes to a non-active board are refused. Only the human changes the active board, so an agent never swaps the board the human is looking at: an agent may create a board, its session binds to whichever board is active when it starts, and a session that needs another board asks for the switch with an ask card. Stage 2 (L): state managers keyed by board, after the journal, so an agent can work on one board while the human looks at another. `CanvasStateManager` is a singleton with 400+ call sites, which is why stage 2 waits.

Objection: none, the panel did not see it. Risk: the wiki sprawls. Mitigation: the Unplaced lane and staleness on the map (move 13) make neglect visible instead of silent.

### 1. One read, one brief (M)

Above. Objection: ranking by "the human's camera" rests on a signal the product does not have; the server holds one global viewport that agents also write via `view.fit` and `view.focus`, so a camera ranker would rank the agent's own last focus. Accepted. The camera rides the per-tab human-presence heartbeat, viewport writes get an actor like every other write, and the camera is a weak tiebreak, never the primary axis. Primary axes: pins, delta since last read, author, recency.

### 2. The session projects itself onto the board (M)

Above. Objection: none raised; the panel missed it. Risk: noise. Mitigation: the projection lands in its own lane at low rank; the compiler's tiers keep it out of the brief unless pinned or recent.

### 3. The agent's output moves onto the board (M)

**Decided with the maintainer, 2026-09-06: the fleet features stay.** They are new, deliberate capability, and the same rule that protects the node types protects them. Scope fences, consumer keys, the `pump`, parent rollups, census chips, addressed versus broadcast steering and per-consumer delivery are all kept as they are. What follows is a relocation, not a cut.

The problem this move solves is one surface too many. When the agent opens a work item, raises a gate, asks a question or files evidence, it lands in a side table that the canvas cannot show. The human reads it in a panel while the board, the surface built for exactly this, stays blank about it. Two side effects follow: deleting a node forces the server to re-anchor orphaned items, and the panel and the board have different lifetimes, since canvas-bound state rides snapshots while the timeline does not.

So the agent's output becomes nodes. A work item is a `status` node carrying the work state. Approval gates, elicitations and mode requests become one new `ask` node with a typed answer that only a human gives; the agent that asked may withdraw it (move 7). Evidence is a node or a file node. Every gesture that already exists then applies to agent output: drag it beside the file it concerns, group it, pin it, connect it to the diff that raised it. Nothing to re-anchor, because the item is the node. One lifetime, because there is one surface.

The evidence is the maintainer's own board. When three agents reviewed the product for him, they wrote markdown cards and patched each other's sections rather than filing work items. The card won because it was visible and spatial. This move makes the winner the design.

Deletes: the duplicate storage only. The three timeline tables fold into the journal in move 4, which was already happening.

**Three primitives I would still question, as open questions rather than proposals.** The `policy` singleton, `host-capability`, and the command registry (`pmx.plan`, `pmx.review`, and the rest) each carry a schema, a route, an MCP action and a doc section, and I cannot find a use for them on any board or in any field report. I no longer claim the evidence to delete them, and the maintainer's rule is that my not finding a use is not proof. They are worth a deliberate decision, not a default one. Separately, ghost intents: keep the capability, but change the bundled skill so signalling one is opt-in rather than required before every mutation. That is a default, not a feature.

Objection (value lens): steer is the one verb the human demonstrably uses, so any move that touched it would remove the thing that works. Accepted, and now moot: steering, delivery and the fleet around it are untouched. Objection (feasibility): the presence cursors are the presence registry, so they cannot be separated. Accepted, and also moot: presence is untouched.

### 4. One journal is the truth; the app owns its history and its store (L, then XL)

Beside the SQLite store the product already owns, one append-only journal (seq, actor, op, inverse patch) written by the single write path. Snapshots become named bookmarks on the journal; the History drawer becomes a time scrubber over it; SSE becomes journal tailing with `Last-Event-ID` (today there is no cursor, and every reconnect replays the full board); `watch` becomes "entries since seq"; undo survives restart. No external system is involved: the app is its own version control. The maintainer's databases make the case: 4.2 MB of which 3.1 MB is 196 full-copy snapshots of a 25-node board, and 273 to 337 snapshots on the boards where the real work lived.

A folder export (one markdown file per note plus a board file in the product's own schema) is worth having so a human or an agent can read a board without the server, but it is an export, not the store. With Obsidian and git both out of scope, the folder loses two of its three reasons to be canonical, and a canonical file that any process can write would make every trust guarantee advisory. The store stays SQLite; the journal is the truth for who did what.

Objection (feasibility, refuted as written): "a log written by `executeOperation` and nothing else" does not describe this codebase (487 `canvasState.` references in 40 files; the SDK makes 87 direct calls). Accepted: the XL half (state as a fold of the journal) comes after move 6 collapses the SDK onto the registry.

### 5. Keep every node type; unify how they render (M)

The maintainer's rule, and it is the right one: his own usage is not evidence that a node type is unused, and a node that renders any MCP app belongs in the product. So no node type is removed, and the generic `mcp-app` node stays generic. What changes is the machinery under the iframe-backed kinds (`html`, `mcp-app`, `json-render`, `graph`, `webpage`, `mermaid`), which today is spread over six components with three copies of the AX bridge and one 1,591-line frame component whose recovery ladder has produced ten rounds of black tiles (0.6.2 ships the latest as a known limitation).

One frame host for every iframe-backed kind: mounted lazily when the node is in or near the viewport, counted against a live-frame budget, given one paint deadline, and shown with one visible fallback and a retry when it misses, instead of an escalating oracle. Mermaid renders inline and lazily, with no per-node 3.5 MB document. The React chart bundle stays behind `graph` and `json-render` as types, loads only when such a node is on screen, and whether it is later replaced by a lighter renderer is a cost decision, not a usage one. The 21 HTML primitives, the web-artifact builder and every other surface stay as capabilities. One observation, not a cut: the web-artifact builder is the only feature that fetches a toolchain from the network at build time, which sits oddly beside the no-externals rule and deserves a deliberate look.

A frame host is necessary but not sufficient while four hosts set the definition of "works". Name one **reference surface** where every node type must render, gate releases on it, and treat embedded panes as best-effort with the visible fallback. Otherwise field reports keep setting the roadmap, as they did for all of 0.5 and 0.6.

**Decided with the maintainer, 2026-09-24: the reference surface is Chromium at 600 px, for now.** A Playwright project at pane width, beside today's 1440×900 run; every node type must paint in it or the release does not ship. It is nearly free and covers the Claude Code and Codex panes, and Chromium is also the engine a hosted version would target first. What it misses is WebKit, where the Copilot app pane (the maintainer's host) and most black-tile rounds live, and which every iPhone and Safari viewer of a shared link will use. Those stay best-effort behind the visible fallback and retry. Recommended trigger for adding a WebKit project to the gate: whichever comes first of Part 3 step 2 (the read-only link) or the next WebKit-only bug that reaches a release. The compiled-binary window is not an option today: headed `Bun.WebView` is not implemented ([`bun-webview-integration.md`](bun-webview-integration.md)).

Deletes: the `ExtAppFrame` recovery machinery, two of three AX-bridge copies, five per-type iframe implementations. Capabilities removed: none. Every deletion the earlier version of this move argued from "zero real uses" was withdrawn once the real boards surfaced; what remains is argued from cost and incident count only.

### 6a. Make the tool surface cheap (S) — ready to ship

Measured on this tree, `tools/list` is 49,222 bytes across 22 tools, about 12,300 tokens that every agent pays on every session before it does anything. Two tools account for a fifth of it: one advertises 51 optional properties, another 49, because a composite flattens four actions' fields into one schema. Per-action requirements exist only in prose, so a call missing a required field passes validation and fails in the handler.

Nothing structural is needed to fix most of that. Ship per-action schemas where hosts support them and a `canvas_help { op }` that returns one operation's schema on demand, so an agent loads what it uses instead of the whole surface. Add `session.start`, returning workspace, brief and inbox in one round trip, so a useful first session is about five calls. Fix the two live descriptions that are wrong today, and add the test that an action summary always equals its own action list. Put a token budget on every agent read, which is Part 1's one read.

This is the half the maintainer has already endorsed in direction. It removes no capability, renames nothing, and is worth roughly 10,000 tokens per session per agent.

### 6b. Generate every surface from the registry (L, two releases) — pending the maintainer's decision

**Status: undecided as of 2026-09-06.** The maintainer likes the simplification and the token saving, and wants more time on the restructuring. Nothing below should start before that decision.

The proposal: `listOperations()` becomes the single published vocabulary. Five MCP tools (`canvas_read`, `canvas_write` taking a list so batch is just a longer list, `canvas_ask`, `canvas_inbox`, `canvas_help`) replace the 22 (23 once `canvas_board` lands). The CLI becomes one generic dispatcher over operation names plus eight human commands, and the SDK becomes a typed facade over the same invoker. The API document is rendered from the registry, replacing 23,000 words of hand-written prose that has drifted at least seven times.

The case for it: four naming conventions for one operation (`set-focus`, `ax focus`, a path, `setAxFocus`) mean an agent cannot transfer knowledge between transports, and about 14 operations exist in three surfaces but not in MCP with no error explaining the gap.

The case against, which is why it is worth thinking about: 22 named tools are self-documenting in a way that five generic ones are not, a host that renders tool names to the user shows something meaningful today, and a single write tool keyed on operation names needs a discriminated union to catch wrong-field arguments, which not every host supports yet. Generated CLI help is also usually worse than hand-written help.

If the answer is no, 6a still stands on its own, and the one piece worth taking regardless is routing the SDK through the registry, since that is a trust fix rather than a surface change: the SDK makes 87 direct state calls today and 4 registry calls, so an SDK write skips the human edit lock, the scope fence and the activity feed.

Objection (feasibility, refuted as bundled): the previous registry campaign took four pull requests plus a month of follow-up slices, so five refactors in six weeks will not land. Accepted: two releases, SDK first. Objection (evidence): "41 operations unreachable from MCP" is a field-count artifact; the real gap is about 14. Accepted.

### 7. Trust that is not a label (S, then M)

The workbench marker is a plain header any agent with `curl` can set, so "human-only gate resolution keyed on the marker" is still theater. The server mints a secret at boot, serves it only in the workbench HTML, and human-only ops require it. Its limit, raised by the [context vision](product-context-vision-2026-09.md) and accepted: an agent running as the same user can fetch that HTML too, so the secret stops casual header-setting and makes self-approval a deliberate act of circumvention, not proof of human intent. On a local single-user board that is the honest ceiling and the docs should say so; on a shared board (Part 3 step 2 on) human-only ops key on the viewer's own token, which an agent in another person's session never holds.

**Decided with the maintainer, 2026-09-24: the human answers, the requester can withdraw.** Approving, rejecting and answering (gates, elicitations, mode requests) are human-only. A new `withdraw` lets the agent that raised an ask close it while it is still open, with a distinct `withdrawn` status that never counts as approval, so an orchestrator can tidy up at the end of a run. Every agent-facing resolve path becomes withdraw: the `canvas_ax_gate` resolve action, the CLI resolve commands, and the Copilot extension's `resolve_approval` tool (which becomes `withdraw_approval`); the orchestration skill's "resolve gates" step becomes "withdraw open gates". This matches the orchestration skill, which already treats gates as human decisions, and removes the one tool that invited self-approval. In practice the tool matters more than the secret: an agent handed `resolve_approval` will use it. The approval flow sees little real use on the board today, so the change is cheap now.

Then: file nodes are confined by default to the workspace plus explicit allow-roots (persistence hygiene, since every host already gives the agent `cat`); the webpage fetcher follows redirects by hand and refuses any hop that moves a public fetch onto a loopback or private address, and refuses link-local (cloud metadata) addresses on every hop, while a URL the caller points at a local dev server on purpose still loads; the client bridge checks `res.ok` and shows the toast on a refused write. One reservation I am not settled on: the real boards carry file nodes for documents (weekly prioritization reports) that may live outside any repository, and default confinement would have refused them; the default should probably be a per-board allow-root list that includes the folders a PM board actually reads, not the workspace alone.

The same mechanism gives the product its own remote story, without relying on anything external. A loopback-only server means Claude Code cloud, Codex cloud and the Copilot coding agent, the agents that run longest unattended, cannot reach the board at all. With per-writer tokens minted by the server (human tokens served only to the workbench, agent tokens issued per session), the server can bind beyond loopback deliberately (`--listen` plus a token), and a remote agent is just another authenticated writer. No relay, no sync service, no version-control detour. The same tokens carry the read-only share link, the second step of the sharing path in Part 3; the first step, static export (move 11), needs none of this.

Correction to my own review: a human's write cannot hit the 403 fence or the 409 lock, both sit behind `if (!meta.fromWorkbench)`; the silent-failure defect is real but smaller than I wrote.

### 8. Ship a binary and a one-screen README (S)

`bun build --compile` works today: 0.5 s, 66 MB, `bun:sqlite` unmodified, verified by the panel. Release binaries per platform and an npm package that is an installer. The 227 tracked `dist/` files stop being committed. The README becomes the thesis, one scenario showing both directions, Quick start, `smoke`, and a two-minute GIF. The net-negative release rule proposed here (60 days from 2026-09-05) is withdrawn on 2026-09-23: it was not applied in 0.6, and the added moves 0 and 11–14 add before anything is removed. Its intent survives as the sequence's "done when" checks and as move 5's deletions.

### 9. Render for the pane you live in (M)

The home is a 500 to 600 px panel inside Claude Code, Codex, and Copilot. Viewport culling, `content-visibility`, lazy iframe mount, and a live-frame budget. Objection: the thumbnail-eviction pipeline I wanted does not exist (no clip support, capture is macOS-only). Accepted: no thumbnails; culling, lazy mount and the frame budget are move 5's frame host doing its job. Move 5's reference surface is tested at this width, so "works in the reference surface" means "works in a 600 px pane". Today's e2e gate runs only at 1440×900 (`playwright.config.ts`), a size nobody works at in a pane; the reference project fixes that.

### 10. CLAUDE.md and AGENTS.md become one contract, the incidents become checks (S)

Both files stay, because different agents read different files (Claude Code reads CLAUDE.md; Codex, Copilot and Amp read AGENTS.md), and they stay byte-identical under the CI gate that already enforces it. Each becomes the same 120-line contract; the AX design reference moves to `docs/ax.md` and is linked from both; each "this shipped N times" paragraph becomes a test or a Biome rule where an oracle exists. Objection: the ten-time black-tile class has no executable oracle (Playwright is Chromium-only). True, and move 5 replaces the oracle ladder with a paint deadline and a visible fallback, which a test can assert; the WebKit Playwright project, when move 5's trigger adds it, covers the rest.

### 11. Static export: the first step to sharing (S)

A self-contained HTML file of one board: the renderer and the board's data in one file, read-only, with pan, zoom and card expand. It can be attached to an email or a chat message, or posted to a wiki page. No server and no authentication, and the app produces the file itself, so the no-externals rule holds. Iframe-backed nodes export their stored markup in sandboxed iframes, as they render today; a node whose content cannot be inlined (a live MCP app) exports as its last screenshot where capture is available (macOS today, see move 9) and otherwise as a labelled placeholder.

An export is a share, so Part 3's per-board rule applies to it. Portals export as locked cards with no title or summary unless the owner includes the linked board; file node contents, which come from disk, are included only when the owner opts in; the export dialog lists what leaves the machine before the file is written. This is the fastest route to a second user: the live board has a "Workshop flow" card, and exporting it for the workshop's participants is the first real test.

### 12. Tours: the board is the presentation (M)

Five of the real boards include agent-generated HTML slide decks, one with 15 slides, rebuilding as slides content that already existed as cards. A tour is an ordered path through a board's cards, seeded from the reading order `spatial-analysis.ts` already computes and editable by the human. Arrow keys move the camera card to card, and the current card fills the screen. Tours carry into exports and share links, so presenting and sharing are one feature. HTML decks stay as a capability; they stop being the only way to present.

### 13. Recipe cards: boards that can be refreshed (M)

The real boards are full of numbers from elsewhere: 13 metric charts, developer-experience metrics, an OKR mirror card on the live board. They go stale silently, and in a board wiki staleness is the rot. Provenance (`canvas-provenance.ts`) already records a source and refresh strategy for files, URLs, images, apps and artifacts; add one source kind, the **recipe**: the tool call and prompt that produced the card, recorded when an agent writes it. The canvas never fetches external data itself; it marks the card stale after a set age, "Refresh this board" hands the stale recipes to the attached agent, and the board map shows staleness beside last-touched time. A recipe is data, never instructions: a refresh runs only when a human asks, and the agent may decline it.

### 14. New board from this board (S)

The same OKR board appears in April and again for C4. "New board from this board" copies the structure (groups, the README card, recipe cards) without the content and links the new board to the old one as its previous board. Recurring work forms chains on the board map without anyone filing it, "what changed since the April OKRs?" becomes answerable, and any board becomes a template for the next.

### The payoff nobody asked for

With one journal, a **time scrubber** replaces snapshots, the History drawer, and diff: drag a slider and watch the agent's work unfold on the board. With one brief, an **attention heat** on the board, and on the board map across boards, shows the human exactly what the agent will read next, so looking and pinning become visible tuning. Those two are the demo. They are also the two-way surface at its most literal: you see what the agent sees, and you see what it did.

## Part 3: Long term, share this board

**Decided with the maintainer, 2026-09-23:** the destination is "share this board", not hosted multi-tenant multiplayer. Hosted multiplayer competes head-on with established whiteboard products that have teams, funding and their own MCP integrations. What they cannot easily be is local-first, host-agnostic, and inside the agent's pane in Claude Code, Codex, Copilot and Amp; that is where this product wins. A PM board is something its owner presents to colleagues, so sharing grows from that, one step at a time, and each step is justified only by someone using the one before it.

| Step | What it is | Needs first |
|---|---|---|
| 1. Export | A static HTML file of one board (move 11), carrying its tour once move 12 lands | nothing |
| 2. Link | A read-only share link: `--listen` plus a board-scoped read token | move 7 in full |
| 3. Comments | Viewers annotate and reply; comments are cards addressed to the owner | author on every node (Part 1) |
| 4. Second writer | Another human writes to a shared board, with their own agent | the journal (move 4), concurrent boards (move 0, stage 2) |
| 5. Accounts | Per-board roles (read, comment, write, answer asks), single-tenant | a team using step 4 |

**What Part 2 already buys.** The journal (move 4) is the sync model: an ordered log with sequence numbers, per-consumer cursors and inverse patches is exactly what multiple clients need, and node-granular edits with compare-and-set on the node version resolve concurrent human edits without operational transforms or CRDTs. Per-writer tokens (move 7) become per-user credentials; author on every node (Part 1) becomes attribution; presence is already multi-writer with identity colors; the ask node with a human-only answer becomes an ask addressed to a person or a role.

**Sharing is per board.** Sharing a board never shares what it links to. A portal to a board the viewer cannot see renders as a locked card with no title, and the viewer's brief never reaches past what they can see. This is where the [context vision's](product-context-vision-2026-09.md) publication and audience rules apply: an automatic derivative's audience cannot exceed its inputs', and publication is an explicit act, not a side effect of summarizing.

**What is genuinely new at step 5.** Step 5 is a team server: the same binary run with `--listen` on a machine the team reaches, one store per team, not a multi-tenant service. Identity is the app's own (passkeys and email, federation optional later). If that server is not the owner's machine it has no workspace on disk, so file nodes become uploads with re-upload in place of the watcher. The brief is compiled from the attention of the people in an agent's session, not everyone's, so two people can work one board with different agents without steering each other's context.

**The vision it enables.** A quarterly OKR board with the PM, the team leads and each of their agents on it, every card attributed, every ask answered by the person it was addressed to, and the time scrubber showing how the plan changed and who changed it, reached from a link the PM sent after the workshop.

**The constraints that hold.** No externals: history and sync are the journal, not a third-party service. Everything in move 7 is mandatory before step 2 opens a port, and MCP-app hosting of third-party apps needs a per-board allowlist once viewers are not all the owner. Multi-tenant hosting and team-wide knowledge governance are not planned; they come back only if a second team is pulling for them.

## What is architecturally wrong today

1. **One write lands in four logs and none is durable.** Mutation history (200 closures, in-memory), the SSE ring (500, in-memory), presence activity (50), and three AX tables with independent retention. Undo is empty after every restart. SSE has an `id:` field nobody reads.
2. **The human marker is a label, not a gate.** Actor attribution, the fence, and the lock all key on an unauthenticated header.
3. **Three write paths with three policies.** The registry (fence, lock, actor), the SDK (87 direct state calls, none of those), and 21 hand-written routes in a 3,471-line server file.
4. **Node type is not the renderer.** Five rendering tiers, three node types funnelled through one iframe component, two UI frameworks, two CSS toolchains.
5. **Single-slot listeners and import-order wiring.** `onMutation` and the work-items listener hold one callback each; module-level timers outlive the server.
6. **The knowledge that keeps the product working lives in prose.** Rules 3, 7, and 9 in CLAUDE.md and its byte-identical AGENTS.md twin have each grown a paragraph per recurrence.
7. **One board in memory, by construction.** `CanvasStateManager` is a singleton holding exactly one board, and 400+ call sites assume it. That is why a workspace has one board today and why concurrent boards (move 0, stage 2) wait for the journal.

## What must not be touched

The operation registry and its dispatcher. State in the server, browser as renderer. The human/agent distinction as a first-class concept (to be made real, not removed). Context pins and `canvas://pinned-context`. Six of six iframes sandboxed without `allow-same-origin`. `smoke`, the e2e gate, the changelog discipline. The velocity: 110 commits, +64,444 and −13,026 lines in the six weeks to 2026-09-05, which makes this plan credible if it is spent on the plan rather than on field reports, which is where 0.6 went.

## Sequence

Revised 2026-09-23. The original 0.6 bundled five moves into 2–3 weeks and shipped none of them, so each release is now small and ends on a check rather than a week count.

| Release | Content | Done when |
|---|---|---|
| 0.7 | The S half of trust (move 7: boot secret, human-only answers with requester withdraw, `res.ok` toasts, redirect host filter), many boards stage 1 with the nine real boards restored (move 0), read instrumentation (Part 1, item 4), static export (11), the Chromium 600 px reference project (5). | An agent's approve returns 403 and its withdraw returns `withdrawn`; the nine boards open by name; a board exports to one file that opens offline; every node type paints at 600 px. |
| 0.8 | Portals, README card, `canvas://boards`, new board from this board (14), author on every node, the one read with its cross-board tier (Part 1), the cheap tool surface (6a), the binary (8). | "What changed since the April OKRs?" is answered from a board linked to the April board, without the agent being told which board to read. |
| 0.9 | Wiki links and the board map, make board and inline board (0), tours (12), recipe cards (13), the frame host (5). | A board with 20 portals mounts no more iframes than one without; a tour runs inside an exported file. |
| 1.0 | The journal and bookmarks (4), the agent's output onto the board (3), the SDK through the registry, the M half of trust with the read-only share link (7, Part 3 step 2), time scrubber, culling and frame budget (9). | A colleague opens a shared link to a live board. |
| After 1.0 | Comments and a second writer (Part 3 steps 3–4), concurrent boards (0, stage 2), state as a fold of the journal, generated surfaces (6b, if decided), session projection (Part 1, item 2). | Each step starts only when the previous one is in use. |

## Where I disagree with the panel

- The minimalist and the strategist delete AX. Wrong target, and after the maintainer's decision the target is narrower still: the agent's output moves onto the board, and every AX mechanism including the whole fleet layer stays.
- The minimalist deletes the registry. Refuted three to zero: the browser alone calls 55 API paths.
- The rendering architect deletes the tool rail and top bar. Design for 600 px first; the rail is the good part of the chrome.
- Every vision, and my own first draft, proposed cutting node types on the strength of the repo's test board. The real boards refute the chart cut outright, and the maintainer's rule closes the rest: usage on one machine is not evidence of non-use. No node type is cut; consolidation is confined to how nodes render.
- Four of six visions leaned on Obsidian, and five on git, as the format, the snapshot system, or the remote transport. The maintainer's rule is that this is its own app with no reliance on externals, and I agree: the app owns its history (the journal), its store (SQLite), and its remote reach (tokens and a listen mode). What survives of the folder idea is an export.
- Several visions invented constants (700 chars, six frames, 14k lines) with the same confidence they mocked the repo's. So did I. Every such number in this document is a starting value to tune in use, not a claim.

## Evidence

| Claim | Source |
|---|---|
| Nine real boards Apr–Aug 2026 in the snapshot history of the board the global MCP install writes to (13 chart, 5+ HTML, 2 Excalidraw, 1 json-render, about 60 markdown real nodes); live state then was fixtures; 84–89 browser steers; 273–337 snapshots on 14–16 live nodes | read-only `sqlite3` over `snapshot_nodes`, titles only, snapshot ids decoded to dates, 2026-09-05 |
| 3.1 MB of 4.2 MB is snapshots; 196 snapshots, 2,206 rows | `dbstat`, `snapshot_meta`, `snapshot_nodes` counts, 2026-09-05 |
| Rendering tier 11,298 lines, 10 of 17 deps, 5.6 MB dist | fact-finder `rendering`, `wc -l`, `package.json` |
| SDK bypass 87 direct calls vs 4 registry calls | `grep -c "canvasState\." src/server/index.ts` |
| File nodes unconfined at create | `src/server/canvas-operations.ts:760`; confinement exists only in the byte-serving route |
| Webpage fetcher follows redirects, no host filter | `src/server/webpage-node.ts:216,245-246` |
| Marker is a plain header | `src/server/operations/http.ts:91`; no auth in `server.ts` |
| SSE has no resume cursor | fact-finder `logs`; `Last-Event-ID` unused |
| `bun build --compile` works | panel feasibility refuter: 0.5 s, 66 MB, state route 200 |
| Velocity | `git log --since=2026-07-24 --shortstat`: 110 commits, +64,444 −13,026 |
| Loopback-only server | `server.ts:89` |
| Status at 0.6.3: nothing from the 0.6 plan shipped; trust defects open; black tile known limitation; `ExtAppFrame.tsx` 1,591 lines | `CHANGELOG.md` 0.6.0–0.6.3 and source at `561e6ec5`; see [`product-vision-review-2026-09.md`](product-vision-review-2026-09.md#evidence) |
| Live board: 30 nodes (26 markdown, 4 groups), 29 edges, 8 pins; 152 steers, 2 in September; 108 snapshots, 29.6 MB | read-only `sqlite3` over the live board's database, 2026-09-23 |
