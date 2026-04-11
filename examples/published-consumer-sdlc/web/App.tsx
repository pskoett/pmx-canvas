import {
  artifactKpis,
  componentRisks,
  ownershipLoad,
  pipelineStages,
  releaseChecklist,
  stageDefectCounts,
  weeklyMetrics,
} from './data';
import './index.css';

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

function linePath(values: number[], width: number, height: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const xOffset = 20;
  const yOffset = 20;

  return values
    .map((value, index) => {
      const x = xOffset + (index / Math.max(1, values.length - 1)) * width;
      const y = yOffset + height - ((value - min) / span) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export default function App() {
  const leadTimeValues = weeklyMetrics.map((entry) => entry.leadTimeHours);
  const leadTimePath = linePath(leadTimeValues, 520, 180);
  const leadTimeFillPath = `${leadTimePath} L 540 200 L 20 200 Z`;
  const leadTimeMin = Math.min(...leadTimeValues);
  const leadTimeMax = Math.max(...leadTimeValues);
  const leadTimeSpan = Math.max(1, leadTimeMax - leadTimeMin);

  return (
    <main className="control-room">
      <section className="hero">
        <div>
          <p className="eyebrow">Published Consumer Fixture</p>
          <h1>Delivery Control Room</h1>
          <p className="hero-copy">
            A deliberately dense SDLC cockpit built through the packaged PMX Canvas API,
            rendered as a bundled artifact, and backed by synthetic release telemetry.
          </p>
        </div>
        <div className="hero-chip">
          <span>Release posture</span>
          <strong>Steady with queue pressure</strong>
        </div>
      </section>

      <section className="kpi-grid">
        {artifactKpis.map((kpi) => (
          <article key={kpi.label} className="kpi-card">
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <p>{kpi.note}</p>
          </article>
        ))}
      </section>

      <section className="pipeline-strip">
        {pipelineStages.map((stage, index) => (
          <div key={stage} className="pipeline-stage">
            <div className="pipeline-index">{index + 1}</div>
            <div>
              <h2>{stage}</h2>
              <p>{index < 3 ? 'Flowing' : index < 5 ? 'Under watch' : 'Controlled'}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel panel-wide">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Trend</p>
              <h2>Lead Time by Week</h2>
            </div>
            <span className="pill">-14% over 5 weeks</span>
          </div>
          <svg viewBox="0 0 560 220" className="trend-chart" role="img" aria-label="Lead time trend">
            <defs>
              <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(233,196,106,0.45)" />
                <stop offset="100%" stopColor="rgba(233,196,106,0)" />
              </linearGradient>
            </defs>
            <path d="M 20 200 H 540" className="chart-axis" />
            <path d="M 20 24 V 200" className="chart-axis" />
            <path d={leadTimePath} />
            <path d={leadTimeFillPath} fill="url(#lineFill)" opacity=".9" />
            {weeklyMetrics.map((entry, index) => {
              const x = 20 + (index / Math.max(1, weeklyMetrics.length - 1)) * 520;
              const y = 20 + 180 - ((entry.leadTimeHours - leadTimeMin) / leadTimeSpan) * 180;
              return (
                <g key={entry.week}>
                  <circle cx={x} cy={y} r="5.5" className="chart-dot" />
                  <text x={x} y="214" textAnchor="middle" className="chart-label">
                    {entry.week}
                  </text>
                </g>
              );
            })}
          </svg>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Pressure</p>
              <h2>Defects by Stage</h2>
            </div>
            <span className="pill warn">Integration leads</span>
          </div>
          <div className="bar-list">
            {stageDefectCounts.map((entry) => (
              <div key={entry.stage} className="bar-row">
                <span>{entry.stage}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: pct((entry.defects / 20) * 100) }} />
                </div>
                <strong>{entry.defects}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Ownership</p>
              <h2>Operational Load</h2>
            </div>
            <span className="pill ok">Balanced enough</span>
          </div>
          <div className="donut-wrap">
            <div
              className="donut"
              style={{
                background: `conic-gradient(#e9c46a 0 34%, #2a9d8f 34% 56%, #e76f51 56% 74%, #264653 74% 90%, #f4a261 90% 100%)`,
              }}
            />
            <ul className="legend">
              {ownershipLoad.map((entry) => (
                <li key={entry.name}>
                  <span>{entry.name}</span>
                  <strong>{entry.value}%</strong>
                </li>
              ))}
            </ul>
          </div>
        </article>
      </section>

      <section className="details-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Readiness</p>
              <h2>Service Watchlist</h2>
            </div>
          </div>
          <div className="risk-list">
            {componentRisks.map((risk) => (
              <div key={risk.service} className="risk-card">
                <div className="risk-head">
                  <h3>{risk.service}</h3>
                  <strong>{risk.readiness}%</strong>
                </div>
                <div className="risk-track">
                  <div className="risk-fill" style={{ width: pct(risk.readiness) }} />
                </div>
                <p>{risk.note}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Checklist</p>
              <h2>Fixture Expectations</h2>
            </div>
          </div>
          <ol className="checklist">
            {releaseChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </article>
      </section>
    </main>
  );
}
