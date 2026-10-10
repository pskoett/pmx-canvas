# Design gaps — drawn, not built (audit 2026-10-08)

Every drawing in `docs/design/` for waves 0 and 1 (plus the 600 px reference) was compared with
the code, element by element. Waves 0 and 1 were thought done; these items were drawn and never
built. Wave 2+ drawings are out of scope (not built by plan). Spot-checked items are marked ✓.

## Wave 0 — the foundation (shipped in 0.8.0, these were missed)

| # | Drawing | Gap | Size |
|---|---|---|---|
| 1 | Chrome §7 | Rail Settings menu — **built 2026-10-08**; the drawing now keeps the Eraser beside Text note (13 tools) | done |
| 2 | Chrome §9 | Section labels: a markdown node shown as a heading — no titlebar, no footer, controls on hover. Not built. | M |
| 3 | Chrome §10 | Floating-chrome lane: fit and focus keep a 44 px lane clear at the top; the Updates pill is a small rounded "Updates 1" chip, not today's uppercase edge tab. Fit/focus only clear the bottom chrome ✓, so titles land under the pill. | M |
| 4 | Tokens §4 | Type scale with an 11 px floor: 66 sizes below 11 px remain in global.css ✓, more inline. | M |
| 5 | Tokens §4 | Radii and elevation tokens barely used (174 raw radii; `--e-2` used once); ~15 chrome surfaces hard-code black shadows, so Daylight/Sepia shadows are not ink-tinted; glows remain on active/neighbour/search-match nodes. | M |
| 6 | TokenSystem / Main / Themes | Harbor palette drift (`--c-panel-soft`, `--c-text-soft`, `--c-dim`, an accent-blue dot grid instead of neutral); `--c-on-accent` missing (`--c-contrast-fg` used); High-contrast `muted` #aaa vs #ccc. | S |
| 7 | Main / HeaderMarks | Node header: a fill behind every titlebar (drawn: fill only when pinned); title in `--c-text-soft` (drawn: `--c-text`). | S |
| 8 | Types1 / Types3 | Per-type foundation pass not done: markdown footer into ⋯; status (sentence case, progress bar, time); context (rows, one-line token meter); ledger (time column, UI font); trace (10 px card, running in agent violet); file (toolbar into the header, 12 px code); group label (sentence case, "3 nodes"); prompt key-hint chip; response role labels and violet agent turns; board "not found" relink state. | L |
| 9 | Raw colours | 12 raw `rgba()` colours in node renderers; the hex guard skips `rgba()`. | S |

## Wave 1 — context made visible (in progress)

Already tracked: NearPin tethers and drag preview; Home pinned-boards panel; BoardPins category
glyphs (move 13).

| # | Drawing | Gap | Size |
|---|---|---|---|
| 10 | NearPin §3 | The moment it changes: the chip pulses once on drop, fades on leaving, and one Updates entry says "'X' is now near 'Y' — the agent gets its title and summary" / "…left… — it is out of the agent's brief". Not built. | M |
| 11 | NearPin §2 | Hover card actions "Pin to put it first" and "Show pins". The hint has text only. | S |
| 12 | HeaderMarks / LinksChanged | The amber word is "changed", not "changed since read" ✓; its hint should name what changed ("text changed · 1 new link"). | S |
| 13 | AgentContext / HeaderMarks | **Decided 2026-10-08: pinned cards only.** "Read" only accumulates and the agent reads across boards, so on unpinned cards it would soon mark everything; the receipt and the dim-untouched lens answer "what did it read". The drawings show "read" on cards the agent read without a pin ("read anyway") and near + read / near + changed together. Today read state shows only on pinned cards, and design.md says "the one state chip (near, or the read state)". | M |
| 14 | LinksChanged | **Decided 2026-10-08:** link authorship stays until a person edits or relabels the link, shown as a small ✦ on the label with the author's identity in the hint (the agent today, the person once boards are shared); "not seen by" stays as built. Waiting for the drawing. The drawing keeps "by <agent>" on a link until you edit it; the build clears it once a read carries either end (matching "not seen by"). | S |
| 15 | LinksChanged | The brief marks changed cards "links changed" / "text changed, links changed" and new relations "(new, by Pepe)"; a pinned card is never sent as "changed"; a person's removed link writes an Updates entry. **Built 2026-10-10:** changed and pinned entries carry `changes` (`text`/`links`), relations drawn or changed since the cursor end "(new, by …)" / "(changed, by …)", a removed link writes "Link removed · “A” – “B” (type)". A person shows as "by a person": edges record no human name, so "by Pepe" waits for shared boards (Part 3). | M |
| 16 | ContextChip / 600 | Panel tags carry eye / eye-off / warn icons (text only today); the 600 px sheet drops "near <pin>" and shortens the caption; at 600 px the agent chip shrinks to a 24 px violet initial placed after the summary. | S |
| 17 | AgentContext | "Suggested" state (dashed violet node, Accept / Dismiss, lens count, receipt row) — absent. Not named in wave 1's function list. **Dropped 2026-10-10** by the maintainer: the agent changes the canvas directly, and asks and suggestions go through the composer. | L |
| 18 | AgentContext | Edited: violet bar for the session and "see change" (diff + undo); receipt: "Tell <agent>" on changed lines, Undo on Edited, per-edit descriptions, header "What <agent> did · This session · start–end"; a live per-session lens count. **Built 2026-10-10:** the header, "Tell <agent>", Undo on Edited (via `snapshot.restore-node`), per-edit descriptions, "See change" (Before / Now + Undo this card, on the receipt line; its open view awaits a drawing), the violet session bar, and the live count in the agent chip. | M |
| 19 | Home | Beyond the pinned-boards panel: library tree with counts and pins, "Library · N boards", breadcrumb + folder README, "New board here", board cards (thumbnail, README line, "18 cards", "↔ 4 links"), a board-details pane (in context, README, pinned cards, links, Open). "nodes" should read "cards". **Built 2026-10-10:** tree with counts and pin dots, pinned boards with ≈ tokens, breadcrumb, "New board here", "+ New folder", subfolder cards with "N in context", board cards (thumbnail, README line, cards, ↔ links), details pane (in-context switch, README, pinned cards, links, Open board, ⋯ move/rename/create from/delete), "cards" not "nodes". Not built: the folder's README line (no folder README exists yet) and the Map/Graph tabs (wave 2). | L |
| 20 | Pane600 | Minimap off by default under 700 px (always on today ✓); agent activity summary "Claude · 4 read · 1 edited" in the top bar; Home at 600 px ("In context: 3 boards ≈ 21k tokens", details as a bottom sheet). **Built 2026-10-10:** Home at 600 px (in-context banner, folder picker, subfolder chips, board rows, details bottom sheet) and the activity summary in the agent chip (at ≤ 760 px the chip shows only its initial, per ContextChip600). | M |
| 21 | Context | Command-bar chips prefixed with ✦ ✓ — ✦ now means "an agent wrote this", so the pinned-context chips say the wrong thing; drawn as a plain blue chip with title + ×. | S |

## Stale code found on the way

- `global.css` `.node-title`: `min-width: 9ch` is cancelled by the next line, `min-width: 0` ✓.
- A `global.css` comment still describes the context chip as a "share of its budget… clipped".
- `CommandBar.tsx` comment says "gold ✦ chips".

## Suggested order

1. Small, unambiguous wave-1 fixes before 0.9.0: 12, 16, 21, the stale code; 20's minimap default.
2. Decide 13 and 14 (design session draws the answer if needed).
3. Close wave 1: 10, 11, 15, 18, the tracked tethers, and the Home redesign (19, 20) together.
4. A wave-0 pass after 0.9.0: 2, 3, 7, then the token sweep (4, 5, 6, 9), then per-type (8).
5. "Suggested" (17) needs a function first; plan it with wave 5 (agent output as nodes).
