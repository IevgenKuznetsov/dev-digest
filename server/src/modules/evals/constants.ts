/** Concurrency limit for parallel eval case execution within a batch. */
export const EVAL_BATCH_CONCURRENCY = 2;

/** Max characters for input_diff field (~500KB for ASCII-dominant text). */
export const EVAL_MAX_DIFF_BYTES = 512_000;

/** Max length for eval case name. */
export const EVAL_CASE_NAME_MAX = 255;

/** Max length for eval case notes. */
export const EVAL_NOTES_MAX = 5000;
