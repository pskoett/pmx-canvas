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

/** Framed crosshair — reset view 1:1 */
export function IconResetView(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <line x1="8" y1="4.5" x2="8" y2="6.5" />
      <line x1="8" y1="9.5" x2="8" y2="11.5" />
      <line x1="4.5" y1="8" x2="6.5" y2="8" />
      <line x1="9.5" y1="8" x2="11.5" y2="8" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
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

/** 2x2 grid with links — auto-arrange */
export function IconArrange(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <line x1="6.5" y1="4" x2="9.5" y2="4" />
      <line x1="6.5" y1="12" x2="9.5" y2="12" />
      <line x1="4" y1="6.5" x2="4" y2="9.5" />
      <line x1="12" y1="6.5" x2="12" y2="9.5" />
    </Icon>
  );
}

/** Frame with focused inner corner — minimap */
export function IconMinimap(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1" y="2" width="14" height="12" rx="1.5" />
      <rect x="8" y="7" width="6" height="6" rx="1" fill="currentColor" fill-opacity="0.2" />
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
      <rect x="1" y="4" width="14" height="10" rx="1.5" />
      <path d="M5.5 4 L6.5 2.5 H9.5 L10.5 4" />
      <circle cx="8" cy="9" r="2.3" />
    </Icon>
  );
}

/** Bullseye — trace toggle */
export function IconTrace(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="3" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" />
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

/** Half-lit circle — theme toggle (generic). */
export function IconTheme(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2 A 6 6 0 0 1 8 14 Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Framed pin — context pinning. */
export function IconPin(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2" y="5" width="12" height="9" rx="1.5" />
      <line x1="11" y1="1.5" x2="11" y2="5" />
      <circle cx="11" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Focus Field — PMX Canvas brand mark (concentric rounded squares → lit core). */
export function IconLogo({ size = 22, class: className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      class={className}
      aria-hidden="true"
    >
      <rect x="8" y="8" width="48" height="48" rx="7" fill="none" stroke="currentColor" stroke-width="2.2" opacity="0.35" />
      <rect x="16" y="16" width="32" height="32" rx="5" fill="none" stroke="currentColor" stroke-width="2.2" opacity="0.6" />
      <rect x="24" y="24" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2.2" />
      <rect x="29" y="29" width="6" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}

/* ── Node-type icons · Focus Field family ─────────────────── */

/** Framed document with lines — markdown */
export function IconNodeMarkdown(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="4" y1="6" x2="10" y2="6" />
      <line x1="4" y1="8.5" x2="8" y2="8.5" />
      <line x1="4" y1="11" x2="11" y2="11" />
    </Icon>
  );
}

/** Framed prompt with chevron and reply tail — prompt */
export function IconNodePrompt(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M4 13.5 L5.5 11.5 L8 11.5" />
      <polyline points="5 6 7 8 5 10" />
      <line x1="8" y1="10" x2="11" y2="10" />
    </Icon>
  );
}

/** Framed response with three dots and reply tail — response */
export function IconNodeResponse(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M12 13.5 L10.5 11.5 L8 11.5" />
      <circle cx="5" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11" cy="7" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Dog-eared document — file */
export function IconNodeFile(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M3 1.5h6l3.5 3.5v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z" />
      <polyline points="9 1.5 9 5 12.5 5" />
      <line x1="4.5" y1="8.5" x2="10.5" y2="8.5" />
      <line x1="4.5" y1="11" x2="9" y2="11" />
    </Icon>
  );
}

/** Framed landscape with sun — image */
export function IconNodeImage(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <circle cx="5.5" cy="6.5" r="1.2" />
      <path d="M1.8 12 L6 8.5 L9 11 L11.5 9 L14.2 12" />
    </Icon>
  );
}

/** Browser-chrome frame — webpage */
export function IconNodeWebpage(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" />
      <circle cx="3.3" cy="4" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="5" cy="4" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="6.7" cy="4" r="0.5" fill="currentColor" stroke="none" />
      <line x1="4" y1="8" x2="12" y2="8" />
      <line x1="4" y1="10" x2="10" y2="10" />
    </Icon>
  );
}

/** Card with a pushpin — context */
export function IconNodeContext(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2" y="4" width="12" height="10" rx="1.5" />
      <line x1="2" y1="6.5" x2="14" y2="6.5" />
      <path d="M11 1.5 L11 4" />
      <circle cx="11" cy="4" r="1.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Dashed frame with three child cards — group */
export function IconNodeGroup(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke-dasharray="2 1.5" />
      <rect x="4" y="4" width="3.5" height="3.5" rx="0.6" />
      <rect x="8.5" y="4" width="3.5" height="3.5" rx="0.6" />
      <rect x="6.25" y="8.5" width="3.5" height="3.5" rx="0.6" />
    </Icon>
  );
}

/** Framed list with leading dot — status */
export function IconNodeStatus(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <circle cx="4.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <line x1="6.5" y1="6.5" x2="12.5" y2="6.5" />
      <line x1="6.5" y1="8" x2="11" y2="8" />
      <line x1="6.5" y1="9.5" x2="12" y2="9.5" />
    </Icon>
  );
}

/** Framed spike chart with end dot — trace node */
export function IconNodeTrace(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M3.5 10.5 L6 6.5 L8.5 9.5 L12.5 5" />
      <circle cx="12.5" cy="5" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Ledger book with spine — ledger */
export function IconNodeLedger(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <line x1="4.5" y1="5.5" x2="11.5" y2="5.5" />
      <line x1="4.5" y1="8" x2="11.5" y2="8" />
      <line x1="4.5" y1="10.5" x2="8" y2="10.5" />
      <line x1="6.5" y1="2" x2="6.5" y2="14" opacity="0.45" />
    </Icon>
  );
}

/** Framed MCP wordmark — mcp-app */
export function IconNodeMcpApp(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
      <path d="M4 11 L4 6 L6 8.5 L8 6 L8 11" />
      <path d="M10 11 L10 6 L12.5 11 L12.5 6" />
    </Icon>
  );
}

/** Framed arrow-out — ext-app */
export function IconNodeExtApp(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <polyline points="10 5 13 5 13 8" />
      <line x1="13" y1="5" x2="8" y2="10" />
      <path d="M6 6 L3.5 6 L3.5 11.5 L10 11.5 L10 9" />
    </Icon>
  );
}

/** Framed braces — json-render */
export function IconNodeJsonRender(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M7 5.5 C 5.5 5.5 5.5 8 4 8 C 5.5 8 5.5 10.5 7 10.5" />
      <path d="M9 5.5 C 10.5 5.5 10.5 8 12 8 C 10.5 8 10.5 10.5 9 10.5" />
    </Icon>
  );
}

/** Framed nodes & edges — graph */
export function IconNodeGraph(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="5.2" y1="6" x2="8" y2="8" />
      <line x1="8" y1="8" x2="10.8" y2="6" />
      <line x1="8" y1="8" x2="8" y2="11" />
      <circle cx="5.2" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.8" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="11" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Map a node type → its Focus Field icon component. */
export function getNodeIcon(type: string): (p: IconProps) => JSX.Element {
  switch (type) {
    case 'markdown': return IconNodeMarkdown;
    case 'prompt': return IconNodePrompt;
    case 'response': return IconNodeResponse;
    case 'file': return IconNodeFile;
    case 'image': return IconNodeImage;
    case 'webpage': return IconNodeWebpage;
    case 'context': return IconNodeContext;
    case 'group': return IconNodeGroup;
    case 'status': return IconNodeStatus;
    case 'trace': return IconNodeTrace;
    case 'ledger': return IconNodeLedger;
    case 'mcp-app': return IconNodeMcpApp;
    case 'ext-app': return IconNodeExtApp;
    case 'json-render': return IconNodeJsonRender;
    case 'graph': return IconNodeGraph;
    default: return IconNodeMarkdown;
  }
}
