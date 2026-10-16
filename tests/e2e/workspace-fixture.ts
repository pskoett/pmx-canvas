import { test as base, expect, type APIRequestContext } from '@playwright/test';

export * from '@playwright/test';

/** Test setup uses the same authenticated human settings path as the UI. */
export async function setWorkspaceFeatures(
  request: APIRequestContext,
  features: { agentSessions?: boolean; knowledgeLifecycle?: boolean },
): Promise<void> {
  const html = await (await request.get('/workbench')).text();
  const encoded = html.match(/window\.__PMX_WORKBENCH_TOKEN = ("[^"]+")/)?.[1];
  if (!encoded) throw new Error('Missing workbench token');
  const response = await request.post('/api/canvas/settings', {
    headers: { 'x-pmx-workbench': '1', 'x-pmx-workbench-token': JSON.parse(encoded) as string },
    data: features,
  });
  expect(response.ok()).toBe(true);
}

export const test = base.extend<{ workspaceFeaturesReset: undefined }>({
  workspaceFeaturesReset: [
    async ({ request }, use) => {
      const defaults = { agentSessions: false, knowledgeLifecycle: false };
      await setWorkspaceFeatures(request, defaults);
      try {
        await use(undefined);
      } finally {
        await setWorkspaceFeatures(request, defaults);
      }
    },
    { auto: true },
  ],
});
