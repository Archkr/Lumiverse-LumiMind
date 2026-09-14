import { rebuildTimeline, stableHash } from "./engine";
import type { ChatMessageLike, ChatTimelineV1, RepairPreview } from "./types";

/** Inspect a copy so previewing never changes folded state or actor presence. */
export function previewRepair(timeline: ChatTimelineV1, messages: ChatMessageLike[]): RepairPreview {
  const copy = structuredClone(timeline);
  const derivation = rebuildTimeline(copy, messages);
  const records = derivation.matchedRecords;
  const analyzed = records.filter((record) => !record.skipReason);
  const warning = analyzed.find((record) => record.controller.telemetry?.warningCodes.length);
  const warningBatch = warning?.controller.telemetry?.batchId;
  let start = warning ? records.findIndex((record) => record.controller.telemetry?.batchId === warningBatch) : -1;
  const legacy = analyzed.length > 0 && analyzed.every((record) => !record.controller.telemetry && !record.deltas.length)
    && Object.values(copy.minds).every((mind) => !mind.items.length);
  if (start < 0 && legacy) start = records.indexOf(analyzed[0]);
  if (timeline.repair) start = derivation.firstMissingIndex;
  const fingerprint = stableHash(JSON.stringify({
    messages: derivation.messages.map((message) => [message.id, message.swipe_id ?? 0, message.content]),
    records: records.map((record) => record.id),
    start,
  }));
  return {
    revision: timeline.revision, fingerprint,
    startMessageIndex: start >= 0 && start < derivation.messages.length ? (derivation.messages[start].index_in_chat ?? start) : null,
    messageCount: start >= 0 ? derivation.messages.length - start : 0,
    resumed: !!timeline.repair,
  };
}

export function beginRepair(timeline: ChatTimelineV1, messages: ChatMessageLike[], expected: Pick<RepairPreview, "revision" | "fingerprint">): RepairPreview {
  const preview = previewRepair(timeline, messages);
  if (preview.revision !== expected.revision || preview.fingerprint !== expected.fingerprint) {
    throw new Error("The timeline changed. Open Repair analysis again to review the updated range.");
  }
  if (preview.startMessageIndex === null) return preview;
  if (!timeline.repair) {
    const suffix = timeline.records.filter((record) => record.messageIndex >= preview.startMessageIndex!);
    timeline.repair = { backupRecords: structuredClone(suffix), startedAt: Date.now() };
    timeline.records = timeline.records.filter((record) => record.messageIndex < preview.startMessageIndex!);
  }
  rebuildTimeline(timeline, messages);
  return preview;
}
