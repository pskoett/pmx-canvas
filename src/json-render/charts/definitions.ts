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
    props: cartesianProps,
    description:
      'Bar chart for comparing categories. Provide data as an array of objects with xKey and yKey fields.',
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
    },
  },

  PieChart: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      nameKey: z.string(),
      valueKey: z.string(),
      height: z.number().nullable(),
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
    },
  },
} as const;
