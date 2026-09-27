import { useEffect, useState } from 'preact/hooks';
import {
  boardList,
  createAndOpenBoard,
  deleteBoard,
  openBoard,
  renameBoard,
  type BoardSummary,
} from '../state/boards-store';
import { requestJson } from '../state/intent-bridge';
import { askText } from './TextPrompt';

function timeAgo(iso: string | null): string {
  if (!iso) return 'never opened';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function nodesLabel(count: number): string {
  return `${count} node${count !== 1 ? 's' : ''}`;
}

interface BackupInfo {
  folder: string;
  everyMs: number | null;
  lastAt: string | null;
}

function everyLabel(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Last backup and "Back up now" — the whole library, every board, in one file. */
function BackupLine() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void requestJson<BackupInfo | null>('backupStatus', '/api/canvas/backup', null).then(setInfo);
  }, []);
  if (!info) return null;

  const backUp = async () => {
    setBusy(true);
    const result = await requestJson<{ status?: BackupInfo } | null>('backupNow', '/api/canvas/backup', null, {
      method: 'POST',
    });
    if (result?.status) setInfo(result.status);
    setBusy(false);
  };

  return (
    <div class="home-view-backup" data-testid="home-backup">
      <span>
        {info.lastAt ? `Last backup ${timeAgo(info.lastAt)}` : 'Not backed up yet'}
        {info.everyMs ? ` · every ${everyLabel(info.everyMs)}` : ''}
      </span>
      <button type="button" class="home-board-action" disabled={busy} onClick={() => void backUp()}>
        {busy ? 'Backing up…' : 'Back up now'}
      </button>
    </div>
  );
}

export async function promptNewBoard(): Promise<void> {
  const name = await askText('New board', 'Board name', { confirm: 'Create' });
  if (name) await createAndOpenBoard(name);
}

/**
 * Home (plan 012): the view when no board is open — every board, most
 * recently opened first. Deleting asks in place, naming the board and what it
 * holds; browser confirm dialogs are no-ops in agent panes.
 */
export function HomeView() {
  const boards = boardList.value;
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const rename = async (board: BoardSummary) => {
    const name = await askText('Rename board', 'Board name', { initial: board.name, confirm: 'Rename' });
    if (name && name !== board.name) await renameBoard(board.id, name);
  };

  return (
    <div class="home-view" data-testid="home-view">
      <div class="home-view-inner">
        <div class="home-view-head">
          <h1 class="home-view-title">Boards</h1>
          <button type="button" class="home-view-new" onClick={() => void promptNewBoard()}>
            New board
          </button>
        </div>
        <BackupLine />
        {boards.length === 0 ? (
          <div class="home-view-empty">No boards yet. Create one, or let an agent start writing — it opens one.</div>
        ) : (
          <ul class="home-view-list" aria-label="Boards">
            {boards.map((board) =>
              confirmingDelete === board.id ? (
                <li key={board.id} class="home-board is-confirming" data-testid="home-board">
                  <div class="home-board-confirm-text">
                    Delete <strong>{board.name}</strong> and its {nodesLabel(board.nodeCount)} and snapshots? This can't
                    be undone.
                  </div>
                  <div class="home-board-actions">
                    <button type="button" class="home-board-action" onClick={() => setConfirmingDelete(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="home-board-action is-danger"
                      onClick={() => {
                        setConfirmingDelete(null);
                        void deleteBoard(board.id);
                      }}
                    >
                      Delete board
                    </button>
                  </div>
                </li>
              ) : (
                <li key={board.id} class="home-board" data-testid="home-board">
                  <button type="button" class="home-board-open" onClick={() => void openBoard(board.id)}>
                    <span class="home-board-name">{board.name}</span>
                    <span class="home-board-meta">
                      {nodesLabel(board.nodeCount)} · {timeAgo(board.lastOpenedAt)}
                    </span>
                  </button>
                  <div class="home-board-actions">
                    <button type="button" class="home-board-action" onClick={() => void rename(board)}>
                      Rename
                    </button>
                    <button type="button" class="home-board-action" onClick={() => setConfirmingDelete(board.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
