import { stableHash } from "./engine";
import type { ChatMessageLike, MindTidyProposal, TidyHistoryScope } from "./types";

export function selectTidyHistory(messages: ChatMessageLike[], limit: number): ChatMessageLike[] {
  return limit > 0 ? messages.slice(-Math.floor(limit)) : messages;
}

export function tidyHistoryFingerprint(messages: ChatMessageLike[]): string {
  return stableHash(JSON.stringify(messages.map((message) => [message.id, message.index_in_chat, message.swipe_id ?? 0, message.role, message.name, message.content])));
}

export function tidyHistoryScope(messages: ChatMessageLike[], limit: number): TidyHistoryScope {
  return { messageCount: messages.length, startMessageIndex: messages[0]?.index_in_chat ?? null,
    endMessageIndex: messages.at(-1)?.index_in_chat ?? null, limit };
}

/** Mutually exclusive proposals must not silently overwrite one another. */
export function tidyApprovalsConflict(proposals: MindTidyProposal[]): boolean {
  const affected = new Set<string>();
  for (const proposal of proposals) {
    const targets = proposal.operation === "replace_core" ? ["core"] : proposal.targetItemIds.map((id) => `item:${id}`);
    for (const target of targets) {
      const key = JSON.stringify([proposal.actorId, target]);
      if (affected.has(key)) return true;
      affected.add(key);
    }
  }
  return false;
}
