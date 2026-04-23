import { describe, expect, test } from 'bun:test';
import {
  buildGraphSpec,
  normalizeAndValidateJsonRenderSpec,
  normalizeGraphType,
} from '../../src/json-render/server.ts';

describe('json-render validation', () => {
  test('rejects specs without root and elements', () => {
    expect(() => normalizeAndValidateJsonRenderSpec({})).toThrow('Missing root and elements in spec.');
  });

  test('accepts minimal valid specs', () => {
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: {
            title: 'Test card',
          },
          children: [],
        },
      },
    });

    expect(spec.root).toBe('card');
    expect(Object.keys(spec.elements)).toEqual(['card']);
  });

  test('normalizes common element aliases and cleans non-string children', () => {
    const spec = normalizeAndValidateJsonRenderSpec({
      root: 'panel',
      elements: {
        panel: {
          type: 'Panel',
          props: {
            title: 'Alias card',
            description: null,
            maxWidth: 'full',
            centered: false,
          },
          children: ['copy', 123, null],
        },
        copy: {
          type: 'Text',
          props: {
            text: 'Hello',
          },
          children: [],
        },
      },
    });

    expect(spec.elements.panel?.type).toBe('Card');
    expect(spec.elements.panel?.children).toEqual(['copy']);
    expect((spec.elements.panel?.props as Record<string, unknown>).description).toBeUndefined();
  });
});

describe('graph builder', () => {
  test('resolves aliases for the new chart types', () => {
    expect(normalizeGraphType('area')).toBe('AreaChart');
    expect(normalizeGraphType('Scatter Plot')).toBe('ScatterChart');
    expect(normalizeGraphType('radar')).toBe('RadarChart');
    expect(normalizeGraphType('stacked-bar')).toBe('StackedBarChart');
    expect(normalizeGraphType('combo')).toBe('ComposedChart');
  });

  test('builds a radar spec inferring metrics from data', () => {
    const spec = buildGraphSpec({
      graphType: 'radar',
      data: [
        { axis: 'Speed', a: 10, b: 20 },
        { axis: 'Power', a: 30, b: 40 },
      ],
    });

    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('RadarChart');
    expect(chart.props.axisKey).toBe('axis');
    expect(chart.props.metrics).toEqual(['a', 'b']);
  });

  test('builds a stacked-bar spec inferring series from data', () => {
    const spec = buildGraphSpec({
      graphType: 'stacked-bar',
      xKey: 'quarter',
      data: [
        { quarter: 'Q1', north: 1, south: 2 },
        { quarter: 'Q2', north: 3, south: 4 },
      ],
    });

    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('StackedBarChart');
    expect(chart.props.series).toEqual(['north', 'south']);
  });

  test('builds a composed spec with bar + line keys', () => {
    const spec = buildGraphSpec({
      graphType: 'composed',
      xKey: 'day',
      barKey: 'visits',
      lineKey: 'conversion',
      data: [{ day: 'Mon', visits: 100, conversion: 4.5 }],
    });

    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('ComposedChart');
    expect(chart.props.barKey).toBe('visits');
    expect(chart.props.lineKey).toBe('conversion');
  });

  test('scatter spec includes optional zKey', () => {
    const spec = buildGraphSpec({
      graphType: 'scatter',
      xKey: 'size',
      yKey: 'latency',
      zKey: 'weight',
      data: [{ size: 1, latency: 2, weight: 3 }],
    });

    const chart = spec.elements.chart as { type: string; props: Record<string, unknown> };
    expect(chart.type).toBe('ScatterChart');
    expect(chart.props.zKey).toBe('weight');
  });
});
