# Bun.WebView Integration

PMX Canvas now uses Bun's built-in `Bun.WebView` API for **headless canvas automation**, while keeping the current external browser launcher for the normal interactive canvas window.

This document tracks:

- what is implemented today
- what was validated on stable Bun `v1.3.12`
- what still remains future work

## Current Status

**Implemented** for Phase 1.

The repo now targets Bun `>=1.3.12`, and PMX Canvas ships an opt-in, server-owned WebView automation session that can:

- start a headless browser session for `/workbench`
- report WebView runtime status
- evaluate JavaScript in the page
- resize the automation viewport
- capture screenshots
- stop and clean up the automation session explicitly

What is **not** implemented:

- replacing `openUrlInExternalBrowser()` for the visible user-facing canvas window
- headed Bun.WebView window support
- MCP tools for screenshot/evaluate/resize/CDP

## Why This Exists

The existing browser-launch path in [`src/server/server.ts`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/src/server/server.ts) still opens the interactive canvas with platform-specific shell behavior:

- macOS: AppleScript / `osascript`
- Windows: `cmd /c start` or a resolved browser executable
- Linux: `xdg-open`

That path is still appropriate for humans, but it provides no programmatic control once the browser is open.

`Bun.WebView` gives PMX Canvas a controlled browser session that the server can own directly. That unlocks:

- agent-visible screenshots
- browser-backed evaluation of rendered canvas state
- controlled viewport sizing
- future browser automation tools without depending on Playwright for the basic runtime

## Implemented Surface

### Server layer

Implemented in [`src/server/server.ts`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/src/server/server.ts):

- `getCanvasAutomationWebViewStatus()`
- `startCanvasAutomationWebView(url, options)`
- `stopCanvasAutomationWebView()`
- `evaluateCanvasAutomationWebView(expression)`
- `resizeCanvasAutomationWebView(width, height)`
- `screenshotCanvasAutomationWebView(options)`

Important behavior:

- runtime-gated: if `Bun.WebView` is unavailable, PMX Canvas returns a clear error
- headless-only: PMX Canvas does not rely on `headless: false`
- explicit lifecycle: start and stop are owned by the server
- screenshot normalization handles Bun return types correctly, including `Blob`

### HTTP API

Implemented in [`src/server/server.ts`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/src/server/server.ts):

- `GET /api/workbench/webview`
- `POST /api/workbench/webview/start`
- `DELETE /api/workbench/webview`

Current HTTP behavior:

- `GET` returns runtime support plus active-session status
- `POST` starts a new headless automation session for the current `/workbench`
- `DELETE` stops the current automation session

Current options accepted by `POST /api/workbench/webview/start`:

- `backend`: `"chrome"` or `"webkit"`
- `width`
- `height`
- `chromePath`
- `chromeArgv`
- `dataStoreDir`

### SDK

Implemented in [`src/server/index.ts`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/src/server/index.ts):

- `canvas.start({ automationWebView: ... })`
- `canvas.startAutomationWebView(options)`
- `canvas.stopAutomationWebView()`
- `canvas.getAutomationWebViewStatus()`
- `canvas.evaluateAutomationWebView(expression)`
- `canvas.resizeAutomationWebView(width, height)`
- `canvas.screenshotAutomationWebView(options)`

### CLI

Implemented in [`src/cli/index.ts`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/src/cli/index.ts):

- `--webview-automation`
- `--webview-backend`
- `--webview-width`
- `--webview-height`
- `--webview-chrome-path`
- `--webview-chrome-argv`
- `--webview-data-dir`

Example:

```bash
pmx-canvas --no-open --webview-automation
pmx-canvas --webview-automation --webview-backend=chrome
```

These flags are intentionally automation-only. They do **not** imply a visible Bun-managed window.

## Backend Strategy

PMX Canvas follows Bun's current stable backend reality.

### WebKit backend

- macOS only
- good default on macOS when CDP is not required
- zero external Chrome dependency

### Chrome backend

- required on Linux and Windows
- also supported on macOS
- preferred when backend consistency or future CDP-based tooling matters

### Current default behavior

PMX Canvas defaults to:

- `webkit` on macOS
- `chrome` elsewhere

If `chromePath` or `chromeArgv` is provided, PMX Canvas forces a Chrome-backed session.

## Bun Runtime Requirements

The repo now requires:

- Bun `>=1.3.12`

That change is reflected in:

- [`package.json`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/package.json)
- [`.github/workflows/test.yml`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/.github/workflows/test.yml)

PMX Canvas still keeps a runtime guard because older local Bun versions can exist in user environments. If `Bun.WebView` is missing, startup fails cleanly for the automation path instead of partially starting.

## Validation Results

Validated on Bun `v1.3.12`.

### Unit coverage

Verified by tests in:

- [`tests/unit/server-api.test.ts`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/tests/unit/server-api.test.ts)
- [`tests/unit/webview-automation.test.ts`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/tests/unit/webview-automation.test.ts)

Covered behavior:

- WebView status over HTTP
- start/stop lifecycle over HTTP
- graceful unsupported-runtime handling
- SDK start/evaluate/resize/screenshot flow

### Live runtime smoke

Validated manually after upgrading the local runtime to Bun `1.3.12`:

- `pmx-canvas --port=4529 --no-open --webview-automation --webview-backend=chrome`
- `GET /api/workbench/webview`
- `DELETE /api/workbench/webview`
- SDK smoke with:
  - `startAutomationWebView`
  - `evaluateAutomationWebView('document.title')`
  - `resizeAutomationWebView(...)`
  - `screenshotAutomationWebView(...)`

Observed results:

- automation session started successfully
- status endpoint reported `active: true`
- JS evaluation returned `"PMX Canvas"`
- viewport resize updated status correctly
- screenshots returned non-zero image bytes on both WebKit and Chrome backends during smoke testing

## Implementation Notes

### Screenshot normalization bug

During real runtime validation, a bug was found in the first implementation:

- PMX Canvas assumed `view.screenshot()` returned only `Uint8Array` or `ArrayBuffer`
- on this machine, Bun could also return a `Blob`
- that caused zero-byte screenshots in the wrapper even though Bun was returning valid image data

This was fixed in [`src/server/server.ts`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/src/server/server.ts) by normalizing:

- `Uint8Array`
- `ArrayBuffer`
- `Blob`

The regression is now covered by [`tests/unit/webview-automation.test.ts`](/Users/pepe/Library/CloudStorage/OneDrive-TV2DANMARK/Dokumenter/GitHub/pmx-canvas/tests/unit/webview-automation.test.ts).

### Why the interactive browser path still exists

Even with Bun `v1.3.12`, PMX Canvas should still keep `openUrlInExternalBrowser()` for the normal canvas window because Bun's current documented WebView surface is still effectively headless automation. There is no reason yet to promise a headed replacement window to users.

## Known Limits

These are current, accepted constraints:

- no visible Bun-managed canvas window
- no MCP tools yet for screenshots/evaluation/resize/CDP
- no persistent automation-session orchestration beyond the single owned server session
- no dedicated HTTP endpoints yet for screenshot/evaluate/resize; only lifecycle and status are exposed over HTTP right now

## Future Work

### Near-term

The most obvious next steps are:

1. Add MCP tools that target the existing automation session:
   - `canvas_screenshot`
   - `canvas_resize`
   - `canvas_evaluate`
   - optional `canvas_cdp` for Chrome-backed sessions only
2. Add HTTP endpoints for screenshot/evaluate/resize if direct HTTP consumers need them
3. Decide whether the default macOS backend should stay `webkit` or move to `chrome` for stricter cross-platform parity
4. Add more backend-specific test coverage if Bun behavior diverges between WebKit and Chrome

### Later

Defer these until Bun's API justifies them:

1. Replace `openUrlInExternalBrowser()` with Bun.WebView for the normal interactive canvas window
2. Add headed window management semantics
3. Build user-facing browser controls around Bun.WebView if Bun documents those behaviors as stable

## Decision Summary

The project should continue with this split:

- **Interactive canvas for humans**: external browser
- **Programmatic canvas automation for agents/server workflows**: Bun.WebView

That keeps the current user-facing behavior stable while giving PMX Canvas a real browser automation surface that is built into the runtime.
