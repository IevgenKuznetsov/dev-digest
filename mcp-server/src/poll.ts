export interface PollResult<T> {
  done: boolean;
  value?: T;
}

export async function pollUntilDone<T>(
  check: () => Promise<PollResult<T>>,
  intervalMs: number = 3000,
  timeoutMs: number = 300_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await check();
    if (result.done) {
      return result.value as T;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    await sleep(Math.min(intervalMs, remaining));
  }

  throw new Error(`Polling timed out after ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
