import { afterEach, expect, it, vi } from "vitest";
import { controllerRequest } from "./controller-requests";

afterEach(() => vi.useRealTimers());

it("times out locally, aborts the host request, and consumes a late rejection", async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  let signal!: AbortSignal;
  const pending = controllerRequest((requestSignal) => {
    signal = requestSignal;
    return new Promise((_, reject) => { fail = reject; });
  }, undefined, 15_000);
  const rejected = expect(pending).rejects.toThrow("timed out after 15 seconds");
  await vi.advanceTimersByTimeAsync(15_000);
  await rejected;
  expect(signal.aborted).toBe(true);
  fail(new Error("Host eventually acknowledged cancellation"));
  await vi.advanceTimersByTimeAsync(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the timeout and abort listener after a successful response", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let signal!: AbortSignal;
  await expect(controllerRequest(async (requestSignal) => {
    signal = requestSignal;
    return "result";
  }, controller.signal, 15_000)).resolves.toBe("result");
  expect(vi.getTimerCount()).toBe(0);
  controller.abort();
  expect(signal.aborted).toBe(false);
});

it("does not start host work when cancellation occurs before dispatch", async () => {
  const controller = new AbortController();
  const run = vi.fn();
  const pending = controllerRequest(run, controller.signal, 15_000);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(run).not.toHaveBeenCalled();
});
