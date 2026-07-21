import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  addManualItem,
  analysisPolicyHash,
  buildDirectorMindInjection,
  buildMindInjection,
  buildProjectedMindInjection,
  canonicalMindText,
  clearCortexBindings,
  compactStateForController,
  confirmActor,
  createCheckpointTimeline,
  createTimeline,
  limitChatHistoryMessages,
  makeBaseMind,
  makeEmptySeed,
  materializeAnalysisRecords,
  materializeSkippedAnalysisRecords,
  mergeActors,
  mindInjectionIndex,
  mindTextsNearDuplicate,
  nextPrefixHash,
  normalizeSettings,
  normalizeTimeline,
  overrideItem,
  projectControllerState,
  rebuildTimeline,
  reconcileCortexIdentities,
  removeActor,
  resolveActorId,
  selectCompletedAssistantTranscript,
  selectAnalysisRecentContext,
  selectAnalysisWorkBatch,
  splitActor,
  stableHash,
  toTimelineView,
  upsertActor,
  type TokenCounter,
} from "./engine";
import type { AnalysisRecord, ChatMessageLike, MindDelta } from "./types";

function message(id: string, index: number, content: string): ChatMessageLike {
  return { id, role: index % 2 ? "assistant" : "user", content, index_in_chat: index, swipe_id: 0 };
}

function delta(subjectActorId: string, messageId: string, messageIndex: number, overrides: Partial<MindDelta> = {}): MindDelta {
  return {
    id: `delta:${messageId}`,
    subjectActorId,
    category: "belief",
    operation: "add",
    targetItemId: null,
    text: "The door is locked",
    status: "active",
    confidence: 0.8,
    targetActorIds: [],
    concealedFromActorIds: [],
    intensity: null,
    dimensions: {},
    evidence: { messageId, swipeId: 0, excerpt: "The latch would not move.", messageIndex },
    createdAt: 10 + messageIndex,
    ...overrides,
  };
}

function record(messageValue: ChatMessageLike, prefixHash: string, deltas: MindDelta[]): AnalysisRecord {
  return {
    id: `analysis:${messageValue.id}`,
    analysisVersion: 1,
    messageId: messageValue.id,
    messageIndex: messageValue.index_in_chat ?? 0,
    swipeId: messageValue.swipe_id ?? 0,
    contentHash: stableHash(`${messageValue.role}\n\n${messageValue.content}`),
    prefixHash,
    actorMentions: [],
    deltas,
    controller: { connectionId: null, provider: "test", model: "test" },
    createdAt: 20,
  };
}

const countByCharacters: TokenCounter = async (value) => ({
  totalTokens: Math.ceil(value.length / 4),
  model: "test-model",
  tokenizerName: "test-tokenizer",
  approximate: false,
  fallback: false,
});

describe("actor registry", () => {
  it("resolves canonical names and aliases only when unambiguous", () => {
    const timeline = createTimeline("chat");
    const mira = upsertActor(timeline, { kind: "npc", name: "Mira", aliases: ["Captain"] });
    expect(resolveActorId(timeline.actors, "captain")).toBe(mira.id);
    upsertActor(timeline, { kind: "npc", name: "Rin", aliases: ["Captain"] });
    expect(resolveActorId(timeline.actors, "captain")).toBeNull();
  });

  it("uses stable host ids and merges aliases", () => {
    const timeline = createTimeline("chat");
    const card = upsertActor(timeline, { kind: "character", name: "Aster", characterId: "card-7" });
    expect(card.id).toBe("character:card-7");
    const npc = upsertActor(timeline, { kind: "npc", name: "The Scholar", aliases: ["Ash"] });
    expect(mergeActors(timeline, npc.id, card.id)).toBe(true);
    expect(timeline.actors[card.id].aliases).toEqual(expect.arrayContaining(["The Scholar", "Ash"]));
  });

  it("confirms an actor without changing or creating a Cortex link", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira", confidence: 0.6, confirmed: false });

    expect(confirmActor(timeline, actor.id)).toBe(true);
    expect(actor).toMatchObject({ confirmed: true, confidence: 1, cortexEntityId: null });
  });

  it("refreshes Cortex identities while preserving local names and alias suppression", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira Prime", aliases: ["Mira", "Scout"] });
    actor.suppressedAliases = ["Scout"];
    actor.aliases = ["Mira"];

    reconcileCortexIdentities(timeline, [{
      id: "entity-mira",
      name: "Mira",
      aliases: ["Scout", "Seer"],
      confidence: 1,
      confirmed: true,
    }]);

    expect(actor.canonicalName).toBe("Mira Prime");
    expect(actor.aliases).toEqual(expect.arrayContaining(["Mira", "Seer"]));
    expect(actor.aliases).not.toContain("Scout");
    expect(actor.cortexEntityId).toBe("entity-mira");

    reconcileCortexIdentities(timeline, []);
    expect(actor.cortexEntityId).toBeNull();
  });

  it("does not re-import a removed Cortex identity", () => {
    const timeline = createTimeline("chat");
    const identity = { id: "entity-mira", name: "Mira", aliases: [], confidence: 1, confirmed: true };
    reconcileCortexIdentities(timeline, [identity]);
    const actor = Object.values(timeline.actors).find((candidate) => candidate.cortexEntityId === identity.id)!;

    expect(removeActor(timeline, actor.id)).toBe(true);
    expect(timeline.suppressedCortexEntityIds).toEqual([identity.id]);
    reconcileCortexIdentities(timeline, [identity]);

    expect(Object.values(timeline.actors).some((candidate) => candidate.cortexEntityId === identity.id)).toBe(false);
  });

  it("reattaches a Cortex identity only when its local match is unambiguous", () => {
    const timeline = createTimeline("chat");
    const first = upsertActor(timeline, { kind: "npc", name: "Mira", aliases: ["Captain"] });
    const second = upsertActor(timeline, { kind: "npc", name: "Rin", aliases: ["Captain"] });

    reconcileCortexIdentities(timeline, [{
      id: "entity-captain",
      name: "Captain",
      aliases: [],
      confidence: 0.65,
      confirmed: false,
    }]);

    expect(first.cortexEntityId).toBeNull();
    expect(second.cortexEntityId).toBeNull();
    expect(timeline.actors["cortex:entity-captain"].cortexEntityId).toBe("entity-captain");
  });

  it("does not guess when one local actor matches multiple Cortex identities", () => {
    const timeline = createTimeline("chat");
    const local = upsertActor(timeline, { kind: "npc", name: "Mira" });

    reconcileCortexIdentities(timeline, [
      { id: "entity-one", name: "Mira", aliases: [], confidence: 0.65, confirmed: false },
      { id: "entity-two", name: "Mira", aliases: [], confidence: 0.65, confirmed: false },
    ]);

    expect(local.cortexEntityId).toBeNull();
    expect(timeline.actors["cortex:entity-one"].cortexEntityId).toBe("entity-one");
    expect(timeline.actors["cortex:entity-two"].cortexEntityId).toBe("entity-two");
  });

  it("requires an explicit local Cortex-link choice when merging linked actors", () => {
    const timeline = createTimeline("chat");
    const source = upsertActor(timeline, { kind: "npc", name: "Mira", cortexEntityId: "entity-source" });
    const target = upsertActor(timeline, { kind: "npc", name: "Rin", cortexEntityId: "entity-target" });

    expect(mergeActors(timeline, source.id, target.id)).toBe(false);
    expect(timeline.actors[source.id]).toBeDefined();
    expect(mergeActors(timeline, source.id, target.id, "target")).toBe(true);
    expect(timeline.actors[target.id].cortexEntityId).toBe("entity-target");
    expect(timeline.suppressedCortexEntityIds).toEqual(["entity-source"]);
  });

  it("clears Cortex links and suppressions when moving a timeline between chats", () => {
    const timeline = createTimeline("source");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira", cortexEntityId: "source-entity" });
    timeline.suppressedCortexEntityIds = ["source-hidden"];

    clearCortexBindings(timeline);

    expect(actor.cortexEntityId).toBeNull();
    expect(timeline.suppressedCortexEntityIds).toEqual([]);
  });

  it("keeps a deliberately removed alias suppressed across analysis replay", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira", aliases: ["Scout"] });
    const first = message("m1", 0, "Scout enters the room.");
    const firstRecord = record(first, "root", []);
    firstRecord.actorMentions = [{
      ref: actor.id,
      name: "Mira",
      aliases: ["Scout"],
      kind: "npc",
      confidence: 0.9,
      present: true,
      evidence: { messageId: first.id, swipeId: 0, excerpt: "Scout enters", messageIndex: 0 },
    }];
    timeline.records = [firstRecord];
    actor.suppressedAliases = ["Scout"];
    actor.aliases = [];

    rebuildTimeline(timeline, [first]);

    expect(actor.aliases).toEqual([]);
  });

  it("clones the folded source mind when splitting an NPC", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const seed = makeEmptySeed({ selfConcept: "A cautious scout" });
    seed.startingGoals = ["Protect the caravan"];
    timeline.baseMinds[actor.id] = makeBaseMind(actor.id, seed);
    rebuildTimeline(timeline, []);
    addManualItem(timeline, actor.id, "belief", "The eastern road is unsafe");
    rebuildTimeline(timeline, []);

    const split = splitActor(timeline, actor.id, "Selene");
    expect(split).not.toBeNull();
    rebuildTimeline(timeline, []);

    expect(timeline.minds[split!.id].core.selfConcept).toBe("A cautious scout");
    expect(timeline.minds[split!.id].items.map((item) => item.text)).toEqual([
      "Protect the caravan",
      "The eastern road is unsafe",
    ]);
  });

  it("migrates controller-discovered character-shaped actors to timeline-local NPCs", () => {
    const timeline = createTimeline("chat");
    const legacy = upsertActor(timeline, { kind: "character", name: "Mira" });
    const serialized = JSON.parse(JSON.stringify(timeline)) as Record<string, unknown>;
    delete serialized.suppressedCortexEntityIds;
    const normalized = normalizeTimeline(serialized, timeline.chatId);
    expect(normalized.actors[legacy.id]).toMatchObject({ kind: "npc", characterId: null });
    expect(normalized.suppressedCortexEntityIds).toEqual([]);

    const fresh = createTimeline("fresh");
    const first = message("m1", 0, "Mira watched the door.");
    materializeAnalysisRecords(fresh, [first], "root", {
      actorMentions: [{ ref: "mira", name: "Mira", kind: "character", messageId: first.id }],
      changes: [],
    }, { connectionId: null, provider: "test", model: "test" });
    expect(Object.values(fresh.actors)[0]).toMatchObject({ kind: "npc", characterId: null });
  });

  it("does not create actors from unverified change subjects or targets", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const first = message("m1", 0, "Mira remembers a stranger.");
    const records = materializeAnalysisRecords(timeline, [first], "root", {
      actorMentions: [],
      changes: [
        { subjectRef: "Invented Actor", category: "goal", operation: "add", text: "Appear", messageId: first.id },
        { subjectRef: actor.id, category: "relationship", operation: "add", text: "Distrusts a stranger", targetRefs: ["Invented Target"], messageId: first.id },
      ],
    }, { connectionId: null, provider: "test", model: "test" });

    expect(Object.values(timeline.actors)).toHaveLength(1);
    expect(records[0].deltas).toHaveLength(1);
    expect(records[0].deltas[0].targetActorIds).toEqual([]);
  });
});

describe("timeline reducer", () => {
  it("holds a trailing user turn until an assistant response is committed", () => {
    const messages = [
      message("m1", 0, "First user turn"),
      message("m2", 1, "First assistant response"),
      message("m3", 2, "Second user turn"),
    ];

    expect(selectCompletedAssistantTranscript(messages).map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("releases the complete turn once its assistant response exists", () => {
    const messages = [
      message("m1", 0, "First user turn"),
      message("m2", 1, "First assistant response"),
      message("m3", 2, "Second user turn"),
      message("m4", 3, "Second assistant response"),
    ];

    expect(selectCompletedAssistantTranscript(messages).map((entry) => entry.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("holds all messages when no assistant response has been committed", () => {
    const messages: ChatMessageLike[] = [
      { id: "m2", role: "user", content: "Follow-up", index_in_chat: 1, swipe_id: 0 },
      { id: "m1", role: "user", content: "Opening", index_in_chat: 0, swipe_id: 0 },
    ];

    expect(selectCompletedAssistantTranscript(messages)).toEqual([]);
  });

  it("does not treat an empty staged assistant message as a completed response", () => {
    const messages: ChatMessageLike[] = [
      { id: "m1", role: "user", content: "Opening", index_in_chat: 0, swipe_id: 0 },
      { id: "m2", role: "assistant", content: "", index_in_chat: 1, swipe_id: 0 },
    ];

    expect(selectCompletedAssistantTranscript(messages)).toEqual([]);
  });

  it("invalidates incompatible content hashes", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const first = message("m1", 0, "The latch would not move.");
    timeline.records = [record(first, "root", [delta(actor.id, first.id, 0)])];
    let result = rebuildTimeline(timeline, [first]);
    expect(result.firstMissingIndex).toBe(1);
    expect(timeline.minds[actor.id].items).toHaveLength(1);

    const edited = { ...first, content: "The door stood open." };
    result = rebuildTimeline(timeline, [edited]);
    expect(result.firstMissingIndex).toBe(0);
    expect(timeline.records).toHaveLength(1);
    expect(timeline.minds[actor.id].items).toHaveLength(0);
  });

  it("keeps user overrides locked across a deterministic rebuild", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const first = message("m1", 0, "The latch would not move.");
    timeline.records = [record(first, "root", [delta(actor.id, first.id, 0)])];
    rebuildTimeline(timeline, [first]);
    const inferred = timeline.minds[actor.id].items[0];
    expect(overrideItem(timeline, actor.id, inferred.id, (item) => ({ ...item, text: "She believes Aster locked it", locked: true }))).toBe(true);
    rebuildTimeline(timeline, [first]);
    expect(timeline.minds[actor.id].items[0]).toMatchObject({ text: "She believes Aster locked it", locked: true, source: "manual" });
  });

  it("adds manual entries as locked and pinned", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    addManualItem(timeline, actor.id, "goal", "Find the missing key");
    rebuildTimeline(timeline, []);
    expect(timeline.minds[actor.id].items[0]).toMatchObject({ category: "goal", locked: true, pinned: true, source: "manual" });
  });

  it("lets later controller records update an unlocked pinned manual override", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    addManualItem(timeline, actor.id, "goal", "Find the missing key");
    rebuildTimeline(timeline, []);
    const manual = timeline.minds[actor.id].items[0];
    expect(overrideItem(timeline, actor.id, manual.id, (item) => ({ ...item, locked: false }))).toBe(true);
    timeline.manualOverrides[0].createdAt = 10;
    timeline.manualOverrides[1].createdAt = 20;

    const first = message("m1", 0, "Mira decides the key is no longer worth finding.");
    const update = record(first, "root", [delta(actor.id, first.id, 0, {
      category: "goal",
      operation: "update",
      targetItemId: manual.id,
      text: "Abandon the search for the missing key",
    })]);
    update.createdAt = 30;
    timeline.records = [update];
    rebuildTimeline(timeline, [first]);

    expect(timeline.minds[actor.id].items[0]).toMatchObject({
      text: "Abandon the search for the missing key",
      locked: false,
      pinned: true,
      source: "manual",
    });
    const compact = compactStateForController(timeline) as Array<{ ref: string; items: Array<{ id: string; controllerWritable: boolean }> }>;
    expect(compact.find((entry) => entry.ref === actor.id)?.items[0].controllerWritable).toBe(true);
  });

  it("rewrites exact and near-duplicate additions instead of appending them", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const first = message("m1", 0, "Mira wants to escape the tower.");
    const second = message("m2", 1, "She studies the tower exit.");
    const firstRecord = record(first, "root", [delta(actor.id, first.id, 0, {
      category: "goal",
      text: "Wants to escape the tower",
    })]);
    const secondRecord = record(second, nextPrefixHash("root", firstRecord.contentHash, 0), [delta(actor.id, second.id, 1, {
      category: "goal",
      text: "Escape the tower",
    })]);
    timeline.records = [firstRecord, secondRecord];

    rebuildTimeline(timeline, [first, second]);

    expect(timeline.minds[actor.id].items).toHaveLength(1);
    expect(timeline.minds[actor.id].items[0]).toMatchObject({ id: `delta:${first.id}`, text: "Escape the tower" });
    expect(secondRecord.reduction).toMatchObject({ entriesUpdated: 1 });
  });

  it("keeps genuinely distinct state in the same category", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const first = message("m1", 0, "Mira studies the tower.");
    const second = message("m2", 1, "Mira searches for a key.");
    const firstRecord = record(first, "root", [delta(actor.id, first.id, 0, { category: "goal", text: "Escape the tower" })]);
    timeline.records = [
      firstRecord,
      record(second, nextPrefixHash("root", firstRecord.contentHash, 0), [
        delta(actor.id, second.id, 1, { category: "goal", text: "Find the missing key" }),
      ]),
    ];

    rebuildTimeline(timeline, [first, second]);

    expect(timeline.minds[actor.id].items.map((item) => item.text)).toEqual(["Escape the tower", "Find the missing key"]);
  });

  it("maintains one current relationship entry per target", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const target = upsertActor(timeline, { kind: "npc", name: "Aster" });
    const first = message("m1", 0, "Mira trusts Aster.");
    const second = message("m2", 1, "Mira realizes Aster lied.");
    const firstRecord = record(first, "root", [delta(actor.id, first.id, 0, {
      category: "relationship",
      text: "Trusts Aster",
      targetActorIds: [target.id],
    })]);
    const secondRecord = record(second, nextPrefixHash("root", firstRecord.contentHash, 0), [delta(actor.id, second.id, 1, {
      category: "relationship",
      text: "No longer trusts Aster",
      targetActorIds: [target.id],
    })]);
    timeline.records = [firstRecord, secondRecord];

    rebuildTimeline(timeline, [first, second]);

    expect(timeline.minds[actor.id].items).toHaveLength(1);
    expect(timeline.minds[actor.id].items[0].text).toBe("No longer trusts Aster");
    expect(secondRecord.reduction).toMatchObject({ entriesSuperseded: 1 });
  });

  it("rejects targetless updates rather than turning them into additions", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const first = message("m1", 0, "Mira changes her mind.");
    const invalidRecord = record(first, "root", [delta(actor.id, first.id, 0, {
      operation: "update",
      targetItemId: null,
      text: "The door is open",
    })]);
    timeline.records = [invalidRecord];

    rebuildTimeline(timeline, [first]);

    expect(timeline.minds[actor.id].items).toEqual([]);
    expect(invalidRecord.reduction).toMatchObject({
      invalidChangesRejected: 1,
      invalidChangeReasons: { missing_target_id: 1 },
    });
  });

  it("keeps protected seed and manual entries authoritative while compacting controller duplicates", () => {
    const timeline = createTimeline("chat");
    const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const seed = makeEmptySeed();
    seed.startingGoals = ["Escape the tower"];
    timeline.baseMinds[actor.id] = makeBaseMind(actor.id, seed);
    const first = message("m1", 0, "Mira seeks an escape.");
    const seedDuplicate = record(first, "root", [delta(actor.id, first.id, 0, {
      category: "goal",
      text: "Wants to escape the tower",
    })]);
    timeline.records = [seedDuplicate];
    rebuildTimeline(timeline, [first]);
    expect(timeline.minds[actor.id].items).toHaveLength(1);
    expect(timeline.minds[actor.id].items[0]).toMatchObject({ source: "seed", locked: true, text: "Escape the tower" });
    expect(seedDuplicate.reduction).toMatchObject({ duplicatesSuppressed: 1 });

    const manualTimeline = createTimeline("manual-chat");
    const manualActor = upsertActor(manualTimeline, { kind: "npc", name: "Mira" });
    const controllerMessage = message("m1", 0, "Mira searches for a key.");
    manualTimeline.records = [record(controllerMessage, "root", [delta(manualActor.id, controllerMessage.id, 0, {
      category: "goal",
      text: "Find the missing key",
    })])];
    rebuildTimeline(manualTimeline, [controllerMessage]);
    addManualItem(manualTimeline, manualActor.id, "goal", "Wants to find the missing key");
    rebuildTimeline(manualTimeline, [controllerMessage]);
    expect(manualTimeline.minds[manualActor.id].items).toHaveLength(1);
    expect(manualTimeline.minds[manualActor.id].items[0]).toMatchObject({ source: "manual", locked: true, pinned: true });
  });

  it("checkpoints unmanaged user messages without exposing controller records", () => {
    const timeline = createTimeline("chat");
    const userMessage = message("m1", 0, "The user opens the door.");
    timeline.records = materializeSkippedAnalysisRecords(
      timeline,
      [userMessage],
      "root",
      "unmanaged_user_message",
    );

    expect(rebuildTimeline(timeline, [userMessage]).firstMissingIndex).toBe(1);
    expect(timeline.records[0].skipReason).toBe("unmanaged_user_message");
    expect(toTimelineView(timeline, { ...DEFAULT_SETTINGS, personaMindEnabled: false }).records).toEqual([]);
  });

  it("checkpoints an intentionally skipped activation prefix without exposing it in Mind Lens", () => {
    const timeline = createTimeline("existing-chat");
    const messages = Array.from({ length: 600 }, (_, index) => message(`m${index}`, index, `Committed message ${index}`));
    timeline.records = materializeSkippedAnalysisRecords(
      timeline,
      messages.slice(0, 550),
      "root",
      "pre_activation_history",
    );

    const replay = rebuildTimeline(timeline, messages);
    expect(replay.firstMissingIndex).toBe(550);
    expect(timeline.lastValidMessageIndex).toBe(549);
    expect(timeline.records).toHaveLength(550);
    expect(timeline.records.every((entry) => entry.skipReason === "pre_activation_history")).toBe(true);
    expect(toTimelineView(timeline).records).toEqual([]);
  });
});

describe("hashing, settings, and compaction", () => {
  it("normalizes mind text without language-specific token tables", () => {
    expect(canonicalMindText("  Ｅｌａｎ—東京！ ")).toBe("elan 東京");
    expect(mindTextsNearDuplicate("Wants to escape the tower", "Escape the tower")).toBe(true);
    expect(mindTextsNearDuplicate("afraid", "fearful")).toBe(false);
  });

  it("produces deterministic branch hashes", () => {
    expect(stableHash("same")).toBe(stableHash("same"));
    expect(nextPrefixHash("a", "b", 0)).not.toBe(nextPrefixHash("a", "b", 1));
  });

  it("normalizes limits without imposing former message or token ceilings", () => {
    const settings = normalizeSettings({
      controllerTemperature: 9,
      controllerMaxTokens: 20,
      analysisStateTokenBudget: 240_000,
      injectionTokenBudget: 80_000,
      analysisContextMessageLimit: 99,
      chatHistoryMessageLimit: 1200,
    });
    expect(settings).toMatchObject({
      controllerTemperature: 2,
      controllerMaxTokens: 300,
      analysisStateTokenBudget: 240_000,
      injectionTokenBudget: 80_000,
      analysisContextMessageLimit: 99,
      chatHistoryMessageLimit: 1200,
      personaMindEnabled: true,
      characterCardDirectorMode: false,
    });
    expect(normalizeSettings({ personaMindEnabled: false, characterCardDirectorMode: true })).toMatchObject({
      personaMindEnabled: false,
      characterCardDirectorMode: true,
      analysisStateTokenBudget: 24_000,
      injectionTokenBudget: 8_000,
      analysisContextMessageLimit: 4,
      chatHistoryMessageLimit: 0,
    });
    expect(normalizeSettings({ analysisStateTokenBudget: 0, injectionTokenBudget: 0 })).toMatchObject({
      analysisStateTokenBudget: 0,
      injectionTokenBudget: 0,
    });
    expect(normalizeSettings({ analysisContextMessageLimit: -4 }).analysisContextMessageLimit).toBe(0);
    expect(normalizeSettings({ chatHistoryMessageLimit: -4 }).chatHistoryMessageLimit).toBe(0);
    expect(normalizeSettings({ controllerMaxTokens: 128000 }).controllerMaxTokens).toBe(128000);
    expect(normalizeSettings({ injectionPosition: "before_last_user" }).injectionPosition).toBe("before_last_user");
    expect(normalizeSettings({ injectionPosition: "unsupported" }).injectionPosition).toBe("prompt_start");
    expect(analysisPolicyHash(DEFAULT_SETTINGS)).toBe(stableHash("ledger-policy:1|persona:1|director:0"));
    expect(analysisPolicyHash({ ...DEFAULT_SETTINGS, characterCardDirectorMode: true })).toBe(stableHash("ledger-policy:1|director-policy:3|persona:1|director:1"));
    expect(analysisPolicyHash({ ...DEFAULT_SETTINGS, personaMindEnabled: false })).toBe(stableHash("ledger-policy:1|persona-policy:2|persona:0|director:0"));
    expect(analysisPolicyHash(DEFAULT_SETTINGS)).not.toBe(analysisPolicyHash({ ...DEFAULT_SETTINGS, characterCardDirectorMode: true }));
  });

  it("selects each supported private-mind insertion position", () => {
    const messages = [{ role: "system" }, { role: "user" }, { role: "assistant" }, { role: "user" }];
    expect(mindInjectionIndex(messages, "prompt_start")).toBe(0);
    expect(mindInjectionIndex(messages, "before_last_user")).toBe(3);
    expect(mindInjectionIndex(messages, "prompt_end")).toBe(4);
    expect(mindInjectionIndex([{ role: "system" }], "before_last_user")).toBe(1);
  });

  it("creates a sequel checkpoint from the exported folded state", () => {
    const source = createTimeline("source");
    source.active = true;
    const actor = upsertActor(source, { kind: "npc", name: "Mira", cortexEntityId: "source-entity" });
    source.suppressedCortexEntityIds = ["source-hidden"];
    addManualItem(source, actor.id, "goal", "Reach the northern city");
    rebuildTimeline(source, []);

    const checkpoint = createCheckpointTimeline(source, "sequel");

    expect(checkpoint).toMatchObject({ chatId: "sequel", active: true, records: [], manualOverrides: [] });
    expect(checkpoint.baseMinds[actor.id].items[0].text).toBe("Reach the northern city");
    expect(checkpoint.minds[actor.id].items[0].text).toBe("Reach the northern city");
    expect(checkpoint.actors[actor.id].cortexEntityId).toBeNull();
    expect(checkpoint.suppressedCortexEntityIds).toEqual([]);
  });

  it("replays 500+ messages for 12 actors deterministically and projects without deleting state", async () => {
    const timeline = createTimeline("long-chat");
    timeline.active = true;
    const actors = Array.from({ length: 12 }, (_, index) => upsertActor(timeline, {
      kind: "npc",
      name: `Actor ${index + 1}`,
      aliases: [`Callsign ${index + 1}`],
    }));
    const messages = Array.from({ length: 504 }, (_, index) => message(
      `message-${index}`,
      index,
      `Actor ${(index % actors.length) + 1} records event ${index} in the ongoing scene.`,
    ));
    const selectedForAnalysis: ChatMessageLike[] = [];
    for (let cursor = 0; cursor < messages.length;) {
      const batch = selectAnalysisWorkBatch(messages, cursor, 6, DEFAULT_SETTINGS);
      expect(batch.messages.length).toBeGreaterThan(0);
      expect(batch.messages.length).toBeLessThanOrEqual(6);
      selectedForAnalysis.push(...batch.messages);
      cursor += batch.messages.length;
    }
    expect(selectedForAnalysis.map((entry) => entry.id)).toEqual(messages.map((entry) => entry.id));
    let prefixHash = "root";
    timeline.records = messages.map((entry, index) => {
      const actor = actors[index % actors.length];
      const next = record(entry, prefixHash, [delta(actor.id, entry.id, index, {
        id: `delta-${index}`,
        text: `Cipherword${index} waypoint${index} consequence${index} private-state-${index} remains unresolved`,
      })]);
      prefixHash = nextPrefixHash(prefixHash, next.contentHash, next.swipeId);
      return next;
    });

    const firstReplay = rebuildTimeline(timeline, messages);
    expect(firstReplay.firstMissingIndex).toBe(504);
    expect(Object.values(timeline.minds).reduce((sum, mind) => sum + mind.items.length, 0)).toBe(504);
    expect(actors.every((actor) => resolveActorId(timeline.actors, actor.canonicalName) === actor.id)).toBe(true);
    const storedRecords = JSON.stringify(timeline.records);
    const storedMinds = JSON.stringify(timeline.minds);

    const secondReplay = rebuildTimeline(timeline, messages);
    expect(secondReplay.firstMissingIndex).toBe(504);
    expect(JSON.stringify(timeline.records)).toBe(storedRecords);
    expect(JSON.stringify(timeline.minds)).toBe(storedMinds);

    const compact = compactStateForController(timeline);
    const projected = await projectControllerState(
      compact,
      [messages.at(-1)!],
      messages.slice(-8, -1),
      DEFAULT_SETTINGS.analysisStateTokenBudget,
      countByCharacters,
    );
    expect(projected.telemetry).toMatchObject({
      tokenBudget: 24_000,
      itemsAvailable: 504,
      actorCount: 12,
      tokenModel: "test-model",
      tokenizerName: "test-tokenizer",
    });
    expect(projected.telemetry.totalTokens).toBeLessThanOrEqual(24_000);
    expect(projected.telemetry.itemsOmitted).toBeGreaterThan(0);
    expect(projected.state).toEqual(expect.arrayContaining(actors.map((actor) => expect.objectContaining({ ref: actor.id }))));
    expect(JSON.stringify(timeline.records)).toBe(storedRecords);
    expect(JSON.stringify(timeline.minds)).toBe(storedMinds);

    const unlimited = await projectControllerState(compact, [messages.at(-1)!], [], 0, countByCharacters);
    expect(unlimited.telemetry).toMatchObject({ itemsAvailable: 504, itemsIncluded: 504, itemsOmitted: 0 });
    const unlimitedActors = unlimited.state as Array<{ ref: string; items?: unknown[] }>;
    expect(unlimitedActors.find((actor) => actor.ref === actors[0].id)?.items?.length).toBe(42);
  });

  it("ranks protected and relevant state, allocates relevant actors fairly, and keeps every actor stub", async () => {
    const item = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
      id,
      category: "belief",
      text,
      controllerWritable: true,
      ...extra,
    });
    const compact = [
      {
        ref: "mira",
        name: "Mira",
        aliases: [],
        present: true,
        items: [
          item("mira-protected", "Mira guards the obsidian key", { locked: true, pinned: true, controllerWritable: false }),
          ...Array.from({ length: 8 }, (_, index) => item(`mira-${index}`, `Mira detail ${index} with extended private nuance`)),
        ],
      },
      {
        ref: "aster",
        name: "Aster",
        aliases: [],
        present: true,
        items: Array.from({ length: 9 }, (_, index) => item(`aster-${index}`, `Aster clue ${index} about the obsidian key`)),
      },
      {
        ref: "rowan",
        name: "Rowan",
        aliases: [],
        present: false,
        items: Array.from({ length: 9 }, (_, index) => item(`rowan-${index}`, `Rowan unrelated detail ${index}`)),
      },
    ];
    const base = await projectControllerState(compact, [], [], 1, countByCharacters);
    const projected = await projectControllerState(
      compact,
      [{ id: "current", role: "assistant", content: "Mira shows Aster the obsidian key." }],
      [],
      base.telemetry.totalTokens + 190,
      countByCharacters,
    );
    const actors = projected.state as Array<{ ref: string; items: Array<{ id: string }> }>;
    expect(actors.map((actor) => actor.ref)).toEqual(["mira", "aster", "rowan"]);
    expect(actors.find((actor) => actor.ref === "mira")?.items.map((entry) => entry.id)).toContain("mira-protected");
    expect(actors.find((actor) => actor.ref === "mira")?.items.length).toBeGreaterThan(0);
    expect(actors.find((actor) => actor.ref === "aster")?.items.length).toBeGreaterThan(0);
    expect(projected.telemetry.itemsOmitted).toBeGreaterThan(0);
  });

  it("prioritizes the generation target while retaining headings for every present actor", async () => {
    const timeline = createTimeline("projection-chat");
    timeline.active = true;
    const target = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const relevant = upsertActor(timeline, { kind: "npc", name: "Aster" });
    const other = upsertActor(timeline, { kind: "npc", name: "Rowan" });
    const headingOnly = upsertActor(timeline, { kind: "npc", name: "Selene" });
    for (const actor of [target, relevant, other]) {
      const seed = makeEmptySeed();
      seed.startingGoals = Array.from(
        { length: actor.id === target.id ? 24 : 8 },
        (_, index) => `${actor.canonicalName} private objective ${index} with extended nuance`,
      );
      timeline.baseMinds[actor.id] = makeBaseMind(actor.id, seed);
    }
    timeline.baseMinds[headingOnly.id] = makeBaseMind(headingOnly.id, makeEmptySeed());
    rebuildTimeline(timeline, []);
    for (const actor of [target, relevant, other, headingOnly]) timeline.actors[actor.id].present = true;
    const base = await buildProjectedMindInjection(
      timeline,
      target.id,
      { ...DEFAULT_SETTINGS, injectionTokenBudget: 1 },
      [{ content: "Mira confides in Aster." }],
      countByCharacters,
    );
    const projection = await buildProjectedMindInjection(
      timeline,
      target.id,
      { ...DEFAULT_SETTINGS, injectionTokenBudget: base.telemetry.totalTokens + 100 },
      [{ content: "Mira confides in Aster." }],
      countByCharacters,
    );
    expect(projection.content).toContain("Mira (npc, present)");
    expect(projection.content).toContain("Aster (npc, present)");
    expect(projection.content).toContain("Rowan (npc, present)");
    expect(projection.content).toContain("Selene (npc, present)");
    expect(projection.content).toContain("Mira private objective");
    expect(projection.telemetry.itemsIncluded).toBeGreaterThan(0);
    expect(projection.telemetry.itemsOmitted).toBeGreaterThan(0);

    const defaults = await buildProjectedMindInjection(
      timeline,
      target.id,
      DEFAULT_SETTINGS,
      [],
      countByCharacters,
    );
    expect(defaults.telemetry).toMatchObject({ tokenBudget: 8_000, itemsAvailable: 40, itemsIncluded: 40, itemsOmitted: 0 });
    expect(defaults.content).toContain("Mira private objective 23 with extended nuance");

    const unlimited = await buildProjectedMindInjection(
      timeline,
      target.id,
      { ...DEFAULT_SETTINGS, injectionTokenBudget: 0 },
      [],
      countByCharacters,
    );
    expect(unlimited.telemetry).toMatchObject({ itemsAvailable: 40, itemsIncluded: 40, itemsOmitted: 0 });
    expect(unlimited.content).toContain("Mira private objective 23 with extended nuance");
  });

  it("routes unmanaged user turns to checkpoints and keeps them out of controller batches", () => {
    const messages = [
      message("m1", 0, "User turn"),
      message("m2", 1, "Assistant turn"),
      message("m3", 2, "Another user turn"),
      message("m4", 3, "Another assistant turn"),
    ];
    const settings = { ...DEFAULT_SETTINGS, personaMindEnabled: false };

    expect(selectAnalysisWorkBatch(messages, 0, 8, settings)).toMatchObject({
      messages: [messages[0]],
      skipReason: "unmanaged_user_message",
    });
    expect(selectAnalysisWorkBatch(messages, 1, 8, settings)).toMatchObject({
      messages: [messages[1]],
      skipReason: null,
    });
    expect(selectAnalysisWorkBatch(messages, 0, 8, DEFAULT_SETTINGS).messages).toEqual(messages);
  });

  it("limits analysis context to messages before the current batch", () => {
    const messages = [
      message("m1", 0, "First"),
      message("m2", 1, "Second"),
      message("m3", 2, "Third"),
      message("m4", 3, "Current batch"),
    ];

    expect(selectAnalysisRecentContext(messages, 3, 2)).toEqual([messages[1], messages[2]]);
    expect(selectAnalysisRecentContext(messages, 3, 0)).toEqual([]);
    expect(selectAnalysisRecentContext(messages, 0, 10)).toEqual([]);
  });

  it("limits only host-marked chat history while preserving assembled prompt content", () => {
    const prompt: Array<{ id: string; __isChatHistory?: boolean }> = [
      { id: "system" },
      { id: "history-1", __isChatHistory: true },
      { id: "world-info" },
      { id: "history-2", __isChatHistory: true },
      { id: "history-3", __isChatHistory: true },
      { id: "authors-note" },
    ];

    expect(limitChatHistoryMessages(prompt, 2).map((entry) => entry.id)).toEqual([
      "system",
      "world-info",
      "history-2",
      "history-3",
      "authors-note",
    ]);
    expect(limitChatHistoryMessages(prompt, 0)).toBe(prompt);
  });

  it("injects all unresolved state for every present managed actor", () => {
    const timeline = createTimeline("chat");
    timeline.active = true;
    const actor = upsertActor(timeline, { kind: "character", name: "Aster", characterId: "card" });
    const seed = makeEmptySeed({ selfConcept: "A scholar who measures every word." });
    seed.startingBeliefs = Array.from({ length: 30 }, (_, index) => `Detailed private belief ${index} with supporting nuance`);
    timeline.baseMinds[actor.id] = makeBaseMind(actor.id, seed);
    const npc = upsertActor(timeline, { kind: "npc", name: "Mira" });
    const npcSeed = makeEmptySeed({ selfConcept: "A vigilant scout." });
    npcSeed.startingGoals = ["Protect the caravan"];
    timeline.baseMinds[npc.id] = makeBaseMind(npc.id, npcSeed);
    const absentNpc = upsertActor(timeline, { kind: "npc", name: "Rowan" });
    const absentSeed = makeEmptySeed({ selfConcept: "An absent courier." });
    absentSeed.startingGoals = ["Deliver the sealed letter"];
    timeline.baseMinds[absentNpc.id] = makeBaseMind(absentNpc.id, absentSeed);
    rebuildTimeline(timeline, []);
    timeline.actors[actor.id].present = true;
    timeline.actors[npc.id].present = true;
    timeline.minds[actor.id].items.push({
      ...timeline.minds[actor.id].items[0],
      id: "resolved-item",
      text: "This resolved state must not be injected",
      status: "resolved",
    });
    const injection = buildMindInjection(timeline, actor.id);
    expect(injection).toContain("private subjective continuity");
    expect(injection).toContain("Detailed private belief 29 with supporting nuance");
    expect(injection).toContain("Mira (npc, present)");
    expect(injection).toContain("Protect the caravan");
    expect(injection).not.toContain("A scholar who measures every word");
    expect(injection).not.toContain("A vigilant scout");
    expect(injection).not.toContain("Rowan");
    expect(injection).not.toContain("Deliver the sealed letter");
    expect(injection).not.toContain("This resolved state must not be injected");
    timeline.minds[actor.id].items.push({
      ...timeline.minds[actor.id].items[0],
      id: "controller-item",
      text: "A newly inferred writable state",
      source: "controller",
      locked: false,
      pinned: false,
    });
    const compact = compactStateForController(timeline) as Array<{
      ref: string;
      items?: Array<{ id: string; controllerWritable: boolean }>;
    }>;
    const compactItems = compact.find((entry) => entry.ref === actor.id)?.items ?? [];
    expect(compactItems).toHaveLength(31);
    expect(compactItems.find((item) => item.id === "controller-item")?.controllerWritable).toBe(true);
    expect(compactItems.filter((item) => item.id !== "controller-item").every((item) => item.controllerWritable === false)).toBe(true);
  });

  it("does not inject self-concept-only minds into main generation", () => {
    const timeline = createTimeline("chat");
    timeline.active = true;
    const actor = upsertActor(timeline, { kind: "character", name: "Aster", characterId: "card" });
    timeline.baseMinds[actor.id] = makeBaseMind(actor.id, makeEmptySeed({ selfConcept: "A concise version of the character card." }));
    rebuildTimeline(timeline, []);
    timeline.actors[actor.id].present = true;

    expect(buildMindInjection(timeline, actor.id)).toBeNull();
    const guardedInjection = buildMindInjection(timeline, actor.id, { ...DEFAULT_SETTINGS, personaMindEnabled: false });
    expect(guardedInjection).toContain("The user persona is unmanaged");
    expect(guardedInjection).not.toContain("A concise version of the character card");
    expect(guardedInjection).not.toContain("Aster (character");
  });

  it("keeps disabled host minds dormant and builds a director ensemble from portrayed actors", () => {
    const timeline = createTimeline("chat");
    timeline.active = true;
    const card = upsertActor(timeline, { kind: "character", name: "The Director", characterId: "card" });
    const persona = upsertActor(timeline, { kind: "persona", name: "Player", personaId: "persona" });
    const npc = upsertActor(timeline, { kind: "character", name: "Mira" });
    const seed = makeEmptySeed({ selfConcept: "A wary scout who watches every doorway." });
    seed.startingGoals = ["Protect the caravan"];
    timeline.baseMinds[npc.id] = makeBaseMind(npc.id, seed);
    rebuildTimeline(timeline, []);
    timeline.actors[card.id].present = true;
    timeline.actors[npc.id].present = true;
    const settings = { ...DEFAULT_SETTINGS, personaMindEnabled: false, characterCardDirectorMode: true };

    const view = toTimelineView(timeline, settings);
    expect(view.actors.map((actor) => actor.id)).toEqual([npc.id]);
    expect(view.minds[card.id]).toBeUndefined();
    expect(view.minds[persona.id]).toBeUndefined();

    const compact = compactStateForController(timeline, settings) as Array<Record<string, unknown>>;
    expect(compact.find((actor) => actor.ref === card.id)).toMatchObject({ managed: false, contextRole: "director_card" });
    expect(compact.find((actor) => actor.ref === persona.id)).toMatchObject({ managed: false, contextRole: "context_only_persona" });
    expect(compact.find((actor) => actor.ref === npc.id)).toMatchObject({ managed: true, contextRole: "mind" });

    expect(buildMindInjection(timeline, card.id, { ...DEFAULT_SETTINGS, personaMindEnabled: false })).toContain("user persona is unmanaged");
    const injection = buildDirectorMindInjection(timeline, settings);
    expect(injection).toContain("private ensemble continuity");
    expect(injection).toContain("Mira");
    expect(injection).not.toContain("A wary scout who watches every doorway");
    expect(injection).not.toContain("The Director (character");
  });
});
