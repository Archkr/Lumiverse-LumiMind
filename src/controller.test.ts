import { describe, expect, it } from "vitest";
import { normalizeControllerAnalysis, parseJsonValue, sanitizeControllerText } from "./controller";

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
});
