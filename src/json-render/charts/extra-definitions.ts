/**
 * Definitions for the extra chart components in ./extra-components.tsx.
 *
 * Kept separate from ./definitions.ts so the original chart catalog stays
 * untouched and the merge in ./catalog.ts is the only contact surface.
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

export const extraChartComponentDefinitions = {
  AreaChart: {
    props: cartesianProps,
    description:
      'Area chart for cumulative or trend data. Same shape as LineChart but draws a filled area under the line.',
    example: {
      title: 'Daily signups',
      data: [
        { day: 'Mon', value: 12 },
        { day: 'Tue', value: 24 },
        { day: 'Wed', value: 19 },
        { day: 'Thu', value: 31 },
      ],
      xKey: 'day',
      yKey: 'value',
      aggregate: null,
      color: null,
      height: null,
    },
  },

  ScatterChart: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      xKey: z.string(),
      yKey: z.string(),
      zKey: z.string().nullable(),
      color: z.string().nullable(),
      height: z.number().nullable(),
    }),
    description:
      'Scatter plot for correlation or distribution. Both axes are numeric; optional zKey scales point size.',
    example: {
      title: 'Latency vs payload size',
      data: [
        { size: 10, latency: 25 },
        { size: 40, latency: 80 },
        { size: 80, latency: 110 },
        { size: 120, latency: 180 },
      ],
      xKey: 'size',
      yKey: 'latency',
      zKey: null,
      color: null,
      height: null,
    },
  },

  RadarChart: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      axisKey: z.string(),
      metrics: z.array(z.string()),
      height: z.number().nullable(),
    }),
    description:
      'Radar chart for comparing multiple metrics across categories. Each metric in `metrics` is plotted as its own polygon.',
    example: {
      title: 'Skill comparison',
      data: [
        { skill: 'Speed', alice: 80, bob: 60 },
        { skill: 'Accuracy', alice: 70, bob: 90 },
        { skill: 'Stamina', alice: 85, bob: 75 },
      ],
      axisKey: 'skill',
      metrics: ['alice', 'bob'],
      height: null,
    },
  },

  StackedBarChart: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      xKey: z.string(),
      series: z.array(z.string()),
      aggregate: z.enum(['sum', 'count', 'avg']).nullable(),
      height: z.number().nullable(),
    }),
    description:
      'Stacked bar chart for compositional data. Each entry in `series` is plotted as its own bar segment per x value.',
    example: {
      title: 'Revenue by region',
      data: [
        { quarter: 'Q1', north: 30, south: 18, east: 22 },
        { quarter: 'Q2', north: 42, south: 25, east: 28 },
        { quarter: 'Q3', north: 38, south: 30, east: 26 },
      ],
      xKey: 'quarter',
      series: ['north', 'south', 'east'],
      aggregate: null,
      height: null,
    },
  },

  ComposedChart: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      xKey: z.string(),
      barKey: z.string(),
      lineKey: z.string(),
      barColor: z.string().nullable(),
      lineColor: z.string().nullable(),
      height: z.number().nullable(),
    }),
    description:
      'Combined bar + line chart for paired metrics (e.g. counts + a derived rate) on the same axis.',
    example: {
      title: 'Visits and conversion',
      data: [
        { day: 'Mon', visits: 120, conversion: 4.2 },
        { day: 'Tue', visits: 145, conversion: 3.8 },
        { day: 'Wed', visits: 160, conversion: 5.1 },
      ],
      xKey: 'day',
      barKey: 'visits',
      lineKey: 'conversion',
      barColor: null,
      lineColor: null,
      height: null,
    },
  },
} as const;
