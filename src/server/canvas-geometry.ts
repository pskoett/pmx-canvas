import type { CanvasNodeState, CanvasNodeUpdate } from './canvas-state.js';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Flat fields take precedence over nested aliases; absent axes remain absent. */
export function resolveCreateGeometry(body: Record<string, unknown>) {
  const position = record(body.position);
  const size = record(body.size);
  return {
    x: finite(body.x) ?? finite(position.x),
    y: finite(body.y) ?? finite(position.y),
    width: finite(body.width) ?? finite(size.width),
    height: finite(body.height) ?? finite(size.height),
  };
}

/** Guards and PATCH execution must resolve aliases and single-axis moves identically. */
export function resolvePatchGeometry(body: Record<string, unknown>, existing: CanvasNodeState) {
  const { x, y, width, height } = resolveCreateGeometry(body);
  return {
    ...(x !== undefined || y !== undefined
      ? { position: { x: x ?? existing.position.x, y: y ?? existing.position.y } }
      : {}),
    ...(width !== undefined || height !== undefined
      ? { size: { width: width ?? existing.size.width, height: height ?? existing.size.height } }
      : {}),
  };
}

export function validateCanvasNodePatch(patch: { position?: unknown; size?: unknown }): string | null {
  if (patch.position !== undefined) {
    const position = record(patch.position);
    if (finite(position.x) === undefined || finite(position.y) === undefined) {
      return 'Position must contain finite x and y values.';
    }
  }
  if (patch.size !== undefined) {
    const size = record(patch.size);
    const width = finite(size.width);
    const height = finite(size.height);
    if (width === undefined || height === undefined) return 'Size must contain finite width and height values.';
    if (width <= 0 || height <= 0) return 'Size width and height must be greater than zero.';
  }
  return null;
}

/** Invalid patches cannot count as explicit child-position overrides. */
export function validCanvasNodeUpdates(input: unknown): CanvasNodeUpdate[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value: unknown): value is CanvasNodeUpdate => {
    const update = record(value);
    return (
      typeof update.id === 'string' &&
      (update.collapsed === undefined || typeof update.collapsed === 'boolean') &&
      validateCanvasNodePatch(update) === null
    );
  });
}
