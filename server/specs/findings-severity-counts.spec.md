# Findings Severity Counts — PR List API

Per-severity finding counts and finding previews surfaced on the PR list
endpoint so the client can render compact severity badges with hover
tooltips without fetching full reviews.

## Aggregation

For each PR, fetch all findings across all reviews linked to that PR.
The query joins `reviews` (filtered to `kind = 'review'`) with
`findings` on `review_id`, selecting all finding fields.

From the fetched rows, both per-severity counts and the full
`findings_preview` array are derived in a single pass.

All findings are included regardless of `accepted_at` / `dismissed_at`
state — the client handles visual muting.

## API Surface

### `GET /repos/:id/pulls`

Response type changes from `PrMetaCost[]` to `PrMetaFindings[]`.

Each `PrMetaFindings` object extends `PrMetaCost` with:

| Field               | Type                    | Description                       |
|---------------------|-------------------------|-----------------------------------|
| `critical_count`    | `number \| null`        | Count of CRITICAL findings        |
| `warning_count`     | `number \| null`        | Count of WARNING findings         |
| `suggestion_count`  | `number \| null`        | Count of SUGGESTION findings      |
| `findings_preview`  | `FindingRecord[] \| null` | All findings for tooltip display |

All fields are `null` when the PR has no reviews.
Counts are `0` when reviews exist but produced no findings (with
`findings_preview` as an empty array).

## Shared Contract

New file: `vendor/shared/contracts/findings-counts.ts`

```ts
PrMetaFindings = PrMetaCost.extend({
  critical_count: z.number().int().nullish(),
  warning_count: z.number().int().nullish(),
  suggestion_count: z.number().int().nullish(),
  findings_preview: z.array(FindingRecord).nullish(),
});
```

Follows the extend-only pattern established by `run-cost.ts`.
