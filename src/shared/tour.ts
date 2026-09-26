import { z } from 'zod';

export const cameraSchema = z.object({ x: z.number(), y: z.number(), scale: z.number().positive() });
export const tourStopSchema = z.object({
  target: z.union([z.strictObject({ nodeId: z.string().min(1) }), z.strictObject({ viewport: cameraSchema })]),
  duration: z.number().nonnegative().max(3600).optional(),
  easing: z.enum(['linear', 'ease-in-out', 'ease-out']).optional(),
  padding: z.number().nonnegative().optional(),
  pullback: z.number().min(0).max(4).optional(),
});
export const tourSchema = z.object({ stops: z.array(tourStopSchema).max(1000) });
export type Tour = z.infer<typeof tourSchema>;
export type TourStop = z.infer<typeof tourStopSchema>;
export type Camera = z.infer<typeof cameraSchema>;
export interface TourNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export function derivedTour(nodes: TourNode[]): Tour {
  return {
    stops: nodes
      .filter((n) => n.type === 'group')
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id))
      .map((n) => ({ target: { nodeId: n.id } })),
  };
}

export function resolveStop(stop: TourStop, nodes: TourNode[], width: number, height: number): Camera {
  if ('viewport' in stop.target) return stop.target.viewport;
  const id = stop.target.nodeId;
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Tour target not found: ${id}`);
  const padding = stop.padding ?? 40;
  if (padding * 2 >= Math.min(width, height)) throw new Error('Tour padding exceeds viewport');
  const scale = Math.min((width - padding * 2) / node.size.width, (height - padding * 2) / node.size.height);
  return {
    x: width / 2 - (node.position.x + node.size.width / 2) * scale,
    y: height / 2 - (node.position.y + node.size.height / 2) * scale,
    scale,
  };
}

/** Interpolate world-space centres and log zoom; translations remain screen-space. */
export function interpolateCamera(
  from: Camera,
  to: Camera,
  progress: number,
  width: number,
  height: number,
  easing: TourStop['easing'] = 'ease-in-out',
  pullback = 0,
): Camera {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0) return { ...from };
  if (t === 1) return { ...to };
  const e = easing === 'linear' ? t : easing === 'ease-out' ? 1 - (1 - t) ** 3 : t * t * (3 - 2 * t);
  const scale = Math.exp(Math.log(from.scale) * (1 - e) + Math.log(to.scale) * e - pullback * Math.sin(Math.PI * e));
  const cx = ((width / 2 - from.x) / from.scale) * (1 - e) + ((width / 2 - to.x) / to.scale) * e;
  const cy = ((height / 2 - from.y) / from.scale) * (1 - e) + ((height / 2 - to.y) / to.scale) * e;
  return { x: width / 2 - cx * scale, y: height / 2 - cy * scale, scale };
}

/** Each segment includes its endpoint; zero-duration stops take one frame. */
export function segmentFrameCount(duration: number, fps: number): number {
  return Math.max(1, Math.ceil(duration * fps));
}

export function* tourFrames(
  tour: Tour,
  initial: Camera,
  nodes: TourNode[],
  width: number,
  height: number,
  fps: number,
) {
  let from = initial;
  for (const stop of tour.stops) {
    const to = resolveStop(stop, nodes, width, height);
    const count = segmentFrameCount(stop.duration ?? 1, fps);
    for (let i = 1; i <= count; i++)
      yield interpolateCamera(from, to, i / count, width, height, stop.easing, stop.pullback);
    from = to;
  }
}
