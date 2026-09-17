import { rebuildTimeline, stableHash } from "./engine";
import type { ChatMessageLike, ChatTimelineV1, RepairPreview } from "./types";

/** Inspect a copy so previewing never changes folded state or actor presence. */
export function previewRepair(timeline: ChatTimelineV1, messages: ChatMessageLike[], selectedStart?: number): RepairPreview {
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
  // Bind confirmation to the inspected history, not to its suggested start.
  // The user may choose any valid start within that unchanged snapshot.
  const fingerprint = stableHash(JSON.stringify({
    messages: derivation.messages.map((message) => [message.id, message.index_in_chat, message.swipe_id ?? 0, message.content]),
    records: records.map((record) => record.id),
    start,
  }));
  const messageIndices = derivation.messages.map((message, index) => message.index_in_chat ?? index);
  const maxStartPosition = Math.min(derivation.firstMissingIndex, messageIndices.length - 1);
  if (selectedStart !== undefined) {
    if (!Number.isInteger(selectedStart) || !messageIndices.includes(selectedStart)) {
      throw new Error("Choose a message number from the committed chat history.");
    }
    start = messageIndices.indexOf(selectedStart);
    if (start > maxStartPosition) {
      throw new Error(`Earlier analysis is missing or out of date. Choose message ${messageIndices[maxStartPosition] + 1} or earlier, or use Update now first.`);
    }
  }
  return {
    revision: timeline.revision, fingerprint,
    startMessageIndex: start >= 0 && start < derivation.messages.length ? (derivation.messages[start].index_in_chat ?? start) : null,
    messageCount: start >= 0 ? derivation.messages.length - start : 0,
    resumed: !!timeline.repair,
    messageIndices,
    maxStartMessageIndex: messageIndices[maxStartPosition] ?? null,
  };
}

export function beginRepair(timeline: ChatTimelineV1, messages: ChatMessageLike[], expected: Pick<RepairPreview, "revision" | "fingerprint"> & { startMessageIndex?: number | null }): RepairPreview {
  const current = previewRepair(timeline, messages);
  if (current.revision !== expected.revision || current.fingerprint !== expected.fingerprint) {
    throw new Error("The timeline changed. Open Repair analysis again to review the updated range.");
  }
  const preview = expected.startMessageIndex == null ? current : previewRepair(timeline, messages, expected.startMessageIndex);
  if (preview.startMessageIndex === null) return preview;
  // Stored positions can differ after non-analyzed messages are inserted or removed.
  // Prefer the current position of each message so the exact selected range wins.
  const currentIndices = new Map(messages.map((message, index) => [message.id, message.index_in_chat ?? index]));
  const inSuffix = (record: ChatTimelineV1["records"][number]) => (currentIndices.get(record.messageId) ?? record.messageIndex) >= preview.startMessageIndex!;
  const suffix = timeline.records.filter(inSuffix);
  const backupRecords = new Map((timeline.repair?.backupRecords ?? []).map((record) => [record.id, record]));
  for (const record of suffix) backupRecords.set(record.id, structuredClone(record));
  timeline.repair = { backupRecords: [...backupRecords.values()], startedAt: timeline.repair?.startedAt ?? Date.now() };
  timeline.records = timeline.records.filter((record) => !inSuffix(record));
  rebuildTimeline(timeline, messages);
  return preview;
}
