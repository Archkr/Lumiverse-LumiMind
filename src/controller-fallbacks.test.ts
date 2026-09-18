import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeMessages, generateMindTidyProposals, generateNpcCoreDraft, generateSeedDraft, getLastControllerRun, testController } from "./controller";
import { DEFAULT_SETTINGS, makeBaseMind, normalizeSettings, createTimeline, upsertActor } from "./engine";
import { cloneSettings } from "./ui/helpers";
import type { ChatMessageLike } from "./types";

const settings = { ...DEFAULT_SETTINGS, controllerConnectionId: "primary", controllerModel: "primary-override", controllerFallbacks: [
  { connectionId: "backup", model: null }, { connectionId: "third", model: "third-override" },
] };
const messages: ChatMessageLike[] = [{ id: "m1", role: "assistant", content: "Mira wants to leave.", index_in_chat: 0 }];
const valid = { actorMentions: [{ ref: "mira", name: "Mira", kind: "npc", present: true, messageId: "m1" }],
  changes: [{ subjectRef: "mira", category: "goal", operation: "add", text: "Leave", messageId: "m1", evidenceExcerpt: "Mira wants to leave." }] };
const response = (data: unknown) => ({ content: JSON.stringify(data) });
function host(quiet: ReturnType<typeof vi.fn>) {
  const countText = vi.fn(async (_text, options) => ({ total_tokens: 10, model: options.model, tokenizer_name: "test", approximate: false }));
  const spindle = { generate: { quiet }, connections: { get: vi.fn(async (id) => ({ provider: id, model: `${id}-default` })) }, tokens: { countText, countMessages: vi.fn(async () => ({ total_tokens: 20 })) } };
  vi.stubGlobal("spindle", spindle);
  return spindle;
}
const analyze = (extra = {}) => analyzeMessages({ messages, recentContext: [], compactState: [], settings, userId: "fallback-test", ...extra });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("controller fallbacks", () => {
  it("times out an unresponsive primary, releases its slot, and uses the backup", async () => {
    vi.useFakeTimers();
    const quiet = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(response(valid));
    host(quiet);
    const pending = analyze({ settings: { ...settings, controllerTimeoutSeconds: 15 } });
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;
    expect(quiet.mock.calls[0][0].signal.aborted).toBe(true);
    expect(result.meta.connectionId).toBe("backup");
    expect(result.telemetry.connectionAttempts?.map((attempt) => attempt.outcome)).toEqual(["request_failed", "success"]);
  });

  it("cancels stalled token counting before sending generation or trying backups", async () => {
    vi.useFakeTimers();
    const quiet = vi.fn();
    const spindle = host(quiet);
    spindle.tokens.countText.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = analyze({ signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    expect(spindle.tokens.countText).toHaveBeenCalled();
    controller.abort();
    await rejected;
    expect(quiet).not.toHaveBeenCalled();
  });

  it("isolates model overrides, counts with the backup tokenizer, and restarts at primary", async () => {
    const quiet = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(response(valid));
    const spindle = host(quiet);
    const result = await analyze();
    expect(quiet.mock.calls.map(([call]) => [call.connection_id, call.parameters.model])).toEqual([["primary", "primary-override"], ["backup", ""]]);
    expect(result.meta).toMatchObject({ connectionId: "backup", model: "backup-default" });
    expect(spindle.tokens.countText.mock.calls.some(([, options]) => options.model === "backup-default")).toBe(true);
    expect(result.telemetry.connectionAttempts?.map((attempt) => attempt.outcome)).toEqual(["request_failed", "success"]);
    await analyze();
    expect(quiet.mock.calls[2][0].connection_id).toBe("primary");
  });

  it("falls back on malformed structured output but accepts healthy no-change analysis", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response({ arbitrary: true })).mockResolvedValue(response({ actorMentions: [], changes: [] }));
    host(quiet);
    const result = await analyze();
    expect(result.meta.connectionId).toBe("backup");
    expect(quiet).toHaveBeenCalledTimes(2);
    expect(result.telemetry.warningCodes).toEqual([]);
  });

  it("bounds bootstrap corrections and retains the earliest partial result after exhaustion", async () => {
    const quiet = vi.fn().mockResolvedValue(response({ actorMentions: valid.actorMentions, changes: [] }));
    host(quiet);
    const result = await analyze({ messages: [{ ...messages[0], content: "Mira waits for rescue. ".repeat(30) }] });
    expect(quiet).toHaveBeenCalledTimes(6);
    expect(result.meta.connectionId).toBe("primary");
    expect(result.telemetry.warningCodes).toContain("empty_nontrivial_batch");
    expect(result.telemetry.connectionAttempts).toHaveLength(3);
  });

  it("does not merge primary partial state into a successful backup", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response({ actorMentions: [{ ref: "primary-only", name: "Other", messageId: "m1" }], changes: [] }))
      .mockResolvedValueOnce(response({ actorMentions: [], changes: [] })).mockResolvedValue(response(valid));
    host(quiet);
    const result = await analyze({ messages: [{ ...messages[0], content: "Mira waits for rescue. ".repeat(30) }] });
    expect(result.meta.connectionId).toBe("backup");
    expect(result.analysis.actorMentions.some((actor) => actor.ref === "primary-only")).toBe(false);
  });

  it.each([new DOMException("Stopped", "AbortError"), Object.assign(new Error("Permission denied"), { code: "PERMISSION_DENIED" })])("does not fall back for cancellation or permission errors", async (error) => {
    const quiet = vi.fn().mockRejectedValue(error); host(quiet);
    await expect(analyze()).rejects.toBe(error);
    expect(quiet).toHaveBeenCalledTimes(1);
  });

  it("redacts provider failures from exhausted-chain errors and telemetry", async () => {
    const quiet = vi.fn().mockRejectedValue(new Error("Bearer SECRET body=PRIVATE")); host(quiet);
    await expect(analyze()).rejects.toThrow("All configured LumiMind controllers failed");
    expect(quiet).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(getLastControllerRun("fallback-test"))).not.toMatch(/SECRET|PRIVATE/);
  });

  it("uses backups for seed and NPC core generation", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response({})).mockResolvedValue(response({ selfConcept: "A patient scout" })); host(quiet);
    const core = await generateNpcCoreDraft({ actorName: "Mira", lore: "A patient scout", settings, userId: "fallback-test" });
    expect(core.selfConcept).toBe("A patient scout");
    expect(quiet.mock.calls[1][0].connection_id).toBe("backup");
    quiet.mockReset().mockRejectedValueOnce(new Error("down")).mockResolvedValue(response({ schemaVersion: 1, core: { selfConcept: "A scout" } }));
    const seed = await generateSeedDraft({ character: { description: "A scout" }, settings, userId: "fallback-test" });
    expect(seed.core.selfConcept).toBe("A scout");
    expect(quiet.mock.calls[1][0].connection_id).toBe("backup");
  });

  it("uses backups for invalid Tidy output and accepts an empty valid proposal list", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response({ proposals: [{ bad: true }] })).mockResolvedValue(response({ proposals: [] })); host(quiet);
    const actor = upsertActor(createTimeline("chat"), { name: "Mira", kind: "npc" });
    expect(await generateMindTidyProposals({ actor, mind: makeBaseMind(actor.id), knownActors: [actor], history: [], settings, userId: "fallback-test" })).toEqual([]);
    expect(quiet).toHaveBeenCalledTimes(2);
    quiet.mockClear();
    await expect(generateMindTidyProposals({ actor, mind: makeBaseMind(actor.id), knownActors: [actor], history: [], settings: { ...settings, analysisStateTokenBudget: 1 }, userId: "fallback-test" })).rejects.toThrow("above");
    expect(quiet).not.toHaveBeenCalled();
  });

  it("tests one selected target with synthetic evidence and never invokes backups", async () => {
    const quiet = vi.fn().mockImplementation(async (call) => {
      expect(call.messages[1].content).toContain("controller-test-scene");
      return response({ actorMentions: valid.actorMentions.map((actor) => ({ ...actor, messageId: "controller-test-scene" })),
        changes: valid.changes.map((change) => ({ ...change, messageId: "controller-test-scene" })) });
    }); host(quiet);
    const result = await testController({ target: { connectionId: "backup", model: null }, settings, userId: "fallback-test" });
    expect(result).toMatchObject({ passed: true, connectionId: "backup", model: "backup-default", outputMode: "content_json" });
    quiet.mockReset().mockRejectedValue(new Error("PRIVATE"));
    expect(await testController({ target: { connectionId: "backup", model: null }, settings, userId: "fallback-test" })).toMatchObject({ passed: false });
    expect(quiet).toHaveBeenCalledTimes(1);
  });

  it("normalizes old settings and clones fallback drafts independently", () => {
    expect(normalizeSettings({}).controllerFallbacks).toEqual([]);
    const original = normalizeSettings(settings);
    const draft = cloneSettings(original);
    draft.controllerFallbacks[0].model = "changed";
    draft.controllerFallbacks.reverse();
    expect(original.controllerFallbacks[0]).toEqual({ connectionId: "backup", model: null });
    expect(normalizeSettings({ controllerFallbacks: [{ connectionId: "x" }, { connectionId: "x" }, {}, ...settings.controllerFallbacks] }).controllerFallbacks).toHaveLength(3);
  });
});

describe("fallback resolution and empty exhaustion", () => {
  it("resolves the default connection and avoids retrying an equivalent explicit backup", async () => {
    const quiet = vi.fn().mockRejectedValue(new Error("down"));
    const spindle = host(quiet);
    Object.assign(spindle.connections, { list: vi.fn(async () => [{ id: "primary", provider: "primary", model: "primary-default", is_default: true }]) });
    await expect(analyze({ settings: { ...settings, controllerConnectionId: null, controllerModel: null, controllerFallbacks: [{ connectionId: "primary", model: null }] } })).rejects.toThrow("controllers failed");
    expect(quiet).toHaveBeenCalledTimes(1);
  });

  it("reports failure when every configured target returns entirely empty bootstrap results", async () => {
    const quiet = vi.fn().mockResolvedValue(response({ actorMentions: [], changes: [] })); host(quiet);
    await expect(analyze({ messages: [{ ...messages[0], content: "Mira waits for rescue. ".repeat(30) }] })).rejects.toThrow("no usable analysis");
    expect(quiet).toHaveBeenCalledTimes(6);
  });
});
