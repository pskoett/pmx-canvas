#!/bin/bash
set -euo pipefail

# Run Playwright via Node's CLI runner instead of `bun x playwright test`.
#
# Why not `bun x playwright test`? See .learnings/ERRORS.md [ERR-20260508-001]:
# under Bun, Playwright's TS/ESM transform tries to import a non-existent
# `playwright.config.ts.esm.preflight` module and fails BEFORE test discovery.
# Running the Playwright CLI under Node avoids Bun's loader entirely. Bun must
# still be on PATH — playwright.config.ts launches the canvas webServer with
# `bun run src/cli/index.ts`.

cd "$(dirname "$0")/.."

PLAYWRIGHT_CLI="node_modules/@playwright/test/cli.js"

if ! command -v node >/dev/null 2>&1; then
  echo "error: 'node' not found on PATH. Node is required to run Playwright (ERR-20260508-001 workaround)." >&2
  exit 1
fi

if [ ! -f "$PLAYWRIGHT_CLI" ]; then
  echo "error: $PLAYWRIGHT_CLI not found. Run 'bun install' first." >&2
  exit 1
fi

exec node "$PLAYWRIGHT_CLI" test "$@"
