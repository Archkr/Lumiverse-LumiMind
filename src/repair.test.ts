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
  it("lets a 1160-message chat keep its first 1099 records even with warnings from message 1", () => {
    const timeline = createTimeline("chat"); timeline.active = true;
    const messages: ChatMessageLike[] = Array.from({ length: 1160 }, (_, index) => ({ id: `m${index}`, role: "assistant", content: `Mira waits ${index}`, index_in_chat: index }));
    timeline.records = materializeAnalysisRecords(timeline, messages, "root", { actorMentions: [], changes: [] }, {
      connectionId: null, model: null, provider: null,
      telemetry: { batchId: "warning", warningCodes: ["normalization_drop"] } as unknown as ControllerBatchTelemetry,
    });
    rebuildTimeline(timeline, messages);
    const before = structuredClone(timeline.records);
    const preview = previewRepair(timeline, messages);
    expect(preview.startMessageIndex).toBe(0);
    const selected = beginRepair(timeline, messages, { ...preview, startMessageIndex: 1099 });
    expect(selected).toMatchObject({ startMessageIndex: 1099, messageCount: 61 });
    expect(timeline.records).toEqual(before.slice(0, 1099));
    expect(timeline.repair?.backupRecords).toEqual(before.slice(1099));
    expect(rebuildTimeline(timeline, messages).firstMissingIndex).toBe(1099);
    expect(timeline.records[0].controller.telemetry?.warningCodes).toEqual(["normalization_drop"]);
  });

  it("honors an exact message inside a warning batch and keeps locked corrections and seeds", () => {
    const { timeline, messages, actor } = fixture();
    addManualItem(timeline, actor.id, "belief", "A locked correction");
    const baseMinds = structuredClone(timeline.baseMinds);
    const before = structuredClone(timeline.records);
    beginRepair(timeline, messages, { ...previewRepair(timeline, messages), startMessageIndex: 3 });
    expect(timeline.records).toEqual(before.slice(0, 3));
    expect(timeline.baseMinds).toEqual(baseMinds);
    expect(timeline.minds[actor.id].items[0]).toMatchObject({ locked: true, text: "A locked correction" });
  });

  it("uses actual message indices and rejects gaps, fractions, and out-of-range starts without mutations", () => {
    const { timeline, messages } = fixture();
    messages.forEach((message, index) => { message.index_in_chat = index * 2; });
    timeline.records.forEach((record, index) => { record.messageIndex = index * 2; });
    const preview = previewRepair(timeline, messages);
    expect(preview.messageIndices).toEqual([0, 2, 4, 6, 8]);
    expect(previewRepair(timeline, messages, 6)).toMatchObject({ startMessageIndex: 6, messageCount: 2 });
    const before = structuredClone(timeline);
    for (const startMessageIndex of [-1, 1, 1.5, 9, NaN, Infinity]) {
      expect(() => beginRepair(timeline, messages, { ...preview, startMessageIndex })).toThrow("Choose a message");
      expect(timeline).toEqual(before);
    }
  });

  it("rejects starting after missing or changed analysis instead of replaying earlier history silently", () => {
    const { timeline, messages } = fixture();
    messages[2].content = "Edited history";
    const preview = previewRepair(timeline, messages);
    expect(preview.maxStartMessageIndex).toBe(2);
    const before = structuredClone(timeline);
    expect(() => beginRepair(timeline, messages, { ...preview, startMessageIndex: 4 })).toThrow("Earlier analysis is missing or out of date");
    expect(timeline).toEqual(before);
  });

  it("allows an explicit range on healthy history and rejects an empty history", () => {
    const { timeline, messages } = fixture();
    for (const record of timeline.records) if (record.controller.telemetry) record.controller.telemetry.warningCodes = [];
    const preview = previewRepair(timeline, messages);
    expect(preview.startMessageIndex).toBeNull();
    expect(beginRepair(timeline, messages, { ...preview, startMessageIndex: 4 }).messageCount).toBe(1);
    expect(previewRepair(createTimeline("empty"), [])).toMatchObject({ messageIndices: [], maxStartMessageIndex: null });
    expect(() => previewRepair(createTimeline("empty"), [], 0)).toThrow("Choose a message");
  });

  it("can restart an interrupted repair earlier without losing its existing recovery records", () => {
    const { timeline, messages } = fixture();
    beginRepair(timeline, messages, { ...previewRepair(timeline, messages), startMessageIndex: 3 });
    const originalBackup = structuredClone(timeline.repair!.backupRecords);
    const loaded = normalizeTimeline(JSON.parse(JSON.stringify(timeline)), "chat");
    beginRepair(loaded, messages, { ...previewRepair(loaded, messages), startMessageIndex: 2 });
    expect(loaded.records).toHaveLength(2);
    expect(loaded.repair!.backupRecords).toEqual(expect.arrayContaining(originalBackup));
    expect(loaded.repair!.backupRecords.map((record) => record.messageIndex).sort()).toEqual([2, 3, 4]);
    expect(previewRepair(loaded, messages)).toMatchObject({ resumed: true, startMessageIndex: 2, messageCount: 3 });
  });

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
    expect(() => beginRepair(timeline, messages.map((message) => ({ ...message, index_in_chat: message.index_in_chat! + 1 })), { ...preview, startMessageIndex: 3 })).toThrow("timeline changed");
    timeline.revision++;
    expect(() => beginRepair(timeline, messages, preview)).toThrow("timeline changed");
  });

  it("uses current message positions when saved records have older numbering", () => {
    const { timeline, messages } = fixture();
    const before = structuredClone(timeline.records);
    messages.forEach((message) => { message.index_in_chat! += 10; });
    const preview = previewRepair(timeline, messages);
    expect(preview.startMessageIndex).toBe(12);
    beginRepair(timeline, messages, { ...preview, startMessageIndex: 13 });
    expect(timeline.records).toEqual(before.slice(0, 3));
    expect(timeline.repair?.backupRecords).toEqual(before.slice(3));
    expect(rebuildTimeline(timeline, messages).firstMissingIndex).toBe(3);
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
