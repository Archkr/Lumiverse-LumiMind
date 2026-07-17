import {
  ANALYSIS_SCHEMA_VERSION,
  MIND_SCHEMA_VERSION,
  type ActorKind,
  type ActorMentionDelta,
  type ActorMind,
  type ActorRecord,
  type AnalysisRecord,
  type ChatMessageLike,
  type ChatTimelineV1,
  type ControllerAnalysis,
  type EvidenceRef,
  type LumiMindSettings,
  type ManualOverride,
  type MindCategory,
  type MindCore,
  type MindDelta,
  type MindItem,
  type MindItemStatus,
  type MindReductionTelemetry,
  type MindSeedV1,
  type PrivateSceneSnapshotV1,
  type PublicSceneSnapshotV1,
  type TimelineView,
} from "./types";

export const DEFAULT_SETTINGS: LumiMindSettings = {
  controllerConnectionId: null,
  controllerTemperature: 0.1,
  controllerMaxTokens: 1800,
  analysisContextMessageLimit: 4,
  personaMindEnabled: true,
  characterCardDirectorMode: false,
  cortexImportEnabled: true,
  cortexWritebackEnabled: false,
  privateInteropEnabled: false,
  spoilerSafe: true,
};

export const EMPTY_CORE: MindCore = {
  selfConcept: "",
  values: [],
  desires: [],
  fears: [],
  boundaries: [],
  notes: [],
};

const EMPTY_EVIDENCE: EvidenceRef = { messageId: "seed", swipeId: 0, excerpt: "Mind seed", messageIndex: -1 };
const CATEGORY_ORDER: Record<MindCategory, number> = {
  goal: 7,
  plan: 6,
  secret: 5,
  belief: 4,
  relationship: 3,
  emotion: 2,
  awareness: 1,
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((entry): entry is string => typeof entry === "string"));
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function normalizeSettings(value: unknown): LumiMindSettings {
  const raw = asObject(value);
  const characterCardDirectorMode = raw.characterCardDirectorMode === true;
  return {
    controllerConnectionId: stringValue(raw.controllerConnectionId) || null,
    controllerTemperature: clamp(raw.controllerTemperature, 0, 2, DEFAULT_SETTINGS.controllerTemperature),
    controllerMaxTokens: Math.round(clamp(raw.controllerMaxTokens, 300, 8000, DEFAULT_SETTINGS.controllerMaxTokens)),
    analysisContextMessageLimit: Math.round(clamp(raw.analysisContextMessageLimit, 0, 50, DEFAULT_SETTINGS.analysisContextMessageLimit)),
    personaMindEnabled: raw.personaMindEnabled !== false,
    characterCardDirectorMode,
    cortexImportEnabled: raw.cortexImportEnabled !== false,
    cortexWritebackEnabled: raw.cortexWritebackEnabled === true,
    privateInteropEnabled: raw.privateInteropEnabled === true,
    spoilerSafe: raw.spoilerSafe !== false,
  };
}

export function normalizeCore(value: unknown): MindCore {
  const raw = asObject(value);
  return {
    selfConcept: stringValue(raw.selfConcept),
    values: strings(raw.values),
    desires: strings(raw.desires),
    fears: strings(raw.fears),
    boundaries: strings(raw.boundaries),
    notes: strings(raw.notes),
  };
}

export function normalizeSeed(value: unknown): MindSeedV1 | null {
  const raw = asObject(value);
  if (!Object.keys(raw).length) return null;
  const priors = Array.isArray(raw.relationshipPriors)
    ? raw.relationshipPriors.flatMap((entry) => {
        const item = asObject(entry);
        const target = stringValue(item.target);
        const stance = stringValue(item.stance);
        return target && stance ? [{ target, stance }] : [];
      })
    : [];
  return {
    schemaVersion: MIND_SCHEMA_VERSION,
    core: normalizeCore(raw.core),
    startingBeliefs: strings(raw.startingBeliefs),
    startingSecrets: strings(raw.startingSecrets),
    startingGoals: strings(raw.startingGoals),
    relationshipPriors: priors,
    updatedAt: Math.round(clamp(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())),
  };
}

export function makeEmptySeed(core: Partial<MindCore> = {}): MindSeedV1 {
  return {
    schemaVersion: MIND_SCHEMA_VERSION,
    core: normalizeCore({ ...EMPTY_CORE, ...core }),
    startingBeliefs: [],
    startingSecrets: [],
    startingGoals: [],
    relationshipPriors: [],
    updatedAt: Date.now(),
  };
}

export function stableHash(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizedMindText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function canonicalMindText(value: string): string {
  return normalizedMindText(value);
}

export function mindTextsNearDuplicate(left: string, right: string): boolean {
  const leftCanonical = canonicalMindText(left);
  const rightCanonical = canonicalMindText(right);
  if (!leftCanonical || !rightCanonical) return false;
  if (leftCanonical === rightCanonical) return true;
  const leftTokens = new Set(leftCanonical.split(" "));
  const rightTokens = new Set(rightCanonical.split(" "));
  if (Math.min(leftTokens.size, rightTokens.size) < 2) return false;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  const containment = shared / Math.min(leftTokens.size, rightTokens.size);
  const coverage = shared / Math.max(leftTokens.size, rightTokens.size);
  return shared >= 2 && containment >= 0.8 && coverage >= 0.6;
}

export function analysisPolicyHash(settings: LumiMindSettings): string {
  const directorPolicy = settings.characterCardDirectorMode ? "director-policy:3|" : "";
  const personaPolicy = settings.personaMindEnabled ? "" : "persona-policy:2|";
  return stableHash(`${directorPolicy}${personaPolicy}persona:${settings.personaMindEnabled ? 1 : 0}|director:${settings.characterCardDirectorMode ? 1 : 0}`);
}

export function actorMindEnabled(actor: ActorRecord, settings: LumiMindSettings): boolean {
  if (actor.kind === "persona") return settings.personaMindEnabled;
  if (actor.kind === "character" && actor.characterId) return !settings.characterCardDirectorMode;
  return true;
}

export function messageContentHash(message: ChatMessageLike): string {
  return stableHash(`${message.role}\n${message.name ?? ""}\n${message.content}`);
}

export function nextPrefixHash(prefixHash: string, contentHash: string, swipeId: number): string {
  return stableHash(`${prefixHash}|${contentHash}|${swipeId}`);
}

export function sortMessages(messages: ChatMessageLike[]): ChatMessageLike[] {
  return messages
    .filter((message) => message && typeof message.id === "string" && (message.role === "user" || message.role === "assistant"))
    .map((message, index) => ({ ...message, index_in_chat: message.index_in_chat ?? index }))
    .sort((left, right) => (left.index_in_chat ?? 0) - (right.index_in_chat ?? 0));
}

export function selectAnalysisWorkBatch(
  messages: ChatMessageLike[],
  start: number,
  maxMessages: number,
  settings: LumiMindSettings,
): { messages: ChatMessageLike[]; skipReason: AnalysisRecord["skipReason"] | null } {
  const first = messages[start];
  if (!first) return { messages: [], skipReason: null };
  const shouldSkip = (message: ChatMessageLike) => !settings.personaMindEnabled && message.role === "user";
  const skip = shouldSkip(first);
  const selected: ChatMessageLike[] = [];
  const limit = Math.max(1, Math.floor(maxMessages));
  for (let index = start; index < messages.length && selected.length < limit; index += 1) {
    const message = messages[index];
    if (shouldSkip(message) !== skip) break;
    selected.push(message);
  }
  return {
    messages: selected,
    skipReason: skip ? "unmanaged_user_message" : null,
  };
}

export function selectAnalysisRecentContext(
  messages: ChatMessageLike[],
  analysisStart: number,
  messageLimit: number,
): ChatMessageLike[] {
  const limit = Number.isFinite(messageLimit) ? Math.max(0, Math.floor(messageLimit)) : 0;
  if (limit === 0 || analysisStart <= 0) return [];
  return messages.slice(Math.max(0, analysisStart - limit), analysisStart);
}

export function createActor(input: {
  id?: string;
  kind: ActorKind;
  name: string;
  aliases?: string[];
  characterId?: string | null;
  personaId?: string | null;
  cortexEntityId?: string | null;
  confidence?: number;
  confirmed?: boolean;
}): ActorRecord {
  const now = Date.now();
  return {
    id: input.id ?? `actor:${crypto.randomUUID()}`,
    kind: input.kind,
    canonicalName: input.name.trim() || "Unnamed actor",
    aliases: uniqueStrings(input.aliases ?? []),
    characterId: input.characterId ?? null,
    personaId: input.personaId ?? null,
    cortexEntityId: input.cortexEntityId ?? null,
    confidence: clamp(input.confidence, 0, 1, 0.75),
    confirmed: input.confirmed ?? input.kind !== "npc",
    present: false,
    firstSeenMessageId: null,
    lastSeenMessageId: null,
    updatedAt: now,
  };
}

function seedItem(actorId: string, category: MindCategory, text: string, index: number): MindItem {
  const now = Date.now();
  return {
    id: `seed:${actorId}:${category}:${stableHash(`${index}:${text}`)}`,
    category,
    text,
    status: "active",
    confidence: 1,
    targetActorIds: [],
    concealedFromActorIds: [],
    intensity: null,
    dimensions: {},
    evidence: EMPTY_EVIDENCE,
    locked: true,
    pinned: true,
    source: "seed",
    createdAt: now,
    updatedAt: now,
  };
}

export function makeBaseMind(actorId: string, seed?: MindSeedV1 | null): ActorMind {
  const normalized = seed ?? makeEmptySeed();
  const items: MindItem[] = [
    ...normalized.startingBeliefs.map((text, index) => seedItem(actorId, "belief", text, index)),
    ...normalized.startingSecrets.map((text, index) => seedItem(actorId, "secret", text, index)),
    ...normalized.startingGoals.map((text, index) => seedItem(actorId, "goal", text, index)),
    ...normalized.relationshipPriors.map((prior, index) =>
      seedItem(actorId, "relationship", `${prior.target}: ${prior.stance}`, index),
    ),
  ];
  return {
    actorId,
    core: normalized.core,
    items,
    sceneSummary: "",
    attention: "",
    presentActorIds: [],
    lastUpdatedMessageId: null,
  };
}

export function createTimeline(chatId: string): ChatTimelineV1 {
  return {
    schemaVersion: MIND_SCHEMA_VERSION,
    chatId,
    analysisPolicyHash: analysisPolicyHash(DEFAULT_SETTINGS),
    active: false,
    paused: false,
    revision: 0,
    health: "inactive",
    error: null,
    actors: {},
    baseMinds: {},
    minds: {},
    records: [],
    manualOverrides: [],
    lastValidMessageIndex: -1,
    lastAnalyzedAt: null,
    updatedAt: Date.now(),
  };
}

export function normalizeTimeline(value: unknown, chatId: string): ChatTimelineV1 {
  const raw = asObject(value);
  if (raw.schemaVersion !== MIND_SCHEMA_VERSION || raw.chatId !== chatId) return createTimeline(chatId);
  const fallback = createTimeline(chatId);
  const actors = Object.fromEntries(Object.entries(asObject(raw.actors)).map(([id, value]) => {
    const actor = { ...(value as ActorRecord), id };
    if (actor.kind === "character" && !actor.characterId) actor.kind = "npc";
    if (actor.kind === "persona" && !actor.personaId) actor.kind = "npc";
    return [id, actor];
  }));
  return {
    ...fallback,
    ...(raw as unknown as Partial<ChatTimelineV1>),
    schemaVersion: MIND_SCHEMA_VERSION,
    chatId,
    analysisPolicyHash: stringValue(raw.analysisPolicyHash, analysisPolicyHash(DEFAULT_SETTINGS)),
    active: raw.active === true,
    paused: raw.paused === true,
    revision: Math.round(clamp(raw.revision, 0, Number.MAX_SAFE_INTEGER, 0)),
    actors,
    baseMinds: asObject(raw.baseMinds) as Record<string, ActorMind>,
    minds: asObject(raw.minds) as Record<string, ActorMind>,
    records: Array.isArray(raw.records) ? (raw.records as AnalysisRecord[]) : [],
    manualOverrides: Array.isArray(raw.manualOverrides) ? (raw.manualOverrides as ManualOverride[]) : [],
    lastValidMessageIndex: Math.round(clamp(raw.lastValidMessageIndex, -1, Number.MAX_SAFE_INTEGER, -1)),
    updatedAt: Math.round(clamp(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())),
  };
}

function actorNames(actor: ActorRecord): string[] {
  return [actor.canonicalName, ...actor.aliases].map((name) => name.trim().toLocaleLowerCase()).filter(Boolean);
}

export function resolveActorId(actors: Record<string, ActorRecord>, reference: string): string | null {
  const normalized = reference.trim().toLocaleLowerCase();
  if (!normalized) return null;
  if (actors[reference]) return reference;
  const matches = Object.values(actors).filter((actor) => actorNames(actor).includes(normalized));
  return matches.length === 1 ? matches[0].id : null;
}

export function upsertActor(
  timeline: ChatTimelineV1,
  input: Parameters<typeof createActor>[0],
  evidence?: EvidenceRef,
): ActorRecord {
  const stableId = input.characterId
    ? `character:${input.characterId}`
    : input.personaId
      ? `persona:${input.personaId}`
      : input.id;
  const byStable = stableId ? timeline.actors[stableId] : null;
  const byNameId = resolveActorId(timeline.actors, input.name);
  const byCortex = input.cortexEntityId
    ? Object.values(timeline.actors).find((actor) => actor.cortexEntityId === input.cortexEntityId)
    : null;
  const existing = byStable ?? byCortex ?? (byNameId ? timeline.actors[byNameId] : null);
  if (existing) {
    existing.aliases = uniqueStrings([
      ...existing.aliases,
      ...(input.aliases ?? []),
      ...(existing.canonicalName.toLocaleLowerCase() !== input.name.trim().toLocaleLowerCase() ? [input.name] : []),
    ]);
    existing.confidence = Math.max(existing.confidence, clamp(input.confidence, 0, 1, existing.confidence));
    existing.confirmed = existing.confirmed || input.confirmed === true;
    existing.characterId = existing.characterId ?? input.characterId ?? null;
    existing.personaId = existing.personaId ?? input.personaId ?? null;
    existing.cortexEntityId = existing.cortexEntityId ?? input.cortexEntityId ?? null;
    existing.updatedAt = Date.now();
    if (evidence) {
      existing.firstSeenMessageId ??= evidence.messageId;
      existing.lastSeenMessageId = evidence.messageId;
    }
    timeline.baseMinds[existing.id] ??= makeBaseMind(existing.id);
    return existing;
  }
  const actor = createActor({ ...input, id: stableId });
  if (evidence) {
    actor.firstSeenMessageId = evidence.messageId;
    actor.lastSeenMessageId = evidence.messageId;
  }
  timeline.actors[actor.id] = actor;
  timeline.baseMinds[actor.id] = makeBaseMind(actor.id);
  return actor;
}

function cloneMind(mind: ActorMind): ActorMind {
  return {
    ...mind,
    core: { ...mind.core, values: [...mind.core.values], desires: [...mind.core.desires], fears: [...mind.core.fears], boundaries: [...mind.core.boundaries], notes: [...mind.core.notes] },
    items: mind.items.map((item) => ({
      ...item,
      targetActorIds: [...item.targetActorIds],
      concealedFromActorIds: [...item.concealedFromActorIds],
      dimensions: { ...item.dimensions },
      evidence: { ...item.evidence },
    })),
    presentActorIds: [...mind.presentActorIds],
  };
}

function decayEmotions(minds: Record<string, ActorMind>): void {
  for (const mind of Object.values(minds)) {
    mind.items = mind.items.flatMap((item) => {
      if (item.category !== "emotion" || item.locked || item.intensity === null) return [item];
      const intensity = Number((item.intensity * 0.85).toFixed(3));
      return intensity < 0.1 ? [] : [{ ...item, intensity }];
    });
  }
}

function sameActorIds(left: string[], right: string[]): boolean {
  const normalizedLeft = uniqueStrings(left).sort();
  const normalizedRight = uniqueStrings(right).sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function protectedMindItem(item: MindItem): boolean {
  return item.locked || item.pinned || item.source !== "controller";
}

type MindMatchKind = "target" | "exact" | "near" | "relationship";

function matchingMindItem(
  mind: ActorMind,
  delta: MindDelta,
): { index: number; kind: MindMatchKind } | null {
  if (delta.targetItemId) {
    const index = mind.items.findIndex((item) => item.id === delta.targetItemId);
    if (index >= 0) return { index, kind: "target" };
  }
  if (delta.operation !== "add") return null;
  const candidates = mind.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      (item.status === "active" || item.status === "uncertain") &&
      item.category === delta.category &&
      sameActorIds(item.targetActorIds, delta.targetActorIds) &&
      sameActorIds(item.concealedFromActorIds, delta.concealedFromActorIds),
    );
  const deltaCanonical = canonicalMindText(delta.text);
  const exact = deltaCanonical ? candidates.find(({ item }) => canonicalMindText(item.text) === deltaCanonical) : undefined;
  if (exact) return { index: exact.index, kind: "exact" };
  const near = candidates.find(({ item }) => mindTextsNearDuplicate(item.text, delta.text));
  if (near) return { index: near.index, kind: "near" };
  if (delta.category === "relationship" && delta.targetActorIds.length > 0) {
    const relationship = candidates[0];
    if (relationship) return { index: relationship.index, kind: "relationship" };
  }
  return null;
}

function emptyReductionTelemetry(): MindReductionTelemetry {
  return { duplicatesSuppressed: 0, entriesUpdated: 0, entriesSuperseded: 0, invalidChangesRejected: 0 };
}

function itemFromDelta(delta: MindDelta): MindItem {
  return {
    id: delta.targetItemId || delta.id,
    category: delta.category,
    text: delta.text,
    status: delta.status,
    confidence: delta.confidence,
    targetActorIds: [...delta.targetActorIds],
    concealedFromActorIds: [...delta.concealedFromActorIds],
    intensity: delta.intensity,
    dimensions: { ...delta.dimensions },
    evidence: { ...delta.evidence },
    locked: false,
    pinned: false,
    source: "controller",
    createdAt: delta.createdAt,
    updatedAt: delta.createdAt,
  };
}

export function applyRecord(
  record: AnalysisRecord,
  actors: Record<string, ActorRecord>,
  minds: Record<string, ActorMind>,
): MindReductionTelemetry {
  const reduction = emptyReductionTelemetry();
  if (record.actorMentions.length > 0) {
    for (const actor of Object.values(actors)) actor.present = false;
    for (const mention of record.actorMentions) {
      const actor = actors[mention.ref];
      if (!actor) continue;
      actor.present = mention.present;
      actor.confidence = Math.max(actor.confidence, mention.confidence);
      actor.aliases = uniqueStrings([...actor.aliases, ...mention.aliases]);
      actor.firstSeenMessageId ??= mention.evidence.messageId;
      actor.lastSeenMessageId = mention.evidence.messageId;
    }
  }
  decayEmotions(minds);
  for (const delta of record.deltas) {
    const mind = (minds[delta.subjectActorId] ??= makeBaseMind(delta.subjectActorId));
    const match = matchingMindItem(mind, delta);
    const targetIndex = match?.index ?? -1;
    const target = targetIndex >= 0 ? mind.items[targetIndex] : null;
    if (target && protectedMindItem(target)) {
      if (delta.operation === "add") reduction.duplicatesSuppressed += 1;
      else reduction.invalidChangesRejected += 1;
      continue;
    }
    if (delta.operation === "remove") {
      if (targetIndex >= 0) {
        mind.items.splice(targetIndex, 1);
        mind.lastUpdatedMessageId = delta.evidence.messageId;
      } else {
        reduction.invalidChangesRejected += 1;
      }
      continue;
    }
    if (delta.operation === "resolve" || delta.operation === "abandon") {
      if (targetIndex >= 0) {
        mind.items[targetIndex] = {
          ...target!,
          status: delta.operation === "resolve" ? "resolved" : "abandoned",
          evidence: { ...delta.evidence },
          updatedAt: delta.createdAt,
        };
        mind.lastUpdatedMessageId = delta.evidence.messageId;
        reduction.entriesSuperseded += 1;
      } else {
        reduction.invalidChangesRejected += 1;
      }
      continue;
    }
    if (!delta.text.trim() || (delta.operation === "update" && targetIndex < 0)) {
      reduction.invalidChangesRejected += 1;
      continue;
    }
    const next = itemFromDelta(delta);
    if (targetIndex >= 0) {
      mind.items[targetIndex] = {
        ...target!,
        ...next,
        id: target!.id,
        createdAt: target!.createdAt,
        locked: target!.locked,
        pinned: target!.pinned,
        source: target!.source,
      };
      if (match?.kind === "relationship" && !mindTextsNearDuplicate(target!.text, delta.text)) reduction.entriesSuperseded += 1;
      else reduction.entriesUpdated += 1;
    } else {
      mind.items.push(next);
    }
    mind.lastUpdatedMessageId = delta.evidence.messageId;
  }
  const presentIds = Object.values(actors).filter((actor) => actor.present).map((actor) => actor.id);
  for (const mind of Object.values(minds)) mind.presentActorIds = [...presentIds];
  return reduction;
}

function applyManualOverrides(minds: Record<string, ActorMind>, overrides: ManualOverride[]): void {
  for (const override of overrides) {
    const mind = minds[override.actorId];
    if (!mind) continue;
    const targetId = override.targetItemId ?? override.item?.id;
    const index = targetId ? mind.items.findIndex((item) => item.id === targetId) : -1;
    if (override.operation === "remove") {
      if (index >= 0) mind.items.splice(index, 1);
      continue;
    }
    if (!override.item) continue;
    if (index >= 0) mind.items[index] = { ...override.item, id: mind.items[index].id };
    else {
      const duplicateIndexes = mind.items.flatMap((item, itemIndex) => {
        const sameContext = item.source === "controller" &&
          item.category === override.item!.category &&
          sameActorIds(item.targetActorIds, override.item!.targetActorIds) &&
          sameActorIds(item.concealedFromActorIds, override.item!.concealedFromActorIds);
        const sameMeaning = sameContext && (
          mindTextsNearDuplicate(item.text, override.item!.text) ||
          (item.category === "relationship" && item.targetActorIds.length > 0)
        );
        return sameMeaning ? [itemIndex] : [];
      });
      if (duplicateIndexes.length === 0) {
        mind.items.push({ ...override.item });
      } else {
        const [replacementIndex, ...extraIndexes] = duplicateIndexes;
        mind.items[replacementIndex] = { ...override.item };
        for (const extraIndex of extraIndexes.sort((left, right) => right - left)) mind.items.splice(extraIndex, 1);
      }
    }
  }
}

export interface TimelineDerivation {
  messages: ChatMessageLike[];
  matchedRecords: AnalysisRecord[];
  firstMissingIndex: number;
  nextPrefix: string;
}

export function rebuildTimeline(timeline: ChatTimelineV1, rawMessages: ChatMessageLike[]): TimelineDerivation {
  const messages = sortMessages(rawMessages);
  const minds: Record<string, ActorMind> = {};
  for (const actor of Object.values(timeline.actors)) {
    actor.present = false;
    minds[actor.id] = cloneMind(timeline.baseMinds[actor.id] ?? makeBaseMind(actor.id));
  }
  const matchedRecords: AnalysisRecord[] = [];
  let prefixHash = "root";
  let firstMissingIndex = messages.length;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const contentHash = messageContentHash(message);
    const swipeId = message.swipe_id ?? 0;
    const record = timeline.records.find(
      (candidate) =>
        candidate.messageId === message.id &&
        candidate.swipeId === swipeId &&
        candidate.contentHash === contentHash &&
        candidate.prefixHash === prefixHash &&
        candidate.analysisVersion === ANALYSIS_SCHEMA_VERSION,
    );
    if (!record) {
      firstMissingIndex = index;
      break;
    }
    matchedRecords.push(record);
    record.reduction = applyRecord(record, timeline.actors, minds);
    prefixHash = nextPrefixHash(prefixHash, contentHash, swipeId);
  }
  applyManualOverrides(minds, timeline.manualOverrides);
  timeline.minds = minds;
  timeline.lastValidMessageIndex = firstMissingIndex === 0 ? -1 : (messages[firstMissingIndex - 1]?.index_in_chat ?? firstMissingIndex - 1);
  if (!timeline.active) timeline.health = "inactive";
  else if (timeline.paused) timeline.health = "paused";
  else if (firstMissingIndex < messages.length) timeline.health = "stale";
  else timeline.health = "ready";
  return { messages, matchedRecords, firstMissingIndex, nextPrefix: prefixHash };
}

function evidenceFor(message: ChatMessageLike, excerpt = ""): EvidenceRef {
  const clean = excerpt.trim() || message.content.trim().slice(0, 240);
  return {
    messageId: message.id,
    swipeId: message.swipe_id ?? 0,
    excerpt: clean,
    messageIndex: message.index_in_chat ?? 0,
  };
}

function actorRefMap(timeline: ChatTimelineV1): Map<string, string> {
  const map = new Map<string, string>();
  for (const actor of Object.values(timeline.actors)) {
    map.set(actor.id.toLocaleLowerCase(), actor.id);
    for (const name of actorNames(actor)) map.set(name, actor.id);
    if (actor.characterId) map.set(`character:${actor.characterId}`.toLocaleLowerCase(), actor.id);
    if (actor.personaId) map.set(`persona:${actor.personaId}`.toLocaleLowerCase(), actor.id);
  }
  return map;
}

function resolveKnownRef(timeline: ChatTimelineV1, refs: Map<string, string>, reference: string): string | null {
  const key = reference.trim().toLocaleLowerCase();
  return refs.get(key) ?? resolveActorId(timeline.actors, reference);
}

function normalizeStatus(value: unknown): MindItemStatus {
  return value === "resolved" || value === "abandoned" || value === "uncertain" ? value : "active";
}

function normalizeCategory(value: unknown): MindCategory | null {
  return value === "belief" || value === "secret" || value === "goal" || value === "plan" || value === "emotion" || value === "relationship" || value === "awareness"
    ? value
    : null;
}

export function materializeAnalysisRecords(
  timeline: ChatTimelineV1,
  batchMessages: ChatMessageLike[],
  startingPrefix: string,
  analysis: ControllerAnalysis,
  controller: AnalysisRecord["controller"],
): AnalysisRecord[] {
  const messages = sortMessages(batchMessages);
  const byId = new Map(messages.map((message) => [message.id, message]));
  const refs = actorRefMap(timeline);
  const mentionsByMessage = new Map<string, ActorMentionDelta[]>();
  for (const raw of analysis.actorMentions ?? []) {
    const message = byId.get(raw.messageId);
    if (!message || !raw.name?.trim()) continue;
    const evidence = evidenceFor(message);
    const stableReference = raw.ref?.trim() || raw.name.trim();
    let id = refs.get(stableReference.toLocaleLowerCase()) ?? refs.get(raw.name.trim().toLocaleLowerCase());
    if (!id) {
      const actor = upsertActor(
        timeline,
        {
          kind: "npc",
          name: raw.name,
          aliases: raw.aliases ?? [],
          confidence: raw.confidence,
        },
        evidence,
      );
      id = actor.id;
    }
    const actor = timeline.actors[id];
    actor.aliases = uniqueStrings([...actor.aliases, ...(raw.aliases ?? [])]);
    refs.set(stableReference.toLocaleLowerCase(), id);
    refs.set(raw.name.trim().toLocaleLowerCase(), id);
    for (const alias of raw.aliases ?? []) refs.set(alias.trim().toLocaleLowerCase(), id);
    const mention: ActorMentionDelta = {
      ref: id,
      name: actor.canonicalName,
      aliases: actor.aliases,
      kind: actor.kind,
      confidence: clamp(raw.confidence, 0, 1, 0.75),
      present: raw.present !== false,
      evidence,
    };
    const list = mentionsByMessage.get(message.id) ?? [];
    list.push(mention);
    mentionsByMessage.set(message.id, list);
  }

  const changesByMessage = new Map<string, MindDelta[]>();
  for (const raw of analysis.changes ?? []) {
    const message = byId.get(raw.messageId);
    if (!message || !raw.subjectRef?.trim()) continue;
    const evidence = evidenceFor(message, raw.evidenceExcerpt);
    const subjectActorId = resolveKnownRef(timeline, refs, raw.subjectRef);
    if (!subjectActorId) continue;
    const operation = raw.operation === "update" || raw.operation === "resolve" || raw.operation === "abandon" || raw.operation === "remove"
      ? raw.operation
      : raw.operation === "add" ? "add" : null;
    const normalizedCategory = normalizeCategory(raw.category);
    const targetItemId = stringValue(raw.targetItemId) || null;
    const normalizedText = stringValue(raw.text);
    if (!operation || !normalizedCategory) continue;
    if ((operation === "add" || operation === "update") && !normalizedText) continue;
    if (operation !== "add" && !targetItemId) continue;
    const dimensions: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw.dimensions ?? {})) {
      dimensions[key] = clamp(value, -1, 1, 0);
    }
    const delta: MindDelta = {
      id: `delta:${crypto.randomUUID()}`,
      subjectActorId,
      category: normalizedCategory,
      operation,
      targetItemId,
      text: normalizedText,
      status: normalizeStatus(raw.status),
      confidence: clamp(raw.confidence, 0, 1, 0.75),
      targetActorIds: uniqueStrings((raw.targetRefs ?? []).map((ref) => resolveKnownRef(timeline, refs, ref)).filter((id): id is string => !!id)),
      concealedFromActorIds: uniqueStrings((raw.concealedFromRefs ?? []).map((ref) => resolveKnownRef(timeline, refs, ref)).filter((id): id is string => !!id)),
      intensity: raw.intensity === null || raw.intensity === undefined ? null : clamp(raw.intensity, 0, 1, 0.5),
      dimensions,
      evidence,
      createdAt: Date.now(),
    };
    const list = changesByMessage.get(message.id) ?? [];
    list.push(delta);
    changesByMessage.set(message.id, list);
  }

  const records: AnalysisRecord[] = [];
  let prefixHash = startingPrefix;
  for (const message of messages) {
    const contentHash = messageContentHash(message);
    const swipeId = message.swipe_id ?? 0;
    records.push({
      id: `analysis:${crypto.randomUUID()}`,
      analysisVersion: ANALYSIS_SCHEMA_VERSION,
      messageId: message.id,
      messageIndex: message.index_in_chat ?? 0,
      swipeId,
      contentHash,
      prefixHash,
      actorMentions: mentionsByMessage.get(message.id) ?? [],
      deltas: changesByMessage.get(message.id) ?? [],
      controller,
      createdAt: Date.now(),
    });
    prefixHash = nextPrefixHash(prefixHash, contentHash, swipeId);
  }
  return records;
}

export function materializeSkippedAnalysisRecords(
  timeline: ChatTimelineV1,
  batchMessages: ChatMessageLike[],
  startingPrefix: string,
  skipReason: NonNullable<AnalysisRecord["skipReason"]>,
): AnalysisRecord[] {
  return materializeAnalysisRecords(
    timeline,
    batchMessages,
    startingPrefix,
    { actorMentions: [], changes: [] },
    { connectionId: null, provider: null, model: null },
  ).map((record) => ({ ...record, skipReason }));
}

export function addManualItem(timeline: ChatTimelineV1, actorId: string, category: MindCategory, text: string): void {
  const now = Date.now();
  const item: MindItem = {
    id: `manual:${crypto.randomUUID()}`,
    category,
    text: text.trim(),
    status: "active",
    confidence: 1,
    targetActorIds: [],
    concealedFromActorIds: [],
    intensity: category === "emotion" ? 0.7 : null,
    dimensions: {},
    evidence: { messageId: "manual", swipeId: 0, excerpt: "User-authored", messageIndex: -1 },
    locked: true,
    pinned: true,
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
  timeline.manualOverrides.push({ id: `override:${crypto.randomUUID()}`, actorId, operation: "upsert", item, targetItemId: null, createdAt: now });
}

export function overrideItem(
  timeline: ChatTimelineV1,
  actorId: string,
  itemId: string,
  mutate: (item: MindItem) => MindItem,
): boolean {
  const current = timeline.minds[actorId]?.items.find((item) => item.id === itemId);
  if (!current) return false;
  const item = mutate({ ...current, targetActorIds: [...current.targetActorIds], concealedFromActorIds: [...current.concealedFromActorIds], dimensions: { ...current.dimensions }, evidence: { ...current.evidence } });
  item.source = "manual";
  item.updatedAt = Date.now();
  timeline.manualOverrides.push({ id: `override:${crypto.randomUUID()}`, actorId, operation: "upsert", item, targetItemId: itemId, createdAt: Date.now() });
  return true;
}

export function removeManualItem(timeline: ChatTimelineV1, actorId: string, itemId: string): void {
  timeline.manualOverrides.push({ id: `override:${crypto.randomUUID()}`, actorId, operation: "remove", item: null, targetItemId: itemId, createdAt: Date.now() });
}

export function mergeActors(timeline: ChatTimelineV1, sourceActorId: string, targetActorId: string): boolean {
  const source = timeline.actors[sourceActorId];
  const target = timeline.actors[targetActorId];
  if (!source || !target || sourceActorId === targetActorId) return false;
  target.aliases = uniqueStrings([...target.aliases, source.canonicalName, ...source.aliases]);
  target.confidence = Math.max(target.confidence, source.confidence);
  target.confirmed = target.confirmed || source.confirmed;
  target.cortexEntityId ??= source.cortexEntityId;
  const remap = (id: string) => (id === sourceActorId ? targetActorId : id);
  for (const record of timeline.records) {
    for (const mention of record.actorMentions) mention.ref = remap(mention.ref);
    for (const delta of record.deltas) {
      delta.subjectActorId = remap(delta.subjectActorId);
      delta.targetActorIds = uniqueStrings(delta.targetActorIds.map(remap));
      delta.concealedFromActorIds = uniqueStrings(delta.concealedFromActorIds.map(remap));
    }
  }
  for (const override of timeline.manualOverrides) override.actorId = remap(override.actorId);
  const targetBase = timeline.baseMinds[targetActorId] ?? makeBaseMind(targetActorId);
  const sourceBase = timeline.baseMinds[sourceActorId];
  if (sourceBase) targetBase.items.push(...sourceBase.items.map((item) => ({ ...item, id: `${item.id}:merged` })));
  timeline.baseMinds[targetActorId] = targetBase;
  delete timeline.baseMinds[sourceActorId];
  delete timeline.minds[sourceActorId];
  delete timeline.actors[sourceActorId];
  return true;
}

export function removeActor(timeline: ChatTimelineV1, actorId: string): boolean {
  if (!timeline.actors[actorId]) return false;
  delete timeline.actors[actorId];
  delete timeline.baseMinds[actorId];
  delete timeline.minds[actorId];
  timeline.records = timeline.records.map((record) => ({
    ...record,
    actorMentions: record.actorMentions.filter((mention) => mention.ref !== actorId),
    deltas: record.deltas
      .filter((delta) => delta.subjectActorId !== actorId)
      .map((delta) => ({
        ...delta,
        targetActorIds: delta.targetActorIds.filter((id) => id !== actorId),
        concealedFromActorIds: delta.concealedFromActorIds.filter((id) => id !== actorId),
      })),
  }));
  timeline.manualOverrides = timeline.manualOverrides.filter((override) => override.actorId !== actorId);
  return true;
}

export function splitActor(timeline: ChatTimelineV1, actorId: string, name: string): ActorRecord | null {
  const source = timeline.actors[actorId];
  if (!source || !name.trim()) return null;
  const actor = createActor({ kind: "npc", name, confidence: 1, confirmed: true });
  timeline.actors[actor.id] = actor;
  timeline.baseMinds[actor.id] = makeBaseMind(actor.id);
  return actor;
}

function itemScore(item: MindItem, relevantActorIds: Set<string>): number {
  let score = CATEGORY_ORDER[item.category] * 10 + item.confidence * 10;
  if (item.locked) score += 30;
  if (item.pinned) score += 40;
  if (item.status !== "active" && item.status !== "uncertain") score -= 25;
  if (item.targetActorIds.some((id) => relevantActorIds.has(id))) score += 20;
  score += Math.min(15, (item.updatedAt || item.createdAt) / 1e12);
  return score;
}

function actorLabel(actors: Record<string, ActorRecord>, id: string): string {
  return actors[id]?.canonicalName ?? id;
}

function formatMind(
  mind: ActorMind,
  actors: Record<string, ActorRecord>,
): string {
  const actor = actors[mind.actorId];
  if (!actor) return "";
  const relevant = new Set(mind.presentActorIds);
  const items = [...mind.items]
    .filter((item) => item.status === "active" || item.status === "uncertain")
    .sort((left, right) => itemScore(right, relevant) - itemScore(left, relevant));
  const lines: string[] = [`${actor.canonicalName} (${actor.kind}${actor.present ? ", present" : ""})`];
  if (mind.core.selfConcept) lines.push(`Self-concept: ${mind.core.selfConcept}`);
  if (mind.core.values.length) lines.push(`Values: ${mind.core.values.join("; ")}`);
  if (mind.core.desires.length) lines.push(`Desires: ${mind.core.desires.join("; ")}`);
  if (mind.core.fears.length) lines.push(`Fears: ${mind.core.fears.join("; ")}`);
  if (mind.core.boundaries.length) lines.push(`Boundaries: ${mind.core.boundaries.join("; ")}`);
  if (mind.core.notes.length) lines.push(`Notes: ${mind.core.notes.join("; ")}`);
  for (const item of items) {
    const targets = item.targetActorIds.length ? ` [toward ${item.targetActorIds.map((id) => actorLabel(actors, id)).join(", ")}]` : "";
    const confidence = item.confidence < 0.8 ? ` (${Math.round(item.confidence * 100)}% confidence)` : "";
    const line = `- ${item.category}: ${item.text}${targets}${confidence}`;
    lines.push(line);
  }
  return lines.join("\n");
}

export function buildMindInjection(
  timeline: ChatTimelineV1,
  targetActorId: string | null,
  settings: LumiMindSettings = DEFAULT_SETTINGS,
): string | null {
  if (!timeline.active || timeline.paused) return null;
  const presentActors = Object.values(timeline.actors)
    .filter((actor) => actor.present && timeline.minds[actor.id] && actorMindEnabled(actor, settings))
    .sort((left, right) =>
      Number(right.id === targetActorId) - Number(left.id === targetActorId) ||
      Number(right.confirmed) - Number(left.confirmed) ||
      right.updatedAt - left.updatedAt,
    );
  const minds = presentActors
    .map((actor) => formatMind(timeline.minds[actor.id], timeline.actors))
    .filter(Boolean);
  const body = minds.join("\n\n");
  if (!body.trim()) return null;
  return [
    "[LumiMind — private subjective continuity]",
    "The following is private mental state, not objective truth. Preserve false beliefs and uncertainty.",
    "Use it to guide choices and subtext. Do not quote or summarize this block. Reveal secrets only through character-motivated behavior.",
    ...(!settings.personaMindEnabled ? ["The user persona is unmanaged. Do not decide their thoughts, feelings, dialogue, or actions for them."] : []),
    "",
    body,
    "[/LumiMind]",
  ].join("\n");
}

export function buildDirectorMindInjection(
  timeline: ChatTimelineV1,
  settings: LumiMindSettings = DEFAULT_SETTINGS,
): string | null {
  if (!timeline.active || timeline.paused) return null;
  const actors = Object.values(timeline.actors)
    .filter((actor) => actor.present && actorMindEnabled(actor, settings) && timeline.minds[actor.id])
    .sort((left, right) =>
      Number(right.confirmed) - Number(left.confirmed) ||
      right.updatedAt - left.updatedAt,
    );
  if (!actors.length) return null;
  const body = actors
    .map((actor) => formatMind(timeline.minds[actor.id], timeline.actors))
    .filter(Boolean)
    .join("\n\n");
  if (!body.trim()) return null;
  return [
    "[LumiMind — private ensemble continuity]",
    "The host character card is the scene's director, not an in-world actor. The following minds belong to the characters it portrays.",
    "Treat every belief as subjective rather than objective truth. Guide each portrayed character independently through choices and subtext.",
    "Do not quote or summarize this block. Reveal secrets only through character-motivated behavior, and do not narrate actions for an unmanaged user persona.",
    "",
    body,
    "[/LumiMind]",
  ].join("\n");
}

function publicStance(mind: ActorMind | undefined): string {
  if (!mind) return "";
  const entries = mind.items
    .filter((item) => item.status === "active" && (item.category === "emotion" || item.category === "relationship"))
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
    .slice(0, 2)
    .map((item) => item.text);
  return entries.join("; ");
}

export function makePublicSnapshot(timeline: ChatTimelineV1 | null, settings: LumiMindSettings = DEFAULT_SETTINGS): PublicSceneSnapshotV1 {
  if (!timeline) return { schemaVersion: 1, chatId: null, revision: 0, stale: true, generatedAt: Date.now(), actors: [] };
  return {
    schemaVersion: 1,
    chatId: timeline.chatId,
    revision: timeline.revision,
    stale: timeline.health !== "ready",
    generatedAt: Date.now(),
    actors: Object.values(timeline.actors).filter((actor) => actorMindEnabled(actor, settings)).map((actor) => ({
      id: actor.id,
      kind: actor.kind,
      name: actor.canonicalName,
      aliases: [...actor.aliases],
      present: actor.present,
      confirmed: actor.confirmed,
      publicStance: publicStance(timeline.minds[actor.id]),
    })),
  };
}

export function makePrivateSnapshot(timeline: ChatTimelineV1 | null, settings: LumiMindSettings = DEFAULT_SETTINGS): PrivateSceneSnapshotV1 {
  const publicSnapshot = makePublicSnapshot(timeline, settings);
  const visibleIds = new Set(publicSnapshot.actors.map((actor) => actor.id));
  const minds = timeline
    ? Object.fromEntries(Object.entries(timeline.minds).filter(([actorId]) => visibleIds.has(actorId)))
    : {};
  return { ...publicSnapshot, minds };
}

export function toTimelineView(timeline: ChatTimelineV1, settings: LumiMindSettings = DEFAULT_SETTINGS): TimelineView {
  const actors = Object.values(timeline.actors)
    .filter((actor) => actorMindEnabled(actor, settings))
    .sort((left, right) => Number(right.present) - Number(left.present) || left.canonicalName.localeCompare(right.canonicalName));
  const visibleIds = new Set(actors.map((actor) => actor.id));
  return {
    chatId: timeline.chatId,
    active: timeline.active,
    paused: timeline.paused,
    revision: timeline.revision,
    health: timeline.health,
    error: timeline.error,
    actors,
    minds: Object.fromEntries(Object.entries(timeline.minds).filter(([actorId]) => visibleIds.has(actorId))),
    records: timeline.records
      .slice()
      .filter((record) => !record.skipReason)
      .sort((left, right) => left.messageIndex - right.messageIndex || left.createdAt - right.createdAt)
      .map((record) => ({
        id: record.id,
        messageId: record.messageId,
        messageIndex: record.messageIndex,
        swipeId: record.swipeId,
        createdAt: record.createdAt,
        changeCount: record.deltas.length,
        mentionCount: record.actorMentions.length,
        reduction: record.reduction ?? emptyReductionTelemetry(),
        controller: {
          provider: record.controller.provider,
          model: record.controller.model,
          dedicatedConnection: !!record.controller.connectionId,
          telemetry: record.controller.telemetry ?? null,
        },
      })),
    lastValidMessageIndex: timeline.lastValidMessageIndex,
    lastAnalyzedAt: timeline.lastAnalyzedAt,
    updatedAt: timeline.updatedAt,
  };
}

export function compactStateForController(
  timeline: ChatTimelineV1,
  settings: LumiMindSettings = DEFAULT_SETTINGS,
  _maxItemsPerActor?: number,
): unknown {
  return Object.values(timeline.actors).map((actor) => {
    const managed = actorMindEnabled(actor, settings);
    return {
      ref: actor.id,
      name: actor.canonicalName,
      aliases: actor.aliases,
      kind: actor.kind,
      managed,
      contextRole: !managed && actor.kind === "character" ? "director_card" : !managed ? "context_only_persona" : "mind",
      confirmed: actor.confirmed,
      present: managed && actor.present,
      ...(managed ? {
        core: timeline.minds[actor.id]?.core ?? timeline.baseMinds[actor.id]?.core ?? EMPTY_CORE,
        items: (timeline.minds[actor.id]?.items ?? [])
          .filter((item) => item.status === "active" || item.status === "uncertain")
          .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
          .map((item) => ({
            id: item.id,
            category: item.category,
            text: item.text,
            status: item.status,
            confidence: item.confidence,
            targetActorIds: item.targetActorIds,
            concealedFromActorIds: item.concealedFromActorIds,
            intensity: item.intensity,
            dimensions: item.dimensions,
            locked: item.locked,
            pinned: item.pinned,
            source: item.source,
          })),
      } : {}),
    };
  });
}
