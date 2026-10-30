import { writeSync } from 'node:fs';

// Temporary, opt-in CI diagnostics. Activate only around the persistence suite;
// do not log SQL, paths, node content, or environment variables.
let active = false;
let sequence = 0;

export function setPersistenceTracing(enabled: boolean): void {
  active = enabled && process.env.PMX_PERSISTENCE_TRACE === '1';
}

export function beginPersistencePhase(phase: string): (outcome?: 'return' | 'throw') => void {
  if (!active) return () => {};
  const id = ++sequence;
  const started = performance.now();
  const emit = (event: string, outcome?: string) => {
    writeSync(
      2,
      `${JSON.stringify({
        diagnostic: 'persistence',
        id,
        phase,
        event,
        at: new Date().toISOString(),
        elapsedMs: performance.now() - started,
        outcome,
      })}\n`,
    );
  };
  emit('begin');
  return (outcome = 'return') => emit('end', outcome);
}

export function tracePersistencePhase<T>(phase: string, run: () => T): T {
  const end = beginPersistencePhase(phase);
  try {
    const result = run();
    end();
    return result;
  } catch (error) {
    end('throw');
    throw error;
  }
}

// Proxy preserves the method's receiver, arguments, return value and exceptions.
export function tracePersistenceMethod<T extends (...args: never[]) => unknown>(phase: string, method: T): T {
  return new Proxy(method, {
    apply(target, receiver, args) {
      return tracePersistencePhase(phase, () => Reflect.apply(target, receiver, args));
    },
  });
}
