# Insights — @devdigest/reviewer-core

Non-obvious decisions, architectural traps, and things that look wrong but aren't.

## Output schema is NOT in the prompt

**What:** The `Review` JSON shape is enforced via `response_format: json_schema` (out-of-band), not prompt text.
**Why:** In `strict` mode the model cannot return anything outside the schema. Describing it in the prompt too creates two conflicting specs.
**Trap:** Adding "return JSON with fields: verdict, summary, score, findings[]" to an agent prompt makes the model produce garbage in unpinned fields.

## Model's score and verdict are not trusted

**What:** `scoreFromFindings()` recomputes the score from grounded findings. The model's self-reported `score` is discarded. Verdict is passed through but the CI gate (`ciFailOn`) is computed independently from severities.
**Why:** The score must always agree with the visible findings list. A model can return `score: 95` with three CRITICALs.
**Trap:** Using `review.score` from the model output breaks the score/findings/verdict invariant.

## parseWithRepair is not a raw retry

**What:** On structured-output parse failure, the engine appends the Zod error and a reprompt instruction to the message history, then re-calls the LLM.
**Why:** The model sees what went wrong and can fix it — much higher success rate than a blind retry.
**Trap:** Replacing it with a simple retry loop wastes tokens and has a lower fix rate.

## Full-file scanner kinds bypass line grounding

**What:** Findings with `kind` in `{secret_leak, lethal_trifecta, phantom, hook}` only need the file to exist in the diff — they skip the line-range intersection check.
**Why:** These come from whole-file analysis (linters, secret detectors), not diff-hunk analysis. Their line ranges don't map to diff hunks.
**Trap:** Removing the exception drops all secret-leak and phantom findings, even valid ones.

## Map-reduce requires both conditions

**What:** Auto strategy uses map-reduce only when the diff is BOTH > 400 lines AND multi-file.
**Why:** A single large file doesn't benefit from splitting — the model needs full context. Multi-file small diffs don't need the overhead.
**Trap:** Triggering map-reduce on line count alone splits single-file diffs and loses cross-reference context within the file.

## wrapUntrusted escapes closing delimiters

**What:** `wrapUntrusted()` replaces `</untrusted>` with `<\/untrusted>` in content before wrapping.
**Why:** Malicious diff content could inject `</untrusted>` to escape the data delimiter and inject instructions.
**Trap:** Removing the escape lets a PR author close the untrusted block and inject arbitrary prompt instructions.
