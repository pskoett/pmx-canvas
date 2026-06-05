/**
 * Chart component definitions for json-render catalogs.
 *
 * Provides LineChart, BarChart, and PieChart components built on Recharts.
 * Mirrors the chart definitions from the Vercel json-render chat example.
 */

import { z } from 'zod';

const cartesianProps = z.object({
  title: z.string().nullable(),
  data: z.array(z.record(z.string(), z.unknown())),
  xKey: z.string(),
  yKey: z.string(),
  aggregate: z.enum(['sum', 'count', 'avg']).nullable(),
  color: z.string().nullable(),
  height: z.number().nullable(),
});

const barChartProps = cartesianProps.extend({
  colorBy: z
    .enum(['series', 'category', 'value', 'none'])
    .nullable()
    .describe(
      "How bars are colored. 'series' (default) = single accent with ONE highlighted bar (Tufte-safe emphasis); 'category' = rotate the categorical palette per bar (only when the x-axis category itself is the message); 'value' = sequential shade by magnitude; 'none' = flat single accent.",
    ),
  highlight: z
    .union([z.number(), z.enum(['max', 'min'])])
    .nullable()
    .describe(
      "For colorBy='series', which bar gets the accent: 'max' (default, tallest), 'min' (shortest), a 0-based index, or null for no emphasis. Ignored by other colorBy modes.",
    ),
});

export const chartComponentDefinitions = {
  LineChart: {
    props: cartesianProps,
    description:
      'Line chart for time-series or trend data. Provide data as an array of objects with xKey and yKey fields.',
    example: {
      title: 'Weekly trend',
      data: [
        { day: 'Mon', value: 10 },
        { day: 'Tue', value: 25 },
        { day: 'Wed', value: 18 },
      ],
      xKey: 'day',
      yKey: 'value',
      aggregate: null,
      color: null,
      height: null,
    },
  },

  BarChart: {
    props: barChartProps,
    description:
      "Bar chart for comparing categories. Provide data as an array of objects with xKey and yKey fields. Color encodes data, not decoration: by default one accent with the tallest bar highlighted (colorBy='series'). Set colorBy='category' only when the category itself is the message, 'value' to shade by magnitude, or 'none' for a flat fill.",
    example: {
      title: 'Sales by region',
      data: [
        { region: 'North', sales: 120 },
        { region: 'South', sales: 98 },
        { region: 'East', sales: 150 },
      ],
      xKey: 'region',
      yKey: 'sales',
      aggregate: null,
      color: null,
      height: null,
      colorBy: 'series',
      highlight: 'max',
    },
  },

  PieChart: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      nameKey: z.string(),
      valueKey: z.string(),
      height: z.number().nullable(),
      showLegend: z.boolean().optional(),
      showLabels: z.boolean().optional(),
    }),
    description:
      'Pie chart for showing proportions. Provide data as an array of objects with nameKey and valueKey fields.',
    example: {
      title: 'Market share',
      data: [
        { name: 'Product A', share: 45 },
        { name: 'Product B', share: 30 },
        { name: 'Product C', share: 25 },
      ],
      nameKey: 'name',
      valueKey: 'share',
      height: null,
      showLegend: true,
      showLabels: true,
    },
  },
} as const;
