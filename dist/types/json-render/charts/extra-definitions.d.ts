/**
 * Definitions for the extra chart components in ./extra-components.tsx.
 *
 * Kept separate from ./definitions.ts so the original chart catalog stays
 * untouched and the merge in ./catalog.ts is the only contact surface.
 */
import { z } from 'zod';
export declare const extraChartComponentDefinitions: {
    readonly AreaChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            xKey: z.ZodString;
            yKey: z.ZodString;
            aggregate: z.ZodNullable<z.ZodEnum<{
                count: "count";
                sum: "sum";
                avg: "avg";
            }>>;
            color: z.ZodNullable<z.ZodString>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        readonly description: "Area chart for cumulative or trend data. Same shape as LineChart but draws a filled area under the line.";
        readonly example: {
            readonly title: "Daily signups";
            readonly data: readonly [{
                readonly day: "Mon";
                readonly value: 12;
            }, {
                readonly day: "Tue";
                readonly value: 24;
            }, {
                readonly day: "Wed";
                readonly value: 19;
            }, {
                readonly day: "Thu";
                readonly value: 31;
            }];
            readonly xKey: "day";
            readonly yKey: "value";
            readonly aggregate: null;
            readonly color: null;
            readonly height: null;
        };
    };
    readonly ScatterChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            xKey: z.ZodString;
            yKey: z.ZodString;
            zKey: z.ZodNullable<z.ZodString>;
            color: z.ZodNullable<z.ZodString>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        readonly description: "Scatter plot for correlation or distribution. Both axes are numeric; optional zKey scales point size.";
        readonly example: {
            readonly title: "Latency vs payload size";
            readonly data: readonly [{
                readonly size: 10;
                readonly latency: 25;
            }, {
                readonly size: 40;
                readonly latency: 80;
            }, {
                readonly size: 80;
                readonly latency: 110;
            }, {
                readonly size: 120;
                readonly latency: 180;
            }];
            readonly xKey: "size";
            readonly yKey: "latency";
            readonly zKey: null;
            readonly color: null;
            readonly height: null;
        };
    };
    readonly RadarChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            axisKey: z.ZodString;
            metrics: z.ZodArray<z.ZodString>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        readonly description: "Radar chart for comparing multiple metrics across categories. Each metric in `metrics` is plotted as its own polygon.";
        readonly example: {
            readonly title: "Skill comparison";
            readonly data: readonly [{
                readonly skill: "Speed";
                readonly alice: 80;
                readonly bob: 60;
            }, {
                readonly skill: "Accuracy";
                readonly alice: 70;
                readonly bob: 90;
            }, {
                readonly skill: "Stamina";
                readonly alice: 85;
                readonly bob: 75;
            }];
            readonly axisKey: "skill";
            readonly metrics: readonly ["alice", "bob"];
            readonly height: null;
        };
    };
    readonly StackedBarChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            xKey: z.ZodString;
            series: z.ZodArray<z.ZodString>;
            aggregate: z.ZodNullable<z.ZodEnum<{
                count: "count";
                sum: "sum";
                avg: "avg";
            }>>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        readonly description: "Stacked bar chart for compositional data. Each entry in `series` is plotted as its own bar segment per x value.";
        readonly example: {
            readonly title: "Revenue by region";
            readonly data: readonly [{
                readonly quarter: "Q1";
                readonly north: 30;
                readonly south: 18;
                readonly east: 22;
            }, {
                readonly quarter: "Q2";
                readonly north: 42;
                readonly south: 25;
                readonly east: 28;
            }, {
                readonly quarter: "Q3";
                readonly north: 38;
                readonly south: 30;
                readonly east: 26;
            }];
            readonly xKey: "quarter";
            readonly series: readonly ["north", "south", "east"];
            readonly aggregate: null;
            readonly height: null;
        };
    };
    readonly ComposedChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            xKey: z.ZodString;
            barKey: z.ZodString;
            lineKey: z.ZodString;
            barColor: z.ZodNullable<z.ZodString>;
            lineColor: z.ZodNullable<z.ZodString>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        readonly description: "Combined bar + line chart for paired metrics (e.g. counts + a derived rate) on the same axis.";
        readonly example: {
            readonly title: "Visits and conversion";
            readonly data: readonly [{
                readonly day: "Mon";
                readonly visits: 120;
                readonly conversion: 4.2;
            }, {
                readonly day: "Tue";
                readonly visits: 145;
                readonly conversion: 3.8;
            }, {
                readonly day: "Wed";
                readonly visits: 160;
                readonly conversion: 5.1;
            }];
            readonly xKey: "day";
            readonly barKey: "visits";
            readonly lineKey: "conversion";
            readonly barColor: null;
            readonly lineColor: null;
            readonly height: null;
        };
    };
};
