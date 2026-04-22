/**
 * Chart HTML template generator — produces self-contained ext-app HTML
 * documents that render interactive Chart.js charts inside the canvas
 * ExtAppFrame iframe.
 *
 * The generated HTML:
 * 1. Renders immediately from inline data (no bridge needed)
 * 2. Connects to host AppBridge via the embedded ext-app App SDK runtime
 * 3. Accepts updated data via toolInput for re-rendering
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const extAppsPackageDir = dirname(require.resolve('@modelcontextprotocol/ext-apps/package.json'));
const extAppsRuntimeSource = readFileSync(
  join(extAppsPackageDir, 'dist', 'src', 'app-with-deps.js'),
  'utf-8',
);
const appBindingMatch = extAppsRuntimeSource.match(/([A-Za-z_$][\w$]*) as App/);
const transportBindingMatch = extAppsRuntimeSource.match(/([A-Za-z_$][\w$]*) as PostMessageTransport/);

if (!appBindingMatch || !transportBindingMatch) {
  throw new Error('Failed to locate App or PostMessageTransport export bindings in @modelcontextprotocol/ext-apps runtime');
}

const extAppsBootstrapSource = `${extAppsRuntimeSource}
const App = ${appBindingMatch[1]};
const PostMessageTransport = ${transportBindingMatch[1]};`;

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

const PALETTE = ['#46b6ff', '#2fd07f', '#f4c542', '#ff6a7f', '#e896ff', '#ff9f40', '#a7b2c8'];

/**
 * Map our simplified config to a Chart.js configuration object.
 */
function buildChartJsConfig(config: ChartConfig): Record<string, unknown> {
  const type = config.chartType === 'radar' ? 'radar' : config.chartType;
  const isPolar = type === 'pie' || type === 'doughnut' || type === 'radar';

  const datasets = config.datasets.map((ds, i) => {
    const color = ds.color || PALETTE[i % PALETTE.length];
    const base: Record<string, unknown> = {
      label: ds.label,
      data: ds.values,
    };

    if (isPolar) {
      // Pie/doughnut/radar: per-segment colors
      base.backgroundColor = config.labels.map((_, j) => `${PALETTE[j % PALETTE.length]}cc`);
      base.borderColor = config.labels.map((_, j) => PALETTE[j % PALETTE.length]);
      base.borderWidth = 1;
    } else {
      base.backgroundColor = `${color}99`;
      base.borderColor = color;
      base.borderWidth = 2;
      if (type === 'line') {
        base.tension = 0.3;
        base.fill = false;
        base.pointRadius = 4;
        base.pointHoverRadius = 6;
      }
    }

    return base;
  });

  const scales: Record<string, unknown> = {};
  if (!isPolar) {
    scales.x = {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: '#7b8da8', font: { size: 11 } },
      ...(config.xAxisLabel && {
        title: { display: true, text: config.xAxisLabel, color: '#a7b2c8', font: { size: 12 } },
      }),
      ...(config.stacked && { stacked: true }),
    };
    scales.y = {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: '#7b8da8', font: { size: 11 } },
      ...(config.yAxisLabel && {
        title: { display: true, text: config.yAxisLabel, color: '#a7b2c8', font: { size: 12 } },
      }),
      ...(config.stacked && { stacked: true }),
    };
  }

  return {
    type,
    data: { labels: config.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: {
          display: datasets.length > 1 || isPolar,
          labels: { color: '#a7b2c8', font: { size: 11 }, padding: 12 },
        },
        tooltip: {
          backgroundColor: 'rgba(26,29,35,0.95)',
          titleColor: '#e0e4ec',
          bodyColor: '#a7b2c8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 6,
        },
      },
      ...(!isPolar && { scales }),
    },
  };
}

/**
 * Generate a self-contained HTML document that renders a Chart.js chart
 * and optionally connects to the host via the ext-app App SDK.
 */
export function generateChartHtml(config: ChartConfig): string {
  const chartJsConfig = buildChartJsConfig(config);
  const configJson = JSON.stringify(chartJsConfig);
  const chartConfigJson = JSON.stringify(config);
  const titleEscaped = escapeHtml(config.title);

  // Chart type buttons — highlight the active one
  const chartTypes: Array<{ key: string; label: string }> = [
    { key: 'bar', label: 'Bar' },
    { key: 'line', label: 'Line' },
    { key: 'pie', label: 'Pie' },
    { key: 'scatter', label: 'Scatter' },
    { key: 'doughnut', label: 'Donut' },
    { key: 'radar', label: 'Radar' },
  ];
  const typeButtons = chartTypes
    .map(
      (t) =>
        `<button class="type-btn${t.key === config.chartType ? ' active' : ''}" data-type="${t.key}">${t.label}</button>`,
    )
    .join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html {
      width: 100%;
      height: 100%;
    }
    body {
      background: #1a1d23;
      color: #e0e4ec;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      overflow: hidden;
      width: 100%;
      height: 100%;
    }
    #container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 12px;
      background: rgba(255,255,255,0.03);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    }
    .chart-title {
      font-size: 13px;
      font-weight: 600;
      color: #e0e4ec;
      margin-right: auto;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .type-btn {
      padding: 3px 8px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      background: transparent;
      color: #7b8da8;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .type-btn:hover { background: rgba(255,255,255,0.05); color: #e0e4ec; }
    .type-btn.active {
      background: rgba(70,182,255,0.15);
      border-color: rgba(70,182,255,0.3);
      color: #46b6ff;
    }
    .chart-area {
      flex: 1;
      padding: 12px;
      position: relative;
      min-width: 0;
      min-height: 0;
    }
    #chart {
      display: block;
      width: 100% !important;
      height: 100% !important;
    }
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #7b8da8;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div id="container">
    <div class="toolbar">
      <span class="chart-title">${titleEscaped}</span>
      ${typeButtons}
    </div>
    <div class="chart-area">
      <canvas id="chart"></canvas>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script>
    // Inline chart configuration — renders immediately without bridge
    var CHART_CONFIG = ${configJson};
    var CHART_META = ${chartConfigJson};
    var chartInstance = null;
    var chartResizeObserver = null;
    var chartResizeRaf = null;

    function getChartArea() {
      return document.querySelector('.chart-area');
    }

    function getChartSize() {
      var area = getChartArea();
      if (!area) return null;
      var rect = area.getBoundingClientRect();
      if (!rect || rect.width < 24 || rect.height < 24) return null;
      return rect;
    }

    function scheduleChartResize() {
      if (chartResizeRaf) cancelAnimationFrame(chartResizeRaf);
      chartResizeRaf = requestAnimationFrame(function() {
        chartResizeRaf = null;
        if (chartInstance) chartInstance.resize();
      });
    }

    function ensureChartResizeTracking() {
      var area = getChartArea();
      if (!area || chartResizeObserver || typeof ResizeObserver !== 'function') return;
      chartResizeObserver = new ResizeObserver(function() {
        if (chartInstance) {
          scheduleChartResize();
          return;
        }
        if (getChartSize()) {
          renderChart(CHART_CONFIG);
        }
      });
      chartResizeObserver.observe(area);
      window.addEventListener('resize', scheduleChartResize);
    }

    function renderChart(cfg) {
      var size = getChartSize();
      if (!size) return false;
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      var canvas = document.getElementById('chart');
      if (!canvas) return;
      canvas.width = Math.max(1, Math.floor(size.width));
      canvas.height = Math.max(1, Math.floor(size.height));
      chartInstance = new Chart(canvas.getContext('2d'), JSON.parse(JSON.stringify(cfg)));
      scheduleChartResize();
      return true;
    }

    function renderWhenReady(cfg, attempt) {
      if (renderChart(cfg)) return;
      if ((attempt || 0) >= 20) return;
      requestAnimationFrame(function() {
        renderWhenReady(cfg, (attempt || 0) + 1);
      });
    }

    function switchType(newType) {
      // Rebuild config for the new chart type using stored metadata
      var meta = JSON.parse(JSON.stringify(CHART_META));
      meta.chartType = newType;
      CHART_META = meta;

      // Update button states
      document.querySelectorAll('.type-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.type === newType);
      });

      // Post message to request new config from parent (or rebuild locally)
      var isPolar = (newType === 'pie' || newType === 'doughnut' || newType === 'radar');
      var palette = ${JSON.stringify(PALETTE)};

      var datasets = meta.datasets.map(function(ds, i) {
        var color = ds.color || palette[i % palette.length];
        var base = { label: ds.label, data: ds.values };
        if (isPolar) {
          base.backgroundColor = meta.labels.map(function(_, j) { return palette[j % palette.length] + 'cc'; });
          base.borderColor = meta.labels.map(function(_, j) { return palette[j % palette.length]; });
          base.borderWidth = 1;
        } else {
          base.backgroundColor = color + '99';
          base.borderColor = color;
          base.borderWidth = 2;
          if (newType === 'line') { base.tension = 0.3; base.fill = false; base.pointRadius = 4; }
        }
        return base;
      });

      var scales = {};
      if (!isPolar) {
        scales.x = {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: '#7b8da8', font: { size: 11 } },
          stacked: !!meta.stacked
        };
        scales.y = {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: '#7b8da8', font: { size: 11 } },
          stacked: !!meta.stacked
        };
        if (meta.xAxisLabel) scales.x.title = { display: true, text: meta.xAxisLabel, color: '#a7b2c8' };
        if (meta.yAxisLabel) scales.y.title = { display: true, text: meta.yAxisLabel, color: '#a7b2c8' };
      }

      var newCfg = {
        type: newType,
        data: { labels: meta.labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          plugins: {
            legend: {
              display: datasets.length > 1 || isPolar,
              labels: { color: '#a7b2c8', font: { size: 11 }, padding: 12 }
            },
            tooltip: {
              backgroundColor: 'rgba(26,29,35,0.95)',
              titleColor: '#e0e4ec',
              bodyColor: '#a7b2c8',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1, padding: 10, cornerRadius: 6
            }
          },
          scales: isPolar ? undefined : scales
        }
      };
      CHART_CONFIG = newCfg;
      renderWhenReady(newCfg, 0);
    }

    window.__PMX_CHART_BRIDGE__ = {
      updateChartMeta: function(nextMeta) {
        if (!nextMeta || typeof nextMeta !== 'object') return;
        CHART_META = nextMeta;
        switchType(CHART_META.chartType || 'bar');
      }
    };

    // Toolbar click handler
    document.querySelector('.toolbar').addEventListener('click', function(e) {
      var btn = e.target.closest('.type-btn');
      if (btn && btn.dataset.type) switchType(btn.dataset.type);
    });

    // Initial render
    window.addEventListener('load', function() {
      ensureChartResizeTracking();
      if (CHART_META.datasets.length === 0 || CHART_META.labels.length === 0) {
        document.querySelector('.chart-area').innerHTML =
          '<div class="empty-state">No data to display</div>';
        return;
      }
      renderWhenReady(CHART_CONFIG, 0);
    });
  </script>
  <script type="module">
    ${extAppsBootstrapSource}

    try {
      if (!App) {
        throw new Error('AppBridge SDK unavailable');
      }

      const bridge = window.__PMX_CHART_BRIDGE__;
      const app = new App({ name: 'PMX Chart', version: '1.0.0' }, {});
      app.ontoolinput = function(params) {
        bridge?.updateChartMeta?.(params?.arguments);
      };
      await app.connect(new PostMessageTransport(window.parent, window.parent));
    } catch (error) {
      // Bridge connection optional — chart already rendered from inline data
      const message = error instanceof Error ? error.message : String(error);
      console.debug('[pmx-chart] AppBridge not available:', message);
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
