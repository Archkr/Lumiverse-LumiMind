import { afterEach, describe, expect, it, vi } from "vitest";
import { addManualItem, createTimeline, DEFAULT_SETTINGS, materializeAnalysisRecords, rebuildTimeline, upsertActor } from "./engine";
import type { BackendToFrontend, ChatMessageLike, ChatTimelineV1, ControllerBatchTelemetry, FrontendToBackend, LumiMindSettings } from "./types";

async function backend(timeline: ChatTimelineV1, transcript: ChatMessageLike[], settings: Partial<LumiMindSettings> = {}) {
  vi.resetModules(); vi.useFakeTimers();
  let receive!: (message: FrontendToBackend, userId: string) => Promise<void>;
  let intercept!: (messages: unknown[], context: unknown) => Promise<unknown>;
  const stored = new Map<string, unknown>([["timelines/chat.json", structuredClone(timeline)], ["global/settings.json", { ...DEFAULT_SETTINGS, cortexImportEnabled: false, ...settings }]]);
  const sent: BackendToFrontend[] = [];
  const permissions = new Set(["generation", "interceptor", "chat_mutation"]);
  const quiet = vi.fn().mockResolvedValue({ content: JSON.stringify({ actorMentions: [], changes: [] }) });
  const writes = vi.fn(async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); });
  const connections = {
    get: vi.fn(async (_id: string): Promise<{ provider: string; model: string } | null> => ({ provider: "openrouter", model: "test-model" })),
    list: vi.fn(async () => [{ id: "default", provider: "openrouter", model: "test-model", is_default: true }]),
  };
  const chatMetadata: Record<string, unknown> = {};
  vi.stubGlobal("spindle", {
    onFrontendMessage: (callback: typeof receive) => { receive = callback; },
    registerInterceptor: (callback: typeof intercept) => { intercept = callback; },
    on: vi.fn(() => () => {}), permissions: { has: (id: string) => permissions.has(id), onChanged: vi.fn() },
    rpcPool: { sync: vi.fn(), unregister: vi.fn() }, log: { info: vi.fn(), warn: vi.fn() },
    sendToFrontend: (message: BackendToFrontend) => sent.push(message),
    userStorage: { getJson: vi.fn(async (key: string, options: { fallback: unknown }) => structuredClone(stored.get(key) ?? options.fallback)), setJson: writes },
    chat: { getMessages: vi.fn(async () => structuredClone(transcript)) },
    chats: { get: vi.fn(async () => ({ id: "chat", metadata: chatMetadata })) },
    characters: { get: vi.fn(async () => ({ id: "mira", name: "Mira", description: "A patient scout." })) },
    connections,
    generate: { quiet },
    tokens: { countText: vi.fn(async (text: string) => ({ total_tokens: text.length, model: "test-model", tokenizer_name: "test", approximate: false })) },
  });
  await import("./backend");
  return { receive: (message: FrontendToBackend, userId = "user") => receive(message, userId), intercept, stored, sent, permissions, quiet, writes, connections, chatMetadata };
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

describe("current controller connection", () => {
  const requests: FrontendToBackend[] = [
    { type: "start_tidy", chatId: "chat", requestId: "tidy", actorIds: ["character:mira"] },
    { type: "test_controller", chatId: "chat", requestId: "test", settings: DEFAULT_SETTINGS, target: { connectionId: null, model: null } },
    { type: "generate_seed", characterId: "mira" },
    { type: "generate_npc_core", chatId: "chat", requestId: "core", name: "Scout", lore: "A patient scout." },
    { type: "update_now", chatId: "chat" },
    { type: "rebuild", chatId: "chat" },
    { type: "retry", chatId: "chat" },
    { type: "activate", chatId: "chat", historyMode: "full" },
  ];
  it.each(requests)("uses the live profile for $type before any chat generation", async (request) => {
    const { timeline, messages } = fixture();
    timeline.updateMode = "immediate";
    messages.push({ id: "m2", role: "assistant", content: "Mira waits.", index_in_chat: 2 });
    const host = await backend(timeline, messages);
    host.permissions.add("characters");
    host.quiet.mockResolvedValue({ content: JSON.stringify({ proposals: [], actorMentions: [], changes: [], core: { selfConcept: "A patient scout." }, selfConcept: "A patient scout." }) });
    await host.receive({ ...request, activeConnectionId: "zai-profile" });
    expect(host.quiet).toHaveBeenCalled();
    for (const [call] of host.quiet.mock.calls) expect(call.connection_id).toBe("zai-profile");
  });

  it.each([
    { active: "new-profile", pin: undefined, expected: "new-profile" },
    { active: "new-profile", pin: "pinned-profile", expected: "pinned-profile" },
    { active: "new-profile", pin: "deleted", expected: "new-profile" },
    { active: "deleted", pin: undefined, expected: "default" },
    { active: null, pin: undefined, expected: "default" },
    { active: undefined, pin: undefined, expected: "old-profile" },
  ])("uses $expected instead of the last generation ($active, $pin)", async ({ active, pin, expected }) => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    await host.receive({ type: "ready", chatId: "chat" });
    await host.intercept(messages, { chatId: "chat", connectionId: "old-profile" });
    host.permissions.add("chats");
    host.chatMetadata.connection_profile_id = pin;
    host.connections.get.mockImplementation(async (id) => id === "deleted" ? null : { provider: "openrouter", model: "test-model" });
    // A connection switch must reach background work, not just button clicks.
    await host.receive({ type: "connection_context", activeConnectionId: active });
    host.quiet.mockResolvedValue({ content: JSON.stringify({ proposals: [] }) });
    await host.receive(requests[0]);
    expect(host.quiet.mock.calls[0][0].connection_id).toBe(expected);
  });

  it("keeps a dedicated controller and its explicit fallback ahead of active and pinned connections", async () => {
    const { timeline, messages } = fixture();
    const host = await backend(timeline, messages, { controllerConnectionId: "dedicated", controllerFallbacks: [{ connectionId: "backup", model: null }] });
    host.permissions.add("chats"); host.chatMetadata.connection_profile_id = "pinned";
    host.quiet.mockRejectedValueOnce(new Error("down")).mockResolvedValue({ content: JSON.stringify({ proposals: [] }) });
    await host.receive({ ...requests[0], activeConnectionId: "active" });
    expect(host.quiet.mock.calls.map(([call]) => call.connection_id)).toEqual(["dedicated", "backup"]);
  });

  it("does not share the active selection across users", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    await host.receive({ type: "connection_context", activeConnectionId: "other-user-profile" }, "other-user");
    host.quiet.mockResolvedValue({ content: JSON.stringify({ proposals: [] }) });
    await host.receive(requests[0]);
    expect(host.quiet.mock.calls[0][0].connection_id).toBe("default");
  });

  it("uses the current connection for scheduled repair", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    await host.receive({ type: "repair_preview", chatId: "chat", requestId: "preview", activeConnectionId: "old" });
    const response = host.sent.find((message) => message.type === "repair_preview_result");
    if (response?.type !== "repair_preview_result") throw new Error("Missing preview");
    await host.receive({ type: "repair_analysis", chatId: "chat", requestId: "repair", revision: response.preview.revision, fingerprint: response.preview.fingerprint, activeConnectionId: "new" });
    await vi.advanceTimersByTimeAsync(1);
    expect(host.quiet).toHaveBeenCalled();
    expect(host.quiet.mock.calls[0][0].connection_id).toBe("new");
  });
});

describe("v0.3 backend flows", () => {
  it("repairs a chosen later range despite an earlier warning, and retries only that range after failure", async () => {
    const { timeline, messages } = fixture();
    timeline.records[0].controller.telemetry!.warningCodes = ["normalization_drop"];
    const host = await backend(timeline, messages);
    await host.receive({ type: "repair_preview", chatId: "chat", requestId: "preview" });
    const response = host.sent.find((message) => message.type === "repair_preview_result");
    if (response?.type !== "repair_preview_result") throw new Error("Missing preview");
    expect(response.preview.startMessageIndex).toBe(0);
    host.quiet.mockRejectedValueOnce(new Error("Temporarily unavailable"));
    await host.receive({ type: "repair_analysis", chatId: "chat", requestId: "repair", revision: response.preview.revision, fingerprint: response.preview.fingerprint, startMessageIndex: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(host.stored.get("timelines/chat.json")).toMatchObject({ health: "error", records: [timeline.records[0]] });
    await host.receive({ type: "repair_preview", chatId: "chat", requestId: "resume" });
    expect(host.sent.find((message) => "requestId" in message && message.requestId === "resume")).toMatchObject({ preview: { startMessageIndex: 1, resumed: true, messageCount: 1 } });
    await host.receive({ type: "retry", chatId: "chat" });
    const saved = host.stored.get("timelines/chat.json") as ChatTimelineV1;
    expect(saved.records[0]).toEqual(timeline.records[0]);
    expect(saved.records[1].id).not.toBe(timeline.records[1].id);
    expect(saved.repair).toBeNull();
    expect(saved.minds["character:mira"].items[0].locked).toBe(true);
    expect(host.quiet).toHaveBeenCalledTimes(2);
    for (const [call] of host.quiet.mock.calls) {
      expect(call.messages[1].content).toContain('id="m1"');
      const batch = call.messages[1].content.split("<analysis_batch>")[1].split("</analysis_batch>")[0];
      expect(batch).not.toContain('id="m0"');
    }
  });

  it("rejects a custom repair if the transcript changed after preview without altering saved records", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    await host.receive({ type: "repair_preview", chatId: "chat", requestId: "preview" });
    const response = host.sent.find((message) => message.type === "repair_preview_result");
    if (response?.type !== "repair_preview_result") throw new Error("Missing preview");
    messages[0].content = "The earlier message changed.";
    await host.receive({ type: "repair_analysis", chatId: "chat", requestId: "repair", revision: response.preview.revision, fingerprint: response.preview.fingerprint, startMessageIndex: 1 });
    expect(host.sent.at(-1)).toMatchObject({ type: "feature_error", requestId: "repair", message: expect.stringContaining("timeline changed") });
    expect(host.writes).not.toHaveBeenCalled();
    expect(host.quiet).not.toHaveBeenCalled();
  });

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
    await host.receive({ type: "repair_analysis", chatId: "chat", requestId: "repair", revision: response.preview.revision, fingerprint: response.preview.fingerprint });
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
    await host.receive({ type: "repair_analysis", chatId: "chat", requestId: "repair", revision: response.preview.revision, fingerprint: response.preview.fingerprint });
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
    await host.receive({ type: "repair_analysis", chatId: "chat", requestId: "repair", revision: response.preview.revision, fingerprint: response.preview.fingerprint });
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


describe("first activation", () => {
  function history(): ChatMessageLike[] {
    return Array.from({ length: 50 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? "assistant" : "user", content: `Mira waits ${index}.`, index_in_chat: index }));
  }

  it("builds all 50 messages on first activation", async () => {
    const host = await backend(createTimeline("chat"), history());
    await host.receive({ type: "activate", chatId: "chat", historyMode: "full" });
    const saved = host.stored.get("timelines/chat.json") as ChatTimelineV1;
    expect(saved.lastValidMessageIndex).toBe(49);
    expect(saved.records).toHaveLength(50);
    expect(saved.health).toBe("ready");
  });

  it.each(["update_now", "rebuild"] as const)("releases a stalled first request when %s cancels it, even without host acknowledgement", async (type) => {
    const host = await backend(createTimeline("chat"), history());
    host.quiet.mockImplementationOnce(() => new Promise(() => {}));
    const activation = host.receive({ type: "activate", chatId: "chat", historyMode: "full" });
    await vi.advanceTimersByTimeAsync(1);
    expect(host.quiet).toHaveBeenCalledTimes(1);
    const update = host.receive({ type, chatId: "chat" });
    await vi.advanceTimersByTimeAsync(1);
    const saved = host.stored.get("timelines/chat.json") as ChatTimelineV1;
    expect(saved.health).toBe("ready");
    expect(saved.lastValidMessageIndex).toBe(49);
    await Promise.all([activation, update]);
  });
  it("shows a timeout after a stalled activation and lets Retry finish", async () => {
    const host = await backend(createTimeline("chat"), history());
    host.quiet.mockImplementationOnce(() => new Promise(() => {}));
    const activation = host.receive({ type: "activate", chatId: "chat", historyMode: "full" });
    await vi.advanceTimersByTimeAsync(1);
    expect(host.sent).toContainEqual({ type: "analysis_progress", chatId: "chat", progress: {
      phase: "requesting", startMessageIndex: 0, endMessageIndex: 5, totalMessages: 50,
    } });
    await vi.advanceTimersByTimeAsync(DEFAULT_SETTINGS.controllerTimeoutSeconds * 1000);
    await activation;
    const stalled = host.stored.get("timelines/chat.json") as ChatTimelineV1;
    expect(stalled.health).toBe("error");
    expect(stalled.error).toContain("timed out after 120 seconds");
    expect(stalled.records).toHaveLength(0);
    expect(host.quiet.mock.calls[0][0].signal.aborted).toBe(true);
    expect(host.sent.at(-1)).toEqual({ type: "analysis_progress", chatId: "chat", progress: null });
    await host.receive({ type: "retry", chatId: "chat" });
    expect(host.stored.get("timelines/chat.json")).toMatchObject({ health: "ready", lastValidMessageIndex: 49 });
  });

  it("pauses a stalled activation immediately and ignores its late result", async () => {
    const host = await backend(createTimeline("chat"), history());
    let finish!: (value: unknown) => void;
    host.quiet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const activation = host.receive({ type: "activate", chatId: "chat", historyMode: "full" });
    await vi.advanceTimersByTimeAsync(1);
    await host.receive({ type: "pause", chatId: "chat", paused: true });
    await activation;
    finish({ content: JSON.stringify({ actorMentions: [], changes: [] }) });
    await vi.advanceTimersByTimeAsync(1);
    expect(host.stored.get("timelines/chat.json")).toMatchObject({ health: "paused", records: [], lastValidMessageIndex: -1 });
    expect(host.quiet).toHaveBeenCalledTimes(1);
  });

});


describe("history-based Tidy review", () => {
  function proposals(timeline: ChatTimelineV1) {
    const actorId = "character:mira";
    return [
      { actorId, finding: "missing", operation: "add_item", rationale: "Mira decides to leave in the reviewed history.", confidence: 0.9, targetItemIds: [], core: null,
        item: { category: "goal", text: "Leave the observatory", status: "active", targetActorIds: [], concealedFromActorIds: [], intensity: null, dimensions: {} } },
      { actorId, finding: "outdated", operation: "remove_items", rationale: "Proposed cleanup of the old secret.", confidence: 0.8, targetItemIds: [timeline.minds[actorId].items[0].id], core: null, item: null },
    ];
  }
  async function scan(host: Awaited<ReturnType<typeof backend>>) {
    await host.receive({ type: "start_tidy", chatId: "chat", requestId: "tidy", actorIds: ["character:mira"] });
    const result = host.sent.find((message) => message.type === "tidy_result");
    if (result?.type !== "tidy_result") throw new Error(JSON.stringify(host.sent.at(-1)));
    return result;
  }

  it.each([0, 6, 20])("uses Chat history limit %s independently of Analysis context messages", async (limit) => {
    const { timeline } = fixture();
    const transcript: ChatMessageLike[] = Array.from({ length: 8 }, (_, index) => ({ id: `h${index}`, role: "assistant", content: `History marker ${index}`, index_in_chat: index }));
    transcript.push({ id: "pending", role: "user", content: "Uncommitted trailing user", index_in_chat: 8 });
    const host = await backend(timeline, transcript, { chatHistoryMessageLimit: limit, analysisContextMessageLimit: 1 });
    host.quiet.mockResolvedValue({ content: JSON.stringify({ proposals: [] }) });
    const result = await scan(host);
    const expected = limit === 6 ? 6 : 8;
    expect(result.history).toMatchObject({ messageCount: expected, startMessageIndex: 8 - expected, endMessageIndex: 7, limit });
    const prompt = host.quiet.mock.calls[0][0].messages[1].content;
    const history = prompt.split("<chat_history>")[1].split("</chat_history>")[0];
    expect(history).toContain(`History marker ${8 - expected}`);
    expect(history).toContain("History marker 7");
    expect(history).not.toContain("Uncommitted trailing user");
    if (limit === 6) expect(history).not.toContain("History marker 1");
    expect(prompt).toContain("Keeps the observatory key.");
    expect(host.writes).not.toHaveBeenCalled();
  });

  it("applies only approved proposals as locked corrections, with no extra controller request", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    host.quiet.mockResolvedValue({ content: JSON.stringify({ proposals: proposals(timeline) }) });
    const result = await scan(host);
    expect(result.proposals).toHaveLength(2);
    expect(host.writes).not.toHaveBeenCalled();
    await host.receive({ type: "apply_tidy", chatId: "chat", requestId: "tidy", proposalIds: [result.proposals[0].id] });
    expect(host.sent.at(-1)).toMatchObject({ type: "tidy_applied", applied: 1 });
    const saved = host.stored.get("timelines/chat.json") as ChatTimelineV1;
    expect(saved.minds["character:mira"].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Leave the observatory", locked: true }),
      expect.objectContaining({ text: "Keeps the observatory key." }),
    ]));
    expect(host.quiet).toHaveBeenCalledTimes(1);
  });

  it("declining every proposal changes nothing and consumes the review", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    host.quiet.mockResolvedValue({ content: JSON.stringify({ proposals: proposals(timeline) }) });
    await scan(host);
    await host.receive({ type: "apply_tidy", chatId: "chat", requestId: "tidy", proposalIds: [] });
    expect(host.sent.at(-1)).toMatchObject({ type: "tidy_applied", applied: 0 });
    expect(host.writes).not.toHaveBeenCalled();
    await host.receive({ type: "apply_tidy", chatId: "chat", requestId: "tidy", proposalIds: [] });
    expect(host.sent.at(-1)).toMatchObject({ type: "tidy_error" });
  });

  it.each(["edit", "swipe", "append", "setting", "revision", "permission", "unknown", "expired"] as const)("rejects a stale or invalid review after %s without applying edits", async (cause) => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages, { chatHistoryMessageLimit: 1 });
    host.quiet.mockResolvedValue({ content: JSON.stringify({ proposals: proposals(timeline) }) });
    const result = await scan(host);
    if (cause === "edit") messages[0].content = "Changed outside the selected history window";
    if (cause === "swipe") messages[1].swipe_id = 2;
    if (cause === "append") messages.push({ id: "new", role: "assistant", content: "Another completed reply", index_in_chat: 2 });
    if (cause === "setting") await host.receive({ type: "save_settings", requestId: "settings", patch: { chatHistoryMessageLimit: 2 } });
    if (cause === "revision") await host.receive({ type: "add_item", chatId: "chat", actorId: "character:mira", category: "goal", text: "A manual edit" });
    if (cause === "permission") host.permissions.delete("chat_mutation");
    if (cause === "expired") await vi.advanceTimersByTimeAsync(15 * 60_000 + 1);
    host.writes.mockClear();
    await host.receive({ type: "apply_tidy", chatId: "chat", requestId: "tidy", proposalIds: [cause === "unknown" ? "not-a-proposal" : result.proposals[0].id] });
    expect(host.sent.at(-1)).toMatchObject({ type: "tidy_error" });
    expect(host.writes).not.toHaveBeenCalled();
  });

  it.each(["entry", "core"])("rejects conflicting %s approvals without partially applying any edits", async (kind) => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    const suggestions = proposals(timeline);
    const conflicting = kind === "entry" ? suggestions[1] : { ...suggestions[1], operation: "replace_core", targetItemIds: [], core: timeline.minds["character:mira"].core };
    host.quiet.mockResolvedValue({ content: JSON.stringify({ proposals: [suggestions[0], conflicting, { ...conflicting, rationale: "A conflicting edit" }] }) });
    const result = await scan(host);
    await host.receive({ type: "apply_tidy", chatId: "chat", requestId: "tidy", proposalIds: result.proposals.map((proposal) => proposal.id) });
    expect(host.sent.at(-1)).toMatchObject({ type: "tidy_error", message: expect.stringContaining("Conflicting approvals") });
    expect(host.writes).not.toHaveBeenCalled();
  });

  it("cancels an unresponsive scan without producing reviewable edits", async () => {
    const { timeline, messages } = fixture(); const host = await backend(timeline, messages);
    host.quiet.mockImplementation(() => new Promise(() => {}));
    const scanning = host.receive({ type: "start_tidy", chatId: "chat", requestId: "tidy", actorIds: ["character:mira"] });
    await vi.advanceTimersByTimeAsync(1);
    await host.receive({ type: "cancel_tidy", chatId: "chat", requestId: "tidy" });
    await scanning;
    expect(host.sent.at(-1)).toMatchObject({ type: "tidy_cancelled" });
    expect(host.sent.some((message) => message.type === "tidy_result")).toBe(false);
    expect(host.writes).not.toHaveBeenCalled();
  });

  it("keeps successful actors reviewable when another actor's request fails", async () => {
    const { timeline, messages } = fixture();
    const other = upsertActor(timeline, { id: "rowan", name: "Rowan", kind: "npc" });
    rebuildTimeline(timeline, messages);
    const host = await backend(timeline, messages);
    host.quiet.mockRejectedValueOnce(new Error("Provider unavailable"))
      .mockResolvedValueOnce({ content: JSON.stringify({ proposals: [{ ...proposals(timeline)[0], actorId: other.id }] }) });
    await host.receive({ type: "start_tidy", chatId: "chat", requestId: "tidy", actorIds: ["character:mira", other.id] });
    const result = host.sent.find((message) => message.type === "tidy_result");
    if (result?.type !== "tidy_result") throw new Error("Missing review");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].actorId).toBe("character:mira");
    expect(result.proposals).toHaveLength(1);
    expect(host.writes).not.toHaveBeenCalled();
    await host.receive({ type: "apply_tidy", chatId: "chat", requestId: "tidy", proposalIds: [result.proposals[0].id] });
    expect(host.sent.at(-1)).toMatchObject({ type: "tidy_applied", applied: 1 });
    expect(host.quiet).toHaveBeenCalledTimes(2);
  });
});
