# Excalidraw Diagram Authoring

Use this guide when creating diagrams through PMX Canvas with `canvas_add_diagram` or
`pmx-canvas external-app add --kind excalidraw`.

## Why Text Can Still Drift

PMX normalizes canonical Excalidraw bound text (`containerId` / `boundElements`) into the hosted
app's supported shape-level `label` format before calling Excalidraw. That fixes the payload
format mismatch, but it does not fix poor diagram geometry.

Text can still appear clipped or misplaced when:

- A label is too long for its shape.
- A diamond or ellipse is too small for the label's usable center area.
- The `cameraUpdate` viewport is too tight or not 4:3.
- Title, footer, or notes are placed near the camera edge.
- The caller bypasses PMX and sends raw elements directly to Excalidraw MCP.

## Text Format Rules

For text inside a rectangle, ellipse, or diamond, use shape-level `label`:

```json
{
  "type": "rectangle",
  "id": "step-a",
  "x": 100,
  "y": 100,
  "width": 260,
  "height": 90,
  "label": { "text": "Step A", "fontSize": 18 }
}
```

Do not create separate centered text elements for shape labels:

```json
{
  "type": "text",
  "containerId": "step-a",
  "text": "Step A"
}
```

Standalone text is fine for titles, notes, captions, and free-floating annotations. For standalone
text, `x` is the left edge; `textAlign` does not center it on a point.

## Label Length Rules

- Use 1-4 words inside shapes.
- Put detailed explanations in nearby standalone text annotations.
- Prefer `Bound Text` over `Pattern B: containerId+boundElements only`.
- If a label needs more than 4 words, either widen the shape or split the idea into a label plus an annotation.

## Shape Sizing Rules

- Minimum labeled rectangle or ellipse: `180x80`.
- For 3-5 word labels: `240x90` or larger.
- For long labels: `320+` width or use an external annotation.
- Diamonds need more room than rectangles because the usable center area is smaller.
- Leave at least `30px` gap between shapes and labels/arrows.

## Camera Rules

Always start with a `cameraUpdate` as the first element.

Use 4:3 camera sizes only:

- `400x300`
- `600x450`
- `800x600`
- `1200x900`
- `1600x1200`

Camera bounds must include the full diagram plus padding. Leave at least `80px` padding around all
visible content.

Example:

```json
{ "type": "cameraUpdate", "x": 20, "y": 0, "width": 1200, "height": 900 }
```

If a title, footer, or rightmost label is clipped, the camera is wrong even if the elements are valid.

## Good Pattern

```json
[
  { "type": "cameraUpdate", "x": 20, "y": 0, "width": 1200, "height": 900 },
  {
    "type": "rectangle",
    "id": "a",
    "x": 120,
    "y": 160,
    "width": 260,
    "height": 90,
    "backgroundColor": "#a5d8ff",
    "fillStyle": "solid",
    "label": { "text": "Short Label", "fontSize": 18 }
  },
  {
    "type": "rectangle",
    "id": "b",
    "x": 520,
    "y": 160,
    "width": 280,
    "height": 90,
    "backgroundColor": "#b2f2bb",
    "fillStyle": "solid",
    "label": { "text": "Next Step", "fontSize": 18 }
  },
  {
    "type": "arrow",
    "id": "a-to-b",
    "x": 390,
    "y": 205,
    "width": 110,
    "height": 0,
    "points": [[0, 0], [110, 0]],
    "endArrowhead": "arrow",
    "label": { "text": "then", "fontSize": 14 }
  },
  {
    "type": "text",
    "id": "note",
    "x": 120,
    "y": 290,
    "text": "Longer explanation goes here, outside the shape.",
    "fontSize": 16
  }
]
```

## Preflight Checklist

- Shape text uses `label`, not separate `text` elements.
- Shape labels are short enough to fit.
- Long explanations are outside shapes.
- The first element is a 4:3 `cameraUpdate`.
- Camera has at least `80px` padding around all visible content.
- Titles and footers are not near the camera edge.
- Arrows have explicit `points` and enough space for labels.
- Calls go through PMX (`canvas_add_diagram` or `external-app add --kind excalidraw`) unless you manually apply these rules to raw Excalidraw MCP input.
