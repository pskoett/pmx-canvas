# Design: the system and when it gets built

*Updated 2026-10-04. Companion to [the vision](product-vision-2026-09.md): the vision
says what the product does and in what order; this file says how it looks and which
design work ships with which part of that order. Design never ships ahead of the
function that produces its data, and function never ships with today's styling when
its design is already drawn.*

The drawings are the **look-and-feel proposal canvas**: edited as a private Design
artifact (<https://claude.ai/artifact/NbLiHkjK9d57Se55vskoc3>) and kept in the repo
as source under [`design/`](design/), so agents and contributors can read the exact
sizes, colours and copy. The drawings are the visual authority; this file is the
contract and the schedule.

## The drawings

Each `.dc.html` file is one artboard; `canvas.json` is the canvas layout (positions,
titles, notes). They render in the Design canvas (they need its runtime); in the repo
they are read as source. When an artboard changes in the canvas, re-export it here in
the same change.

| File | Shows | Wave |
|---|---|---|
| [`Before.dc.html`](design/Before.dc.html) | The demo board as it renders today | — |
| [`Main.dc.html`](design/Main.dc.html), [`Light.dc.html`](design/Light.dc.html) | The same board with the foundation applied, dark and light | 0 |
| [`Tokens.dc.html`](design/Tokens.dc.html) | Typeface, type scale, radii, elevation, one meaning per colour | 0 |
| [`Themes.dc.html`](design/Themes.dc.html) | Meaning colours across all nine themes, proposed names | 0 |
| [`Chrome.dc.html`](design/Chrome.dc.html) | Rail at 690 px, node header and ⋯ menu, section headings, floating chrome | 0 |
| [`Context.dc.html`](design/Context.dc.html) | Nodes in context: every state, the count chip, the command bar | 0–1 |
| [`AgentContext.dc.html`](design/AgentContext.dc.html) | What the agent did: read, created, edited, suggested, out of date; lens and receipt | 1 |
| [`Home.dc.html`](design/Home.dc.html) | Home — Folders: library tree, context, README, board details | 1 |
| [`HomeMap.dc.html`](design/HomeMap.dc.html), [`HomeGraph.dc.html`](design/HomeGraph.dc.html) | Home — Map and Graph views of the library | 2 |
| [`Relations.dc.html`](design/Relations.dc.html) | Relations on a research board, today vs proposed; edge anatomy; relation inks | 3 |
| [`Flows.dc.html`](design/Flows.dc.html) | Data lineage with staleness, what a finding rests on, opening a group | 3, 5 |
| [`Uses.dc.html`](design/Uses.dc.html) | One relation layer for research, dependencies, decisions and agent flows | 3 |
| [`Types1.dc.html`](design/Types1.dc.html)–[`Types3.dc.html`](design/Types3.dc.html) | Every node type, today vs proposed | 0, 4 |
| [`Zoom.dc.html`](design/Zoom.dc.html) | Fit-all readability when frames are unmounted | 4 |
| [`Pane600.dc.html`](design/Pane600.dc.html) | Home and a board at the 600 px reference width | all |
| [`Vision.dc.html`](design/Vision.dc.html) | How each design area maps to the vision, and the open decisions | — |

## Principles

- **One meaning per colour, the same in every theme.** Blue = in the agent's
  context (pinned, by you or the agent). Violet = what the agent did (read, created,
  edited, suggested). Amber = needs a look (warning, stale, out of date). Relation
  inks (supports, contradicts, cites, derived from, informs…) never reuse those
  three. Each theme keeps its own surfaces and accent; the meaning colours keep
  their hue and are tuned only for lightness. A token test keeps them apart in all
  nine themes.
- **Every mark has a glyph and a word**, so it reads without colour, and explains
  itself on hover.
- **One font and one scale.** IBM Plex Sans and Mono, bundled with the app (no CDN);
  every control inherits the font. Type 11/12/13/15/20; radii 6/10/14/pill; two
  shadow levels. No glow is used as elevation.
- **Quiet chrome.** Node headers show title and kind; controls appear on hover under
  ⋯. Section labels are a heading display of the markdown node. Rarely used tools
  live in one settings menu on the rail.
- **Relations are the edge layer, not node types.** Design work adds no node type;
  the vision's own `ask` node (move 3) is separate.
- **The 600 px pane is the reference surface.** Every drawing gets a 600 px version
  before it is built (proposal board "At 600 px").

## Build plan

Each wave pairs a vision move with the design that shows it. A wave is done only
when both halves pass its check. Status reflects 0.7.0 (see the vision's
implementation table).

| Wave | Vision | Function (build) | Design (proposal boards) | Done when |
|---|---|---|---|---|
| **0. Foundation** — ships alone, first | Moves 5, 9, 10 | Bundle Plex; controls inherit the font; type/radius/shadow tokens; meaning tokens per theme; theme renames (`dark` → Harbor, `light` → Daylight, neutral; no aliases); pin style that survives selection and attention; violet header bar replaces amber halos and focus fields | Today / Proposed, Tokens, Themes, Rail and node header, Nodes in context | No control renders in a fallback font; token test passes for all nine themes; 600 px reference passes; demo board regenerated |
| **1. Context made visible** — next batch, with the curation evaluation | Part 1 bet, moves 2, 7 | Surface `context_reads` (already recorded since 0.7.0: who read, which nodes were delivered) per node as read / not read / changed since read, using revisions; who pinned; activity lens and session receipt from presence activity and revisions; board-level "in context" switch and Home's context section | What the agent did with context, Nodes in context, Home (Folders) | From the board alone, a person can answer "did the agent read what I pinned, and is its copy current?" The evaluation in `docs/evals/` reads the same data |
| **2. Connected memory views** — next batch, remaining wiki/graph work | Moves 0, 14 | Board map projection (generated like the code graph), wiki links, direct cross-board card edges, previous-board chains | Home Map, Home Graph | Map and Graph are generated from the library; orphans visible; works at 600 px |
| **3. Relations layer** | Moves 0, 1, 13 | Edge `reason` and an open `kind` with a per-board vocabulary; relations carried in the brief's text form; "derived from" with staleness from provenance and recipes; relation queries for the inspector | Relations, Lineage, One relation layer | Hovering a node explains each link; a changed source turns downstream nodes amber; the agent's brief includes relations |
| **4. Frame host and viewers** | Moves 5, 9 | One frame host passing the full theme tokens; json-render defaults to the canvas theme with an opt-out for design experiments; zoomed-out cards for unmounted frames | Node types 1–3, Zoomed out | No viewer draws its own background; 20 portals mount no more frames than none; fit-all is readable |
| **5. Agent output and groups as pages** | Moves 3, 0 | Work items, gates and asks as nodes; make board / inline board; opening a group keeps its outside links | One relation layer (agent flow), Lineage (open a group) | Agent output is styled by the same shell and tokens; a group opened as a board shows its outside stubs |
| **Later — share ladder** | Part 3 | Read-only link, comments, second writer | — | Exports and shared views inherit the tokens; a viewer sees the same meaning colours |

**Folders and portals.** Home uses folders as the visible hierarchy (where a board
lives, one place); portals and links are how boards relate and appear in Map and
Graph. This replaces the review's portal-derived levels as the navigation tree; it
needs the maintainer's confirmation before wave 2.

## Definition of done for any design work

1. It is drawn in the proposal canvas first, including its 600 px version.
2. It is built to the drawing, with the function it shows (see the plan above).
3. It passes in all nine themes and the 600 px Chromium reference.
4. It touches no meaning colour except through the meaning tokens.
5. The demo board is regenerated (`bun run scripts/generate-demo-board.ts`) and
   `tests/unit/demo.test.ts` passes.
6. User-facing docs (`docs/node-types.md`, `docs/http-api.md`, `docs/mcp.md`) and the
   skills reflect it.

## History

- **Rail-chrome v2 (August 2026).** The rail, top bar, presence layer, session panel,
  command bar, external steering and canvas-quality waves shipped from the design
  handoff that lived in `design/rail-chrome-v2/`. That folder was retired on
  2026-10-04: its presence contract now lives in
  [`ax-state-contract.md`](ax-state-contract.md#agent-presence-contract), this file
  holds the design direction, and the mockups and plan remain in git history
  (`git log -- design/`).
