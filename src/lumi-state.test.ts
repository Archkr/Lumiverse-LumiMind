import { describe, expect, test } from "vitest";
import { createActor, createTimeline, DEFAULT_SETTINGS } from "./engine";
import { makeMindLumiStateSnapshot } from "./lumi-state";

describe("LumiState mind publisher", () => {
  test("publishes cast identity links and spoiler-safe stance only", () => {
    const timeline = createTimeline("chat-1");
    timeline.active = true;
    timeline.health = "ready";
    timeline.revision = 8;
    const actor = createActor({
      kind: "character",
      name: "Mira",
      aliases: ["Captain"],
      characterId: "char-1",
      confirmed: true,
      confidence: 0.95,
    });
    actor.present = true;
    timeline.actors[actor.id] = actor;
    timeline.minds[actor.id] = {
      actorId: actor.id,
      core: { selfConcept: "", values: [], desires: [], fears: [], boundaries: [], notes: [] },
      items: [{
        id: "emotion-1",
        category: "emotion",
        text: "guarded but attentive",
        status: "active",
        confidence: 0.9,
        targetActorIds: [],
        concealedFromActorIds: [],
        intensity: 0.5,
        dimensions: {},
        evidence: { messageId: "message-1", swipeId: 0, excerpt: "", messageIndex: 1 },
        locked: false,
        pinned: false,
        source: "controller",
        createdAt: 1,
        updatedAt: 1,
      }, {
        id: "secret-1",
        category: "secret",
        text: "the hidden password",
        status: "active",
        confidence: 1,
        targetActorIds: [],
        concealedFromActorIds: [],
        intensity: null,
        dimensions: {},
        evidence: { messageId: "message-1", swipeId: 0, excerpt: "", messageIndex: 1 },
        locked: false,
        pinned: false,
        source: "controller",
        createdAt: 1,
        updatedAt: 1,
      }],
      sceneSummary: "",
      attention: "",
      presentActorIds: [],
      lastUpdatedMessageId: "message-1",
    };

    const snapshot = makeMindLumiStateSnapshot(timeline, DEFAULT_SETTINGS, "0.1.1", 2000);
    expect(snapshot).toMatchObject({ chatId: "chat-1", revision: 8, freshness: "fresh" });
    expect(snapshot.state.cast[0]).toMatchObject({
      name: "Mira",
      aliases: ["Captain"],
      present: true,
      publicStance: "guarded but attentive",
      links: [{ namespace: "host.character", id: "char-1", kind: "character" }],
    });
    expect(JSON.stringify(snapshot)).not.toContain("hidden password");
  });

  test("marks pending timelines stale", () => {
    const timeline = createTimeline("chat-1");
    timeline.health = "pending";
    expect(makeMindLumiStateSnapshot(timeline, DEFAULT_SETTINGS, "0.1.1").freshness).toBe("stale");
  });
});
