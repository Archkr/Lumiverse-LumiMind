import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  addManualItem,
  analysisPolicyHash,
  buildDirectorMindInjection,
  buildMindInjection,
  canonicalMindText,
  compactStateForController,
  createTimeline,
  limitChatHistoryMessages,
  makeBaseMind,
  makeEmptySeed,
  materializeAnalysisRecords,
  materializeSkippedAnalysisRecords,
  mergeActors,
  mindTextsNearDuplicate,
  nextPrefixHash,
  normalizeSettings,
  normalizeTimeline,
  overrideItem,
  rebuildTimeline,
  resolveActorId,
  selectAnalysisRecentContext,
  selectAnalysisWorkBatch,
  stableHash,
  toTimelineView,
  upsertActor,
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

  it("migrates controller-discovered character-shaped actors to timeline-local NPCs", () => {
    const timeline = createTimeline("chat");
    const legacy = upsertActor(timeline, { kind: "character", name: "Mira" });
    const normalized = normalizeTimeline(JSON.parse(JSON.stringify(timeline)), timeline.chatId);
    expect(normalized.actors[legacy.id]).toMatchObject({ kind: "npc", characterId: null });

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

  it("clamps persisted controller and analysis-context settings", () => {
    const settings = normalizeSettings({ controllerTemperature: 9, controllerMaxTokens: 20, analysisContextMessageLimit: 99, chatHistoryMessageLimit: 1200 });
    expect(settings).toMatchObject({
      controllerTemperature: 2,
      controllerMaxTokens: 300,
      analysisContextMessageLimit: 50,
      chatHistoryMessageLimit: 1000,
      personaMindEnabled: true,
      characterCardDirectorMode: false,
    });
    expect(normalizeSettings({ personaMindEnabled: false, characterCardDirectorMode: true })).toMatchObject({
      personaMindEnabled: false,
      characterCardDirectorMode: true,
      analysisContextMessageLimit: 4,
      chatHistoryMessageLimit: 0,
    });
    expect(normalizeSettings({ analysisContextMessageLimit: -4 }).analysisContextMessageLimit).toBe(0);
    expect(normalizeSettings({ chatHistoryMessageLimit: -4 }).chatHistoryMessageLimit).toBe(0);
    expect(analysisPolicyHash(DEFAULT_SETTINGS)).toBe(stableHash("ledger-policy:1|persona:1|director:0"));
    expect(analysisPolicyHash({ ...DEFAULT_SETTINGS, characterCardDirectorMode: true })).toBe(stableHash("ledger-policy:1|director-policy:3|persona:1|director:1"));
    expect(analysisPolicyHash({ ...DEFAULT_SETTINGS, personaMindEnabled: false })).toBe(stableHash("ledger-policy:1|persona-policy:2|persona:0|director:0"));
    expect(analysisPolicyHash(DEFAULT_SETTINGS)).not.toBe(analysisPolicyHash({ ...DEFAULT_SETTINGS, characterCardDirectorMode: true }));
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
    expect(injection).not.toContain("The Director (character");
  });
});
