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
      {annotations.map((annotation) => {
        const color = annotation.color === 'currentColor' ? 'var(--c-annotation)' : annotation.color;
        if (annotation.type === 'text') {
          const point = annotation.points[0];
          if (!point || !annotation.text) return null;
          return (
            <text
              key={annotation.id}
              x={point.x}
              y={point.y}
              fill={color}
              font-size={annotation.width}
              font-family="var(--font)"
              font-weight="700"
              opacity="0.95"
            >
              {annotation.text}
            </text>
          );
        }
        return (
          <path
            key={annotation.id}
            d={pointsToPath(annotation.points)}
            fill="none"
            stroke={color}
            stroke-width={annotation.width}
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity="0.9"
          />
        );
      })}
    </svg>
  );
}
