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
  type CortexLinkResolution,
  type EvidenceRef,
  type InvalidMindChangeReason,
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
  analysisStateTokenBudget: 24_000,
  injectionTokenBudget: 8_000,
  injectionPosition: "prompt_start",
  analysisContextMessageLimit: 4,
  chatHistoryMessageLimit: 0,
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
  const controllerMaxTokens = typeof raw.controllerMaxTokens === "number"
    ? raw.controllerMaxTokens
    : Number(raw.controllerMaxTokens);
  const analysisStateTokenBudget = typeof raw.analysisStateTokenBudget === "number"
    ? raw.analysisStateTokenBudget
    : Number(raw.analysisStateTokenBudget);
  const injectionTokenBudget = typeof raw.injectionTokenBudget === "number"
    ? raw.injectionTokenBudget
    : Number(raw.injectionTokenBudget);
  const analysisContextMessageLimit = typeof raw.analysisContextMessageLimit === "number"
    ? raw.analysisContextMessageLimit
    : Number(raw.analysisContextMessageLimit);
  const chatHistoryMessageLimit = typeof raw.chatHistoryMessageLimit === "number"
    ? raw.chatHistoryMessageLimit
    : Number(raw.chatHistoryMessageLimit);
  return {
    controllerConnectionId: stringValue(raw.controllerConnectionId) || null,
    controllerTemperature: clamp(raw.controllerTemperature, 0, 2, DEFAULT_SETTINGS.controllerTemperature),
    controllerMaxTokens: Math.round(Number.isFinite(controllerMaxTokens)
      ? Math.max(300, controllerMaxTokens)
      : DEFAULT_SETTINGS.controllerMaxTokens),
    analysisStateTokenBudget: Math.round(Number.isFinite(analysisStateTokenBudget)
      ? Math.max(0, analysisStateTokenBudget)
      : DEFAULT_SETTINGS.analysisStateTokenBudget),
    injectionTokenBudget: Math.round(Number.isFinite(injectionTokenBudget)
      ? Math.max(0, injectionTokenBudget)
      : DEFAULT_SETTINGS.injectionTokenBudget),
    injectionPosition: raw.injectionPosition === "before_last_user" || raw.injectionPosition === "prompt_end"
      ? raw.injectionPosition
      : DEFAULT_SETTINGS.injectionPosition,
    analysisContextMessageLimit: Math.round(Number.isFinite(analysisContextMessageLimit)
      ? Math.max(0, analysisContextMessageLimit)
      : DEFAULT_SETTINGS.analysisContextMessageLimit),
    chatHistoryMessageLimit: Math.round(Number.isFinite(chatHistoryMessageLimit)
      ? Math.max(0, chatHistoryMessageLimit)
      : DEFAULT_SETTINGS.chatHistoryMessageLimit),
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
  return stableHash(`ledger-policy:1|${directorPolicy}${personaPolicy}persona:${settings.personaMindEnabled ? 1 : 0}|director:${settings.characterCardDirectorMode ? 1 : 0}`);
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

/**
 * Returns only transcript messages that belong to completed assistant turns.
 * A trailing user turn is intentionally held until its assistant response has
 * been committed, and an empty staged assistant message does not advance the
 * boundary, regardless of which host event requested reconciliation.
 */
export function selectCompletedAssistantTranscript(messages: ChatMessageLike[]): ChatMessageLike[] {
  const sorted = sortMessages(messages);
  let lastAssistantIndex = -1;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].role === "assistant" && sorted[index].content.trim().length > 0) {
      lastAssistantIndex = index;
      break;
    }
  }
  return lastAssistantIndex < 0 ? [] : sorted.slice(0, lastAssistantIndex + 1);
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

export function limitChatHistoryMessages<T extends { __isChatHistory?: boolean }>(messages: T[], messageLimit: number): T[] {
  const limit = Number.isFinite(messageLimit) ? Math.max(0, Math.floor(messageLimit)) : 0;
  if (limit === 0) return messages;
  let remaining = limit;
  const keep = new Array<boolean>(messages.length).fill(true);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].__isChatHistory !== true) continue;
    if (remaining > 0) remaining -= 1;
    else keep[index] = false;
  }
  return messages.filter((_, index) => keep[index]);
}

export function mindInjectionIndex(
  messages: Array<{ role?: unknown }>,
  position: LumiMindSettings["injectionPosition"],
): number {
  if (position === "prompt_end") return messages.length;
  if (position === "before_last_user") {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") return index;
    }
    return messages.length;
  }
  return 0;
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
    suppressedAliases: [],
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
    suppressedCortexEntityIds: [],
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
    actor.suppressedAliases = uniqueStrings(Array.isArray(actor.suppressedAliases) ? actor.suppressedAliases : []);
    const suppressed = new Set(actor.suppressedAliases.map((alias) => alias.toLocaleLowerCase()));
    actor.aliases = uniqueStrings(Array.isArray(actor.aliases) ? actor.aliases : [])
      .filter((alias) => !suppressed.has(alias.toLocaleLowerCase()));
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
    suppressedCortexEntityIds: uniqueStrings(
      Array.isArray(raw.suppressedCortexEntityIds)
        ? raw.suppressedCortexEntityIds.filter((id): id is string => typeof id === "string")
        : [],
    ),
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
    existing.suppressedAliases ??= [];
    const suppressed = new Set(existing.suppressedAliases.map((alias) => alias.toLocaleLowerCase()));
    existing.aliases = uniqueStrings([
      ...existing.aliases,
      ...(input.aliases ?? []),
      ...(existing.canonicalName.toLocaleLowerCase() !== input.name.trim().toLocaleLowerCase() ? [input.name] : []),
    ]).filter((alias) => !suppressed.has(alias.toLocaleLowerCase()));
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

export interface CortexIdentityInput {
  id: string;
  name: string;
  aliases: string[];
  confidence: number;
  confirmed: boolean;
}

function attachCortexIdentity(actor: ActorRecord, identity: CortexIdentityInput): void {
  actor.suppressedAliases ??= [];
  const suppressedAliases = new Set(actor.suppressedAliases.map((alias) => alias.toLocaleLowerCase()));
  actor.aliases = uniqueStrings([
    ...actor.aliases,
    ...identity.aliases,
    ...(actor.canonicalName.toLocaleLowerCase() !== identity.name.toLocaleLowerCase() ? [identity.name] : []),
  ]).filter((alias) => !suppressedAliases.has(alias.toLocaleLowerCase()));
  actor.cortexEntityId = identity.id;
  actor.confidence = Math.max(actor.confidence, clamp(identity.confidence, 0, 1, actor.confidence));
  actor.confirmed = actor.confirmed || identity.confirmed;
  actor.updatedAt = Date.now();
}

/** Clear chat-scoped Cortex bindings before moving a timeline into another chat. */
export function clearCortexBindings(timeline: ChatTimelineV1): void {
  for (const actor of Object.values(timeline.actors)) actor.cortexEntityId = null;
  timeline.suppressedCortexEntityIds = [];
}

/**
 * Reconcile Cortex's current character identities into LumiMind without changing
 * local canonical names or reviving identities the user removed locally.
 */
export function reconcileCortexIdentities(timeline: ChatTimelineV1, input: CortexIdentityInput[]): void {
  timeline.suppressedCortexEntityIds ??= [];
  const suppressedIds = new Set(timeline.suppressedCortexEntityIds);
  const identities = input.filter((identity) => identity.id.trim() && identity.name.trim() && !suppressedIds.has(identity.id));
  const currentIds = new Set(identities.map((identity) => identity.id));

  for (const actor of Object.values(timeline.actors)) {
    if (actor.cortexEntityId && !currentIds.has(actor.cortexEntityId)) {
      actor.cortexEntityId = null;
      actor.updatedAt = Date.now();
    }
  }

  const identityNames = new Map(identities.map((identity) => [
    identity.id,
    new Set([identity.name, ...identity.aliases].map((name) => name.trim().toLocaleLowerCase()).filter(Boolean)),
  ]));
  const unlinkedActors = Object.values(timeline.actors).filter((actor) => !actor.cortexEntityId);
  const matchesByIdentity = new Map<string, ActorRecord[]>();
  const matchCountByActor = new Map<string, number>();
  for (const identity of identities) {
    const names = identityNames.get(identity.id) ?? new Set<string>();
    const matches = unlinkedActors.filter((actor) => actorNames(actor).some((name) => names.has(name)));
    matchesByIdentity.set(identity.id, matches);
    for (const actor of matches) matchCountByActor.set(actor.id, (matchCountByActor.get(actor.id) ?? 0) + 1);
  }

  for (const identity of identities) {
    const linked = Object.values(timeline.actors).find((actor) => actor.cortexEntityId === identity.id);
    if (linked) {
      attachCortexIdentity(linked, identity);
      continue;
    }
    const matches = (matchesByIdentity.get(identity.id) ?? [])
      .filter((actor) => !actor.cortexEntityId && matchCountByActor.get(actor.id) === 1);
    if (matches.length === 1) {
      attachCortexIdentity(matches[0], identity);
      continue;
    }
    const preferredId = `cortex:${identity.id}`;
    const actor = createActor({
      id: timeline.actors[preferredId] ? `actor:${crypto.randomUUID()}` : preferredId,
      kind: "npc",
      name: identity.name,
      aliases: identity.aliases,
      cortexEntityId: identity.id,
      confidence: identity.confidence,
      confirmed: identity.confirmed,
    });
    timeline.actors[actor.id] = actor;
    timeline.baseMinds[actor.id] = makeBaseMind(actor.id);
    attachCortexIdentity(actor, identity);
  }
}

export function confirmActor(timeline: ChatTimelineV1, actorId: string): boolean {
  const actor = timeline.actors[actorId];
  if (!actor) return false;
  actor.confirmed = true;
  actor.confidence = 1;
  actor.updatedAt = Date.now();
  return true;
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

export function createCheckpointTimeline(source: ChatTimelineV1, targetChatId: string): ChatTimelineV1 {
  const checkpoint = createTimeline(targetChatId);
  checkpoint.analysisPolicyHash = source.analysisPolicyHash;
  checkpoint.active = true;
  checkpoint.paused = false;
  checkpoint.health = "ready";
  checkpoint.actors = Object.fromEntries(Object.entries(source.actors).map(([actorId, actor]) => [actorId, {
    ...actor,
    aliases: [...actor.aliases],
    suppressedAliases: [...(actor.suppressedAliases ?? [])],
  }]));
  checkpoint.suppressedCortexEntityIds = [...(source.suppressedCortexEntityIds ?? [])];
  if (source.chatId !== targetChatId) clearCortexBindings(checkpoint);
  checkpoint.baseMinds = Object.fromEntries(Object.keys(checkpoint.actors).map((actorId) => {
    const sourceMind = source.minds[actorId] ?? source.baseMinds[actorId] ?? makeBaseMind(actorId);
    const cloned = cloneMind(sourceMind);
    cloned.actorId = actorId;
    return [actorId, cloned];
  }));
  checkpoint.minds = Object.fromEntries(Object.entries(checkpoint.baseMinds).map(([actorId, mind]) => [actorId, cloneMind(mind)]));
  checkpoint.records = [];
  checkpoint.manualOverrides = [];
  checkpoint.lastValidMessageIndex = -1;
  checkpoint.lastAnalyzedAt = source.lastAnalyzedAt;
  checkpoint.updatedAt = Date.now();
  return checkpoint;
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
  return item.locked;
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
  return {
    duplicatesSuppressed: 0,
    entriesUpdated: 0,
    entriesSuperseded: 0,
    invalidChangesRejected: 0,
    invalidChangeReasons: {},
  };
}

function rejectMindChange(reduction: MindReductionTelemetry, reason: InvalidMindChangeReason): void {
  reduction.invalidChangesRejected += 1;
  reduction.invalidChangeReasons[reason] = (reduction.invalidChangeReasons[reason] ?? 0) + 1;
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
      const suppressed = new Set((actor.suppressedAliases ?? []).map((alias) => alias.toLocaleLowerCase()));
      actor.aliases = uniqueStrings([...actor.aliases, ...mention.aliases])
        .filter((alias) => !suppressed.has(alias.toLocaleLowerCase()));
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
      else rejectMindChange(reduction, "protected_target");
      continue;
    }
    if (delta.operation === "remove") {
      if (targetIndex >= 0) {
        mind.items.splice(targetIndex, 1);
        mind.lastUpdatedMessageId = delta.evidence.messageId;
      } else {
        rejectMindChange(reduction, delta.targetItemId ? "target_not_found" : "missing_target_id");
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
        rejectMindChange(reduction, delta.targetItemId ? "target_not_found" : "missing_target_id");
      }
      continue;
    }
    if (!delta.text.trim()) {
      rejectMindChange(reduction, "missing_text");
      continue;
    }
    if (delta.operation === "update" && targetIndex < 0) {
      rejectMindChange(reduction, delta.targetItemId ? "target_not_found" : "missing_target_id");
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
    prefixHash = nextPrefixHash(prefixHash, contentHash, swipeId);
  }
  const overrides = [...timeline.manualOverrides].sort((left, right) => left.createdAt - right.createdAt);
  let overrideIndex = 0;
  for (const record of matchedRecords) {
    const beforeRecord: ManualOverride[] = [];
    while (overrideIndex < overrides.length && overrides[overrideIndex].createdAt <= record.createdAt) {
      beforeRecord.push(overrides[overrideIndex]);
      overrideIndex += 1;
    }
    applyManualOverrides(minds, beforeRecord);
    record.reduction = applyRecord(record, timeline.actors, minds);
  }
  applyManualOverrides(minds, overrides.slice(overrideIndex));
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
    const suppressed = new Set((actor.suppressedAliases ?? []).map((alias) => alias.toLocaleLowerCase()));
    actor.aliases = uniqueStrings([...actor.aliases, ...(raw.aliases ?? [])])
      .filter((alias) => !suppressed.has(alias.toLocaleLowerCase()));
    refs.set(stableReference.toLocaleLowerCase(), id);
    refs.set(raw.name.trim().toLocaleLowerCase(), id);
    for (const alias of actor.aliases) refs.set(alias.trim().toLocaleLowerCase(), id);
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

export function mergeActors(
  timeline: ChatTimelineV1,
  sourceActorId: string,
  targetActorId: string,
  cortexLink?: CortexLinkResolution,
): boolean {
  const source = timeline.actors[sourceActorId];
  const target = timeline.actors[targetActorId];
  if (!source || !target || sourceActorId === targetActorId) return false;
  const cortexConflict = !!source.cortexEntityId
    && !!target.cortexEntityId
    && source.cortexEntityId !== target.cortexEntityId;
  if (cortexConflict && !cortexLink) return false;
  timeline.suppressedCortexEntityIds ??= [];
  if (cortexConflict) {
    const discardedId = cortexLink === "source" ? target.cortexEntityId : source.cortexEntityId;
    if (discardedId) timeline.suppressedCortexEntityIds = uniqueStrings([...timeline.suppressedCortexEntityIds, discardedId]);
    if (cortexLink === "source") target.cortexEntityId = source.cortexEntityId;
  }
  target.suppressedAliases = uniqueStrings([...(target.suppressedAliases ?? []), ...(source.suppressedAliases ?? [])]);
  const suppressed = new Set(target.suppressedAliases.map((alias) => alias.toLocaleLowerCase()));
  target.aliases = uniqueStrings([...target.aliases, source.canonicalName, ...source.aliases])
    .filter((alias) => !suppressed.has(alias.toLocaleLowerCase()));
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
  const actor = timeline.actors[actorId];
  if (!actor) return false;
  timeline.suppressedCortexEntityIds ??= [];
  if (actor.cortexEntityId) {
    timeline.suppressedCortexEntityIds = uniqueStrings([...timeline.suppressedCortexEntityIds, actor.cortexEntityId]);
  }
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
  const sourceMind = timeline.minds[actorId] ?? timeline.baseMinds[actorId] ?? makeBaseMind(actorId);
  const cloned = cloneMind(sourceMind);
  cloned.actorId = actor.id;
  cloned.items = cloned.items.map((item) => ({ ...item, id: `${item.id}:split:${crypto.randomUUID()}` }));
  timeline.baseMinds[actor.id] = cloned;
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
  includedItemIds?: Set<string>,
  includeEmpty = false,
): string {
  const actor = actors[mind.actorId];
  if (!actor) return "";
  const relevant = new Set(mind.presentActorIds);
  const items = [...mind.items]
    .filter((item) => item.status === "active" || item.status === "uncertain")
    .filter((item) => !includedItemIds || includedItemIds.has(item.id))
    .sort((left, right) => itemScore(right, relevant) - itemScore(left, relevant));
  const details: string[] = [];
  if (mind.core.values.length) details.push(`Values: ${mind.core.values.join("; ")}`);
  if (mind.core.desires.length) details.push(`Desires: ${mind.core.desires.join("; ")}`);
  if (mind.core.fears.length) details.push(`Fears: ${mind.core.fears.join("; ")}`);
  if (mind.core.boundaries.length) details.push(`Boundaries: ${mind.core.boundaries.join("; ")}`);
  if (mind.core.notes.length) details.push(`Notes: ${mind.core.notes.join("; ")}`);
  for (const item of items) {
    const targets = item.targetActorIds.length ? ` [toward ${item.targetActorIds.map((id) => actorLabel(actors, id)).join(", ")}]` : "";
    const confidence = item.confidence < 0.8 ? ` (${Math.round(item.confidence * 100)}% confidence)` : "";
    const line = `- ${item.category}: ${item.text}${targets}${confidence}`;
    details.push(line);
  }
  if (!details.length && !includeEmpty) return "";
  return [`${actor.canonicalName} (${actor.kind}${actor.present ? ", present" : ""})`, ...details].join("\n");
}

function presentManagedActors(
  timeline: ChatTimelineV1,
  settings: LumiMindSettings,
  targetActorId: string | null,
): ActorRecord[] {
  return Object.values(timeline.actors)
    .filter((actor) => actor.present && timeline.minds[actor.id] && actorMindEnabled(actor, settings))
    .sort((left, right) =>
      Number(right.id === targetActorId) - Number(left.id === targetActorId) ||
      Number(right.confirmed) - Number(left.confirmed) ||
      right.updatedAt - left.updatedAt,
    );
}

function renderMindInjection(
  timeline: ChatTimelineV1,
  targetActorId: string | null,
  settings: LumiMindSettings,
  includedItemIds?: Set<string>,
): string | null {
  const presentActors = presentManagedActors(timeline, settings, targetActorId);
  const minds = presentActors
    .map((actor) => formatMind(timeline.minds[actor.id], timeline.actors, includedItemIds, !!includedItemIds))
    .filter(Boolean);
  const body = minds.join("\n\n");
  const unmanagedPersonaGuidance = !settings.personaMindEnabled
    ? "The user persona is unmanaged. Do not decide their thoughts, feelings, dialogue, or actions for them."
    : "";
  if (!body.trim() && !unmanagedPersonaGuidance) return null;
  return [
    "[LumiMind — private subjective continuity]",
    "The following is private mental state, not objective truth. Preserve false beliefs and uncertainty.",
    "Use it to guide choices and subtext. Do not quote or summarize this block. Reveal secrets only through character-motivated behavior.",
    ...(unmanagedPersonaGuidance ? [unmanagedPersonaGuidance] : []),
    "",
    ...(body ? [body] : []),
    "[/LumiMind]",
  ].join("\n");
}

export function buildMindInjection(
  timeline: ChatTimelineV1,
  targetActorId: string | null,
  settings: LumiMindSettings = DEFAULT_SETTINGS,
): string | null {
  if (!timeline.active || timeline.paused) return null;
  return renderMindInjection(timeline, targetActorId, settings);
}

function renderDirectorMindInjection(
  timeline: ChatTimelineV1,
  settings: LumiMindSettings,
  includedItemIds?: Set<string>,
): string | null {
  const actors = presentManagedActors(timeline, settings, null);
  if (!actors.length) return null;
  const body = actors
    .map((actor) => formatMind(timeline.minds[actor.id], timeline.actors, includedItemIds, !!includedItemIds))
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

export function buildDirectorMindInjection(
  timeline: ChatTimelineV1,
  settings: LumiMindSettings = DEFAULT_SETTINGS,
): string | null {
  if (!timeline.active || timeline.paused) return null;
  return renderDirectorMindInjection(timeline, settings);
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
            controllerWritable: !protectedMindItem(item),
          })),
      } : {}),
    };
  });
}

export interface TokenMeasurement {
  totalTokens: number;
  model: string | null;
  tokenizerName: string | null;
  approximate: boolean;
  fallback: boolean;
}

export type TokenCounter = (text: string) => Promise<TokenMeasurement>;

export interface ProjectionTelemetry {
  tokenBudget: number;
  totalTokens: number;
  itemsAvailable: number;
  itemsIncluded: number;
  itemsOmitted: number;
  actorCount: number;
  tokenModel: string | null;
  tokenizerName: string | null;
  tokenCountApproximate: boolean;
  tokenCountFallback: boolean;
}

export interface ControllerStateProjection {
  state: unknown;
  telemetry: ProjectionTelemetry;
}

export interface MindInjectionProjection {
  content: string | null;
  telemetry: ProjectionTelemetry;
}

type CompactStateItem = {
  id: string;
  category?: MindCategory;
  text?: string;
  targetActorIds?: string[];
  concealedFromActorIds?: string[];
  locked?: boolean;
  pinned?: boolean;
  source?: string;
  controllerWritable?: boolean;
  [key: string]: unknown;
};

type CompactStateActor = {
  ref: string;
  name: string;
  aliases: string[];
  managed?: boolean;
  present?: boolean;
  confirmed?: boolean;
  items?: CompactStateItem[];
  [key: string]: unknown;
};

function projectionTelemetry(
  budget: number,
  measurement: TokenMeasurement,
  available: number,
  included: number,
  actorCount: number,
): ProjectionTelemetry {
  return {
    tokenBudget: budget,
    totalTokens: measurement.totalTokens,
    itemsAvailable: available,
    itemsIncluded: included,
    itemsOmitted: Math.max(0, available - included),
    actorCount,
    tokenModel: measurement.model,
    tokenizerName: measurement.tokenizerName,
    tokenCountApproximate: measurement.approximate,
    tokenCountFallback: measurement.fallback,
  };
}

function referenceAppears(content: string, reference: string): boolean {
  const value = reference.trim();
  if (value.length < 2) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(content);
}

function textTokenSet(value: string): Set<string> {
  return new Set(canonicalMindText(value).split(" ").filter(Boolean));
}

function sharedTokenCount(value: string, tokens: Set<string>): number {
  if (!value || tokens.size === 0) return 0;
  let shared = 0;
  for (const token of textTokenSet(value)) if (tokens.has(token)) shared += 1;
  return shared;
}

function roundRobinOrder<T>(queues: Array<{ score: number; lead: number; values: T[] }>): T[] {
  const orderedQueues = queues
    .filter((queue) => queue.values.length > 0)
    .sort((left, right) => right.score - left.score);
  const result: T[] = [];
  const consumed = new Map(orderedQueues.map((queue) => [queue, 0]));
  const maxLead = Math.max(0, ...orderedQueues.map((queue) => queue.lead));
  for (let depth = 0; depth < maxLead; depth += 1) {
    for (const queue of orderedQueues) {
      if (depth >= queue.lead) continue;
      const value = queue.values[depth];
      if (value !== undefined) {
        result.push(value);
        consumed.set(queue, depth + 1);
      }
    }
  }
  while (orderedQueues.some((queue) => (consumed.get(queue) ?? 0) < queue.values.length)) {
    for (const queue of orderedQueues) {
      const index = consumed.get(queue) ?? 0;
      const value = queue.values[index];
      if (value !== undefined) {
        result.push(value);
        consumed.set(queue, index + 1);
      }
    }
  }
  return result;
}

async function fitProjectionToBudget(
  fullText: string,
  baseText: string,
  orderedCandidates: Array<{ id: string; estimatedChars: number }>,
  tokenBudget: number,
  countTokens: TokenCounter,
  render: (includedIds: Set<string>) => string,
): Promise<{ text: string; includedIds: Set<string>; measurement: TokenMeasurement }> {
  const fullMeasurement = await countTokens(fullText);
  if (tokenBudget === 0 || fullMeasurement.totalTokens <= tokenBudget) {
    return {
      text: fullText,
      includedIds: new Set(orderedCandidates.map((candidate) => candidate.id)),
      measurement: fullMeasurement,
    };
  }

  const baseMeasurement = await countTokens(baseText);
  if (baseMeasurement.totalTokens >= tokenBudget || orderedCandidates.length === 0) {
    return { text: baseText, includedIds: new Set(), measurement: baseMeasurement };
  }

  const charsPerToken = Math.max(1, fullText.length / Math.max(1, fullMeasurement.totalTokens));
  const estimatedAvailableChars = Math.max(0, (tokenBudget - baseMeasurement.totalTokens) * charsPerToken);
  const selectedOrder: string[] = [];
  let estimatedChars = 0;
  for (const candidate of orderedCandidates) {
    if (estimatedChars + candidate.estimatedChars > estimatedAvailableChars) continue;
    selectedOrder.push(candidate.id);
    estimatedChars += candidate.estimatedChars;
  }

  let includedIds = new Set(selectedOrder);
  let text = render(includedIds);
  let measurement = await countTokens(text);
  while (measurement.totalTokens > tokenBudget && selectedOrder.length > 0) {
    const keepRatio = tokenBudget / Math.max(1, measurement.totalTokens);
    const keepCount = Math.max(0, Math.min(selectedOrder.length - 1, Math.floor(selectedOrder.length * keepRatio) - 1));
    selectedOrder.splice(keepCount);
    includedIds = new Set(selectedOrder);
    text = render(includedIds);
    measurement = await countTokens(text);
  }
  return { text, includedIds, measurement };
}

function compactActors(value: unknown): CompactStateActor[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const actor = asObject(entry);
    const items = Array.isArray(actor.items)
      ? actor.items.flatMap((item) => {
          const raw = asObject(item);
          const id = stringValue(raw.id);
          return id ? [{ ...raw, id } as CompactStateItem] : [];
        })
      : undefined;
    return {
      ...actor,
      ref: stringValue(actor.ref),
      name: stringValue(actor.name),
      aliases: strings(actor.aliases),
      ...(items ? { items } : {}),
    } as CompactStateActor;
  });
}

function renderCompactStateProjection(actors: CompactStateActor[], includedIds: Set<string>): CompactStateActor[] {
  return actors.map((actor) => {
    if (!actor.items) return { ...actor };
    const items = actor.items.filter((item) => includedIds.has(item.id));
    return {
      ...actor,
      items,
      availableItemCount: actor.items.length,
      omittedItemCount: actor.items.length - items.length,
    };
  });
}

function orderedCompactStateCandidates(
  actors: CompactStateActor[],
  messages: ChatMessageLike[],
  recentContext: ChatMessageLike[],
): Array<{ id: string; estimatedChars: number }> {
  const currentText = messages.map((message) => `${message.name ?? ""}\n${message.content}`).join("\n");
  const contextText = recentContext.map((message) => `${message.name ?? ""}\n${message.content}`).join("\n");
  const currentTokens = textTokenSet(currentText);
  const contextTokens = textTokenSet(contextText);
  const relevantActorRefs = new Set(
    actors
      .filter((actor) => [actor.name, ...actor.aliases].some((reference) => referenceAppears(currentText, reference)))
      .map((actor) => actor.ref),
  );

  return roundRobinOrder(actors.map((actor) => {
    const currentMention = [actor.name, ...actor.aliases].some((reference) => referenceAppears(currentText, reference));
    const contextMention = [actor.name, ...actor.aliases].some((reference) => referenceAppears(contextText, reference));
    const actorScore = Number(currentMention) * 1_000 + Number(actor.present) * 500 + Number(contextMention) * 250 + Number(actor.confirmed) * 25;
    const values = (actor.items ?? [])
      .map((item, index) => {
        const protectedItem = item.controllerWritable === false || item.locked === true || item.pinned === true;
        const targetRelevant = (item.targetActorIds ?? []).some((ref) => relevantActorRefs.has(ref));
        const score = Number(protectedItem) * 2_000 + Number(targetRelevant) * 750 +
          sharedTokenCount(item.text ?? "", currentTokens) * 120 + sharedTokenCount(item.text ?? "", contextTokens) * 30 +
          (item.category ? CATEGORY_ORDER[item.category] ?? 0 : 0) * 5 - index;
        return { item, score };
      })
      .sort((left, right) => right.score - left.score)
      .map(({ item }) => ({ id: item.id, estimatedChars: JSON.stringify(item).length + 2 }));
    return { score: actorScore, lead: currentMention ? 3 : actor.present || contextMention ? 1 : 0, values };
  }));
}

export async function projectControllerState(
  compactState: unknown,
  messages: ChatMessageLike[],
  recentContext: ChatMessageLike[],
  tokenBudget: number,
  countTokens: TokenCounter,
): Promise<ControllerStateProjection> {
  const actors = compactActors(compactState);
  const available = actors.reduce((sum, actor) => sum + (actor.items?.length ?? 0), 0);
  const fullText = JSON.stringify(compactState);
  const orderedCandidates = orderedCompactStateCandidates(actors, messages, recentContext);
  const baseState = renderCompactStateProjection(actors, new Set());
  const render = (includedIds: Set<string>) => JSON.stringify(renderCompactStateProjection(actors, includedIds));
  const fitted = await fitProjectionToBudget(
    fullText,
    JSON.stringify(baseState),
    orderedCandidates,
    tokenBudget,
    countTokens,
    render,
  );
  const fullIncluded = tokenBudget === 0 || fitted.includedIds.size === orderedCandidates.length;
  const state = fullIncluded ? compactState : JSON.parse(fitted.text) as unknown;
  return {
    state,
    telemetry: projectionTelemetry(tokenBudget, fitted.measurement, available, fullIncluded ? available : fitted.includedIds.size, actors.length),
  };
}

function orderedInjectionCandidates(
  timeline: ChatTimelineV1,
  actors: ActorRecord[],
  targetActorId: string | null,
  contextMessages: Array<{ content: string; name?: string }>,
): Array<{ id: string; estimatedChars: number }> {
  const contextText = contextMessages.map((message) => `${message.name ?? ""}\n${message.content}`).join("\n");
  const contextTokens = textTokenSet(contextText);
  const relevantActorIds = new Set(
    actors
      .filter((actor) => actor.id === targetActorId || [actor.canonicalName, ...actor.aliases].some((reference) => referenceAppears(contextText, reference)))
      .map((actor) => actor.id),
  );
  return roundRobinOrder(actors.map((actor) => {
    const actorScore = Number(actor.id === targetActorId) * 2_000 + Number(relevantActorIds.has(actor.id)) * 1_000 + Number(actor.confirmed) * 25;
    const values = (timeline.minds[actor.id]?.items ?? [])
      .filter((item) => item.status === "active" || item.status === "uncertain")
      .map((item) => ({
        item,
        score: Number(protectedMindItem(item)) * 2_000 +
          Number(item.targetActorIds.some((id) => relevantActorIds.has(id))) * 750 +
          sharedTokenCount(item.text, contextTokens) * 100 + itemScore(item, relevantActorIds),
      }))
      .sort((left, right) => right.score - left.score)
      .map(({ item }) => ({ id: item.id, estimatedChars: item.text.length + item.id.length + 48 }));
    return { score: actorScore, lead: actor.id === targetActorId ? 4 : relevantActorIds.has(actor.id) ? 2 : 0, values };
  }));
}

async function projectMindInjection(
  timeline: ChatTimelineV1,
  targetActorId: string | null,
  settings: LumiMindSettings,
  contextMessages: Array<{ content: string; name?: string }>,
  countTokens: TokenCounter,
  director: boolean,
): Promise<MindInjectionProjection> {
  const actors = presentManagedActors(timeline, settings, director ? null : targetActorId);
  const allItems = actors.flatMap((actor) => (timeline.minds[actor.id]?.items ?? [])
    .filter((item) => item.status === "active" || item.status === "uncertain")
  );
  const allItemIds = new Set(allItems.map((item) => item.id));
  const available = allItems.length;
  const fullContent = director
    ? renderDirectorMindInjection(timeline, settings, allItemIds)
    : renderMindInjection(timeline, targetActorId, settings, allItemIds);
  const emptyMeasurement = await countTokens(fullContent ?? "");
  if (!fullContent) {
    return { content: null, telemetry: projectionTelemetry(settings.injectionTokenBudget, emptyMeasurement, available, 0, actors.length) };
  }
  const orderedCandidates = orderedInjectionCandidates(timeline, actors, targetActorId, contextMessages);
  const render = (includedIds: Set<string>) => (
    director
      ? renderDirectorMindInjection(timeline, settings, includedIds)
      : renderMindInjection(timeline, targetActorId, settings, includedIds)
  ) ?? "";
  const fitted = await fitProjectionToBudget(
    fullContent,
    render(new Set()),
    orderedCandidates,
    settings.injectionTokenBudget,
    countTokens,
    render,
  );
  const fullIncluded = settings.injectionTokenBudget === 0 || fitted.includedIds.size === orderedCandidates.length;
  return {
    content: fullIncluded ? fullContent : fitted.text,
    telemetry: projectionTelemetry(settings.injectionTokenBudget, fitted.measurement, available, fullIncluded ? available : fitted.includedIds.size, actors.length),
  };
}

export function buildProjectedMindInjection(
  timeline: ChatTimelineV1,
  targetActorId: string | null,
  settings: LumiMindSettings,
  contextMessages: Array<{ content: string; name?: string }>,
  countTokens: TokenCounter,
): Promise<MindInjectionProjection> {
  return projectMindInjection(timeline, targetActorId, settings, contextMessages, countTokens, false);
}

export function buildProjectedDirectorMindInjection(
  timeline: ChatTimelineV1,
  settings: LumiMindSettings,
  contextMessages: Array<{ content: string; name?: string }>,
  countTokens: TokenCounter,
): Promise<MindInjectionProjection> {
  return projectMindInjection(timeline, null, settings, contextMessages, countTokens, true);
}
