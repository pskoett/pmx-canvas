import { useEffect, useState } from 'preact/hooks';
import type { DocumentImport } from '../../server/document-import';
import type { CanvasNodeState } from '../types';
import { activeBoardId } from '../state/boards-store';
import { requestJson } from '../state/intent-bridge';
import { expandNode, collapseExpandedNode } from '../state/canvas-store';

/** Originals stay useful even when the connected host cannot extract them. */
export function AttachmentNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const attachmentId = String(node.data.attachmentId);
  const boardId = activeBoardId.value;
  const [job, setJob] = useState<DocumentImport | null>(null);
  const [review, setReview] = useState(expanded);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    const read = async () => {
      const result = await requestJson<{ imports?: DocumentImport[] } | null>(
        'readImports',
        `/api/canvas/imports?boardId=${encodeURIComponent(boardId ?? '')}`,
        null,
      );
      if (current) setJob(result?.imports?.find((entry) => entry.attachmentId === attachmentId) ?? null);
    };
    void read();
    const timer = window.setInterval(() => void read(), 2000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [attachmentId, boardId]);
  useEffect(() => {
    if (!review) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setReview(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [review]);
  const act = async (action: 'request' | 'cancel' | 'commit') => {
    if (!job) return;
    setBusy(true);
    const result = await requestJson<{ import?: DocumentImport } | null>(
      `import.${action}`,
      `/api/canvas/imports/${job.id}/${action}`,
      null,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) },
    );
    setBusy(false);
    if (result?.import) {
      setJob(result.import);
      setReview(false);
      if (expanded && action === 'commit') collapseExpandedNode();
    }
  };
  const canRequest = job && ['attached', 'cancelled', 'unavailable'].includes(job.status);
  return (
    <div class="attachment-node" onPointerDown={(event) => event.stopPropagation()}>
      <div class="attachment-status">
        {job?.status === 'requested'
          ? 'Waiting for agent'
          : job?.status === 'drafted'
            ? 'Ready for review'
            : job?.status === 'committed'
              ? 'Markdown added'
              : 'Original attached'}
      </div>
      <a href={`/api/canvas/attachments/${attachmentId}/bytes`} target="_blank" rel="noopener noreferrer">
        Download original · {Math.ceil(Number(node.data.size ?? 0) / 1024)} KB
      </a>
      {job?.reason && <p>{job.reason}</p>}
      {canRequest && (
        <>
          <p id={`import-consent-${node.id}`}>
            Asking the agent to import allows it to process this file with its tools and model provider.
          </p>
          <button
            type="button"
            class="attachment-button is-primary"
            aria-describedby={`import-consent-${node.id}`}
            disabled={busy}
            onClick={() => void act('request')}
          >
            Ask agent to import
          </button>
        </>
      )}
      {job?.status === 'requested' && (
        <p>
          No automatic extraction. Ask your connected agent to check its pending steering or use canvas_import list.
        </p>
      )}
      {job?.status === 'drafted' && !review && (
        <button
          type="button"
          class="attachment-button is-primary"
          onClick={() => (expanded ? setReview(true) : expandNode(node.id))}
        >
          Review Markdown · {job.sections.length} {job.sections.length === 1 ? 'card' : 'cards'}
        </button>
      )}
      {job && ['requested', 'drafted'].includes(job.status) && (
        <button type="button" class="attachment-button" disabled={busy} onClick={() => void act('cancel')}>
          Cancel import
        </button>
      )}
      {review && job?.status === 'drafted' && (
        <div class="attachment-review" role="dialog" aria-label="Review imported Markdown">
          <h3>Review imported Markdown</h3>
          <p>Source material, not instructions or verified knowledge. {job.agentDescription}</p>
          {job.warnings.length > 0 && (
            <ul>
              {job.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {job.sections.map((section, index) => (
            <section key={index}>
              <h4>{section.title}</h4>
              <p>{section.reference || 'Source location not supplied'}</p>
              <pre>{section.markdown}</pre>
            </section>
          ))}
          <div class="attachment-review-actions">
            <button type="button" class="attachment-button" onClick={() => setReview(false)}>
              Close review
            </button>
            <button
              type="button"
              class="attachment-button is-primary"
              disabled={busy || boardId !== job.boardId}
              onClick={() => void act('commit')}
            >
              Add to board
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
