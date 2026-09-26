import { afterAll, describe, expect, test } from 'bun:test';
import { checkWebpageHop, classifyAddress, fetchWebpageSnapshot } from '../../src/server/webpage-node.ts';

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/to-metadata') return Response.redirect('http://169.254.169.254/latest/meta-data/', 302);
    if (path === '/to-local') return Response.redirect('/page', 302);
    if (path === '/loop') return Response.redirect('/loop', 302);
    return new Response('<html><head><title>Local page</title></head><body>hi</body></html>', {
      headers: { 'content-type': 'text/html' },
    });
  },
});
const base = `http://127.0.0.1:${server.port}`;

afterAll(() => server.stop(true));

describe('classifyAddress', () => {
  test('separates link-local, private and public addresses', () => {
    expect(classifyAddress('169.254.169.254')).toBe('link-local');
    expect(classifyAddress('fe80::1')).toBe('link-local');
    expect(classifyAddress('::ffff:169.254.169.254')).toBe('link-local');
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '100.64.0.1',
      '::1',
      'fd00::1',
      '0.0.0.0',
    ]) {
      expect(classifyAddress(ip)).toBe('private');
    }
    for (const ip of ['93.184.216.34', '172.32.0.1', '2606:4700::1']) {
      expect(classifyAddress(ip)).toBe('public');
    }
  });
});

describe('checkWebpageHop', () => {
  test('refuses a public fetch redirected onto a private address', () => {
    expect(() => checkWebpageHop('public', 'private', 'http://10.0.0.1/')).toThrow('private address');
  });

  test('refuses link-local on any hop, including a local origin', () => {
    expect(() => checkWebpageHop('private', 'link-local', 'http://169.254.169.254/')).toThrow('link-local');
    expect(() => checkWebpageHop('public', 'link-local', 'http://169.254.169.254/')).toThrow('link-local');
  });

  test('allows public hops and local hops from a local origin', () => {
    expect(() => checkWebpageHop('public', 'public', 'https://example.com/')).not.toThrow();
    expect(() => checkWebpageHop('private', 'private', 'http://127.0.0.1/')).not.toThrow();
  });
});

describe('fetchWebpageSnapshot redirects', () => {
  test('a local dev server the caller points at still loads, through a local redirect', async () => {
    const snapshot = await fetchWebpageSnapshot(`${base}/to-local`);
    expect(snapshot.pageTitle).toBe('Local page');
    expect(snapshot.url).toBe(`${base}/page`);
  });

  test('a redirect to cloud metadata is refused before it is fetched', async () => {
    await expect(fetchWebpageSnapshot(`${base}/to-metadata`)).rejects.toThrow('link-local');
  });

  test('a link-local URL is refused outright', async () => {
    await expect(fetchWebpageSnapshot('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('link-local');
  });

  test('redirect loops stop', async () => {
    await expect(fetchWebpageSnapshot(`${base}/loop`)).rejects.toThrow('Too many redirects');
  });
});
