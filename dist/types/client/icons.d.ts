import type { JSX } from 'preact';
interface IconProps {
    size?: number;
    class?: string;
}
/** Expand-arrows — fit all nodes */
export declare function IconFitAll(p: IconProps): JSX.Element;
/** Framed crosshair — reset view 1:1 */
export declare function IconResetView(p: IconProps): JSX.Element;
/** Magnifier with + */
export declare function IconZoomIn(p: IconProps): JSX.Element;
/** Magnifier with - */
export declare function IconZoomOut(p: IconProps): JSX.Element;
/** 2x2 grid with links — auto-arrange */
export declare function IconArrange(p: IconProps): JSX.Element;
/** Frame with focused inner corner — minimap */
export declare function IconMinimap(p: IconProps): JSX.Element;
/** Sun with rays */
export declare function IconSun(p: IconProps): JSX.Element;
/** Crescent moon */
export declare function IconMoon(p: IconProps): JSX.Element;
/** Camera — snapshots */
export declare function IconSnapshot(p: IconProps): JSX.Element;
/** Bullseye — trace toggle */
export declare function IconTrace(p: IconProps): JSX.Element;
/** X in circle — clear trace */
export declare function IconClearTrace(p: IconProps): JSX.Element;
/** Magnifying glass — search */
export declare function IconSearch(p: IconProps): JSX.Element;
/** Keyboard — shortcuts */
export declare function IconShortcuts(p: IconProps): JSX.Element;
/** Half-lit circle — theme toggle (generic). */
export declare function IconTheme(p: IconProps): JSX.Element;
/** Framed pin — context pinning. */
export declare function IconPin(p: IconProps): JSX.Element;
/** Focus Field — PMX Canvas brand mark (concentric rounded squares → lit core). */
export declare function IconLogo({ size, class: className }: IconProps): JSX.Element;
/** Framed document with lines — markdown */
export declare function IconNodeMarkdown(p: IconProps): JSX.Element;
/** Framed prompt with chevron and reply tail — prompt */
export declare function IconNodePrompt(p: IconProps): JSX.Element;
/** Framed response with three dots and reply tail — response */
export declare function IconNodeResponse(p: IconProps): JSX.Element;
/** Dog-eared document — file */
export declare function IconNodeFile(p: IconProps): JSX.Element;
/** Framed landscape with sun — image */
export declare function IconNodeImage(p: IconProps): JSX.Element;
/** Browser-chrome frame — webpage */
export declare function IconNodeWebpage(p: IconProps): JSX.Element;
/** Card with a pushpin — context */
export declare function IconNodeContext(p: IconProps): JSX.Element;
/** Dashed frame with three child cards — group */
export declare function IconNodeGroup(p: IconProps): JSX.Element;
/** Framed list with leading dot — status */
export declare function IconNodeStatus(p: IconProps): JSX.Element;
/** Framed spike chart with end dot — trace node */
export declare function IconNodeTrace(p: IconProps): JSX.Element;
/** Ledger book with spine — ledger */
export declare function IconNodeLedger(p: IconProps): JSX.Element;
/** Framed MCP wordmark — mcp-app */
export declare function IconNodeMcpApp(p: IconProps): JSX.Element;
/** Framed arrow-out — ext-app */
export declare function IconNodeExtApp(p: IconProps): JSX.Element;
/** Framed braces — json-render */
export declare function IconNodeJsonRender(p: IconProps): JSX.Element;
/** Framed nodes & edges — graph */
export declare function IconNodeGraph(p: IconProps): JSX.Element;
/** Map a node type → its Focus Field icon component. */
export declare function getNodeIcon(type: string): (p: IconProps) => JSX.Element;
export {};
