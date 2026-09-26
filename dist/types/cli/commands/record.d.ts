export declare function parseRecordOptions(flags: Record<string, string | boolean>): {
    theme: "dark" | "light" | "high-contrast" | "midnight" | "sepia" | "arctic" | "ember" | "forest" | "volt" | undefined;
    present: boolean;
    tourFile: string | undefined;
    chromePath: string | undefined;
    width: number;
    height: number;
    fps: number;
    mode: "realtime" | "deterministic";
    output: string;
    duration?: number | undefined;
};
