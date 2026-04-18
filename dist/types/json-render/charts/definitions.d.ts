/**
 * Chart component definitions for json-render catalogs.
 *
 * Provides LineChart, BarChart, and PieChart components built on Recharts.
 * Mirrors the chart definitions from the Vercel json-render chat example.
 */
import { z } from 'zod';
export declare const chartComponentDefinitions: {
    readonly LineChart: {
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
    readonly BarChart: {
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
        readonly description: "Bar chart for comparing categories. Provide data as an array of objects with xKey and yKey fields.";
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
        };
    };
    readonly PieChart: {
        readonly props: z.ZodObject<{
            title: z.ZodNullable<z.ZodString>;
            data: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            nameKey: z.ZodString;
            valueKey: z.ZodString;
            height: z.ZodNullable<z.ZodNumber>;
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
        };
    };
};
