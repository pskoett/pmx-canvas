#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist/json-render"
JS_OUT="${DIST_DIR}/index.js"
CSS_OUT="${DIST_DIR}/index.css"
BUILD_TIMEOUT_SECONDS="${PMX_JSON_RENDER_BUILD_TIMEOUT_SECONDS:-45}"
export BUILD_TIMEOUT_SECONDS

cd "${ROOT_DIR}"

mkdir -p "${DIST_DIR}"

if [[ -f "${ROOT_DIR}/node_modules/@tailwindcss/cli/dist/index.mjs" ]]; then
  TAILWIND_CMD=(bun "${ROOT_DIR}/node_modules/@tailwindcss/cli/dist/index.mjs")
else
  TAILWIND_CMD=(bun x @tailwindcss/cli)
fi

"${TAILWIND_CMD[@]}" \
  -i src/json-render/renderer/index.css \
  -o "${CSS_OUT}" \
  --minify

# Stale-bundle gate (Bun script — the build must not depend on python3): the
# dist bundle counts as up to date when both artifacts exist and neither is
# older than the newest renderer source. Feeds the timeout fallback below.
if bun run - <<'JS'
const { statSync } = require("node:fs");

const sources = [
  "src/json-render/renderer/index.tsx",
  "src/json-render/renderer/index.css",
  "src/json-render/charts/components.tsx",
  "src/json-render/charts/definitions.ts",
  "src/json-render/charts/extra-components.tsx",
  "src/json-render/charts/extra-definitions.ts",
  "src/json-render/charts/tufte-components.tsx",
  "src/json-render/charts/tufte-definitions.ts",
];
const artifacts = ["dist/json-render/index.js", "dist/json-render/index.css"];

const mtime = (path) => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
};

const artifactTimes = artifacts.map(mtime);
if (artifactTimes.some((time) => time === null)) process.exit(1);

const sourceTimes = sources.map(mtime).filter((time) => time !== null);
if (sourceTimes.length === 0) process.exit(1);

process.exit(Math.min(...artifactTimes) >= Math.max(...sourceTimes) ? 0 : 1);
JS
then
  DIST_UP_TO_DATE=1
else
  DIST_UP_TO_DATE=0
fi

# Bundle build under a timeout (Bun script, no python3). Exits 124 on timeout,
# mirroring timeout(1), so the fallback below can tell timeout from failure.
if bun run - <<'JS'
const { spawnSync } = require("node:child_process");

const timeoutSeconds = Number.parseInt(process.env.BUILD_TIMEOUT_SECONDS ?? "45", 10);
const result = spawnSync(
  "bun",
  [
    "build",
    "src/json-render/renderer/index.tsx",
    "--outdir",
    "dist/json-render",
    "--minify",
    // Force the production JSX transform. When a tsconfig.json is in scope,
    // Bun (>= 1.3.x) ignores the NODE_ENV define for JSX dev/prod selection and
    // emits jsxDEV calls — which are undefined in prod-mode React, so the viewer
    // crashes at runtime with "t is not a function". --production also sets
    // NODE_ENV=production and enables minification.
    "--production",
    // Ship prod-mode React and let isProduction() fold the @json-render devtools
    // panel out of the bundle (the panel is also runtime-gated by the
    // __PMX_CANVAS_JSON_RENDER_DEVTOOLS__ global, so it never mounts by default).
    '--define:process.env.NODE_ENV="production"',
  ],
  { stdio: "inherit", timeout: timeoutSeconds * 1000, killSignal: "SIGKILL" },
);

if (result.error && result.error.code === "ETIMEDOUT") process.exit(124);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
JS
then
  exit 0
else
  build_status=$?
fi

if [[ "${build_status}" -eq 124 && "${DIST_UP_TO_DATE}" -eq 1 ]]; then
  echo "[build:json-render] bun build timed out after ${BUILD_TIMEOUT_SECONDS}s; using the existing dist/json-render bundle." >&2
  exit 0
fi

if [[ "${build_status}" -eq 124 ]]; then
  echo "[build:json-render] bun build timed out after ${BUILD_TIMEOUT_SECONDS}s and dist/json-render is stale." >&2
else
  echo "[build:json-render] bun build failed with exit code ${build_status}." >&2
fi

exit "${build_status}"
