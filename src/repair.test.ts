import { describe, expect, it } from "vitest";
import { addManualItem, createTimeline, materializeAnalysisRecords, materializeSkippedAnalysisRecords, normalizeTimeline, rebuildTimeline, upsertActor } from "./engine";
import { beginRepair, previewRepair } from "./repair";
import type { ChatMessageLike, ControllerBatchTelemetry } from "./types";

function fixture() {
  const timeline = createTimeline("chat"); timeline.active = true;
  const messages: ChatMessageLike[] = Array.from({ length: 5 }, (_, index) => ({ id: `m${index}`, role: "assistant", content: `Mira waits ${index}`, index_in_chat: index }));
  const actor = upsertActor(timeline, { kind: "npc", name: "Mira" });
  timeline.records.push(...materializeSkippedAnalysisRecords(timeline, [messages[0]], "root", "pre_activation_history"));
  for (let i = 1; i < messages.length; i++) {
    const prefix = rebuildTimeline(timeline, messages).nextPrefix;
    timeline.records.push(...materializeAnalysisRecords(timeline, [messages[i]], prefix, { actorMentions: [], changes: [] }, {
      connectionId: null, provider: null, model: null, telemetry: { batchId: i <= 1 ? "healthy" : i <= 3 ? "warning" : "later", warningCodes: i === 3 ? ["normalization_drop"] : [] } as unknown as ControllerBatchTelemetry,
    }));
  }
  rebuildTimeline(timeline, messages);
  return { timeline, messages, actor };
}

describe("analysis repair", () => {
  it("previews the whole affected batch without mutating state", () => {
    const { timeline, messages } = fixture(); const before = structuredClone(timeline);
    expect(previewRepair(timeline, messages)).toMatchObject({ startMessageIndex: 2, messageCount: 3, resumed: false });
    expect(timeline).toEqual(before);
  });

  it("preserves the prefix and locked edits, archives the suffix, and resumes after reload", () => {
    const { timeline, messages, actor } = fixture();
    addManualItem(timeline, actor.id, "belief", "A locked correction");
    const oldRecords = structuredClone(timeline.records);
    beginRepair(timeline, messages, previewRepair(timeline, messages));
    expect(timeline.records).toEqual(oldRecords.slice(0, 2));
    expect(timeline.repair?.backupRecords).toEqual(oldRecords.slice(2));
    expect(timeline.minds[actor.id].items[0]).toMatchObject({ locked: true, text: "A locked correction" });
    const derivation = rebuildTimeline(timeline, messages);
    timeline.records.push(...materializeAnalysisRecords(timeline, [messages[2]], derivation.nextPrefix, { actorMentions: [], changes: [] }, { connectionId: null, provider: null, model: null }));
    const loaded = normalizeTimeline(JSON.parse(JSON.stringify(timeline)), "chat");
    expect(previewRepair(loaded, messages)).toMatchObject({ resumed: true, startMessageIndex: 3, messageCount: 2 });
    expect(rebuildTimeline(loaded, messages).firstMissingIndex).toBe(3);
  });

  it("rejects edits and revision changes made after confirmation preview", () => {
    const { timeline, messages } = fixture(); const preview = previewRepair(timeline, messages);
    expect(() => beginRepair(timeline, [{ ...messages[0], content: "Edited" }, ...messages.slice(1)], preview)).toThrow("timeline changed");
    timeline.revision++;
    expect(() => beginRepair(timeline, messages, preview)).toThrow("timeline changed");
  });

  it("ignores warnings on incompatible branches and handles legacy empty state after the cutoff", () => {
    const { timeline, messages } = fixture();
    for (const record of timeline.records) { if (record.controller.telemetry) record.controller.telemetry.warningCodes = []; }
    const stale = structuredClone(timeline.records[2]); stale.swipeId = 42; stale.controller.telemetry!.warningCodes = ["normalization_drop"];
    timeline.records.push(stale);
    expect(previewRepair(timeline, messages).startMessageIndex).toBeNull();
    timeline.records.pop();
    for (const record of timeline.records) delete record.controller.telemetry;
    expect(previewRepair(timeline, messages)).toMatchObject({ startMessageIndex: 1, messageCount: 4 });
  });

  it("does not turn a healthy timeline or intentional skipped history into a rebuild", () => {
    const { timeline, messages } = fixture();
    timeline.records = [timeline.records[0]];
    expect(previewRepair(timeline, messages).messageCount).toBe(0);
    expect(beginRepair(timeline, messages, previewRepair(timeline, messages)).startMessageIndex).toBeNull();
    expect(timeline.repair).toBeUndefined();
  });
});
