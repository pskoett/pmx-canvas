---
name: data-analysis
description: Analytics synthesis with visualizations from engineering and product data sources
version: 0.1.0
author: pmx
tags: [analytics, data, charts, visualization, metrics]
tools: [dx-data-cloud, jira/linear, github, workiq]
inputs:
  - name: question
    description: The analysis question to answer (e.g. "How has PR cycle time changed over the last quarter?")
    required: true
  - name: data_sources
    description: Array of MCP server names to query for data
    required: false
    default: [dx-data-cloud]
  - name: format
    description: Output format for the analysis
    required: false
    default: markdown
    enum: [markdown, html]
  - name: include_charts
    description: Whether to include visual charts in the output
    required: false
    default: true
outputs:
  - name: analysis
    description: Data analysis with findings, tables, charts (if HTML), interpretation, and recommendations
---

# Data Analysis

Perform analytics synthesis across engineering and product data sources. Answer questions about trends, correlations, comparisons, and distributions by querying MCP servers, analyzing the data, and presenting findings with visualizations.

In `pmx-canvas`, prefer `canvas_add_graph_node` for charts and trend lines and
`canvas_add_json_render_node` when the analysis should land as a richer dashboard or table inside
the canvas.

## When to Use

- Answering quantitative questions about engineering performance, delivery, or team health
- Trend analysis: "How has X changed over time?"
- Correlation analysis: "Is there a relationship between X and Y?"
- Comparison analysis: "How does team A compare to team B?"
- Distribution analysis: "What is the breakdown of X by Y?"
- Preparing data-backed arguments for planning, retrospectives, or leadership updates
- Any request that starts with "analyze", "compare", "show me the trend", "what is the distribution"

## How It Works

### Step 1: Parse the Question

Analyze the user's question to determine:

1. **Analysis type**: trend, correlation, comparison, distribution, or summary
2. **Metrics needed**: What data points are required (cycle time, velocity, bug count, etc.)
3. **Time range**: What period to analyze (last quarter, last 4 sprints, this year, etc.)
4. **Grouping**: How to segment the data (by team, by sprint, by week, by component, etc.)
5. **Data sources**: Which MCP servers have the required data

If the question is ambiguous, ask clarifying questions before proceeding.

### Step 2: Pull Data

Query the relevant MCP servers:

#### DX Data Cloud (DX MCP `queryData` tool in current session)
Primary source for engineering metrics:
- DORA metrics (deployment frequency, lead time, change failure rate, MTTR)
- DX Index (DXI) survey results
- Cycle time breakdowns
- Throughput and flow metrics
- Team-level aggregations

Query using SQL against the DX Data Cloud PostgreSQL database. Tool prefixes vary by deployment (`dx-data-cloud` vs `dx-mcp`), so select the available DX `queryData` tool at runtime. Start with `information_schema` if unsure of available tables and columns.

#### Jira/Linear
Issue and sprint data:
- Sprint velocity over time
- Issue type distribution
- Bug rates and trends
- Epic completion rates
- Cycle time (issue-level)

#### GitHub
Code and collaboration data:
- PR cycle time (open to merge)
- PR size distribution
- Review turnaround time
- Merge frequency
- Contributor activity

#### WorkIQ
Collaboration and time data:
- Meeting hours per week
- Focus time trends
- Collaboration patterns
- Context switching indicators

### Step 3: Perform Analysis

Based on the analysis type identified in Step 1:

#### Trend Analysis
- Calculate the metric value for each time period (week, sprint, month)
- Compute week-over-week or period-over-period change
- Identify the overall trend direction (improving, declining, stable)
- Calculate the rate of change
- Identify inflection points or anomalies
- Project forward if asked ("at this rate, when will we reach X?")

#### Correlation Analysis
- Pull both metrics for the same time periods
- Calculate correlation coefficient (Pearson r)
- Interpret strength: |r| > 0.7 strong, 0.4-0.7 moderate, < 0.4 weak
- Note: correlation does not imply causation (always state this)
- Show a scatter plot description or data table

#### Comparison Analysis
- Pull the same metric for different groups (teams, sprints, projects)
- Calculate absolute and percentage differences
- Rank groups by performance
- Identify outliers (groups significantly above or below average)
- Apply statistical context (is the difference significant or within normal variation?)

#### Distribution Analysis
- Group data by the specified dimension
- Calculate counts and percentages for each group
- Identify the dominant category and any long tails
- Show as a table and describe what a pie/bar chart would look like

### Step 4: Generate Output

#### Markdown Format

```markdown
# Analysis: [Question Restated]

**Period**: [time range]
**Data Sources**: [list of sources queried]
**Generated**: [timestamp]

## Key Findings

1. [Finding 1 - the most important insight]
2. [Finding 2]
3. [Finding 3]

## Data

### [Metric Name] Over Time

| Period | Value | Change |
|--------|-------|--------|
| Week 1 | X     | -      |
| Week 2 | Y     | +Z%    |
| ...    | ...   | ...    |

### Summary Statistics

- Mean: X
- Median: Y
- Min: Z (period)
- Max: W (period)
- Standard Deviation: V

## Interpretation

[What the data means in plain language. Connect findings to
business context. Explain why the trends matter.]

## Recommendations

1. [Actionable recommendation based on the data]
2. [Another recommendation]

## Methodology

[Brief note on data sources, time ranges, and any caveats
about data quality or completeness]
```

#### HTML Format

Generate a self-contained HTML file with:

- **Chart.js visualizations**:
  - Line charts for trends
  - Bar charts for comparisons
  - Scatter plots for correlations
  - Pie/doughnut charts for distributions
- **Interactive features**: Hover tooltips, legend toggles
- **Data tables**: Below each chart with the raw numbers
- **Styled sections**: Clean typography, responsive layout
- **Print-friendly**: CSS media queries for clean printing

Include Chart.js via CDN link in the HTML head.

### Analysis Framework: Numbers First, Then Interpretation

Following the PMX vibe rules, always present data in this order:

1. **Numbers**: Show the raw data and calculations first
2. **Pattern**: Describe what the data shows (trend, correlation, distribution)
3. **Interpretation**: Explain what it means in context
4. **Recommendation**: Suggest action based on the findings

Never lead with interpretation. Let the numbers speak first.

## Examples

### Example 1: Trend Analysis
**Prompt**: "How has our PR cycle time changed over the last quarter?"

Expected behavior:
1. Query DX Data Cloud for PR cycle time, weekly, last 12 weeks
2. Calculate week-over-week changes
3. Identify overall trend (improving/declining)
4. Generate markdown with data table and findings
5. If HTML, include a line chart

Output includes:
- Weekly cycle time values
- Average, min, max
- Trend direction and rate of change
- Comparison to team goals if defined in context.md

### Example 2: Correlation Analysis
**Prompt**: "Analyze the correlation between meeting load and developer productivity"

Expected behavior:
1. Query WorkIQ for meeting hours per developer per week
2. Query DX Data Cloud or Jira for productivity proxy (throughput, cycle time, or velocity)
3. Align time periods
4. Calculate correlation coefficient
5. Present scatter data and interpretation
6. Note: "Correlation does not imply causation"

### Example 3: Comparison Analysis
**Prompt**: "Compare velocity across the last 4 sprints"

Expected behavior:
1. Query Jira/Linear for sprint velocity (story points completed) for last 4 sprints
2. Calculate average, identify best and worst sprints
3. Show sprint-over-sprint changes
4. Identify contributing factors (scope changes, team changes, holidays)
5. Present as comparison table and bar chart description

### Example 4: Distribution Analysis
**Prompt**: "What is the breakdown of issues by type this quarter?"

Expected behavior:
1. Query Jira/Linear for all issues created this quarter
2. Group by type (feature, bug, task, spike, etc.)
3. Calculate counts and percentages
4. Present as table and describe pie chart
5. Compare to previous quarter if useful

### Example 5: Multi-Source Analysis
**Prompt**: "Is there a relationship between our deployment frequency and bug reports?"

Expected behavior:
1. Query DX Data Cloud for deployment frequency (weekly)
2. Query Jira/Linear for bug count (weekly, created date)
3. Align time periods
4. Calculate correlation
5. Present findings with appropriate caveats

### Example 6: Team Health Dashboard
**Prompt**: "Give me an overview of engineering health metrics"

Expected behavior:
1. Pull DORA metrics from DX Data Cloud
2. Pull DXI from DX Data Cloud
3. Pull velocity from Jira/Linear
4. Pull meeting load from WorkIQ
5. Present dashboard-style summary with all metrics, trends, and RAG indicators

## Statistical Methods

### Trend Detection
- Calculate linear regression slope over the period
- Positive slope = improving (for metrics where higher is better)
- Negative slope = improving (for metrics where lower is better, like cycle time)
- Classify: strong improvement (>10% change), slight improvement (2-10%), stable (-2% to 2%), slight decline, strong decline

### Correlation
- Pearson correlation coefficient for linear relationships
- Report r value and interpretation
- Minimum 8 data points for meaningful correlation
- Always caveat: correlation is not causation

### Outlier Detection
- Values beyond 2 standard deviations from the mean
- Flag as anomalies with potential explanations (holidays, incidents, team changes)

### Comparison Significance
- For small sample sizes (< 10), note that differences may not be statistically significant
- Calculate percentage difference and absolute difference
- Provide context: "This is within/outside normal variation for this metric"

## Data Source Discovery

If unsure which tables or columns are available in DX Data Cloud, start with:

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

This helps discover the available data before writing analysis queries.

## Notes

- Always show numbers first, then interpretation (this is a core PMX principle)
- Include data freshness: when was the data last updated?
- If a data source is unavailable, note it and proceed with available sources
- For time series, use consistent time buckets (don't mix weekly and monthly)
- Always state the time range explicitly in findings
- Round numbers appropriately: percentages to 1 decimal, days to 1 decimal, counts as integers
- For HTML output, ensure the file is self-contained (inline CSS/JS, CDN for Chart.js)
- When comparing teams, be sensitive: focus on systemic factors, not individual blame
- If the data is insufficient to answer the question, say so rather than speculating
