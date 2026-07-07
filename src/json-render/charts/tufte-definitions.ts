/**
 * Definitions for the Tufte primitive chart components in ./tufte-components.tsx.
 *
 * Kept separate from ./definitions.ts and ./extra-definitions.ts so the
 * original chart catalogs stay untouched and the merge in ./catalog.ts is the
 * only contact surface.
 */

import { z } from 'zod';

export const tufteChartComponentDefinitions = {
  Sparkline: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      valueKey: z.string(),
      color: z.string().nullable(),
      fill: z.boolean().nullable(),
      showEndDot: z.boolean().nullable(),
      showMinMax: z.boolean().nullable(),
      showValue: z.boolean().nullable(),
      height: z.number().nullable(),
    }),
    description:
      'Word-sized sparkline: a single trend line with no axes, grid, or labels. Optional end dot, min/max markers, light area fill, and an inline last value. The canonical Tufte primitive for showing a trajectory in minimal space.',
    example: {
      title: 'Latency p95',
      data: [
        { t: 0, ms: 120 },
        { t: 1, ms: 138 },
        { t: 2, ms: 117 },
        { t: 3, ms: 152 },
        { t: 4, ms: 109 },
      ],
      valueKey: 'ms',
      color: null,
      fill: true,
      showEndDot: true,
      showMinMax: false,
      showValue: true,
      height: null,
    },
  },

  DotPlot: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      labelKey: z.string(),
      valueKey: z.string(),
      color: z.string().nullable(),
      sort: z.enum(['asc', 'desc', 'none']).nullable(),
      height: z.number().nullable(),
    }),
    description:
      'Cleveland dot plot: categorical labels down the Y axis, one dot per category positioned by value on X. Higher data-ink ratio than a bar chart for ranked comparison. Sorts descending by default.',
    example: {
      title: 'Build time by package',
      data: [
        { pkg: 'core', seconds: 42 },
        { pkg: 'client', seconds: 31 },
        { pkg: 'mcp', seconds: 18 },
        { pkg: 'cli', seconds: 9 },
      ],
      labelKey: 'pkg',
      valueKey: 'seconds',
      color: null,
      sort: 'desc',
      height: null,
    },
  },

  BulletChart: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      labelKey: z.string().nullable(),
      valueKey: z.string(),
      targetKey: z.string().nullable(),
      rangesKey: z.string().nullable(),
      color: z.string().nullable(),
      height: z.number().nullable(),
    }),
    description:
      "Stephen Few's bullet graph: a measure bar against grayscale qualitative bands with a target tick and per-row scale ticks. Compact KPI-vs-target display. Provide per-row `ranges` (ascending band thresholds) and `target`.",
    example: {
      title: 'Quarterly KPIs vs target',
      data: [
        { label: 'Revenue', value: 84, target: 90, ranges: [50, 75, 100] },
        { label: 'NPS', value: 67, target: 60, ranges: [40, 60, 80] },
        { label: 'Uptime', value: 99, target: 99.9, ranges: [95, 99, 100] },
      ],
      labelKey: 'label',
      valueKey: 'value',
      targetKey: 'target',
      rangesKey: 'ranges',
      color: null,
      height: null,
    },
  },

  Slopegraph: {
    props: z.object({
      title: z.string().nullable(),
      data: z.array(z.record(z.string(), z.unknown())),
      labelKey: z.string(),
      beforeKey: z.string(),
      afterKey: z.string(),
      beforeLabel: z.string().nullable(),
      afterLabel: z.string().nullable(),
      color: z.string().nullable(),
      colorByDirection: z.boolean().nullable(),
      height: z.number().nullable(),
    }),
    description:
      'Tufte slopegraph: two value columns (before/after) with a connecting line per category. Lines use one neutral ink by default; set colorByDirection to accent rising lines and mute falling ones. Ideal for paired change across many items.',
    example: {
      title: 'Coverage before/after refactor',
      data: [
        { module: 'auth', before: 62, after: 81 },
        { module: 'canvas', before: 74, after: 78 },
        { module: 'mcp', before: 55, after: 49 },
      ],
      labelKey: 'module',
      beforeKey: 'before',
      afterKey: 'after',
      beforeLabel: 'Before',
      afterLabel: 'After',
      color: null,
      colorByDirection: null,
      height: null,
    },
  },
} as const;
