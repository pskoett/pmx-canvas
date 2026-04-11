import type { JSX } from 'preact';

interface IconProps {
  size?: number;
  class?: string;
}

const defaults = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

function Icon({ size = 16, children, ...rest }: IconProps & { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...defaults} {...rest}>
      {children}
    </svg>
  );
}

/** Expand-arrows — fit all nodes */
export function IconFitAll(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <polyline points="1 5 1 1 5 1" />
      <polyline points="11 1 15 1 15 5" />
      <polyline points="15 11 15 15 11 15" />
      <polyline points="5 15 1 15 1 11" />
      <rect x="4" y="4" width="8" height="8" rx="1" />
    </Icon>
  );
}

/** Crosshair — reset view 1:1 */
export function IconResetView(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="5" />
      <line x1="8" y1="1" x2="8" y2="4" />
      <line x1="8" y1="12" x2="8" y2="15" />
      <line x1="1" y1="8" x2="4" y2="8" />
      <line x1="12" y1="8" x2="15" y2="8" />
    </Icon>
  );
}

/** Magnifier with + */
export function IconZoomIn(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" />
      <line x1="5" y1="7" x2="9" y2="7" />
      <line x1="7" y1="5" x2="7" y2="9" />
    </Icon>
  );
}

/** Magnifier with - */
export function IconZoomOut(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" />
      <line x1="5" y1="7" x2="9" y2="7" />
    </Icon>
  );
}

/** 2x2 grid — auto-arrange */
export function IconArrange(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </Icon>
  );
}

/** PiP rectangle — minimap */
export function IconMinimap(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1" y="2" width="14" height="12" rx="1.5" />
      <rect x="8" y="7" width="6" height="6" rx="1" />
    </Icon>
  );
}

/** Sun with rays */
export function IconSun(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="3" />
      <line x1="8" y1="1" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="15" />
      <line x1="1" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="15" y2="8" />
      <line x1="3.05" y1="3.05" x2="4.46" y2="4.46" />
      <line x1="11.54" y1="11.54" x2="12.95" y2="12.95" />
      <line x1="3.05" y1="12.95" x2="4.46" y2="11.54" />
      <line x1="11.54" y1="4.46" x2="12.95" y2="3.05" />
    </Icon>
  );
}

/** Crescent moon */
export function IconMoon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5Z" />
    </Icon>
  );
}

/** Camera — snapshots */
export function IconSnapshot(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M5.5 2.5L4.5 4H2.5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2L10.5 2.5h-5Z" />
      <circle cx="8" cy="8.5" r="2.5" />
    </Icon>
  );
}

/** Bullseye — trace toggle */
export function IconTrace(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="3" />
      <circle cx="8" cy="8" r="0.5" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** X in circle — clear trace */
export function IconClearTrace(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="6" />
      <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
      <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" />
    </Icon>
  );
}

/** Magnifying glass — search */
export function IconSearch(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" />
    </Icon>
  );
}

/** Keyboard — shortcuts */
export function IconShortcuts(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1" y="3" width="14" height="10" rx="1.5" />
      <line x1="4" y1="6" x2="5" y2="6" />
      <line x1="7.5" y1="6" x2="8.5" y2="6" />
      <line x1="11" y1="6" x2="12" y2="6" />
      <line x1="4" y1="10" x2="12" y2="10" />
    </Icon>
  );
}
