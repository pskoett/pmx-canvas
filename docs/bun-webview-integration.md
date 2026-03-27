# Feature: Bun.WebView Canvas Browser

Replace platform-specific browser launching with Bun's built-in `Bun.WebView` API for a unified, programmatically controlled canvas window.

## Status

**Planned** — Waiting for `Bun.WebView` to ship in a stable Bun release. Currently available in Bun canary (1.3.11+). The Bun team has indicated breaking changes are expected before stable.

## Motivation

Today, `openUrlInExternalBrowser()` in `server.ts` uses three platform-specific code paths to open the canvas:

- **macOS**: `osascript` with AppleScript to launch a browser
- **Windows**: `cmd /c start` or a resolved browser `.exe`
- **Linux**: `xdg-open`

This approach has several limitations:

1. **No programmatic control** — once the browser opens, the server can't resize, screenshot, or interact with it
2. **Platform fragmentation** — three separate branches to maintain, each with different failure modes
3. **External dependency** — requires the user to have a browser installed and correctly configured
4. **No window management** — can't set canvas-specific window dimensions, title, or position

## Proposed Solution

Use `Bun.WebView` as the default canvas browser backend when available, with fallback to the current `openUrlInExternalBrowser()` for older Bun versions.

### API Surface (confirmed working in canary)

```typescript
const view = new Bun.WebView({
  width: 1280,
  height: 800,
  headless: true,              // optional, for CI/server environments
  backend: {
    type: "chrome",
    path: "/path/to/chrome",   // optional, auto-detected
  },
});

await view.navigate(url);
await view.evaluate("document.title");
await view.screenshot();       // returns PNG as Uint8Array
await view.click(x, y);
await view.scroll(dx, dy);
await view.type("text");
view.close();
```

Full prototype methods: `navigate`, `evaluate`, `screenshot`, `cdp`, `click`, `type`, `press`, `scroll`, `scrollTo`, `resize`, `goBack`, `goForward`, `reload`, `close`, `url`, `title`, `loading`, `onNavigated`, `onNavigationFailed`.

### Implementation Plan

#### 1. Add `--webview` CLI flag

```
pmx-canvas --webview          # Use Bun.WebView instead of external browser
pmx-canvas --webview=headless # Headless mode (no visible window)
```

#### 2. Replace `openUrlInExternalBrowser()` with a unified launcher

```typescript
// src/server/server.ts

async function openCanvasInWebView(url: string, opts?: { headless?: boolean }): Promise<boolean> {
  if (typeof Bun.WebView !== "function") return false;

  const view = new Bun.WebView({
    width: 1280,
    height: 800,
    headless: opts?.headless ?? false,
  });

  await view.navigate(url);
  return true;
}

export async function openCanvasBrowser(url: string): Promise<boolean> {
  if (useWebView) {
    const ok = await openCanvasInWebView(url);
    if (ok) return true;
  }
  return openUrlInExternalBrowser(url);
}
```

#### 3. Expose WebView handle for programmatic control

Store the `Bun.WebView` instance so the server and MCP tools can:

- **Screenshot the canvas** — useful for agents that need visual feedback
- **Resize the viewport** — adapt to different workflows
- **Evaluate JS** — bridge between server state and client rendering
- **CDP access** — full Chrome DevTools Protocol for advanced automation

#### 4. Add canvas MCP tools (future)

```
canvas_screenshot    — capture current canvas as PNG
canvas_resize        — resize the canvas window
canvas_evaluate      — run JS in the canvas browser context
```

## Browser Detection

`Bun.WebView` uses Chrome/Chromium under the hood (CDP protocol). Detection order:

1. `BUN_CHROME_PATH` environment variable
2. `backend.path` option
3. System Chrome/Chromium installation
4. Playwright browser installs (`~/.cache/ms-playwright/`)

On Windows, it will use WebView2 (same API, different backend).

## Validation Results

Tested on Bun 1.3.11 canary with Playwright Chromium:

| Test | Result |
|------|--------|
| WebView creation | Pass |
| Navigate to canvas URL | Pass |
| Canvas renders (nodes, toolbar, edges) | Pass — 7 nodes detected |
| `evaluate()` JS execution | Pass |
| `click()` interaction | Pass |
| `scroll()` interaction | Pass |
| `screenshot()` capture | Pass |
| CDP access | Pass |
| `close()` cleanup | Pass |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| API breaking changes before stable | Wrap in try/catch with fallback to `openUrlInExternalBrowser()` |
| Chrome not installed on user's machine | Same as current — falls back to Playwright installs or errors gracefully |
| Container/CI environments need `--no-sandbox` | Detect containerized environment and add flag automatically |
| WebView2 on Windows may behave differently | Test once Windows support stabilizes |

## When to Implement

Implement when **all** of these are true:

1. `Bun.WebView` ships in a stable Bun release (not canary)
2. The API is marked stable (no more "breaking changes expected" warnings)
3. Windows WebView2 support is confirmed working
