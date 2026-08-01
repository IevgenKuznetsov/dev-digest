# Run Cost Badge

## `formatCost` Formatting Rules

| Input | Output | Rule |
|-------|--------|------|
| `null` / `undefined` | `–` (en-dash) | No cost data available |
| `0.001` | `$0.0010` | 4 decimal places when < $0.01 |
| `0.06` | `$0.060` | 3 decimal places when $0.01–$0.99 |
| `1.23` | `$1.23` | 2 decimal places when ≥ $1.00 |

## Display Surfaces

### 1. PR List — COST column

- Position: after SCORE, before STATUS
- Content: `formatCost(pr.latest_cost_usd)` — compact form (e.g. `$0.0013`)
- Old PRs / PRs without runs show `–`

### 2. PR Detail Timeline — Token + cost per run

- Position: right-aligned on each settled run row, below the timestamp
- Format: `{totalTokens} tok · {cost}` (e.g. `9,119 tok · $0.0013`)
- `totalTokens` = `tokens_in + tokens_out`, formatted with locale separators
- Cost portion omitted when `cost_usd` is `null`
- Running / failed / cancelled runs show nothing

### 3. Run Trace Drawer — COST stat card

- Position: between TOKENS and FINDINGS stat cards
- Label: `COST`
- Value: `formatCost(stats.cost_usd)`
- Old traces without `cost_usd` in stats show `–`