# Product Vision — September 2026

**Status:** Direction accepted. Decisions are recorded where they were made (2026-09-06, 2026-09-23, 2026-09-24, 2026-09-26); a move not marked decided is still a proposal.
**Date:** 2026-09-05; release scope updated 2026-09-29; ChatGPT plugin decision added 2026-10-03; first hosted version direction added 2026-10-10
**Scope:** Where `pmx-canvas` should go, what must be fixed now, what to add, what to delete, and what is architecturally wrong. Written against `main` `e17776f6` (clean tree); revised against `561e6ec5` (v0.6.3).
**Revisions:** 2026-09-23 (the [vision review](product-vision-review-2026-09.md) folded in; it keeps the reasoning and the full design sketch), 2026-09-24 (gate and reference-surface decisions; promise hardened; measurement split), 2026-09-26 (gate answers become attribution, not a lock; moved to 0.8). Details in git history.
**Method:** My own position, drafted first, then stress-tested by a 54-agent panel: four fact-finders, six independent visions from different angles (context engineering, systems, product strategy, rendering, developer experience, minimalism), a merge into 14 moves, three adversarial refuters per move (evidence, feasibility, value), and a completeness critic. Where the panel refuted me, this document says so. Companion: [`product-review-2026-09.md`](product-review-2026-09.md) (the audit).

## Current plan

*One page; the rest of this document is the reasoning and the detail. Updated 2026-09-28. The implementation status below is authoritative for current progress; historical diagnoses and release slots are retained as planning context, not descriptions of today's checkout.*

**The promise.** One board is both the human's durable workspace and the agent's working memory. Agents write boards, humans shape them, boards last, link into a wiki, travel as files and links, and what the human curates is what the agent reads next.

**The bet inside it.** The first half is proven by use: every real board was agent-written and human-kept. The second half, that the board changes what an agent does, has never been observed. The plan tests it early (0.7 measures, 0.8 checks) and says in advance what happens if it fails.

**Decided:** the fleet layer and every node type stay (2026-09-06); boards are the wiki and the destination is "share this board" (2026-09-23); the workbench is built and checked for any size, from a narrow side pane to a full browser window, checked in Chromium at 600, 1024 and 1920 px, replacing the 2026-09-24 single 600 px reference (2026-10-05); gate answers are open to any writer and record who answered, replacing the 2026-09-24 human-only decision (2026-09-26). Home is a view listing boards, not a board; deleting a board needs an in-page confirm; backup is built in with its own schedule (2026-09-27). Board pins are the working set across boards (2026-10-05, move 0a). A hosted team server separates workspace and personal libraries (2026-10-05, Part 3). Folders are the one browsing hierarchy and links stay a graph for relations (2026-10-06, move 0). Undecided: generated surfaces (6b).

**Knowledge direction, 2026-10-07:** Part 3 extends the workspace/personal split to user-defined knowledge scopes (org → team → personal is one example template), with categories as a property of folders. Move 13 adopts evidence-backed context lifecycle from the context-decay framework. Both are model-independent; Jev-style classification is optional longer-term assistance. These are planned additions, not shipped features or new Wave 1 prerequisites.

**Design track, 2026-10-04:** [design.md](design.md) pairs each remaining move with the design that shows it, in waves: a foundation (one font, scale and meaning colours across all themes) first and alone, then context made visible with the curation evaluation, the board map and graph with the wiki work, the relations layer with moves 1 and 13, and the frame host with move 5. A wave is done only when function and design both pass.

**Document import, updated 2026-09-28:** the agent-assisted v1 is implemented and verified on `main` (move 15): attach an original, explicitly request agent processing, review the returned Markdown, then add it to the board. Simple PDF, PPTX and XLSX fixtures were verified with Amp's tools. Canvas bundles no converter or OCR, does not launch an agent automatically, and does not guarantee general format fidelity.

| Release scope | Content | Acceptance target (not a completion claim) |
|---|---|---|
| 0.7.0 — persistent boards and connected memory | Many boards, nested folders, backups, static export, README/link cards, library search, shared card text, attribution/revisions, selective copies, bounded cross-board context, agent-assisted document import, trust fixes and the 600 px gate | Release checks, installed-package smoke, browser workflows and live board checks pass; document conversion limitations and migration are explicit |
| Next batch — scope/version to be agreed | Remaining wiki/graph work and real-agent curation evaluation; cheap-tool surface and binary distribution remain candidates, not completed work | A focused plan with its own acceptance checks; no automatic carry-over of the old 0.8 bundle |

**Release decision, 2026-09-29:** package the completed batch as **0.7.0**, not
0.8. Static export and the connected-memory features move into this release;
their older release slots below are superseded. Publication is tracked by the
GitHub release and npm version, not inferred from a source version bump.

**ChatGPT plugin decision, 2026-10-03: deferred until hosted PMX Canvas.**
The full, publicly installable ChatGPT plugin will wait for a hosted PMX Canvas
runtime. The current local PMX process plus private Secure MCP Tunnel remains
a development preview, not the intended public installation experience. Users
should not have to keep a local process and private tunnel running to use the
released ChatGPT plugin. Installing a plugin does not itself provision or host
PMX, and the current preview connection is tied to the maintainer's runtime.

Revisit the plugin when hosted PMX can provide authenticated, isolated user
workspaces, durable board storage and a supported remote MCP endpoint. Then
verify installation, account connection, node rendering, context synchronization
and reconnect behavior in ChatGPT before public release. Preserve the preview
and its fixes as groundwork; pause further full-plugin release work. This is a
sequencing decision, not authorization to build or launch hosted PMX now, and it
does not change local PMX Canvas's existing distribution.

**Hosted direction, 2026-10-10:** after the team features in Part 3, the first
hosted version targets ChatGPT Sites with OpenAI login and the MCP server hosted
there too. This is the first product validation, with the ChatGPT plugin as its
distribution channel. If it works and people adopt it for recurring work, the
next ambition is a full PMX Canvas service hosted directly on Cloudflare
(Part 5). Access by other agents through OAuth using their user's OpenAI login
remains a target. Sites login and its ChatGPT/Codex MCP plugin are documented;
arbitrary external-client OAuth remains a separate validation gate. See Part 4
for the live probe's discovery/registration blockers, node compatibility
assessment and acceptance targets.

**Hold the line.** No host-compatibility work jumps the queue until 0.7 ships, with two exceptions: regressions the reference project catches, and a bug that blocks the maintainer's real work in the host they use daily (today the Copilot app, a WebKit pane the Chromium reference does not cover). The second exception is narrow on purpose: it covers a board that cannot be used, not a tile that paints late or a host the maintainer is only testing.

## The one-line vision

**The board is the human's extended memory and the agent's working memory—a shared surface for doing work and building understanding.** The human uses it to research, analyze, monitor dashboards, explore ideas, and start, plan, and orchestrate coding or other work. People and agents bring sources, questions, relationships, plans, and results onto the board. **Boards are the wiki:** every session lands on a named board, boards link to each other and nest into levels, and the board map shows the whole library as one more board. Relevant boards return to the agent's brief to support the next task. The human is a worker and thinker here, not merely a curator of agent context.

> **Think with your agents on boards that are still there next week.** Every session lands on a named board, the boards link into a wiki you can see as a map, the agent reads what you curated, and you can share or present a board with anyone.

**Both halves, and which one is the bet.** The board being the human's durable workspace, written by agents, is proven: every real board was agent-written from the maintainer's prompts and then shaped, pinned, presented and returned to. The board being the agent's working memory, read and acted on, is a hypothesis: nothing yet shows an agent reading the board and behaving differently because of it, canvas steering has gone quiet, and the conversation lives in the host's chat. The vision holds both as one loop, so it has to prove the second half rather than let it ride on the first. Two things make that possible. Every node type needs a text form that carries its meaning, because a board that is rich for a human (decks, charts, drawings) is nearly opaque to an agent otherwise (move 1). And the loop is measured release by release, with a fixed benchmark (Part 1, item 4).

Human attention helps select the agent's context; it does not define the whole product. Explicit steering directs agents; annotations, pins, connections, and grouping inform relevance, while spatial layout and human camera attention can contribute weaker cues. The server compiles one brief for every agent turn, paged so it never floods a host. Everything the agent has to say to the human is a card on the board, never a row in a side table. The board owns its own store and its own history, and reaches remote agents through its own authenticated network mode. One journal records every write by either side, so time on the board can be scrubbed like a video. In the long run a board is shared: first as an exported file, then as a link, then with comments and a second writer. That is the sharing sequence in Part 3; the first managed hosted offering follows it in Part 4.

**Purpose clarification:** pmx-canvas supports **knowledge work broadly**, including research, analysis, dashboards, planning, discovery, coordination, and orchestrating coding or other work. These are examples, not a closed list or a coding-only boundary. Its promise is to help humans and agents do the work, carry useful understanding into the next task, and see known changes and uncertainty in the context they use. The [companion vision](product-context-vision-2026-09.md#position) explored a separate memory graph and wiki; as of 2026-09-23 that role is played by the boards themselves (move 0), and its publication and audience guidance waits until sharing reaches a second writer. Contributing to memory does not automatically make every item a confirmed fact or shared organizational knowledge; attention does not grant approval or sharing permission.

## Implementation included in 0.7.0 (scope updated 2026-09-29)

The connected-memory and import batches are committed and pushed through
[`8dbdde2`](https://github.com/pskoett/pmx-canvas/commit/8dbdde29635c275e1eda0bba524071048196feec).
These features are included in **0.7.0**, together with release-review fixes for
snapshot isolation, delayed imports, rapid board switching and recency ordering.
This scope supersedes the original 0.7/0.7.x/0.8 split.

| Area | Implemented | Remaining boundary |
|---|---|---|
| Library (move 0) | Named boards, Home, nested folders, autosave, board-scoped snapshots, backup/schedule/restore | One active board per server; concurrent board editing remains planned |
| Connected boards (moves 0, 14) | README designation, text-only board-link cards, backlinks, library search, selective inactive board copies | Wiki syntax, board map, direct cross-board card edges, make-board/inline-board gestures remain planned |
| Agent context (Part 1, move 1) | Shared per-type card text, persisted authorship/content revisions, bounded linked/same-folder context, opt-in durable consumer cursors, read instrumentation | Controlled retrieval checks are not the real-agent evaluation of whether curation improves outcomes; the full proposed ranker is not complete |
| Trust (move 7) | Refused-write toasts, redirect filtering, workbench-token attribution and attributed ask answers including self-answers | Local attribution is not proof of human intent; per-writer remote authentication/sharing remains planned |
| Sharing and presentation (moves 11, 12) | Static HTML export with explicit content choices; tours shipped in 0.6.5 | Read-only live share links remain planned; a colleague's use is a separate milestone from browser tests |
| Document context (move 15) | Original attachments, explicit processing consent, agent draft/review/commit, source-linked searchable Markdown, cancellation, retention and export privacy | Extraction depends on host tools; no bundled converter, OCR or general chart/formula fidelity guarantee |
| Pane UX (moves 5, 9) | Chromium 600 px reference gate and Home folder polish | Unified frame host, frame budget and broader renderer consolidation remain planned |

Binary distribution and the cheap-tool surface (moves 8 and 6a), the durable
journal/time scrubber, agent output as native nodes, full SDK registry routing,
recipes, and later sharing stages remain future work. Generated surfaces (6b)
remain undecided.

**Verification:** 1,218 unit tests, 174 client tests and 154 headed browser tests
passed; build and typecheck passed; lint passed with existing warnings. Live
PDF/PPTX/XLSX fixture imports reached readable cards, library search and pinned
agent context, and persistence was checked across restart. This does not prove
OCR or complex document fidelity, a clean-machine restore of the maintainer's
nine historical boards, or the broader effect of curation on agent work. See
[plan 014](plans/plan-014-connected-board-memory.md) for evidence and limitations.

## Status at 0.6.5 (2026-09-26)

- **Tours (move 12) shipped early** in 0.6.5, ahead of their 0.9 slot: saved or group-derived stops, keyboard navigation, optional PNG/MP4 capture.
- **0.7 has started on `main`:** the Chromium 600 px reference project is in the e2e gate, refused writes show a toast with the reason, the webpage fetcher filters redirect hops, and agent context reads are recorded with pinned delivery per consumer ([plan 011](plans/plan-011-context-read-instrumentation.md)).
- **Gate answers moved to 0.8** as attribution rather than a lock (move 7, decided 2026-09-26).
- **Many boards stage 1 and backup are on `main`** ([plan 012](plans/plan-012-many-boards-stage-1.md)): named boards, Home, the top-bar switcher, old snapshots migrated into boards, and built-in backup, schedule and restore. Every 0.7 item is now built, and the 0.7.x static export too ([plan 013](plans/plan-013-static-board-export.md)); releases wait on the maintainer.

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

1. **One read.** `canvas://context?budget=N` is the only thing an agent reads per turn, and since 2026-10-07 it is a map, not a dump: titles, short summaries and relations, the local neighbourhood of the relation graph (move 0), from which the agent pulls what it decides to read in full. It carries pinned nodes first, then what changed since this consumer's last read (a stable seq cursor), then human-authored nodes, then open asks and undelivered steers for this consumer, then boards pinned on the board map and boards one link away (move 0), each as its README summary and pinned card titles. Finished work-item chatter, delivered steers and system notes never enter it; decisions and outcomes do, including those on past boards, because a completed decision can be the most important context a month later. Everything else stays reachable by explicit pull. It folds 10 of 14 resources into the one read and turns spatial analysis (clusters, neighborhoods, reading order) into an input to the ranker rather than a separate resource. **The human sees a cost, not a budget (decided with the maintainer 2026-10-08):** the context summary shows what the brief costs in tokens, and the host's own count of the agent's whole context when an adapter reports it. There is no share, meter or clipped warning; `budget` is an internal page size, and a brief longer than one page continues on the next read.
2. **The board fills itself (later, opt-in).** Scheduled after 1.0 and off by default: files, diffs and test output fit coding sessions, not PM boards, so a board opts in and the projection lands collapsed. Nobody on the panel proposed this and it is the cheapest radical move available: stop requiring the agent to remember to call `canvas_node`. A Claude Code hook, the Copilot extension and the Codex heartbeat project the session onto the board, meaning files touched, diffs, test output and the plan, into a session lane the human then curates from abundance. Today a node exists only when an agent decides to write one.
3. **Author on every node.** The `nodes` table has no writer column. Source provenance is persisted in node data (`canvas-provenance.ts`: where the content came from and how it refreshes), but who wrote a node lives only in the in-memory mutation history, which dies on restart. Add `author`, human or agent id, beside the existing provenance rather than as a second provenance system. The compiler ranks human-written above agent-written, the board can show who wrote what, and a shared board needs it later anyway.
4. **Measure the thesis.** Until this exists, "pins shape the agent's context" is a belief, not a finding. Two questions, measured separately because they fail for different reasons:
   - **Delivery: does the brief reach the agent?** Record which resources each agent session reads and whether the pinned nodes were in what it read, per host. A miss here is plumbing (the skill, an adapter's per-prompt injection, the MCP client), and the answer is to fix the adapter, not to doubt the thesis.
   - **Effect: when it arrives, does curation change the work?** One fixed eval under `docs/evals/`: the same task, with the brief delivered, on a curated and an uncurated board, scored on criteria written before the first run. With one real user, real sessions cannot carry statistical weight; the eval is the test, and real sessions only confirm or contradict it.

   **Continuous improvement, not a verdict (decided with the maintainer, 2026-10-07).** The eval ([curation-effect](evals/curation-effect.md)) is a benchmark rerun on every release that touches the brief, pins, budgets or adapters. It tracks the curation gap (curated minus uncurated score, delivery confirmed): changes to the brief and attention features are judged by whether the gap grows, a release that lowers it is a regression, and each lost rubric line feeds the improvement backlog. This replaces the 2026-09 one-off decision rule.

## Part 2: The shape I believe in

Sixteen moves, numbered from the one the evidence demands first. Move 3 was rewritten and move 6 split after the maintainer's decisions on 2026-09-06; move 0 was widened and moves 11–14 added after the decisions on 2026-09-23; moves 5 and 7 record the decisions of 2026-09-24. Each carries the panel's strongest objection and my answer, because several of them changed the move.

### 0. Many boards, and boards are the wiki (M, then M, then L)

The move the evidence demands before any other. A workspace holds many named boards, switchable from the top bar and addressable from every transport (`board` on the MCP session, `--board` on the CLI, one journal per board once move 4 lands). A new session starts on a board the human chose or created; test runs get their own boards; nothing is overwritten. Recovery for the maintainer today: the nine real boards above can be restored from snapshot history into named boards in an afternoon. Deletes nothing.

**Decided with the maintainer, 2026-09-23: boards are the wiki.** No separate knowledge store is built; the boards link and nest into one. The full design is in the [review's sketch](product-vision-review-2026-09.md#design-sketch-boards-are-the-wiki); in short:

- **Folders, not levels (decided 2026-10-06).** A board lives in one folder, the hierarchy people and agents browse (Home's library tree, `category` on `canvas://boards`). Links are not a tree: portals (board-link cards), `[[Board]]` links and cross-board card links stay a many-to-many graph that the agent navigates through each board's links and backlinks on `canvas://boards`, that the brief follows (linked boards before same-folder ones), and that the Map and Graph draw. Derived levels from portals are dropped: a link added elsewhere never moves a board in the tree. The two can disagree (a board filed in Planning whose links all point into Research); the Map shows that rather than forcing them to match.
- **Home and levels (superseded by the line above for the tree; links unchanged).** *Revised 2026-09-27: Home is not a board but the view shown when no board is open, listing your boards most recent first and filed in categories the human (or an agent) assigns ([plan 012](plans/plan-012-many-boards-stage-1.md)); boards no portal links to form the top level. Categories are the library's first human-made structure, so the cross-board brief (Part 1, item 1) should rank boards in the open board's category above the rest.* Originally: Home is the board a workspace opens on (level 0). A **portal**, a new `board` node type, is a card that stands for another board, and a board's level is its shortest distance from Home through portals. Levels are derived, never stored; there are no fixed tiers; a board may sit under several parents; cycles are allowed; boards no portal reaches appear in an "Unplaced" lane.
- **Links.** Portals, plus `[[Board]]` and `[[Board#Card]]` in markdown cards, resolved to ids on save so renames do not break them. Unresolved links offer "Create board"; every board lists its backlinks. Portals render text only (title, README summary, last touched, pinned card titles), never a live board, so nesting cannot multiply iframes.
- **The board map is a board.** A generated board of boards and links, built like the code graph (`boardmap-` auto-edges, out of history, debounced), with positions the human drags kept. Pinning a board on the map pulls it into the brief (Part 1, item 1). Map pins are workspace-level: they belong to the library, not to the map board, so they feed the brief whichever board is active. It is called the board map to avoid confusion with the `graph` chart node type.
- **A changed connection is marked on the connection (decided with the maintainer 2026-10-08, option C of [LinksOptions](design/LinksOptions.dc.html)).** Text and links are tracked apart per card. A link a person adds or edits says "not seen by <agent>" on its pill until a brief carries either end; a link an agent drew says "by <agent>". The agent is whichever agent is attached (Claude, Codex, Copilot or any other), never a fixed name. Cards keep their read marks; only a text change is amber ("changed"), and the context panel lists "links changed" in neutral. A link change still reaches the next brief through the card's links revision.
- **One relation graph, two readers (decided with the maintainer 2026-10-07).** The canvas is the agent's extended memory across cards and boards, so the relations are one projection with two readers. Its nodes are boards and cards; its edges are portals and `[[links]]`, card edges and cross-board card links, with folder membership for grouping. Home's Graph view ([HomeGraph](design/HomeGraph.dc.html)) draws it for the human, with what is in the agent's context marked and a "local graph, depth N" around the focus. The agent reads the same projection as `canvas://graph{?focus,depth}`: the local graph around a board, a card or the pins, each node with its title, short summary and in-context mark, and ids that `canvas_node`/`canvas_board` pull in full. The brief (Part 1, item 1) is this graph's depth-1 neighbourhood of the open board and its pins; the agent walks further through `canvas://graph` and decides what to read. One projection, built like the code graph, so what the human sees and what the agent navigates cannot drift. Ships with wave 2's Map and Graph.
- **Growth by gesture.** "Make board" turns a group into a board and leaves a portal; "Inline board" reverses it. Group, board and board of boards are one scale.
- **Search across boards.** The ⌘K palette searches the whole library, not just the open board: board names, README summaries, card titles and card text, with the board each hit lives on. A wiki a human cannot search is a pile; the agent's `canvas_query` search gains the same library scope.
- **Backup.** Once boards are the wiki, `canvas.db` holds the whole library, its history and its snapshots in one file. `pmx-canvas backup` writes a consistent copy (`VACUUM INTO`, safe while the server runs) to a folder the human chooses, keeps the last N, and runs on a schedule the human sets; `pmx-canvas restore` brings one back. It is a local file, so the no-externals rule holds. The per-board folder export in move 4 is the human-readable companion, not a substitute.
- **Agent surface.** `canvas://boards` (the library: README summary, folder, links, backlinks, last touched; levels dropped 2026-10-06), `canvas://graph{?focus,depth}` (the relation graph above, local around a focus), a `board` target on every operation with the MCP session bound to one board, and a `canvas_board` composite (22 → 23 tools, with the freeze test and all four transports updated together).
- **Data.** A `boards` table, `board_id` on nodes, edges, annotations, pins and snapshots, and a `board_links` projection rebuilt from portals and parsed links. The README summary is a flagged card, not a field.
- **State, in two stages.** Stage 1 (M, not S: `board_id` on five tables, snapshots scoped per board, a `board` target on every transport): one active board per server; opening a board saves and loads; other boards are read straight from SQLite; agent writes to a non-active board are refused. Only the human changes the active board, so an agent never swaps the board the human is looking at: an agent may create a board, its session binds to whichever board is active when it starts, and a session that needs another board asks for the switch with an ask card. Stage 2 (L): state managers keyed by board, after the journal, so an agent can work on one board while the human looks at another. `CanvasStateManager` is a singleton with 400+ call sites, which is why stage 2 waits.

Objection: none, the panel did not see it. Risk: the wiki sprawls. Mitigation: the Unplaced lane and staleness on the map (move 13) make neglect visible instead of silent.

### 0a. Board pins: a working set across boards (S–M)

**Decided with the maintainer, 2026-10-05.** Pinning works at two levels with one gesture and one look. Pin a card and it goes first in the agent's map; pin a board and the whole board joins the agent's working set, wherever it sits in the library. This replaces "pinning a board on the map" above and settles the review's open question of board-level pins versus map pins: there is one board pin, set from Home (folders, map or graph), the board switcher, a portal card or the open board's top bar.

- **What the agent gets.** The brief is a map, not a dump (decided with the maintainer 2026-10-07: "the canvas is an extended memory across cards and boards; the models are smart enough to decide"). It carries the open board's overview, then every card as title + short summary with why it was pinned and its relations, pinned cards first and the cards near them next; each pinned board as a map (README summary, folder, links and backlinks, its pinned cards as summaries); then linked and same-folder boards as discovery. The agent pulls whatever it decides to read in full; a summary is "seen", a full pull is "read".
- **Lifetime.** Board pins belong to the workspace: they survive board switches and restarts and are removed only by a person or an agent, attributed like card pins.
- **Read, not write.** A pinned board is context. Writes still target the active board (stage 1); a board pin never widens what an agent may change.
- **Agent surface.** `canvas://pinned-context` gains a pinned-boards section; `canvas_board` gains `pin` and `unpin`, with the HTTP route, SDK method and CLI command kept in step. Read instrumentation (`context_reads`) already records the board of each read, so "read / not read yet" works per board.
- **Data.** A `board_pins` table: board id, who pinned, when.
- **Design.** Wave 1 of [design.md](design.md); drawn on the BoardPins and Home boards.
- **Deferred from the 0.9.0 tech-debt sweep (2026-10-08).** The context chip asks for each pinned board's read status with one request per board. Batch it into one request when the Home redesign lands, which needs the same per-board read data.

### 1. One read, one brief (M)

Above. **Every node type has a text form that carries its meaning.** The brief can only be as good as what each node says about itself. `summarizeNodeForAgentContext` (`src/server/agent-context.ts`) gives every type a text form today, but for the rich kinds it carries structure, not meaning: a graph passes its raw config JSON, an MCP app its tool input (nothing about what an Excalidraw drawing shows), an image its URL, an HTML deck whatever summary its author supplied. The requirement: each type states what it shows or claims in a few sentences, written by the agent that creates or updates the node and refreshed with it, with a mechanical fallback where none exists. A check per node type asserts the brief form of a sample node is non-empty prose, not a config dump. A board rich for the human must not be blank to the agent, or "one surface" is only true for markdown. Objection: ranking by "the human's camera" rests on a signal the product does not have; the server holds one global viewport that agents also write via `view.fit` and `view.focus`, so a camera ranker would rank the agent's own last focus. Accepted. The camera rides the per-tab human-presence heartbeat, viewport writes get an actor like every other write, and the camera is a weak tiebreak, never the primary axis. Primary axes: pins, delta since last read, author, recency.

### 2. The session projects itself onto the board (M)

Above. Objection: none raised; the panel missed it. Risk: noise. Mitigation: the projection lands in its own lane at low rank; the compiler's tiers keep it out of the brief unless pinned or recent.

### 3. The agent's output moves onto the board (M)

**Decided with the maintainer, 2026-09-06: the fleet features stay.** They are new, deliberate capability, and the same rule that protects the node types protects them. Scope fences, consumer keys, the `pump`, parent rollups, census chips, addressed versus broadcast steering and per-consumer delivery are all kept as they are. What follows is a relocation, not a cut.

The problem this move solves is one surface too many. When the agent opens a work item, raises a gate, asks a question or files evidence, it lands in a side table that the canvas cannot show. The human reads it in a panel while the board, the surface built for exactly this, stays blank about it. Two side effects follow: deleting a node forces the server to re-anchor orphaned items, and the panel and the board have different lifetimes, since canvas-bound state rides snapshots while the timeline does not.

So the agent's output becomes nodes. A work item is a `status` node carrying the work state. Approval gates, elicitations and mode requests become one new `ask` node with a typed answer that records who gave it (move 7). Evidence is a node or a file node. Every gesture that already exists then applies to agent output: drag it beside the file it concerns, group it, pin it, connect it to the diff that raised it. Nothing to re-anchor, because the item is the node. One lifetime, because there is one surface.

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

**Decided with the maintainer, 2026-10-05, replacing the 2026-09-24 decision: the workbench has no single reference width.** It lives in narrow agent-host panes, the resizable side browser in the Claude desktop app, and full browser windows of any size. The gate checks three widths in Chromium: 600 px (the narrow end), 1024 px (the middle, between the layout breakpoints) and 1920 px (a full window). Every node type must paint at all three or the release does not ship. (The 2026-09-24 decision made 600 px the one reference surface.) It is nearly free and covers the Claude Code and Codex panes and full windows, and Chromium is also the engine a hosted version would target first. What it misses is WebKit, where the Copilot app pane (the maintainer's host) and most black-tile rounds live, and which every iPhone and Safari viewer of a shared link will use. Those stay best-effort behind the visible fallback and retry. Recommended trigger for adding a WebKit project to the gate: whichever comes first of Part 3 step 2 (the read-only link) or the next WebKit-only bug that reaches a release. The compiled-binary window is not an option today: headed `Bun.WebView` is not implemented ([`bun-webview-integration.md`](bun-webview-integration.md)).

Deletes: the `ExtAppFrame` recovery machinery, two of three AX-bridge copies, five per-type iframe implementations. Capabilities removed: none. Every deletion the earlier version of this move argued from "zero real uses" was withdrawn once the real boards surfaced; what remains is argued from cost and incident count only.

### 6a. Make the tool surface cheap (S) — ready to ship

Measured on this tree, `tools/list` is 49,222 bytes across 22 tools, about 12,300 tokens that every agent pays on every session before it does anything. Two tools account for a fifth of it: one advertises 51 optional properties, another 49, because a composite flattens four actions' fields into one schema. Per-action requirements exist only in prose, so a call missing a required field passes validation and fails in the handler.

Nothing structural is needed to fix most of that. Ship per-action schemas where hosts support them and a `canvas_help { op }` that returns one operation's schema on demand, so an agent loads what it uses instead of the whole surface. Add `session.start`, returning workspace, brief and inbox in one round trip, so a useful first session is about five calls. Fix the two live descriptions that are wrong today, and add the test that an action summary always equals its own action list. Bound every agent read by a page size, which is Part 1's one read.

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

**Superseded 2026-09-26 (see below).** ~~Decided with the maintainer, 2026-09-24: the human answers, the requester can withdraw.~~ Approving, rejecting and answering (gates, elicitations, mode requests) are human-only. A new `withdraw` lets the agent that raised an ask close it while it is still open, with a distinct `withdrawn` status that never counts as approval, so an orchestrator can tidy up at the end of a run. Every agent-facing resolve path becomes withdraw: the `canvas_ax_gate` resolve action, the CLI resolve commands, and the Copilot extension's `resolve_approval` tool (which becomes `withdraw_approval`); the orchestration skill's "resolve gates" step becomes "withdraw open gates". This matches the orchestration skill, which already treats gates as human decisions, and removes the one tool that invited self-approval. In practice the tool matters more than the secret: an agent handed `resolve_approval` will use it. The approval flow sees little real use on the board today, so the change is cheap now.

**Decided with the maintainer, 2026-09-26: approvals are attribution, not a lock.** The real gate on what an agent may do is the harness it runs in (Claude Code, Codex and Copilot permission prompts); the canvas cannot stop an agent, and a PMX gate only works because the agent chose to ask and chooses to honour the answer. Board gates matter as the visible ask when the human is watching the board, as work coordination where an orchestrator approves its workers' asks, and as the record afterwards. A human-only lock would break the second, so any writer may answer. The defect is that today an answer does not say who gave it, so a self-approved gate reads the same as the human's. The fix: every answer records who resolved it, the human (proven by the boot secret the workbench HTML carries) or the agent's source and id, and the session panel, `await` results and the timeline show it; an agent answering its own ask is marked as a self-answer, not refused. No withdraw is needed: the requester can simply reject its own ask. This is the same idea as author on every node (Part 1, item 3), so it ships with it in 0.8; the rest of the S half (`res.ok` toasts, the redirect filter) shipped for 0.7.

Then: file nodes are confined by default to the workspace plus explicit allow-roots (persistence hygiene, since every host already gives the agent `cat`); the webpage fetcher follows redirects by hand and refuses any hop that moves a public fetch onto a loopback or private address, and refuses link-local (cloud metadata) addresses on every hop, while a URL the caller points at a local dev server on purpose still loads; the client bridge checks `res.ok` and shows the toast on a refused write. One reservation I am not settled on: the real boards carry file nodes for documents (weekly prioritization reports) that may live outside any repository, and default confinement would have refused them; the default should probably be a per-board allow-root list that includes the folders a PM board actually reads, not the workspace alone.

The same mechanism gives the product its own remote story, without relying on anything external. A loopback-only server means Claude Code cloud, Codex cloud and the Copilot coding agent, the agents that run longest unattended, cannot reach the board at all. With per-writer tokens minted by the server (human tokens served only to the workbench, agent tokens issued per session), the server can bind beyond loopback deliberately (`--listen` plus a token), and a remote agent is just another authenticated writer. No relay, no sync service, no version-control detour. The same tokens carry the read-only share link, the second step of the sharing path in Part 3; the first step, static export (move 11), needs none of this.

Correction to my own review: a human's write cannot hit the 403 fence or the 409 lock, both sit behind `if (!meta.fromWorkbench)`; the silent-failure defect is real but smaller than I wrote.

### 8. Ship a binary and a one-screen README (S)

`bun build --compile` works today: 0.5 s, 66 MB, `bun:sqlite` unmodified, verified by the panel. Release binaries per platform and an npm package that is an installer. The 227 tracked `dist/` files stop being committed. The README becomes the thesis, one scenario showing both directions, Quick start, `smoke`, and a two-minute GIF. The net-negative release rule proposed here (60 days from 2026-09-05) is withdrawn on 2026-09-23: it was not applied in 0.6, and the added moves 0 and 11–14 add before anything is removed. Its intent survives as the sequence's "done when" checks and as move 5's deletions.

### 9. Render for the pane you live in (M)

The workbench runs at any size: a 500 to 600 px panel inside Claude Code, Codex and Copilot, the resizable side browser in the Claude desktop app, or a full browser window (updated 2026-10-05). The narrow end is the hard case, not the only one. Viewport culling, `content-visibility`, lazy iframe mount, and a live-frame budget. Objection: the thumbnail-eviction pipeline I wanted does not exist (no clip support, capture is macOS-only). Accepted: no thumbnails; culling, lazy mount and the frame budget are move 5's frame host doing its job. Move 5's reference cases run at 600, 1024 and 1920 px, so "works" means "works in a narrow pane, in between and in a full window". The e2e gate used to run only at 1440×900 (`playwright.config.ts`); the 600 px project added the narrow end.

### 10. CLAUDE.md and AGENTS.md become one contract, the incidents become checks (S)

Both files stay, because different agents read different files (Claude Code reads CLAUDE.md; Codex, Copilot and Amp read AGENTS.md), and they stay byte-identical under the CI gate that already enforces it. Each becomes the same 120-line contract; the AX design reference moves to `docs/ax.md` and is linked from both; each "this shipped N times" paragraph becomes a test or a Biome rule where an oracle exists. Objection: the ten-time black-tile class has no executable oracle (Playwright is Chromium-only). True, and move 5 replaces the oracle ladder with a paint deadline and a visible fallback, which a test can assert; the WebKit Playwright project, when move 5's trigger adds it, covers the rest.

### 11. Static export: the first step to sharing (M)

A self-contained HTML file of one board: the renderer and the board's data in one file, read-only, with pan, zoom and card expand. It can be attached to an email or a chat message, or posted to a wiki page. No server and no authentication, and the app produces the file itself, so the no-externals rule holds. Iframe-backed nodes export their stored markup in sandboxed iframes, as they render today; a node whose content cannot be inlined (a live MCP app) exports as its last screenshot where capture is available (macOS today, see move 9) and otherwise as a labelled placeholder.

An export is a share, so Part 3's per-board rule applies to it. Portals export as locked cards with no title or summary unless the owner includes the linked board; file node contents, which come from disk, are included only when the owner opts in; the export dialog lists what leaves the machine before the file is written. This is the fastest route to a second user: the recipient needs no install and no Bun, the live board has a "Workshop flow" card, and exporting it for the workshop's participants is the first real test. The second-user milestone therefore moves from 1.0 to the release that ships export.

### 12. Tours: the board is the presentation (M)

Five of the real boards include agent-generated HTML slide decks, one with 15 slides, rebuilding as slides content that already existed as cards. A tour is an ordered path through a board's cards, seeded from the reading order `spatial-analysis.ts` already computes and editable by the human. Arrow keys move the camera card to card, and the current card fills the screen. Tours carry into exports and share links, so presenting and sharing are one feature. HTML decks stay as a capability; they stop being the only way to present.

**Deferred from the 0.9.0 tech-debt sweep (2026-10-08), to clean up together right after 0.9.0:** a tour's camera move saves every node's layout instead of only the viewport (`commitViewport` → `persistLayout` from the SSE camera handler) and re-reads the whole layout (`tour-control.ts`); `animateCameraPath` duplicates `animateViewport` (`canvas-store.ts`); the current-tour logic is repeated in `tour-control.ts`, `index.ts` and the viewport operation; and the SDK's `getTour()` does not return the tour position the HTTP and MCP surfaces do. They came with the tours work, not the context work, and are kept out of 0.9.0 so it does not also change tour behaviour.

### 13. Context lifecycle and recipe cards (M, then later classification)

**Direction revised with the maintainer, 2026-10-07; planned, not implemented.** Every knowledge document has a lifecycle, including Markdown cards derived from imported sources. Use the maintainer's [context-decay framework](https://github.com/pskoett/pskoett-ai-skills/tree/5a836dc7163da6799fe34ed4283da6d7f0358f14/skills/context-decay): context loses usefulness in different ways, not at one universal half-life. Its rates are qualitative planning judgments, not probabilities that a claim is true.

- **What can decay.** Reality (facts change), decisions (superseded choices), dependencies (versions, owners or prerequisites change), and relevance (the task changes). A document can contain several claims with different authorities and review triggers; reviewing one never validates them all.
- **When to check.** Fast means check at use; medium means source-appropriate cadence plus event triggers; slow means maintenance or resumed work; durable means no passive expiry. Contradictions, superseding decisions and dependency changes trigger review regardless of age. Each category can supply defaults, with explicit document or claim overrides; unclassified context stays visibly unknown rather than receiving an invented expiry date.
- **Separate the clocks.** Last delivered/read by an agent, last content change, last evidence validation, and relevance to the current task are distinct signals. Reading, quoting, editing or running maintenance does not renew validation. Wave 1's read marks measure delivery and revision currency, not comprehension or truth.
- **Record the evidence.** Keep stable document/claim identity, authority, owner, decay type/rate, revalidation method and triggers, last validated time and evidence, review outcome, and whether that outcome has been applied. Unavailable evidence leaves the review unresolved and preserves the previous validation record.
- **Review outcomes.** Retain, revise, externalize to a maintained source, retire from active context, or leave unresolved. These are review dispositions, not an automatic age-driven state machine. Preserve sources and history; low use alone never retires a rare safeguard. Amber means “needs review,” not “false.” The brief carries that qualification rather than silently presenting stale context as validated.

The real boards are full of numbers from elsewhere: 13 metric charts, developer-experience metrics, an OKR mirror card on the live board. Provenance (`canvas-provenance.ts`) already records a source and refresh strategy for files, URLs, images, apps and artifacts; add one source kind, the **recipe**: the tool call and prompt that produced the card, recorded when an agent writes it. The canvas flags review needs from the lifecycle policy and changed sources; the board map shows them separately from last-touched time. “Refresh this board” hands relevant recipes and review reasons to the attached agent. A recipe is data, never executable instructions: refresh runs only when a human asks, and the agent may decline it. Regenerating a card is not by itself evidence validation.

**Decided model, 2026-10-07** (drawn in `Categories`, `CategoryEditor`, `Lifecycle`, `Lifecycle600`, `Restore` and `LifecycleVariants` in [design/](design/)):

- **Category is a property of a folder,** not a second taxonomy or tag system. Folders stay the one hierarchy (move 0).
- **It inherits down the tree.** A board filed under a "Decisions" folder gets that category and its lifecycle defaults without anyone tagging it; a subfolder may set its own.
- **One category list per workspace,** edited by the workspace. The product ships editable defaults and starter templates (org · team · personal, solo research, product team, empty); none of those words is hard-coded.
- **A card may override its lifecycle, never its category.** Category is set at folder (or board) level only.
- **Categories carry no colour:** a glyph and a word, like node kinds.
- **The board shows only "⧗ review due"** — on the card, with a short reason, only while a review is due (variant A). Rate, decay type, inheritance, the four clocks and review history live in the card's Lifecycle tab and in folder settings; "unknown" is reported per folder on Home, never per card. A healthy card shows no lifecycle line. "Review due" (outlined ⧗) and "changed since read" (filled △) are both amber and differ by glyph, word, fill and place.
- **Retire is reversible.** Retiring removes a card from the brief only; the card stays dimmed on the board, searchable as retired, with its history. A person restores it from the Lifecycle tab; restore is recorded and is not a validation.

**Model-independent first.** Categories, lifecycle metadata and review outcomes are ordinary app data, editable by people and through the existing agent interfaces. They need no classifier, particular model or external inference service. Routine private knowledge maintenance can happen during agent-assisted work, with attribution and reversible history; publishing to a wider audience remains a separate explicit action.

**Optional later: typed decision assistance.** [Typesafe's Jev](https://typesafe.ai/) is a reference for bounded classification and scoring, not a required runtime or a folder model. A future replaceable classifier could suggest a category, decay type/rate or review priority from supplied evidence, returning typed choices or rubric scores with uncertainty where supported. Low-confidence or conflicting suggestions remain for review. Classification confidence is neither evidence that the content is true nor permission to publish it. No model integration is required to ship the structure or lifecycle; external inference would need explicit configuration and consent for the data sent.

### 14. New board from this board (S)

The same OKR board appears in April and again for C4. "New board from this board" copies the structure (groups, the README card, recipe cards) without the content and links the new board to the old one as its previous board. Recurring work forms chains on the board map without anyone filing it, "what changed since the April OKRs?" becomes answerable, and any board becomes a template for the next.

### 15. Drop documents to make board context (M, agent-assisted v1 in 0.7.0)

**Direction decided with the maintainer, 2026-09-27.** A human drops a PDF, PowerPoint deck, Excel workbook or other document onto the board to bring its knowledge into the work. The default outcome for supported documents is readable, editable Markdown cards, searchable and available through the same context path as authored cards—not a filename, binary text or an opaque attachment. Keep image and file nodes as capabilities; Markdown is the context representation, not a replacement for the original source.

The current checkout implements the first, explicitly agent-assisted path. A PDF
or Office drop stores the original (maximum 20 MiB) as a board attachment; it
does not convert the file or launch an agent. A human explicitly consents and
requests help from the connected agent, which reads the controlled HTTP bytes
or inline base64 at 2 MiB or below, then submits sections, references, warnings,
and an `agentDescription` for human review. A remote host may need manual byte
transfer. Draft submission can complete while another board is active, but the
captured source board must be reopened to commit. This implementation is
verified and included in 0.7.0; see the status table above.

Longer-term extraction targets, not guarantees of agent-assisted v1:

- **PDF:** extract text with page references and preserve useful headings and tables where reliable. Scanned pages need an explicit OCR path; absent extraction must say "OCR required", not silently succeed with an empty card.
- **PowerPoint (`.pptx`):** preserve slide order, titles, body text and speaker notes with slide references. Flag diagrams, charts and other visual meaning that extraction cannot represent.
- **Excel (`.xlsx`, with CSV as a simpler companion):** preserve sheet names, headers and cell values as Markdown tables, with sheet/range references. Do not silently drop sheets, clip large tables, execute macros or pretend to recalculate formulas; disclose cached values and missing results. Legacy `.ppt` and `.xls` support is a separate explicit format decision.
- **Other documents:** add formats such as DOCX through the same path as converters are validated. Unsupported, encrypted or damaged files get a clear per-file result; never decode arbitrary binary bytes as text.
- **Dependency footprint:** the maintainer prefers no new required dependency. Reuse the existing runtime and libraries first; MarkItDown and Defuddle are references, not selected dependencies. PDF/Office conversion must still be reliable. Any optional converter installation or required new parser needs an explicit tradeoff, not a hidden setup requirement.
- **Readable at 600 px:** show per-file progress, cancellation and conversion warnings. Keep small documents together; split larger documents by sections, slides or sheets into a labelled source group rather than flooding the canvas. Offer a preview of the split and equivalent picker controls for users who cannot drag files.
- **Source and freshness:** retain the original as a board-owned attachment and record filename, content hash, import time, converter and page/slide/sheet references using existing provenance. Extraction is distinct from an optional agent-written summary. Re-import must not overwrite human edits silently; offer an explicit replacement or a new version.
- **Local and bounded:** convert locally by default, with file, expanded-archive and processing limits. Treat imported text as source material, not executable instructions. External conversion or OCR needs explicit consent. Export must disclose imported content as well as original attachments; extracting a document must not bypass file-content sharing choices.

Agent-assisted v1 bundles no converter or OCR and therefore does not guarantee
PDF/PPTX/XLSX coverage, scans, charts, diagrams, or any host-specific format.
The original remains until board deletion, survives snapshot restore, and is in
database backups. Static export v1 never includes original bytes; source-linked
Markdown stays classified after editing and requires `includeDerivedText=true`,
separately from `includeFiles`.

**Done when:** representative files processed with named host/tool combinations
produce reviewable, source-linked Markdown; the content survives restart,
appears in library search and reaches pinned agent context. Verification covers
partial/unavailable extraction, oversized inputs, cancellation, board switching,
and export choices. A visible card alone is not proof that meaning survived.

### The payoff nobody asked for

With one journal, a **time scrubber** replaces snapshots, the History drawer, and diff: drag a slider and watch the agent's work unfold on the board. With one brief, an **attention heat** on the board, and on the board map across boards, shows the human exactly what the agent will read next, so looking and pinning become visible tuning. Those two are the demo. They are also the two-way surface at its most literal: you see what the agent sees, and you see what it did.

## Part 3: Long term, share this board

**Decided with the maintainer, 2026-09-23; scope clarified 2026-10-10:** this phase delivers "share this board" through local and self-hosted sharing. Part 4 adds the first managed hosted offering after the team features. Hosted multiplayer competes head-on with established whiteboard products that have teams, funding and their own MCP integrations. What they cannot easily be is local-first, host-agnostic, and inside the agent's pane in Claude Code, Codex, Copilot and Amp; that is where this product wins. A PM board is something its owner presents to colleagues, so sharing grows from that, one step at a time, and each step is justified only by someone using the one before it.

| Step | What it is | Needs first |
|---|---|---|
| 1. Export | A static HTML file of one board (move 11), carrying its tour once move 12 lands | nothing |
| 2. Link | A read-only share link: `--listen` plus a board-scoped read token | move 7 in full |
| 3. Comments | Viewers annotate and reply; comments are cards addressed to the owner | author on every node (Part 1) |
| 4. Second writer | Another human writes to a shared board, with their own agent | the journal (move 4), concurrent boards (move 0, stage 2) |
| 5. Accounts | Per-board roles (read, comment, write, answer asks), single-tenant; org, team and personal knowledge scopes | a team using step 4 |

**What Part 2 already buys.** The journal (move 4) is the sync model: an ordered log with sequence numbers, per-consumer cursors and inverse patches is exactly what multiple clients need, and node-granular edits with compare-and-set on the node version resolve concurrent human edits without operational transforms or CRDTs. Per-writer tokens (move 7) become per-user credentials; author on every node (Part 1) becomes attribution; presence is already multi-writer with identity colors; the ask node with an attributed answer becomes an ask addressed to a person or a role.

**Sharing is per board.** Sharing a board never shares what it links to. A portal to a board the viewer cannot see renders as a locked card with no title, and the viewer's brief never reaches past what they can see. This is where the [context vision's](product-context-vision-2026-09.md) publication and audience rules apply: an automatic derivative's audience cannot exceed its inputs', and publication is an explicit act, not a side effect of summarizing.

**What is genuinely new at step 5.** Step 5 is a team server: the same binary run with `--listen` on a machine the team reaches, one store per team, not a multi-tenant service. Identity is the app's own (passkeys and email, federation optional later). If that server is not the owner's machine it has no workspace on disk, so file nodes become uploads with re-upload in place of the watcher. The brief is compiled from the attention of the people in an agent's session, not everyone's, so two people can work one board with different agents without steering each other's context.

**User-defined knowledge scopes (revised with the maintainer, 2026-10-07).** This extends the 2026-10-05 workspace/personal decision. A workspace defines its own levels and categories; org → team → personal below is the example template, not a fixed structure, and nothing in the product hard-codes those words. Categories are folder properties with one list per workspace (move 13, decided model). The hierarchy organises Markdown knowledge on boards; SQLite remains authoritative and boards remain the wiki. A readable folder export represents that structure, not a second independently editable knowledge store.

- **Org** — shared organisational context, such as strategy, principles and policies, filed in categories the organisation defines.
- **Team** — team-owned context, such as objectives, decisions and research, with its own category set and links to relevant org knowledge.
- **Personal** — each person's working knowledge, private by default, with categories they control. Personal interpretation can link to shared sources without duplicating or silently overwriting them.
- **Categories are configurable, not inferred prerequisites.** The workspace defines one category list; folders at any level take a category, subfolders inherit it, and lifecycle defaults can be overridden per folder or card (move 13). People or connected agents can file context without a classification model. A board still has one folder; links remain many-to-many. Category names and folder ancestry do not grant access or establish truth. Authority depends on the claim: org policy, team decisions and personal experience have different sources; conflicts remain explicit.
- **Crossing scopes is deliberate.** Sharing or moving private knowledge to a team or org audience is an explicit publication action, with the destination and sources reviewed. A link, pin, agent write or summary never widens access — the [context vision's](product-context-vision-2026-09.md) audience rule: a derived item never reaches a wider audience than its sources without an explicit authorised publication review.
- **Links are safe in every direction.** A portal or `[[link]]` to unreadable knowledge shows a locked card with no title. A folder's place under org or team never makes personal descendants public; step 5 needs app-enforced membership and per-board roles, not folder-name permissions.
- **Pins and the brief are per user.** Card pins and board pins (move 0a) become each user's own working set: on a shared board, my pins steer my agent, not yours. The board's README stays the shared default. A user's brief draws only on knowledge they can read across these scopes, never on another user's private boards.
- **Agents act as their user.** An agent session belongs to one user and has exactly that user's read and write rights across scopes.
- **Stage the delivery.** Local category folders and lifecycle metadata need neither accounts nor a model. Shared org/team membership, private personal libraries and publication enforcement arrive with step 5, not with Wave 1. Typed classification assistance is a separate longer-term option (move 13), never a prerequisite for either stage. Home, Map and Graph need updated drawings before these scope views are built; the existing two-root HomeTeam drawing is an earlier look ahead.

**The vision it enables.** A quarterly OKR board with the PM, the team leads and each of their agents on it, every card attributed, every ask answered by the person it was addressed to, and the time scrubber showing how the plan changed and who changed it, reached from a link the PM sent after the workshop.

**The constraints that hold.** Local and self-hosted PMX need no required externals: history and sync are the journal, not a third-party service. Everything in move 7 is mandatory before step 2 opens a port, and MCP-app hosting of third-party apps needs a per-board allowlist once viewers are not all the owner. Org/team/personal scopes do not themselves require multi-tenant hosting or an enterprise governance engine. The first hosted offering follows these team features in Part 4.

## Part 4: First hosted validation — ChatGPT Sites and plugin distribution

**Direction decided with the maintainer, 2026-10-10.** After the team features
in Part 3, aim to deliver the first hosted version of PMX Canvas in **ChatGPT
Sites**, with **OpenAI login**. The **MCP server is hosted there as well**, so
users can reach their boards and context without running a local PMX process
or a private tunnel.

This hosted foundation enables full development and release of the **ChatGPT
plugin**, the first distribution channel for reaching users and testing whether
PMX becomes part of their work. Validate the ChatGPT experience and adoption
before investing in the full standalone hosted service in Part 5.

Other agents should eventually be able to connect directly to the same hosted
MCP endpoint through **OAuth using the user's OpenAI login**. Both paths act
as that user and respect the same board roles, knowledge scopes and personal
privacy established by the team features. External-client OAuth is a separate
compatibility goal; its current blocker does not prevent validating the
ChatGPT version and plugin distribution first.

**Technical validation:** a user signs in with OpenAI, creates a durable hosted
board, and uses it through the ChatGPT plugin. Installation, account connection,
rendering, context synchronisation and reconnect behavior work for the declared
supported surfaces. Record node and integration limitations explicitly.

**Product validation:** people beyond the maintainer install the plugin, use
boards for real tasks and return to them across sessions. Gather evidence of
which workflows they keep using and where the ChatGPT/Sites experience limits
them. A successful deployment or a one-off demo alone does not justify Part 5.

### Hosted product metrics

**Decided with the maintainer, 2026-10-10:** the first hosted version needs
product usage metadata and an owner/admin dashboard from the pilot onward.
The maintainer must be able to see user numbers, overall usage, feature
adoption and evidence of where PMX provides value. The metadata must also
support continuous improvement of the whole project: product decisions, UX,
reliability, performance, node capabilities and agent-context quality across
local, ChatGPT and full hosted distributions. Carry the same metric
definitions into the later full hosted version so results remain comparable.

| Question | Product metrics |
|---|---|
| How many people use PMX? | Total registered users (first authenticated PMX use), new users, daily/weekly/monthly active users and active workspaces. Show selected periods and trends. |
| Do new users reach useful work? | Activation funnel: first authenticated use → first board created or opened → first meaningful human action or successful agent operation → return to that board in a later session. Show conversion and time between steps. |
| Do people keep using it? | Weekly retention by first-use cohort, returning users, boards revisited across sessions and retained active workspaces. Show cohort sizes and only evaluate return windows that have elapsed. |
| What do people use? | Boards created and actively used; node creation/use by type; imports, edits, pins, links, searches and shares; MCP tool calls and context reads. Separate human activity from agent activity and break down by known client/surface. |
| Does curation reach the agent? | Sessions with human curation followed by an agent context read; fraction of eligible read sessions that receive curated items; older-board context retrieved in later sessions. Keep delivery evidence separate from task outcomes. |
| Where is the value? | Repeat use of curated boards, reuse of earlier knowledge and optional task-level helpfulness/outcome feedback. Pair these signals with Part 1's controlled curation-effect evaluation; activity or correlation alone does not prove improved work. |
| What prevents useful work? | Failed operations, failed imports, reconnect failures and operation latency, grouped by feature and surface. Include stored bytes and uploaded bytes to understand usage and serving cost drivers. |

**Count people and activity honestly.** Define an active user as an authenticated
person with a meaningful product action in the period, such as an edit, pin,
search or context retrieval. Track agent-only activity attributed to a user
separately so autonomous loops do not appear as human engagement. Exclude
heartbeats, background polling and retries from engagement counts; report
anonymous visits separately. Distinguish the requesting person from the agent
session executing a tool. Installation counts belong in the funnel only if the
distribution platform supplies them; otherwise show first observed plugin use
and label unavailable acquisition data explicitly.

**Metadata contract.** Use a small versioned event vocabulary with an event ID,
server timestamp, pseudonymous user/workspace IDs, session and board IDs,
actor kind, known client/surface, operation or feature, node type where relevant,
success/failure and duration. Include product/build version, runtime and
structured error codes where relevant so regressions can be traced to releases
and environments; do not collect raw error payloads that may contain user
content. Link curation and context-read events through
scoped IDs and revisions without copying their contents. Use server-confirmed
events for completed operations and client events for visible interactions;
deduplicate retries and keep the two event sources distinguishable. Mark
maintainer, demo, test and automation traffic so it can be excluded. Unknown
clients and unobserved outcomes stay unknown rather than being inferred.

**Turn evidence into project improvements.** Make aggregated metadata available
through an authorized query/export interface as well as the dashboard, so the
maintainer and explicitly authorized development agents can investigate it.
Use a repeatable loop: identify a pattern, form a hypothesis, reproduce it with
synthetic or explicitly provided examples, make a targeted change, and compare
the relevant measures after release. Record the evidence, expected improvement
and verification in the issue or evaluation that drives the work.

Examples include simplifying an onboarding step where users stop, fixing a node
renderer with repeated failures, reducing latency on large boards, improving a
context adapter that misses pinned material, and turning recurring defects into
regression tests. Compare releases and cohorts with their sample sizes and
instrumentation coverage; validate causal claims with controlled evaluations
or experiments. Low use alone does not justify removing a node type, and hosted
usage does not represent every local workflow. Improvements to shared code
should benefit all distributions while keeping the local verification gates.
Analytics informs prioritization and evaluation; it does not automatically
change users' boards, rewrite the roadmap or grant agents access to raw content.

**Dashboard and data boundaries.** Provide date ranges, cohort views and
breakdowns by surface, feature and node type, with clear metric definitions,
denominators and collection coverage. Restrict product-wide analytics to the
service owner or explicitly authorized product admins; workspace admins see
only their own scope. Collect behavioral metadata, not board text, prompts,
file contents, titles, email addresses or credentials as analytics payloads.
Document collection, access, retention and deletion behavior before the pilot.
Local PMX keeps local SQLite and does not silently send usage to the hosted
service; any future local telemetry is a separate explicit opt-in decision.

**Acceptance:** known test journeys produce the expected user counts, funnel
steps and retention cohorts without double-counting retries or agent loops.
An authorized product admin can inspect real pilot usage and trace a metric to
its definition and contributing metadata. Verify access isolation and absence
of content/secrets in events. Report missing instrumentation as a coverage gap,
not as zero use. Product analytics ships with the ChatGPT pilot and supplies
the adoption evidence for the Part 5 decision. Demonstrate the improvement loop
with a reproducible test journey: query a known friction or failure pattern,
link it to a proposed fix and regression check, and compare versioned results.
Use the same loop on real usage as evidence accumulates.

The milestone follows the team features and retains local and self-hosted
distribution. The assessment below separates documented platform capabilities,
source-level portability and deployed verification; none is interchangeable.

### Platform evidence and OAuth validation

**Checked 2026-10-10.** Sites provides browser sign-in and forwards the visitor's
identity to server code. PMX must still enforce membership, board roles and
personal-library access. Sites also offers D1 for durable records and R2 for
uploaded files. These are documented platform building blocks, not proof that
the current PMX server runs there unchanged.
Sources: [Sites sign-in](https://learn.chatgpt.com/docs/sites#add-sign-in-with-chatgpt)
and [supported site shapes](https://learn.chatgpt.com/docs/sites#choose-a-supported-site-shape).

The installed **Sites plugin 1.0.1** documents a stateless JSON-RPC `POST /mcp`
endpoint declared through `capabilities: ["mcp"]`. Sites authenticates callers,
checks Site access and supplies a Site-scoped user ID. Publication provisions a
private plugin for ChatGPT/Codex and refreshes its tools on republication.
Its `get_site(include_mcp_connection: true)` contract exposes both `mcp_url` and
`oauth_resource`, explicitly described for Codex connections. This establishes
an OAuth resource mechanism, but does not establish registration, callbacks or
token issuance for arbitrary third-party clients. Evidence: the bundled
`sites/references/site-mcp-server.md`, `identity-and-secrets.md`, `storage.md`
and native Sites tool schema, inspected on the date above. Those installed
references are implementation guidance; they are not a public compatibility
guarantee. The automatic private plugin is also not a public-directory release;
[public submission](https://developers.openai.com/plugins/deploy/submission)
has its own connection and review requirements.

**OpenAI login and MCP authorization are separate steps.** The official
[plugin sign-in guide](https://developers.openai.com/siwc/chatgpt-plugin)
describes two OAuth transactions: signing a user into an application and
authorizing the connector to act for that user. Its general commercial sign-in
integration is a limited partner trial, separate from Sites' built-in login.
The [MCP authentication guide](https://developers.openai.com/plugins/build/auth)
requires discovery, client identification/registration, PKCE and resource-bound
tokens. A browser session, an OpenAI ID token or an API inference token is not
evidence of a valid PMX MCP access token. Sites' service bypass credential also
supplies no visitor identity and is not a substitute for per-user OAuth.

**Live probe result, 2026-10-10: OAuth is present; plug-and-play access by a
fresh external client did not pass.** A separate owner-private
[PMX MCP OAuth validation Site](https://pmx-mcp-oauth-validation-20261010.skottpedersen.chatgpt.site)
was deployed with one read-only identity-check tool and no PMX board data.
TypeScript and the Sites production build passed; deployment reported
`succeeded` and `has_mcp: true`. This tests the platform boundary, not PMX's
full server, board isolation or renderers.

| Check | Observed result |
|---|---|
| Sites connection metadata | Returned the published `/mcp` URL as both `mcp_url` and `oauth_resource`, plus a provisioned plugin ID. |
| Unauthenticated MCP request | `401` with `WWW-Authenticate: Bearer`, a resource-discovery URL and scopes `openid resource.invoke email`. |
| Protected-resource discovery | `200` JSON naming `https://auth.openai.com` as issuer, the exact Site `/mcp` resource and scopes including `resource.invoke` and `offline_access`. |
| Authorization-server discovery | `https://auth.openai.com/.well-known/oauth-authorization-server` returned `200` HTML rather than JSON. PMX's installed MCP SDK 1.28.0 failed discovery with `Unexpected token '<'`; its discovery path did not continue to OpenID metadata after that parse failure. |
| OpenID discovery, fetched separately | Valid JSON advertised authorization-code/refresh grants and `S256` PKCE, but no `registration_endpoint` or `client_id_metadata_document_supported`. |
| Fresh-client registration preflight | Given that metadata, SDK 1.28.0 rejected registration with `Incompatible auth server: does not support dynamic client registration`. No registration request or token exchange was sent. |

These results establish an advertised OpenAI OAuth path and two concrete
interoperability blockers for the tested standard client path. They do not
prove all external clients are forbidden: a supported pre-registered client
and explicit endpoint configuration may differ. They also do not establish
that the Site's own browser-login client ID can be reused by another agent;
client registration, redirect URIs and resource permissions must be approved
for that agent. Do not borrow Codex's client identity or reuse browser/service
credentials as a workaround. No external client has yet completed consent,
received a resource-bound token or called the probe as a user.

Reproduce from the Site's challenge URL and the issuer's public metadata; retain
the date and SDK version because platform discovery can change. The next
dependency is a supported external-client registration/configuration from
OpenAI or a platform change, followed by the end-to-end test below. The vision's
“other agents simply use MCP through their OpenAI login” remains a target with
an observed blocker, not a validated launch capability.

**External-client acceptance gate.** Obtain the exact published MCP URL and
OAuth resource from Sites; inspect its unauthenticated challenge and discovery
metadata; establish a supported registration and callback path for a named
external client. Complete browser consent and an authorization-code/PKCE
exchange, then call a read-only identity tool through that client. Verify token
refresh or reauthorization, revoked access and two users' isolation before
claiming parity. A discovery document alone is only partial validation. If
Sites does not support external clients directly, investigate a separately
authorized MCP gateway; that is an architectural alternative requiring a new
decision, not an implemented fallback or a reason to expose the Site publicly.

### What must change in PMX's hosted runtime

The installed Sites runtime guidance specifies Cloudflare Workers, with 128 MB
per isolate and HTTP-based external connections. PMX currently uses
[`Bun.serve`](../src/server/server.ts), synchronous
[`bun:sqlite`](../src/server/canvas-db.ts), a process-wide
[`CanvasStateManager`](../src/server/canvas-state.ts), local files and in-memory
SSE subscribers. Hosting therefore requires porting the server to the Sites
runtime, not just uploading the browser bundle.

- **Storage and identity:** use D1 for board/knowledge records and R2 for originals and generated assets, with authorization on every read and write. Scope board selection, pins, context cursors and agent sessions to users/workspaces. Sites identity establishes who called; PMX roles determine what they may do.
- **Live state:** preserve one authoritative mutation path while replacing reliance on a long-lived process. Prove concurrent writes, event delivery, reconnect and persistence across Worker replacement. Presence, locks, approval expiry, flow advancement and MCP app sessions also need a hosted lifecycle; do not assume timers or module-level maps survive or coordinate isolates. Select the synchronization mechanism only after checking Sites' supported bindings and streaming behavior.
- **Assets and builds:** prebuild the canvas and viewers; serve protected documents and uploaded objects by durable IDs. Local file watching, desktop open/reveal, subprocess MCP servers, Bun.WebView screenshots and runtime package builds do not transfer unchanged. A local bridge or external builder would be a separate integration.
- **MCP and the plugin UI:** Sites' documented tool endpoint is the starting contract. Verify PMX's resources, resource templates, notifications and MCP Apps UI embedding separately; a successful tool call does not prove that `canvas://pinned-context`, the embedded workbench or nested app frames work. Existing `isHostedWorkbench()` means an MCP App host transport is installed, not that Sites deployment is supported ([transport source](../src/client/state/workbench-transport.ts)).

### Hosted pilot operating requirements

Use **D1 for boards and metadata, and R2 for attachments and generated assets**
as the pilot storage architecture. Load individual boards as needed; do not
keep every user's boards in server memory or rely on memory for durability.

Set PMX's own upload-size and storage allowances and analytics retention before
opening the pilot. Enforce those allowances and explain them to users; platform
capacity is not an unlimited product allowance. Keep analytics retention bounded
so usage metadata does not grow indefinitely alongside board data.

**Live-state proof during hosted implementation.** Run this once a working
hosted board and MCP path exist; it is not a prerequisite for agreeing on the
vision or continuing local development. Have a browser and an agent edit the
same board concurrently, then disconnect and reconnect both. Verify that
accepted edits remain durable, conflicting edits are resolved or explicitly
rejected without silent loss, and both clients converge on the authoritative
board. Working storage alone does not establish this behavior.

**Acceptance before expanding access:** after that proof passes, load-test
concurrent editing, MCP traffic and live updates together against the deployed hosted runtime. Verify
durable writes, user isolation, event delivery and reconnect behavior under
load, and record latency, failures and resource usage. Use measured results and
the account's actual Sites quotas to set the initial operating envelope and
decide when access can expand.

**Pilot recovery.** Ship board export/import and demonstrate restoring a board
and its selected attachments from an export before users depend on hosted
boards. Explain that recovery covers only the data included at export time;
later changes require another export. Recheck Sites' recovery capabilities
during implementation rather than assuming platform-managed storage provides
a user-accessible backup.

**Documentation checked 2026-10-10:** Sites documents saved deployment versions
tied to source code, not a guarantee that restoring a version restores D1 records
or R2 objects. Its public documentation provides no recovery guarantee or
workflow for database backups, point-in-time recovery, attachment recovery or
backup retention; this does not establish that internal backups are absent.
Deleting a Site is explicitly permanent. Sources:
[Site versions](https://learn.chatgpt.com/docs/sites#understand-projects-versions-and-deployments)
and [Site deletion](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites).
The pilot needs a tested export-based recovery path and clear limitations;
the full service's automated backup system belongs to Part 5.

### Node compatibility for the first hosted version

**Source audit, 2026-10-10; no deployed node certification.** The
[`CanvasNodeState` union](../src/client/types.ts) has 18 types. “Portable” below
means the renderer can plausibly be reused once the common hosted backend is
in place. “Adapt” identifies a concrete current dependency to replace.
“Conditional” requires a platform or upstream integration test. All node types
remain in the product vision; local-only behavior is not promised as hosted
parity.

| Node type | Hosted assessment | What carries over and what must be proved or changed |
|---|---|---|
| `markdown` | Portable; adapt path-backed content | Inline text and editing can carry over. Local-file reads/saves need cloud document content or an explicit local bridge. Preserve links, source provenance and context text. |
| `status` | Portable | Renders supplied status data. Live changes must use authenticated hosted writes. |
| `context` | Portable; adapt local links | Cards, pins and AX actions can carry over. Open/reveal of a desktop path needs an uploaded resource or local bridge. |
| `ledger` | Portable | Renders supplied entries; persist and authorize their updates in the hosted store. |
| `trace` | Portable | Renders supplied trace data; a connected agent must deliver new events. Hosting does not create that telemetry. |
| `file` | Adapt | Reuse text/code/table rendering. Replace `/api/file`, raw/PDF byte routes and local watchers with authorized stored objects and explicit updates. Local filesystem paths are not cloud file identities. |
| `diff` | Portable | Displays supplied unified-diff text. Reading a local Git checkout to produce the diff remains an agent/source integration. |
| `image` | Adapt assets | Data URLs and permitted HTTPS images can render. Local paths require uploaded objects; private image loading must work without exposing credentials. Remote sources retain their own access restrictions. |
| `html` | Adapt surfaces | HTML and the existing primitives can use their browser renderer. Port surface documents, theme/assets and the nonce-tagged AX bridge; test sandbox/CSP and real interactions. `ax-board`/`ax-flow` additionally require hosted AX state and loop execution. |
| `mermaid` | Adapt surfaces | The bundled browser renderer can carry over. Serve its sandboxed document and script/theme routes; verify visible output in both the Site and plugin. |
| `mcp-app` | Conditional by mode | Remote URL frames depend on embedding policy. Prebuilt web artifacts need stored asset serving. External MCP Apps need a hosted session/credential/bridge implementation; local stdio servers cannot run unchanged. See modes below. |
| `webpage` | Portable stored preview; conditional refresh/live frame | Stored preview data can render. Port the server fetcher while preserving SSRF/redirect restrictions; it currently uses Node DNS and pinned-IP HTTP/HTTPS. Live embedding depends on the target's CSP/X-Frame-Options, login and browser cookie policy. Keep preview/link fallback. |
| `json-render` | Adapt viewer assets | Reuse the spec-driven browser viewer, ship its JS/CSS at deploy time, and port spec/state/action routes. Preserve `specVersion` changes so updates visibly reload. |
| `graph` | Adapt viewer assets | Uses the json-render viewer path; apply the same asset, spec refresh and AX action checks. Supplying graph data is separate from scanning a local repository. |
| `group` | Portable | Layout and membership follow hosted board state; preserve per-member mutation authorization. |
| `board` | Portable with scoped queries | Port portals, navigation and backlinks. Linked boards require independent access checks; unreadable targets must reveal neither title nor context. |
| `prompt` | Conditional execution | Existing prompt display can carry over. Submission needs authenticated delivery to an agent; Sites hosting and login do not provision an agent runtime. |
| `response` | Portable history; conditional live stream | Stored answers can render. Live responses require a host adapter and durable delivery/reconnect behavior. |

**File attachments are a mode, not a nineteenth type.**
[`FileNode`](../src/client/nodes/FileNode.tsx) selects
[`AttachmentNode`](../src/client/nodes/AttachmentNode.tsx) when `attachmentId`
is present. Port originals to protected object storage and metadata/import
state to D1. Preserve the 20 MiB limit, explicit processing request, agent draft,
human review and source-linked commit. PDF/Office extraction remains dependent
on an agent's tools; hosting supplies neither OCR nor a converter. Local code
dependency discovery also needs content/virtual-path indexing in place of
[`code-graph.ts`](../src/server/code-graph.ts)'s filesystem resolution.

**The three `mcp-app` modes need separate promises.** Prebuilt web artifacts
are a strong candidate, but [`web-artifacts.ts`](../src/server/web-artifacts.ts)
currently builds packages and writes local files; build elsewhere and upload
the result. Plain URL frames remain subject to the remote site's embed policy.
External MCP Apps use PMX's own AppBridge and
[`mcp-app-runtime.ts`](../src/server/mcp-app-runtime.ts), which supports HTTP
or subprocess transports and stores sessions in a process map. Remote HTTP is
the hosted candidate; upstream OAuth, credentials, resources and reconnect are
separate work from the user's authentication to PMX. Transport headers/env can
currently travel in node `transportConfig`; hosted/shared boards must use
server-only credentials and safe references instead.

The [Excalidraw preset](../src/server/diagram-presets.ts) already uses remote
HTTP and is a useful integration pilot, but must pass create, interact,
checkpoint and reload tests. Its live app shell is not a standalone Site.
For iframe-backed nodes, test both direct Site browsing and the nested ChatGPT
plugin surface: sandbox identity, protected asset loading, postMessage origin
and nonce checks, theme propagation and user-visible refresh all matter.

Source anchors for this assessment: [native renderers](../src/client/nodes/),
[surface and asset routes](../src/server/server.ts),
[viewer server](../src/json-render/server.ts),
[webpage fetcher](../src/server/webpage-node.ts),
[external app operations](../src/server/operations/ops/app.ts), and
[document imports](../src/server/document-import.ts).

**Hosted proof before claiming compatibility:** create one board containing all
18 types plus attachment, primitive and web-artifact variants; verify visible
content, edits and pinned context, not only stored node data. Repeat after
reload/reconnect and Worker replacement, with two users whose private boards
and credentials differ. Check the 600/1024/1920 px surfaces and nine themes from
the design gate. Record unsupported integrations explicitly. External-client
OAuth, full MCP resource/UI support and third-party app hosting each need their
own passing evidence before the complete hosted promise is met.

## Part 5: Further out — full PMX Canvas hosted on Cloudflare

**Direction decided with the maintainer, 2026-10-10.** If the ChatGPT Sites
version works and people use it, pursue a full standalone PMX Canvas service
hosted directly on **Cloudflare**, with its own web experience and hosted MCP
endpoint. PMX would manage the deployment, accounts, workspace access, storage
and live collaboration as a product. The ChatGPT Sites edition and its plugin
remain independently supported; plugin access to the standalone service can be
an additional distribution channel. Agents connect to each edition through its
supported, authenticated MCP access.

This is a later product investment, even though Sites already uses Cloudflare
infrastructure underneath. The first stage validates usefulness and distribution
within ChatGPT; the later stage gives PMX control over the complete hosted
experience. Carry forward the board model, permissions, renderers and lessons
from Part 4. Choose Cloudflare services, authentication providers and operational
architecture when planning that stage; OpenAI login for arbitrary external
clients remains subject to the validation above.

**Gate to start:** review evidence of recurring use by people beyond the
maintainer, successful plugin distribution and concrete needs that justify a
standalone service, using Part 4's product metrics alongside user feedback.
Proceed when that evidence supports the investment; if it
does not, improve the first version before expanding the hosting scope. There
is no automatic launch date or adoption threshold invented in this vision.
Local and self-hosted PMX remain part of the product.

**Full hosted backup and recovery.** Before users depend on the standalone
Cloudflare service, establish automated backups of board data and attachments,
define retention and recovery targets, and demonstrate restoring an accidentally
deleted or damaged board with its assets. Keep user exports as an additional
safeguard. Durable storage alone is not a backup, and a deployment rollback is
not proof of data recovery.

### Likely repository structure: shared product, separate runtimes

**Architectural direction, 2026-10-10:** a monorepo is the likely fit for
supporting three delivery surfaces: the working local PMX Canvas, the ChatGPT
version validated and distributed through its plugin, and later the full
standalone hosted version. Confirm the package
boundaries during implementation; this is not a request to reorganise the
repository before the ChatGPT validation needs it.

- **Shared product:** the board model, mutation rules, context compilation, node renderers and canvas UI should be reused across distributions. Keep runtime dependencies out of this shared code.
- **Local runtime:** retain the Bun server, local SQLite store, filesystem access/watchers, local MCP entry point and existing CLI/SDK workflows. Local PMX must remain usable without a cloud account, hosted service or network connection for its local features.
- **ChatGPT version / Sites runtime:** adapt the shared product to Sites' identity, storage and MCP contracts for the first validation and plugin distribution. Keep this experience working as the product grows; it is a supported delivery surface, not a disposable prototype.
- **Cloudflare runtime:** later compose the same product into the full hosted service, with deployment, identity, storage and live-state integrations under PMX's control. Reuse suitable Sites work without making the standalone service depend on Sites.

**Continuity for early local users.** Existing users keep their local canvas,
boards, SQLite storage and local workflows as hosted versions arrive. Shared
product improvements continue to reach the local version wherever the runtime
supports them. Hosting is an additional way to use PMX, not a required migration,
cloud account or upload of existing boards. Moving data to a hosted version is
the user's explicit choice.

**Board portability and independent editions.** Local PMX, ChatGPT Sites and
the future Cloudflare service each own their boards and storage independently.
Sharing core code does not imply shared live state or automatic synchronization;
each edition remains useful on its own.

Provide one shared, editable board export/import format across all three
editions. Users deliberately transfer a board by exporting it from one edition
and importing a copy into another; later edits remain independent. Preserve
node content, layout, edges, groups, annotations, context pins, provenance and
the attachments/assets the user chooses to include. This portable archive is
additional to today's read-only HTML export. Import creates a new board by
default and applies destination ownership and permissions; credentials and
source access grants never travel with it. Local file references and live
integrations may need reconnecting, with unavailable capabilities made explicit.

**Portability acceptance:** round-trip a representative board between the
local and ChatGPT editions for the pilot, and add Cloudflare to the same checks
when that edition exists. Verify retained content and relationships, selected
attachments, explicit integration limitations and independent edits after import.

Keep the local product as a maintained distribution, not a frozen predecessor
or a thin client that requires the cloud. Keep the ChatGPT plugin and its user
experience supported as its own edition when the full hosted version arrives.
Runtime adapters should represent
real platform differences, with explicit capability limits for features such
as local file watching and subprocess MCP servers. Avoid separate copies of
product logic or a broad abstraction framework built before it is needed.

**Acceptance:** changes to shared code pass the local verification ladder as
well as the relevant hosted checks. A clean installed local package can still
start, create and persist boards, render nodes and serve its local MCP tools
without hosted credentials. Test supported common behavior across runtimes and
document the differences; hosted progress must not silently break local PMX.

## Architecture diagnosis at the original review

This list preserves the original motivation and historical counts, not a fresh
source audit. Since then, workbench-token attribution and persistent authorship
have landed, and the library stores many boards while keeping one active board
in memory. Durable undo/journal, unified write paths and renderer consolidation
remain unfinished; see the current implementation status above.

1. **One write lands in four logs and none is durable.** Mutation history (200 closures, in-memory), the SSE ring (500, in-memory), presence activity (50), and three AX tables with independent retention. Undo is empty after every restart. SSE has an `id:` field nobody reads.
2. **The human marker is a label, not a gate.** Actor attribution, the fence, and the lock all key on an unauthenticated header.
3. **Three write paths with three policies.** The registry (fence, lock, actor), the SDK (87 direct state calls, none of those), and 21 hand-written routes in a 3,471-line server file.
4. **Node type is not the renderer.** Five rendering tiers, three node types funnelled through one iframe component, two UI frameworks, two CSS toolchains.
5. **Single-slot listeners and import-order wiring.** `onMutation` and the work-items listener hold one callback each; module-level timers outlive the server.
6. **The knowledge that keeps the product working lives in prose.** Rules 3, 7, and 9 in CLAUDE.md and its byte-identical AGENTS.md twin have each grown a paragraph per recurrence.
7. **One board in memory, by construction.** The original singleton design limited the workspace to one board. Stage 1 now persists many boards and switches the active one; concurrent board managers (move 0, stage 2) still wait for the journal.

## What must not be touched

The operation registry and its dispatcher. State in the server, browser as renderer. The human/agent distinction as a first-class concept (to be made real, not removed). Context pins and `canvas://pinned-context`. Six of six iframes sandboxed without `allow-same-origin`. `smoke`, the e2e gate, the changelog discipline. The velocity: 110 commits, +64,444 and −13,026 lines in the six weeks to 2026-09-05, which makes this plan credible if it is spent on the plan rather than on field reports, which is where 0.6 went.

## Original sequence and remaining direction

The 2026-09-29 release decision folds the implemented 0.7, 0.7.x and connected-memory
portion of 0.8 into **0.7.0**. The table below preserves the original sequence as
historical planning context; it is not the current release checklist. Tours
already shipped in 0.6.5. Future batch scope and version still need a decision.
Acceptance checks that require real users or the effect evaluation remain open
even where implementation and automated tests are complete.

Revised 2026-09-23 and 2026-09-24. The original 0.6 bundled five moves into 2–3 weeks and shipped none of them, so each release is now small and ends on a check rather than a week count. The first 0.7 draft repeated the bundle (static export was in it, and many boards was sized S); export now ships on its own as 0.7.x.

| Release | Content | Done when |
|---|---|---|
| 0.7 | Many boards stage 1 with the nine real boards restored, and library backup (move 0); the S half of trust (move 7: `res.ok` toasts, redirect host filter); read instrumentation (Part 1, item 4); the Chromium 600 px reference project (5). | The nine boards open by name; a backup restores them on a clean machine; a refused write shows its reason; every node type paints at 600 px; agent reads are being recorded. |
| 0.7.x | Static export with the per-board rule (11). | A colleague opens an exported board with no install. This is the second-user milestone. |
| 0.8 | Portals, README card, `canvas://boards`, search across boards (0), a meaningful text form for every node type (1), document drop as Markdown context (15), new board from this board (14), author on every node and attributed ask answers with the boot secret (7), the one read with its cross-board tier (Part 1), the cheap tool surface (6a), the binary (8). | "What changed since the April OKRs?" is answered from a board linked to the April board, without the agent being told which board to read; imported documents are readable, source-linked and searchable; the per-type text-form check passes; the curation benchmark (Part 1, item 4) is run and its gap recorded. |
| 0.9 | Wiki links and the board map, make board and inline board (0), tours (12), recipe cards (13), the frame host (5). | A board with 20 portals mounts no more iframes than one without; a tour runs inside an exported file. |
| 1.0 | The journal and bookmarks (4), the agent's output onto the board (3), the SDK through the registry, the M half of trust with the read-only share link (7, Part 3 step 2), time scrubber, culling and frame budget (9). | A colleague follows a shared link to a live board and sees it change. |
| After 1.0 | Comments and a second writer (Part 3 steps 3–4), concurrent boards (0, stage 2), state as a fold of the journal, generated surfaces (6b, if decided), session projection (Part 1, item 2). | Each step starts only when the previous one is in use. |

## Where I disagree with the panel

- The minimalist and the strategist delete AX. Wrong target, and after the maintainer's decision the target is narrower still: the agent's output moves onto the board, and every AX mechanism including the whole fleet layer stays.
- The minimalist deletes the registry. Refuted three to zero: the browser alone calls 55 API paths.
- The rendering architect deletes the tool rail and top bar. Design for 600 px first; the rail is the good part of the chrome.
- Every vision, and my own first draft, proposed cutting node types on the strength of the repo's test board. The real boards refute the chart cut outright, and the maintainer's rule closes the rest: usage on one machine is not evidence of non-use. No node type is cut; consolidation is confined to how nodes render.
- Four of six visions leaned on Obsidian, and five on git, as the format, the snapshot system, or the remote transport. For local and self-hosted distribution, the maintainer's rule is that this is its own app with no reliance on externals, and I agree: the app owns its history (the journal), its store (SQLite), and its remote reach (tokens and a listen mode). What survives of the folder idea is an export.
- Several visions invented constants (700 chars, six frames, 14k lines) with the same confidence they mocked the repo's. So did I. Every such number in this document is a starting value to tune in use, not a claim.

## Evidence

Historical review evidence follows; present-tense claims and measurements in
this table refer to the cited review dates, not the current implementation.

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
