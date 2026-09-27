import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { requestJson } from '../state/intent-bridge';
import { activeBoardId } from '../state/boards-store';

interface ExportManifest {
  boardId: string;
  boardName: string;
  cards: number;
  connections: number;
  frames: number;
  placeholders: Array<{ nodeId: string; title: string; reason: string }>;
  files: Array<{ nodeId: string; path: string; included: boolean }>;
  embeddedImages: number;
  remoteImages: string[];
  links: string[];
  frameNetworkDestinations: string[];
  embeddedCodeCanAccessNetwork: boolean;
}

interface ExportResult {
  path: string;
  url: string;
  bytes: number;
}

export const exportDialogOpen = signal(false);

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/**
 * Export the open board as one HTML file (plan 013). An export is a share, so
 * the dialog lists what goes into the file before it is written; file contents
 * stay out unless the owner ticks them in.
 */
export function ExportDialog() {
  const [includeFiles, setIncludeFiles] = useState(false);
  const [manifest, setManifest] = useState<ExportManifest | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const open = exportDialogOpen.value;
  const boardId = activeBoardId.value;

  useEffect(() => {
    if (!open || !boardId) return;
    let current = true;
    setResult(null);
    setManifest(null);
    void requestJson<{ manifest?: ExportManifest } | null>(
      'exportPreview',
      `/api/canvas/export/preview?board=${encodeURIComponent(boardId)}&includeFiles=${includeFiles}`,
      null,
    ).then((body) => {
      if (current) setManifest(body?.manifest ?? null);
    });
    return () => {
      current = false;
    };
  }, [open, includeFiles, boardId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      exportDialogOpen.value = false;
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open]);

  if (!open) return null;

  const write = async () => {
    if (!manifest || manifest.boardId !== activeBoardId.value) return;
    setBusy(true);
    const body = await requestJson<ExportResult | null>('exportBoard', '/api/canvas/export', null, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: manifest.boardId, includeFiles }),
    });
    setBusy(false);
    if (body?.path && activeBoardId.value === manifest.boardId) setResult(body);
  };

  return (
    <div class="text-prompt-backdrop" onPointerDown={() => (exportDialogOpen.value = false)}>
      <div
        class="text-prompt export-dialog"
        role="dialog"
        aria-label="Export board"
        data-testid="export-dialog"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div class="text-prompt-title">Export {manifest ? `“${manifest.boardName}”` : 'board'}</div>
        {!manifest ? (
          <div class="export-dialog-note">Reading the board…</div>
        ) : (
          <>
            <div class="export-dialog-note">
              One HTML file anyone can open without installing anything. It will contain:
            </div>
            <ul class="export-dialog-list">
              <li>
                {manifest.cards} card{manifest.cards !== 1 ? 's' : ''} and {manifest.connections} connection
                {manifest.connections !== 1 ? 's' : ''}
              </li>
              {manifest.frames > 0 && (
                <li>{manifest.frames} embedded pages, charts or diagrams, with the code that draws them</li>
              )}
              {manifest.embeddedImages > 0 && <li>{manifest.embeddedImages} local images</li>}
              {manifest.placeholders.length > 0 && (
                <li>
                  Shown as placeholders:{' '}
                  {manifest.placeholders.map((entry) => `${entry.title} (${entry.reason})`).join(', ')}
                </li>
              )}
              {manifest.remoteImages.length > 0 && (
                <li>Web images loaded when opened: {manifest.remoteImages.join(', ')}</li>
              )}
              {manifest.links.length > 0 && <li>Links included in cards: {manifest.links.join(', ')}</li>}
              {manifest.frameNetworkDestinations.length > 0 && (
                <li>
                  Network destinations referenced by embedded pages: {manifest.frameNetworkDestinations.join(', ')}
                </li>
              )}
              {manifest.embeddedCodeCanAccessNetwork && (
                <li>
                  Warning: embedded code can access the network. Scripts may contact destinations that cannot be listed
                  in advance.
                </li>
              )}
            </ul>
            {manifest.files.length > 0 && (
              <label class="export-dialog-files">
                <input
                  type="checkbox"
                  checked={includeFiles}
                  onChange={(e) => setIncludeFiles((e.target as HTMLInputElement).checked)}
                />
                <span>
                  Include the contents of {manifest.files.length} local file
                  {manifest.files.length !== 1 ? 's' : ''}: {manifest.files.map((file) => file.path).join(', ')}
                </span>
              </label>
            )}
          </>
        )}
        {result && (
          <div class="export-dialog-result" data-testid="export-result">
            <div>
              Saved ({sizeLabel(result.bytes)}): <code>{result.path}</code>
            </div>
            <div class="export-dialog-links">
              <a href={result.url} target="_blank" rel="noopener noreferrer">
                Open
              </a>
              <a href={`${result.url}?download=1`}>Download</a>
            </div>
          </div>
        )}
        <div class="text-prompt-actions">
          <button type="button" class="text-prompt-cancel" onClick={() => (exportDialogOpen.value = false)}>
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button type="button" class="text-prompt-confirm" disabled={!manifest || busy} onClick={() => void write()}>
              {busy ? 'Exporting…' : 'Export'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
