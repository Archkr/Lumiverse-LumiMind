const DEFAULT_WINDOW_MS = 60_000;
const STALE_GATE_TTL_MS = 10 * 60_000;

interface RpmGateState {
  timestamps: number[];
  tail: Promise<void>;
  lastTouchedAt: number;
}

const rpmGates = new Map<string, RpmGateState>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("Aborted", "AbortError");
}

function pruneExpired(timestamps: number[], now: number, windowMs: number): void {
  while (timestamps.length > 0 && now - timestamps[0] >= windowMs) timestamps.shift();
}

function startSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, gate] of rpmGates) {
      pruneExpired(gate.timestamps, now, DEFAULT_WINDOW_MS);
      if (gate.timestamps.length === 0 && now - gate.lastTouchedAt > STALE_GATE_TTL_MS) rpmGates.delete(key);
    }
  }, DEFAULT_WINDOW_MS);
  if (typeof (sweepTimer as { unref?: () => void }).unref === "function") {
    (sweepTimer as { unref: () => void }).unref();
  }
}

function gateFor(key: string): RpmGateState {
  const existing = rpmGates.get(key);
  if (existing) return existing;
  const created: RpmGateState = {
    timestamps: [],
    tail: Promise.resolve(),
    lastTouchedAt: Date.now(),
  };
  rpmGates.set(key, created);
  startSweep();
  return created;
}

function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Reserve one controller request in a rolling RPM window. Reservations are
 * shared by user and provider so separate chats cannot accidentally exceed the
 * same upstream account's configured allowance.
 */
export async function waitForControllerRpmSlot(options: {
  userId: string;
  provider: string | null;
  requestsPerMinute: number;
  signal?: AbortSignal;
  windowMs?: number;
}): Promise<void> {
  const requestsPerMinute = Number.isFinite(options.requestsPerMinute)
    ? Math.max(0, Math.floor(options.requestsPerMinute))
    : 0;
  if (requestsPerMinute === 0) return;

  const windowMs = Math.max(1, Math.floor(options.windowMs ?? DEFAULT_WINDOW_MS));
  const key = `${options.userId}:${options.provider?.trim().toLocaleLowerCase() || "active"}`;
  const gate = gateFor(key);
  let release!: () => void;
  const previous = gate.tail;
  gate.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;

  try {
    while (true) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      const now = Date.now();
      pruneExpired(gate.timestamps, now, windowMs);
      if (gate.timestamps.length < requestsPerMinute) {
        gate.timestamps.push(now);
        gate.lastTouchedAt = now;
        return;
      }
      await waitForDelay(Math.max(1, windowMs - (now - gate.timestamps[0])), options.signal);
    }
  } finally {
    gate.lastTouchedAt = Date.now();
    release();
  }
}

/** Run independent work with a bounded number of in-flight promises. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  const requestedWorkers = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const workerCount = Math.min(items.length, Math.max(1, requestedWorkers));
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function resetControllerRpmGatesForTests(): void {
  rpmGates.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

const requestSlots = new Map<string, { running: number; waiters: Set<() => void> }>();

/** Share the request limit across analysis, maintenance, and connection tests. */
export async function withControllerSlot<T>(userId: string, limit: number, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  let state = requestSlots.get(userId);
  if (!state) {
    state = { running: 0, waiters: new Set() };
    requestSlots.set(userId, state);
  }
  const maximum = Math.max(1, Math.min(20, Math.floor(limit) || 1));
  while (state.running >= maximum) {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const wake = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(abortReason(signal)); };
      const cleanup = () => { state!.waiters.delete(wake); signal?.removeEventListener("abort", abort); };
      state!.waiters.add(wake);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  signal?.throwIfAborted();
  state.running += 1;
  try { return await run(); }
  finally {
    state.running -= 1;
    for (const wake of [...state.waiters]) wake();

  }
}
