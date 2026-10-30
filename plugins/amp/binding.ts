import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Binding {
  workspace: string;
  threadId: string;
  boardId: string;
  consumerId: string;
}

function path(root: string, threadId: string) {
  if (!/^T-[a-zA-Z0-9-]+$/.test(threadId)) throw new Error('Invalid Amp thread ID.');
  return join(root, '.pmx-canvas/amp-bindings', `${threadId}.json`);
}

export function readBinding(root: string, threadId: string): Binding | null {
  let text: string;
  try {
    text = readFileSync(path(root, threadId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(text) as Binding;
  if (
    value.workspace !== root ||
    value.threadId !== threadId ||
    typeof value.boardId !== 'string' ||
    value.consumerId !== `amp:${threadId}`
  )
    throw new Error('Invalid binding. Unbind this thread before binding again.');
  return value;
}

export function bind(root: string, threadId: string, boardId: string): Binding {
  const destination = path(root, threadId);
  const value: Binding = { workspace: root, threadId, boardId, consumerId: `amp:${threadId}` };
  mkdirSync(join(root, '.pmx-canvas/amp-bindings'), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  return value;
}

export function unbind(root: string, threadId: string) {
  rmSync(path(root, threadId), { force: true });
}

export async function boards(
  serverUrl: string,
): Promise<{ activeBoardId: string | null; boards: Array<{ id: string; name: string }> }> {
  const response = await fetch(`${serverUrl}/api/canvas/boards`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Board list failed: HTTP ${response.status}.`);
  const catalog = (await response.json()) as {
    activeBoardId: string | null;
    boards: Array<{ id: string; name: string }>;
  };
  return { activeBoardId: catalog.activeBoardId, boards: catalog.boards.map(({ id, name }) => ({ id, name })) };
}
