import { canvasState } from './canvas-state.js';

/** Board-owned runtime state, discarded with its owner rather than on navigation. */
export class BoardLocal<T> {
  private readonly values = new WeakMap<object, T>();

  constructor(
    private readonly create: () => T,
    private readonly dispose?: (value: T) => void,
  ) {}

  get current(): T {
    const owner = canvasState.boardIdentity;
    let value = this.values.get(owner);
    if (value === undefined) {
      value = this.create();
      this.values.set(owner, value);
      const created = value;
      canvasState.onBoardDispose(() => this.dispose?.(created));
    }
    return value;
  }
}
