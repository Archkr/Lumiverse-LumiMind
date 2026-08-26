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
