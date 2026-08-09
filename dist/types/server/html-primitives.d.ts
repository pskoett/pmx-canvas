import type { AxInteractionType } from './ax-interaction.js';
export declare const HTML_PRIMITIVE_KINDS: readonly ["choice-grid", "plan-timeline", "review-sheet", "pr-writeup", "system-map", "code-walkthrough", "design-sheet", "component-gallery", "interaction-prototype", "flowchart", "deck", "presentation", "illustration-set", "explainer", "status-report", "incident-report", "triage-board", "config-editor", "prompt-tuner", "ax-board", "ax-flow"];
export type HtmlPrimitiveKind = (typeof HTML_PRIMITIVE_KINDS)[number];
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
    /**
     * AX capabilities this kind REQUIRES to function. `html` is AX-opt-in, so a
     * primitive that emits interactions is inert without them — node creation
     * applies this to `data.axCapabilities` (an explicit caller value still wins,
     * and the server clamps both to the `html` type ceiling). Only set it on kinds
     * that actually emit; every other kind stays AX-free.
     */
    axCapabilities?: {
        enabled: true;
        allowed: AxInteractionType[];
    };
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
export interface HtmlPrimitiveSemanticMetadata {
    presentation?: true;
    slideCount?: number;
    slideTitles?: string[];
    speakerNotes?: string[];
    presentationTheme?: string | Record<string, string>;
}
export declare function isHtmlPrimitiveKind(value: string): value is HtmlPrimitiveKind;
export declare function getHtmlPrimitiveDescriptor(kind: HtmlPrimitiveKind): HtmlPrimitiveDescriptor;
export declare function listHtmlPrimitiveDescriptors(): HtmlPrimitiveDescriptor[];
export declare function getHtmlPrimitiveSemanticMetadata(data: Record<string, unknown>): HtmlPrimitiveSemanticMetadata;
export declare function buildHtmlPrimitive(input: HtmlPrimitiveInput): HtmlPrimitiveBuildResult;
