import { useRef } from 'preact/hooks';
import { IconNodeMarkdown, IconNodeWebpage, IconSteer } from '../icons';
import { viewport } from '../state/canvas-store';
import { createNodeInView } from './create-in-view';
import { startSession } from '../state/session-store';
import { modChord } from '../utils/platform';
import { canvasAreaCenter } from './canvas-area';
import { importFiles } from './import-files';
import { promptedCreate } from './ToolRail';
import { agentSessionsEnabled } from '../state/workspace-settings';

/**
 * Empty board (rail-chrome-v2 phase 7, design item 11): centered onboarding
 * with direct starter actions and a separate way to start with your agent.
 * Every action is real: Start a note creates the same blank note as M, Drop files
 * opens a picker onto the viewport's import path, Paste a link asks for a URL,
 * and the optional Start agent session attaches a browser-keyed session.
 * Agent guidance stays visible independently of the session beta.
 */
export function EmptyState({ onOpenPalette }: { onOpenPalette: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const newNote = () => {
    void createNodeInView({ type: 'markdown', title: 'New note', width: 520, height: 360 }).catch(() => {});
  };
  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const centre = canvasAreaCenter();
    const v = viewport.value;
    await importFiles(Array.from(files), (centre.x - v.x) / v.scale, (centre.y - v.y) / v.scale);
  };
  return (
    <div class="empty-state" data-testid="empty-state">
      <svg class="empty-state-mark" width="52" height="52" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <rect x="8" y="8" width="48" height="48" rx="7" />
        <rect x="20" y="20" width="24" height="24" rx="4" stroke-dasharray="4 4" />
      </svg>
      <div class="empty-state-title">What would you like to work on?</div>
      <div class="empty-state-grid">
        <button type="button" class="empty-state-action" onClick={() => fileInput.current?.click()}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            class="tone-warn"
            aria-hidden="true"
          >
            <path d="M8 10 V2 M8 2 L5 5 M8 2 L11 5" />
            <path d="M2 10 V13 H14 V10" />
          </svg>
          <span class="empty-state-action-label">
            Drop files here
            <span class="empty-state-action-description">Bring in the material you want to work with.</span>
          </span>
          <span class="empty-state-action-hint">or pick</span>
        </button>
        <button type="button" class="empty-state-action" onClick={() => promptedCreate('webpage')}>
          <IconNodeWebpage size={16} class="tone-ok" />
          <span class="empty-state-action-label">
            Paste a link
            <span class="empty-state-action-description">Add a source, reference, or inspiration.</span>
          </span>
          <kbd>{modChord('V')}</kbd>
        </button>
        <button type="button" class="empty-state-action" onClick={newNote}>
          <IconNodeMarkdown size={16} class="tone-accent" />
          <span class="empty-state-action-label">
            Start a note
            <span class="empty-state-action-description">
              Write down an idea, then ask your agent to help you develop it.
            </span>
          </span>
          <kbd>M</kbd>
        </button>
      </div>
      <div class="empty-state-agent">
        <div class="empty-state-agent-title">Or start with your agent</div>
        <div class="empty-state-sub">Give your agent a task and ask it to work on this board.</div>
        {agentSessionsEnabled.value && (
          <button type="button" class="empty-state-action is-agent" onClick={() => void startSession()}>
            <IconSteer size={16} class="tone-purple" />
            <span class="empty-state-action-label">Start agent session</span>
          </button>
        )}
      </div>
      <button type="button" class="empty-state-hint" onClick={onOpenPalette}>
        ? shortcuts · {modChord('K')} palette
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const input = e.currentTarget;
          void pickFiles(input.files).finally(() => {
            input.value = '';
          });
        }}
      />
    </div>
  );
}
