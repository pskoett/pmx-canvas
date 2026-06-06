/**
 * json-render catalog definition for PMX Canvas.
 *
 * Uses the shadcn component set from @json-render/shadcn/catalog plus local
 * chart components. The catalog validates specs before they are stored in
 * canvas node state or rendered in the browser viewer.
 */
import { z } from 'zod';
export declare const allComponentDefinitions: {
    Sparkline: {
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
    DotPlot: {
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
    BulletChart: {
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
    Slopegraph: {
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
    AreaChart: {
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
    ScatterChart: {
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
    RadarChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            axisKey: z.ZodString;
            metrics: z.ZodArray<z.ZodString>;
            height: z.ZodNullable<z.ZodNumber>;
            showLegend: z.ZodOptional<z.ZodBoolean>;
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
            readonly showLegend: true;
        };
    };
    StackedBarChart: {
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
            showLegend: z.ZodOptional<z.ZodBoolean>;
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
            readonly showLegend: true;
        };
    };
    ComposedChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            xKey: z.ZodString;
            barKey: z.ZodString;
            lineKey: z.ZodString;
            barColor: z.ZodNullable<z.ZodString>;
            lineColor: z.ZodNullable<z.ZodString>;
            height: z.ZodNullable<z.ZodNumber>;
            showLegend: z.ZodOptional<z.ZodBoolean>;
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
            readonly showLegend: true;
        };
    };
    LineChart: {
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
        readonly description: "Line chart for time-series or trend data. Provide data as an array of objects with xKey and yKey fields.";
        readonly example: {
            readonly title: "Weekly trend";
            readonly data: readonly [{
                readonly day: "Mon";
                readonly value: 10;
            }, {
                readonly day: "Tue";
                readonly value: 25;
            }, {
                readonly day: "Wed";
                readonly value: 18;
            }];
            readonly xKey: "day";
            readonly yKey: "value";
            readonly aggregate: null;
            readonly color: null;
            readonly height: null;
        };
    };
    BarChart: {
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
            colorBy: z.ZodNullable<z.ZodEnum<{
                value: "value";
                series: "series";
                category: "category";
                none: "none";
            }>>;
            highlight: z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodEnum<{
                max: "max";
                min: "min";
            }>]>>;
        }, z.core.$strip>;
        readonly description: "Bar chart for comparing categories. Provide data as an array of objects with xKey and yKey fields. Color encodes data, not decoration: by default one accent with the tallest bar highlighted (colorBy='series'). Set colorBy='category' only when the category itself is the message, 'value' to shade by magnitude, or 'none' for a flat fill.";
        readonly example: {
            readonly title: "Sales by region";
            readonly data: readonly [{
                readonly region: "North";
                readonly sales: 120;
            }, {
                readonly region: "South";
                readonly sales: 98;
            }, {
                readonly region: "East";
                readonly sales: 150;
            }];
            readonly xKey: "region";
            readonly yKey: "sales";
            readonly aggregate: null;
            readonly color: null;
            readonly height: null;
            readonly colorBy: "series";
            readonly highlight: "max";
        };
    };
    PieChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            nameKey: z.ZodString;
            valueKey: z.ZodString;
            height: z.ZodNullable<z.ZodNumber>;
            showLegend: z.ZodOptional<z.ZodBoolean>;
            showLabels: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>;
        readonly description: "Pie chart for showing proportions. Provide data as an array of objects with nameKey and valueKey fields.";
        readonly example: {
            readonly title: "Market share";
            readonly data: readonly [{
                readonly name: "Product A";
                readonly share: 45;
            }, {
                readonly name: "Product B";
                readonly share: 30;
            }, {
                readonly name: "Product C";
                readonly share: 25;
            }];
            readonly nameKey: "name";
            readonly valueKey: "share";
            readonly height: null;
            readonly showLegend: true;
            readonly showLabels: true;
        };
    };
    Badge: {
        props: z.ZodObject<{
            text: z.ZodString;
            variant: z.ZodNullable<z.ZodEnum<{
                error: "error";
                info: "info";
                warning: "warning";
                default: "default";
                success: "success";
                secondary: "secondary";
                destructive: "destructive";
                outline: "outline";
                danger: "danger";
            }>>;
        }, z.core.$strip>;
        description: string;
        example: {
            text: string;
            variant: string;
        };
    };
    Button: {
        props: z.ZodObject<{
            label: z.ZodString;
            disabled: z.ZodNullable<z.ZodBoolean>;
            variant: z.ZodNullable<z.ZodEnum<{
                success: "success";
                secondary: "secondary";
                destructive: "destructive";
                outline: "outline";
                danger: "danger";
                primary: "primary";
                ghost: "ghost";
            }>>;
        }, z.core.$strip>;
        description: string;
        example: {
            label: string;
            variant: string;
        };
        events: string[];
    };
    Card: {
        props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            description: z.ZodNullable<z.ZodString>;
            maxWidth: z.ZodNullable<z.ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
                full: "full";
            }>>;
            centered: z.ZodNullable<z.ZodBoolean>;
            className: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        slots: string[];
        description: string;
        example: {
            title: string;
            description: string;
        };
    };
    Stack: {
        props: z.ZodObject<{
            direction: z.ZodNullable<z.ZodEnum<{
                horizontal: "horizontal";
                vertical: "vertical";
            }>>;
            gap: z.ZodNullable<z.ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
                none: "none";
                xl: "xl";
            }>>;
            align: z.ZodNullable<z.ZodEnum<{
                start: "start";
                center: "center";
                end: "end";
                stretch: "stretch";
            }>>;
            justify: z.ZodNullable<z.ZodEnum<{
                start: "start";
                center: "center";
                end: "end";
                between: "between";
                around: "around";
            }>>;
            className: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        slots: string[];
        description: string;
        example: {
            direction: string;
            gap: string;
        };
    };
    Grid: {
        props: z.ZodObject<{
            columns: z.ZodNullable<z.ZodNumber>;
            gap: z.ZodNullable<z.ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
                xl: "xl";
            }>>;
            className: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        slots: string[];
        description: string;
        example: {
            columns: number;
            gap: string;
        };
    };
    Separator: {
        props: z.ZodObject<{
            orientation: z.ZodNullable<z.ZodEnum<{
                horizontal: "horizontal";
                vertical: "vertical";
            }>>;
        }, z.core.$strip>;
        description: string;
    };
    Tabs: {
        props: z.ZodObject<{
            tabs: z.ZodArray<z.ZodObject<{
                label: z.ZodString;
                value: z.ZodString;
            }, z.core.$strip>>;
            defaultValue: z.ZodNullable<z.ZodString>;
            value: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        slots: string[];
        events: string[];
        description: string;
    };
    Accordion: {
        props: z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                title: z.ZodString;
                content: z.ZodString;
            }, z.core.$strip>>;
            type: z.ZodNullable<z.ZodEnum<{
                single: "single";
                multiple: "multiple";
            }>>;
        }, z.core.$strip>;
        description: string;
    };
    Collapsible: {
        props: z.ZodObject<{
            title: z.ZodString;
            defaultOpen: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>;
        slots: string[];
        description: string;
    };
    Dialog: {
        props: z.ZodObject<{
            title: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            openPath: z.ZodString;
        }, z.core.$strip>;
        slots: string[];
        description: string;
    };
    Drawer: {
        props: z.ZodObject<{
            title: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            openPath: z.ZodString;
        }, z.core.$strip>;
        slots: string[];
        description: string;
    };
    Carousel: {
        props: z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                title: z.ZodNullable<z.ZodString>;
                description: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        description: string;
    };
    Table: {
        props: z.ZodObject<{
            columns: z.ZodArray<z.ZodString>;
            rows: z.ZodArray<z.ZodArray<z.ZodString>>;
            caption: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        description: string;
        example: {
            columns: string[];
            rows: string[][];
        };
    };
    Heading: {
        props: z.ZodObject<{
            text: z.ZodString;
            level: z.ZodNullable<z.ZodEnum<{
                h1: "h1";
                h2: "h2";
                h3: "h3";
                h4: "h4";
            }>>;
        }, z.core.$strip>;
        description: string;
        example: {
            text: string;
            level: string;
        };
    };
    Text: {
        props: z.ZodObject<{
            text: z.ZodString;
            variant: z.ZodNullable<z.ZodEnum<{
                caption: "caption";
                body: "body";
                muted: "muted";
                lead: "lead";
                code: "code";
            }>>;
        }, z.core.$strip>;
        description: string;
        example: {
            text: string;
        };
    };
    Image: {
        props: z.ZodObject<{
            src: z.ZodNullable<z.ZodString>;
            alt: z.ZodString;
            width: z.ZodNullable<z.ZodNumber>;
            height: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        description: string;
    };
    Avatar: {
        props: z.ZodObject<{
            src: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            size: z.ZodNullable<z.ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
            }>>;
        }, z.core.$strip>;
        description: string;
        example: {
            name: string;
            size: string;
        };
    };
    Alert: {
        props: z.ZodObject<{
            title: z.ZodString;
            message: z.ZodNullable<z.ZodString>;
            type: z.ZodNullable<z.ZodEnum<{
                success: "success";
                info: "info";
                warning: "warning";
                error: "error";
            }>>;
        }, z.core.$strip>;
        description: string;
        example: {
            title: string;
            message: string;
            type: string;
        };
    };
    Progress: {
        props: z.ZodObject<{
            value: z.ZodNumber;
            max: z.ZodNullable<z.ZodNumber>;
            label: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        description: string;
        example: {
            value: number;
            max: number;
            label: string;
        };
    };
    Skeleton: {
        props: z.ZodObject<{
            width: z.ZodNullable<z.ZodString>;
            height: z.ZodNullable<z.ZodString>;
            rounded: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>;
        description: string;
    };
    Spinner: {
        props: z.ZodObject<{
            size: z.ZodNullable<z.ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
            }>>;
            label: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        description: string;
    };
    Tooltip: {
        props: z.ZodObject<{
            content: z.ZodString;
            text: z.ZodString;
        }, z.core.$strip>;
        description: string;
    };
    Popover: {
        props: z.ZodObject<{
            trigger: z.ZodString;
            content: z.ZodString;
        }, z.core.$strip>;
        description: string;
    };
    Input: {
        props: z.ZodObject<{
            label: z.ZodString;
            name: z.ZodString;
            type: z.ZodNullable<z.ZodEnum<{
                number: "number";
                text: "text";
                email: "email";
                password: "password";
            }>>;
            placeholder: z.ZodNullable<z.ZodString>;
            value: z.ZodNullable<z.ZodString>;
            checks: z.ZodNullable<z.ZodArray<z.ZodObject<{
                type: z.ZodString;
                message: z.ZodString;
                args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            }, z.core.$strip>>>;
            validateOn: z.ZodNullable<z.ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, z.core.$strip>;
        events: string[];
        description: string;
        example: {
            label: string;
            name: string;
            type: string;
            placeholder: string;
        };
    };
    Textarea: {
        props: z.ZodObject<{
            label: z.ZodString;
            name: z.ZodString;
            placeholder: z.ZodNullable<z.ZodString>;
            rows: z.ZodNullable<z.ZodNumber>;
            value: z.ZodNullable<z.ZodString>;
            checks: z.ZodNullable<z.ZodArray<z.ZodObject<{
                type: z.ZodString;
                message: z.ZodString;
                args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            }, z.core.$strip>>>;
            validateOn: z.ZodNullable<z.ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, z.core.$strip>;
        description: string;
    };
    Select: {
        props: z.ZodObject<{
            label: z.ZodString;
            name: z.ZodString;
            options: z.ZodArray<z.ZodString>;
            placeholder: z.ZodNullable<z.ZodString>;
            value: z.ZodNullable<z.ZodString>;
            checks: z.ZodNullable<z.ZodArray<z.ZodObject<{
                type: z.ZodString;
                message: z.ZodString;
                args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            }, z.core.$strip>>>;
            validateOn: z.ZodNullable<z.ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    Checkbox: {
        props: z.ZodObject<{
            label: z.ZodString;
            name: z.ZodString;
            checked: z.ZodNullable<z.ZodBoolean>;
            checks: z.ZodNullable<z.ZodArray<z.ZodObject<{
                type: z.ZodString;
                message: z.ZodString;
                args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            }, z.core.$strip>>>;
            validateOn: z.ZodNullable<z.ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    Radio: {
        props: z.ZodObject<{
            label: z.ZodString;
            name: z.ZodString;
            options: z.ZodArray<z.ZodString>;
            value: z.ZodNullable<z.ZodString>;
            checks: z.ZodNullable<z.ZodArray<z.ZodObject<{
                type: z.ZodString;
                message: z.ZodString;
                args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            }, z.core.$strip>>>;
            validateOn: z.ZodNullable<z.ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    Switch: {
        props: z.ZodObject<{
            label: z.ZodString;
            name: z.ZodString;
            checked: z.ZodNullable<z.ZodBoolean>;
            checks: z.ZodNullable<z.ZodArray<z.ZodObject<{
                type: z.ZodString;
                message: z.ZodString;
                args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            }, z.core.$strip>>>;
            validateOn: z.ZodNullable<z.ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    Slider: {
        props: z.ZodObject<{
            label: z.ZodNullable<z.ZodString>;
            min: z.ZodNullable<z.ZodNumber>;
            max: z.ZodNullable<z.ZodNumber>;
            step: z.ZodNullable<z.ZodNumber>;
            value: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    Link: {
        props: z.ZodObject<{
            label: z.ZodString;
            href: z.ZodString;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    DropdownMenu: {
        props: z.ZodObject<{
            label: z.ZodString;
            items: z.ZodArray<z.ZodObject<{
                label: z.ZodString;
                value: z.ZodString;
            }, z.core.$strip>>;
            value: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    Toggle: {
        props: z.ZodObject<{
            label: z.ZodString;
            pressed: z.ZodNullable<z.ZodBoolean>;
            variant: z.ZodNullable<z.ZodEnum<{
                default: "default";
                outline: "outline";
            }>>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    ToggleGroup: {
        props: z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                label: z.ZodString;
                value: z.ZodString;
            }, z.core.$strip>>;
            type: z.ZodNullable<z.ZodEnum<{
                single: "single";
                multiple: "multiple";
            }>>;
            value: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    ButtonGroup: {
        props: z.ZodObject<{
            buttons: z.ZodArray<z.ZodObject<{
                label: z.ZodString;
                value: z.ZodString;
            }, z.core.$strip>>;
            selected: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
    Pagination: {
        props: z.ZodObject<{
            totalPages: z.ZodNumber;
            page: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        events: string[];
        description: string;
    };
};
export declare const catalog: import("@json-render/core").Catalog<import("@json-render/core").SchemaDefinition<import("@json-render/core").SchemaType<string, unknown>, import("@json-render/core").SchemaType<string, unknown>>, never>;
export interface JsonRenderIssue {
    path?: PropertyKey[];
    message?: string;
}
export interface JsonRenderPropDescriptor {
    name: string;
    type: string;
    required: boolean;
    nullable: boolean;
}
export interface JsonRenderComponentDescriptor {
    type: string;
    description: string;
    slots: string[];
    example: unknown;
    props: JsonRenderPropDescriptor[];
}
interface JsonRenderValidationResult {
    success: boolean;
    data?: unknown;
    error?: {
        issues?: JsonRenderIssue[];
    };
}
export declare function describeJsonRenderCatalog(): JsonRenderComponentDescriptor[];
export declare function validateShadcnElementProps(spec: unknown): JsonRenderValidationResult;
export {};
