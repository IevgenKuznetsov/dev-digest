# @devdigest/e2e

Deterministic browser e2e using agent-browser CLI. No Playwright, no LLM, no API key.

## Tech stack

agent-browser (Rust + CDP), TypeScript runner. No test framework — exit codes are assertions.

## Commands

```sh
# Hermetic (recommended — isolated ports, fresh DB):
./scripts/e2e.sh

# Against running dev stack (only if DB has ONLY seeded data):
cd e2e && npm test
```

## Conventions

- Flows target read-only seeded data only (acme/payments-api, PR #482). No model calls.
- Locators: `--url`, `--text`, `find role|text|label` only. Never the AI `chat` command.
- `{BASE}` in specs is replaced with `E2E_BASE_URL` at runtime.
- `wait --text` / `wait --url` ARE the assertions (timeout = failure).

## Gotchas

- Flows assume the seeded demo repo is the ONLY repo. Running against a dev DB
  with other imported repos makes redirect-based flows land on the wrong repo.
- Never `docker compose down -v` to "reset" for e2e — it destroys your dev data.
  Use `./scripts/e2e.sh` which runs on isolated ports.

## Do not touch

- `agent-browser.json` — CLI config referenced by the runner.
