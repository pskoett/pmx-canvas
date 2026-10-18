import { useEffect, useRef, useState } from 'preact/hooks';
import type { MemoryGraph } from '../../shared/memory-graph.js';
import { boardList, catalogEpoch, memoryGraphRevision } from '../state/boards-store';
import { requestJson } from '../state/intent-bridge';

/** Coalesce live discovery and reject responses from an older library revision. */
export function useMemoryGraph(projection: 'full' | 'boards') {
  const boards = boardList.value;
  const liveRevision = memoryGraphRevision.value;
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refresh = useRef(() => {});
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let dirty = false;
    let timer: number | undefined;
    const schedule = () => {
      dirty = true;
      if (!running && timer === undefined) timer = window.setTimeout(load, 120);
    };
    const load = async () => {
      timer = undefined;
      dirty = false;
      running = true;
      setLoading(true);
      const epoch = catalogEpoch;
      const revision = memoryGraphRevision.peek();
      const catalog = boardList.peek();
      const result = await requestJson<MemoryGraph | null>(
        'memoryGraph',
        `/api/canvas/memory-graph?projection=${projection}`,
        null,
      );
      if (cancelled) return;
      running = false;
      if (epoch !== catalogEpoch || revision !== memoryGraphRevision.peek() || catalog !== boardList.peek()) {
        schedule();
        return;
      }
      if (result && Array.isArray(result.nodes) && Array.isArray(result.edges)) {
        setGraph(result);
        setError(false);
      } else setError(true);
      setLoading(false);
      if (dirty) schedule();
    };
    refresh.current = schedule;
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projection]);
  useEffect(() => refresh.current(), [liveRevision, boards]);
  return { graph, loading, error, retry: () => refresh.current() };
}
