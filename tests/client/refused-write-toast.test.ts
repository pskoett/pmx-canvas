import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resetAttentionBridge } from '../../src/client/state/attention-bridge.ts';
import { attentionToast } from '../../src/client/state/attention-store.ts';
import { requestBestEffort, requestJson, requestOk } from '../../src/client/state/intent-bridge.ts';

const realFetch = globalThis.fetch;
let reply: () => Response;

beforeEach(() => {
  resetAttentionBridge();
  globalThis.fetch = (async () => reply()) as unknown as typeof fetch;
});
afterEach(() => resetAttentionBridge());
afterAll(() => {
  globalThis.fetch = realFetch;
});

const refused = () =>
  new Response(JSON.stringify({ ok: false, error: 'Node is held by the human.' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });

describe('refused writes', () => {
  test('requestOk toasts the server reason', async () => {
    reply = refused;
    expect(await requestOk('write', '/api/x', { method: 'POST' })).toEqual({ ok: false });
    expect(attentionToast.value?.title).toBe('Change refused');
    expect(attentionToast.value?.detail).toBe('Node is held by the human.');
  });

  test('requestJson toasts and still returns the error body', async () => {
    reply = refused;
    const body = await requestJson<{ ok: boolean }>('write', '/api/x', { ok: true }, { method: 'PATCH' });
    expect(body.ok).toBe(false);
    expect(attentionToast.value?.detail).toBe('Node is held by the human.');
  });

  test('requestBestEffort falls back to the status when the body is not JSON', async () => {
    reply = () => new Response('nope', { status: 403 });
    await requestBestEffort('write', '/api/x', { method: 'DELETE' });
    expect(attentionToast.value?.detail).toBe('The server answered 403.');
  });

  test('failed reads and accepted writes stay quiet', async () => {
    reply = refused;
    await requestJson('read', '/api/x', null);
    reply = () => new Response('{"ok":true}', { status: 200 });
    await requestOk('write', '/api/x', { method: 'POST' });
    expect(attentionToast.value).toBeNull();
  });
});
