import { describe, expect, it } from "vitest";
import type { FrontendState, MindSeedV1 } from "../types";
import {
  actorInitials,
  healthLabel,
  missingAnalysisPermissions,
  parseRelationshipLines,
  readReviewedSeed,
  relationshipLines,
  removeReviewedSeed,
  seedFromCharacterCard,
  summarizeTimelineQuality,
  uniqueLines,
  writeReviewedSeed,
} from "./helpers";
import type { TimelineView } from "../types";

function seed(): MindSeedV1 {
  return {
    schemaVersion: 1,
    core: {
      selfConcept: "A patient observer",
      values: ["Truth"],
      desires: ["Belonging"],
      fears: ["Exposure"],
      boundaries: ["No coercion"],
      notes: [],
    },
    startingBeliefs: ["The manor is safe"],
    startingSecrets: ["Knows the hidden passage"],
    startingGoals: ["Protect Mira"],
    relationshipPriors: [{ target: "Mira", stance: "Protective but guarded" }],
    updatedAt: 100,
  };
}

describe("Mind Seed extension persistence", () => {
  it("writes the versioned seed without overwriting sibling extension data", () => {
    const extensions = { lumi_mind: { display: { color: "violet" }, seed: { legacy: true } }, another: { enabled: true } };
    const next = writeReviewedSeed(extensions, seed());
    expect(readReviewedSeed(next)?.core.selfConcept).toBe("A patient observer");
    expect((next.lumi_mind as Record<string, unknown>).display).toEqual({ color: "violet" });
    expect(next.another).toEqual({ enabled: true });
  });

  it("removes only seed.v1", () => {
    const stored = writeReviewedSeed({ lumi_mind: { seed: { legacy: true }, keep: 7 } }, seed());
    const next = removeReviewedSeed(stored);
    expect(readReviewedSeed(next)).toBeNull();
    expect(next.lumi_mind).toEqual({ seed: { legacy: true }, keep: 7 });
  });

  it("builds a transient baseline from card fields", () => {
    const result = seedFromCharacterCard({ description: "  Watchful scholar  ", personality: "Dry wit", creator_notes: "Dry wit\nHates crowds" });
    expect(result.core.selfConcept).toBe("Watchful scholar");
    expect(result.core.notes).toEqual(["Dry wit", "Dry wit\nHates crowds"]);
    expect(result.startingSecrets).toEqual([]);
  });
});

describe("UI normalization", () => {
  it("deduplicates case-insensitively and drops blank lines", () => {
    expect(uniqueLines(" Truth \ntruth\n\n Mercy ")).toEqual(["Truth", "Mercy"]);
  });

  it("round-trips relationship lines", () => {
    const original = seed();
    expect(parseRelationshipLines(relationshipLines(original))).toEqual(original.relationshipPriors);
    expect(parseRelationshipLines("bad line\nMira :: Trusted\n :: empty")).toEqual([{ target: "Mira", stance: "Trusted" }]);
  });

  it("uses compact, stable actor initials", () => {
    expect(actorInitials("Mira Sol")).toBe("MS");
    expect(actorInitials("Aster")).toBe("AS");
    expect(actorInitials(" ")).toBe("?");
  });

  it("exposes user-facing timeline health labels", () => {
    expect(healthLabel("stale")).toBe("Using checkpoint");
    expect(healthLabel("error")).toBe("Needs attention");
  });

  it("reports only analysis-blocking permissions", () => {
    const state = {
      permissions: {
        generation: false,
        interceptor: true,
        chats: false,
        chatMutation: false,
        characters: false,
        personas: false,
        memories: false,
      },
    } as FrontendState;
    expect(missingAnalysisPermissions(state)).toEqual(["Generation", "Chat history"]);
  });

  it("flags legacy records that completed without producing any mind state", () => {
    const timeline = {
      records: [{
        id: "record",
        messageId: "m1",
        messageIndex: 0,
        swipeId: 0,
        createdAt: 1,
        changeCount: 0,
        mentionCount: 1,
        controller: { provider: "openrouter", model: "model", dedicatedConnection: true, telemetry: null },
      }],
      minds: {},
    } as unknown as TimelineView;
    expect(summarizeTimelineQuality(timeline)).toMatchObject({
      acceptedMentions: 1,
      acceptedChanges: 0,
      legacyEmptyResult: true,
      needsAttention: true,
    });
  });

  it("reports sanitized flood-control counters", () => {
    const telemetry = {
      schemaVersion: 1,
      batchId: "batch",
      messageCount: 1,
      inputChars: 100,
      nontrivial: true,
      attempts: 1,
      retryReason: null,
      first: {
        responseChars: 100,
        responseHash: "hash",
        rawActorMentions: 1,
        rawChanges: 3,
        acceptedActorMentions: 1,
        acceptedChanges: 2,
        duplicatesSuppressed: 1,
        invalidChangesRejected: 2,
        invalidChangeReasons: { unknown_subject: 2 },
      },
      retry: null,
      finalActorMentions: 1,
      finalChanges: 2,
      warningCodes: [],
      retryError: null,
    } as const;
    const timeline = {
      records: [{
        id: "record",
        messageId: "m1",
        messageIndex: 0,
        swipeId: 0,
        createdAt: 1,
        changeCount: 2,
        mentionCount: 1,
        reduction: {
          duplicatesSuppressed: 2,
          entriesUpdated: 3,
          entriesSuperseded: 1,
          invalidChangesRejected: 4,
          invalidChangeReasons: { missing_target_id: 3, protected_target: 1 },
        },
        controller: { provider: "openrouter", model: "model", dedicatedConnection: true, telemetry },
      }],
      minds: {},
    } as unknown as TimelineView;
    expect(summarizeTimelineQuality(timeline)).toMatchObject({
      duplicatesSuppressed: 3,
      entriesUpdated: 3,
      entriesSuperseded: 1,
      invalidChangesRejected: 6,
      invalidChangeReasons: { unknown_subject: 2, missing_target_id: 3, protected_target: 1 },
    });
  });
});
