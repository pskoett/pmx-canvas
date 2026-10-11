import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Per-process capability used only to distinguish workbench clicks from HTTP agents. */
export const workbenchToken = randomBytes(32).toString('base64url');

export function isWorkbenchToken(value: string | null): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(workbenchToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Refuse an old tab's writes after a daemon restart, without downgrading its actor. */
export function refuseStaleWorkbenchWrite(req: Request): Response | null {
  const token = req.headers.get('x-pmx-workbench-token');
  if (req.method === 'GET' || req.headers.get('x-pmx-workbench') !== '1' || token === null || isWorkbenchToken(token))
    return null;
  return Response.json(
    { ok: false, error: 'Workbench connection changed. Reconnect before saving.' },
    { status: 409, headers: { 'Cache-Control': 'no-store' } },
  );
}
