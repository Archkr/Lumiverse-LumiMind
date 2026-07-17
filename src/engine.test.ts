import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  addManualItem,
  analysisPolicyHash,
  buildDirectorMindInjection,
  buildMindInjection,
  compactStateForController,
  createTimeline,
  makeBaseMind,
  makeEmptySeed,
  materializeAnalysisRecords,
  mergeActors,
  nextPrefixHash,
  normalizeSettings,
  normalizeTimeline,
  overrideItem,
  rebuildTimeline,
  resolveActorId,
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
});

describe("hashing, settings, and compaction", () => {
  it("produces deterministic branch hashes", () => {
    expect(stableHash("same")).toBe(stableHash("same"));
    expect(nextPrefixHash("a", "b", 0)).not.toBe(nextPrefixHash("a", "b", 1));
  });

  it("clamps persisted controller and budget settings", () => {
    const settings = normalizeSettings({ controllerTemperature: 9, controllerMaxTokens: 20, injectionTokenBudget: 99, secondaryActorLimit: 50 });
    expect(settings).toMatchObject({
      controllerTemperature: 2,
      controllerMaxTokens: 300,
      injectionTokenBudget: 400,
      secondaryActorLimit: 8,
      personaMindEnabled: true,
      characterCardDirectorMode: false,
    });
    expect(normalizeSettings({ personaMindEnabled: false, characterCardDirectorMode: true })).toMatchObject({
      personaMindEnabled: false,
      characterCardDirectorMode: true,
    });
    expect(normalizeSettings({ characterCardDirectorMode: true, secondaryActorLimit: 0 }).secondaryActorLimit).toBe(1);
    expect(analysisPolicyHash(DEFAULT_SETTINGS)).toBe(stableHash("persona:1|director:0"));
    expect(analysisPolicyHash({ ...DEFAULT_SETTINGS, characterCardDirectorMode: true })).toBe(stableHash("director-policy:3|persona:1|director:1"));
    expect(analysisPolicyHash(DEFAULT_SETTINGS)).not.toBe(analysisPolicyHash({ ...DEFAULT_SETTINGS, characterCardDirectorMode: true }));
  });

  it("keeps the injection within its approximate character budget", () => {
    const timeline = createTimeline("chat");
    timeline.active = true;
    const actor = upsertActor(timeline, { kind: "character", name: "Aster", characterId: "card" });
    const seed = makeEmptySeed({ selfConcept: "A scholar who measures every word." });
    seed.startingBeliefs = Array.from({ length: 30 }, (_, index) => `Detailed private belief ${index} with supporting nuance`);
    timeline.baseMinds[actor.id] = makeBaseMind(actor.id, seed);
    rebuildTimeline(timeline, []);
    const injection = buildMindInjection(timeline, actor.id, 400, 4);
    expect(injection).toContain("private subjective continuity");
    expect(injection?.length).toBeLessThanOrEqual(1600);
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

    expect(buildMindInjection(timeline, card.id, 400, 4, { ...DEFAULT_SETTINGS, personaMindEnabled: false })).toContain("user persona is unmanaged");
    expect(buildMindInjection(timeline, card.id, 400, 4, settings)).toBeNull();
    const injection = buildDirectorMindInjection(timeline, 400, 4, settings);
    expect(injection).toContain("private ensemble continuity");
    expect(injection).toContain("Mira");
    expect(injection).not.toContain("The Director (character");
  });
});
