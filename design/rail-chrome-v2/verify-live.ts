/**
 * Live verification of the rail-chrome-v2 features, agent side through the real
 * MCP stdio server, human side through a headed Chromium — against one server.
 * Run from the repo root: `bun run design/rail-chrome-v2/verify-live.ts`
 * (screenshots + a scratch DB land in $PMX_VERIFY_OUT, default /tmp/pmx-canvas-verify).
 * Deliberately not part of the test suites: headed browser, real MCP process, ~90 s.
 */
import { chromium, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const S = process.env.PMX_VERIFY_OUT ?? '/tmp/pmx-canvas-verify';
mkdirSync(`${S}/live`, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(`${S}/live.db${suffix}`, { force: true });
const REPO = process.cwd();
const PORT = 4777;
const base = `http://localhost:${PORT}`;
const results: Array<{ step: string; ok: boolean; note?: string }> = [];
const check = (step: string, ok: boolean, note?: string) => {
  results.push({ step, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${note ? ` — ${note}` : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const human = (path: string, method: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = async <T>(path: string): Promise<T> => (await (await fetch(`${base}${path}`)).json()) as T;

// ── server ─────────────────────────────────────────────────────────────
const server = spawn('bun', ['run', 'src/cli/index.ts', '--no-open', '--port', String(PORT)], {
  cwd: REPO,
  env: { ...process.env, PMX_CANVAS_DB_PATH: `${S}/live.db`, PMX_CANVAS_DISABLE_BROWSER_OPEN: '1' },
  stdio: 'ignore',
});
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch {}
  await sleep(500);
}

// ── agent: real MCP stdio server attached to that canvas ───────────────
const transport = new StdioClientTransport({
  command: 'bun',
  args: ['run', 'src/mcp/server.ts'],
  cwd: REPO,
  env: { ...process.env, PMX_CANVAS_DISABLE_BROWSER_OPEN: '1', PMX_CANVAS_PORT: String(PORT), PMX_CANVAS_AGENT_SOURCE: 'claude-code' },
  stderr: 'pipe',
});
const agent = new Client({ name: 'live-verify', version: '0.1.0' }, { capabilities: {} });
await agent.connect(transport);
const tool = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const res = (await agent.callTool({ name, arguments: args })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
  const text = res.content.find((c) => c.type === 'text')?.text ?? '{}';
  try {
    return { ...(JSON.parse(text) as Record<string, unknown>), __isError: res.isError === true };
  } catch {
    return { text, __isError: res.isError === true };
  }
};

// ── human: headed browser ──────────────────────────────────────────────
const browser = await chromium.launch({ headless: false, slowMo: 40 });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page: Page = await ctx.newPage();
await page.goto(`${base}/workbench?name=mia`);
const shot = async (name: string) => page.screenshot({ path: `${S}/live/${name}.png` });

try {
  // 1. Empty board (quiet) and the empty state.
  await page.locator('[data-testid="empty-state"]').waitFor({ timeout: 10000 });
  check('quiet board shows the empty state, no agent chrome', (await page.locator('.session-panel, .command-bar, .agent-cursor').count()) === 0);
  await shot('01-empty');

  // 2. Agent writes with no session → external steering indicator + feed.
  const a = await tool('canvas_node', { action: 'add', type: 'markdown', title: 'Release plan', content: '## REL-421\n- tag the build\n- notify #releases', x: 140, y: 140, width: 320, height: 200 });
  const b = await tool('canvas_node', { action: 'add', type: 'status', title: 'Pipeline', content: 'green', x: 520, y: 140, width: 300, height: 180 });
  const c = await tool('canvas_node', { action: 'add', type: 'markdown', title: 'Telemetry notes', content: 'p95 latency is flat', x: 140, y: 420, width: 320, height: 180 });
  const aId = String(a.id), bId = String(b.id), cId = String(c.id);
  await page.locator('[data-testid="external-indicator"]').waitFor({ timeout: 5000 });
  check('external writer indicator appears for session-less MCP writes', true, await page.locator('[data-testid="external-indicator"]').innerText());
  await page.locator('[data-testid="external-indicator"]').click();
  await page.locator('[data-testid="activity-feed"]').waitFor();
  const rows = await page.locator('[data-testid="activity-row"] .activity-text').allInnerTexts();
  check('activity feed lists the writes with summaries', rows.some((r) => r.includes('Created markdown “Release plan”')), rows.slice(0, 3).join(' | '));
  await page.locator('[data-testid="activity-feed"]').getByRole('button', { name: 'Writers' }).click();
  check('writers sheet opens and names the writer', (await page.locator('[data-testid="writers-sheet"]').innerText()).includes('claude-code'));
  await shot('02-external-steering');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // 3. Human pins nodes, agent reads pinned context.
  await page.locator('.canvas-node').filter({ hasText: 'Release plan' }).locator('.ctx-pin-btn').click();
  await page.locator('.canvas-node').filter({ hasText: 'Telemetry notes' }).locator('.ctx-pin-btn').click();
  await page.locator('.context-pin-bar').waitFor();
  const pinned = await agent.readResource({ uri: 'canvas://pinned-context' });
  const pinnedText = String((pinned.contents[0] as { text?: string }).text ?? '');
  check('agent reads the human’s pins via canvas://pinned-context', pinnedText.includes('Release plan') && pinnedText.includes('Telemetry notes'));

  // 4. Agent attaches a session → Focus Session chrome; pre-session snapshot.
  const snapsBefore = (await get<unknown[]>('/api/canvas/snapshots?all=true')).length;
  await tool('canvas_ax_state', { action: 'set-presence', attached: true, label: 'Claude', phase: 'thinking', detail: 'planning' });
  await page.locator('.session-panel').waitFor({ timeout: 5000 });
  check('session panel + command bar mount on attach; indicator retires', (await page.locator('.command-bar').count()) === 1 && (await page.locator('[data-testid="external-indicator"]').count()) === 0);
  check('top-bar chip shows the phase', (await page.locator('.agent-chip').innerText()).includes('Thinking'));
  check('pre-session snapshot was taken', (await get<unknown[]>('/api/canvas/snapshots?all=true')).length === snapsBefore + 1);
  check('command bar shows the pins as chips', (await page.locator('.command-bar-chip-label').allInnerTexts()).join(',') === 'Release plan,Telemetry notes');
  await shot('03-session-attached');

  // 5. Agent intent → ghost on the board; write attributed to the session (cursor parks on it).
  const intent = await tool('canvas_intent', { action: 'signal', kind: 'create', label: 'Draft release notes', reason: 'summarizing the plan', position: { x: 520, y: 420 }, nodeType: 'markdown', ttlMs: 30000 });
  const intentId = String((intent.intent as { id?: string })?.id ?? intent.id ?? '');
  await page.locator(`[data-intent-id="${intentId}"]`).waitFor({ timeout: 5000 });
  check('explicit intent renders as a ghost with its label', (await page.locator(`[data-intent-id="${intentId}"]`).innerText()).includes('Draft release notes'));
  await shot('04-ghost-intent');
  const d = await tool('canvas_node', { action: 'add', type: 'markdown', title: 'Release notes (draft)', content: '## 0.4.9', x: 520, y: 420, width: 320, height: 180, intentId });
  const dId = String(d.id);
  await page.locator('.canvas-node').filter({ hasText: 'Release notes (draft)' }).waitFor();
  await sleep(600);
  check('agent cursor parks on the node it just created', (await page.locator('.agent-cursor').count()) === 1);
  const presence = await get<{ presences: Array<{ attached: boolean; focusNodeId: string | null }> }>('/api/canvas/ax/presence');
  check('MCP write is attributed to the attached session', presence.presences.find((p) => p.attached)?.focusNodeId === dId);

  // 6. Work items + gate: the human approves from the panel; a second gate auto-holds.
  const w1 = await tool('canvas_ax_work', { action: 'add', title: 'Draft release notes', status: 'in-progress', nodeIds: [dId] });
  const w2 = await tool('canvas_ax_work', { action: 'add', title: 'Summarize telemetry', status: 'done', nodeIds: [cId] });
  check('agent opens work items through canvas_ax_work', w1.__isError !== true && w2.__isError !== true);
  await page.locator('.session-item').filter({ hasText: 'Summarize telemetry' }).waitFor({ timeout: 5000 });
  check('work items show in the panel with their status', (await page.locator('.session-item').filter({ hasText: 'Summarize telemetry' }).innerText()).toLowerCase().includes('done'));
  await page.locator('.canvas-node').filter({ hasText: 'Release notes (draft)' }).locator('.node-ax-status').waitFor({ timeout: 5000 });
  check('work-item status mirrors onto the linked node chip', true);
  const gate = await tool('canvas_ax_gate', { kind: 'approval', action: 'request', title: 'Ship REL-421', detail: 'tags the build', nodeIds: [aId], ttlMs: 240000 });
  if (gate.__isError) console.log('gate error:', JSON.stringify(gate).slice(0, 300));
  const gateId = String((gate.approvalGate as { id?: string })?.id ?? '');
  await page.locator('.session-gate').filter({ hasText: 'Ship REL-421' }).waitFor();
  check('gate shows in the panel with a countdown and the badge in the top bar', (await page.locator('.gate-badge').innerText()).startsWith('1 gate'));
  check('chip reads waiting-approval while a gate is pending', (await page.locator('.agent-chip').innerText()).includes('Waiting on you'));
  await shot('05-gate-pending');
  await page.locator('.session-gate').getByRole('button', { name: 'Approve' }).click();
  await sleep(500);
  const gateState = await get<{ approvalGate: { status: string } }>(`/api/canvas/ax/approval/${gateId}`);
  check('human approves from the panel → the gate the agent awaits is approved', gateState.approvalGate.status === 'approved');
  const fast = await tool('canvas_ax_gate', { kind: 'approval', action: 'request', title: 'Delete old notes', nodeIds: [cId], ttlMs: 1000 });
  const fastId = String((fast.approvalGate as { id?: string })?.id ?? '');
  await sleep(2600);
  const held = await get<{ approvalGate: { status: string } }>(`/api/canvas/ax/approval/${fastId}`);
  check('unanswered gate auto-holds after its TTL', held.approvalGate.status === 'held');
  check('held gate shows Reopen in the panel', (await page.locator('.session-gate-held, .session-held').count()) >= 0 && (await page.getByRole('button', { name: 'Reopen' }).count()) === 1);

  // 7. Steering from the command bar reaches the agent (claim via delivery).
  await page.getByLabel('Steer the agent').fill('Keep the release plan as the source of truth');
  await page.getByLabel('Steer the agent').press('Enter');
  await sleep(500);
  const claimed = await tool('canvas_ax_delivery', { action: 'claim', consumer: 'claude-code' });
  const claimedText = JSON.stringify(claimed);
  check('agent claims the human’s steering from the command bar', claimedText.includes('Keep the release plan'));

  // 8. Scope fence: human fences to a selection; agent write outside is 403 (MCP error), inside OK.
  await page.locator('.canvas-node').filter({ hasText: 'Release plan' }).click({ position: { x: 150, y: 120 }, modifiers: ['Shift'] });
  await page.locator('.session-panel').getByRole('button', { name: /Fence to selection/ }).click();
  await page.locator('.scope-fence').waitFor();
  const outside = await tool('canvas_node', { action: 'update', id: bId, title: 'Agent touched Pipeline' });
  const inside = await tool('canvas_node', { action: 'update', id: aId, title: 'Release plan (agent)' });
  check('fenced: agent write outside is refused, inside lands', outside.__isError === true && inside.__isError !== true, String(outside.text ?? outside.error ?? '').slice(0, 80));
  check('agent cannot clear the fence itself', (await tool('canvas_ax_state', { action: 'set-policy', tools: { excluded: ['shell'] } })).__isError !== true && (await (await fetch(`${base}/api/canvas/ax/policy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: null }) })).status) === 403);
  await shot('06-fenced');
  await page.locator('.session-panel').getByRole('button', { name: 'Clear' }).click();
  await page.locator('.scope-fence').waitFor({ state: 'detached' });
  await page.keyboard.press('Escape');

  // 9. Human undoes the agent's latest edit from the panel; agent hears steering.
  await tool('canvas_node', { action: 'update', id: cId, title: 'Telemetry notes (agent rewrite)' });
  await page.locator('.canvas-node').filter({ hasText: 'Telemetry notes (agent rewrite)' }).waitFor();
  const undoRow = page.locator('.session-timeline-row').filter({ hasText: 'Updated “Telemetry notes (agent rewrite)”' });
  await undoRow.getByTestId('timeline-undo').click();
  await page.locator('.canvas-node').filter({ hasText: 'Telemetry notes (agent rewrite)' }).waitFor({ state: 'detached' });
  const undoSteer = await tool('canvas_ax_delivery', { action: 'claim', consumer: 'claude-code' });
  check('panel undo reverts the agent edit and the agent receives steering', JSON.stringify(undoSteer).includes('Undid your edit'));
  await shot('07-undo');

  // 10. User wins: human grabs a node the agent is editing → 409 for the agent, yield in timeline.
  const editIntent = await tool('canvas_intent', { action: 'signal', kind: 'edit', nodeId: aId, label: 'Rewrite the plan', ttlMs: 30000 });
  const editId = String((editIntent.intent as { id?: string })?.id ?? '');
  await page.locator(`[data-intent-id="${editId}"]`).waitFor();
  const bar = await page.locator('.canvas-node').filter({ hasText: 'Release plan' }).locator('.node-titlebar').boundingBox();
  await page.mouse.move(bar!.x + bar!.width / 2, bar!.y + bar!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar!.x + bar!.width / 2 + 30, bar!.y + bar!.height / 2 + 16, { steps: 5 });
  await page.locator('[data-testid="yield-pill"]').waitFor();
  const lockedWrite = await tool('canvas_node', { action: 'update', id: aId, title: 'Agent retitle while held' });
  check('agent write to a node the human holds is refused (409) and the agent yielded', lockedWrite.__isError === true && (await page.locator('[data-testid="yield-pill"]').innerText()).includes('took over'), String(lockedWrite.text ?? lockedWrite.error ?? '').slice(0, 90));
  await shot('08-user-wins');
  await page.mouse.up();
  await sleep(400);
  check('after release the agent may write again', (await tool('canvas_node', { action: 'update', id: aId, title: 'Release plan' })).__isError !== true);

  // 11. Groups v2 from the human side: G groups the selection, collapse → chip.
  await page.locator('.canvas-node').filter({ hasText: 'Release plan' }).click({ position: { x: 150, y: 120 }, modifiers: ['Shift'] });
  await page.locator('.canvas-node').filter({ hasText: 'Telemetry notes' }).click({ position: { x: 150, y: 120 }, modifiers: ['Shift'] });
  await page.keyboard.press('g');
  const group = page.locator('.canvas-node.group-node').first();
  await group.locator('.group-count').filter({ hasText: '2' }).waitFor();
  check('G groups the selection into a frame with the edge header', true);
  const groups = await get<{ nodes: Array<{ type: string; data: { children?: string[] } }> }>('/api/canvas/state');
  check('agent sees the group membership in state', groups.nodes.some((n) => n.type === 'group' && n.data.children?.length === 2));
  await shot('09-group');
  await group.getByRole('button', { name: 'Collapse group' }).click();
  await page.locator('[data-testid="group-chip"]').waitFor();
  check('collapsed group is a chip and hides its children', (await page.locator('.canvas-node').filter({ hasText: 'Telemetry notes' }).count()) === 0);
  await page.locator('[data-testid="group-chip"]').getByRole('button', { name: /Expand group/ }).click();

  // 12. Edge creation with the Connect tool + label.
  await page.getByRole('button', { name: 'Connect (C)' }).click();
  page.once('dialog', (dialog) => void dialog.accept('informs'));
  const from = await page.locator('.canvas-node').filter({ hasText: 'Pipeline' }).boundingBox();
  const to = await page.locator('.canvas-node').filter({ hasText: 'Release notes (draft)' }).boundingBox();
  await page.mouse.move(from!.x + 150, from!.y + 100);
  await page.mouse.down();
  await page.mouse.move(to!.x + 150, to!.y + 100, { steps: 8 });
  await page.keyboard.press('l');
  await page.mouse.up();
  await sleep(500);
  const edges = await get<{ edges: Array<{ label?: string }> }>('/api/canvas/state');
  check('Connect tool creates a labelled edge the agent can read', edges.edges.some((e) => e.label === 'informs'));
  await page.keyboard.press('v');

  // 13. Palette + minimap + History drawer.
  await page.keyboard.press('Meta+k');
  await page.locator('.command-palette').waitFor();
  check('palette groups Actions then Jump to', (await page.locator('.command-palette-group').allInnerTexts()).map((t) => t.toLowerCase()).join(',') === 'actions,jump to');
  await page.keyboard.press('Escape');
  check('minimap renders true-scale rects for every node', (await page.locator('.minimap-node').count()) === (await get<{ nodes: unknown[] }>('/api/canvas/state')).nodes.length);

  // 14. Detach → receipt → History drawer with the session entry.
  await tool('canvas_ax_state', { action: 'set-presence', attached: false });
  await page.locator('[data-testid="session-receipt"]').waitFor({ timeout: 5000 });
  const tiles = await page.locator('.session-receipt-tile-value').allInnerTexts();
  check('receipt after detach shows items / done / vetoed', tiles.join('/') === '2/1/1', tiles.join('/'));
  await page.getByRole('button', { name: 'View diff' }).click();
  await page.locator('[data-testid="session-receipt-diff"]').waitFor();
  await shot('10-receipt');
  await page.getByRole('button', { name: 'Full log' }).click();
  await page.locator('[data-testid="history-drawer"]').waitFor();
  check('History drawer lists the session as an entry with a restore', (await page.locator('[data-testid="history-session"]').count()) >= 1);
  await shot('11-history');
  await page.keyboard.press('Escape');
  check('board is quiet again after detach', (await page.locator('.session-panel, .command-bar, .agent-cursor').count()) === 0);

  // 15. Second human tab sees mia's cursor.
  const sam = await ctx.newPage();
  await sam.goto(`${base}/workbench?name=sam`);
  await sam.locator('.canvas-node').first().waitFor();
  await page.bringToFront();
  const region = await page.locator('.canvas-region').boundingBox();
  await page.mouse.move(region!.x + 700, region!.y + 600);
  await page.mouse.move(region!.x + 720, region!.y + 620);
  await sam.locator('.human-cursor').filter({ hasText: 'mia' }).waitFor({ timeout: 5000 });
  check('a second tab sees the first human’s cursor with its name', true);
  await sam.screenshot({ path: `${S}/live/12-two-humans.png` });
  await sam.close();
} catch (error) {
  check('script', false, String(error instanceof Error ? error.message : error).slice(0, 300));
  await shot('99-failure');
}

await agent.close();
await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((f) => f.step).join('; '));
