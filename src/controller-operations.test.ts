import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeMessages, normalizeControllerAnalysis } from "./controller";
import { compactStateForController, createTimeline, DEFAULT_SETTINGS, materializeAnalysisRecords, normalizeTimeline, rebuildTimeline, upsertActor } from "./engine";
import type { ChatMessageLike, ControllerChange } from "./types";

const messages: ChatMessageLike[] = [
  { id: "m1", role: "assistant", content: "Mira takes the tunnel instead of the gate.", index_in_chat: 0 },
  { id: "m2", role: "assistant", content: "Mira reaches the library and finds the notebook. She gives up searching for its owner.", index_in_chat: 1 },
];
const item = (id: string, category = "goal", text = "Find the notebook", extra = {}) => ({ id, category, text, status: "active", targetActorIds: [], concealedFromActorIds: [], controllerWritable: true, ...extra });
const state = (items = [item("goal")]) => [{ ref: "mira", name: "Mira", managed: true, items }];
const change = (operation: ControllerChange["operation"], extra = {}): ControllerChange => ({ subjectRef: "mira", category: "goal", operation, targetItemId: operation === "add" ? null : "goal", text: operation === "add" || operation === "update" ? "Find the notebook" : "", messageId: "m2", ...extra });
const response = (changes: unknown[], tool = false) => {
  const data = { actorMentions: [], changes };
  return tool ? { tool_calls: [{ name: "lumi_mind_analysis_v1", args: data }] } : { content: JSON.stringify(data) };
};
function host(quiet: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("spindle", { generate: { quiet }, connections: { get: vi.fn(async () => ({ model: "model", provider: "test" })) } });
}
const analyze = (extra = {}) => analyzeMessages({ messages, recentContext: [], compactState: state(), settings: DEFAULT_SETTINGS, userId: "operations", ...extra });
afterEach(() => vi.unstubAllGlobals());

describe("live analysis operations", () => {
  it.each([false, true])("rejects permanent deletion from JSON/tool output (%s) and corrects it to resolution", async (tool) => {
    const quiet = vi.fn().mockResolvedValueOnce(response([change("remove")], tool)).mockResolvedValueOnce(response([change("resolve")], tool));
    host(quiet);
    const result = await analyze();
    expect(result.analysis.changes).toEqual([expect.objectContaining({ operation: "resolve", targetItemId: "goal", status: "resolved" })]);
    expect(result.telemetry.first.emittedOperations?.remove).toBe(1);
    expect(result.telemetry.first.acceptedOperations?.remove).toBe(0);
    expect(result.telemetry.first.invalidChangeReasons).toEqual({ forbidden_remove: 1 });
    expect(result.telemetry).toMatchObject({ attempts: 2, retryReason: "invalid_operations", finalOperations: { resolve: 1, remove: 0 }, warningCodes: [] });
    expect(quiet.mock.calls[0][0].tools[0].parameters.properties.changes.items.properties.operation.enum).toEqual(["add", "update", "resolve", "abandon"]);
    expect(quiet.mock.calls[1][0].messages[1].content).toContain("forbidden_remove=1");
    expect(quiet).toHaveBeenCalledTimes(2);
  });

  it("retains safe first-pass changes when correction fails, without merging partial replacements", async () => {
    const original = change("update", { text: "Find the notebook in the library" });
    const quiet = vi.fn().mockResolvedValueOnce(response([original, change("remove")]))
      .mockResolvedValueOnce(response([change("abandon"), change("remove")]));
    host(quiet);
    const result = await analyze();
    expect(result.analysis.changes).toEqual([expect.objectContaining(original)]);
    expect(result.telemetry.warningCodes).toEqual(expect.arrayContaining(["normalization_drop", "retry_failed"]));
    expect(result.telemetry.finalOperations).toMatchObject({ update: 1, abandon: 0, remove: 0 });
    expect(quiet).toHaveBeenCalledTimes(2);
  });

  it("uses a valid complete correction, including a deliberate empty result", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response([change("update", { text: "An unwarranted edit" }), change("remove")]))
      .mockResolvedValueOnce(response([]));
    host(quiet);
    const result = await analyze({ settings: { ...DEFAULT_SETTINGS, controllerFallbacks: [{ connectionId: "backup", model: null }] } });
    expect(result.analysis.changes).toEqual([]);
    expect(result.telemetry.warningCodes).toEqual([]);
    expect(quiet).toHaveBeenCalledTimes(2);
  });

  it("retains safe output after a corrective request fails and keeps provider errors private", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response([change("resolve"), change("remove")]))
      .mockRejectedValueOnce(new Error("Bearer PRIVATE_TOKEN request=PRIVATE_STORY"));
    host(quiet);
    const result = await analyze();
    expect(result.analysis.changes[0].operation).toBe("resolve");
    expect(result.telemetry.retryError).toBe("Corrective controller request failed.");
    expect(JSON.stringify(result.telemetry)).not.toMatch(/PRIVATE/);
  });

  it("rejects add-as-update and terminal status disguised as an add or update", () => {
    expect(normalizeControllerAnalysis({ actorMentions: [], changes: [
      change("add", { targetItemId: "goal" }), change("add", { status: "resolved" }), change("update", { status: "abandoned" }),
    ] }).changes).toEqual([]);
  });

  it("suppresses unchanged additions without a request, and corrects an implicit relationship replacement", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response([change("add")]))
      .mockResolvedValueOnce(response([change("add", { category: "relationship", text: "Now trusts Rowan", targetRefs: ["Rowan"] })]))
      .mockResolvedValueOnce(response([change("update", { category: "relationship", targetItemId: "stance", text: "Now trusts Rowan", targetRefs: ["rowan"] })]));
    host(quiet);
    const covered = await analyze();
    expect(covered.analysis.changes).toEqual([]);
    expect(covered.telemetry.first.duplicatesSuppressed).toBe(1);
    expect(covered.telemetry.warningCodes).toEqual([]);
    expect(quiet).toHaveBeenCalledTimes(1);
    const replacement = await analyze({ compactState: [...state([item("stance", "relationship", "Distrusts Rowan", { targetActorIds: ["rowan"] })]), { ref: "rowan", name: "Rowan", items: [] }] });
    expect(replacement.analysis.changes[0]).toMatchObject({ operation: "update", targetItemId: "stance", targetRefs: ["rowan"] });
    expect(replacement.telemetry.first.invalidChangeReasons).toEqual({ implicit_replacement: 1 });
    expect(quiet.mock.calls[2][0].messages[1].content).toContain('"targetItemId":"stance"');
  });

  it("does not retry unchanged state or force a mix of operations on a long scene", async () => {
    const quiet = vi.fn().mockResolvedValue(response([])); host(quiet);
    const result = await analyze({ messages: [{ ...messages[0], content: "Mira continues searching. ".repeat(30) }] });
    expect(result.analysis.changes).toEqual([]);
    expect(quiet).toHaveBeenCalledTimes(1);
  });

  it("requires update for changed intensity even when the text is identical", async () => {
    const evolving = { category: "emotion", text: "Worried about the storm", intensity: 0.9 };
    const quiet = vi.fn().mockResolvedValueOnce(response([change("add", evolving)]))
      .mockResolvedValueOnce(response([change("update", evolving)])); host(quiet);
    const result = await analyze({ compactState: state([item("goal", "emotion", evolving.text, { intensity: 0.3 })]) });
    expect(result.telemetry.first.invalidChangeReasons).toEqual({ implicit_replacement: 1 });
    expect(result.analysis.changes[0]).toMatchObject({ operation: "update", targetItemId: "goal", intensity: 0.9 });
  });

  it("checks a fresh reference for a known actor against its existing protected state", async () => {
    const quiet = vi.fn().mockResolvedValueOnce({ content: JSON.stringify({
      actorMentions: [{ ref: "fresh-mira", name: "Mira", kind: "npc", messageId: "m1" }],
      changes: [change("update", { subjectRef: "fresh-mira", text: "Changed locked state" })],
    }) }).mockResolvedValueOnce(response([])); host(quiet);
    const compactState = state([item("goal", "goal", "Find the notebook", { locked: true })]);
    const before = structuredClone(compactState);
    const result = await analyze({ compactState });
    expect(result.telemetry.first.invalidChangeReasons).toEqual({ protected_target: 1 });
    expect(result.analysis.changes).toEqual([]);
    expect(compactState).toEqual(before);
  });

  it("rejects an add that would implicitly update a near-matching goal", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response([change("add", { text: "Wants to escape the tower" })]))
      .mockResolvedValueOnce(response([change("update", { text: "Wants to escape the tower" })])); host(quiet);
    const result = await analyze({ compactState: state([item("goal", "goal", "Escape the tower")]) });
    expect(result.telemetry.first.invalidChangeReasons).toEqual({ implicit_replacement: 1 });
    expect(result.analysis.changes[0].operation).toBe("update");
  });

  it("uses the evolving ledger within a batch when checking later duplicate additions", async () => {
    const compactState = state([item("goal", "goal", "Find the notebook")]);
    const before = structuredClone(compactState);
    const quiet = vi.fn().mockResolvedValue(response([
      change("add", { text: "Retrieve the journal from the library", messageId: "m2" }),
      change("update", { text: "Retrieve the journal from the library", messageId: "m1" }),
    ])); host(quiet);
    const result = await analyze({ compactState });
    expect(result.analysis.changes).toHaveLength(1);
    expect(result.analysis.changes[0].operation).toBe("update");
    expect(result.telemetry.first.duplicatesSuppressed).toBe(1);
    expect(quiet).toHaveBeenCalledTimes(1);
    expect(compactState).toEqual(before);
  });

  it("keeps same-message update then resolve in response order and accepts independent new state", async () => {
    const quiet = vi.fn().mockResolvedValue(response([
      change("update", { text: "Find the library notebook" }), change("resolve"),
      change("add", { category: "emotion", text: "Relieved after finding the notebook" }),
    ])); host(quiet);
    const result = await analyze();
    expect(result.analysis.changes.map((entry) => entry.operation)).toEqual(["update", "resolve", "add"]);
    expect(result.telemetry.finalOperations).toMatchObject({ add: 1, update: 1, resolve: 1 });
    expect(quiet).toHaveBeenCalledTimes(1);
  });

  it("retains first-pass output when the corrective result has no changes array", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response([change("resolve"), change("remove")]))
      .mockResolvedValueOnce({ content: JSON.stringify({ actorMentions: [] }) }); host(quiet);
    const result = await analyze();
    expect(result.analysis.changes[0].operation).toBe("resolve");
    expect(result.telemetry.retryError).toContain("invalid analysis result");
    expect(result.telemetry.warningCodes).toContain("retry_failed");
  });

  it("shares one correction budget between invalid operations and bootstrap", async () => {
    const quiet = vi.fn().mockResolvedValue(response([change("remove")])); host(quiet);
    const result = await analyze({ compactState: [], messages: [{ ...messages[1], content: "Mira keeps searching for her notebook. ".repeat(30) }] });
    expect(quiet).toHaveBeenCalledTimes(2);
    expect(result.analysis.changes).toEqual([]);
    expect(result.telemetry.warningCodes).toContain("empty_nontrivial_batch");
  });

  it("tries a fallback after two unusable operation results and propagates cancellation during correction", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response([change("remove")])).mockResolvedValueOnce(response([change("remove")])).mockResolvedValueOnce(response([change("abandon")])); host(quiet);
    const result = await analyze({ settings: { ...DEFAULT_SETTINGS, controllerConnectionId: "primary", controllerFallbacks: [{ connectionId: "backup", model: null }] } });
    expect(result.meta.connectionId).toBe("backup");
    expect(result.analysis.changes[0]).toMatchObject({ operation: "abandon", status: "abandoned" });
    expect(quiet).toHaveBeenCalledTimes(3);
    const controller = new AbortController();
    quiet.mockReset().mockResolvedValueOnce(response([change("remove")])).mockImplementationOnce(async () => { controller.abort(); return response([]); });
    await expect(analyze({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(quiet).toHaveBeenCalledTimes(2);
  });

  it("preserves locks and validates missing targets before accepting terminal operations", async () => {
    const quiet = vi.fn().mockResolvedValueOnce(response([change("resolve"), change("abandon", { targetItemId: "missing" })])).mockResolvedValueOnce(response([])); host(quiet);
    const result = await analyze({ compactState: state([item("goal", "goal", "Find the notebook", { controllerWritable: false })]) });
    expect(result.telemetry.first.invalidChangeReasons).toEqual({ protected_target: 1, target_not_found: 1 });
    expect(result.analysis.changes).toEqual([]);
  });

  it("deduplicates only identical edits in the same message", () => {
    const first = change("update", { messageId: "m1", text: "Search the library" });
    const result = normalizeControllerAnalysis({ actorMentions: [], changes: [first, first, { ...first, text: "Search the tower" }, { ...first, messageId: "m2" }, change("resolve")] });
    expect(result.changes).toHaveLength(4);
    expect(result.changes.map((entry) => entry.operation)).toEqual(["update", "update", "update", "resolve"]);
  });

  it("preserves chronological updates and conclusions through stored checkpoint replay", async () => {
    const timeline = createTimeline("chat"); timeline.active = true;
    const actor = upsertActor(timeline, { id: "mira", kind: "npc", name: "Mira" });
    const seed: ChatMessageLike = { id: "seed", role: "assistant", content: "Mira plans to enter through the gate.", index_in_chat: -1 };
    timeline.records = materializeAnalysisRecords(timeline, [seed], "root", { actorMentions: [], changes: [change("add", { category: "plan", messageId: "seed", text: "Enter through the gate" })] }, { connectionId: null, model: null, provider: null });
    rebuildTimeline(timeline, [seed]);
    const targetId = timeline.minds[actor.id].items[0].id;
    const quiet = vi.fn().mockResolvedValue(response([
      change("resolve", { category: "plan", targetItemId: targetId, messageId: "m2" }),
      change("update", { category: "plan", targetItemId: targetId, text: "Enter through the tunnel", messageId: "m1" }),
    ])); host(quiet);
    const result = await analyze({ compactState: compactStateForController(timeline) });
    expect(result.analysis.changes.map((entry) => entry.operation)).toEqual(["update", "resolve"]);
    const prefix = rebuildTimeline(timeline, [seed]).nextPrefix;
    timeline.records.push(...materializeAnalysisRecords(timeline, messages, prefix, result.analysis, result.meta));
    rebuildTimeline(timeline, [seed, messages[0]]);
    expect(timeline.minds[actor.id].items[0]).toMatchObject({ id: targetId, text: "Enter through the tunnel", status: "active" });
    const loaded = normalizeTimeline(JSON.parse(JSON.stringify(timeline)), "chat");
    rebuildTimeline(loaded, [seed, ...messages]);
    expect(loaded.minds[actor.id].items[0]).toMatchObject({ id: targetId, text: "Enter through the tunnel", status: "resolved" });
    expect(quiet).toHaveBeenCalledTimes(1);
    // Existing stored removals retain their meaning under the same schema version.
    loaded.records.at(-1)!.deltas[0].operation = "remove";
    rebuildTimeline(loaded, [seed, ...messages]);
    expect(loaded.minds[actor.id].items).toEqual([]);
  });
});
