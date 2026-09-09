#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
PORT="${PMX_CANVAS_RELEASE_SMOKE_PORT:-4553}"
PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pmx-canvas-pack.XXXXXX")"
CONSUMER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pmx-canvas-consumer.XXXXXX")"
SERVER_LOG="${CONSUMER_DIR}/pmx-canvas.log"
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -rf "${PACK_DIR}" "${CONSUMER_DIR}"
}

trap cleanup EXIT

if [[ -z "${BUN_BIN}" || ! -x "${BUN_BIN}" ]]; then
  echo "Bun binary not found. Set BUN_BIN or install Bun." >&2
  exit 1
fi

cd "${ROOT_DIR}"

TARBALL_NAME="$("${BUN_BIN}" pm pack --quiet --destination "${PACK_DIR}" | tail -n 1)"
if [[ "${TARBALL_NAME}" = /* ]]; then
  TARBALL_PATH="${TARBALL_NAME}"
else
  TARBALL_PATH="${PACK_DIR}/${TARBALL_NAME}"
fi

cat > "${CONSUMER_DIR}/package.json" <<'JSON'
{
  "name": "pmx-canvas-release-smoke",
  "private": true,
  "type": "module"
}
JSON

(
  cd "${CONSUMER_DIR}"
  "${BUN_BIN}" add "${TARBALL_PATH}" >/dev/null
  "${BUN_BIN}" -e "import { createCanvas } from 'pmx-canvas'; if (typeof createCanvas !== 'function') throw new Error('Expected createCanvas export.');"
  ./node_modules/.bin/pmx-canvas --help >/dev/null
  PMX_CANVAS_DISABLE_BROWSER_OPEN=1 ./node_modules/.bin/pmx-canvas --no-open --port="${PORT}" >"${SERVER_LOG}" 2>&1 &
  echo $! > .pmx-canvas.pid
)

SERVER_PID="$(cat "${CONSUMER_DIR}/.pmx-canvas.pid")"

READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/canvas/state" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:${PORT}/canvas/index.js" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [[ "${READY}" -ne 1 ]]; then
  echo "Packed package did not start successfully. Server log:" >&2
  cat "${SERVER_LOG}" >&2 || true
  exit 1
fi

cat > "${CONSUMER_DIR}/App.tsx" <<'TSX'
export default function App() {
  return <main>Packaged cache recovery</main>;
}
TSX

build_artifact() {
  (
    cd "${CONSUMER_DIR}"
    ./node_modules/.bin/pmx-canvas --port="${PORT}" web-artifact build \
      --title "Packaged cache recovery" --app-file ./App.tsx
  )
}

INITIAL_BUILD="$(build_artifact)"
PROJECT_PATH="$(printf '%s' "${INITIAL_BUILD}" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["bytes"] > 0; print(d["projectPath"])')"
INITIAL_OUTPUT="$(printf '%s' "${INITIAL_BUILD}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["path"])')"
test -s "${INITIAL_OUTPUT}"

# Reused artifact projects can inherit a corrupt Parcel cache. A regular file is
# a deterministic stand-in that makes Parcel fail while opening its cache dir.
rm -rf "${PROJECT_PATH}/.parcel-cache"
printf 'corrupt cache sentinel\n' > "${PROJECT_PATH}/.parcel-cache"
RECOVERED_BUILD="$(build_artifact)"
RECOVERED_OUTPUT="$(printf '%s' "${RECOVERED_BUILD}" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["bytes"] > 0; print(d["path"])')"
test -s "${RECOVERED_OUTPUT}"
grep -q "Packaged cache recovery" "${RECOVERED_OUTPUT}"

# Cache recovery must not turn a genuine source/build error into success.
cat > "${CONSUMER_DIR}/App.tsx" <<'TSX'
export default function App() {
  return <main>unterminated;
}
TSX
set +e
FAILED_BUILD="$(build_artifact)"
FAILED_STATUS=$?
set -e
if [[ "${FAILED_STATUS}" -eq 0 ]]; then
  echo "Expected a genuine packaged artifact build failure to remain non-zero" >&2
  exit 1
fi
printf '%s' "${FAILED_BUILD}" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] is False'

echo "Release smoke passed"
echo "  tarball: ${TARBALL_PATH}"
echo "  consumer: ${CONSUMER_DIR}"
echo "  url: http://127.0.0.1:${PORT}/workbench"
