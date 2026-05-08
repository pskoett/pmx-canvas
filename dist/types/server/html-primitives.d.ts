export declare const HTML_PRIMITIVE_KINDS: readonly ["choice-grid", "plan-timeline", "review-sheet", "pr-writeup", "system-map", "code-walkthrough", "design-sheet", "component-gallery", "interaction-prototype", "flowchart", "deck", "illustration-set", "explainer", "status-report", "incident-report", "triage-board", "config-editor", "prompt-tuner"];
export type HtmlPrimitiveKind = typeof HTML_PRIMITIVE_KINDS[number];
export interface HtmlPrimitiveDescriptor {
    kind: HtmlPrimitiveKind;
    title: string;
    description: string;
    useWhen: string;
    defaultSize: {
        width: number;
        height: number;
    };
    dataShape: string;
    example: Record<string, unknown>;
}
export interface HtmlPrimitiveInput {
    kind: HtmlPrimitiveKind;
    title?: string;
    data?: Record<string, unknown>;
}
export interface HtmlPrimitiveBuildResult {
    kind: HtmlPrimitiveKind;
    title: string;
    html: string;
    summary: string;
    defaultSize: {
        width: number;
        height: number;
    };
    data: Record<string, unknown>;
}
export declare function isHtmlPrimitiveKind(value: string): value is HtmlPrimitiveKind;
export declare function getHtmlPrimitiveDescriptor(kind: HtmlPrimitiveKind): HtmlPrimitiveDescriptor;
export declare function listHtmlPrimitiveDescriptors(): HtmlPrimitiveDescriptor[];
export declare function buildHtmlPrimitive(input: HtmlPrimitiveInput): HtmlPrimitiveBuildResult;
