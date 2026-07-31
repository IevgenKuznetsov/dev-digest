# Insights — @devdigest/e2e

Non-obvious decisions, architectural traps, and things that look wrong but aren't.

## Flows assume single-repo DB state

**What:** Redirect-based flows (01, 02, 04, 05) follow the home redirect to the first repo. They break if other repos exist.
**Why:** The app redirects `/` to the first repo's PR list. With multiple repos, "first" is unpredictable.
**Trap:** Running `npm test` against your dev DB (which has imported repos) fails on wrong-repo redirects. Always use `./scripts/e2e.sh`.

## No AI chat command — ever

**What:** Specs use only deterministic locators (`--url`, `--text`, `find role|text|label`). The agent-browser `chat` command is never used.
**Why:** `chat` calls an LLM, making flows non-deterministic, slow, and key-dependent.
**Trap:** Adding a `chat` step makes the flow require an API key, flake on model variance, and break CI.

## wait commands ARE the assertions

**What:** `wait --text "X"` / `wait --url "/path"` time out and exit non-zero if the condition never holds. There's no separate assertion library.
**Why:** agent-browser is a CLI, not a test framework. Exit codes are the only signal.
**Trap:** Adding a `find` step expecting it to "assert" doesn't fail on absence — it just returns empty. Use `wait` for assertions.
