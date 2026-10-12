import { useEffect, useRef, useState } from 'preact/hooks';
import type { Lifecycle, LifecycleResults, ReviewRecord } from '../../server/knowledge-lifecycle.js';
import { activeBoardId, boardIncarnation, openMemoryTarget } from '../state/boards-store';
import { nodes } from '../state/canvas-store';
import { requestJson } from '../state/intent-bridge';
import {
  cardQualification,
  knowledgeUnavailable,
  lifecycleTarget,
  refreshKnowledge,
  retirementUndo,
} from '../state/knowledge-store';
import { sendSteering } from '../state/session-store';
import { useFocusTrap } from './use-focus-trap';
import { cleanLifecycle, DEFAULT_LIFECYCLE, LifecycleFields } from './LifecycleFields';

export function LifecyclePanel() {
  const target = lifecycleTarget.value;
  if (
    !target ||
    activeBoardId.value !== target.boardId ||
    boardIncarnation !== target.incarnation ||
    !nodes.value.has(target.nodeId)
  )
    return null;
  return <LifecycleDialog key={`${target.boardId}:${target.nodeId}:${target.incarnation}`} target={target} />;
}

function LifecycleDialog({ target }: { target: NonNullable<typeof lifecycleTarget.value> }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  const [detail, setDetail] = useState<LifecycleResults['get'] | null>(null);
  const [override, setOverride] = useState(false);
  const [policy, setPolicy] = useState<Lifecycle>(DEFAULT_LIFECYCLE);
  const [outcome, setOutcome] = useState<Exclude<ReviewRecord['outcome'], 'restore'>>('retain');
  const [evidence, setEvidence] = useState('');
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retiredHere, setRetiredHere] = useState(false);
  const node = nodes.value.get(target.nodeId);
  const current = cardQualification(target.nodeId) ?? detail?.qualification;
  const path = `/api/canvas/node/${encodeURIComponent(target.nodeId)}`;
  const sameBoard = () => activeBoardId.value === target.boardId && boardIncarnation === target.incarnation;
  const ownsDialog = () => sameBoard() && lifecycleTarget.value === target;
  const load = async () => {
    const result = await requestJson<LifecycleResults['get'] | null>(
      'lifecycle',
      `${path}/lifecycle?board=${encodeURIComponent(target.boardId)}`,
      null,
    );
    if (!ownsDialog()) return;
    if (!result) {
      setError('Could not load lifecycle. Retry before reviewing.');
      return;
    }
    setDetail(result);
    setError('');
    setOverride(result.lifecycleSource === 'card');
    setPolicy(result.lifecycle ?? DEFAULT_LIFECYCLE);
    // New preconditions must never be attached to evidence for an earlier observation.
    setEvidence('');
    setApplied(false);
  };
  useEffect(() => {
    void load();
  }, []);
  const mutate = async (suffix: string, body: Record<string, unknown>) => {
    if (!ownsDialog() || busy) return false;
    setBusy(true);
    setError('');
    const result = await requestJson<{ ok: boolean } | null>('lifecycleWrite', `${path}${suffix}`, null, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, expectedBoardId: target.boardId }),
    });
    if (!ownsDialog()) return false;
    if (!result?.ok) {
      setBusy(false);
      setError(
        'Not saved. The card or its sources may have changed. Reload and check the current evidence before retrying.',
      );
      return false;
    }
    await load();
    await refreshKnowledge();
    if (!ownsDialog()) return false;
    setBusy(false);
    return true;
  };
  const recordReview = async (reviewOutcome: typeof outcome, wasApplied: boolean) => {
    if (!detail) return false;
    const ok = await mutate('/review', {
      outcome: reviewOutcome,
      evidence,
      applied: wasApplied,
      expectedContentRevision: detail.contentRevision,
      expectedSources: detail.qualification.observations,
    });
    if (ok) {
      setRetiredHere(wasApplied && reviewOutcome === 'retire');
      if (wasApplied && reviewOutcome === 'retire') retirementUndo.value = target;
      setEvidence('');
      setApplied(false);
    }
    return ok;
  };
  const recipe = node?.data.provenance as { recipe?: { tool: string; input?: unknown; prompt: string } } | undefined;
  const date = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : 'Unknown');
  return (
    <div
      class="knowledge-backdrop"
      onKeyDown={(event) => {
        // This dialog owns its keys, including Space on the disclosure summary.
        event.stopPropagation();
        if (event.key === 'Escape') {
          lifecycleTarget.value = null;
        }
      }}
    >
      <div ref={ref} class="knowledge-dialog lifecycle-dialog" role="dialog" aria-modal="true" aria-label="Review card">
        <header>
          <h2>{String(node?.data.title ?? 'Card')} · Review</h2>
          <button
            type="button"
            aria-label="Close review"
            onClick={() => {
              lifecycleTarget.value = null;
            }}
          >
            ×
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {!detail && error && (
          <button type="button" disabled={busy} onClick={() => void load()}>
            Reload and recheck
          </button>
        )}
        {knowledgeUnavailable.value && (
          <p role="status">Live qualification unavailable. Last loaded evidence is shown.</p>
        )}
        {!detail ? (
          <p>Loading review…</p>
        ) : (
          <>
            {detail.retired ? (
              <div class="lifecycle-review">
                <p>This card is retired. Restoring it does not mark it checked.</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate('/lifecycle/restore', { evidence: 'Restored by the human reviewer.' })}
                >
                  Restore card
                </button>
              </div>
            ) : (
              <>
                {current?.due ? (
                  <p class="lifecycle-warning">
                    ⧗{' '}
                    {current.reasons.some((reason) => reason.startsWith('Content changed'))
                      ? 'This card changed since its last check.'
                      : 'This card needs a fresh check.'}
                  </p>
                ) : (
                  <p>Last checked: {date(detail.lastValidation?.when)}</p>
                )}
                {(current?.sources ?? detail.qualification.sources).map((source) => (
                  <div class="lifecycle-warning" key={`${source.boardId}:${source.cardId}`}>
                    ⧗ Source needs a check: {source.title}
                    {!source.unavailable && (
                      <button
                        type="button"
                        onClick={() => {
                          lifecycleTarget.value = null;
                          void openMemoryTarget(source);
                        }}
                      >
                        Open source →
                      </button>
                    )}
                  </div>
                ))}
                <form
                  class="lifecycle-quick-review"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void recordReview('retain', true).then((ok) => {
                      if (ok && ownsDialog()) lifecycleTarget.value = null;
                    });
                  }}
                >
                  <p>Check the card and its sources before confirming.</p>
                  <label>
                    What did you check?
                    <textarea
                      required
                      rows={2}
                      placeholder="A short note or source link"
                      value={evidence}
                      onInput={(event) => setEvidence(event.currentTarget.value)}
                    />
                  </label>
                  <div class="lifecycle-review-actions">
                    <button
                      type="submit"
                      disabled={busy || !evidence.trim() || node?.contentRevision !== detail.contentRevision}
                    >
                      Checked, still correct
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        lifecycleTarget.value = null;
                      }}
                    >
                      Not now
                    </button>
                  </div>
                </form>
              </>
            )}
            {(error || node?.contentRevision !== detail.contentRevision) && (
              <div role="status">
                <p>Reload, check the current card and sources, then write a fresh note.</p>
                <button type="button" disabled={busy} onClick={() => void load()}>
                  Reload and recheck
                </button>
              </div>
            )}
            <details class="lifecycle-advanced">
              <summary>Settings and history</summary>
              <button type="button" disabled={busy} onClick={() => void load()}>
                Reload lifecycle and source revisions
              </button>
              <p class="lifecycle-category">
                {detail.category
                  ? `${detail.category.glyph} ${detail.category.name} · from ${detail.categorySourceFolder}`
                  : 'No inherited category'}{' '}
                · category belongs to the folder
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate('/lifecycle', { lifecycleOverride: override ? cleanLifecycle(policy) : null });
                }}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(event) => setOverride(event.currentTarget.checked)}
                  />{' '}
                  Set a card lifecycle override
                </label>
                {override ? (
                  <LifecycleFields value={policy} onChange={setPolicy} />
                ) : (
                  <p>
                    Inherit from {detail.lifecycleSourceFolder ?? 'the folder'} · {detail.lifecycle?.rate ?? 'unknown'}
                  </p>
                )}
                <button type="submit" disabled={busy}>
                  Save lifecycle
                </button>
              </form>
              <div class="lifecycle-clocks">
                <div class="is-read">
                  <span>Read by agent</span>
                  <strong>{date(detail.qualification.lastReadAt)}</strong>
                  <small>Delivery only, not validation</small>
                </div>
                <div>
                  <span>Content changed</span>
                  <strong>{date(detail.qualification.contentChangedAt)}</strong>
                  <small>Revision {detail.contentRevision}</small>
                </div>
                <div>
                  <span>Last validated</span>
                  <strong>{date(detail.lastValidation?.when)}</strong>
                  <small>{detail.lastValidation?.evidence ?? 'No evidence-backed validation'}</small>
                </div>
                <div>
                  <span>Task relevance</span>
                  <strong>
                    {detail.qualification.relevance === 'card-pinned'
                      ? 'Card pinned'
                      : detail.qualification.relevance === 'board-pinned'
                        ? 'Board pinned'
                        : 'Not explicitly selected'}
                  </strong>
                  <small>Curation, not a truth claim</small>
                </div>
              </div>
              <p>Reading, refreshing and regeneration never count as validating.</p>
              {current?.due && <p class="lifecycle-warning">⧗ review due · {current.reasons.join(' ')}</p>}
              {(current?.sources ?? detail.qualification.sources).map((source) => (
                <div class="lifecycle-warning" key={`${source.boardId}:${source.cardId}`}>
                  ⧗ {source.title} · {source.reasons.join(' ')}
                  {source.observedAt && <span> · observed {date(source.observedAt)}</span>}
                  {source.observedRevision !== undefined && <span> · source revision {source.observedRevision}</span>}
                  {!source.unavailable && (
                    <button
                      type="button"
                      onClick={() => {
                        lifecycleTarget.value = null;
                        void openMemoryTarget(source);
                      }}
                    >
                      Open source →
                    </button>
                  )}
                </div>
              ))}
              {node?.contentRevision !== detail.contentRevision && (
                <p role="alert">Content changed while this review was open. Reload and check it before applying.</p>
              )}
              {detail.retired ? (
                <div class="lifecycle-review">
                  <p role="status">Retired from active context. Content and history remain.</p>
                  <label>
                    Restoration note
                    <input value={evidence} onInput={(event) => setEvidence(event.currentTarget.value)} />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate('/lifecycle/restore', {
                        evidence: evidence || 'Restored by the human reviewer.',
                      }).then((ok) => {
                        if (ok) setRetiredHere(false);
                      })
                    }
                  >
                    {retiredHere ? 'Undo retirement' : 'Restore to active context'}
                  </button>
                  <p>Restore is recorded and does not validate.</p>
                </div>
              ) : (
                <form
                  class="lifecycle-review"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void recordReview(outcome, applied);
                  }}
                >
                  <label>
                    Outcome
                    <select
                      value={outcome}
                      onChange={(event) => setOutcome(event.currentTarget.value as typeof outcome)}
                    >
                      <option value="retain">Retain</option>
                      <option value="revise">Revise</option>
                      <option value="externalize">Externalize</option>
                      <option value="retire">Retire from active context</option>
                      <option value="unresolved">Unresolved</option>
                    </select>
                  </label>
                  <label>
                    Evidence · a link or a note
                    <textarea
                      required={applied && ['retain', 'revise', 'externalize'].includes(outcome)}
                      value={evidence}
                      onInput={(event) => setEvidence(event.currentTarget.value)}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={applied}
                      onChange={(event) => setApplied(event.currentTarget.checked)}
                    />{' '}
                    I applied this outcome and checked the content and sources
                  </label>
                  <p>Revise and externalize record work already performed. They do not edit or execute anything.</p>
                  <button type="submit" disabled={busy}>
                    Record review
                  </button>
                </form>
              )}
              {recipe?.recipe && (
                <section>
                  <h3>Recipe</h3>
                  <p>
                    {recipe.recipe.tool} · {recipe.recipe.prompt}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (!sameBoard()) return;
                      setBusy(true);
                      const ok = await sendSteering(
                        `Refresh this board using the recorded recipe for ${target.boardId}/${target.nodeId}. Review the recipe before running it. Tool: ${recipe.recipe!.tool}\nInput: ${JSON.stringify(recipe.recipe!.input ?? null)}\nPrompt: ${recipe.recipe!.prompt}\nRegeneration is not validation. Preserve source observations and report evidence separately.`,
                      );
                      setBusy(false);
                      setError(
                        ok
                          ? 'Recipe request sent. No tool was executed by Canvas.'
                          : 'Could not send the request. No tool was executed.',
                      );
                    }}
                  >
                    Ask agent to refresh this board
                  </button>
                </section>
              )}
              <section>
                <h3>Review history</h3>
                {detail.records.length === 0 && <p>No reviews recorded.</p>}
                {[...detail.records].reverse().map((record) => (
                  <div class="lifecycle-history" key={record.id}>
                    <strong>
                      {record.outcome}
                      {!record.applied ? ' · not applied' : ''}
                    </strong>
                    <span>
                      {date(record.when)} · {record.who.actor} · {record.who.source}
                    </span>
                    <p>{record.evidence || 'No evidence'}</p>
                  </div>
                ))}
              </section>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
