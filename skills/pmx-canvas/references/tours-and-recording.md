# Tours and recording

Tours use the existing board cards as presentation content. Interactive presentation and
deterministic capture share this one stop model; recording does not create a second deck.

## Author a tour

Persist a tour with `canvas_view { action: "set-tour", tour: { stops: [...] } }` and read it with
`canvas_view { action: "get-tour" }`. A stop has exactly one target:

```json
{
  "stops": [
    { "target": { "nodeId": "overview-group" }, "duration": 1.5, "padding": 60 },
    { "target": { "nodeId": "detail-note" }, "duration": 2, "easing": "ease-in-out", "pullback": 0.7 },
    { "target": { "viewport": { "x": 80, "y": 100, "scale": 0.5 } }, "duration": 1 }
  ]
}
```

- `nodeId` may identify a card or group. Its persisted position and size determine the camera.
- An explicit viewport is `{ x, y, scale }`, with positive `scale`. Translation is screen-space:
  `screen = world * scale + offset`.
- `duration` is transition time in seconds (default 1; zero jumps). Valid values are 0–3600.
- `padding` is screen pixels around a node target (default 40).
- `easing` is `linear`, `ease-in-out` (default), or `ease-out`.
- `pullback` is 0–4 (default 0). It zooms out during the move without changing either endpoint.
- A tour contains at most 1000 stops.

Open `/workbench?present=1` for chrome-free viewing. Right, Down, or Space advances; Left or Up
goes back; Escape or **Exit presentation** exits. Right-drag pans and interrupts an ongoing
transition without editing cards. Stops do not auto-advance. A missing node target reports an
error and may be skipped. The presentation camera is local to that viewer while board content
continues to update. Recording hides the exit control.

Tours are board-scoped, persist with that board and its snapshots, participate in undo, and clear
with the board. Setting `tour: null` resets to a derived tour: groups ordered by y, then x, then
ID. A saved `{ "stops": [] }` intentionally has no stops; it does not enable group derivation.
Preserve the tour of each board when working across boards and target the intended board before
setting or reading it.

## Capture prerequisites and behavior

Start and verify the matching PMX daemon first: its `/health` workspace and version must match the
installation and workspace used by the CLI/MCP host. Capture is a local CLI/file operation. It
requires Bun with WebView support and Chrome (or `--chrome-path`); MP4 encoding additionally
requires ffmpeg. Recording starts a separate Chrome session; it does not capture the native host's
Browser pane. Use a new output path because existing output and frame paths are refused.

Capture the saved or derived tour:

```bash
pmx-canvas record --mode deterministic --present --fps 30 --resolution 1920x1080 --output tour.mp4
```

Use `--tour-file tour.json` in deterministic mode to try the same model without changing the
board. Resolution defaults to 1280x720 and FPS to 30 (valid 1–120). Deterministic mode resolves
target geometry once and emits `max(1, ceil(duration * fps))` frames per stop, including each
endpoint. Duplicate a stop to hold it. It makes camera timing deterministic, not iframe animation,
late fonts/network assets, or concurrent board edits.

Realtime mode instead needs one stopping rule: `--duration SECONDS` or `--stop-on-signal`. It
samples the live board and repeats frames when capture is slow to preserve wall-clock duration.
Capture has no audio and does not move other viewers' cameras or replace an existing automation
session.

An `.mp4` output uses ffmpeg/H.264. Frames and `recording.json` remain in `<output>.frames`; if
ffmpeg is unavailable, the command reports and returns the PNG sequence directory. Any other
output path is itself a PNG sequence directory. Encoding failures retain the frames and fail.
