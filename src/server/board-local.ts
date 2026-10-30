import { canvasState } from './canvas-state.js';

/** Board-owned runtime state, discarded with its owner rather than on navigation. */
export function createBoardLocal<T>(create: () => T, dispose?: (value: T) => void) {
  // Hoisted for canvas-state's mutation-history dependency; access the owner only on read.
  const values = new WeakMap<object, T>();
  return {
    get current(): T {
      const owner = canvasState.boardIdentity;
      let value = values.get(owner);
      if (value === undefined) {
        value = create();
        values.set(owner, value);
        const created = value;
        canvasState.onBoardDispose(() => dispose?.(created));
      }
      return value;
    },
  };
}
