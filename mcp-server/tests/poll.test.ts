import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pollUntilDone } from "../src/poll.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pollUntilDone", () => {
  it("returns immediately when check() resolves done on first call", async () => {
    const check = vi.fn().mockResolvedValue({ done: true, value: "result" });

    const promise = pollUntilDone(check, 1000, 10_000);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe("result");
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("polls multiple times before resolving", async () => {
    let calls = 0;
    const check = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls >= 3) return { done: true, value: "done" };
      return { done: false };
    });

    const promise = pollUntilDone(check, 100, 10_000);

    // Advance time to trigger polls
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe("done");
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("throws after timeout", async () => {
    const check = vi.fn().mockResolvedValue({ done: false });

    const promise = pollUntilDone(check, 1000, 3000);

    // Catch the rejection before advancing timers to avoid unhandled rejection
    const rejection = expect(promise).rejects.toThrow(
      "Polling timed out after 3000ms"
    );

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(4000);

    await rejection;
  });

  it("uses default intervalMs and timeoutMs", async () => {
    const check = vi.fn().mockResolvedValue({ done: true, value: 42 });

    const promise = pollUntilDone(check);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe(42);
  });
});
