export const CONTROLLER_LOOKUP_TIMEOUT_MS = 15_000;

export class ControllerRequestTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds. Retry or choose another controller connection.`);
    this.name = "ControllerRequestTimeoutError";
  }
}

/** Release local work even when the host/provider never acknowledges cancellation. */
export function controllerRequest<T>(
  run: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  label = "The controller request",
): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  const request = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
      request.abort(error);
    };
    const cancel = () => fail(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => fail(new ControllerRequestTimeoutError(label, timeoutMs)), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    Promise.resolve().then(() => {
      request.signal.throwIfAborted();
      return run(request.signal);
    }).then((value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }, fail);
  });
}
