/**
 * The fixed board for the curation-effect eval (docs/evals/curation-effect.md).
 *
 * A Team-tier pricing research board that grew over a quarter. Cards are listed
 * in the order they were written: early research and a first decision, then the
 * evidence and decision that superseded it. The curated and uncurated boards are
 * identical except that the curated one pins `PINNED_KEYS`.
 *
 * Do not edit after the first scored run: the eval is only comparable while the
 * board, the task and the rubric stay fixed.
 */

export interface EvalCard {
  key: string;
  title: string;
  content: string;
}

export const BOARD_NAME = 'Team tier pricing — Q4';

export const TASK_PROMPT =
  'Using the PMX Canvas board that is open, write a one-page recommendation for the Team tier ' +
  'monthly price per seat for Q4, with the reasoning and the evidence it rests on. Read ' +
  'canvas://context first. Do not ask me questions; if the board leaves something open, say so.';

export const CARDS: EvalCard[] = [
  {
    key: 'brief',
    title: 'Project brief: Team tier pricing',
    content: `# Project brief: Team tier pricing

We sell three tiers: Free, Team and Enterprise. Team is our volume tier and today costs
$18 per seat per month, unchanged since launch two years ago. Leadership asked for a
recommendation on the Team price for Q4. Scope: the list price per seat per month for
new and renewing Team customers. Out of scope: Enterprise contracts, annual-prepay
discounts, the Free tier limits and regional pricing, which are handled by separate
workstreams. Owner: product (pricing working group). Inputs: market research, customer
interviews, churn and expansion data from billing, and finance's constraints.`,
  },
  {
    key: 'market-1',
    title: 'Market scan: collaboration tools (July)',
    content: `# Market scan: collaboration tools (July)

Twelve tools in the adjacent category, list price per seat per month for the closest
equivalent of our Team tier: median $21, range $12–$32. Tools that bundle admin
controls and SSO into the mid tier cluster at the top ($24–$32). Tools without SSO sit
at $12–$19. Most competitors raised prices once in the last 18 months, by 10–25%.
Annual-prepay discounts are 15–20% almost everywhere. Caveat: list prices only; we have
no visibility into negotiated discounts.`,
  },
  {
    key: 'competitors-old',
    title: 'Competitor price list (July)',
    content: `# Competitor price list (July)

- Rival: $22 per seat, includes SSO.
- Brightdesk: $19 per seat, SSO only on enterprise.
- Loomwork: $16 per seat, no admin console.
- Northstar: $25 per seat, SSO and audit log.
Source: public pricing pages, captured 14 July. Rival is the competitor our sales team
meets most often in Team-tier deals (about 60% of competitive deals).`,
  },
  {
    key: 'interviews-1',
    title: 'Customer interviews: admins (round 1)',
    content: `# Customer interviews: admins (round 1)

Eight interviews with workspace admins on Team. Themes: SSO is the most requested
feature that we already ship on Team and competitors gate higher; admins say it
"justifies the line item" when finance asks. Price was raised unprompted by two of
eight, both small teams (under 10 seats) who compared us to Loomwork. Nobody mentioned
annual billing. Three admins asked for an audit log, which we do not have on Team.`,
  },
  {
    key: 'decision-old',
    title: 'Decision: Team tier to $20 (August)',
    content: `# Decision: Team tier to $20 (August)

Status: decided, 21 August. We will raise Team from $18 to $20 per seat per month from
the next billing cycle. Reasoning: the July market median is $21, interviews show SSO
carries the tier, and a modest raise keeps us under Rival ($22). Owner: pricing working
group. Review: after the price test reports churn and expansion numbers.`,
  },
  {
    key: 'roadmap',
    title: 'Roadmap note: Q4 feature themes',
    content: `# Roadmap note: Q4 feature themes

Q4 engineering themes: (1) audit log for Team, (2) faster search across large
workspaces, (3) a rebuilt mobile editor, (4) usage analytics for admins. The audit log
is the only one with a pricing angle: it closes the gap with Northstar. Mobile and
search are retention bets for all tiers. Timing: audit log beta in November, general
availability early Q1. None of this changes the Free tier.`,
  },
  {
    key: 'hiring',
    title: 'Hiring plan: growth team',
    content: `# Hiring plan: growth team

Two open roles for the growth team: a lifecycle marketer and a pricing analyst. The
pricing analyst would own the billing data model and run future price tests, which
today the PM runs by hand with a data engineer. Interviews start in October; expected
start dates are December at the earliest, so neither role affects the Q4 decision.`,
  },
  {
    key: 'infra',
    title: 'Infrastructure cost per seat',
    content: `# Infrastructure cost per seat

Average infrastructure cost per active Team seat is $2.10 per month, up from $1.80 a
year ago, mostly storage growth from large file uploads. Search indexing is the fastest
growing line. Gross margin on Team is healthy at any price above $12. Infra cost does
not constrain the Q4 price; it matters for the Free tier limits workstream.`,
  },
  {
    key: 'support',
    title: 'Support ticket themes (Q3)',
    content: `# Support ticket themes (Q3)

Top Team-tier ticket themes in Q3: SSO configuration (31%), seat management and
invoices (22%), mobile sync (18%), search slowness on large workspaces (12%), other
(17%). Billing questions spiked in the week after the August price change notice, then
returned to baseline within ten days. No increase in cancellation requests mentioning
price in the ticket text.`,
  },
  {
    key: 'interviews-2',
    title: 'Customer interviews: finance buyers',
    content: `# Customer interviews: finance buyers

Six interviews with the finance contact at Team customers (20–200 seats). They compare
per-seat price against the tools we replace, not against direct competitors. Four of
six said a price under $25 per seat "does not need a second approval" in their
procurement process; above $25 it goes to a budget owner. Two wanted annual invoicing.`,
  },
  {
    key: 'experiments',
    title: 'Experiment backlog',
    content: `# Experiment backlog

Ideas not yet run: (1) show the per-seat price with the annual discount by default on
the pricing page, (2) a 14-day Team trial instead of 7, (3) seat-based volume tiers
above 50 seats, (4) a cheaper "Team Lite" without SSO. None is scheduled for Q4; the
pricing working group parked them until the Q4 price is settled.`,
  },
  {
    key: 'meeting-1',
    title: 'Working group notes (September 4)',
    content: `# Working group notes (September 4)

Attendees: PM, finance partner, sales lead, data engineer. Sales reports Rival is
discounting harder in deals above 50 seats. Finance flagged that the billing system
migration runs into Q2 and limits how prices can change before then. Data engineer
confirmed the $20 price test cohort is large enough to read by late September. Actions:
data engineer to publish the churn readout; finance to write down the billing limits.`,
  },
  {
    key: 'positioning',
    title: 'Positioning draft',
    content: `# Positioning draft

Team is "the plan your admin can defend": SSO, admin console and invoices from day one.
We should not position on being cheapest; Loomwork owns that. Messaging tests on the
pricing page favoured "everything your admin needs" over "best value" by a wide margin.
Open question: whether the audit log ships in time to be part of the Q4 story.`,
  },
  {
    key: 'glossary',
    title: 'Glossary: billing terms',
    content: `# Glossary: billing terms

Seat: a paid member of a workspace. Active seat: a seat used in the last 28 days.
Churn: share of paying workspaces that cancel in a month. Contraction: seats removed
by workspaces that stay. Expansion: seats added. Net revenue retention (NRR): revenue
from a cohort a year later divided by its starting revenue, including expansion,
contraction and churn.`,
  },
  {
    key: 'mobile',
    title: 'Mobile editor research',
    content: `# Mobile editor research

Usability tests with nine Team users on the current mobile editor: seven could not
find comment threads, five lost edits when switching apps. The rebuild is planned for
Q4. Mobile usage is 14% of sessions on Team, higher (22%) on Free. No pricing
implications identified; included here because admins mentioned mobile in interviews.`,
  },
  {
    key: 'sales-1',
    title: 'Sales feedback: objections (Q3)',
    content: `# Sales feedback: objections (Q3)

Most frequent objections in Team-tier deals during Q3: missing audit log (raised in 9
deals), price compared with Loomwork (6 deals, all under 15 seats), annual invoicing
(5 deals). Win rate against Rival was 46% in Q3, roughly flat on Q2. Sales believes the
August raise had no visible effect on win rate.`,
  },
  {
    key: 'okr',
    title: 'Q4 OKRs (draft)',
    content: `# Q4 OKRs (draft)

O1: Grow Team-tier revenue. KR1: Team ARR +12% quarter on quarter. KR2: net revenue
retention on Team at or above 104%. KR3: ship the audit log beta. O2: Make admins
successful. KR1: SSO setup completion above 80%. KR2: halve the SSO configuration
ticket share. The pricing decision feeds O1 KR1 directly.`,
  },
  {
    key: 'transcript-1',
    title: 'Interview transcript excerpt: admin at a 60-seat agency',
    content: `# Interview transcript excerpt: admin at a 60-seat agency

"We moved from Loomwork last spring because we needed SSO for a client audit. Loomwork
was cheaper but it was a spreadsheet of passwords. When the price went to $20 I had to
explain it to our COO, and I just said: it's the SSO and the admin console, and we'd
pay more for the audit log. Honestly the bigger pain is invoices: our accounts team
wants one invoice a year, not twelve. Search is slow on our big workspace, the client
folders have thousands of files. If you shipped the audit log I'd stop looking at
Northstar. Mobile I don't care about, my people are on laptops. What would make me
leave? If SSO broke during an audit, or if the price jumped past what I can approve
myself without going to the COO again."
Interviewer note: price sensitivity is about approval thresholds, not the amount.`,
  },
  {
    key: 'transcript-2',
    title: 'Interview transcript excerpt: founder of an 8-seat studio',
    content: `# Interview transcript excerpt: founder of an 8-seat studio

"Eight people, everyone on Team. Twenty dollars a seat is fine but it's not nothing for
us; I looked at Loomwork again after the email. We don't use SSO, we're too small, so
honestly most of what makes Team expensive isn't for us. I'd love a cheaper plan
without the admin stuff. We'd stay if you gave small teams a break, maybe a lite
plan. The editor is great, that's why we're here. If it went much higher I'd probably
move the team to Free and live with the limits, or switch."
Interviewer note: matches the small-team churn worry; small teams value the editor, not
the admin features that justify the price for larger teams.`,
  },
  {
    key: 'feature-matrix',
    title: 'Competitor feature matrix (mid tier)',
    content: `# Competitor feature matrix (mid tier)

| Feature | Us (Team) | Rival | Brightdesk | Loomwork | Northstar |
| SSO | yes | yes | enterprise only | no | yes |
| Admin console | yes | yes | yes | no | yes |
| Audit log | no (Q4 beta) | enterprise only | no | no | yes |
| Annual invoicing | no | yes | yes | no | yes |
| Guest access | yes | yes | paid add-on | yes | yes |
| Version history | 90 days | 30 days | 30 days | 7 days | 1 year |
| API rate limits | standard | standard | low | low | high |
| Data residency | EU, US | US | US | US | EU, US, APAC |
Source: public docs and sales call notes, August. Gaps that come up in deals: audit log
and annual invoicing.`,
  },
  {
    key: 'meeting-aug',
    title: 'Working group notes (August 12)',
    content: `# Working group notes (August 12)

Attendees: PM, finance partner, sales lead, design. Agenda: the August price change.
Discussion: sales asked for a grandfathering period for customers in active
negotiations; agreed for deals signed before 1 September. Design showed the notice
email and the pricing page update; copy approved with one change (lead with SSO).
Finance asked that the price test keep a holdout cohort at the old price so the churn
effect can be measured; data engineering to set it up (1,000 workspaces). Risks noted:
small teams may react more strongly; Loomwork may run a switching campaign. Decision
recorded separately (Team to $20). Next meeting after the churn readout.`,
  },
  {
    key: 'nps',
    title: 'NPS verbatims (Team tier, August survey)',
    content: `# NPS verbatims (Team tier, August survey)

Score: 41 (down from 43 in May, within noise). Promoters mention the editor, SSO and
reliability. Detractors mention search speed on large workspaces, mobile sync, and the
lack of annual invoicing. Price mentioned in 4% of verbatims, about the same as in
May; most price mentions are from workspaces under 10 seats. Sample verbatims: "SSO
setup took ten minutes, our IT lead was impressed"; "search is unusable on our main
workspace"; "please let finance pay once a year"; "too pricey for a tiny team".`,
  },
  {
    key: 'billing-dictionary',
    title: 'Billing data dictionary (excerpt)',
    content: `# Billing data dictionary (excerpt)

workspace_id: the paying unit. plan: free, team or enterprise. seats_billed: seats on
the invoice at period start. seats_active_28d: seats with activity in the last 28 days.
price_per_seat: list price at period start, after grandfathering. cohort: price test
assignment (holdout_18, test_20, none). churned_at: date of cancellation, null if
active. Notes: churn in dashboards is workspace churn, not seat churn; seat contraction
is reported separately. The holdout cohort was frozen on 15 August and is excluded
from all pricing page experiments.`,
  },
  {
    key: 'analyst-note',
    title: 'Analyst note: SaaS pricing trends 2026',
    content: `# Analyst note: SaaS pricing trends 2026

Summary of an industry analyst report shared by finance. Mid-tier collaboration prices
rose about 12% on average over the last year, driven by bundling security features
(SSO, audit) into mid tiers. Buyers increasingly anchor on approval thresholds set by
procurement policies, commonly $20 or $25 per seat. Vendors that raised prices with
clear security value saw little churn; those that raised without new value saw
contraction in small accounts. The report recommends separating small-team plans from
the main mid tier rather than discounting the whole tier.`,
  },
  {
    key: 'pricing-copy',
    title: 'Pricing page copy drafts',
    content: `# Pricing page copy drafts

Headline options for the Team column: (A) "Everything your admin needs", (B) "Built
for growing teams", (C) "Security without the enterprise contract". Test results from
August: A beat B by 18% on click-through to checkout, C was not tested. Supporting
bullets: SSO and admin console included; invoices and seat management; 90-day version
history; priority support. Footnote draft for the change notice: "Prices change on your
next renewal after 30 days' notice." Design wants to drop the per-month framing for an
annual-first layout, parked until annual invoicing exists.`,
  },
  {
    key: 'churn',
    title: 'Churn readout: $20 price test (September)',
    content: `# Churn readout: $20 price test (September)

Cohort: 4,100 Team workspaces moved to $20 in August vs a holdout of 1,000 at $18.
Monthly churn: 2.2% at $20 vs 2.1% at $18, within noise. Contraction unchanged.
Expansion slightly higher at $20 (admins adding seats after SSO rollout). Small teams
under 10 seats churned more at $20 (3.4% vs 2.6%), larger teams did not. Conclusion:
Team demand is price-insensitive in this range for teams of 10+ seats.`,
  },
  {
    key: 'competitors-new',
    title: 'Competitor update: Rival raised to $29 (September)',
    content: `# Competitor update: Rival raised to $29 (September)

Rival raised its Team-equivalent price from $22 to $29 per seat on 18 September and
moved SSO to the new price. Northstar is unchanged at $25; Brightdesk at $19; Loomwork
at $16. With Rival at $29 our price sits well below the competitor we meet most often,
even after a further raise.`,
  },
  {
    key: 'finance-constraint',
    title: 'Finance constraint: price ceiling until billing migration',
    content: `# Finance constraint: price ceiling until billing migration

From finance, 26 September. Until the billing system migration completes in Q2, the
Team list price cannot exceed $25 per seat per month: the legacy system's plan
catalogue cannot represent higher Team prices without manual invoicing. Any change also
needs 30 days' notice to existing customers. Above $25 is possible from Q2.`,
  },
  {
    key: 'decision-new',
    title: 'Decision: Team tier to $24 (supersedes August decision)',
    content: `# Decision: Team tier to $24 (supersedes August decision)

Status: decided, 30 September. This supersedes the 21 August decision to price Team at
$20. We will move Team to $24 per seat per month for Q4, with 30 days' notice, keeping
$20 for workspaces under 10 seats for one more quarter. Reasoning: churn did not move at
$20 for teams of 10+, Rival is now at $29, and finance caps the price at $25 until the
billing migration. Owner: pricing working group.`,
  },
  {
    key: 'retro',
    title: 'Pricing page retro notes',
    content: `# Pricing page retro notes

What went well with the August change: notice emails were clear and billing tickets
returned to baseline within ten days. What to improve: the pricing page still showed
$18 for two days after the change because of a cache, and the FAQ did not explain the
SSO value. Actions: add a price-change checklist; owner design and web team.`,
  },
];

/** What a human who knows the board would pin for this task. */
export const PINNED_KEYS = ['decision-new', 'finance-constraint', 'churn', 'competitors-new'];

/** Cards the eval's checks rely on. */
export const KEY_CARDS = {
  current: 'decision-new',
  superseded: 'decision-old',
  constraint: 'finance-constraint',
  churn: 'churn',
  competitor: 'competitors-new',
} as const;

/** Grid position for card `index` (4 columns, reading order follows creation order). */
export function cardPosition(index: number): { x: number; y: number } {
  return { x: (index % 4) * 460, y: Math.floor(index / 4) * 420 };
}

export const CARD_SIZE = { width: 420, height: 380 };
