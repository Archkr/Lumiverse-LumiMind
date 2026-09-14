import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapWithConcurrency,
  resetControllerRpmGatesForTests,
  waitForControllerRpmSlot,
} from "./controller-scheduling";

afterEach(() => {
  resetControllerRpmGatesForTests();
  vi.useRealTimers();
});

describe("controller scheduling", () => {
  it("runs independent work up to the configured concurrency and preserves result order", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 5, 15, 1], 2, async (delay, index) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return `result-${index}`;
    });

    expect(peak).toBe(2);
    expect(results).toEqual(["result-0", "result-1", "result-2", "result-3"]);
  });

  it("holds requests beyond the rolling RPM allowance", async () => {
    vi.useFakeTimers();
    const options = { userId: "user", provider: "openrouter", requestsPerMinute: 2, windowMs: 60 };
    await waitForControllerRpmSlot(options);
    await waitForControllerRpmSlot(options);
    let released = false;
    const third = waitForControllerRpmSlot(options).then(() => { released = true; });

    await vi.advanceTimersByTimeAsync(59);
    expect(released).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await third;
    expect(released).toBe(true);
  });

  it("does not throttle when RPM is zero", async () => {
    await Promise.all(Array.from({ length: 10 }, () => waitForControllerRpmSlot({
      userId: "user",
      provider: "openrouter",
      requestsPerMinute: 0,
    })));
  });
});

// A separate queue is shared by all controller operations, including tests.
describe("shared controller request slots", () => {
  it("bounds concurrent requests and lets cancelled waiters leave the queue", async () => {
    const { withControllerSlot } = await import("./controller-scheduling");
    let release!: () => void;
    const running = withControllerSlot("slot-user", 1, undefined, () => new Promise<void>((resolve) => { release = resolve; }));
    const abort = new AbortController();
    let calls = 0;
    const waiting = withControllerSlot("slot-user", 1, abort.signal, async () => { calls++; });
    const cancelled = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    abort.abort(); await cancelled;
    const next = withControllerSlot("slot-user", 1, undefined, async () => { calls++; });
    expect(calls).toBe(0);
    release(); await running; await next;
    expect(calls).toBe(1);
  });
});
