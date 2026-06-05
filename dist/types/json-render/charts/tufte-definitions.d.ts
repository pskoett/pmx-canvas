/**
 * Definitions for the Tufte primitive chart components in ./tufte-components.tsx.
 *
 * Kept separate from ./definitions.ts and ./extra-definitions.ts so the
 * original chart catalogs stay untouched and the merge in ./catalog.ts is the
 * only contact surface.
 */
import { z } from 'zod';
export declare const tufteChartComponentDefinitions: {
    readonly Sparkline: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            valueKey: z.ZodString;
            color: z.ZodNullable<z.ZodString>;
            fill: z.ZodNullable<z.ZodBoolean>;
            showEndDot: z.ZodNullable<z.ZodBoolean>;
            showMinMax: z.ZodNullable<z.ZodBoolean>;
            showValue: z.ZodNullable<z.ZodBoolean>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        readonly description: "Word-sized sparkline: a single trend line with no axes, grid, or labels. Optional end dot, min/max markers, light area fill, and an inline last value. The canonical Tufte primitive for showing a trajectory in minimal space.";
        readonly example: {
            readonly title: "Latency p95";
            readonly data: readonly [{
                readonly t: 0;
                readonly ms: 120;
            }, {
                readonly t: 1;
                readonly ms: 138;
            }, {
                readonly t: 2;
                readonly ms: 117;
            }, {
                readonly t: 3;
                readonly ms: 152;
            }, {
                readonly t: 4;
                readonly ms: 109;
            }];
            readonly valueKey: "ms";
            readonly color: null;
            readonly fill: true;
            readonly showEndDot: true;
            readonly showMinMax: false;
            readonly showValue: true;
            readonly height: null;
        };
    };
    readonly DotPlot: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            labelKey: z.ZodString;
            valueKey: z.ZodString;
            color: z.ZodNullable<z.ZodString>;
            sort: z.ZodNullable<z.ZodEnum<{
                none: "none";
                asc: "asc";
                desc: "desc";
            }>>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        readonly description: "Cleveland dot plot: categorical labels down the Y axis, one dot per category positioned by value on X. Higher data-ink ratio than a bar chart for ranked comparison. Sorts descending by default.";
        readonly example: {
            readonly title: "Build time by package";
            readonly data: readonly [{
                readonly pkg: "core";
                readonly seconds: 42;
            }, {
                readonly pkg: "client";
                readonly seconds: 31;
            }, {
                readonly pkg: "mcp";
                readonly seconds: 18;
            }, {
                readonly pkg: "cli";
                readonly seconds: 9;
            }];
            readonly labelKey: "pkg";
            readonly valueKey: "seconds";
            readonly color: null;
            readonly sort: "desc";
            readonly height: null;
        };
    };
    readonly BulletChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            labelKey: z.ZodNullable<z.ZodString>;
            valueKey: z.ZodString;
            targetKey: z.ZodNullable<z.ZodString>;
            rangesKey: z.ZodNullable<z.ZodString>;
            color: z.ZodNullable<z.ZodString>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        readonly description: "Stephen Few's bullet graph: a measure bar against grayscale qualitative bands with a target tick and per-row scale ticks. Compact KPI-vs-target display. Provide per-row `ranges` (ascending band thresholds) and `target`.";
        readonly example: {
            readonly title: "Quarterly KPIs vs target";
            readonly data: readonly [{
                readonly label: "Revenue";
                readonly value: 84;
                readonly target: 90;
                readonly ranges: readonly [50, 75, 100];
            }, {
                readonly label: "NPS";
                readonly value: 67;
                readonly target: 60;
                readonly ranges: readonly [40, 60, 80];
            }, {
                readonly label: "Uptime";
                readonly value: 99;
                readonly target: 99.9;
                readonly ranges: readonly [95, 99, 100];
            }];
            readonly labelKey: "label";
            readonly valueKey: "value";
            readonly targetKey: "target";
            readonly rangesKey: "ranges";
            readonly color: null;
            readonly height: null;
        };
    };
    readonly Slopegraph: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            labelKey: z.ZodString;
            beforeKey: z.ZodString;
            afterKey: z.ZodString;
            beforeLabel: z.ZodNullable<z.ZodString>;
            afterLabel: z.ZodNullable<z.ZodString>;
            color: z.ZodNullable<z.ZodString>;
            colorByDirection: z.ZodNullable<z.ZodBoolean>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        readonly description: "Tufte slopegraph: two value columns (before/after) with a connecting line per category. Lines use one neutral ink by default; set colorByDirection to accent rising lines and mute falling ones. Ideal for paired change across many items.";
        readonly example: {
            readonly title: "Coverage before/after refactor";
            readonly data: readonly [{
                readonly module: "auth";
                readonly before: 62;
                readonly after: 81;
            }, {
                readonly module: "canvas";
                readonly before: 74;
                readonly after: 78;
            }, {
                readonly module: "mcp";
                readonly before: 55;
                readonly after: 49;
            }];
            readonly labelKey: "module";
            readonly beforeKey: "before";
            readonly afterKey: "after";
            readonly beforeLabel: "Before";
            readonly afterLabel: "After";
            readonly color: null;
            readonly colorByDirection: null;
            readonly height: null;
        };
    };
};
