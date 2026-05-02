export interface TraceDisplayModel {
    toolName: string;
    category: string;
    status: string;
    duration: string;
    resultSummary: string;
    error: string;
}
export declare function buildTraceDisplayModel(data: Record<string, unknown>): TraceDisplayModel;
