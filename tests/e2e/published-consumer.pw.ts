import { expect, test } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseUrl = process.env.PMX_CANVAS_URL ?? 'http://127.0.0.1:4513';
const repoRoot = join(import.meta.dirname, '..', '..');
const consumerPort = Number(new URL(baseUrl).port || '4513');

let consumerWorkdir: string | null = null;
let consumerServerPid: number | null = null;

function resolveBunBin(): string {
  if (process.env.BUN_BIN && existsSync(process.env.BUN_BIN)) return process.env.BUN_BIN;
  return execFileSync('bash', ['-lc', 'command -v bun'], { encoding: 'utf-8' }).trim();
}

function parseServerPid(output: string): number {
  const match = output.match(/PMX_SERVER_PID=(\d+)/);
  if (!match) throw new Error(`Published-consumer setup did not report PMX_SERVER_PID. Output:\n${output}`);
  return Number(match[1]);
}

function stopConsumerServer(): void {
  if (!consumerServerPid) return;
  try {
    process.kill(-consumerServerPid, 'SIGTERM');
  } catch {
    try {
      process.kill(consumerServerPid, 'SIGTERM');
    } catch {
      // Server may already be gone.
    }
  }
  consumerServerPid = null;
}

test.beforeAll(() => {
  if (process.env.PMX_CANVAS_URL) return;
  consumerWorkdir = mkdtempSync(join(tmpdir(), 'pmx-canvas-published-consumer-pw-'));
  const script = join(repoRoot, 'skills', 'published-consumer-e2e', 'scripts', 'run-published-consumer-e2e.sh');
  const result = spawnSync(
    'bash',
    [script, `--port=${consumerPort}`, `--workdir=${consumerWorkdir}`, '--skip-playwright', '--keep-running'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        BUN_BIN: resolveBunBin(),
      },
      encoding: 'utf-8',
      timeout: 180_000,
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`Published-consumer setup failed (${result.status}).\n${output}`);
  }
  consumerServerPid = parseServerPid(output);
});

test.afterAll(() => {
  stopConsumerServer();
  if (consumerWorkdir) {
    rmSync(consumerWorkdir, { recursive: true, force: true });
    consumerWorkdir = null;
  }
});

test('renders the published-consumer SDLC workspace', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.goto(`${baseUrl}/workbench`);

  const nodeTitle = (title: string) => page.locator('.canvas-node .node-title').filter({ hasText: title });
  await expect(nodeTitle('Synthetic SDLC Report')).toHaveCount(1);
  await expect(nodeTitle('Pipeline Atlas')).toHaveCount(1);
  await expect(nodeTitle('Artifact App')).toHaveCount(1);
  await expect(nodeTitle('Control Tower Widgets')).toHaveCount(1);
  await expect(nodeTitle('Release Gate Intake')).toHaveCount(1);
  await expect(nodeTitle('Service Readiness Matrix')).toHaveCount(1);
  await expect(nodeTitle('Lead Time Trend')).toHaveCount(1);
  await expect(nodeTitle('Defects by Stage')).toHaveCount(1);
  await expect(nodeTitle('Operational Load')).toHaveCount(1);

  await expect(page.getByTestId('context-chip')).toContainText('3 cards');
  await expect(page.getByText('npm pack', { exact: true })).toBeVisible();
  await expect(page.getByText('canvas.buildWebArtifact', { exact: true })).toBeVisible();
  await expect(page.getByText('playwright', { exact: true })).toBeVisible();

  // The seeded workspace is larger than the initial camera. Bring lazy viewers
  // into the actual canvas instead of relying on native scrolling beneath it.
  const fit = page.getByRole('button', { name: 'Fit canvas', exact: true });
  if (await fit.isVisible()) await fit.click();
  else {
    await page.getByRole('button', { name: 'More: export, present, zoom, fit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Fit all', exact: true }).click();
  }

  const artifactFrame = page.frameLocator(
    '.canvas-node:has(.node-title:text-is("SDLC Control Room Artifact")) iframe.mcp-app-frame',
  );
  await expect(artifactFrame.getByText('Delivery Control Room')).toBeVisible();

  const dashboardNode = page.locator('.canvas-node:has(.node-title:text-is("Control Tower Widgets"))');
  const dashboardIframe = dashboardNode.locator('iframe.mcp-app-frame');
  await expect(dashboardIframe).toHaveCount(1);
  const dashboardElement = await dashboardIframe.elementHandle();
  const viewer = await dashboardElement!.contentFrame();
  expect(viewer).not.toBeNull();
  const viewerUrl = new URL((await dashboardIframe.getAttribute('src'))!, baseUrl);
  expect(viewerUrl.origin).toBe(new URL(baseUrl).origin);
  expect(viewerUrl.pathname).toBe('/api/canvas/json-render/view');
  expect(viewerUrl.searchParams.get('nodeId')).toBe(await dashboardNode.getAttribute('data-node-id'));
  // This functional smoke has no startup SLA. Lazy document load supplies the
  // restore prerequisite; keep the usual five seconds for visible rendering.
  // Match the authored URL so an initial about:blank cannot satisfy readiness.
  await viewer!.waitForURL((url) => url.href === viewerUrl.href, { waitUntil: 'load' });
  const dashboardFrame = dashboardIframe.contentFrame();
  await expect(dashboardFrame.getByText('Control Tower Widgets')).toBeVisible();

  const intakeFrame = page.frameLocator(
    '.canvas-node:has(.node-title:text-is("Release Gate Intake")) iframe.mcp-app-frame',
  );
  await expect(intakeFrame.getByText('Release Gate Intake')).toBeVisible();

  const graphFrame = page.frameLocator('.canvas-node:has(.node-title:text-is("Lead Time Trend")) iframe.mcp-app-frame');
  await expect(graphFrame.getByText('Lead Time Trend')).toBeVisible();

  await expect
    .poll(async () => {
      const response = await request.get(`${baseUrl}/api/canvas/state`);
      const state = (await response.json()) as { nodes: Array<{ type: string }> };
      const typeSet = new Set(state.nodes.map((node) => node.type));
      return [
        state.nodes.length >= 18,
        [
          'markdown',
          'image',
          'file',
          'status',
          'context',
          'ledger',
          'trace',
          'mcp-app',
          'json-render',
          'graph',
          'group',
        ].every((type) => typeSet.has(type)),
      ].every(Boolean);
    })
    .toBe(true);

  const snapshotResponse = await request.get(`${baseUrl}/api/canvas/snapshots`);
  const snapshots = (await snapshotResponse.json()) as Array<{ name: string }>;
  expect(snapshots.some((snapshot) => snapshot.name === 'published-consumer-baseline')).toBe(true);
});
