---
name: playwright-cli
description: Browser automation via the Playwright CLI for validating PMX Canvas, embedded web artifacts, and external integrations from the terminal. Use when you need to open pages, click through UI flows, inspect element structure, take screenshots, or verify that a canvas-hosted app actually works in the browser.
---

# Playwright CLI

Use this skill when PMX Canvas work needs a real browser check instead of static inspection.

## When To Use

- Verify a PMX Canvas UI flow after changing the client
- Open an embedded `mcp-app` or `/artifact?path=...` route and confirm it renders
- Click through context menus, pins, groups, snapshots, and other browser-only interactions
- Capture screenshots or accessibility snapshots while keeping terminal context small

## Prerequisites

```bash
npm install -g @playwright/cli@latest
playwright-cli --version
```

Requires Node.js 18+.

## Core Workflow

1. Open the target URL with `playwright-cli open <url>`
2. Capture a structural snapshot with `playwright-cli snapshot`
3. Read the saved snapshot file to find element refs
4. Interact with the page using `click`, `fill`, `press`, or `goto`
5. Verify with another snapshot or a screenshot
6. Close the session when done

For PMX Canvas work, prefer a named session so you can keep a browser attached to the canvas while testing artifact tabs separately.

```bash
playwright-cli -s=canvas open http://localhost:4313
playwright-cli -s=canvas snapshot
playwright-cli -s=canvas screenshot
playwright-cli -s=canvas close
```

## Commands You Will Use Most

- `open [url]` — launch browser and optionally navigate
- `goto <url>` — move to another page
- `snapshot` — save page structure to disk
- `screenshot [ref]` — capture page or element image
- `click <ref>` — click an element by snapshot ref
- `fill <ref> <text>` — fill an input or textarea
- `press <key>` — send keyboard input
- `tab-new [url]`, `tab-list`, `tab-select <index>` — manage multiple pages
- `close` — close the current browser session

## PMX Canvas Guidance

- Start the canvas first: `bun run src/cli/index.ts --no-open`
- Use this skill after `canvas_build_web_artifact` when you need browser validation
- Prefer visible browser automation for UI investigation so the human can follow along
- Store screenshots and snapshots on disk, then only read back the specific files you need

## Pairing With Other Skills

- Use `pmx-canvas` to create, pin, connect, and inspect nodes
- Use `web-artifacts-builder` to scaffold richer React/shadcn artifacts
- Use this skill to validate the generated artifact route and embedded canvas node in a browser
