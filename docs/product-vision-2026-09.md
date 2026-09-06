# Product Vision — September 2026

**Status:** Proposed
**Date:** 2026-09-05
**Scope:** Where `pmx-canvas` should go, what must be fixed now, what to add, what to delete, and what is architecturally wrong. Written against `main` `e17776f6` (clean tree).
**Method:** My own position, drafted first, then stress-tested by a 54-agent panel: four fact-finders, six independent visions from different angles (context engineering, systems, product strategy, rendering, developer experience, minimalism), a merge into 14 moves, three adversarial refuters per move (evidence, feasibility, value), and a completeness critic. Where the panel refuted me, this document says so. Companion: [`product-review-2026-09.md`](product-review-2026-09.md) (the audit).

## The one-line vision

**The board is the agent's working memory, and the human's attention is the compiler.** Explicit steering directs agents; annotations, pins, connections, and grouping inform relevance, while spatial layout and human camera attention can contribute weaker cues. The server compiles one budgeted brief for every agent turn. Everything the agent has to say to the human is a card on the board, never a row in a side table. The board owns its own store and its own history, and reaches remote agents through its own authenticated network mode. One journal records every write by either side, so time on the board can be scrubbed like a video. In the long run the board is hosted, and a team and its agents share it as one working memory.

**Purpose clarification, 2026-09-06:** pmx-canvas is a visual workspace for **planning, discovery, analysis, and coordination with agents**. This is its intended purpose, not merely an initial audience experiment. Its promise is to let people shape the work spatially, carry useful understanding into the next task, and see known changes and uncertainty in the context they use. The [companion vision](product-context-vision-2026-09.md#position) develops these promises; personal and shared knowledge support the working surface rather than replace it. Attention does not grant approval or sharing permission.

## What the real boards show

Two corrections from the maintainer shaped this section. First, boards inside the `pmx-canvas` repository are test boards by design. Second, the real boards are mixed in with test boards on the board the globally installed MCP server writes to. That board lives in the directory the host spawns the MCP server from, plus a worktree copy. Its live state today is a fixture set (`F Graph`, `Excal A` to `E`), but its snapshot history holds every board that came before, and that is where the real work is. Read-only, titles only, snapshot ids decoded to dates:

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

Three things follow, and they change the vision more than anything the panel produced.

1. **The product is used for real, by a PM, for thinking and presenting with agents:** OKR boards, metric charts, discovery boards, org overviews, slide decks. Nine sessions over four and a half months, almost all agent-written from the maintainer's prompts.
2. **Every real board was destroyed by the next session.** One board per workspace means the planning overview, the discovery board and the OKR board exist today only as snapshot rows under test fixtures. The product's own persistence model is what makes real use invisible. It is the first thing to fix, and nobody on the panel saw it because nobody looked in the snapshot tables.
3. **The rich surfaces are real-use surfaces.** Thirteen real chart nodes, five real HTML decks and surfaces, two real Excalidraw apps, one long-lived json-render board. My earlier cut of `graph` and json-render was wrong on the evidence, and the maintainer's broader point stands: his own usage is not evidence that any type is unused. No node type is cut anywhere in this document; move 5 changes only how they render.

What still holds from the test boards: steering is the most exercised human verb (84 to 89 browser-sent steers per board), pins are rare (1 or 2 live), and snapshots accumulate without bound (273 and 337 on boards of 14 and 16 live nodes, 24 MB each), which is now doubly telling, since snapshots are the only place the real work survived.

## Part 1: The foundation

Move 0 comes first, so real boards stop being overwritten. Then three changes that everything in Part 2 stands on. None of them is speculative; each is worth shipping on its own.

1. **One read.** `canvas://context?budget=N` is the only thing an agent reads per turn: pinned nodes first, then what changed since this consumer's last read (a stable seq cursor), then human-authored nodes, then open asks and undelivered steers for this consumer. Nothing done, delivered or system-generated ever enters it. Everything else stays reachable by explicit pull. It folds 10 of 14 resources into the one read and turns spatial analysis (clusters, neighborhoods, reading order) into an input to the ranker rather than a separate resource.
2. **The board fills itself.** Nobody on the panel proposed this and it is the cheapest radical move available: stop requiring the agent to remember to call `canvas_node`. A Claude Code hook, the Copilot extension and the Codex heartbeat project the session onto the board, meaning files touched, diffs, test output and the plan, into a session lane the human then curates from abundance. Today a node exists only when an agent decides to write one.
3. **Author on every node.** The `nodes` table has no writer column, and provenance lives only in an in-memory ring that dies on restart. Add `author`, human or agent id. The compiler ranks human-written above agent-written, the board can show who wrote what, and hosted multiplayer needs it later anyway.

## Part 2: The shape I believe in

Twelve moves, numbered from the one the evidence demands first. Move 3 was rewritten and move 6 split after the maintainer's decisions on 2026-09-06. Each carries the panel's strongest objection and my answer, because several of them changed the move.

### 0. Many boards per workspace (S)

The move the evidence demands before any other. A workspace holds many named boards, switchable from the top bar and addressable from every transport (`board` on the MCP session, `--board` on the CLI, one journal per board once move 4 lands). A new session starts on a new or chosen board; test runs get their own boards; nothing is overwritten. Recovery for the maintainer today: the nine real boards above can be restored from snapshot history into named boards in an afternoon. Deletes nothing. Objection: none, the panel did not see it.

### 1. One read, one brief (M)

Above. Objection: ranking by "the human's camera" rests on a signal the product does not have; the server holds one global viewport that agents also write via `view.fit` and `view.focus`, so a camera ranker would rank the agent's own last focus. Accepted. The camera rides the per-tab human-presence heartbeat, viewport writes get an actor like every other write, and the camera is a weak tiebreak, never the primary axis. Primary axes: pins, delta since last read, author, recency.

### 2. The session projects itself onto the board (M)

Above. Objection: none raised; the panel missed it. Risk: noise. Mitigation: the projection lands in its own lane at low rank; the compiler's tiers keep it out of the brief unless pinned or recent.

### 3. The agent's output moves onto the board (M)

**Decided with the maintainer, 2026-09-06: the fleet features stay.** They are new, deliberate capability, and the same rule that protects the node types protects them. Scope fences, consumer keys, the `pump`, parent rollups, census chips, addressed versus broadcast steering and per-consumer delivery are all kept as they are. What follows is a relocation, not a cut.

The problem this move solves is one surface too many. When the agent opens a work item, raises a gate, asks a question or files evidence, it lands in a side table that the canvas cannot show. The human reads it in a panel while the board, the surface built for exactly this, stays blank about it. Two side effects follow: deleting a node forces the server to re-anchor orphaned items, and the panel and the board have different lifetimes, since canvas-bound state rides snapshots while the timeline does not.

So the agent's output becomes nodes. A work item is a `status` node carrying the work state. Approval gates, elicitations and mode requests become one new `ask` node with a typed answer, human-only (move 7). Evidence is a node or a file node. Every gesture that already exists then applies to agent output: drag it beside the file it concerns, group it, pin it, connect it to the diff that raised it. Nothing to re-anchor, because the item is the node. One lifetime, because there is one surface.

The evidence is the maintainer's own board. When three agents reviewed the product for him, they wrote markdown cards and patched each other's sections rather than filing work items. The card won because it was visible and spatial. This move makes the winner the design.

Deletes: the duplicate storage only. The three timeline tables fold into the journal in move 4, which was already happening.

**Three primitives I would still question, as open questions rather than proposals.** The `policy` singleton, `host-capability`, and the command registry (`pmx.plan`, `pmx.review`, and the rest) each carry a schema, a route, an MCP action and a doc section, and I cannot find a use for them on any board or in any field report. I no longer claim the evidence to delete them, and the maintainer's rule is that my not finding a use is not proof. They are worth a deliberate decision, not a default one. Separately, ghost intents: keep the capability, but change the bundled skill so signalling one is opt-in rather than required before every mutation. That is a default, not a feature.

Objection (value lens): steer is the one verb the human demonstrably uses, so any move that touched it would remove the thing that works. Accepted, and now moot: steering, delivery and the fleet around it are untouched. Objection (feasibility): the presence cursors are the presence registry, so they cannot be separated. Accepted, and also moot: presence is untouched.

### 4. One journal is the truth; the app owns its history and its store (L, then XL)

Beside the SQLite store the product already owns, one append-only journal (seq, actor, op, inverse patch) written by the single write path. Snapshots become named bookmarks on the journal; the History drawer becomes a time scrubber over it; SSE becomes journal tailing with `Last-Event-ID` (today there is no cursor, and every reconnect replays the full board); `watch` becomes "entries since seq"; undo survives restart. No external system is involved: the app is its own version control. The maintainer's databases make the case: 4.2 MB of which 3.1 MB is 196 full-copy snapshots of a 25-node board, and 273 to 337 snapshots on the boards where the real work lived.

A folder export (one markdown file per note plus a board file in the product's own schema) is worth having so a human or an agent can read a board without the server, but it is an export, not the store. With Obsidian and git both out of scope, the folder loses two of its three reasons to be canonical, and a canonical file that any process can write would make every trust guarantee advisory. The store stays SQLite; the journal is the truth for who did what.

Objection (feasibility, refuted as written): "a log written by `executeOperation` and nothing else" does not describe this codebase (487 `canvasState.` references in 40 files; the SDK makes 87 direct calls). Accepted: the XL half (state as a fold of the journal) comes after move 6 collapses the SDK onto the registry.

### 5. Keep every node type; unify how they render (M)

The maintainer's rule, and it is the right one: his own usage is not evidence that a node type is unused, and a node that renders any MCP app belongs in the product. So no node type is removed, and the generic `mcp-app` node stays generic. What changes is the machinery under the iframe-backed kinds (`html`, `mcp-app`, `json-render`, `graph`, `webpage`, `mermaid`), which today is spread over six components with three copies of the AX bridge and one 1,585-line frame component whose recovery ladder produced nine rounds of black tiles.

One frame host for every iframe-backed kind: mounted lazily when the node is in or near the viewport, counted against a live-frame budget, given one paint deadline, and shown with one visible fallback and a retry when it misses, instead of an escalating oracle. Mermaid renders inline and lazily, with no per-node 3.5 MB document. The React chart bundle stays behind `graph` and `json-render` as types, loads only when such a node is on screen, and whether it is later replaced by a lighter renderer is a cost decision, not a usage one. The 21 HTML primitives, the web-artifact builder and every other surface stay as capabilities. One observation, not a cut: the web-artifact builder is the only feature that fetches a toolchain from the network at build time, which sits oddly beside the no-externals rule and deserves a deliberate look.

Deletes: the `ExtAppFrame` recovery machinery, two of three AX-bridge copies, five per-type iframe implementations. Capabilities removed: none. Every deletion the earlier version of this move argued from "zero real uses" was withdrawn once the real boards surfaced; what remains is argued from cost and incident count only.

### 6a. Make the tool surface cheap (S) — ready to ship

Measured on this tree, `tools/list` is 49,222 bytes across 22 tools, about 12,300 tokens that every agent pays on every session before it does anything. Two tools account for a fifth of it: one advertises 51 optional properties, another 49, because a composite flattens four actions' fields into one schema. Per-action requirements exist only in prose, so a call missing a required field passes validation and fails in the handler.

Nothing structural is needed to fix most of that. Ship per-action schemas where hosts support them and a `canvas_help { op }` that returns one operation's schema on demand, so an agent loads what it uses instead of the whole surface. Add `session.start`, returning workspace, brief and inbox in one round trip, so a useful first session is about five calls. Fix the two live descriptions that are wrong today, and add the test that an action summary always equals its own action list. Put a token budget on every agent read, which is Part 1's one read.

This is the half the maintainer has already endorsed in direction. It removes no capability, renames nothing, and is worth roughly 10,000 tokens per session per agent.

### 6b. Generate every surface from the registry (L, two releases) — pending the maintainer's decision

**Status: undecided as of 2026-09-06.** The maintainer likes the simplification and the token saving, and wants more time on the restructuring. Nothing below should start before that decision.

The proposal: `listOperations()` becomes the single published vocabulary. Five MCP tools (`canvas_read`, `canvas_write` taking a list so batch is just a longer list, `canvas_ask`, `canvas_inbox`, `canvas_help`) replace the 22. The CLI becomes one generic dispatcher over operation names plus eight human commands, and the SDK becomes a typed facade over the same invoker. The API document is rendered from the registry, replacing 23,000 words of hand-written prose that has drifted at least seven times.

The case for it: four naming conventions for one operation (`set-focus`, `ax focus`, a path, `setAxFocus`) mean an agent cannot transfer knowledge between transports, and about 14 operations exist in three surfaces but not in MCP with no error explaining the gap.

The case against, which is why it is worth thinking about: 22 named tools are self-documenting in a way that five generic ones are not, a host that renders tool names to the user shows something meaningful today, and a single write tool keyed on operation names needs a discriminated union to catch wrong-field arguments, which not every host supports yet. Generated CLI help is also usually worse than hand-written help.

If the answer is no, 6a still stands on its own, and the one piece worth taking regardless is routing the SDK through the registry, since that is a trust fix rather than a surface change: the SDK makes 87 direct state calls today and 4 registry calls, so an SDK write skips the human edit lock, the scope fence and the activity feed.

Objection (feasibility, refuted as bundled): the previous registry campaign took four pull requests plus a month of follow-up slices, so five refactors in six weeks will not land. Accepted: two releases, SDK first. Objection (evidence): "41 operations unreachable from MCP" is a field-count artifact; the real gap is about 14. Accepted.

### 7. Trust that is not a label (S, then M)

The workbench marker is a plain header any agent with `curl` can set, so "human-only gate resolution keyed on the marker" is still theater. The server mints a secret at boot, serves it only in the workbench HTML, and human-only ops require it. Then: `ask` answers are human-only; file nodes are confined by default to the workspace plus explicit allow-roots (persistence hygiene, since every host already gives the agent `cat`); the webpage fetcher refuses loopback, private, and link-local addresses on every redirect hop; the client bridge checks `res.ok` and shows the toast on 400 and 500. One reservation I am not settled on: the real boards carry file nodes for documents (weekly prioritization reports) that may live outside any repository, and default confinement would have refused them; the default should probably be a per-board allow-root list that includes the folders a PM board actually reads, not the workspace alone.

The same mechanism gives the product its own remote story, without relying on anything external. A loopback-only server means Claude Code cloud, Codex cloud and the Copilot coding agent, the agents that run longest unattended, cannot reach the board at all. With per-writer tokens minted by the server (human tokens served only to the workbench, agent tokens issued per session), the server can bind beyond loopback deliberately (`--listen` plus a token), and a remote agent is just another authenticated writer. No relay, no sync service, no version-control detour.

Correction to my own review: a human's write cannot hit the 403 fence or the 409 lock, both sit behind `if (!meta.fromWorkbench)`; the silent-failure defect is real but smaller than I wrote.

### 8. Ship a binary, one-screen README, net-negative releases (S)

`bun build --compile` works today: 0.5 s, 66 MB, `bun:sqlite` unmodified, verified by the panel. Release binaries per platform and an npm package that is an installer. The 227 tracked `dist/` files stop being committed. The README becomes the thesis, one scenario showing both directions, Quick start, `smoke`, and a two-minute GIF. For 60 days a release may ship only if it deletes more lines than it adds, or is one of the trust fixes, or is move 0. Move 3 and move 6a are exempt too, since both add before they remove.

### 9. Render for the pane you live in (M)

The home is a 500 to 600 px panel inside Claude Code, Codex, and Copilot. Viewport culling, `content-visibility`, lazy iframe mount, and a live-frame budget. Objection: the thumbnail-eviction pipeline I wanted does not exist (no clip support, capture is macOS-only). Accepted: no thumbnails; culling, lazy mount and the frame budget are move 5's frame host doing its job.

### 10. CLAUDE.md and AGENTS.md become one contract, the incidents become checks (S)

Both files stay, because different agents read different files (Claude Code reads CLAUDE.md; Codex, Copilot and Amp read AGENTS.md), and they stay byte-identical under the CI gate that already enforces it. Each becomes the same 120-line contract; the AX design reference moves to `docs/ax.md` and is linked from both; each "this shipped N times" paragraph becomes a test or a Biome rule where an oracle exists. Objection: the nine-time black-tile class has no executable oracle (Playwright is Chromium-only). True, and move 5 replaces the oracle ladder with a paint deadline and a visible fallback, which a test can assert; a WebKit Playwright project would cover the rest.

### The payoff nobody asked for

With one journal, a **time scrubber** replaces snapshots, the History drawer, and diff: drag a slider and watch the agent's work unfold on the board. With one brief, an **attention heat** on the board shows the human exactly what the agent will read next, so looking and pinning become visible tuning. Those two are the demo. They are also the two-way surface at its most literal: you see what the agent sees, and you see what it did.

## Part 3: Long term, hosted multiplayer

**Discussion extension, 2026-09-06:** [Boards, personal wiki, and workspace context](product-context-vision-2026-09.md) reviews this plan and proposes app-owned personal and shared knowledge built from board evidence. It includes oracle feedback, publication and permission boundaries, corrections to the trust/provenance assumptions below, and a small validation experiment. It is a proposal, not a replacement for the maintainer's settled decisions or authorization to start hosted work.

The maintainer's long-term direction, and the natural end of the two-way surface: the board is hosted, people log in, and several humans and their agents work on the same canvas. My position is that this is the right destination and that almost everything in Part 2 is its prerequisite, which is the strongest argument for Part 2.

**What Part 2 already buys.** The journal (move 4) is the sync model: an ordered log with sequence numbers, per-consumer cursors and inverse patches is exactly what multiple clients need, and node-granular edits with compare-and-set on the node version resolve concurrent human edits without operational transforms or CRDTs. Per-writer tokens (move 7) become per-user credentials; the listen mode becomes the hosted server; author on every node (Part 1) becomes attribution; presence is already multi-writer with identity colors; many boards (move 0) become the team's board list; the ask node with a human-only answer becomes an ask addressed to a person or a role.

**What is genuinely new.** Identity and authorization: accounts, per-board roles (read, write, answer asks), and an audit trail, which the journal already is. Hosting: the same Bun binary run with `--listen` behind TLS, one server per team first (single-tenant, one store per team), multi-tenant only if a second team ever needs the same server. Uploads instead of file nodes: a hosted server has no workspace on disk, so a file node becomes an uploaded document with its watcher replaced by re-upload or a connector. Per-person attention on a shared board: the brief an agent reads is compiled from the attention of the people in that agent's session, not from everyone's, so two people can work the same board with different agents without steering each other's context.

**The vision it enables.** A team's working memory: a quarterly OKR board with the PM, the team leads and each of their agents on it, every card attributed, every ask answered by the person it was addressed to, and the time scrubber showing how the plan changed and who changed it. That is a product nobody has, and it is the same product as Part 2 with a login screen.

**The constraints that hold.** No externals: identity is the app's own (passkeys and email, with federation optional later), and history and sync are the journal, not a third-party service. Trust stops being optional: everything in move 7 is mandatory before a single port is opened to the internet, and MCP-app hosting of third-party apps needs a per-board allowlist once viewers are not all the owner. Scope: this is 2.0 work for a solo maintainer. It should not start before 1.0, and it should not shape 0.6 to 0.8 beyond the choices above that cost nothing now.

## What is architecturally wrong today

1. **One write lands in four logs and none is durable.** Mutation history (200 closures, in-memory), the SSE ring (500, in-memory), presence activity (50), and three AX tables with independent retention. Undo is empty after every restart. SSE has an `id:` field nobody reads.
2. **The human marker is a label, not a gate.** Actor attribution, the fence, and the lock all key on an unauthenticated header.
3. **Three write paths with three policies.** The registry (fence, lock, actor), the SDK (87 direct state calls, none of those), and 21 hand-written routes in a 3,471-line server file.
4. **Node type is not the renderer.** Five rendering tiers, three node types funnelled through one iframe component, two UI frameworks, two CSS toolchains.
5. **Single-slot listeners and import-order wiring.** `onMutation` and the work-items listener hold one callback each; module-level timers outlive the server.
6. **The knowledge that keeps the product working lives in prose.** Rules 3, 7, and 9 in CLAUDE.md and its byte-identical AGENTS.md twin have each grown a paragraph per recurrence.

## What must not be touched

The operation registry and its dispatcher. State in the server, browser as renderer. The human/agent distinction as a first-class concept (to be made real, not removed). Context pins and `canvas://pinned-context`. Six of six iframes sandboxed without `allow-same-origin`. `smoke`, the e2e gate, the changelog discipline. The velocity: 110 commits, +64,444 and −13,026 lines in the last six weeks, which is what makes a deletion-heavy plan credible.

## Sequence

| Release | Weeks | Content |
|---|---|---|
| 0.6 | 2–3 | Many boards (move 0), trust (move 7), the cheap tool surface (6a), the frame-host consolidation of move 5, the binary (8). |
| 0.7 | 2 | The foundation (Part 1): one read, session projection, author on every node. |
| 0.8 | 4–6 | The journal and bookmarks (4), the agent's output onto the board (3), the SDK through the registry. |
| 1.0 | | Generated surfaces (6b, if decided), state as a fold of the journal, time scrubber, attention heat, culling and frame budget (9). |
| 2.0 | | Hosted multiplayer (Part 3): accounts and per-board roles, listen mode behind TLS, uploads instead of file nodes, per-person attention on a shared board. |

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
| Nine real boards Apr–Aug 2026 in the snapshot history of the board the global MCP install writes to (13 chart, 5+ HTML, 2 Excalidraw, 1 json-render, about 60 markdown real nodes); live state is fixtures; 84–89 browser steers; 273–337 snapshots on 14–16 live nodes | read-only `sqlite3` over `snapshot_nodes`, titles only, snapshot ids decoded to dates, 2026-09-05 |
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
