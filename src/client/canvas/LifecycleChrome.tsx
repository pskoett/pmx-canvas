import { useEffect, useState } from 'preact/hooks';
import { knowledgeLifecycleEnabled } from '../state/workspace-settings';
import { activeBoardId, boardList, boardIncarnation } from '../state/boards-store';
import { nodes, edges } from '../state/canvas-store';
import { requestJson } from '../state/intent-bridge';
import {
  cardQualification,
  knowledgeUnavailable,
  lifecycleFilter,
  openLifecycle,
  refreshKnowledge,
  retirementUndo,
  lifecycleTarget,
} from '../state/knowledge-store';

export function KnowledgeSync() {
  const board = activeBoardId.value;
  const boards = boardList.value;
  const cards = nodes.value;
  const links = edges.value;
  const enabled = knowledgeLifecycleEnabled.value;
  useEffect(() => {
    const timer = setTimeout(() => void refreshKnowledge(), 100);
    return () => clearTimeout(timer);
  }, [board, boards, cards, links, enabled]);
  useEffect(() => {
    const timer = setInterval(() => void refreshKnowledge(), 60000);
    return () => clearInterval(timer);
  }, []);
  return null;
}

export function LifecycleFilters() {
  if (!knowledgeLifecycleEnabled.value) return null;
  const counts = [...nodes.value.keys()].map(cardQualification);
  return (
    <>
      <div class="lifecycle-filters" role="group" aria-label="Lifecycle filter">
        {(['All', 'To review', 'Retired'] as const).map((filter) => (
          <button
            type="button"
            key={filter}
            aria-pressed={lifecycleFilter.value === filter}
            onClick={() => {
              if (!knowledgeLifecycleEnabled.value) return;
              lifecycleFilter.value = filter;
            }}
          >
            {filter}
            {filter === 'All'
              ? ''
              : ` · ${counts.filter((status) => (filter === 'Retired' ? status?.retired : !status?.retired && (status?.due || status?.sources.length))).length}`}
          </button>
        ))}
        {knowledgeUnavailable.value && <span role="status">Qualification unavailable</span>}
      </div>
      <RetirementToast />
    </>
  );
}

function RetirementToast() {
  const target = retirementUndo.value;
  const [busy, setBusy] = useState(false);
  if (
    !knowledgeLifecycleEnabled.value ||
    !target ||
    target.boardId !== activeBoardId.value ||
    target.incarnation !== boardIncarnation ||
    lifecycleTarget.value ||
    !cardQualification(target.nodeId)?.retired
  )
    return null;
  return (
    <div class="retirement-toast" role="status">
      <span>Retired from active context. History kept.</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (busy || !knowledgeLifecycleEnabled.value) return;
          setBusy(true);
          const result = await requestJson<{ ok: boolean } | null>(
            'restore',
            `/api/canvas/node/${encodeURIComponent(target.nodeId)}/lifecycle/restore`,
            null,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ expectedBoardId: target.boardId, evidence: 'Human undid retirement.' }),
            },
          );
          if (result?.ok) {
            retirementUndo.value = null;
            await refreshKnowledge();
          }
          setBusy(false);
        }}
      >
        Undo retirement
      </button>
      <button
        type="button"
        aria-label="Dismiss retirement notice"
        onClick={() => {
          retirementUndo.value = null;
        }}
      >
        ×
      </button>
    </div>
  );
}

export function LifecycleFooter({ nodeId }: { nodeId: string }) {
  if (!knowledgeLifecycleEnabled.value) return null;
  const status = cardQualification(nodeId);
  if (!status || status.retired || (!status.due && status.sources.length === 0)) return null;
  const source = status.sources[0];
  return (
    <button
      type="button"
      class="node-lifecycle-warning"
      onClick={(event) => {
        event.stopPropagation();
        openLifecycle(nodeId);
      }}
    >
      <span>{status.due ? '⧗ review due' : '⧗ source needs review'}</span>
      <span>{status.due ? status.reasons[0] : `${source.title} · ${source.reasons[0]}`}</span>
    </button>
  );
}
