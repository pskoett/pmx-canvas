import type { CanvasAnnotation, CanvasAnnotationPoint } from '../types';

function pointsToPath(points: CanvasAnnotationPoint[]): string {
  const [first, ...rest] = points;
  if (!first) return '';
  return rest.reduce((path, point) => `${path} L ${point.x} ${point.y}`, `M ${first.x} ${first.y}`);
}

export function AnnotationLayer({ annotations }: { annotations: CanvasAnnotation[] }) {
  if (annotations.length === 0) return null;

  return (
    <svg class="annotation-layer" aria-hidden="true">
      {annotations.map((annotation) => (
        <path
          key={annotation.id}
          d={pointsToPath(annotation.points)}
          fill="none"
          stroke={annotation.color === 'currentColor' ? 'var(--c-annotation)' : annotation.color}
          stroke-width={annotation.width}
          stroke-linecap="round"
          stroke-linejoin="round"
          opacity="0.9"
        />
      ))}
    </svg>
  );
}
