# Design: the system and when it gets built

*Updated 2026-10-12. Companion to [the vision](product-vision-2026-09.md): the vision
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
| [`Chrome.dc.html`](design/Chrome.dc.html) | Rail at 690 px, node header (expand and context pin always visible, the rest under ⋯), bounded reference footer, section headings, floating chrome | 0 |
| [`EmptyState.dc.html`](design/EmptyState.dc.html) | Empty board: Drop files here, Paste a link, Start a note with collaboration guidance, then a separate agent-first path | 0 |
| [`Context.dc.html`](design/Context.dc.html) | Nodes in context: every state, the count chip, the command bar | 0–1 |
| [`NearPin.dc.html`](design/NearPin.dc.html) | Near a pin: the dotted “near” chip on a pinned node's unpinned neighbours, tethers on hover, the moment of change, combinations, 600 px; ships with the brief carrying neighbours (title + summary, reason “near <pin>”) | 1 |
| [`ContextChip.dc.html`](design/ContextChip.dc.html), [`ContextChip600.dc.html`](design/ContextChip600.dc.html) | The one context chip (decided with the maintainer 2026-10-07: placement, near muted, quiet empty state, agent-pin dots, “N in context” at 600 px): top bar, right, replacing the floating ContextPinBar and the ContextBudget meter; at rest for cards, near, boards, agent-only pins, nothing pinned; opened into Cards (full, × unpin, clear all), Near (derived, title + summary, no ×, Pin to promote) and Boards (read state, × unpin). **A pinned board travels as a map** (decided 2026-10-07): folder, README summary, each pinned card's title + summary, links and backlinks; the agent pulls a card or board in full itself, so the chip shows no full / summary / not-sent state. **A cost, not a budget** (decided with the maintainer 2026-10-08): the chip shows what the brief costs as ≈ tokens, with no meter, share or clipped state; when the host reports its agent's token usage the panel names that count too (“Copilot’s whole context holds 42.8k tokens”). The brief's size limit stays internal as a page size. At rest it is the summary, always visible and right-aligned in the top bar at every width; the details open only on click. At ≤ 760 px the summary is “N in context” with no token text, and the bar gives way in this order: session id and counts; Export, Present, zoom and fit fold into ⋯; agent chip to its avatar, Start agent session to its icon; the board name truncates — the dot, board pin, summary and ⋯ never collapse. Harbor and Daylight, 600 px. Supersedes the chip wording on Context, NearPin and BoardPins | 1 (slices 4b, 5b) |
| [`LinksChanged.dc.html`](design/LinksChanged.dc.html) | Links that changed after the agent read a card (decided with the maintainer 2026-10-08: option C of LinksOptions): the mark sits on the edge, not on both cards — a person’s new or edited link says “not seen by <agent>” (muted, eye-off) until a read carries either end, an agent’s link says “by <agent>” (violet). <agent> is whichever agent is attached (Claude, Codex, Copilot, any other), never a fixed name; the drawing’s “Claude” is an example. Marks stay quiet on a board no agent has read; link authorship (built 2026-10-09 to [`LinkAuthorship.dc.html`](design/LinkAuthorship.dc.html)) stays until a person edits or relabels the link, as a violet ✦ before the label with who drew it and when in the hint — the agent today; another person's initial on shared boards (hosted version, Part 4) is not built; card text changes keep amber “changed” and win on the card; links-only changes show per card only in the context panel (“links changed”, neutral); relation inks never change; 600 px | 1 |
| [`LinksOptions.dc.html`](design/LinksOptions.dc.html), [`LinksOptions600.dc.html`](design/LinksOptions600.dc.html) | The connections question as three options on one board (one text edit, one link by you, one by the agent, plus the context panel rows): A as built (every change “changed”), B a separate amber “links changed” on both cards, C the mark on the connection (“not seen by <agent>”, neutral) — C decided with the maintainer 2026-10-08; A and B not chosen | 1 |
| [`HeaderMarks.dc.html`](design/HeaderMarks.dc.html) | A node header with more than one mark (decided 2026-10-08): the title keeps at least 140 px (all of it when shorter; only amber may push it to 80). “By <agent>” is authorship, not state, so it never takes a chip: a violet sparkle on the type icon at every width, its words in the icon's hint. The one state chip (near, or the read state) folds to its 22 px glyph and then into the icon's hint as the title needs the room; amber “changed” never folds. The icon's one hint holds the full title, the byline and any folded word — never other cards' titles. 260, 340 and 480 px, Harbor and Daylight. Supersedes the byline chip on AgentContext. Read state shows on pinned cards only (decided 2026-10-08: "read" only accumulates and spans boards, so on unpinned cards it would mark everything; the receipt and lens say what was read) — the near + read cases are superseded | 1 |
| [`LinkAuthorship.dc.html`](design/LinkAuthorship.dc.html) | Who drew a link (decided 2026-10-08): an agent's link carries a violet ✦ before its label until a person edits, retypes or relabels it — a read never clears it; another person on a shared board shows their initial (hosted version, Part 4); the board's only person shows no mark. “Not seen by <agent>” follows, behind a hairline, on a person's new link until the next read; it folds to its glyph on a short line or below 60 % zoom, and below 35 % labels go and only marks stay. The hint names who drew it and when, and who took it over. Harbor and Daylight | 1 |
| [`SeeChange.dc.html`](design/SeeChange.dc.html) | Built locally (2026-10-10): Before above After (the receipt stays 290 px), changed words marked (removed struck through and muted, added in a violet tint), excerpts cut with “…”, Undo this card and its states (✓ Undone · You edited it since · Open its board to undo), the Edited row’s Undo (Undone · Kept your edits). Long scroll boxes start at the first changed word with context above it; the receipt uses opaque `--c-panel` so underlying marks do not bleed through. At ≤ 760 px the agent's initial has its violet ring and phase dot; clicking opens live counts, the dim-untouched switch and Open session panel (ContextChip600 wins over Pane600). Checked at 600/1024/1920 in all nine themes | 1 |
| [`AgentContext.dc.html`](design/AgentContext.dc.html) | What the agent did: read, created, edited, suggested, out of date; lens and receipt. Built (2026-10-10) with two placements of our own: the live "Claude · this session" counts sit in the top bar's agent chip ("2 read · 1 edited", press to dim untouched cards; Pane600's wording), because the bottom of the canvas belongs to the command bar; "see change" lives on the receipt's Edited lines, not on the card, which has no meta line — its open view is now built to SeeChange. The drawing's Suggested state is dropped (maintainer, 2026-10-10: the agent changes the canvas directly; asks and suggestions go through the composer) | 1 |
| [`BoardPins.dc.html`](design/BoardPins.dc.html) | Board pins: where you pin a board, the tiered brief, the context chip across boards; each pinned board carries its category glyph and review state (due count, the brief’s “review due” / “lifecycle unknown” lines) | 1 |
| [`Home.dc.html`](design/Home.dc.html) | Home — Folders: library tree, pinned boards, README, board details. Folders carry no colour (the 2026-10-07 decision supersedes the drawing's hues); the folder's README line waits until folders have a README. Map and Graph are now available. A card selects the board into details; Open board (or a double-click) opens it | 1, 2 |
| [`CategoryEditor.dc.html`](design/CategoryEditor.dc.html), [`Uses.dc.html`](design/Uses.dc.html), [`Home.dc.html`](design/Home.dc.html), [`Lifecycle.dc.html`](design/Lifecycle.dc.html), [`Lifecycle600.dc.html`](design/Lifecycle600.dc.html) | Selected 2026-10-14: C1 compact category inspector; R2 read-only chooser then separate preset editor; H2 individual-card Home Review queue; V2 real card beside a docked review drawer, lower dock at 600 px. Supersedes earlier category full-form and review-modal geometry; retains inheritance, evidence guards and independent clocks | Implemented; owner acceptance pending, no release claim |
| [`HomeMap.dc.html`](design/HomeMap.dc.html), [`HomeGraph.dc.html`](design/HomeGraph.dc.html) | Home — Map and Graph views of the library; implemented with the wave-2 deviations below | 2 |
| [`HomeTeam.dc.html`](design/HomeTeam.dc.html) | Home on a team server: workspace and personal libraries, per-user pins, moving a board into the workspace, locked links, folder categories and due counts in both libraries (look ahead) | Later (hosted version, Part 4) |
| [`Categories.dc.html`](design/Categories.dc.html), [`CategoryEditor.dc.html`](design/CategoryEditor.dc.html), [`Lifecycle.dc.html`](design/Lifecycle.dc.html), [`Lifecycle600.dc.html`](design/Lifecycle600.dc.html) | Knowledge categories as a folder property (glyph + word, no colour; set here vs `↳` inherited; dashed “unknown”), folder settings, the one workspace list with lifecycle defaults and templates (org/team/personal is one option), a solo-research workspace; on cards: lifecycle override (never category), the four clocks, review outcomes with evidence, the board's review list, the brief. Review due is amber **outlined** with ⧗ as the card's bottom line, only while due; changed-since-read stays amber **filled** with △ in the header. 600 px | For review (move 13: local categories and lifecycle are implemented; shared scopes come with the hosted version, Part 4) |
| [`LifecycleVariants.dc.html`](design/LifecycleVariants.dc.html), [`Restore.dc.html`](design/Restore.dc.html) | Where lifecycle shows: variant A (review due on the card while due) vs B (only in the ⋯ menu, a count on the board), with the shared ⋯ → Lifecycle entry; retiring and restoring a card: dimmed in place, Retired filter, search, Restore in the Lifecycle tab, Undo toast, history with who and when | A chosen 2026-10-07; restore confirmed |
| [`Relations.dc.html`](design/Relations.dc.html) | Relations on a research board, today vs proposed; edge anatomy; relation inks | 3 |
| [`Flows.dc.html`](design/Flows.dc.html) | Data lineage with staleness, what a finding rests on, opening a group | 3, 5 |
| [`Uses.dc.html`](design/Uses.dc.html) | One relation layer for research, dependencies, decisions and agent flows | 3 |
| [`Types1.dc.html`](design/Types1.dc.html)–[`Types3.dc.html`](design/Types3.dc.html) | Every node type, today vs proposed | 0, 4 |
| [`Zoom.dc.html`](design/Zoom.dc.html) | Fit-all readability when frames are unmounted | 4 |
| [`Pane600.dc.html`](design/Pane600.dc.html) | Home and a board at the narrow end, 600 px | all |
| [`Vision.dc.html`](design/Vision.dc.html) | How each design area maps to the vision, and the open decisions | — |

**Empty-board onboarding (owner decision, 2026-10-17).** Keep both starting paths visible:
Drop files here, Paste a link, and Start a note, each with a short explanation. The note
invites the person to ask their agent to help develop the idea. A separate “Or start with
your agent” section says “Give your agent a task and ask it to work on this board.” This is
guidance, not an agent-launch button, and remains visible with Agent sessions (Beta) off.
With the beta on, the existing Start agent session action sits below that guidance.
The existing panel, type and colour tokens stay; actions form one readable column, and
short windows scroll the guide rather than cutting off either starting path.

**Canvas mouse gestures (owner decision, 2026-10-19).** Right-click on empty canvas
opens the existing creation menu on release. Holding the right button and moving more
than 5 screen pixels pans; releasing after a drag never opens a menu, even when the
pointer returns to its starting point. Small hand jitter remains a click. Cancelled
gestures open nothing. Right-drag over cards, middle-button drag, Space-drag and the
existing double-click menus remain available. Menu appearance is unchanged.

**Workspace UI opt-ins (owner decision, 2026-10-16).** Main rail **Settings** contains
**Agent sessions (Beta)** and **Knowledge lifecycle (Beta)**, each with a small switch,
both **OFF by default**. These preferences persist workspace-wide across reloads and
board changes: they are library-wide settings, never board snapshot state. Restoring a
board snapshot must not change them. Chrome §7 is the chosen settings drawing; this
decision gates the session and lifecycle surfaces described elsewhere in this guide.

Every main Settings item (including existing actions and both opt-ins) has an explanatory,
nonnative tooltip on pointer hover and keyboard focus. Tooltips render outside the scrolling
menu in an overlay, stay within the viewport, and do not clip at the menu boundary. Do not
use native `title` tooltips; associate the explanation with its control for assistive technology.
The lifecycle explanation leads with context lifecycle and boards/cards decaying as their
relevance fades, before naming its tools and explaining that turning it off preserves data.
Keep the menu scrollable in short windows and all items keyboard-reachable. Saving a switch
uses `aria-disabled` with an action guard, not native disabling that drops keyboard focus;
the focused switch announces its new state, and board shortcuts never own menu keys.
Trace uses the same inline switch, without a Beta label or submenu. Clear trace stays a
separate Settings action while capture is enabled or recorded trace cards remain.
Relation filters sit 8 px below the canvas top when lifecycle is off, regardless of the
session opt-in. Reserve the lifecycle row's space only while its filters are visible.

- **Agent sessions OFF** hides session chips, Start agent session, timeline, work items,
  composer and receipts. It does not end or detach attached agents. Normal writer visibility
  remains, and approvals, scope fences, human edit locks and veto protections still apply;
  required approval decisions must remain reachable outside the hidden session UI. Restore
  the bottom-center **N nodes in context** pill for pinned cards on the current board, with
  Clear all and its styled tooltip, independently of attachment or lifecycle. Hide it on Home
  and when no cards are pinned. Keep the top-bar context summary unchanged. The selection
  toolbar wraps within the canvas above the pill; at narrow widths a visible minimap sits
  10 px above the toolbar's measured height, or above the pill if nothing is selected. Fit
  and focus reserve the pill's screen-space bounds. ContextChip shows this footer exception
  to the earlier one-chip decision; enabling sessions gives the footer back to the composer.
  Footer collision layout uses the actual canvas width, including space taken by Review or
  session panels: at 1200 px or less the minimap sits above the measured composer/selection
  stack, with a 10 px gap even when the minimap magnifies on hover. Hidden composers reserve
  no space. Wider canvases keep the minimap in the bottom-right corner.
- **Knowledge lifecycle OFF** hides Home Review, card Review, review-policy and category
  management, lifecycle filters, due marks and retired marks/dimming. Saved policies,
  categories and review records remain intact. Open lifecycle drafts are suspended without
  saving or discarding them and resume when enabled again. Ordinary folders, boards, pins
  and relations remain available; hiding lifecycle never removes their ordinary controls.
- These are **UI opt-ins**, not backend security boundaries or API disables. Background
  agents and API operations retain their contracts and protections. Retirement still excludes
  retired content from agent context even while retired marks and lifecycle controls are hidden.
  Context counts and nearby-context marks exclude retired cards regardless of the opt-in;
  raw pin membership remains saved, so restoring a retired card restores its active pin.
  Clear all removes all saved pins, including retired cards excluded from the displayed count.
  A successful review save is acknowledged even if its dock is suspended before the reply:
  clear the saved draft, reload its preconditions, and retain retirement Undo on resume.

**Near cards distance (owner decision, 2026-10-14).** Near means an edge-to-edge
gap of at most 600 canvas pixels, not distance between centres. Large cards do
not need to overlap to qualify. Keep the five nearest unpinned cards per pin;
the brief, chip distances, tether numbering and nearest-pin drag preview use the
same gap. The dotted boundary expands the whole pinned rectangle by 600 pixels,
with rounded corners, rather than drawing a circle around its centre.

**Escape cancels selection (owner decision, 2026-10-14).** Escape returns board
relation and To review / Retired filters to All, and clears selected cards or
links. In Home it clears the selected board/card in Folders, Map or Graph
without leaving that view or resetting its camera; the Review queue's search
and source-warning filter also clear. Open menus/dialogs consume Escape first, and typing in a
text editor or search field does not silently reset the underlying selection.
Category and relation-preset dialogs retain Escape ownership after a busy save/apply
disables the focused control and focus falls back to the page body; nested menus and
unsaved-change confirmations still dismiss first without discarding drafts.
Agent session popovers accept Escape immediately on opening, consume it before underlying
selection and return focus to their initial button without scrolling the canvas.

**Authorship simplification (owner decision, 2026-10-12).** Remove the violet stars from
card type icons and relation pills. The type-icon hint still names who wrote or edited the
card; the relation hint still names who drew it and when, including later takeover.
Bare lines also expose that hint, so removing an unlabelled link's star does not remove its
authorship information. This supersedes the star treatment in HeaderMarks, LinkAuthorship
and LinksChanged above. Blue context pins, violet read-state marks and the agent's activity
lens remain separate and unchanged.

**See change runtime bounds (2026-10-10).** In short windows the whole receipt scrolls inside
the canvas region, keeping Undo and History reachable. The Edited row follows individual restores
as well as bulk Undo. On another board, View diff becomes Open <board> to compare, even when the
session only added or removed cards; snapshot ownership checks stay unchanged.

**Viewer refresh handoff (2026-10-10).** Keep the painted embedded JSON/graph viewer visible
while its replacement loads and restores tab-local state. After React commits, the replacement
advances its own rendering cycle through two animation frames before acknowledging readiness.
Authenticate that acknowledgement by node ID, nonce and source window, then wait two parent
animation frames before promotion. The replacement renders behind the old opaque iframe, inert
and excluded from accessibility until promotion; `visibility:hidden` would suppress rendering.
Keep the iframe stack's z-indices local. An obsolete replacement cannot promote after a newer
source arrives.
Standalone viewers and HTML/artifact viewers retain their existing load path; no new styling.

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
  live in one settings menu on the rail (built 2026-10-08: theme, snapshots, minimap,
  shortcuts, trace, feedback; now also Agent sessions (Beta) and Knowledge lifecycle (Beta),
  both initially off, with library-wide persistence and explanatory hover/focus tooltips.
  Theme and Trace open in place with a "‹ Settings" row). The
  Eraser stays beside Text note — it is the only way to remove an annotation — so the rail
  has 13 tools (Chrome.dc.html §7, updated to match).
- **Kinds and knowledge categories carry no colour** (categories confirmed with the
  maintainer 2026-10-07). A node kind and a folder's category are told by glyph and word
  only; no hue is spent on them, so every colour on the board keeps a meaning. This
  settles the old Home folder-hue question: folders show their category tag, never a
  coloured square.
- **Retire is reversible** (confirmed 2026-10-07). "Retire from active context" only takes
  a card out of the brief; the card and its history stay. A retired card is dimmed in
  place, found by the board's Retired filter and by search, and restored from its
  Review dialog; the restore is recorded with who and when, and is not a validation.
- **Lifecycle lives in menus; only "review due" reaches the card** (decided with the
  maintainer 2026-10-07, variant A in `LifecycleVariants.dc.html`). While a review is due a
  card shows one bottom line, `⧗ review due` (amber, outlined) with a short reason; a healthy
  card shows no lifecycle line. Rate, decay type, inherited or set, the four clocks and the
  outcome history live under ⋯ → Review → Settings and history, folder settings and Home.
  "No review policy" appears in Home's selected-folder summary, never on a card. Why: the brief tells the agent
  to doubt a due card, so the human sees that on the card too.
  **Freshness correction, 2026-10-18:** newly authored cards have no warning until
  their effective decay policy or an actual source invalidation requires review.
  Creation is not evidence validation. Historical imports and undated existing cards
  do not gain a new freshness clock; edits never restart it. Navigation groups and
  portals skip inherited factual decay unless explicitly assigned a card policy.
  An explicitly due group's same outlined footer sits below its children in the
  group frame, never as the empty body's expanding first child. The Lifecycle
  artboards' warning tokens, glyph, copy and compact row remain unchanged.
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
when both halves pass its check. **Current progress, 2026-10-12:** the implemented
Wave 2/3 scope and acceptance fixes are pushed in the
[combined implementation](https://github.com/pskoett/pmx-canvas/commit/11dc311732d8c12acc86dda12b269539df8fa5b3)
and [stabilization follow-up](https://github.com/pskoett/pmx-canvas/commit/fd63c3c611e680864d444532ca3ef7bb79cd171e).
Home Map/Graph now have live updates, counted filters and selection details; Graph
follows the topology-driven navigation acceptance revision below. Explicit library browsing survives agent
board switches, preserving camera, selection and gestures until the human opens a target.
Wave 3 implements per-board relation vocabularies, provenance, source-driven review and
[knowledge categories and context lifecycle](plans/plan-017-knowledge-categories-and-lifecycle.md).
The final [stabilization record](plans/plan-018-connected-memory-wave-2.md#delivered-checkpoint-2026-10-12)
has 1,444 unit, 306 client and 276 headed browser tests, 20 repeated save-race cases,
fresh headed CLI E2E and live human/real-agent transport checks. Widths and all nine themes
were inspected; independent board vocabularies persist across switching/reload. All five
[CI jobs](https://github.com/pskoett/pmx-canvas/actions/runs/38218734543) pass. These gates
do not establish complete drawing parity or replace the owner's acceptance.

**Remaining acceptance:** the owner's test pass since 0.8.2 remains open. The real-agent
curation evaluation moved to the end of the plan on 2026-10-19; the post-0.9.0 order of
Waves 4 and 5 is in [plan 019](plans/plan-019-post-0.9-roadmap.md). The actual Amp embedded context-pill opening, native Copilot/WebKit,
native Windows UI and registry-installed execution remain unverified. Dense Fit labels need
selection/local focus for detail, not a claim of large-library readability. The sketch gaps
below remain implementation work. The [release gates](RELEASE.md) still apply before a release;
the owner has not authorized one. Version remains 0.8.2, with no release, tag, publication,
deployment or version bump. This is implementation status, not release approval.

**Sketch parity, clarified 2026-10-11.** `Relations`, `Flows` and `Uses` remain the
vision's target designs, not screenshots of the shipped workbench. The Wave-3
foundation does not implement every interaction pictured in them. It provides
per-board vocabularies, semantic inks, separate endpoint slots, authored reasons,
evidence/source/use queries, downstream review qualification and view-only
highlights. Parallel-pair count badges, cycle/affected counts, the compact inline
edge editor, amber stale-lineage strokes and the Show lineage / Show on canvas
actions are not implemented. The current editor is a context menu with text
dialogs; source changes appear as review-due card footers, not recoloured edges.
Group drill-in with breadcrumbs and outside endpoint stubs belongs to Wave 5.
The sketches' suggested-link Accept/Dismiss treatment was superseded by the
2026-10-10 direct-edit decision recorded above; it is not a pending acceptance
workflow. A demo of existing features must not be used to claim full sketch parity.

| Wave | Vision | Function (build) | Design (proposal boards) | Done when |
|---|---|---|---|---|
| **0. Foundation**: shipped in 0.8.0; remaining foundation gaps ship with plan 019 step 3 | Moves 5, 9, 10 | Bundle Plex; controls inherit the font; type/radius/shadow tokens; meaning tokens per theme; theme renames (`dark` → Harbor, `light` → Daylight, neutral; no aliases); pin style that survives selection and attention; violet header bar replaces amber halos and focus fields | Today / Proposed, Tokens, Themes, Rail and node header, Nodes in context | No control renders in a fallback font; token test passes for all nine themes; reference cases pass at 600, 1024 and 1920 px; demo board regenerated |
| **1. Context made visible** — its curation evaluation moved to the end of the plan (2026-10-19) | Part 1 bet, moves 0a, 2, 7 | Surface `context_reads` (already recorded since 0.7.0: who read, which nodes were delivered) per node and per board as read / not read / changed since read, using revisions; who pinned; activity lens and session receipt from presence activity and revisions; board pins (`board_pins`, tiered brief, `canvas_board pin/unpin`) and Home's pinned-boards section | What the agent did with context, Nodes in context, Board pins, Home (Folders) | From the board alone, a person can answer "did the agent read what I pinned, and is its copy current?" The evaluation in `docs/evals/` reads the same data |
| **2. Connected memory views** — implemented, verification gates apply | Moves 0, 14 | One board/card projection for Home, links/backlinks, brief discovery and `canvas://graph{?focus,depth}`; saved wiki ID bindings, direct cross-board card edges, previous-board chains, persisted Map positions | Home Map, Home Graph (deviations below) | Map and Graph are generated from the library; orphans visible; works at 600 px and in a full window |
| **3. Relations layer** | Moves 0, 1, 13 | Edge `reason` and an open `kind` with a per-board vocabulary; relations carried in the brief's text form; "derived from" with staleness from provenance and recipes; relation queries for the inspector | Relations, Lineage, One relation layer | Hovering a node explains each link; a changed source turns downstream nodes amber; the agent's brief includes relations |
| **4. Frame host and viewers** | Moves 5, 9 | One frame host passing the full theme tokens; json-render defaults to the canvas theme with an opt-out for design experiments; zoomed-out cards for unmounted frames | Node types 1–3, Zoomed out | No viewer draws its own background; 20 portals mount no more frames than none; fit-all is readable |
| **5. Agent output and groups as pages** | Moves 3, 0 | Work items, gates and asks as nodes; make board / inline board; opening a group keeps its outside links | One relation layer (agent flow), Lineage (open a group) | Agent output is styled by the same shell and tokens; a group opened as a board shows its outside stubs |
| **Later: hosted version** | Part 4 (moved from Part 3, 2026-10-19) | Read-only link, comments, second writer, accounts and roles; org → team → personal scopes with configurable categories and per-user pins; built once for the ChatGPT Sites and later Cloudflare editions | HomeTeam is the earlier two-root look ahead; updated scope/category drawings are required before building, retaining explicit publication and locked cards for unreadable boards | Exports and shared views inherit the tokens; a viewer sees the same meaning colours; nothing personal reaches a wider audience without explicit publication |

**Folders and portals (decided 2026-10-06).** Home uses folders as the visible hierarchy (where a
board lives, one place); portals and links are how boards relate: a many-to-many graph the agent
navigates through links and backlinks on `canvas://boards`, and that Map and Graph draw. This
replaces the review's portal-derived levels as the navigation tree. Where a board's folder and its
links disagree, the Map shows it (folders as regions) rather than forcing them to match.

**Home Map/Graph acceptance revision (2026-10-18, owner-authorized Claude/Oracle agreement).**
Graph is one zoomable, topology-driven **Library > Board > Card** explorer. The canonical
`HomeGraph.dc.html` draws all three levels with actual relationships. This is the acceptance
target, not a claim that UI implementation or owner verification is complete. Folder paths
remain metadata and filters; they never determine Graph geometry.

- **Library:** named board nodes connected by neutral, undirected, counted bundles of
  original evidence for each unordered board pair. Combining directions and kinds does not
  invent a board-to-board fact. Internal counts and missing targets are separately qualified.
- **Board:** the board's internal card-relation topology, alongside external neighbor boards.
  Membership alone draws no evidence edge; there is no central ownership hub dictating layout.
- **Card:** the focused card with exact one-hop qualified neighbors, incoming on the left and
  outgoing on the right. Keep board identity on every endpoint, original direction and the
  source-board vocabulary. Undirected `related` has no arrow; `depends-on` points from dependent
  to prerequisite. Opposite authored directions remain separate facts, including when the same
  qualified neighbor participates on both sides.

Ordinary node **click, Enter or Space drills** into that board or card's graph, including
external neighbors. An **edge selects its exact evidence** in the existing bottom inspector;
a bundle exposes its constituent facts, never a synthetic reason. **Back** restores the prior
scene, camera, query, filters and selection. The breadcrumb instead goes up the ownership
hierarchy: Library, owning Board, Card; it is not traversal history. **Open board/card** is
separate and opens content, never an implicit consequence of drilling or inspecting evidence.

Unconnected boards and cards occupy a **labelled, clickable tray**, not invented links.
Large connected sets use bounded initial display with search and explicit reveal actions;
show displayed, total, filtered and hidden counts so omissions are never mistaken for absence.
Search can reveal a hidden target without shrinking every label. Entry and reveal preserve
readable scale at 100%; explicit Fit may show a dense extent. The header separately counts
drawn nodes outside the usable viewport, filtered nodes and nodes beyond the display limit.
Card entry centers the focused card; mutual and undirected neighbors start below it, not below
the deepest side bank. Display bounds do not truncate inspector evidence or change the graph
API. No unverified numeric display limit is a design constant.

Initial layout uses a **deterministic bounded force solve** and caches the settled positions.
Owner interaction follow-up (2026-10-18): **dragging reheats the graph** at every exploration
level. The held node follows the pointer through occupied space; nearby nodes repel and real
links pull their neighbors. After release the dropped node stays put while the rest cools and
settles, then animation stops. Canceling restores the whole pre-drag layout. Card directions
start in left/right banks; manual rearrangement never changes the authored arrows.
Dense-graph follow-up: each node shares a gentler weighted pull across its links, rather than
accumulating full-strength springs with its degree. Keep breathing room instead of packing
connected nodes against their collision stops. Initial Card banks use the same spacing rule.
Live updates alone keep existing nodes anchored and preserve camera and selection; place
additions without globally reshuffling the scene. Graph positions remain view-local, not saved
board coordinates. Use the existing stack, with no new framework or dependencies. Graph and
Map retain separate view owners, sharing projection loading and the inspector shell only.
Server/API `focus` and `depth` contracts remain unchanged; these are not Graph navigation controls.

Graph nodes use one 220 × 96 px outlined footprint, with glyph, title and metadata inside it.
Collision clearance, boundary ports, obstacle-avoiding routes and Fit share those bounds.
The 64 px node-spacing gap reserves breathing room and a corridor outside each node's 8 px route clearance;
settling separates rectangles instead of allowing springs to close those corridors. Hover
emphasizes a node's incident links without fading unrelated connections.
External boards use dashed outlines. Count/type labels reserve their own non-overlapping
rectangles outside node bodies; Fit includes those rectangles. The view permits line crossings,
not paths through titles. No old slot grid, ring or pair-only navigation remains alongside it.

Graph's full-width bottom inspector starts **collapsed and compact**, below the view and legend,
separate from filters. Selecting evidence exposes it in that dock; expanding/restoring retains
selection and camera. Map retains its existing behavior and **280 px default dock**, not a
redesign. In the existing docking shell, drag the separator or use Up/Down and Home/End to
resize. The upper bound reserves 160 px for the graph when the window has room. Collapse
retains the selection/action header; restore keeps height, selection and camera.
The relation list scrolls internally. A reserved dock keeps selecting a card from shifting
the view, and the same bottom layout remains usable with the narrow filter overlay closed.
The fixed action header has 8 px bottom spacing and a divider before the scrolling list;
the empty heading reserves the collapse control's full 36 px height above the help text.
Owner readability follow-up uses 14 px relation text and controls (36 px minimum height),
15 px headings and 13 px secondary text. Inspector chrome never scales with canvas zoom.
Owner follow-up (2026-10-17): Map matches this inspector visually, not functionally. Map
retains board tiles, persisted positions, Reset position and connection Open actions; it does
not inherit Graph drill navigation or Back. Both narrow filter toggles say Filters, and a
selection never opens that overlay just to show relations in the separate bottom dock.
Map nests and collapses neutral folder regions; dragging persists top-left `mapPosition`
in SQLite and a refused write rolls back. Both views update from the shared projection
without resetting the camera or selection. An agent opening a board does not eject a human
browsing Map/Graph; explicit Open board/card returns to the board. Board-edit shortcuts and
controls are unavailable while that library view is active. Its context chip lists all
workspace board pins, including the agent's active board, without hidden-board card controls.

**Remaining drawing deviations.** No synthetic Home board, portal-derived hierarchy, or
category hues: later folder/meaning-colour decisions override those marks. Map board tiles
use consistent dimensions rather than count-based sizes, and no unqualified age fading or
token estimate is shown. Both sidebars contain filters only and overlay the view at 600 px;
selection details stay in the shared bottom dock. Graph positions/display settings
are view-local, not saved board coordinates. Folders remain independent of links. Remote card
connections use the source footer and human More-menu picker, not remote canvas
lines; auto-arrange remains local and static export retains explicit external
connection evidence.

**Reference-footer correction (2026-10-18).** Chrome's footer keeps every remote
connection inside one keyboard-focusable scroll region, capped at 40% of the card
body and 132 world pixels. Short lists retain their natural height; long lists
cannot consume the document or its actions. Unmodified wheel and navigation keys
scroll references instead of moving the canvas. No graph data is collapsed or removed.
Reading expanded Markdown, closing it or following a link without input preserves
the exact source and revision. Pending real edits still finish before navigation.

**Owner-guide fixes (2026-10-20).** The same reference list follows cards into focus
mode, above the provenance strip, capped at 132 screen pixels there. It retains every
target without displacing the document. A refused Markdown save keeps the reader and
its draft open instead of navigating away. Hidden connection handles do not receive
pointer hits; their enlarged grab areas activate with the visible handles on hover,
selection or keyboard focus. Flow-action hints fit the native card or expanded panel,
whichever actually contains them. The shared Map/Graph inspector reserves one trailing
pixel so integer scroll extents do not cut the last row's fractional border.
The guide uses the current Library → Board → Card explorer described above, not the
removed stationary expansion controls. Dense Fit remains an overview, and unfinished
Relations/Flows/Uses drawings and unavailable platform checks remain separate from fixes.

**Acceptance follow-up (2026-10-13).** ContextChip600's collapse order also applies when
agent names/counts fill a wider bar: fold actions into More before compacting sessions to
their existing initials and popovers. More owns keyboard focus as soon as it opens and
stays reachable through resize or count changes until it closes.
At extra-narrow widths with multiple attached sessions, compact spacing tightens and the
board name may ellipsize below its usual minimum; the status dot, board pin, context summary,
agent initials and More remain reachable. The switcher button must shrink with its wrapper,
not retain its intrinsic text width behind clipped controls.
External writers follow the same compact step, keeping their avatars, activity button and
accessible identity while giving the context summary room. At narrow widths, retained Updates
tracks the measured bottom of the Map/Graph toolbar, including wrapped tabs/counts, not a
fixed offset. It stays clear of Filters in both sidebar states; while filters are
open it compacts to an icon beside the sidebar rather than covering search.
The open session drawer sits above retained canvas receipts so its controls remain
reachable. Expanded Markdown uses the same wiki navigation as the card preview, after its
rich-editor blur save finishes. Missing-board creation captures that saved source; later peer
changes still refuse binding rather than overwrite the source. Medium
review policies require an explicit cadence; whitespace alone is not a revalidation method.
HTML viewer replacements acknowledge mount and paint before replacing the healthy document,
matching the existing JSON/graph handoff without changing the sandbox permissions.

**Wave-3 implementation decisions and deviations.** The relation legend uses the six fixed
inks and open kinds. Owner clarification (2026-10-13) moves editable Research/Dependencies/
Decision/Flow templates into **Home → Relation presets**, shared across the workspace like
Categories. Applying a saved preset explicitly copies its vocabulary to a selected board;
later template edits/deletion do not rewrite existing boards or connections. The board's
24 px dropdown is now a view-only filter: All relations plus kinds actually on that board,
with counts, never a preset name or “Custom vocabulary”. Rounded count chips remain.
The legend stays below the lifecycle filters, outside the
scrollable canvas. Relation categories wrap instead of using a horizontal scrollbar, including
long custom names; Fit reserves the legend's rendered height as well as the lifecycle filters.
Parallel links
receive separate endpoint slots. Hover explains endpoints, kind and reason; the expanded
card's Relations view uses the same qualified graph as agents, with navigable targets and a
pointer to shared Home settings. Connections are grouped into Evidence for/against, Sources, Used by and
other Connections. Reasons stay in the hint/inspector, not long pills covering both endpoints.
Owner correction (2026-10-16): relation dimming follows clicked focus, selection, or an
explicit relation filter, never pointer hover. Selecting a group keeps all its descendants
readable, including nested groups. Moving the pointer does not change that focus; clicking
blank canvas clears it. This supersedes the hover-triggered focus in the Relations drawing.
Research highlights evidence; Dependencies follows explicit downstream impact; Decision traces
option/if/chosen links backward from the selected outcome; with focus active, Flow reads existing AX step status.
Custom vocabularies use the local neighborhood. These are view-only, not a decision or execution engine. Remote cards
remain footer links, not long lines across boards.

Owner selection (2026-10-14): **C1 compact category inspector, R2 choose then customize,
H2 dedicated Home Review queue, V2 docked card review drawer**. These are implemented
directions in the current acceptance batch; owner acceptance is pending, with no release claim. The selected
drawings are CategoryEditor, Uses, Home, Lifecycle and Lifecycle600; they supersede earlier
full-form category editing and standalone review-modal geometry.
The owner-approved naming is **Review** in Home navigation, **Knowledge review** as the
queue page heading, and **Review card** in the drawer, followed by the actual card title.
Review concerns the context's reliability, not task completion or automatic validation.

C1 keeps a searchable neutral glyph-and-word category list beside **Basics / Review policy /
Usage** tabs, templates behind disclosure, and Save/Cancel with a dirty guard on leaving.
The Add category button stays 8 px below the search field, rather than touching its border.
Basics offers the starter glyphs as visible, neutral choices alongside the custom glyph input.
Choosing a glyph changes only that draft's glyph, not its name or review policy; Save commits it.
Folder inheritance, card-only lifecycle overrides and assigned-category deletion protections
remain. R2 starts with a read-only relation preview; **Customize preset** opens a separate editor.
Save changes the workspace template only. **Use on board** explicitly copies the saved vocabulary
to one selected board; existing edges and other boards stay unchanged, with no later auto-sync.
Opening before the workspace catalog arrives must still select the first saved preset when it
loads. An explicit new/deleted selection stays empty instead of silently choosing another preset.

V2 docks **Review card** beside the real rendered card, reachable from More, a due footer or the
expanded-card Review button; it does not substitute a text excerpt for the card. The 380 px
side dock becomes a lower dock at narrow widths, keeping content visible above. It asks for
one short check note and offers **Checked, still correct** or **Not now**.
The camera fits the reviewed card into the actual remaining canvas on opening, reopening
and resize. Keyboard focus must not add a native scroll offset beneath that camera;
the canvas clips overflow without becoming a scroll container.
Fit preserves the card boundary, not visibility of its entire body: expand or resize a
compact card to read content beyond its body viewport.
Not now writes nothing and leaves the current review state alone. **Settings and history**
discloses the policy, four clocks, advanced outcomes, recipes and retirement controls.
Four clock tiles stay separate; only read delivery is violet. New
review metadata clears the evidence draft and applied checkbox. Stale content/source observations
refuse validation; dirty Markdown must save, reload and be rechecked first. Close/Escape also
dismiss without writing. Retire/Restore are audited;
the post-retirement toast offers Undo. Filters dim nonmatches rather than deleting their spatial
context. Due footers use variant A, including collapsed cards; healthy cards gain no badge.
Home's tree is navigation only. The selected-folder summary reports category and actionable
**Review needed** counts, explicitly including descendants; **No review policy** is informational,
not a task. The summary opens H2's dedicated **Review** tab with individual cards, authoritative
card and board titles, reasons, last checked and **Open review**. Scope is the selected folder
plus descendants or the whole library. Search and Source warnings only narrow the queue;
long descendant options must not push the scope border or arrow outside the main pane,
including at 390 px. Check the pane and queue scroll widths, not only the root document.
Refresh retries unavailable observations. Nonretired cards with due or source warnings count
once, even with both; unknown policy alone is neutral, but explicit warnings still qualify.
Opening focuses the real card and dock and never validates it.
Board details prioritize Open board; agent README and link dumps belong in agent reads or Map/Graph,
not the human's opening flow. Categories and folder settings reuse themed ChoiceMenus and compact
controls; unused category deletion is confirmed inline, assigned categories name blocking folders.
Presets add only missing starter
entries and never overwrite edits. Medium cadence is an explicit required day count, never
inferred from the category name. Unknown stays unknown.

The `Flows` source-qualification extension distinguishes a portal's source warning from its
own lifecycle and labels cached observations. A durable dashboard does not suppress warnings
from a fast source. Dependency direction is source → dependent for derived-from/contradicts/
supersedes, dependent → prerequisite for depends-on. Only explicit dependencies propagate review.
Recipe refresh is a human-requested steering broadcast; Canvas does not execute the named tool.

**Context lifecycle (direction added 2026-10-07).** [Vision move 13](product-vision-2026-09.md#13-context-lifecycle-and-recipe-cards-m-then-later-classification)
extends Wave 3's source-change warning into evidence-backed review: decay type/rate, triggers,
validation evidence and review outcomes. Amber means needs review, not false. Read receipts,
content revisions, evidence validation and task relevance remain separate. Categories, Lifecycle,
Lifecycle600 and Restore supply the review-state drawings beyond Lineage. This adds no Wave 1 prerequisite and leaves the
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
