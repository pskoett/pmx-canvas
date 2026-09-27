/** The Home category migrated 0.6 snapshots land on, so they do not bury the boards in use. */
export const MIGRATED_SNAPSHOT_CATEGORY = 'From old snapshots';

/** Slash-separated folder paths shared by the UI, HTTP/MCP and SDK. */
export function normalizeBoardCategory(value: string | null): string | null {
  if (!value?.trim()) return null;
  const parts = value.split('/').map((part) => part.trim());
  if (parts.length > 8) throw new Error('Folders can be nested up to 8 levels.');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.length > 60)) {
    throw new Error('Each folder name must be 1–60 characters, and cannot be "." or "..".');
  }
  return parts.join('/');
}

/** Includes implicit parents, so a board in A/B can also be moved into A. */
export function categoryAncestors(path: string): string[] {
  return path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'));
}
