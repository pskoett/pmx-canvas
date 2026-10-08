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

**Before you build a surface** (any agent or contributor):

1. Find its artboard in [The drawings](#the-drawings) and read the source for exact sizes,
   colours, spacing and copy.
2. Find its wave in the [Build plan](#build-plan) and confirm the function that produces its
   data ships in the same change.
3. Apply the [Principles](#principles), above all the fixed meaning colours.
4. Meet the [Definition of done](#definition-of-done-for-any-design-work) before calling it done.

## Token system

Drawn on [`TokenSystem.dc.html`](design/TokenSystem.dc.html); per-theme meaning colours on
[`Themes.dc.html`](design/Themes.dc.html).

### Today

About 55 custom properties in `src/client/theme/global.css`, almost all colour:

- **Palette:** `--c-bg`, `--c-panel`, `--c-panel-soft`, `--c-line`, `--c-text`, `--c-text-soft`,
  `--c-muted`, `--c-dim`.
- **Status colours that components borrow for meaning:** `--c-accent`, `--c-ok`, `--c-warn`,
  `--c-warn-alt`, `--c-danger`, `--c-purple`, `--c-thinking`, `--c-subagent`.
- **22 fixed alpha copies:** `--c-warn-10…60` (nine), `--c-accent-8…40` (eight), `--c-ok-10…25`,
  `--c-danger-12`.
- **Surfaces and effects:** `--c-panel-glass`, `--c-panel-overlay`, `--c-surface-*`,
  `--c-input-bg`, `--c-shadow`, `--c-shadow-heavy`, `--c-glow-accent`.
- **The only non-colour tokens:** `--font`, `--mono`, `--radius`, `--radius-sm`,
  `--hud-bar-height`.
- **A second scheme for embedded viewers:** `--color-*` in `surface-theme.css`, collapsed to dark
  or light.

What that causes: meaning is borrowed (pins and agent attention both use `--c-warn`, which
`global.css` references 93 times, while the light theme hard-codes `#4BBCFF` for pins); there is no
type, spacing or shadow scale (20 font sizes, 12 radii and 195 raw hex colours sit in the CSS);
every new tint needs a new token; embedded viewers draw their own palette; `--c-subagent`
(`#00E5FF`) sits next to the pin blue; and nothing checks any of it.

### Proposed: three layers

Components reference tokens only. Raw colour values live only in the theme files.

1. **Palette** — defined by each theme, names kept: `--c-bg`, `--c-panel`, `--c-panel-soft`,
   `--c-line`, `--c-text`, `--c-text-soft`, `--c-muted`, `--c-dim`, `--c-accent`,
   `--c-on-accent`, `--c-ok`, `--c-danger`. The accent is the theme's flavour (primary buttons,
   selection) and never carries a meaning below.
2. **Meaning** — one hue in every theme, tuned only for lightness; used only for its meaning:

   | Token | Means | Harbor (dark) | Daylight (light) |
   |---|---|---|---|
   | `--c-pin` | In the agent's context | `#4BBCFF` | `#1A7ABF` |
   | `--c-agent` | What the agent did (replaces `--c-thinking`) | `#B388FF` | `#7C4DDB` |
   | `--c-warn` | Needs a look: warning, stale, out of date | `#f4c542` | `#94600A` |
   | `--c-rel-supports` | Evidence for | `#5FCFC0` | `#1E8C80` |
   | `--c-rel-contradicts` | Evidence against | `#E59B6B` | `#B8572A` |
   | `--c-rel-cites` | Where a claim or number comes from | `#7C9CFF` | tune in wave 0 |
   | `--c-rel-derived` | Data lineage, flow | `#D5DEEA` | tune in wave 0 |
   | `--c-rel-informs` | Answers, depends on | `#E58FB0` | tune in wave 0 |
   | `--c-rel-related` | Loose link (dotted) | `#8ea3bd` | tune in wave 0 |

   The other seven themes' values are drawn on the Themes board and fixed by the token test.
3. **Scale** — the same in every theme:
   - Fonts: `--font-ui` IBM Plex Sans, `--font-code` IBM Plex Mono, both bundled.
   - Type: `--fs-meta` 11, `--fs-ui` 12, `--fs-body` 13, `--fs-title` 15, `--fs-heading` 20.
   - Spacing: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-6` 24,
     `--space-8` 32.
   - Radius: `--r-control` 6, `--r-node` 10, `--r-overlay` 14, `--r-pill` 999.
   - Elevation: `--e-1` nodes, `--e-2` floating chrome and menus. No glows. The one per-theme
     exception (decided 2026-10-05): the drawn black shadows are for dark surfaces; Daylight and
     Sepia use ink-tinted ones (`rgba(8, 21, 36, …)` at 10/8% and 18%).

### Moving from today to proposed (wave 0)

- Tints are derived — `color-mix(in srgb, var(--c-pin) 12%, transparent)` — so the 22 alpha
  copies, `--c-warn-alt` and `--c-glow-accent` go.
- `--c-thinking` becomes `--c-agent`.
- **Kinds carry no colour.** Type icons use `--c-muted`; the glyph tells the kind, plus the kind
  word on zoomed-out tiles (Zoom board). Minimap rects and group-chip kind dots are neutral, and
  only meaning colours mark them (pinned, agent at work). `KIND_COLOR`, `--kind-accent` and
  `--c-purple` go. Nine kind hues cannot all stay clear of ten meaning colours in nine themes,
  and every hue a kind borrows is one a meaning loses.
- **Writers are told apart by name and initial, not hue.** An agent writer's cursor, avatar and
  activity line use `--c-agent`, a subagent's `--c-subagent`, a human's `--c-text-soft`;
  `WRITER_PALETTE` goes. Two agents on one board share the violet and differ by label.
- The frame host hands embedded viewers the same tokens, replacing `--color-*`.
- **Decided 2026-10-05:** `--c-subagent` stays as its own meaning colour, a fuchsia beside the
  agent violet (`#E879F9` on dark themes, `#A83BB0` on Daylight and Sepia, `#ff99ff` on High
  contrast) instead of a second cyan next to the pin blue. It reads as agent work, is told
  apart from the main agent at a glance, and is held apart from every other meaning colour by
  the token test.
- **Checks:** a token test that keeps meaning colours apart from each other and from the palette,
  with at least 3:1 contrast on `--c-panel`, in all nine themes; a check that rejects raw hex
  outside the theme files; a check that every control computes `--font-ui`.

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
| [`TokenSystem.dc.html`](design/TokenSystem.dc.html) | The token system today vs proposed: palette, meaning, scale | 0 |
| [`Themes.dc.html`](design/Themes.dc.html) | Meaning colours across all nine themes, proposed names | 0 |
| [`Chrome.dc.html`](design/Chrome.dc.html) | Rail at 690 px, node header (expand and context pin always visible, the rest under ⋯), section headings, floating chrome | 0 |
| [`Context.dc.html`](design/Context.dc.html) | Nodes in context: every state, the count chip, the command bar | 0–1 |
| [`NearPin.dc.html`](design/NearPin.dc.html) | Near a pin: the dotted “near” chip on a pinned node's unpinned neighbours, tethers on hover, the moment of change, combinations, 600 px; ships with the brief carrying neighbours (title + summary, reason “near <pin>”) | 1 |
| [`ContextChip.dc.html`](design/ContextChip.dc.html), [`ContextChip600.dc.html`](design/ContextChip600.dc.html) | The one context chip (decided with the maintainer 2026-10-07: placement, near muted, quiet empty state, agent-pin dots, “N in context” at 600 px): top bar, right, replacing the floating ContextPinBar and the ContextBudget meter; at rest for cards, near, boards, agent-only pins, nothing pinned; opened into Cards (full, × unpin, clear all), Near (derived, title + summary, no ×, Pin to promote) and Boards (read state, × unpin). **A pinned board travels as a map** (decided 2026-10-07): folder, README summary, each pinned card's title + summary, links and backlinks; the agent pulls a card or board in full itself, so the chip shows no full / summary / not-sent state. **A cost, not a budget** (decided with the maintainer 2026-10-08): the chip shows what the brief costs as ≈ tokens, with no meter, share or clipped state; when the host reports its agent's token usage the panel names that count too (“Copilot’s whole context holds 42.8k tokens”). The brief's size limit stays internal as a page size. At rest it is the summary, always visible and right-aligned in the top bar at every width; the details open only on click. At ≤ 760 px the summary is “N in context” with no token text, and the bar gives way in this order: session id and counts; Export, Present, zoom and fit fold into ⋯; agent chip to its avatar, Start agent session to its icon; the board name truncates — the dot, board pin, summary and ⋯ never collapse. Harbor and Daylight, 600 px. Supersedes the chip wording on Context, NearPin and BoardPins | 1 (slices 4b, 5b) |
| [`LinksChanged.dc.html`](design/LinksChanged.dc.html) | Links that changed after the agent read a card (decided with the maintainer 2026-10-08: option C of LinksOptions): the mark sits on the edge, not on both cards — a person’s new or edited link says “not seen by <agent>” (muted, eye-off) until a read carries either end, an agent’s link says “by <agent>” (violet). <agent> is whichever agent is attached (Claude, Codex, Copilot, any other), never a fixed name; the drawing’s “Claude” is an example. Marks stay quiet on a board no agent has read; card text changes keep amber “changed” and win on the card; links-only changes show per card only in the context panel (“links changed”, neutral); relation inks never change; 600 px | 1 |
| [`LinksOptions.dc.html`](design/LinksOptions.dc.html), [`LinksOptions600.dc.html`](design/LinksOptions600.dc.html) | The connections question as three options on one board (one text edit, one link by you, one by the agent, plus the context panel rows): A as built (every change “changed”), B a separate amber “links changed” on both cards, C the mark on the connection (“not seen by <agent>”, neutral) — C decided with the maintainer 2026-10-08; A and B not chosen | 1 |
| [`AgentContext.dc.html`](design/AgentContext.dc.html) | What the agent did: read, created, edited, suggested, out of date; lens and receipt | 1 |
| [`BoardPins.dc.html`](design/BoardPins.dc.html) | Board pins: where you pin a board, the tiered brief, the context chip across boards; each pinned board carries its category glyph and review state (due count, the brief’s “review due” / “lifecycle unknown” lines) | 1 |
| [`Home.dc.html`](design/Home.dc.html) | Home — Folders: library tree, pinned boards, README, board details | 1 |
| [`HomeMap.dc.html`](design/HomeMap.dc.html), [`HomeGraph.dc.html`](design/HomeGraph.dc.html) | Home — Map and Graph views of the library | 2 |
| [`HomeTeam.dc.html`](design/HomeTeam.dc.html) | Home on a team server: workspace and personal libraries, per-user pins, moving a board into the workspace, locked links, folder categories and due counts in both libraries (look ahead) | Later (Part 3, step 5) |
| [`Categories.dc.html`](design/Categories.dc.html), [`CategoryEditor.dc.html`](design/CategoryEditor.dc.html), [`Lifecycle.dc.html`](design/Lifecycle.dc.html), [`Lifecycle600.dc.html`](design/Lifecycle600.dc.html) | Knowledge categories as a folder property (glyph + word, no colour; set here vs `↳` inherited; dashed “unknown”), folder settings, the one workspace list with lifecycle defaults and templates (org/team/personal is one option), a solo-research workspace; on cards: lifecycle override (never category), the four clocks, review outcomes with evidence, the board's review list, the brief. Review due is amber **outlined** with ⧗ as the card's bottom line, only while due; changed-since-read stays amber **filled** with △ in the header. 600 px | For review (move 13, Part 3) |
| [`LifecycleVariants.dc.html`](design/LifecycleVariants.dc.html), [`Restore.dc.html`](design/Restore.dc.html) | Where lifecycle shows: variant A (review due on the card while due) vs B (only in the ⋯ menu, a count on the board), with the shared ⋯ → Lifecycle entry; retiring and restoring a card: dimmed in place, Retired filter, search, Restore in the Lifecycle tab, Undo toast, history with who and when | A chosen 2026-10-07; restore confirmed |
| [`Relations.dc.html`](design/Relations.dc.html) | Relations on a research board, today vs proposed; edge anatomy; relation inks | 3 |
| [`Flows.dc.html`](design/Flows.dc.html) | Data lineage with staleness, what a finding rests on, opening a group | 3, 5 |
| [`Uses.dc.html`](design/Uses.dc.html) | One relation layer for research, dependencies, decisions and agent flows | 3 |
| [`Types1.dc.html`](design/Types1.dc.html)–[`Types3.dc.html`](design/Types3.dc.html) | Every node type, today vs proposed | 0, 4 |
| [`Zoom.dc.html`](design/Zoom.dc.html) | Fit-all readability when frames are unmounted | 4 |
| [`Pane600.dc.html`](design/Pane600.dc.html) | Home and a board at the narrow end, 600 px | all |
| [`Vision.dc.html`](design/Vision.dc.html) | How each design area maps to the vision, and the open decisions | — |

## Principles

- **One meaning per colour, the same in every theme.** Blue = in the agent's
  context (pinned, by you or the agent). Violet = what the agent did (read, created,
  edited, suggested). Amber = needs a look (warning, stale, out of date). Relation
  inks (supports, contradicts, cites, derived from, informs…) never reuse those
  three. Each theme keeps its own surfaces and accent; the meaning colours keep
  their hue and are tuned only for lightness. A token test keeps them apart in all
  nine themes.
- **Context pins at two levels, one look.** A card pin puts that card first in the agent's
  map (title, summary, relations; the agent pulls the full text when it decides to); a board
  pin brings the whole board into the agent's working set as a map, from anywhere in the library
  ([vision move 0a](product-vision-2026-09.md#0a-board-pins-a-working-set-across-boards-sm)).
  Both use the outline pin (not in context) and the filled blue badge (in context), and the
  context chip counts both: "4 cards · 3 boards in context".
- **Every mark has a glyph and a word**, so it reads without colour, and explains
  itself on hover.
- **One font and one scale.** IBM Plex Sans and Mono, bundled with the app (no CDN);
  every control inherits the font, including embedded JSON forms. Self-contained
  viewers embed the font bytes for hosted and offline use. Type 11/12/13/15/20; radii 6/10/14/pill; two
  shadow levels. No glow is used as elevation.
- **Quiet chrome, with expand and the context pin always in reach.** Every node header
  shows its kind, title, expand (`⤢`, Enter — on the types that expand: markdown,
  mcp-app, webpage, json-render, graph, context, ledger, file, diff, mermaid, image,
  html) and context pin: an outline pin in a circle when the node is not in context
  (click or `P` to add), the filled blue badge when it is (click to remove), always in
  the same place. The other controls (ask agent, open in new tab, collapse, set as
  README, close) appear on hover under ⋯ and ×. Their slots stay reserved while
  hidden, so hover or keyboard focus cannot move the pin onto another action.
  Section labels are a heading display of the markdown node. Rarely used tools
  live in one settings menu on the rail.
- **Kinds and knowledge categories carry no colour** (categories confirmed with the
  maintainer 2026-10-07). A node kind and a folder's category are told by glyph and word
  only; no hue is spent on them, so every colour on the board keeps a meaning. This
  settles the old Home folder-hue question: folders show their category tag, never a
  coloured square.
- **Retire is reversible** (confirmed 2026-10-07). "Retire from active context" only takes
  a card out of the brief; the card and its history stay. A retired card is dimmed in
  place, found by the board's Retired filter and by search, and restored from its
  Lifecycle tab; the restore is recorded with who and when, and is not a validation.
- **Lifecycle lives in menus; only "review due" reaches the card** (decided with the
  maintainer 2026-10-07, variant A in `LifecycleVariants.dc.html`). While a review is due a
  card shows one bottom line, `⧗ review due` (amber, outlined) with a short reason; a healthy
  card shows no lifecycle line. Rate, decay type, inherited or set, the four clocks and the
  outcome history live in the card's ⋯ → Lifecycle tab, folder settings and Home.
  "Unknown" appears only on Home folders, never on a card. Why: the brief tells the agent
  to doubt a due card, so the human sees that on the card too.
- **A portal's pin is its board's pin** (decided with the maintainer 2026-10-07). On a
  portal card the header pin, in the usual place, pins the linked board into the agent's
  working set (README and pinned cards in full, on every board); there is no separate card
  pin, which would only send the portal's summary while this board is open. Every other
  card keeps its card pin.
- **Relations are the edge layer, not node types.** Design work adds no node type;
  the vision's own `ask` node (move 3) is separate.
- **Any size, from a side pane to a full window.** The workbench lives in narrow agent-host
  panes, the resizable side browser in the Claude desktop app, and full browser windows. Every
  drawing shows the narrow end (600 px) and a full window before it is built, and the build
  is checked at 600, 1024 and 1920 px (proposal board
  "At 600 px" for the narrow end). Decided 2026-10-05, replacing the single 600 px reference.

## Build plan

Each wave pairs a vision move with the design that shows it. A wave is done only
when both halves pass its check. Status reflects 0.7.0 (see the vision's
implementation table).

| Wave | Vision | Function (build) | Design (proposal boards) | Done when |
|---|---|---|---|---|
| **0. Foundation** — ships alone, first | Moves 5, 9, 10 | Bundle Plex; controls inherit the font; type/radius/shadow tokens; meaning tokens per theme; theme renames (`dark` → Harbor, `light` → Daylight, neutral; no aliases); pin style that survives selection and attention; violet header bar replaces amber halos and focus fields | Today / Proposed, Tokens, Themes, Rail and node header, Nodes in context | No control renders in a fallback font; token test passes for all nine themes; reference cases pass at 600, 1024 and 1920 px; demo board regenerated |
| **1. Context made visible** — next batch, with the curation evaluation | Part 1 bet, moves 0a, 2, 7 | Surface `context_reads` (already recorded since 0.7.0: who read, which nodes were delivered) per node and per board as read / not read / changed since read, using revisions; who pinned; activity lens and session receipt from presence activity and revisions; board pins (`board_pins`, tiered brief, `canvas_board pin/unpin`) and Home's pinned-boards section | What the agent did with context, Nodes in context, Board pins, Home (Folders) | From the board alone, a person can answer "did the agent read what I pinned, and is its copy current?" The evaluation in `docs/evals/` reads the same data |
| **2. Connected memory views** — next batch, remaining wiki/graph work | Moves 0, 14 | Board map projection (generated like the code graph), wiki links, direct cross-board card edges, previous-board chains; the same relation graph read by the agent as `canvas://graph{?focus,depth}` (one projection, two readers; the brief is its depth-1 neighbourhood) | Home Map, Home Graph | Map and Graph are generated from the library; orphans visible; works at 600 px and in a full window |
| **3. Relations layer** | Moves 0, 1, 13 | Edge `reason` and an open `kind` with a per-board vocabulary; relations carried in the brief's text form; "derived from" with staleness from provenance and recipes; relation queries for the inspector | Relations, Lineage, One relation layer | Hovering a node explains each link; a changed source turns downstream nodes amber; the agent's brief includes relations |
| **4. Frame host and viewers** | Moves 5, 9 | One frame host passing the full theme tokens; json-render defaults to the canvas theme with an opt-out for design experiments; zoomed-out cards for unmounted frames | Node types 1–3, Zoomed out | No viewer draws its own background; 20 portals mount no more frames than none; fit-all is readable |
| **5. Agent output and groups as pages** | Moves 3, 0 | Work items, gates and asks as nodes; make board / inline board; opening a group keeps its outside links | One relation layer (agent flow), Lineage (open a group) | Agent output is styled by the same shell and tokens; a group opened as a board shows its outside stubs |
| **Later — share ladder** | Part 3 | Read-only link, comments, second writer; at step 5, org → team → personal scopes with configurable categories and per-user pins | HomeTeam is the earlier two-root look ahead; updated scope/category drawings are required before building, retaining explicit publication and locked cards for unreadable boards | Exports and shared views inherit the tokens; a viewer sees the same meaning colours; nothing personal reaches a wider audience without explicit publication |

**Folders and portals (decided 2026-10-06).** Home uses folders as the visible hierarchy (where a
board lives, one place); portals and links are how boards relate: a many-to-many graph the agent
navigates through links and backlinks on `canvas://boards`, and that Map and Graph draw. This
replaces the review's portal-derived levels as the navigation tree. Where a board's folder and its
links disagree, the Map shows it (folders as regions) rather than forcing them to match.

**Context lifecycle (direction added 2026-10-07).** [Vision move 13](product-vision-2026-09.md#13-context-lifecycle-and-recipe-cards-m-then-later-classification)
extends Wave 3's source-change warning into evidence-backed review: decay type/rate, triggers,
validation evidence and review outcomes. Amber means needs review, not false. Read receipts,
content revisions, evidence validation and task relevance remain separate. The lifecycle needs
its own review-state drawings and implementation slices before building; existing Lineage
drawings do not specify all those states. This adds no Wave 1 prerequisite and leaves the
curation evaluation after its remaining features. Local categories and lifecycle data work
without a model; Jev-style classification is optional longer-term assistance, not a dependency
of Wave 3 or the org/team/personal structure.

## Definition of done for any design work

1. It is drawn in the proposal canvas first, at 600 px and at full-window width.
2. It is built to the drawing, with the function it shows (see the plan above).
3. It passes in all nine themes and at the three Chromium widths, 600, 1024 and 1920 px.
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
