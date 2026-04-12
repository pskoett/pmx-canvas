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

if python3 - <<'PY'
from pathlib import Path

root = Path.cwd()
sources = [
    root / "src/json-render/renderer/index.tsx",
    root / "src/json-render/renderer/index.css",
    root / "src/json-render/charts/components.tsx",
    root / "src/json-render/charts/definitions.ts",
]
artifacts = [
    root / "dist/json-render/index.js",
    root / "dist/json-render/index.css",
]

if not all(path.exists() for path in artifacts):
    raise SystemExit(1)

latest_source = max(path.stat().st_mtime for path in sources if path.exists())
oldest_artifact = min(path.stat().st_mtime for path in artifacts)

raise SystemExit(0 if oldest_artifact >= latest_source else 1)
PY
then
  DIST_UP_TO_DATE=1
else
  DIST_UP_TO_DATE=0
fi

if python3 - <<'PY'
import os
import subprocess
import sys

timeout_seconds = int(os.environ.get("BUILD_TIMEOUT_SECONDS", "45"))
command = [
    "bun",
    "build",
    "src/json-render/renderer/index.tsx",
    "--outdir",
    "dist/json-render",
    "--minify",
]

try:
    result = subprocess.run(command, timeout=timeout_seconds, check=False)
except subprocess.TimeoutExpired:
    raise SystemExit(124)

raise SystemExit(result.returncode)
PY
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
