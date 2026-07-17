import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeMessages,
  applyControllerMindPolicy,
  isNontrivialAnalysisBatch,
  makeControllerResponseTelemetry,
  mergeControllerAnalyses,
  normalizeControllerAnalysis,
  parseJsonValue,
  sanitizeControllerText,
} from "./controller";
import { DEFAULT_SETTINGS } from "./engine";
import type { ChatMessageLike, ControllerAnalysis } from "./types";

afterEach(() => {
  delete (globalThis as Record<string, unknown>).spindle;
});

describe("controller response parsing", () => {
  it("accepts fenced JSON with provider chatter", () => {
    const parsed = parseJsonValue("Here is the result:\n```json\n{\"actorMentions\":[],\"changes\":[]}\n```\nDone.");
    expect(parsed).toEqual({ actorMentions: [], changes: [] });
  });

  it("strips common structured-output wrappers", () => {
    expect(sanitizeControllerText("```JSON\n{\"ok\":true}\n``` ")).toBe('{"ok":true}');
  });

  it("normalizes malformed optional fields without inventing changes", () => {
    const result = normalizeControllerAnalysis({
      actorMentions: [{ ref: "mira", name: "Mira", kind: "unknown", confidence: 4, present: true, messageId: "m1" }],
      changes: [{ subjectRef: "mira", category: "emotion", operation: "add", text: "Wary", confidence: -2, messageId: "m1" }],
    });
    expect(result.actorMentions[0]).toMatchObject({ kind: "npc", confidence: 1, present: true });
    expect(result.changes[0]).toMatchObject({ category: "emotion", confidence: 0, text: "Wary" });
  });

  it("detects substantive bootstrap batches without flagging trivial greetings", () => {
    expect(isNontrivialAnalysisBatch([{ id: "m1", role: "user", content: "hello" }])).toBe(false);
    expect(isNontrivialAnalysisBatch([{ id: "m1", role: "assistant", content: "A".repeat(400) }])).toBe(true);
  });

  it("reports raw entries rejected during normalization without storing raw text", () => {
    const parsed = { actorMentions: [{ name: "Missing message id" }], changes: [{ text: "Missing subject" }] };
    const accepted = normalizeControllerAnalysis(parsed);
    expect(makeControllerResponseTelemetry(JSON.stringify(parsed), parsed, accepted)).toMatchObject({
      rawActorMentions: 1,
      rawChanges: 1,
      acceptedActorMentions: 0,
      acceptedChanges: 0,
    });
  });

  it("merges corrective mentions while taking corrective state changes", () => {
    const first: ControllerAnalysis = {
      actorMentions: [{ ref: "aster", name: "Aster", messageId: "m1" }],
      changes: [],
    };
    const corrective: ControllerAnalysis = {
      actorMentions: [
        { ref: "aster", name: "Aster", messageId: "m1", present: true },
        { ref: "mira", name: "Mira", messageId: "m1" },
      ],
      changes: [{ subjectRef: "aster", category: "emotion", operation: "add", text: "Wary", messageId: "m1" }],
    };
    const merged = mergeControllerAnalyses(first, corrective);
    expect(merged.actorMentions).toHaveLength(2);
    expect(merged.changes).toHaveLength(1);
  });

  it("blocks disabled persona and director-card minds while treating portrayed characters as NPCs", () => {
    const analysis: ControllerAnalysis = {
      actorMentions: [
        { ref: "character:card", name: "The Director", kind: "character", messageId: "m1" },
        { ref: "persona:player", name: "Player", kind: "persona", messageId: "m1" },
        { ref: "mira", name: "Mira", kind: "character", messageId: "m1" },
      ],
      changes: [
        { subjectRef: "The Director", category: "goal", operation: "add", text: "Advance the plot", messageId: "m1" },
        { subjectRef: "Player", category: "emotion", operation: "add", text: "Afraid", messageId: "m1" },
        { subjectRef: "Mira", category: "emotion", operation: "add", text: "Wary", messageId: "m1" },
      ],
    };
    const state = [
      { ref: "character:card", name: "The Director", aliases: [], kind: "character", managed: false },
      { ref: "persona:player", name: "Player", aliases: [], kind: "persona", managed: false },
    ];
    const result = applyControllerMindPolicy(analysis, state, {
      ...DEFAULT_SETTINGS,
      personaMindEnabled: false,
      characterCardDirectorMode: true,
    });
    expect(result.actorMentions).toEqual([
      expect.objectContaining({ name: "Mira", kind: "npc" }),
    ]);
    expect(result.changes).toEqual([
      expect.objectContaining({ subjectRef: "Mira", text: "Wary" }),
    ]);
  });

  it.each(["assistant", "character:card"])("preserves a portrayed NPC when its controller ref collides with %s", (collidingRef) => {
    const analysis: ControllerAnalysis = {
      actorMentions: [{
        ref: collidingRef,
        name: "Mira",
        aliases: [],
        kind: "character",
        messageId: "m1",
      }],
      changes: [{
        subjectRef: collidingRef,
        category: "emotion",
        operation: "add",
        text: "Wary",
        messageId: "m1",
      }],
    };
    const result = applyControllerMindPolicy(analysis, [{
      ref: "character:card",
      name: "The Director",
      aliases: [],
      kind: "character",
      managed: false,
    }], {
      ...DEFAULT_SETTINGS,
      personaMindEnabled: false,
      characterCardDirectorMode: true,
    });
    expect(result.actorMentions).toEqual([
      expect.objectContaining({ ref: "Mira", name: "Mira", aliases: [], kind: "npc" }),
    ]);
    expect(result.changes).toEqual([
      expect.objectContaining({ subjectRef: "Mira", text: "Wary" }),
    ]);
  });

  it("runs exactly one corrective pass for an empty substantive bootstrap", async () => {
    const quiet = vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ actorMentions: [], changes: [] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({
        actorMentions: [],
        changes: [{
          subjectRef: "Aster",
          category: "emotion",
          operation: "add",
          targetItemId: null,
          text: "Wary of the unexpected visitor",
          status: "active",
          confidence: 0.82,
          targetRefs: [],
          concealedFromRefs: [],
          intensity: 0.55,
          dimensions: { valence: -0.3 },
          messageId: "m1",
          evidenceExcerpt: "Aster watched the doorway and lowered her voice.",
        }],
      }) });
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const messages: ChatMessageLike[] = [{ id: "m1", role: "assistant", content: "Aster watched the doorway and lowered her voice. ".repeat(10), index_in_chat: 0 }];
    const result = await analyzeMessages({ messages, recentContext: [], compactState: [], settings: DEFAULT_SETTINGS, userId: "user" });
    expect(quiet).toHaveBeenCalledTimes(2);
    expect(result.analysis.changes).toHaveLength(1);
    expect(result.telemetry).toMatchObject({ attempts: 2, finalChanges: 1, warningCodes: [] });
  });

  it("retains a valid first pass and warns when the corrective request fails", async () => {
    const quiet = vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ actorMentions: [], changes: [] }) })
      .mockRejectedValueOnce(new Error("temporary provider failure"));
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const messages: ChatMessageLike[] = [{ id: "m1", role: "assistant", content: "B".repeat(500), index_in_chat: 0 }];
    const result = await analyzeMessages({ messages, recentContext: [], compactState: [], settings: DEFAULT_SETTINGS, userId: "user" });
    expect(result.analysis.changes).toEqual([]);
    expect(result.telemetry.warningCodes).toEqual(expect.arrayContaining(["retry_failed", "empty_nontrivial_batch"]));
    expect(result.telemetry.retryError).toBe("temporary provider failure");
  });
});
