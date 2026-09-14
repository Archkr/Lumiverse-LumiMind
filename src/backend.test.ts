import { afterEach, describe, expect, it, vi } from "vitest";
import { addManualItem, createTimeline, DEFAULT_SETTINGS, materializeAnalysisRecords, rebuildTimeline, upsertActor } from "./engine";
import type { BackendToFrontend, ChatMessageLike, ChatTimelineV1, ControllerBatchTelemetry, FrontendToBackend } from "./types";

async function backend(timeline: ChatTimelineV1, transcript: ChatMessageLike[]) {
  vi.resetModules(); vi.useFakeTimers();
  let receive!: (message: FrontendToBackend, userId: string) => Promise<void>;
  let intercept!: (messages: unknown[], context: unknown) => Promise<unknown>;
  const stored = new Map<string, unknown>([["timelines/chat.json", structuredClone(timeline)], ["global/settings.json", { ...DEFAULT_SETTINGS, cortexImportEnabled: false }]]);
  const sent: BackendToFrontend[] = [];
  const permissions = new Set(["generation", "interceptor", "chat_mutation"]);
  const quiet = vi.fn().mockResolvedValue({ content: JSON.stringify({ actorMentions: [], changes: [] }) });
  const writes = vi.fn(async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); });
  vi.stubGlobal("spindle", {
    onFrontendMessage: (callback: typeof receive) => { receive = callback; },
    registerInterceptor: (callback: typeof intercept) => { intercept = callback; },
    on: vi.fn(() => () => {}), permissions: { has: (id: string) => permissions.has(id), onChanged: vi.fn() },
    rpcPool: { sync: vi.fn(), unregister: vi.fn() }, log: { info: vi.fn(), warn: vi.fn() },
    sendToFrontend: (message: BackendToFrontend) => sent.push(message),
    userStorage: { getJson: vi.fn(async (key: string, options: { fallback: unknown }) => structuredClone(stored.get(key) ?? options.fallback)), setJson: writes },
    chat: { getMessages: vi.fn(async () => structuredClone(transcript)) },
    connections: { get: vi.fn(async () => ({ provider: "test", model: "test-model" })), list: vi.fn(async () => []) },
    generate: { quiet },
    tokens: { countText: vi.fn(async (text: string) => ({ total_tokens: text.length, model: "test-model", tokenizer_name: "test", approximate: false })) },
  });
  await import("./backend");
  return { receive: (message: FrontendToBackend) => receive(message, "user"), intercept, stored, sent, permissions, quiet, writes };
}
function fixture() {
  const timeline = createTimeline("chat"); timeline.active = true; timeline.updateMode = "manual";
  const actor = upsertActor(timeline, { id: "character:mira", name: "Mira", kind: "character", characterId: "mira" });
  const messages: ChatMessageLike[] = [0, 1].map((i) => ({ id: `m${i}`, role: "assistant", content: `Mira waits ${i}.`, index_in_chat: i }));
  for (const message of messages) {
    const prefix = rebuildTimeline(timeline, messages).nextPrefix;
    timeline.records.push(...materializeAnalysisRecords(timeline, [message], prefix, {
      actorMentions: [{ ref: actor.id, name: "Mira", kind: "character", present: true, confidence: 1, messageId: message.id }], changes: [],
    }, { connectionId: null, model: null, provider: null, telemetry: { batchId: message.id, warningCodes: message.id === "m1" ? ["normalization_drop"] : [] } as unknown as ControllerBatchTelemetry }));
  }
  addManualItem(timeline, actor.id, "secret", "Keeps the observatory key.");
  rebuildTimeline(timeline, messages);
  return { timeline, messages };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("v0.3 backend flows", () => {
  it("captures the actual interceptor block and previews without writes or generation", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    await host.receive({ type: "ready", chatId: "chat", characterId: "mira" });
    const actual = await host.intercept(messages.map((message) => ({ ...message, __isChatHistory: true })), { chatId: "chat", characterId: "mira", connectionId: "main" }) as { messages: Array<{ content: string }> };
    await host.receive({ type: "injection_preview", chatId: "chat", requestId: "preview", targetActorId: "character:mira" });
    const response = host.sent.find((message) => message.type === "injection_preview_result");
    expect(response?.type).toBe("injection_preview_result");
    if (response?.type !== "injection_preview_result") return;
    expect(response.last?.content).toBe(actual.messages[0].content);
    expect(response.current.content).toBe(response.last?.content);
    expect(response.last?.selection.entries[0].text).toBe("Keeps the observatory key.");
    expect(host.quiet).not.toHaveBeenCalled(); expect(host.writes).not.toHaveBeenCalled();
    expect(JSON.stringify(host.sent.filter((message) => message.type === "state"))).not.toContain("lastInjections");
  });

  it("repairs only the suffix, bypasses manual scheduling once, and clears recovery data on success", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    await host.receive({ type: "repair_preview", chatId: "chat", requestId: "preview" });
    const response = host.sent.find((message) => message.type === "repair_preview_result");
    if (response?.type !== "repair_preview_result") throw new Error("Missing preview");
    expect(response.preview).toMatchObject({ startMessageIndex: 1, messageCount: 1 });
    expect(host.writes).not.toHaveBeenCalled();
    await host.receive({ type: "repair_analysis", chatId: "chat", requestId: "repair", ...response.preview });
    expect(host.sent.some((message) => message.type === "repair_started")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const saved = host.stored.get("timelines/chat.json") as ChatTimelineV1;
    expect(saved.records[0].id).toBe(timeline.records[0].id);
    expect(saved.records[1].id).not.toBe(timeline.records[1].id);
    expect(saved.repair).toBeNull(); expect(saved.updateMode).toBe("manual");
    expect(saved.minds["character:mira"].items[0].locked).toBe(true);
    expect(host.quiet).toHaveBeenCalledTimes(1);
    const prompt = host.quiet.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain('id="m1"');
  });

  it("keeps repair progress recoverable after request failure and accepts Retry", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    host.quiet.mockRejectedValueOnce(new Error("down"));
    await host.receive({ type: "repair_preview", chatId: "chat", requestId: "preview" });
    const response = host.sent.find((message) => message.type === "repair_preview_result");
    if (response?.type !== "repair_preview_result") throw new Error("Missing preview");
    await host.receive({ type: "repair_analysis", chatId: "chat", requestId: "repair", ...response.preview });
    await vi.advanceTimersByTimeAsync(1);
    const interrupted = host.stored.get("timelines/chat.json") as ChatTimelineV1;
    expect(interrupted.health).toBe("error"); expect(interrupted.repair?.backupRecords).toHaveLength(1);
    expect(interrupted.records).toHaveLength(1);
    await host.receive({ type: "retry", chatId: "chat" });
    const repaired = host.stored.get("timelines/chat.json") as ChatTimelineV1;
    expect(repaired.repair).toBeNull(); expect(repaired.records).toHaveLength(2);
  });

  it("discards an analysis result when a swipe changes while its request is running", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    host.quiet.mockImplementationOnce(async () => {
      messages[1].swipe_id = 1;
      messages[1].content = "Mira leaves instead.";
      return { content: JSON.stringify({ actorMentions: [{ ref: "obsolete", name: "Obsolete actor", kind: "npc", present: true, messageId: "m1" }], changes: [] }) };
    });
    await host.receive({ type: "repair_preview", chatId: "chat", requestId: "preview" });
    const response = host.sent.find((message) => message.type === "repair_preview_result");
    if (response?.type !== "repair_preview_result") throw new Error("Missing preview");
    await host.receive({ type: "repair_analysis", chatId: "chat", requestId: "repair", ...response.preview });
    await vi.advanceTimersByTimeAsync(10);
    const saved = host.stored.get("timelines/chat.json") as ChatTimelineV1;
    expect(Object.values(saved.actors).some((actor) => actor.canonicalName === "Obsolete actor")).toBe(false);
    expect(saved.records.find((record) => record.messageId === "m1")?.swipeId).toBe(1);
    expect(saved.repair).toBeNull();
    expect(host.quiet).toHaveBeenCalledTimes(2);
  });

  it("returns correlated permission errors without making test requests", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    host.permissions.delete("generation");
    await host.receive({ type: "test_controller", requestId: "test", target: { connectionId: "backup", model: null }, settings: DEFAULT_SETTINGS });
    expect(host.sent.at(-1)).toMatchObject({ type: "feature_error", requestId: "test", message: expect.stringContaining("permission") });
    expect(host.quiet).not.toHaveBeenCalled(); expect(host.writes).not.toHaveBeenCalled();
  });
});
