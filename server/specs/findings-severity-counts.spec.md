# Findings Severity Counts — PR List API

Per-severity finding counts surfaced on the PR list endpoint so the
client can render compact severity badges without fetching full reviews.

## Aggregation

For each PR, count findings grouped by `severity` across all reviews
linked to that PR. The query joins `reviews` (filtered to
`kind = 'review'`) with `findings` on `review_id`, then groups by
`pr_id` and `severity`.

All findings are counted regardless of `accepted_at` / `dismissed_at`
state — the client handles visual muting.

## API Surface

### `GET /repos/:id/pulls`

Response type changes from `PrMetaCost[]` to `PrMetaFindings[]`.

Each `PrMetaFindings` object extends `PrMetaCost` with:

| Field              | Type               | Description                      |
|--------------------|--------------------|----------------------------------|
| `critical_count`   | `number \| null`   | Count of CRITICAL findings       |
| `warning_count`    | `number \| null`   | Count of WARNING findings        |
| `suggestion_count` | `number \| null`   | Count of SUGGESTION findings     |

All three fields are `null` when the PR has no reviews.
All three are `0` when reviews exist but produced no findings.

## Shared Contract

New file: `vendor/shared/contracts/findings-counts.ts`

```ts
PrMetaFindings = PrMetaCost.extend({
  critical_count: z.number().int().nullish(),
  warning_count: z.number().int().nullish(),
  suggestion_count: z.number().int().nullish(),
});
```

Follows the extend-only pattern established by `run-cost.ts`.
