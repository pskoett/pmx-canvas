#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SKILL_DIR}/../.." && pwd)"

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
PORT="4513"
WORKDIR=""
KEEP_RUNNING=0
SKIP_PLAYWRIGHT=0
HEADED=1

for arg in "$@"; do
  case "$arg" in
    --port=*)
      PORT="${arg#*=}"
      ;;
    --workdir=*)
      WORKDIR="${arg#*=}"
      ;;
    --keep-running)
      KEEP_RUNNING=1
      ;;
    --skip-playwright)
      SKIP_PLAYWRIGHT=1
      ;;
    --headless)
      HEADED=0
      ;;
    --headed)
      HEADED=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -x "${BUN_BIN}" ]]; then
  echo "Bun binary not found at ${BUN_BIN}. Set BUN_BIN or install Bun." >&2
  exit 1
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$(dirname "${BUN_BIN}"):${PATH}"

if [[ -z "${WORKDIR}" ]]; then
  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pmx-canvas-published-consumer.XXXXXX")"
else
  mkdir -p "${WORKDIR}"
fi

PACK_DIR="${WORKDIR}/pack"
PACKAGE_STAGING="${WORKDIR}/package"
CONSUMER_DIR="${WORKDIR}/consumer"
LOG_FILE="${WORKDIR}/server.log"
rm -rf "${PACK_DIR}" "${PACKAGE_STAGING}"
mkdir -p "${PACK_DIR}" "${PACKAGE_STAGING}/package" "${CONSUMER_DIR}/demo"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

echo "[published-consumer] assembling install tarball from ${REPO_ROOT}"
cp "${REPO_ROOT}/package.json" "${PACKAGE_STAGING}/package/package.json"
cp "${REPO_ROOT}/Readme.md" "${PACKAGE_STAGING}/package/Readme.md"
if [[ -f "${REPO_ROOT}/LICENSE" ]]; then
  cp "${REPO_ROOT}/LICENSE" "${PACKAGE_STAGING}/package/LICENSE"
fi
cp -R "${REPO_ROOT}/src" "${PACKAGE_STAGING}/package/src"
mkdir -p "${PACKAGE_STAGING}/package/dist/canvas" "${PACKAGE_STAGING}/package/dist/json-render"
cp "${REPO_ROOT}/dist/canvas/index.js" "${PACKAGE_STAGING}/package/dist/canvas/index.js"
cp "${REPO_ROOT}/dist/canvas/global.css" "${PACKAGE_STAGING}/package/dist/canvas/global.css"
cp "${REPO_ROOT}/dist/json-render/index.js" "${PACKAGE_STAGING}/package/dist/json-render/index.js"
cp "${REPO_ROOT}/dist/json-render/index.css" "${PACKAGE_STAGING}/package/dist/json-render/index.css"
TARBALL="pmx-canvas-published-consumer.tgz"
tar -czf "${PACK_DIR}/${TARBALL}" -C "${PACKAGE_STAGING}" package

echo "[published-consumer] staging temp consumer at ${CONSUMER_DIR}"
rm -rf "${CONSUMER_DIR}"
mkdir -p "${CONSUMER_DIR}/demo"
cp -R "${REPO_ROOT}/examples/published-consumer-sdlc/." "${CONSUMER_DIR}/demo/"
cat > "${CONSUMER_DIR}/package.json" <<'JSON'
{
  "name": "pmx-canvas-published-consumer",
  "private": true,
  "type": "module"
}
JSON

(cd "${CONSUMER_DIR}" && "${BUN_BIN}" add "${PACK_DIR}/${TARBALL}")

echo "[published-consumer] starting seeded demo on port ${PORT}"
SERVER_PID="$(
  python3 - "${CONSUMER_DIR}" "${BUN_BIN}" "${PORT}" "${LOG_FILE}" <<'PY'
import subprocess
import sys

consumer_dir, bun_bin, port, log_file = sys.argv[1:5]

with open(log_file, "ab", buffering=0) as log:
    proc = subprocess.Popen(
        [bun_bin, "run", "demo/seed-demo.ts", f"--port={port}", "--hold"],
        cwd=consumer_dir,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    print(proc.pid)
PY
)"

READY=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/canvas/state" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [[ "${READY}" -ne 1 ]]; then
  echo "[published-consumer] server did not become ready. Log follows:" >&2
  cat "${LOG_FILE}" >&2 || true
  exit 1
fi

SEEDED=0
NODE_COUNT="0"
for _ in $(seq 1 120); do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "[published-consumer] seeded demo process exited early. Log follows:" >&2
    cat "${LOG_FILE}" >&2 || true
    exit 1
  fi

  NODE_COUNT="$(
    curl -fsS "http://127.0.0.1:${PORT}/api/canvas/state" \
      | "${BUN_BIN}" -e 'let raw="";for await (const chunk of Bun.stdin.stream()){raw+=chunk instanceof Uint8Array ? Buffer.from(chunk).toString() : String(chunk);} const state=JSON.parse(raw); console.log(state.nodes.length);'
  )"

  if [[ "${NODE_COUNT}" -ge 18 ]]; then
    SEEDED=1
    break
  fi

  sleep 1
done

if [[ "${SEEDED}" -ne 1 ]]; then
  echo "[published-consumer] demo did not finish seeding. Last node count: ${NODE_COUNT}" >&2
  cat "${LOG_FILE}" >&2 || true
  exit 1
fi

echo "[published-consumer] workspace ready"
echo "  url: http://127.0.0.1:${PORT}/workbench"
echo "  node-count: ${NODE_COUNT}"
echo "  temp-workdir: ${WORKDIR}"
echo "  server-log: ${LOG_FILE}"

if [[ "${SKIP_PLAYWRIGHT}" -ne 1 ]]; then
  echo "[published-consumer] running browser validation"
  if ! command -v playwright-cli >/dev/null 2>&1; then
    echo "[published-consumer] playwright-cli is required for browser validation." >&2
    echo "Install it with: bun add -g @playwright/cli@latest" >&2
    exit 1
  fi

  PLAYWRIGHT_SESSION="pc${PORT}"
  PLAYWRIGHT_OPEN_CMD=(playwright-cli "-s=${PLAYWRIGHT_SESSION}" open "http://127.0.0.1:${PORT}/workbench" --browser chrome)
  if [[ "${HEADED}" -eq 1 ]]; then
    PLAYWRIGHT_OPEN_CMD+=(--headed)
  fi

  (
    cd "${REPO_ROOT}"
    rm -f .playwright-cli/page-*.yml .playwright-cli/page-*.png .playwright-cli/console-*.log 2>/dev/null || true
    "${PLAYWRIGHT_OPEN_CMD[@]}"
    sleep 3
    playwright-cli "-s=${PLAYWRIGHT_SESSION}" snapshot >/dev/null

    SNAPSHOT_FILE="$(ls -t .playwright-cli/page-*.yml | head -n 1)"
    if [[ -z "${SNAPSHOT_FILE}" ]]; then
      echo "[published-consumer] playwright-cli did not produce a snapshot." >&2
      exit 1
    fi

    for expected in \
      "Synthetic SDLC Report" \
      "Pipeline Atlas" \
      "SDLC Control Room Artifact" \
      "Control Tower Widgets" \
      "Release Gate Intake" \
      "Service Readiness Matrix" \
      "Lead Time Trend" \
      "Defects by Stage" \
      "Operational Load" \
      "Context (3)" \
      "npm pack" \
      "canvas.buildWebArtifact" \
      "playwright"
    do
      if ! rg -Fq "${expected}" "${SNAPSHOT_FILE}"; then
        echo "[published-consumer] expected browser snapshot to include: ${expected}" >&2
        echo "Snapshot: ${SNAPSHOT_FILE}" >&2
        exit 1
      fi
    done

    playwright-cli "-s=${PLAYWRIGHT_SESSION}" screenshot >/dev/null
    SCREENSHOT_FILE="$(ls -t .playwright-cli/page-*.png | head -n 1)"
    echo "[published-consumer] browser snapshot: ${SNAPSHOT_FILE}"
    echo "[published-consumer] browser screenshot: ${SCREENSHOT_FILE}"

    if [[ "${KEEP_RUNNING}" -ne 1 ]]; then
      playwright-cli "-s=${PLAYWRIGHT_SESSION}" close >/dev/null || true
    fi
  )
fi

if [[ "${KEEP_RUNNING}" -eq 1 ]]; then
  trap - EXIT
  echo "[published-consumer] leaving server running"
  echo "  PMX_CANVAS_URL=http://127.0.0.1:${PORT}"
  echo "  PMX_CONSUMER_DIR=${CONSUMER_DIR}"
  echo "  PMX_SERVER_PID=${SERVER_PID}"
  exit 0
fi

cleanup
trap - EXIT
echo "[published-consumer] completed"
