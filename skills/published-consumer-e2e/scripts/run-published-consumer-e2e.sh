#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SKILL_DIR}/../.." && pwd)"

BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"
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

for required in examples/published-consumer-sdlc/seed-demo.ts scripts/run-playwright.sh tests/e2e/published-consumer.pw.ts; do
  if [[ ! -f "${REPO_ROOT}/${required}" ]]; then
    echo "[published-consumer] requires a source checkout, not an installed skill/package: missing ${required}" >&2
    exit 1
  fi
done
for required in dist/canvas/index.js dist/json-render/index.js dist/types/server/index.d.ts; do
  if [[ ! -f "${REPO_ROOT}/${required}" ]]; then
    echo "[published-consumer] missing ${required}; run bun install && bun run build in the source checkout first." >&2
    exit 1
  fi
done

if [[ -z "${WORKDIR}" ]]; then
  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pmx-canvas-published-consumer.XXXXXX")"
else
  mkdir -p "${WORKDIR}"
  if [[ -n "$(ls -A "${WORKDIR}")" ]]; then
    echo "[published-consumer] --workdir must be empty; refusing to replace existing files." >&2
    exit 1
  fi
fi
WORKDIR="$(cd "${WORKDIR}" && pwd)"

PACK_DIR="${WORKDIR}/pack"
CONSUMER_DIR="${WORKDIR}/consumer"
LOG_FILE="${WORKDIR}/server.log"
mkdir -p "${PACK_DIR}" "${CONSUMER_DIR}/demo"

cleanup() {
  if [[ -n "${SERVER_SERVICE:-}" ]]; then
    amp orb service stop "${SERVER_SERVICE}"
  elif [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

echo "[published-consumer] packing the package.json publish surface from ${REPO_ROOT}"
TARBALL="pmx-canvas-published-consumer.tgz"
(cd "${REPO_ROOT}" && "${BUN_BIN}" pm pack --filename "${PACK_DIR}/${TARBALL}" --quiet)

echo "[published-consumer] staging temp consumer at ${CONSUMER_DIR}"
cp -R "${REPO_ROOT}/examples/published-consumer-sdlc/." "${CONSUMER_DIR}/demo/"
cat > "${CONSUMER_DIR}/package.json" <<'JSON'
{
  "name": "pmx-canvas-published-consumer",
  "private": true,
  "type": "module"
}
JSON

(cd "${CONSUMER_DIR}" && "${BUN_BIN}" add "${PACK_DIR}/${TARBALL}")

if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "[published-consumer] port ${PORT} already has a healthy listener; choose a dedicated --port." >&2
  exit 1
fi

echo "[published-consumer] starting seeded demo on port ${PORT}"
export PMX_CANVAS_WORKSPACE_ROOT="${CONSUMER_DIR}"
export PMX_CANVAS_DB_PATH="${CONSUMER_DIR}/.pmx-canvas/canvas.db"
export PMX_CANVAS_STATE_FILE=""
export PMX_CANVAS_DISABLE_BROWSER_OPEN=1
if [[ -n "${AMP_ORB:-}" ]]; then
  SERVER_SERVICE="published-consumer-${PORT}-$$"
  printf -v SERVICE_COMMAND 'exec env PMX_CANVAS_WORKSPACE_ROOT=%q PMX_CANVAS_DB_PATH=%q PMX_CANVAS_STATE_FILE= PMX_CANVAS_DISABLE_BROWSER_OPEN=1 %q run demo/seed-demo.ts --port=%q --hold >%q 2>&1' \
    "${PMX_CANVAS_WORKSPACE_ROOT}" "${PMX_CANVAS_DB_PATH}" "${BUN_BIN}" "${PORT}" "${LOG_FILE}"
  amp orb service start "${SERVER_SERVICE}" --cwd "${CONSUMER_DIR}" --port "${PORT}" --command "${SERVICE_COMMAND}"
else
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
fi

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
  if [[ -n "${SERVER_PID:-}" ]] && ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "[published-consumer] seeded demo process exited early. Log follows:" >&2
    cat "${LOG_FILE}" >&2 || true
    exit 1
  fi

  NODE_COUNT="$(
    curl -fsS "http://127.0.0.1:${PORT}/api/canvas/state" \
      | python3 -c 'import json, sys; print(len(json.load(sys.stdin).get("nodes", [])))'
  )"

  if [[ "${NODE_COUNT}" -ge 18 ]] && grep -q 'Published consumer demo ready' "${LOG_FILE}"; then
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
  PLAYWRIGHT_ARGS=(tests/e2e/published-consumer.pw.ts --project=desktop "--output=${WORKDIR}/browser-results")
  if [[ "${HEADED}" -eq 1 ]]; then
    PLAYWRIGHT_ARGS+=(--headed)
  fi
  PMX_CANVAS_URL="http://127.0.0.1:${PORT}" bash "${REPO_ROOT}/scripts/run-playwright.sh" "${PLAYWRIGHT_ARGS[@]}"
fi

if [[ "${KEEP_RUNNING}" -eq 1 ]]; then
  trap - EXIT
  echo "[published-consumer] leaving server running"
  echo "  PMX_CANVAS_URL=http://127.0.0.1:${PORT}"
  echo "  PMX_CONSUMER_DIR=${CONSUMER_DIR}"
  if [[ -n "${SERVER_SERVICE:-}" ]]; then
    echo "  PMX_SERVER_SERVICE=${SERVER_SERVICE}"
  else
    echo "  PMX_SERVER_PID=${SERVER_PID}"
  fi
  exit 0
fi

cleanup
trap - EXIT
echo "[published-consumer] completed"
