import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Amp orbs assign the portal port via the standard $PORT env (0.4.4 orb field
// report: the service bound 4313 while the portal exposed another port). The
// launcher honors PORT only under AMP_ORB so a stray PORT in normal shells
// never shifts the default. `serve status --json` reports the resolved port in
// its url without needing a live daemon — the cheapest true-chain probe.

const CLI = join(process.cwd(), 'src/cli/index.ts');

function resolvedStatusUrl(env: Record<string, string>): string {
  // Start from a copy with the port-affecting vars REMOVED (an empty string
  // would still be non-nullish and poison the ?? chain), then apply the combo.
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of ['PMX_WEB_CANVAS_PORT', 'PMX_CANVAS_PORT', 'AMP_ORB', 'PORT']) {
    delete base[key];
  }
  const result = spawnSync('bun', ['run', CLI, 'serve', 'status', '--json'], {
    encoding: 'utf-8',
    env: { ...base, ...env },
  });
  const parsed = JSON.parse(result.stdout) as { url?: string };
  if (!parsed.url) throw new Error(`serve status returned no url: ${result.stdout.slice(0, 200)}`);
  return parsed.url;
}

describe('server port resolution (Amp orb $PORT)', () => {
  test('an Amp orb service binds the portal-assigned $PORT', () => {
    expect(resolvedStatusUrl({ AMP_ORB: '1', PORT: '4599' })).toContain(':4599/');
  });

  test('a stray PORT without AMP_ORB never shifts the default', () => {
    expect(resolvedStatusUrl({ PORT: '4599' })).toContain(':4313/');
  });

  test('explicit PMX port vars beat the orb PORT', () => {
    expect(resolvedStatusUrl({ AMP_ORB: '1', PORT: '4599', PMX_WEB_CANVAS_PORT: '4601' })).toContain(':4601/');
  });

  test('an empty PORT under AMP_ORB falls through to the default', () => {
    expect(resolvedStatusUrl({ AMP_ORB: '1' })).toContain(':4313/');
  });
});
