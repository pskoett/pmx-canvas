---
name: tufte-viz
description: |
  Ideate and critique data visualizations using Edward Tufte's principles, and map them onto
  the PMX Canvas json-render chart catalog (graph / json-render nodes). Use this skill when:
  (1) Designing or critiquing a canvas graph/json-render chart
  (2) Choosing a chart type, color encoding (colorBy), or primitive (Sparkline, DotPlot, BulletChart, Slopegraph)
  (3) Reviewing a board's dashboards/charts for graphical integrity and data-ink
  (4) Deciding between a single-series bar, small multiples, or direct labeling
  (5) Reducing chartjunk or improving data-ink ratio on canvas charts
  Applies: data-ink ratio, chartjunk elimination, graphical integrity, lie factor, small multiples,
  data density — and the canvas colorBy decision (color must encode data, not decorate).
---

# Tufte Visualization Ideation (PMX Canvas)

Apply Edward Tufte's principles to design clear, honest, high-density data visualizations, then
realize them with PMX Canvas `graph` / `json-render` nodes. Color must encode data, not decorate.

## Workflow

### For new visualizations:

1. **Clarify the data story**
   - What comparisons matter?
   - What's the key insight to communicate?
   - Who's the audience?

2. **Select approach** using Tufte principles:
   - High comparison need → Small multiples (several small `graph` nodes, shared scale)
   - Dense data → Consider data tables (`json-render` Table), sparklines (`Sparkline`)
   - Time-series → Line charts with minimal grid
   - Part-to-whole → Avoid pie charts; prefer bar/table
   - Ranked single metric across categories → DotPlot over a bar forest

3. **Design with data-ink in mind**
   - Start minimal, add only what's necessary
   - Every element must earn its ink
   - Default to a single accent; use the full palette only when color *encodes* a variable

4. **Apply the eraser test before shipping**
   - For every element (label, tick, gridline, border, annotation): can it be erased without losing
     information that's not already conveyed elsewhere?
   - Watch for duplicate encodings: numeric labels next to a value already marked by a tick; legends
     duplicating direct labels; per-panel scale annotations duplicating a shared-scale caption.
   - If two elements compete for the same job, keep the visual one and drop the textual one (or vice
     versa) - not both.

5. **Apply the collision test before shipping**
   - For every text element in the plot (axis labels, point annotations, epoch labels, baseline
     labels, explanatory notes): mentally draw its bounding box. Does anything else - another text
     element, a data line, dense markers - live in or cross that box?
   - The eraser test catches *redundant* elements; the collision test catches *crowded* ones. Both
     must pass.
   - Standard fixes: move explanatory prose out of the plot into a nearby markdown node; relocate
     band/epoch labels to a dedicated strip above the plot; push baseline/reference labels to the
     outside margin; give each in-plot annotation a leader line so the marker and the text occupy
     clearly separated space.
   - Watch especially: inverted axes; shared-scale small multiples (labels stacked near zero in every
     panel); dense scatter (text vanishes into the dot cloud unless explicitly cleared).

6. **Apply the Tufte test** (see references/tufte-principles.md)

### For critiquing visualizations:

1. **Check graphical integrity**
   - Calculate lie factor if proportions seem off
   - Verify baselines and scales (bar and area charts must start at zero)
   - Look for 3D distortion

2. **Identify chartjunk**
   - Decorative elements
   - Heavy grids
   - Unnecessary 3D effects
   - Moiré patterns
   - Gratuitous per-category color on a single-series chart (decoration, not encoding)

3. **Evaluate data-ink ratio**
   - What can be erased?
   - What's redundant?

4. **Suggest improvements** with specific before/after recommendations

## Mapping to the PMX Canvas chart catalog

Realize these designs with `canvas_add_graph_node` (graph nodes) and `canvas_add_json_render_node`.
The chart catalog: `LineChart`, `BarChart`, `PieChart`, `AreaChart`, `ScatterChart`, `RadarChart`,
`StackedBarChart`, `ComposedChart`, plus the Tufte primitives `Sparkline`, `DotPlot`, `BulletChart`,
and `Slopegraph`.

### Color must encode data — the `colorBy` decision (single-series bar/column)

A single-series `BarChart` measures **one** variable across categories. Coloring each bar differently
encodes nothing — it is decoration (chartjunk). Use the `colorBy` prop:

| `colorBy`   | When to use                                                                 |
|-------------|-----------------------------------------------------------------------------|
| `series` (default) | One accent for all bars, one bar highlighted (Tufte-safe emphasis). Use to draw the eye to the bar that *matters* (max, target, the row under discussion). |
| `category`  | Opt in only when the category itself is a nominal variable the reader must map by color (e.g. team identity reused across several charts with a shared key). |
| `value`     | Sequential shade by magnitude. Note this **double-encodes** — the bar's length already encodes the value — so reserve it for when the lightness ramp genuinely aids reading a ranked magnitude; otherwise `series`/`none` are more honest. |
| `none`      | Flat single accent, no highlight. Maximal data-ink for dense small multiples. |

Default to `series`. Do **not** reach for `category` to "make it colorful." Pie/radar/stacked-bar
already rotate the palette because each slice/series **is** a distinct variable — leave those as-is.

### Tufte primitives (prefer over heavier charts)

- **`Sparkline`** — word-sized time-series, no axes/labels. Use inline in tables/dashboards and one
  per row to show a trajectory at a glance. Replaces "trending up / volatile" prose with the shape.
- **`DotPlot`** — ranked single metric across categories. Replaces a forest of bars: a dot per
  category on a shared axis. Far higher data-ink ratio than bars; sorts make the macro pattern pop.
- **`BulletChart`** — a measure against a target with qualitative bands. Replaces a gauge/dial
  (which is chartjunk). Use for KPI-vs-target, progress-vs-goal.
- **`Slopegraph`** — two-time-point comparison across many categories (before/after). Direct slope
  encodes change and rank simultaneously; labels sit at the endpoints (direct labeling, no legend).
  Lines default to a single neutral ink; set `colorByDirection` to accent rising lines and mute
  falling ones only when the direction is the point (and beware it editorializes — a falling
  error-rate is "good", a falling revenue is "bad").

### Direct labeling over legends

Legends force the eye to ping-pong between key and plot (a duplicate encoding). Prefer labeling the
data directly: end-of-line labels on `LineChart`/`Slopegraph`, endpoint labels on `DotPlot`, the
highlighted bar's value on `BarChart`. Set `showLegend: false` on graph nodes when one or two series
are directly identifiable; reserve legends for genuinely many overlapping series.

### Small multiples over many overlapping series

When more than ~4 series would overlap in one chart, do **not** cram them into a single multi-color
`LineChart`. Create several small `graph` nodes with an **identical shared scale** and consistent
encoding, arranged in a grid (`canvas_arrange` grid, or a `group`). Position means the same thing in
every panel; the sequence tells the macro story while each panel carries the micro detail. This is
almost always better than color-coding 6+ lines.

## Key Principles Reference

- `references/tufte-principles.md` - core principles from *Visual Display of Quantitative Information*:
  lie factor, data-ink, chartjunk, small multiples, integrity.
- `references/analytical-design.md` - extensions from *Envisioning Information*, *Visual Explanations*,
  and *Beautiful Evidence*: the 6 principles of analytical design, sparklines, layering & separation,
  micro/macro, range-frames, causality, confections. Load when designing dashboards, dense displays,
  sparklines, or explanatory graphics.

**Quick checklist:**
- [ ] Lie Factor ≈ 1.0 (no visual distortion; bars and areas start at zero)
- [ ] Maximum data-ink ratio
- [ ] Zero chartjunk (no per-category color unless color encodes a variable)
- [ ] `colorBy` chosen deliberately — default `series` (single accent + one highlight); avoid `value` unless the magnitude ramp earns the double-encode
- [ ] Clear labeling, direct over legend
- [ ] Answers "compared to what?"
- [ ] Shows causality or mechanism where relevant
- [ ] Multivariate (not over-reduced)
- [ ] Words, numbers, images integrated - not segregated
- [ ] Reveals multiple levels of detail (micro + macro)
- [ ] Layering: primary data dominates, secondary recedes
- [ ] Appropriate data density — Sparkline/DotPlot considered before a heavier chart
- [ ] >4 overlapping series → small multiples, not one rainbow chart
