import type { JSX, RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { HTML_SURFACE_PUSH_SOURCE } from '../../shared/ax-surface-protocol.js';

export const VIEWER_LOAD_DEADLINE_MS = 10_000;
export type ViewerSource = { src?: string; srcdoc?: string; error?: boolean; retry?: () => void };
type LoadDocument = (
  frame: HTMLIFrameElement,
  signal: AbortSignal,
) => Promise<boolean | 'cancelled' | undefined> | undefined;
type Entry = { key: string; source: ViewerSource; attempt: number; load?: LoadDocument };
type MountFrame = (frame: HTMLIFrameElement, fail: () => void) => () => void;

/** The document acknowledges mounting before its frame-gated paint signal. */
export function waitForViewerPaint(frame: HTMLIFrameElement, token: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', cancel);
      resolve(ready);
    };
    const cancel = () => finish(false);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.data?.source !== HTML_SURFACE_PUSH_SOURCE ||
        event.data?.token !== token
      )
        return;
      if (event.data.type === 'mounted') {
        clearTimeout(timer);
      }
      if (event.data.type === 'ready') finish(true);
    };
    const timer = setTimeout(cancel, VIEWER_LOAD_DEADLINE_MS);
    window.addEventListener('message', receive);
    signal.addEventListener('abort', cancel, { once: true });
    frame.contentWindow?.postMessage({ source: HTML_SURFACE_PUSH_SOURCE, type: 'check-ready', token }, '*');
  });
}

/** Bind protocol adapters before document scripts run, once per document. */
function ViewerDocument({
  mount,
  iframeRef,
  ...attributes
}: JSX.IntrinsicElements['iframe'] & {
  mount?: (frame: HTMLIFrameElement) => () => void;
  iframeRef?: RefObject<HTMLIFrameElement>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => mount?.(frame.current!), []);
  useLayoutEffect(() => {
    if (iframeRef) iframeRef.current = frame.current;
  }, [iframeRef]);
  return <iframe {...attributes} ref={frame} />;
}

/** Preserve the painted document until its replacement restores and paints. */
export function RefreshingViewerFrame({
  source,
  identity = '',
  iframeRef,
  onLoad = () => {},
  onMount,
  onOpen,
  onDocumentLoad,
  title,
  className = 'mcp-app-frame',
  sandbox = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
  allow = '',
  tabIndex,
  referrerPolicy,
}: {
  source: ViewerSource;
  identity?: string;
  iframeRef: RefObject<HTMLIFrameElement>;
  onLoad?: () => void;
  onMount?: MountFrame;
  onOpen?: () => void;
  onDocumentLoad?: LoadDocument;
  title: string;
  className?: string;
  sandbox?: string;
  allow?: string;
  tabIndex?: number;
  referrerPolicy?: JSX.IntrinsicElements['iframe']['referrerPolicy'];
}) {
  const documentSource = source.src ?? source.srcdoc ?? '';
  const sourceKey = documentSource ? `${identity}\0${documentSource}` : '';
  const [painted, setPainted] = useState<Entry>({ key: sourceKey, source, attempt: 0, load: onDocumentLoad });
  const [pending, setPending] = useState<Entry | null>(null);
  const [failure, setFailure] = useState<Entry | null>(null);
  const [ready, setReady] = useState(false);
  const promotion = useRef(0);
  const readiness = useRef(new Map<AbortController, Entry>());
  const currentEntries = useRef({ painted, pending });
  currentEntries.current = { painted, pending };
  const networkTimer = useRef<{ entry: Entry; timer: ReturnType<typeof setTimeout> }>();
  const loadedEntries = useRef(new WeakSet<Entry>());

  const fail = (entry: Entry) => {
    const current = currentEntries.current;
    if (entry === (current.pending ?? current.painted)) setFailure(entry);
  };

  useLayoutEffect(() => {
    promotion.current += 1;
    setFailure(null);
    if (!sourceKey || sourceKey === painted.key) {
      setPending(null);
      return;
    }
    if (!painted.key) {
      setPainted({ key: sourceKey, source, attempt: 0, load: onDocumentLoad });
      return;
    }
    setPending({ key: sourceKey, source, attempt: 0, load: onDocumentLoad });
  }, [sourceKey, painted.key]);

  useLayoutEffect(() => {
    // Retry retires an entry without changing its source key. Keep the retained
    // foreground's first-paint wait, but cancel every removed document's work.
    for (const [controller, entry] of readiness.current) {
      if (entry === painted || entry === pending) continue;
      controller.abort();
      readiness.current.delete(controller);
    }
  }, [painted, pending]);

  useLayoutEffect(() => {
    const entry = pending ?? painted;
    if (!entry.key || loadedEntries.current.has(entry)) return;
    const timer = setTimeout(() => fail(entry), VIEWER_LOAD_DEADLINE_MS);
    networkTimer.current = { entry, timer };
    return () => clearTimeout(timer);
  }, [pending, painted]);

  useEffect(
    () => () => {
      promotion.current += 1;
      for (const controller of readiness.current.keys()) controller.abort();
      readiness.current.clear();
    },
    [],
  );

  const frame = (entry: Entry, isPending: boolean) =>
    entry.key && (
      <ViewerDocument
        key={`${entry.key}:${entry.attempt}`}
        iframeRef={isPending ? undefined : iframeRef}
        mount={onMount ? (frame) => onMount(frame, () => fail(entry)) : undefined}
        src={entry.source.src}
        srcdoc={entry.source.srcdoc}
        class={className}
        sandbox={sandbox}
        allow={allow}
        tabIndex={tabIndex}
        referrerPolicy={referrerPolicy}
        inert={isPending}
        aria-hidden={isPending ? true : undefined}
        onError={() => fail(entry)}
        onLoad={async (event) => {
          loadedEntries.current.add(entry);
          if (networkTimer.current?.entry === entry) clearTimeout(networkTimer.current.timer);
          const token = isPending ? ++promotion.current : promotion.current;
          const loadedFrame = event.currentTarget;
          const controller = new AbortController();
          readiness.current.set(controller, entry);
          const result = entry.load?.(loadedFrame, controller.signal);
          const loaded = result ? await result : undefined;
          readiness.current.delete(controller);
          const current = currentEntries.current;
          if (
            (isPending && promotion.current !== token) ||
            (entry !== current.painted && entry !== current.pending) ||
            loaded === 'cancelled' ||
            controller.signal.aborted
          )
            return;
          if (loaded === false) {
            fail(entry);
            return;
          }
          setFailure((failed) => (failed === entry ? null : failed));
          if (!isPending) {
            setReady(true);
            onLoad();
            return;
          }
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (promotion.current !== token) return;
              iframeRef.current = loadedFrame;
              setPainted(entry);
              setPending(null);
              setReady(true);
              onLoad();
            }),
          );
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 0,
          visibility: 'visible',
          zIndex: isPending ? 0 : 1,
          background: 'var(--c-panel)',
        }}
        title={title}
      />
    );

  return (
    <div class="mcp-app-frame-stack">
      {frame(painted, false)}
      {pending && frame(pending, true)}
      {!ready && !failure && !source.error && (
        <div class="viewer-fallback" role="status">
          Loading viewer…
        </div>
      )}
      {(failure || source.error) && (
        <div class={`viewer-fallback${ready ? ' viewer-fallback-retained' : ''}`} role="status">
          <span>Viewer could not load.{ready ? ' Keeping the last view.' : ''}</span>
          <button
            type="button"
            onClick={() => {
              if (source.error) {
                source.retry?.();
                return;
              }
              if (!failure) return;
              const retry = { ...failure, attempt: failure.attempt + 1 };
              setFailure(null);
              if (pending) setPending(retry);
              else setPainted(retry);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {onOpen && !failure && !source.error && (
        <button
          type="button"
          class="ext-app-preview-catcher"
          aria-label="Open full view to edit"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        />
      )}
    </div>
  );
}
