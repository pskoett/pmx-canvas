# Plan 015 — Design foundation (wave 0)

**Status:** Wave 0 done (2026-10-05): steps 1–4 are on main.
**Date:** 2026-10-05
**Source:** [design.md](../design.md#build-plan) wave 0 ("ships alone, first"); vision moves 5, 9, 10.
Drawings: [`TokenSystem`](../design/TokenSystem.dc.html), [`Tokens`](../design/Tokens.dc.html),
[`Themes`](../design/Themes.dc.html), [`Chrome`](../design/Chrome.dc.html),
[`Context`](../design/Context.dc.html), [`Main`](../design/Main.dc.html) / [`Light`](../design/Light.dc.html).

## Why first

Every later wave paints with the meaning colours, the scale and the font. Today none of them
exist: pins and agent attention borrow `--c-warn`, the light theme hard-codes `#4BBCFF` for pins,
Plex is named in `--font` but not bundled (controls fall back to Arial or the system font), and
there is no type, spacing, radius or elevation scale and no check that keeps any of it honest.

## Wave done when (from design.md)

No control renders in a fallback font; the token test passes for all nine themes; the reference
cases pass at 600, 1024 and 1920 px; the demo board is regenerated.

## Steps

Each step is its own commit and leaves the suite green.

### 1. Meaning and scale tokens, with the token test (no component changes)

- Add the meaning layer to every theme block in `global.css` and `surface-theme.css`:
  `--c-pin`, `--c-agent`, `--c-rel-supports`, `--c-rel-contradicts`, `--c-rel-cites`,
  `--c-rel-derived`, `--c-rel-informs`, `--c-rel-related`. `--c-warn` already exists; it takes the
  drawn value (changes Light `#c89b2a` → `#94600A` and Sepia `#A97B1E` → `#8A5A00`, with their
  fixed `--c-warn-*` copies; every other theme already matches).
- Values come from `Themes.dc.html` `renderVals()`. Where the drawing is silent (cites, derived,
  informs, related outside Harbor) they are tuned here — see the table below.
- Add the scale to `:root` in both files: `--fs-meta|ui|body|title|heading` (11/12/13/15/20),
  `--space-1|2|3|4|6|8` (4/8/12/16/24/32), `--r-control|node|overlay|pill` (6/10/14/999),
  `--e-1`, `--e-2` (shadows as drawn on `Tokens.dc.html`).
- Token test (`tests/unit/theme-meaning-tokens.test.ts`), all nine themes:
  - every meaning token is present, in both files, with the same value;
  - each has at least 3:1 contrast on that theme's `--c-panel`;
  - meaning colours are apart: OKLab distance ≥ 0.06 (≈3× a just-noticeable difference)
    between `pin`/`agent`/`warn`, between each of those and every relation ink, and between
    relation inks.
- Nothing consumes the new tokens yet, so nothing on screen changes except the warning amber in
  Light and Sepia.

**Verify:** `bun run test:unit` (token + surface sync tests), `bun run build`, `bun run lint`.

### 2. Bundle IBM Plex; every control inherits the font

- Ship Plex Sans (400/500/600) and Plex Mono (400/500) woff2 with the client bundle, `@font-face`
  in `global.css`, no CDN. Confirm the npm `files` list carries them.
  *Done:* `@fontsource` packages are dev dependencies; `scripts/copy-fonts.ts` copies the latin
  and latin-ext subsets (192 KB) and the OFL licence to `dist/canvas/fonts/`, which ships. The
  single-file MCP app inlines them as data URIs. HTML nodes, json-render and exports still use the
  `--font-sans`/`--font-mono` aliases without the faces until the frame host (wave 4).
- Rename `--font`/`--mono` to `--font-ui`/`--font-code` (no aliases); `button, input, select,
  textarea { font: inherit }`; remove Arial fallbacks.
- Check: a browser test that every visible control computes `--font-ui` and that the Plex faces
  are loaded (`document.fonts`).
  *Done:* in `reference-pane.pw.ts`. Before: 365 of 400 controls on the demo board rendered in
  Arial and no Plex face loaded; after: 0 of 389, all five faces loaded.

### 3. Pins and agent marks move to their meaning tokens

Split into three slices after reading the code (2026-10-05):

**3a. Node states and the context pin (done).** Built to `Context.dc.html` and `Chrome.dc.html`:
- In context: 1.5 px `--c-pin` border, header tinted 12% pin, pin-blue kind icon, and the header
  pin control always visible — outline pin in a circle when out of context, the filled `--c-pin`
  badge (`--c-on-pin` glyph, new token) when in. The light theme's hard-coded `#4BBCFF` overrides
  are gone.
- The amber "attention" halo was not agent activity: it was semantic attention derived from pins
  (primary = the pinned nodes, secondary = their unpinned neighbours, plus a glow around pinned
  clusters). Decided with the maintainer: pin style only — the halos, neighbour halos and the
  focus field (`FocusFieldLayer`) are removed. The change pulse stays, in the neutral accent.
- The violet agent bar (2.5 px `--c-agent` across the header) marks live agent edits
  (`agent-mutating`), replacing the accent-blue shimmer; wave 1 extends it to read, created and
  edited. The design session corrected the Context board's "Today" row to match.
- Selection is a ring with a gap (3 px background, 2 px accent) outside the border, so pin styling
  survives it; base nodes take `--r-node` and `--e-1`.

**3b. Node header overflow (done).** Per `Chrome.dc.html`: expand and the context pin always show;
⋯ and × appear on hover or keyboard focus. ⋯ opens the existing node menu (the same one as
right-click), which already holds Collapse, Rename and Delete; "Open in new tab" (open as site)
moves into it from the header. The drawn "Ask agent" entry has no function yet and waits for one;
"Set as README" stays in the markdown card footer for now.

**3c. The rest of the old colours (done).**
- Every remaining `--c-warn` use was sorted by meaning. Pin blue: the command-bar chips, the
  context pin bar, the expanded overlay's pinned state and toggle, the pin HUD and the "Context
  updated" toast. Agent violet: the "agent yielded" pill and a status node's active tool.
  `--c-rel-informs`: `depends-on` edges. Neutral (accent or muted): generic toast and history
  borders, cluster/neighbourhood toasts, group drop feedback, the budget bar at rest, "saving",
  webpage loading, the "required" source tag. Real warnings stay amber: approval gates and
  waiting phases, blocked status, reconnecting, budget warnings, image and app warnings, pending
  asks.
- Tints are `color-mix(in srgb, var(--c-…) N%, transparent)`; the fixed alpha copies,
  `--c-warn-alt`, `--c-glow-accent` and `--c-thinking` are gone (`--c-agent` replaces it).
- `tests/unit/raw-hex-guard.test.ts`: no hex colour in client code or outside `global.css`'s theme
  blocks. Allowlisted as content, not theme: group frame colours, the annotation default, the
  white behind webpage previews, and the embedded Mermaid viewer's fallback (goes in wave 4).

**3d. Kind colours and the writer palette (done).** Per the design session's rule in `design.md`
(2b74c7b4): kinds carry no colour. Type icons, group kind dots and minimap rectangles are
`--c-muted`; the minimap marks only meaning — pinned nodes in `--c-pin`, nodes an agent is
editing in `--c-agent`. `KIND_COLOR`, the `--kind-accent` rules and `--c-purple` are gone (agent
chrome that borrowed purple now uses `--c-agent`). Writers are told apart by name and initial: the
writer palette and the per-agent `agentIdentityHue` are gone; an agent's cursor, chip, minimap dot
and activity rows take `--c-agent`, a subagent's `--c-subagent`. Trace categories go neutral except
subagent rows.

### 4. Theme renames and the wave's definition of done (done)

- `dark` → `harbor` (label Harbor, still the default) and `light` → `daylight` (label Daylight) in
  `src/shared/themes.ts`, the CSS selectors, the defaults (state, persistence, client), the command
  palette toggle (now by scheme), the CLI help, the bundled Copilot extension (`?theme=daylight`),
  docs, skills, CLAUDE.md and AGENTS.md. No aliases: a stored or passed `dark`/`light` falls back
  to Harbor, so anyone who had chosen the light theme picks Daylight once.
- Viewer scheme parameters stay `dark`/`light` (the json-render viewer and embedded MCP apps speak
  schemes, not theme ids); the static export maps its scheme to Harbor or Daylight for surface
  documents.
- Daylight takes the drawn neutral surfaces from `Main.dc.html` (`#F6F7F9` / `#FFFFFF` /
  `#F2F4F7` / `#DDE2E9`, text `#0B1726`, ok `#1E7F51`, danger `#B8344A`) instead of beige.
- Definition of done: reference cases at 600, 1024 and 1920 px in the e2e gate; the token test
  covers all nine themes; the demo board regenerated (deterministic: two runs, same file).

## Step 1 colour table

Drawn values are from `Themes.dc.html`; *tuned* values are chosen in this plan.

| Theme | pin | agent | warn | supports | contradicts | cites | derived | informs | related |
|---|---|---|---|---|---|---|---|---|---|
| Harbor (`dark`) | `#4BBCFF` | `#B388FF` | `#f4c542` | `#5FCFC0` | `#E59B6B` | `#7C9CFF` | `#D5DEEA` | `#E58FB0` | `#8ea3bd` |
| Daylight (`light`) | `#1A7ABF` | `#7C4DDB` | `#94600A` | `#1E8C80` | `#B8572A` | *`#4257C9`* | *`#4A5566`* | *`#B03F72`* | *`#5c6b80`* |
| High contrast | `#00ffff` | `#e040fb` | `#ffff00` | `#00e5c0` | `#ff8a00` | *`#8c9eff`* | *`#ffffff`* | *`#ff80ab`* | *`#aaaaaa`* |
| Midnight | Harbor | Harbor | `#F5C452` | Harbor | Harbor | Harbor | Harbor | Harbor | *`#8D96BC`* |
| Sepia | `#1F6FA8` | `#7046A6` | `#8A5A00` | `#1E8C80` | `#A3461C` | *`#3D50B0`* | *`#4E4433`* | *`#9C3A66`* | *`#6B6A66`* |
| Arctic | `#6EC1F5` | Harbor | `#E8C476` | Harbor | Harbor | Harbor | Harbor | Harbor | *`#939DB1`* |
| Ember | Harbor | Harbor | `#F5B944` | Harbor | Harbor | Harbor | Harbor | Harbor | *`#96948D`* |
| Forest | Harbor | Harbor | `#E0B84F` | `#4FC9D9` | Harbor | Harbor | Harbor | Harbor | *`#8BA695`* |
| Volt | Harbor | Harbor | `#E4C465` | Harbor | Harbor | Harbor | Harbor | Harbor | *`#9CA49C`* |

"Related" is the theme's own `--c-muted` except in Sepia, where muted brown sits too close to the
warning amber.

## Decided 2026-10-05

- **Tight pairs stay as drawn.** The closest drawn pairs (OKLab distance) pass the 0.06 floor:
  Forest supports/pin 0.075, Daylight contradicts/warning 0.075, Sepia contradicts/warning 0.070.
  The alternatives were compared side by side and rejected: Forest teal `#5FCFC0` lands on the
  done green (0.062), and a redder contradicts in the light themes lands on `--c-danger`. Sepia
  contradicts is already close to its error red (0.038); red is not a meaning colour, so the
  test allows it.
- **Light-theme elevation.** Daylight and Sepia override `--e-1`/`--e-2` with ink-tinted shadows
  (10/8% and 18%) instead of the drawn black ones; recorded as the one per-theme scale exception
  in `design.md`.

## Open

- **Near a pin (decided 2026-10-05).** Nodes near a pin (up to 5 within 600 px,
  `findNeighborhoods`) are treated as related, but the agent gets them only as titles, in
  `canvas://pinned-context` and `canvas://spatial-context`; the main brief `canvas://context` does
  not include them. Decided with the maintainer: no near-a-pin mark on the board until the brief
  carries neighbours (vision move 1's ranker). The mark and that brief change ship together, in
  wave 1; the design session draws the state ahead of it. Not part of wave 0.

- The **folders-versus-portals** question (before wave 2).
