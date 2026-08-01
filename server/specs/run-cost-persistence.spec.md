# Run Cost Persistence

## Cost Calculation

`cost_usd` is computed as `tokensIn × inputPricePerToken + tokensOut × outputPricePerToken`
for the model used in the run.

- **OpenRouter**: uses `res.usage.cost` from the API response (actual cost);
  falls back to `PriceBook.estimate(model, tokensIn, tokensOut)`.
- **Anthropic / OpenAI**: uses `estimateCost(model, tokensIn, tokensOut)` from the
  static pricing table (`server/src/adapters/llm/pricing.ts`).
- **reviewer-core** aggregates per-chunk `costUsd` across all LLM calls in a run;
  if any chunk returns `null`, the whole run's cost is `null`.

## Persistence Rules

| Condition | `cost_usd` value |
|-----------|-----------------|
| Run completes successfully (`status = 'done'`) | `outcome.costUsd` (number or null) |
| Run fails (`status = 'failed'`) | `NULL` |
| Run cancelled (`status = 'cancelled'`) | `NULL` |
| Provider/model not in pricing table and didn't report cost | `NULL` |

## API Surface

### `GET /pulls/:id/runs` — Run history

Each `RunSummaryCost` object includes `cost_usd: number | null`.

### `GET /repos/:id/pulls` — PR list

Each `PrMetaCost` object includes `latest_cost_usd: number | null` —
the **sum** of `cost_usd` across all `done` runs for that PR
(a review typically involves multiple agents). `NULL` when no completed runs exist
or all runs have `NULL` cost.

### `RunTrace.stats`

New runs include `cost_usd` in the persisted trace stats.
Old traces (before this feature) lack the field — consumers treat missing as `null`.