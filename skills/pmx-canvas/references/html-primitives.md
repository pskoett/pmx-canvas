# HTML Primitive Authoring

Use this guide when creating reusable sandboxed HTML communication primitives through
`canvas_add_html_primitive` or `pmx-canvas html primitive add`.

## What They Are

HTML primitives are generated `html` nodes. PMX Canvas stores the generated HTML in the normal
sandboxed iframe node, plus metadata describing the primitive kind and source data.

- Use them when markdown becomes too dense but a full React web artifact would be too heavy.
- Prefer them for communication artifacts: choices, plans, reviews, maps, explainers, reports,
  lightweight editors, and handoff boards.
- Keep using `canvas_add_html_node` for bespoke one-off HTML and JS.
- Keep using `canvas_build_web_artifact` for multi-component apps, routing, React state, or shadcn UI.

The design language is inspired by high-density HTML communication patterns: strong hierarchy,
metric cards, sticky context panels, annotated snippets, inline SVG figures, and copy/export actions.
Do not copy upstream demo HTML verbatim; use the PMX primitive catalog and data shapes instead.

## Current Catalog

| Kind | Best use |
|------|----------|
| `choice-grid` | Side-by-side options with pros, cons, tradeoffs, and evidence |
| `plan-timeline` | Sequenced implementation plans with risks, flow, and checkpoints |
| `review-sheet` | PR or code review findings with severity, file, line, and diff context |
| `pr-writeup` | Reviewer-ready PR narrative with motivation, file tour, tests, and rollout |
| `system-map` | Architecture/module maps with entry points and relationships |
| `code-walkthrough` | Guided source-path explanations with ordered steps and snippets |
| `design-sheet` | Visual directions, palettes, tokens, type samples, and rationale |
| `component-gallery` | Component variants, states, sizes, and accessibility notes |
| `interaction-prototype` | Throwaway interaction or motion studies with live controls |
| `flowchart` | Process, journey, pipeline, and failure-path diagrams |
| `deck` | Compact arrow-key narrative decks with speaker notes |
| `presentation` | Fullscreen-ready PowerPoint-like slide decks for briefings and pitches |
| `illustration-set` | Inline SVG figure sheets with captions and SVG copy/export |
| `explainer` | Feature or algorithm explainers with TLDR, steps, FAQ, and glossary |
| `status-report` | Skimmable project health with metrics, shipped/slipped lists, and next actions |
| `incident-report` | Incident summaries with impact, timeline, root cause, logs, and action items |
| `triage-board` | Human-reorderable Now/Next/Later/Cut boards with markdown export |
| `config-editor` | Feature flag or config editors with dependency warnings and diff export |
| `prompt-tuner` | Prompt/template editors with variable previews and copy export |

## Request Shape

Use the running server as the source of truth before constructing data payloads:

```bash
pmx-canvas html primitive schema --summary
pmx-canvas html primitive schema --kind explainer
```

MCP shape:

```json
{
  "kind": "explainer",
  "title": "HTML Primitives",
  "data": {
    "summary": "Reusable generated HTML nodes for rich agent-to-human communication.",
    "steps": [
      { "title": "Pick a primitive", "detail": "Match the work product to the catalog kind." }
    ]
  },
  "x": 120,
  "y": 80,
  "width": 980,
  "height": 760
}
```

CLI shape:

```bash
pmx-canvas html primitive add \
  --kind choice-grid \
  --title "Implementation Options" \
  --data-json '{"items":[{"title":"Small patch","summary":"Least disruption","tradeoff":"Limited future flexibility","pros":["Fast"],"cons":["May need follow-up"]}]}'
```

Important details:

- `kind` is required.
- `title`, `data`, `x`, `y`, `width`, `height`, and `strictSize` are optional.
- The persisted node type is `html`, not a separate durable `html-primitive` node type.
- `html-primitive` is accepted by schema validation and convenience creation paths as a virtual type.
- Batch `node.add` does not create HTML primitives; use the dedicated primitive tool first or batch the generated `html` node.

## Payload Rules

- Keep titles short and scannable; put detail in structured fields.
- Prefer arrays of small records over one large prose blob.
- Include file paths, line numbers, test commands, and exact statuses when the primitive is review or engineering focused.
- Use `summary`, `why`, `risks`, `next`, `tests`, and `reviewFocus` fields when the chosen primitive supports them.
- For `presentation`, use `slides: [{ title, kicker?, body?, bullets?, metrics?, note? }]`; keep one idea per slide, use `metrics` for big numbers, and put speaker notes in `note`.
- Only choose `presentation` when the user explicitly asks for a PowerPoint-like deck, pitch, briefing, workshop walkthrough, or fullscreen story. Otherwise create a normal `html` node or a non-presentation primitive.
- Presentation data supports `theme: "canvas" | "midnight" | "paper" | "aurora"` or a custom color object with `bg`, `panel`, `surface`, `border`, `text`, `textSecondary`, `textMuted`, `accent`, and `colorScheme`.
- For visual primitives, provide colors as hex/rgb/hsl values only; unsafe color strings are discarded.
- For editor primitives, seed realistic initial columns, flags, controls, variables, or template text so the human can interact immediately.

## Human Feedback Loop

Interactive/editor primitives are useful when the human should modify state and return it to the
agent.

- `triage-board` lets the human reorder and rebucket items, then copy markdown.
- `config-editor` lets the human toggle flags and copy a diff-like export.
- `prompt-tuner` lets the human edit prompts, preview sample substitutions, and copy the current prompt state.
- `interaction-prototype` exposes live controls and copyable config for implementation tuning.
- Tell the human which copy/export button to use, then ask them to paste the result back if you need to act on edits.

## Sandbox And Persistence

- Primitive output runs inside the existing HTML iframe sandbox with scripts allowed but no same-origin access.
- Generated HTML receives PMX Canvas theme CSS variables so it adapts to the current canvas theme, and sandboxed iframes receive live theme updates when the canvas theme changes.
- Generated and raw HTML nodes store an agent-readable summary sidecar (`agentSummary`, `contentSummary`, and embedded references) for search, pinned context, and spatial context.
- Only presentation-marked HTML nodes have a browser `Present` button. Use it for `presentation` nodes so the human can review the deck fullscreen, navigate slides with arrow keys/Space/Page Up/Page Down, and exit with `Esc` or `Exit presentation`.
- Presentation primitives also persist `presentation`, `slideCount`, `slideTitles`, and optional `speakerNotes` metadata so agents can understand the deck without parsing the iframe HTML.
- Primitive data is persisted in canvas state; do not include secrets, credentials, private tokens, or unnecessary personal data.
- Treat primitives as communication surfaces, not authoritative application state. If the result must be machine-roundtrippable, keep the original data in the node metadata or another structured node as well.

## Picking The Right Primitive

- Pick `choice-grid` when a decision has competing options.
- Pick `plan-timeline` when sequence, dependency, and risk matter.
- Pick `review-sheet` or `pr-writeup` for code review and pull-request communication.
- Pick `system-map`, `code-walkthrough`, or `flowchart` for architecture and source explanations.
- Pick `design-sheet`, `component-gallery`, `interaction-prototype`, or `illustration-set` for visual/product work.
- Pick `presentation` when the human asks for a PowerPoint-like deck, pitch, briefing, workshop walkthrough, or fullscreen story.
- Pick `explainer`, `deck`, `status-report`, or `incident-report` for narrative reporting.
- Pick `triage-board`, `config-editor`, or `prompt-tuner` when the human needs to edit or return structured feedback.
