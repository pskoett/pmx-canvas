# Vision Review — September 2026

**Status:** Accepted and folded into [`product-vision-2026-09.md`](product-vision-2026-09.md) on 2026-09-23; this document keeps the reasoning and the full design sketch.
**Date:** 2026-09-23
**Scope:** An independent review of the long-term direction set by [`product-vision-2026-09.md`](product-vision-2026-09.md) and [`product-context-vision-2026-09.md`](product-context-vision-2026-09.md), checked against what has shipped since and against the real board in use today, plus a design sketch for boards as the wiki. Written against `main` `561e6ec5` (v0.6.3, clean tree, equal to `origin/main`).
**Method:** Read all three September documents (review, vision, context vision) and the 0.6.0–0.6.3 changelog; re-checked the review's trust findings in current source; read the live board the globally installed MCP server writes to, read-only, titles and counts only. No code was run and no board was modified.

## Where things stand

- **Three vision documents in September; none of their 0.6 plan has shipped.** The vision's 0.6 was many boards, trust, the cheap tool surface, frame-host consolidation and a binary, in 2–3 weeks. Seventeen days and three releases later, 0.6.0–0.6.3 carried the Bun 1.4.2 upgrade, field-report fixes, the MCP Skills extension and json-render updates.
- **The afternoon-sized trust defects are all still present.** `ax.approval.resolve` never checks the caller, so an agent can approve its own gate. `requestJson` never reads `res.ok`, so a human's failed write is silent. The webpage fetcher uses `redirect: 'follow'` with no host filter. There is no boards table.
- **The black-tile problem is on round ten.** 0.6.2 ships it as a known limitation for Copilot/WebKit Excalidraw tiles, and `ExtAppFrame.tsx` grew to 1,591 lines.
- **The real board today is plain.** `C4 2026 OKR planning`: 26 markdown cards, 4 groups, 29 edges, 8 pins, no annotations, no iframe-backed nodes, written from Copilot sessions. 2 of 152 recorded steers were sent in September. 108 snapshots put `canvas.db` at 29.6 MB for a 30-node board.

## Thesis

**pmx-canvas is the medium where human and agent thinking lands and stays.** It is not primarily a context compiler, and it is not a knowledge-management system. On every real board the agent writes the board, the human shapes it, and the board itself is the product: OKRs, planning overviews, discovery maps, decks. Agent context is a by-product of that.

The 2026-09-06 correction to "the human's extended memory" was right, and the evidence now supports it. Pins went from 1–2 on test boards to 8 on the first board that is plainly the maintainer's own work. Curation shows up when the human owns the artifact.

## Keep

These moves from the vision are sound and should go ahead as written.

- **Many boards (move 0).** Real work is still being overwritten into snapshot rows.
- **One journal as the truth (move 4).** The highest-leverage architectural bet: undo that survives restart, SSE resume, the time scrubber, an audit trail, the sync model for sharing, and the end of full-copy snapshot bloat.
- **Agent output as cards (move 3).** Asks, work items and evidence belong on the surface.
- **Author on every node and a budgeted brief (Part 1).**
- **Trust that is not a label (move 7).**

## Disagreements

### 1. The vision is growing faster than the product

In eighteen days the scope went from "agent working memory" to a memory graph, a maintained wiki, working and confirmed revisions, personal and shared audiences, publication governance, derived-content permissions and hosted multiplayer. That is four products: a canvas, an agent control plane, a knowledge-management system and a team collaboration service, for one maintainer.

The biggest risk to the long-term vision is not its direction. It is that each document adds scope while host compatibility work takes the throughput. No new vision document should be written until move 0 and the trust fixes ship.

### 2. Boards are the wiki

The context vision designs a second data model (entities, immutable revisions, confirmation, publication, audience intersection) to bring pmx-context-frame into the canvas. Most of what it wants follows from making boards first-class instead:

- named boards;
- a board library with a title, summary, last-touched date and search;
- cross-board links, where a node references a node on another board;
- a brief that can retrieve from past boards.

That library is the memory graph, and it needs no second filing system. Confirmation and publication should wait until a second person needs something from these boards; until then they are governance for an audience that does not exist. The [design sketch](#design-sketch-boards-are-the-wiki) below works this out.

### 3. The destination is "share this board", not hosted SaaS

**Decided with the maintainer, 2026-09-23: this is the destination.** It replaces hosted multi-tenant multiplayer (vision Part 3) as the long-term end state.

Hosted multi-tenant multiplayer competes head-on with established whiteboard products that have teams, funding and their own MCP integrations. What they cannot easily be is local-first, host-agnostic, and inside the agent's pane in Claude Code, Codex, Copilot and Amp. That is where this product can win.

An OKR board is something a PM presents, so the natural steps are:

1. a read-only share link (listen mode plus a token);
2. comments;
3. a second human writer;
4. accounts and per-board roles, single-tenant.

Each step is justified only by someone using the one before it.

### 4. The core thesis is still unmeasured

Nobody has shown that a pin changes what an agent does. This is cheap to settle:

- record which resources each agent session reads;
- record whether pinned nodes were in the context it read;
- add one fixed eval under `docs/evals/`: the same task on a curated and an uncurated board.

Until that exists, "attention is the compiler" is a belief.

### 5. The host tax sets the roadmap

Four hosts, sandboxed iframes and WebKit took most of the 0.5 and 0.6 work. Move 5's single frame host is necessary but not sufficient. Name one reference surface where everything must work (the standalone browser, or the compiled binary in its own window), and treat embedded panes as best-effort with an honest fallback. Otherwise field reports keep setting the roadmap.

**Decided with the maintainer, 2026-09-24:** Chromium at 600 px, for now; WebKit joins the gate on a trigger. See [vision move 5](product-vision-2026-09.md#5-keep-every-node-type-unify-how-they-render-m).

### 6. The host's chat is the steering channel

Canvas steering went nearly silent once real work moved to Copilot, whose own chat sits beside the board. The evidence is one board, so this is a signal rather than a finding. Steering and the fleet layer stay, per the 2026-09-06 decision, but they are unlikely to drive growth. The canvas wins on what host chat cannot do: a persistent, spatial, shareable result.

## Design sketch: boards are the wiki

### Principle

A wiki is pages, links between them, and a way to find your way around. The canvas already has a better page than a wiki does: a board. So instead of adding a knowledge model beside the boards, make boards linkable, nestable and mappable. Nothing new is filed; the structure grows out of the work.

### Concepts

| Concept | What it is | New or existing |
|---|---|---|
| Board | A named canvas: nodes, edges, groups, pins, annotations, its own snapshots | New as a stored entity; today a workspace has exactly one |
| Home | The board a workspace opens on when nothing else is chosen; level 0 | New, an ordinary board |
| Portal | A `board` node: a card that stands for another board | New node type |
| Level | A board's shortest distance from Home through portals | Derived, never stored |
| Link | A reference from a card on one board to another board or card | New: portals plus `[[wiki links]]` in markdown |
| Board map | A generated board that shows every board and link | New, built like the code graph |
| README card | The one card on a board marked as its summary | New flag on an existing markdown node |

### Levels grow from placement

A portal on a board makes the target one level below it. Levels are computed from Home by shortest path each time the library changes; nothing stores a level, so moving a portal re-levels a board without a migration.

```
Home                                  level 0
├── Tech Enabling                     level 1  (area board)
│   ├── C4 2026 OKR planning          level 2
│   ├── Delivery metrics              level 2
│   └── Product discovery             level 2
└── Workshops                         level 1
    └── Working with agents (deck)    level 2
```

- **No fixed tiers.** Org, team, initiative and working board are names a user may give boards, not a taxonomy the product enforces. A mandatory taxonomy is the part of a wiki people stop maintaining.
- **A graph, not a tree.** A board may have portals on several parents; its level is the shortest one. `Product discovery` can sit under both `Tech Enabling` and a quarterly planning board.
- **Cycles are allowed.** Two boards may portal to each other; shortest-path levelling cannot loop.
- **Orphans are visible.** A board no portal reaches has no level and appears in an "Unplaced" lane on the board map, which is the wiki's missing-link report for free.

### Links

- **Portal.** Dropping a board onto another board, or choosing "Link board" from the context menu, creates a portal node with `data.boardId`. Double-click opens the target board. A portal renders text only: title, README summary, last-touched time, and the titles of its pinned cards. It never embeds the live board, so nesting cannot multiply iframes.
- **Wiki link.** `[[Board name]]` and `[[Board name#Card title]]` in any markdown card. On save the server resolves the name to a board id (and card id) and stores the ids beside the text, so renaming a board does not break links. The markdown renderer shows a resolved link as a chip that opens the target; an unresolved link renders as a dashed chip that offers "Create board", which is how a wiki grows a new page.
- **Backlinks.** Every board's library entry lists the boards that link to it. The portal card and the board's top bar both show the count.

### The board map is a board

The graph view is not a separate screen. It is a generated board with one node per board and one edge per link, rebuilt the way `code-graph.ts` builds file dependencies: auto-edges carry their own prefix (`boardmap-`), stay out of mutation history, and recompute on a debounce when boards or links change.

- **Arrangement is the human's.** Nodes are generated, but positions the human drags are kept, so the map can be laid out by meaning rather than force. New boards appear near their first parent.
- **Encoding.** Portal edges solid, wiki-link edges dotted. Node size from card count, fade from time since last touched, one colour per level.
- **Pinning a board on the map pulls it into the agent's brief.** Today a pinned neighborhood means nearby cards on one board; on the map it means linked boards. It is the same gesture one level up, and it is the retrieval control for the whole wiki.
- **Everything else works.** Groups, annotations, search and focus behave as on any board, because it is one. The name is "board map" to avoid confusion with the existing `graph` chart node type.

### How the wiki grows

- **Make board.** On a group's context menu: its cards move to a new board named after the group, and a portal takes the group's place. A cluster that outgrew its board becomes a page of its own.
- **Inline board.** On a portal's context menu: the reverse. The target board's cards come back as a group, and the board is archived.
- **New session, new board or chosen board.** A session starts on a board the human picks, or a new one linked from the board it was started from. This replaces today's "Before session" snapshot (`server.ts:138`) as the way work is kept apart; snapshots go back to being bookmarks.

Group, board and board of boards are one continuous scale, and a board moves along it by a gesture, not by filing.

### What the agent gets

- **`canvas://boards`.** The library: id, name, README summary, parents, level, links, backlinks, card count, last touched. Bounded like every other read: summaries are previews, not bodies.
- **A board target everywhere.** Every operation accepts `board`; an MCP session binds to one board at start, so an agent never writes to a board it did not choose. A write to another board is an explicit target, never an accident of which board the human is looking at.
- **A cross-board brief.** The brief carries the current board first, then boards pinned on the map, then boards one link away, each as README summary plus pinned card titles, with full content by explicit pull. This is the budgeted brief of vision Part 1 with the board library as its second tier.
- **One composite tool.** A `canvas_board` composite (`list`, `create`, `open`, `rename`, `archive`, `link`, `make-board`, `inline`) plus the `board` field on existing tools. That moves the tool count from 22 to 23 and needs the tool-surface freeze test and the four transports updated together.

### Data model

- A `boards` table: `id`, `name`, `created_at`, `updated_at`, `archived_at`.
- A `board_id` column on `nodes`, `edges`, `annotations`, `context_pins` and `snapshots`. Node ids are already unique across the database, so pins stay keyed by node.
- A `board_links` table (`from_board`, `from_node`, `to_board`, `to_node`, `kind`) rebuilt from portals and parsed wiki links; it is a projection, not a source of truth.
- The README flag lives in the node's `data`.

Migration: the current board becomes Home. The nine real boards in snapshot history (vision, "What the real boards show") restore as boards under Home, which is the first test of the whole design.

### State architecture: the honest cost

`CanvasStateManager` is one singleton holding one board, and 400+ call sites assume it. Two stages keep the cost down:

1. **One active board per server.** Opening a board saves and loads, the same as a restore. Reads of other boards (library, portals, brief, map) query SQLite directly and never load a second board into memory. Agent writes to a board other than the active one are refused with a clear error. This is enough for one person with one or two agents and is the S-sized move 0.
2. **Concurrent boards.** A registry of state managers keyed by board id, loaded on demand, so an agent can work on one board while the human looks at another. This is an L-sized change and should wait until stage 1 is used and the journal (move 4) exists, since each board then gets its own journal.

### What this replaces in the context vision

- The separate entity and immutable-revision model: boards and cards are the entities; the journal is the revision history.
- The personal wiki: a workspace's board library is the personal wiki.
- Working versus confirmed: postponed. When needed it is a label on a card or board, not a second store.
- Personal versus shared: postponed until sharing exists. Sharing is per board; a portal to a board the viewer cannot see renders as a locked card with no title. Sharing a board never shares what it links to.

### Open questions

- **Scope of Home.** The store is per workspace (`.pmx-canvas/canvas.db`), and real PM work already lives in one workspace. Keep the wiki per workspace; revisit a user-level library only if work spreads across several.
- **Board-level pins versus map pins.** Both feed the brief; the map should show which boards the current brief includes, which is the attention heat of the vision applied to boards.
- **Archive semantics.** Archived boards leave the map and the brief but keep their links resolvable, and a link to one renders greyed.

### Success criteria

- The nine real boards are restored under Home and reachable in two clicks from the map.
- `C4 2026 OKR planning` links to the April OKR board, and an agent starting a new session on a fresh board answers "what changed since the April OKRs?" from the brief without being told which board to read.
- A group turned into a board and inlined back leaves the original board byte-identical apart from ids and timestamps.
- A board with 20 portals renders no more iframes than one without them.

### Sequence

| Step | Size | Delivers |
|---|---|---|
| Many boards, one active (stage 1) | S | Boards, Home, open and switch, restore of the nine boards |
| Portals, README card, `canvas://boards` | M | Levels, library, backlinks |
| Wiki links and the board map | M | Links in cards, the generated map, orphan lane |
| Cross-board brief and map pins | M | Retrieval across the wiki |
| Make board and inline board | S | Organic growth |
| Concurrent boards (stage 2) | L | After the journal; agents on other boards |

## Additional moves

Four moves that follow from what the real boards contain. Two make the sharing destination real before any network work; two keep a board wiki useful over time instead of letting it pile up.

### Static export: the first step to sharing (S)

Sharing through a network mode has to wait for the trust fixes, since the vision makes move 7 mandatory before any port is opened. A self-contained HTML file of one board does not: the renderer and the board's data in one file, read-only, with pan, zoom and card expand. It can be attached to an email or a chat message, or posted to a wiki page.

- No server, no authentication, no attack surface, and the app produces the file itself, so the no-externals rule holds.
- The sharing path becomes **export → link → comments → second writer**. The first step ships in days and puts a board in front of a colleague, which is the second-user milestone.
- The live `C4 2026 OKR planning` board has a "Workshop flow" card; exporting that board for the workshop's participants is the first real test.
- Iframe-backed nodes export their stored markup inside sandboxed iframes, as they render today. A node whose content cannot be inlined (a live MCP app) exports as its last screenshot and says so.

### Tours: the board is the presentation (M)

Five of the real boards include agent-generated HTML slide decks, one with 15 slides. The agent rebuilt as slides content that already existed as cards. A tour is an ordered path through a board's cards, seeded from the reading order `spatial-analysis.ts` already computes and editable by the human. Arrow keys move the camera card to card, and a card fills the screen when it is the current step.

- A deck stops being a separate artifact that drifts from its board.
- Tours carry into exports and share links, so presenting a board and sharing it are one feature.
- HTML decks stay as a capability; they stop being the only way to present.

### Recipe cards: boards that can be refreshed (M)

The real boards are full of numbers from elsewhere: 13 metric charts, developer-experience metrics, and an "Atlassian OKR-board mirror" card on the live board. They go stale silently, and in a board wiki staleness is the rot that kills wikis.

Node provenance already records a source and a refresh strategy (`canvas-provenance.ts`), but only for files, URLs, images, apps and artifacts. Add one source kind, the **recipe**: the tool call and prompt that produced the card, recorded when an agent writes it.

- The canvas never fetches the external data itself; it stores the recipe and marks the card stale after a set age.
- "Refresh this board" hands the stale recipes to whichever agent is attached, which rewrites the cards through the normal write path.
- The board map shows staleness beside last-touched time, so it is visible which parts of the wiki are out of date.
- A recipe is data, never instructions: refreshing runs only when a human asks, and the agent treats the recipe as a request it can decline.

### New board from this board: continuity across cycles (S)

The same OKR board appears in April and again for C4. **New board from this board** copies the structure (groups, the README card, recipe cards) without the content, and links the new board to the old one as its previous board.

- Recurring work forms chains on the board map without anyone filing it.
- The design sketch's success test, "what changed since the April OKRs?", becomes answerable because the link exists.
- It is templates for free: any board can be the pattern for the next one.

| Move | Size | Needs first |
|---|---|---|
| Static export | S | nothing |
| New board from this board | S | many boards (stage 1) |
| Tours | M | nothing; better with export |
| Recipe cards | M | nothing; better with the board map |

## Proposed vision

> **Think with your agents on boards that are still there next week.** Every session lands on a named board, the boards link into a wiki you can see as a map, the agent reads what you curated, and you can share or present a board with anyone.

| Horizon | Content |
|---|---|
| Now (weeks) | Human-only answers with requester withdraw (decided 2026-09-24), backed by a real secret, toasts on failed writes, a redirect host filter, many boards with one active (restore the nine lost boards), instrumentation of what agents read, and static export. |
| Foundation (1–2 months) | Portals, the board library, wiki links, the board map and the cross-board brief; new board from this board, tours and recipe cards; the journal and author on every node, with snapshots as bookmarks; agent output as cards; the SDK routed through the registry. |
| Reach (1.0 and after) | Read-only share links and the time scrubber in 1.0, then comments, then a second writer. |
| Only if pulled by use | Personal and shared knowledge governance; multi-tenant hosting. |

No capability or node type is cut. The fleet layer, every node type and the MCP-app host stay; this changes only what comes first.

## The one thing that matters most

There is still no second user. The repository has 18 stars, every pull request is the maintainer's, and npm downloads are plausibly CI and release smoke. Every long-term claim about wikis, teams or hosting is speculation until someone else depends on a board. The next milestone should be "one colleague opens a shared board", not an architecture move.

## Evidence

| Claim | Source |
|---|---|
| 0.6.0–0.6.3 contents | `CHANGELOG.md` at `561e6ec5` |
| Gate self-approval still possible | `src/server/operations/ops/ax-work.ts`, `ax.approval.resolve` handler has no caller check |
| Silent human write failures | `src/client/state/intent-bridge.ts`, no `res.ok` check in `requestJson` |
| Fetcher follows redirects | `src/server/webpage-node.ts:246` |
| No boards table | `CREATE TABLE` list in `src/server/canvas-db.ts` |
| Black tile known limitation | `CHANGELOG.md` 0.6.2, Known limitations |
| `ExtAppFrame.tsx` 1,591 lines | `wc -l` at `561e6ec5` |
| Live board contents (30 nodes, 29 edges, 8 pins, 0 annotations) | read-only `sqlite3` over `nodes`, `edges`, `context_pins`, `annotations`, 2026-09-23 |
| Steering volume (152 total, 89 browser, 2 in September) | read-only `sqlite3` over `ax_steering`, grouped by source and date |
| 108 snapshots, 29.6 MB database | `snapshots` count and file size, 2026-09-23 |
| Session-driven snapshots from Copilot | `snapshots.name` ("Before session · GitHub Copilot"), September rows |
