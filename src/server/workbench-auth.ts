import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Per-process capability used only to distinguish workbench clicks from HTTP agents. */
export const workbenchToken = randomBytes(32).toString('base64url');

export function isWorkbenchToken(value: string | null): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(workbenchToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
