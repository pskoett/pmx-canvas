# Eval: does curation change the work?

**Status:** ready to run; no runs scored yet. Written 2026-10-07, before the first run.
**Source:** [vision](../product-vision-2026-09.md#part-1-the-foundation) Part 1, item 4 (effect);
[plan 016](../plans/plan-016-context-made-visible-wave-1.md) slice 6.
**Fixture:** [`scripts/eval-curation/board.ts`](../../scripts/eval-curation/board.ts), guarded by
`tests/unit/eval-curation-board.test.ts`.

Everything below (board, task, rubric, decision rule) is fixed. Changing any of it after the
first scored run voids the comparison; start a new eval instead.

## The question

The same task, with the brief delivered, on a curated and an uncurated copy of the same board.
Does the curated board produce better work? With one real user this is a test case, not
statistics; real sessions only confirm or contradict it.

## The board

"Team tier pricing — Q4": 30 Markdown cards written over a quarter, oldest first. It holds early
research, a first decision (Team to $20, August) that a later one supersedes (Team to $24,
September), a finance ceiling ($25 until the Q2 billing migration), a churn readout, a competitor
price update (Rival to $29), and realistic distractors (roadmap, hiring, transcripts, glossary).

- **Curated:** the current decision, the finance ceiling, the churn readout and the competitor
  update are pinned (`PINNED_KEYS`), with the reason "what this task rests on".
- **Uncurated:** the same cards, order and layout, no pins.

The cards hold about 14,000 characters of text; with titles and the brief's own wrapping that
is more than one brief carries at the default budget of 16,000. The
fixture test checks what that means for delivery: at the default budget the curated brief
carries all four pinned cards, while the uncurated brief carries the superseded decision but
not the current decision or the finance ceiling. At full budget both carry every card and only
the pinned marking differs.

## Conditions

| Condition | Budget | What it tests |
|---|---|---|
| **Primary** | default (16,000) | Do pins decide which facts reach the agent at all? |
| **Secondary** | full (`budget=100000`) | With everything delivered, does marking what matters still change the work? |

Only the primary condition can change course (decision rule below). The secondary tells us
whether curation works beyond delivery.

## Protocol

1. **Scratch workspace.** Start a server on a scratch workspace or database, never your real
   boards: `PMX_CANVAS_DB_PATH=<scratch>/canvas.db pmx-canvas serve --daemon --port=<port>`.
2. **Seed.** `PMX_CANVAS_URL=http://127.0.0.1:<port> bun run scripts/eval-curation/seed.ts`.
   It prints both board ids and leaves Home open.
3. **One run** = open the board for the condition (`canvas_board open`), start a **fresh** agent
   session with PMX Canvas connected and no other context, and send `TASK_PROMPT` from
   `board.ts` verbatim. For the secondary condition append: "Read it with
   `canvas://context?budget=100000`." Save the final answer as `run-<random id>.md`, and note the
   id, board and condition in a separate key file.
4. **Delivery check, every run.** After the run, `canvas_ax_timeline { action: "read-status",
   board }` must show a brief read during the session. For curated runs the four pinned cards
   must be in it. A run without a confirmed brief read is a delivery failure: record it, do not
   score it, and fix the adapter rather than doubt the thesis.
5. **Runs.** Three per board per condition with the same host and model: 12 runs, primary
   first. Alternate curated and uncurated. Record host, model and date.
6. **Blind scoring.** Score the answer files in shuffled order without the key file, using the
   rubric below, then join scores to the key.

## Rubric (0–10 per run)

| # | Criterion | 2 | 1 | 0 |
|---|---|---|---|---|
| R1 | Current decision | Recommends $25 or less and identifies $24 (September) as the current decision | Recommends $25 or less without the current decision | Treats $20 as current, or recommends more than $25 for Q4 |
| R2 | Finance ceiling | States the $25 ceiling until the Q2 billing migration | Mentions a finance or billing limit vaguely | Absent |
| R3 | Churn evidence | Cites churn 2.2% vs 2.1% and the higher small-team churn | Cites one of the two | Absent or wrong |
| R4 | Competitor | Uses Rival at $29 | Uses the July $22 and flags it may be stale | Uses $22 as current, or absent |
| R5 | Small teams | Addresses teams under 10 seats (a separate price or plan) | Mentions small teams without a recommendation | Absent |

Penalties: **−2** for presenting the superseded $20 decision as current; **−2** for any number
stated as fact that is not on the board. The minimum score is 0.

## Decision rule (from the vision, set before any run)

Only a failure on effect changes course.

- **Curation wins** if, in the primary condition with delivery confirmed in every scored run,
  the curated mean is at least **2 points** above the uncurated mean. Then the brief becomes the
  product's headline and attention ranking moves forward.
- **Otherwise** the vision records that curation did not beat the uncurated board, stops
  investing in attention ranking and the brief beyond what already ships, and moves that effort
  to the human side (the wiki, sharing, tours).
- The secondary condition is reported alongside but cannot change course on its own.

## Results

| Run id | Board | Condition | Host / model | Date | Delivery confirmed | R1 | R2 | R3 | R4 | R5 | Penalty | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

Outcome: not yet run.
