#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
PORT="${PMX_CANVAS_E2E_PORT:-4567}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pmx-canvas-e2e.XXXXXX")"
SERVER_LOG="${WORK_DIR}/pmx-canvas.log"
SERVER_PID=""
CLI=("${BUN_BIN}" "run" "${ROOT_DIR}/src/cli/index.ts")

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  if [[ "${PMX_CANVAS_E2E_KEEP_WORKDIR:-}" != "1" ]]; then
    rm -rf "${WORK_DIR}"
  else
    echo "Kept workdir: ${WORK_DIR}"
  fi
}

json_check() {
  python3 -c 'import sys,json; json.load(sys.stdin)'
}

node_id() {
  python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'
}

json_field() {
  local field="$1"
  FIELD="${field}" python3 -c 'import os,sys,json; d=json.load(sys.stdin); v=d.get(os.environ["FIELD"]); assert isinstance(v, str) and v, d; print(v)'
}

assert_json() {
  local expr="$1"
  python3 -c "import sys,json; d=json.load(sys.stdin); assert ${expr}, d"
}

trap cleanup EXIT

if [[ -z "${BUN_BIN}" || ! -x "${BUN_BIN}" ]]; then
  echo "Bun binary not found. Set BUN_BIN or install Bun." >&2
  exit 1
fi

cd "${WORK_DIR}"

PMX_CANVAS_DISABLE_BROWSER_OPEN=1 "${CLI[@]}" --no-open --port="${PORT}" >"${SERVER_LOG}" 2>&1 &
SERVER_PID="$!"

READY=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:${PORT}/api/canvas/state" | json_check \
    && curl -fsS "http://127.0.0.1:${PORT}/canvas/index.js" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [[ "${READY}" -ne 1 ]]; then
  echo "PMX Canvas did not become ready. Server log:" >&2
  cat "${SERVER_LOG}" >&2 || true
  exit 1
fi

export PMX_CANVAS_URL="http://127.0.0.1:${PORT}"

cat > README.md <<'MD'
# E2E Fixture

This is a local file fixture for PMX Canvas CLI coverage.
MD

python3 - <<'PY'
from pathlib import Path
Path('pixel.png').write_bytes(bytes.fromhex(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  '0000000d49444154789c6360000002000100ffff03000006000557bfab5f0000000049454e44ae426082'
))
PY

cat > dashboard.json <<'JSON'
{
  "root": "card",
  "elements": {
    "card": { "type": "Card", "props": { "title": "Coverage Dashboard" }, "children": ["copy"] },
    "copy": { "type": "Text", "props": { "text": "json-render is working" }, "children": [] }
  }
}
JSON

cat > dashboard-wide.json <<'JSON'
{
  "root": "grid",
  "elements": {
    "grid": { "type": "Grid", "props": { "columns": 2, "gap": "md" }, "children": ["card1", "card2"] },
    "card1": { "type": "Card", "props": { "title": "Adoption" }, "children": ["t1"] },
    "t1": { "type": "Text", "props": { "text": "78%" }, "children": [] },
    "card2": { "type": "Card", "props": { "title": "Quality" }, "children": ["t2"] },
    "t2": { "type": "Text", "props": { "text": "99.2%" }, "children": [] }
  }
}
JSON

cat > ArtifactControlRoom.tsx <<'TSX'
import React, { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const releaseSeries = [
  { day: "Mon", deploys: 12, incidents: 1, leadTime: 28 },
  { day: "Tue", deploys: 18, incidents: 0, leadTime: 22 },
  { day: "Wed", deploys: 15, incidents: 2, leadTime: 24 },
  { day: "Thu", deploys: 22, incidents: 1, leadTime: 18 },
  { day: "Fri", deploys: 27, incidents: 0, leadTime: 15 },
];

const gateSeries = [
  { lane: "Unit", pass: 98, warn: 2 },
  { lane: "E2E", pass: 91, warn: 7 },
  { lane: "Canary", pass: 87, warn: 9 },
  { lane: "Security", pass: 94, warn: 4 },
];

const ownership = [
  { name: "Product", value: 38, color: "#d7a83f" },
  { name: "Platform", value: 27, color: "#60b5ff" },
  { name: "Data", value: 21, color: "#65d69b" },
  { name: "Risk", value: 14, color: "#ff7a90" },
];

const focusCards = [
  { label: "Velocity", value: "19h", detail: "median lead time", accent: "amber" },
  { label: "Reliability", value: "99.3%", detail: "successful sessions", accent: "green" },
  { label: "Risk", value: "3", detail: "open release blockers", accent: "rose" },
];

export default function App() {
  const [focus, setFocus] = useState("Velocity");
  const selected = focusCards.find((card) => card.label === focus) ?? focusCards[0];

  return (
    <main className="control-shell" data-testid="artifact-control-room">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Live release intelligence</p>
          <h1>Atlas Release Control Room</h1>
          <p className="lede">
            A single-page operations surface for release managers to inspect throughput,
            gate health, incident load, and accountable teams before approving production.
          </p>
        </div>
        <div className="readout-card">
          <span>Current Decision</span>
          <strong>Proceed with guarded rollout</strong>
          <small>Canary stable for 42 minutes - payment retry storm isolated.</small>
        </div>
      </section>

      <section className="focus-grid" aria-label="release focus metrics">
        {focusCards.map((card) => (
          <button
            key={card.label}
            type="button"
            className={`metric-tile ${card.accent} ${focus === card.label ? "active" : ""}`}
            onClick={() => setFocus(card.label)}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </button>
        ))}
      </section>

      <section className="analysis-grid">
        <article className="chart-card wide">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Throughput</p>
              <h2>Deploys vs. lead time</h2>
            </div>
            <span className="status-pill">Selected focus: {selected.label}</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={releaseSeries}>
              <defs>
                <linearGradient id="deploy-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#d7a83f" stopOpacity={0.65} />
                  <stop offset="95%" stopColor="#d7a83f" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2f3545" strokeDasharray="4 6" />
              <XAxis dataKey="day" stroke="#aab0c0" />
              <YAxis stroke="#aab0c0" />
              <Tooltip contentStyle={{ background: "#151923", border: "1px solid #3a4257", borderRadius: 12 }} />
              <Area type="monotone" dataKey="deploys" stroke="#d7a83f" fill="url(#deploy-gradient)" strokeWidth={3} />
              <Line type="monotone" dataKey="leadTime" stroke="#60b5ff" strokeWidth={3} dot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <p className="eyebrow">Gate quality</p>
          <h2>Signal Quality</h2>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={gateSeries}>
              <CartesianGrid stroke="#2f3545" strokeDasharray="3 5" />
              <XAxis dataKey="lane" stroke="#aab0c0" />
              <YAxis stroke="#aab0c0" />
              <Tooltip contentStyle={{ background: "#151923", border: "1px solid #3a4257", borderRadius: 12 }} />
              <Bar dataKey="pass" stackId="gate" fill="#65d69b" radius={[6, 6, 0, 0]} />
              <Bar dataKey="warn" stackId="gate" fill="#ffb84d" />
            </BarChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <p className="eyebrow">Ownership</p>
          <h2>Operational load</h2>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={ownership} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="78%" paddingAngle={3}>
                {ownership.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#151923", border: "1px solid #3a4257", borderRadius: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </article>
      </section>

      <section className="detail-grid">
        <article className="incident-card">
          <p className="eyebrow">Active incident</p>
          <h2>Payment Retry Storm</h2>
          <p>
            Retries spiked after checkout cache invalidation. The canary stayed below the
            rollback threshold, but release approval remains gated on a clean synthetic run.
          </p>
          <ul>
            <li>Owner: Platform Reliability</li>
            <li>Mitigation: capped exponential backoff deployed</li>
            <li>Next check: 15 minute synthetic sweep</li>
          </ul>
        </article>
        <article className="timeline-card">
          <p className="eyebrow">Approval path</p>
          <ol>
            <li><span>01</span> Dependency Audit</li>
            <li><span>02</span> Canary Analysis</li>
            <li><span>03</span> Revenue Guardrail</li>
            <li><span>04</span> Release Captain Signoff</li>
          </ol>
        </article>
      </section>
    </main>
  );
}
TSX

cat > ArtifactDashboard.css <<'CSS'
:root {
  color-scheme: dark;
  background: #090b10;
  color: #f4efe3;
  font-family: "Avenir Next", "Trebuchet MS", sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: #090b10; }
button { font: inherit; }

.control-shell {
  min-height: 100vh;
  padding: 28px;
  background:
    radial-gradient(circle at 12% 18%, rgba(215, 168, 63, 0.24), transparent 28%),
    radial-gradient(circle at 86% 8%, rgba(96, 181, 255, 0.16), transparent 24%),
    linear-gradient(135deg, #0a0d13 0%, #151923 52%, #090b10 100%);
}

.hero-panel,
.chart-card,
.incident-card,
.timeline-card {
  border: 1px solid rgba(244, 239, 227, 0.14);
  background: rgba(16, 20, 29, 0.78);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(18px);
}

.hero-panel {
  display: grid;
  grid-template-columns: 1fr minmax(240px, 360px);
  gap: 24px;
  padding: 28px;
  border-radius: 28px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #d7a83f;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

h1, h2 { margin: 0; letter-spacing: -0.04em; }
h1 { font-family: Georgia, serif; font-size: clamp(40px, 7vw, 78px); line-height: 0.9; }
h2 { font-size: 24px; }
.lede { max-width: 760px; color: #c8c3b7; font-size: 18px; line-height: 1.6; }

.readout-card {
  align-self: stretch;
  display: grid;
  align-content: center;
  gap: 12px;
  padding: 24px;
  border-radius: 22px;
  background: linear-gradient(160deg, rgba(215, 168, 63, 0.18), rgba(96, 181, 255, 0.08));
}
.readout-card span,
.readout-card small { color: #aab0c0; }
.readout-card strong { font-size: 28px; }

.focus-grid,
.analysis-grid,
.detail-grid {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}
.focus-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.analysis-grid { grid-template-columns: 1.25fr 0.85fr; }
.detail-grid { grid-template-columns: 1fr 1fr; }

.metric-tile {
  min-height: 132px;
  text-align: left;
  padding: 20px;
  border: 1px solid rgba(244, 239, 227, 0.14);
  border-radius: 22px;
  color: inherit;
  background: rgba(16, 20, 29, 0.68);
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}
.metric-tile:hover,
.metric-tile.active { transform: translateY(-3px); border-color: rgba(215, 168, 63, 0.7); background: rgba(30, 35, 47, 0.9); }
.metric-tile span { display: block; color: #aab0c0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; }
.metric-tile strong { display: block; margin: 12px 0 4px; font-size: 38px; }
.metric-tile small { color: #c8c3b7; line-height: 1.5; }

.chart-card,
.incident-card,
.timeline-card { padding: 22px; border-radius: 24px; }
.chart-card.wide { grid-row: span 2; }
.card-heading { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.status-pill { padding: 8px 12px; border-radius: 999px; background: rgba(101, 214, 155, 0.12); color: #65d69b; font-size: 12px; }

.incident-card p { color: #c8c3b7; line-height: 1.6; }
.incident-card ul { margin: 18px 0 0; padding-left: 18px; color: #f4efe3; }
.timeline-card ol { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 12px; }
.timeline-card li { display: flex; align-items: center; gap: 12px; color: #f4efe3; }
.timeline-card li span { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: #d7a83f; color: #090b10; font-weight: 900; }

@media (max-width: 820px) {
  .control-shell { padding: 16px; }
  .hero-panel,
  .analysis-grid,
  .detail-grid,
  .focus-grid { grid-template-columns: 1fr; }
  .chart-card.wide { grid-row: auto; }
}
CSS

cat > AppBad.tsx <<'TSX'
import React from "react";
import MissingThing from "definitely-missing-package";
export default function App() { return <MissingThing/>; }
TSX

"${CLI[@]}" layout | json_check
"${CLI[@]}" node list | json_check

"${CLI[@]}" node add --type markdown --title "Markdown" --content "# Hello" --x 40 --y 40 | json_check
"${CLI[@]}" node add --type status --title "Status" --content "passing" | json_check
"${CLI[@]}" node add --type context --title "Context" --content "important" | json_check
"${CLI[@]}" node add --type trace --title "Trace" --content "step 1" | json_check
"${CLI[@]}" node add --type ledger --title "Ledger" --content "entry" | json_check
"${CLI[@]}" node add --type file --content ./README.md | json_check
"${CLI[@]}" node add --type image --content ./pixel.png | json_check
"${CLI[@]}" node add --type webpage --url https://example.com | json_check
"${CLI[@]}" node add --type webpage --content https://example.org | json_check

SCHEMA_GRAPH_TYPES="$("${CLI[@]}" node schema --summary | python3 -c 'import sys,json; d=json.load(sys.stdin); print(" ".join(d["graph"]["graphTypes"]))')"
for graph_type in line bar pie area scatter radar stacked-bar composed; do
  if [[ " ${SCHEMA_GRAPH_TYPES} " != *" ${graph_type} "* ]]; then
    echo "Missing graph type in schema: ${graph_type}" >&2
    exit 1
  fi
done

GRAPH_ID="$("${CLI[@]}" node add --type graph --graph-type bar --title "Graph Alias" --data '[{"x":"a","y":1},{"x":"b","y":2}]' --x-key x --y-key y --x 40 --y 40 --width 320 --height 240 | node_id)"
"${CLI[@]}" node get "${GRAPH_ID}" | assert_json 'd["type"] == "graph"'
CAMEL_GRAPH_ID="$("${CLI[@]}" node add --type graph --graphType bar --title "Graph Camel Flags" --data '[{"x":"a","y":1}]' --xKey x --yKey y | node_id)"
"${CLI[@]}" node get "${CAMEL_GRAPH_ID}" | assert_json 'd["data"]["graphConfig"]["graphType"] == "bar" and d["data"]["graphConfig"]["xKey"] == "x" and d["data"]["graphConfig"]["yKey"] == "y" and d["data"]["spec"]["elements"]["chart"]["type"] == "BarChart"'

LINE_ID="$("${CLI[@]}" node add --type graph --graph-type line --title "Graph-Line" --data-json '[{"day":"Mon","value":3},{"day":"Tue","value":5},{"day":"Wed","value":4}]' --x-key day --y-key value --color '#60b5ff' | node_id)"
BAR_ID="$("${CLI[@]}" node add --type graph --graph-type bar --title "Graph-Bar" --data-json '[{"team":"Docs","tickets":11},{"team":"Build","tickets":7},{"team":"QA","tickets":13}]' --x-key team --y-key tickets --aggregate sum --color '#65d69b' | node_id)"
PIE_ID="$("${CLI[@]}" node add --type graph --graph-type pie --title "Graph-Pie" --data-json '[{"name":"Product","value":38},{"name":"Platform","value":27},{"name":"Data","value":21}]' --name-key name --value-key value | node_id)"
AREA_ID="$("${CLI[@]}" node add --type graph --graph-type area --title "Graph-Area" --data-json '[{"week":"W1","risk":12},{"week":"W2","risk":8},{"week":"W3","risk":5}]' --x-key week --y-key risk --color '#d7a83f' | node_id)"
SCATTER_ID="$("${CLI[@]}" node add --type graph --graph-type scatter --title "Graph-Scatter" --data-json '[{"x":1,"y":2,"z":4},{"x":2,"y":5,"z":8},{"x":4,"y":7,"z":12}]' --x-key x --y-key y --z-key z --color '#ff7a90' | node_id)"
RADAR_ID="$("${CLI[@]}" node add --type graph --graph-type radar --title "Graph-Radar" --data-json '[{"axis":"Speed","north":5,"south":3},{"axis":"Quality","north":4,"south":6},{"axis":"Safety","north":6,"south":5}]' --axis-key axis --metrics north,south | node_id)"
STACKED_ID="$("${CLI[@]}" node add --type graph --graph-type stacked-bar --title "Graph-Stacked" --data-json '[{"month":"Jan","north":5,"south":3},{"month":"Feb","north":4,"south":6},{"month":"Mar","north":7,"south":4}]' --x-key month --series north,south --aggregate sum | node_id)"
COMPOSED_ID="$("${CLI[@]}" node add --type graph --graph-type composed --title "Graph-Composed" --data-json '[{"month":"Jan","visits":120,"conversion":0.2},{"month":"Feb","visits":160,"conversion":0.3},{"month":"Mar","visits":180,"conversion":0.34}]' --x-key month --bar-key visits --line-key conversion --bar-color '#60b5ff' --line-color '#d7a83f' | node_id)"
STACK_ALIAS_ID="$("${CLI[@]}" node add --type graph --graph-type stack --title "Graph-Stack-Alias" --data-json '[{"month":"Apr","north":3,"south":2},{"month":"May","north":6,"south":4}]' --x-key month --series north,south | node_id)"
COMBO_ALIAS_ID="$("${CLI[@]}" node add --type graph --graph-type combo --title "Graph-Combo-Alias" --data-json '[{"month":"Apr","visits":140,"conversion":0.25},{"month":"May","visits":175,"conversion":0.31}]' --x-key month --bar-key visits --line-key conversion | node_id)"

"${CLI[@]}" node get "${LINE_ID}" | assert_json 'd["data"]["graphConfig"]["graphType"] == "line"'
"${CLI[@]}" node get "${BAR_ID}" | assert_json 'd["data"]["graphConfig"]["graphType"] == "bar" and d["data"]["graphConfig"]["aggregate"] == "sum"'
"${CLI[@]}" node get "${PIE_ID}" | assert_json 'd["data"]["graphConfig"]["graphType"] == "pie" and d["data"]["graphConfig"]["nameKey"] == "name"'
"${CLI[@]}" node get "${AREA_ID}" | assert_json 'd["data"]["graphConfig"]["graphType"] == "area"'
"${CLI[@]}" node get "${SCATTER_ID}" | assert_json 'd["data"]["graphConfig"]["graphType"] == "scatter" and d["data"]["graphConfig"]["zKey"] == "z"'
"${CLI[@]}" node get "${RADAR_ID}" | assert_json 'd["data"]["graphConfig"]["graphType"] == "radar" and d["data"]["graphConfig"]["metrics"] == ["north", "south"]'
"${CLI[@]}" node get "${STACKED_ID}" | assert_json 'd["data"]["graphConfig"]["graphType"] == "stacked-bar" and d["data"]["graphConfig"]["series"] == ["north", "south"]'
"${CLI[@]}" node get "${COMPOSED_ID}" | assert_json 'd["data"]["graphConfig"]["graphType"] == "composed" and d["data"]["graphConfig"]["barKey"] == "visits" and d["data"]["graphConfig"]["lineKey"] == "conversion"'
"${CLI[@]}" node get "${STACK_ALIAS_ID}" | assert_json 'd["data"]["spec"]["elements"]["chart"]["type"] == "StackedBarChart"'
"${CLI[@]}" node get "${COMBO_ALIAS_ID}" | assert_json 'd["data"]["spec"]["elements"]["chart"]["type"] == "ComposedChart"'

"${CLI[@]}" node add --type json-render --title "JSON Render" --spec-file ./dashboard.json --x 40 --y 320 --width 520 --height 360 | json_check
"${CLI[@]}" node add --type json-render --title "Dashboard Render" --spec-file ./dashboard-wide.json --x 620 --y 320 --width 960 --height 520 | json_check

MCP_APP_OUT="$(${CLI[@]} node add --type mcp-app --title T --content C 2>&1 >/dev/null || true)"
printf '%s' "${MCP_APP_OUT}" | assert_json '"error" in d and "cannot be created" in d["error"]'

DIAGRAM_ID="$("${CLI[@]}" external-app add --kind excalidraw --title "Diagram" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d["ok"] is True and d.get("id") == d.get("nodeId") and isinstance(d.get("nodeId"), str) and d["nodeId"] and not d["nodeId"].startswith("ext-app-ext-app-"); print(d["nodeId"])')"
"${CLI[@]}" node get "${DIAGRAM_ID}" | assert_json 'd["type"] == "mcp-app" and d["kind"] == "external-app" and d["data"]["title"] == "Diagram"'

set +e
BAD_OUT="$(${CLI[@]} web-artifact build --title Bad --app-file ./AppBad.tsx --include-logs)"
BAD_STATUS=$?
set -e
if [[ "${BAD_STATUS}" -eq 0 ]]; then
  echo "Expected broken web-artifact build to exit non-zero" >&2
  exit 1
fi
printf '%s' "${BAD_OUT}" | assert_json 'd["ok"] is False'
"${CLI[@]}" search "Bad" | assert_json 'd["results"] == []'

CONTROL_OUT="$("${CLI[@]}" web-artifact build --title "Atlas Release Control Room" --app-file ./ArtifactControlRoom.tsx --index-css-file ./ArtifactDashboard.css --deps recharts --include-logs)"
printf '%s' "${CONTROL_OUT}" | assert_json 'd["ok"] is True and d["bytes"] > 300000 and d["openedInCanvas"] is True and isinstance(d.get("nodeId"), str) and d["nodeId"] and d.get("metadata", {}).get("deps") == ["recharts"]'
CONTROL_PATH="$(printf '%s' "${CONTROL_OUT}" | json_field path)"
CONTROL_NODE_ID="$(printf '%s' "${CONTROL_OUT}" | json_field nodeId)"
grep -q "Atlas Release Control Room" "${CONTROL_PATH}"
grep -q "Payment Retry Storm" "${CONTROL_PATH}"
grep -q "recharts" "${CONTROL_PATH}"

PLAYWRIGHT_MODULE="${ROOT_DIR}/node_modules/@playwright/test/index.mjs"
if [[ -f "${PLAYWRIGHT_MODULE}" ]]; then
  cat > verify-artifacts.mjs <<'MJS'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);

const baseUrl = process.env.PMX_CANVAS_URL;
const controlNodeId = process.env.CONTROL_NODE_ID;
if (!baseUrl || !controlNodeId) throw new Error('Missing artifact verification environment.');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${baseUrl}/workbench`);

  const controlNode = page.locator('.canvas-node').filter({ hasText: 'Atlas Release Control Room' });
  await controlNode.waitFor({ state: 'visible', timeout: 15000 });
  const controlFrame = controlNode.frameLocator('iframe');
  await controlFrame.getByText('Atlas Release Control Room').waitFor({ state: 'visible', timeout: 15000 });
  await controlFrame.getByRole('heading', { name: 'Payment Retry Storm' }).waitFor({ state: 'visible', timeout: 15000 });
  await controlFrame.locator('.recharts-responsive-container').first().waitFor({ state: 'visible', timeout: 15000 });
  const chartCount = await controlFrame.locator('.recharts-responsive-container').count();
  if (chartCount < 3) throw new Error(`Expected at least 3 rendered Recharts containers, got ${chartCount}`);
} finally {
  await browser.close();
}
MJS
  PLAYWRIGHT_MODULE="file://${PLAYWRIGHT_MODULE}" CONTROL_NODE_ID="${CONTROL_NODE_ID}" "${BUN_BIN}" verify-artifacts.mjs
fi

"${CLI[@]}" layout | json_check
"${CLI[@]}" node list | json_check

FOCUS_ID="$(${CLI[@]} node add --type markdown --title Focus --content x --x 0 --y 0 | node_id)"
"${CLI[@]}" focus "${FOCUS_ID}" --no-pan | assert_json 'd["focused"] == "'"${FOCUS_ID}"'" and d["panned"] is False'

"${CLI[@]}" arrange --layout grid | assert_json 'd["ok"] is True'
"${CLI[@]}" validate | assert_json 'd["ok"] is True'

"${CLI[@]}" search "Atlas Release" | assert_json 'len(d["results"]) >= 1'
"${CLI[@]}" status | assert_json 'd["types"].get("web-artifact", 0) >= 1 and d["types"].get("graph", 0) >= 11 and d["types"].get("json-render", 0) >= 2'

echo "PMX Canvas CLI E2E coverage passed"
