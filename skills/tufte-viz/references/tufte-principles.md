# Core Tufte Principles

Reference for the fundamental principles from *The Visual Display of Quantitative Information*.

## Table of Contents

1. [Graphical Integrity](#graphical-integrity)
2. [Data-Ink Ratio](#data-ink-ratio)
3. [Chartjunk](#chartjunk)
4. [Small Multiples](#small-multiples)
5. [Data Density](#data-density)
6. [The Tufte Test](#the-tufte-test)

---

## Graphical Integrity

The representation of numbers on a graphic should be directly proportional to the numerical quantities represented.

### Lie Factor

```
Lie Factor = (size of effect shown in graphic) / (size of effect in data)
```

- A lie factor of 1.0 means perfect honesty
- Lie factors > 1.05 or < 0.95 distort perception
- Common sources of distortion:
  - Truncated baselines (bar charts not starting at zero)
  - Area/volume encoding where length would suffice
  - 3D perspective making nearer elements appear larger
  - Non-linear axis scaling without clear labeling

### Principles of Graphical Integrity

1. Show data variation, not design variation
2. Use clear, detailed, thorough labeling to defeat distortion
3. In time-series displays, standardize monetary units (deflate for inflation)
4. The number of information-carrying dimensions should not exceed the number of dimensions in the data
5. Context: show the data in context - "compared to what?"

---

## Data-Ink Ratio

The share of a graphic's ink devoted to non-redundant display of data-information.

```
Data-Ink Ratio = (data-ink) / (total ink used in graphic)
```

### Maximizing Data-Ink

Within reason, the goal is to maximize the data-ink ratio:

1. **Erase non-data-ink** - Remove elements that don't convey data (decorative borders, background fills, heavy axis boxes)
2. **Erase redundant data-ink** - If the same information is encoded twice (e.g., both a label and a position), remove one
3. **Revise and edit** - Iterate toward the simplest possible representation that retains all data meaning

### Practical Applications

- Replace heavy gridlines with light ones, or remove entirely if direct labels suffice
- Use range-frame axes (axes that span only the data range, not arbitrary round numbers)
- Remove chart borders/boxes
- Use white gridlines on a light gray background (Tufte's "sparkline" aesthetic)
- Let data points serve as their own tick marks where possible

---

## Chartjunk

Non-data elements or redundant data elements that clutter a visualization without adding information.

### Three Varieties

1. **Unintentional optical art** - Moiré patterns from hatching, vibrating fills, and tight parallel lines that create visual interference
2. **The grid** - Heavy, prominent grids that compete with or dominate the data
3. **The duck** - Elaborate decorative structures built around the data (3D effects, pictorial embellishments, ornamental frames)

### How to Eliminate

- Default to no background fill, no border, no grid
- Add gridlines only if the reader needs to extract precise values - and make them light/receding
- Never use 3D unless the data is inherently three-dimensional
- Remove legends when direct labeling is feasible
- Remove decorative icons, clip art, or illustrations layered onto the data area

---

## Small Multiples

A series of similar graphs or charts using the same scale and axes, allowing easy comparison across a varying condition.

### When to Use

- Comparing the same measure across many categories (regions, time periods, groups)
- Showing change over time for multiple entities
- Exploring multivariate data by faceting on one dimension
- Whenever you're tempted to use color-coding to distinguish many overlapping series

### Design Principles

1. **Shared scales** - All panels must use identical axis ranges so position means the same thing everywhere
2. **Consistent structure** - Same layout, same visual encoding in each panel
3. **Minimal per-panel decoration** - Axis labels, ticks, and titles appear once (shared) rather than repeated in each panel
4. **Clear ordering** - Arrange panels in a meaningful order (alphabetical, by outcome magnitude, by geography)
5. **Reference elements** - Include a common reference (e.g., overall average) as a light/gray line in each panel for context

### Density

Small multiples can be packed tightly. Each panel should be large enough to reveal the data pattern but small enough that the eye can compare across many panels in a single view.

---

## Data Density

The amount of data shown per unit area in a graphic.

```
Data Density = (number of entries in data matrix) / (area of data graphic)
```

### High-Density Displays

- Most published graphics have far lower data density than they could achieve
- Sparklines: intense, simple, word-sized graphics embedded in text or tables
- Data tables with integrated graphical elements can achieve very high density
- The human eye can resolve very fine differences - don't underestimate the reader

### Shrink Principle

Graphics can be shrunk far more than we usually think. A well-designed graphic retains meaning at small sizes because the data pattern (not the labels or decoration) carries the story.

---

## The Tufte Test

A synthesis checklist for evaluating any completed visualization:

1. **Is the lie factor close to 1.0?** - No distortions in area, length, or position
2. **Is the data-ink ratio high?** - Could anything be erased without information loss?
3. **Is there zero chartjunk?** - No decoration, no moiré, no unnecessary 3D
4. **Does it answer "compared to what?"** - Context, baseline, or reference is present
5. **Is labeling clear and integrated?** - Labels sit close to the data they describe, not in a distant legend
6. **Is the data density appropriate?** - For the story being told, is enough data shown? Could a table or sparkline show more?
7. **Would small multiples work better?** - If more than ~4 series overlap, consider faceting
8. **Does every element earn its ink?** - One final pass: point to each mark and ask what it communicates
