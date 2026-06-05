# Analytical Design Principles

Extended principles from *Envisioning Information*, *Visual Explanations*, and *Beautiful Evidence*.

## Table of Contents

1. [Six Principles of Analytical Design](#six-principles-of-analytical-design)
2. [Sparklines](#sparklines)
3. [Layering and Separation](#layering-and-separation)
4. [Micro/Macro Readings](#micromacro-readings)
5. [Range-Frames and Related Techniques](#range-frames-and-related-techniques)
6. [Showing Causality](#showing-causality)
7. [Confections](#confections)

---

## Six Principles of Analytical Design

These govern the design of any serious analytical presentation - charts, maps, diagrams, or evidence displays.

### 1. Show Comparisons, Contrasts, Differences

- The fundamental analytical question is always "compared to what?"
- Every display should make at least one comparison explicit
- Side-by-side placement is stronger than sequential placement
- Differences should be shown directly rather than requiring mental arithmetic

### 2. Show Causality, Mechanism, Explanation, Systematic Structure

- Go beyond "what happened" to "why it happened"
- Show the causal mechanism, not just the correlation
- Use arrows, annotations, or sequencing to indicate direction of effect
- Integrate explanatory text with the data display

### 3. Show Multivariate Data (More Than 1 or 2 Variables)

- The real world is multivariate; flatten it at your peril
- Use small multiples, color channels, size, position, and faceting to encode multiple dimensions simultaneously
- Avoid over-reducing: a single average line hides the story in the distribution

### 4. Completely Integrate Words, Numbers, and Images

- The best analytical displays weave text, data, and graphics into a single coherent view
- Don't segregate "the chart" from "the explanation" - put them together
- Labels, annotations, and data should coexist in the same visual space
- Source notes and methodology belong with the graphic, not in a footnote pages away

### 5. Thoroughly Describe the Evidence

- Provide a title that names the data, the measurement, and the context
- Label axes with units, time range, and source
- Document what data is excluded or transformed
- Quality, relevance, and integrity of evidence should be self-evident

### 6. Content Counts Most of All

- Analytical presentations stand or fall on the quality and relevance of the content
- No amount of design skill can rescue poor or irrelevant data
- Choose the question carefully; then design the graphic to answer it with maximum clarity

---

## Sparklines

Intense, simple, word-sized graphics that can be embedded in text, tables, or dashboards.

### Characteristics

- Typically the height of a text line (~20-30px at screen resolution)
- No axes, no labels, no grids
- Data pattern speaks entirely through shape
- Usually time-series: left is past, right is present
- Can show reference bands (normal range), endpoints, min/max dots

### Design Guidelines

- Keep aspect ratio approximately banking to 45 degrees (the average slope of the data should be ~45 degrees for optimal perception)
- Use a small red/colored dot for the most recent value or the min/max
- Embed in context: "Revenue grew steadily [sparkline] before the Q3 dip"
- For tables: one sparkline per row provides pattern recognition across many entities at a glance

### When to Use

- Dashboards where space is precious
- Inline with narrative text to show trends without interrupting reading flow
- Tables of KPIs where each row benefits from a visual trajectory
- Anywhere you'd otherwise write "trending up" or "volatile" - show it instead

---

## Layering and Separation

Techniques for organizing complex displays so that different types of information are visually stratified.

### The Problem

When many data elements, labels, grids, and annotations share a single plane, the result is visual confusion - everything competes for attention equally.

### Solutions

1. **Color layering** - Primary data in high-contrast (black/dark); secondary reference data in low-contrast (light gray); structural elements (axes) in between
2. **Weight layering** - Data lines thicker than grid lines; grid lines thinner than axis lines
3. **Transparency/opacity** - Background elements at 20-40% opacity; foreground data at 100%
4. **Spatial separation** - Use whitespace to group related elements and separate unrelated ones
5. **The 1+1=3 effect** - Two adjacent dark elements create a perceived third element (the white gap between them). Be aware of this and control it

### Practical Rules

- Grid: lightest layer (if present at all)
- Axes and frame: medium layer
- Data: heaviest layer (darkest ink, thickest stroke)
- Annotations: medium-dark, but positioned to avoid collision with data
- Background: minimal or none (white/very light)

---

## Micro/Macro Readings

Displays that simultaneously serve two levels of reading: the overall pattern (macro) and the individual data point (micro).

### The Idea

A well-designed high-resolution display rewards both:
- A quick glance (macro): What's the overall shape, trend, or story?
- Close inspection (micro): What are the individual values? Which points are outliers?

### How to Achieve

1. **High data density** - Show all the data, not just aggregates
2. **Clear ordering** - Sort/arrange so the macro pattern emerges from the micro data
3. **Progressive revelation** - Overall pattern visible at arm's length; detail visible up close
4. **Direct labeling** - Selected important data points labeled directly, others readable by position

### Examples in Practice

- A map where individual data points form a visible geographic pattern
- A scatter plot where the cloud shape tells the correlation story, but individual labeled outliers are identifiable
- Small multiples where each panel is a micro view but the sequence tells a macro story

---

## Range-Frames and Related Techniques

Alternatives to the conventional box axes that use less ink while conveying more information.

### Range-Frame

Instead of drawing axes from arbitrary round numbers to round numbers, the axis line spans only the range of the data (from min to max). This encodes additional information (the data range) into an element that was previously just structural.

### Dot-Dash Plot

Instead of tick marks at round intervals, place a tick mark at each actual data value along the axis. The distribution of ticks immediately shows data density and gaps.

### Quarter-Frame

Only two sides of the frame are drawn (typically left and bottom), and only as far as the data extends.

### When to Use

- Range-frames: almost always preferable to standard full-frame axes
- Dot-dash: when showing distribution along an axis matters (scatter plots, strip plots)
- Quarter-frame: when data doesn't approach all four edges of the plot area

---

## Showing Causality

Techniques for moving beyond correlation to communicate mechanism and cause-effect relationships.

### Principles

1. **Temporal sequence** - Cause precedes effect; arrange displays chronologically when causality is temporal
2. **Mechanism diagrams** - Show the pathway from cause to effect, not just the endpoints
3. **Counterfactual comparison** - Show what happened alongside what would have happened without the intervention
4. **Confound acknowledgment** - Note or visualize potential confounders rather than ignoring them

### Visual Techniques

- Before/after with a clear intervention marker
- Parallel time-series: treatment vs. control
- Flow diagrams showing causal chains
- Annotations on inflection points explaining what changed

### Honesty Requirements

- Don't imply causation when you only have correlation
- Show uncertainty bands where appropriate
- If the causal mechanism is debated, note it
- Show the data that argues against your interpretation alongside the data that supports it

---

## Confections

Assemblages of many visual elements that together provide a richly informative, often explanatory, display.

### What They Are

Confections combine multiple modes of information:
- Diagrams + data + annotations + comparisons in a single integrated display
- Often narrative: they tell a story with a beginning, middle, and end
- May mix scales, perspectives, or time periods in a single view

### When to Use

- Explaining complex systems or processes
- Teaching: where understanding mechanism matters more than precision
- Summarizing research findings with their context
- Executive briefings that need to convey both "what" and "why"

### Design Principles

1. **Unity** - Despite multiple elements, the display should read as one coherent piece
2. **Hierarchy** - The most important information is most prominent
3. **Flow** - The reader's eye should move through the display in a logical sequence
4. **Density** - Every region of the display should carry information; no dead zones
5. **Integration** - Words and images work together; neither is redundant to the other
