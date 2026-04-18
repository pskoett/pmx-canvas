/**
 * Chart HTML template generator — produces self-contained ext-app HTML
 * documents that render interactive Chart.js charts inside the canvas
 * ExtAppFrame iframe.
 *
 * The generated HTML:
 * 1. Renders immediately from inline data (no bridge needed)
 * 2. Connects to host AppBridge via the ext-app App SDK (CDN)
 * 3. Accepts updated data via toolInput for re-rendering
 */
export interface ChartDataset {
    label: string;
    values: number[];
    color?: string;
}
export interface ChartConfig {
    title: string;
    chartType: 'bar' | 'line' | 'pie' | 'scatter' | 'doughnut' | 'radar';
    labels: string[];
    datasets: ChartDataset[];
    xAxisLabel?: string;
    yAxisLabel?: string;
    stacked?: boolean;
}
/**
 * Generate a self-contained HTML document that renders a Chart.js chart
 * and optionally connects to the host via the ext-app App SDK.
 */
export declare function generateChartHtml(config: ChartConfig): string;
