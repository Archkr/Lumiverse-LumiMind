// src/types.ts
var MIND_SCHEMA_VERSION = 1;
var ANALYSIS_SCHEMA_VERSION = 1;
var EXTENSION_KEY = "lumi_mind";

// src/engine.ts
var DEFAULT_SETTINGS = {
  controllerConnectionId: null,
  controllerTemperature: 0.1,
  controllerMaxTokens: 1800,
  analysisContextMessageLimit: 4,
  chatHistoryMessageLimit: 0,
  personaMindEnabled: true,
  characterCardDirectorMode: false,
  cortexImportEnabled: true,
  cortexWritebackEnabled: false,
  privateInteropEnabled: false,
  spoilerSafe: true
};
var EMPTY_CORE = {
  selfConcept: "",
  values: [],
  desires: [],
  fears: [],
  boundaries: [],
  notes: []
};
var EMPTY_EVIDENCE = { messageId: "seed", swipeId: 0, excerpt: "Mind seed", messageIndex: -1 };
var CATEGORY_ORDER = {
  goal: 7,
  plan: 6,
  secret: 5,
  belief: 4,
  relationship: 3,
  emotion: 2,
  awareness: 1
};
function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stringValue(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}
function strings(value) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((entry) => typeof entry === "string"));
}
function uniqueStrings(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
function clamp(value, min, max, fallback) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
function normalizeSettings(value) {
  const raw = asObject(value);
  const characterCardDirectorMode = raw.characterCardDirectorMode === true;
  return {
    controllerConnectionId: stringValue(raw.controllerConnectionId) || null,
    controllerTemperature: clamp(raw.controllerTemperature, 0, 2, DEFAULT_SETTINGS.controllerTemperature),
    controllerMaxTokens: Math.round(clamp(raw.controllerMaxTokens, 300, 8e3, DEFAULT_SETTINGS.controllerMaxTokens)),
    analysisContextMessageLimit: Math.round(clamp(raw.analysisContextMessageLimit, 0, 50, DEFAULT_SETTINGS.analysisContextMessageLimit)),
    chatHistoryMessageLimit: Math.round(clamp(raw.chatHistoryMessageLimit, 0, 1e3, DEFAULT_SETTINGS.chatHistoryMessageLimit)),
    personaMindEnabled: raw.personaMindEnabled !== false,
    characterCardDirectorMode,
    cortexImportEnabled: raw.cortexImportEnabled !== false,
    cortexWritebackEnabled: raw.cortexWritebackEnabled === true,
    privateInteropEnabled: raw.privateInteropEnabled === true,
    spoilerSafe: raw.spoilerSafe !== false
  };
}
function normalizeCore(value) {
  const raw = asObject(value);
  return {
    selfConcept: stringValue(raw.selfConcept),
    values: strings(raw.values),
    desires: strings(raw.desires),
    fears: strings(raw.fears),
    boundaries: strings(raw.boundaries),
    notes: strings(raw.notes)
  };
}
function normalizeSeed(value) {
  const raw = asObject(value);
  if (!Object.keys(raw).length) return null;
  const priors = Array.isArray(raw.relationshipPriors) ? raw.relationshipPriors.flatMap((entry) => {
    const item = asObject(entry);
    const target = stringValue(item.target);
    const stance = stringValue(item.stance);
    return target && stance ? [{ target, stance }] : [];
  }) : [];
  return {
    schemaVersion: MIND_SCHEMA_VERSION,
    core: normalizeCore(raw.core),
    startingBeliefs: strings(raw.startingBeliefs),
    startingSecrets: strings(raw.startingSecrets),
    startingGoals: strings(raw.startingGoals),
    relationshipPriors: priors,
    updatedAt: Math.round(clamp(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()))
  };
}
function makeEmptySeed(core = {}) {
  return {
    schemaVersion: MIND_SCHEMA_VERSION,
    core: normalizeCore({ ...EMPTY_CORE, ...core }),
    startingBeliefs: [],
    startingSecrets: [],
    startingGoals: [],
    relationshipPriors: [],
    updatedAt: Date.now()
  };
}
function stableHash(input) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}
function normalizedMindText(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function canonicalMindText(value) {
  return normalizedMindText(value);
}
function mindTextsNearDuplicate(left, right) {
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
function analysisPolicyHash(settings) {
  const directorPolicy = settings.characterCardDirectorMode ? "director-policy:3|" : "";
  const personaPolicy = settings.personaMindEnabled ? "" : "persona-policy:2|";
  return stableHash(`${directorPolicy}${personaPolicy}persona:${settings.personaMindEnabled ? 1 : 0}|director:${settings.characterCardDirectorMode ? 1 : 0}`);
}
function actorMindEnabled(actor, settings) {
  if (actor.kind === "persona") return settings.personaMindEnabled;
  if (actor.kind === "character" && actor.characterId) return !settings.characterCardDirectorMode;
  return true;
}
function messageContentHash(message) {
  return stableHash(`${message.role}
${message.name ?? ""}
${message.content}`);
}
function nextPrefixHash(prefixHash, contentHash, swipeId) {
  return stableHash(`${prefixHash}|${contentHash}|${swipeId}`);
}
function sortMessages(messages) {
  return messages.filter((message) => message && typeof message.id === "string" && (message.role === "user" || message.role === "assistant")).map((message, index) => ({ ...message, index_in_chat: message.index_in_chat ?? index })).sort((left, right) => (left.index_in_chat ?? 0) - (right.index_in_chat ?? 0));
}
function selectAnalysisWorkBatch(messages, start, maxMessages, settings) {
  const first = messages[start];
  if (!first) return { messages: [], skipReason: null };
  const shouldSkip = (message) => !settings.personaMindEnabled && message.role === "user";
  const skip = shouldSkip(first);
  const selected = [];
  const limit = Math.max(1, Math.floor(maxMessages));
  for (let index = start; index < messages.length && selected.length < limit; index += 1) {
    const message = messages[index];
    if (shouldSkip(message) !== skip) break;
    selected.push(message);
  }
  return {
    messages: selected,
    skipReason: skip ? "unmanaged_user_message" : null
  };
}
function selectAnalysisRecentContext(messages, analysisStart, messageLimit) {
  const limit = Number.isFinite(messageLimit) ? Math.max(0, Math.floor(messageLimit)) : 0;
  if (limit === 0 || analysisStart <= 0) return [];
  return messages.slice(Math.max(0, analysisStart - limit), analysisStart);
}
function limitChatHistoryMessages(messages, messageLimit) {
  const limit = Number.isFinite(messageLimit) ? Math.max(0, Math.floor(messageLimit)) : 0;
  if (limit === 0) return messages;
  let remaining = limit;
  const keep = new Array(messages.length).fill(true);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].__isChatHistory !== true) continue;
    if (remaining > 0) remaining -= 1;
    else keep[index] = false;
  }
  return messages.filter((_, index) => keep[index]);
}
function createActor(input) {
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
    updatedAt: now
  };
}
function seedItem(actorId, category2, text2, index) {
  const now = Date.now();
  return {
    id: `seed:${actorId}:${category2}:${stableHash(`${index}:${text2}`)}`,
    category: category2,
    text: text2,
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
    updatedAt: now
  };
}
function makeBaseMind(actorId, seed) {
  const normalized = seed ?? makeEmptySeed();
  const items = [
    ...normalized.startingBeliefs.map((text2, index) => seedItem(actorId, "belief", text2, index)),
    ...normalized.startingSecrets.map((text2, index) => seedItem(actorId, "secret", text2, index)),
    ...normalized.startingGoals.map((text2, index) => seedItem(actorId, "goal", text2, index)),
    ...normalized.relationshipPriors.map(
      (prior, index) => seedItem(actorId, "relationship", `${prior.target}: ${prior.stance}`, index)
    )
  ];
  return {
    actorId,
    core: normalized.core,
    items,
    sceneSummary: "",
    attention: "",
    presentActorIds: [],
    lastUpdatedMessageId: null
  };
}
function createTimeline(chatId) {
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
    updatedAt: Date.now()
  };
}
function normalizeTimeline(value, chatId) {
  const raw = asObject(value);
  if (raw.schemaVersion !== MIND_SCHEMA_VERSION || raw.chatId !== chatId) return createTimeline(chatId);
  const fallback = createTimeline(chatId);
  const actors = Object.fromEntries(Object.entries(asObject(raw.actors)).map(([id, value2]) => {
    const actor = { ...value2, id };
    if (actor.kind === "character" && !actor.characterId) actor.kind = "npc";
    if (actor.kind === "persona" && !actor.personaId) actor.kind = "npc";
    return [id, actor];
  }));
  return {
    ...fallback,
    ...raw,
    schemaVersion: MIND_SCHEMA_VERSION,
    chatId,
    analysisPolicyHash: stringValue(raw.analysisPolicyHash, analysisPolicyHash(DEFAULT_SETTINGS)),
    active: raw.active === true,
    paused: raw.paused === true,
    revision: Math.round(clamp(raw.revision, 0, Number.MAX_SAFE_INTEGER, 0)),
    actors,
    baseMinds: asObject(raw.baseMinds),
    minds: asObject(raw.minds),
    records: Array.isArray(raw.records) ? raw.records : [],
    manualOverrides: Array.isArray(raw.manualOverrides) ? raw.manualOverrides : [],
    lastValidMessageIndex: Math.round(clamp(raw.lastValidMessageIndex, -1, Number.MAX_SAFE_INTEGER, -1)),
    updatedAt: Math.round(clamp(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()))
  };
}
function actorNames(actor) {
  return [actor.canonicalName, ...actor.aliases].map((name) => name.trim().toLocaleLowerCase()).filter(Boolean);
}
function resolveActorId(actors, reference) {
  const normalized = reference.trim().toLocaleLowerCase();
  if (!normalized) return null;
  if (actors[reference]) return reference;
  const matches = Object.values(actors).filter((actor) => actorNames(actor).includes(normalized));
  return matches.length === 1 ? matches[0].id : null;
}
function upsertActor(timeline, input, evidence) {
  const stableId = input.characterId ? `character:${input.characterId}` : input.personaId ? `persona:${input.personaId}` : input.id;
  const byStable = stableId ? timeline.actors[stableId] : null;
  const byNameId = resolveActorId(timeline.actors, input.name);
  const byCortex = input.cortexEntityId ? Object.values(timeline.actors).find((actor2) => actor2.cortexEntityId === input.cortexEntityId) : null;
  const existing = byStable ?? byCortex ?? (byNameId ? timeline.actors[byNameId] : null);
  if (existing) {
    existing.aliases = uniqueStrings([
      ...existing.aliases,
      ...input.aliases ?? [],
      ...existing.canonicalName.toLocaleLowerCase() !== input.name.trim().toLocaleLowerCase() ? [input.name] : []
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
function cloneMind(mind) {
  return {
    ...mind,
    core: { ...mind.core, values: [...mind.core.values], desires: [...mind.core.desires], fears: [...mind.core.fears], boundaries: [...mind.core.boundaries], notes: [...mind.core.notes] },
    items: mind.items.map((item) => ({
      ...item,
      targetActorIds: [...item.targetActorIds],
      concealedFromActorIds: [...item.concealedFromActorIds],
      dimensions: { ...item.dimensions },
      evidence: { ...item.evidence }
    })),
    presentActorIds: [...mind.presentActorIds]
  };
}
function decayEmotions(minds) {
  for (const mind of Object.values(minds)) {
    mind.items = mind.items.flatMap((item) => {
      if (item.category !== "emotion" || item.locked || item.intensity === null) return [item];
      const intensity = Number((item.intensity * 0.85).toFixed(3));
      return intensity < 0.1 ? [] : [{ ...item, intensity }];
    });
  }
}
function sameActorIds(left, right) {
  const normalizedLeft = uniqueStrings(left).sort();
  const normalizedRight = uniqueStrings(right).sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}
function protectedMindItem(item) {
  return item.locked || item.pinned || item.source !== "controller";
}
function matchingMindItem(mind, delta) {
  if (delta.targetItemId) {
    const index = mind.items.findIndex((item) => item.id === delta.targetItemId);
    if (index >= 0) return { index, kind: "target" };
  }
  if (delta.operation !== "add") return null;
  const candidates = mind.items.map((item, index) => ({ item, index })).filter(
    ({ item }) => (item.status === "active" || item.status === "uncertain") && item.category === delta.category && sameActorIds(item.targetActorIds, delta.targetActorIds) && sameActorIds(item.concealedFromActorIds, delta.concealedFromActorIds)
  );
  const deltaCanonical = canonicalMindText(delta.text);
  const exact = deltaCanonical ? candidates.find(({ item }) => canonicalMindText(item.text) === deltaCanonical) : void 0;
  if (exact) return { index: exact.index, kind: "exact" };
  const near = candidates.find(({ item }) => mindTextsNearDuplicate(item.text, delta.text));
  if (near) return { index: near.index, kind: "near" };
  if (delta.category === "relationship" && delta.targetActorIds.length > 0) {
    const relationship = candidates[0];
    if (relationship) return { index: relationship.index, kind: "relationship" };
  }
  return null;
}
function emptyReductionTelemetry() {
  return { duplicatesSuppressed: 0, entriesUpdated: 0, entriesSuperseded: 0, invalidChangesRejected: 0 };
}
function itemFromDelta(delta) {
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
    updatedAt: delta.createdAt
  };
}
function applyRecord(record, actors, minds) {
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
    const mind = minds[delta.subjectActorId] ??= makeBaseMind(delta.subjectActorId);
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
          ...target,
          status: delta.operation === "resolve" ? "resolved" : "abandoned",
          evidence: { ...delta.evidence },
          updatedAt: delta.createdAt
        };
        mind.lastUpdatedMessageId = delta.evidence.messageId;
        reduction.entriesSuperseded += 1;
      } else {
        reduction.invalidChangesRejected += 1;
      }
      continue;
    }
    if (!delta.text.trim() || delta.operation === "update" && targetIndex < 0) {
      reduction.invalidChangesRejected += 1;
      continue;
    }
    const next = itemFromDelta(delta);
    if (targetIndex >= 0) {
      mind.items[targetIndex] = {
        ...target,
        ...next,
        id: target.id,
        createdAt: target.createdAt,
        locked: target.locked,
        pinned: target.pinned,
        source: target.source
      };
      if (match?.kind === "relationship" && !mindTextsNearDuplicate(target.text, delta.text)) reduction.entriesSuperseded += 1;
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
function applyManualOverrides(minds, overrides) {
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
        const sameContext = item.source === "controller" && item.category === override.item.category && sameActorIds(item.targetActorIds, override.item.targetActorIds) && sameActorIds(item.concealedFromActorIds, override.item.concealedFromActorIds);
        const sameMeaning = sameContext && (mindTextsNearDuplicate(item.text, override.item.text) || item.category === "relationship" && item.targetActorIds.length > 0);
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
function rebuildTimeline(timeline, rawMessages) {
  const messages = sortMessages(rawMessages);
  const minds = {};
  for (const actor of Object.values(timeline.actors)) {
    actor.present = false;
    minds[actor.id] = cloneMind(timeline.baseMinds[actor.id] ?? makeBaseMind(actor.id));
  }
  const matchedRecords = [];
  let prefixHash = "root";
  let firstMissingIndex = messages.length;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const contentHash = messageContentHash(message);
    const swipeId = message.swipe_id ?? 0;
    const record = timeline.records.find(
      (candidate) => candidate.messageId === message.id && candidate.swipeId === swipeId && candidate.contentHash === contentHash && candidate.prefixHash === prefixHash && candidate.analysisVersion === ANALYSIS_SCHEMA_VERSION
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
  timeline.lastValidMessageIndex = firstMissingIndex === 0 ? -1 : messages[firstMissingIndex - 1]?.index_in_chat ?? firstMissingIndex - 1;
  if (!timeline.active) timeline.health = "inactive";
  else if (timeline.paused) timeline.health = "paused";
  else if (firstMissingIndex < messages.length) timeline.health = "stale";
  else timeline.health = "ready";
  return { messages, matchedRecords, firstMissingIndex, nextPrefix: prefixHash };
}
function evidenceFor(message, excerpt = "") {
  const clean = excerpt.trim() || message.content.trim().slice(0, 240);
  return {
    messageId: message.id,
    swipeId: message.swipe_id ?? 0,
    excerpt: clean,
    messageIndex: message.index_in_chat ?? 0
  };
}
function actorRefMap(timeline) {
  const map = /* @__PURE__ */ new Map();
  for (const actor of Object.values(timeline.actors)) {
    map.set(actor.id.toLocaleLowerCase(), actor.id);
    for (const name of actorNames(actor)) map.set(name, actor.id);
    if (actor.characterId) map.set(`character:${actor.characterId}`.toLocaleLowerCase(), actor.id);
    if (actor.personaId) map.set(`persona:${actor.personaId}`.toLocaleLowerCase(), actor.id);
  }
  return map;
}
function resolveKnownRef(timeline, refs, reference) {
  const key = reference.trim().toLocaleLowerCase();
  return refs.get(key) ?? resolveActorId(timeline.actors, reference);
}
function normalizeStatus(value) {
  return value === "resolved" || value === "abandoned" || value === "uncertain" ? value : "active";
}
function normalizeCategory(value) {
  return value === "belief" || value === "secret" || value === "goal" || value === "plan" || value === "emotion" || value === "relationship" || value === "awareness" ? value : null;
}
function materializeAnalysisRecords(timeline, batchMessages, startingPrefix, analysis, controller) {
  const messages = sortMessages(batchMessages);
  const byId = new Map(messages.map((message) => [message.id, message]));
  const refs = actorRefMap(timeline);
  const mentionsByMessage = /* @__PURE__ */ new Map();
  for (const raw of analysis.actorMentions ?? []) {
    const message = byId.get(raw.messageId);
    if (!message || !raw.name?.trim()) continue;
    const evidence = evidenceFor(message);
    const stableReference = raw.ref?.trim() || raw.name.trim();
    let id = refs.get(stableReference.toLocaleLowerCase()) ?? refs.get(raw.name.trim().toLocaleLowerCase());
    if (!id) {
      const actor2 = upsertActor(
        timeline,
        {
          kind: "npc",
          name: raw.name,
          aliases: raw.aliases ?? [],
          confidence: raw.confidence
        },
        evidence
      );
      id = actor2.id;
    }
    const actor = timeline.actors[id];
    actor.aliases = uniqueStrings([...actor.aliases, ...raw.aliases ?? []]);
    refs.set(stableReference.toLocaleLowerCase(), id);
    refs.set(raw.name.trim().toLocaleLowerCase(), id);
    for (const alias of raw.aliases ?? []) refs.set(alias.trim().toLocaleLowerCase(), id);
    const mention = {
      ref: id,
      name: actor.canonicalName,
      aliases: actor.aliases,
      kind: actor.kind,
      confidence: clamp(raw.confidence, 0, 1, 0.75),
      present: raw.present !== false,
      evidence
    };
    const list = mentionsByMessage.get(message.id) ?? [];
    list.push(mention);
    mentionsByMessage.set(message.id, list);
  }
  const changesByMessage = /* @__PURE__ */ new Map();
  for (const raw of analysis.changes ?? []) {
    const message = byId.get(raw.messageId);
    if (!message || !raw.subjectRef?.trim()) continue;
    const evidence = evidenceFor(message, raw.evidenceExcerpt);
    const subjectActorId = resolveKnownRef(timeline, refs, raw.subjectRef);
    if (!subjectActorId) continue;
    const operation2 = raw.operation === "update" || raw.operation === "resolve" || raw.operation === "abandon" || raw.operation === "remove" ? raw.operation : raw.operation === "add" ? "add" : null;
    const normalizedCategory = normalizeCategory(raw.category);
    const targetItemId = stringValue(raw.targetItemId) || null;
    const normalizedText = stringValue(raw.text);
    if (!operation2 || !normalizedCategory) continue;
    if ((operation2 === "add" || operation2 === "update") && !normalizedText) continue;
    if (operation2 !== "add" && !targetItemId) continue;
    const dimensions = {};
    for (const [key, value] of Object.entries(raw.dimensions ?? {})) {
      dimensions[key] = clamp(value, -1, 1, 0);
    }
    const delta = {
      id: `delta:${crypto.randomUUID()}`,
      subjectActorId,
      category: normalizedCategory,
      operation: operation2,
      targetItemId,
      text: normalizedText,
      status: normalizeStatus(raw.status),
      confidence: clamp(raw.confidence, 0, 1, 0.75),
      targetActorIds: uniqueStrings((raw.targetRefs ?? []).map((ref) => resolveKnownRef(timeline, refs, ref)).filter((id) => !!id)),
      concealedFromActorIds: uniqueStrings((raw.concealedFromRefs ?? []).map((ref) => resolveKnownRef(timeline, refs, ref)).filter((id) => !!id)),
      intensity: raw.intensity === null || raw.intensity === void 0 ? null : clamp(raw.intensity, 0, 1, 0.5),
      dimensions,
      evidence,
      createdAt: Date.now()
    };
    const list = changesByMessage.get(message.id) ?? [];
    list.push(delta);
    changesByMessage.set(message.id, list);
  }
  const records = [];
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
      createdAt: Date.now()
    });
    prefixHash = nextPrefixHash(prefixHash, contentHash, swipeId);
  }
  return records;
}
function materializeSkippedAnalysisRecords(timeline, batchMessages, startingPrefix, skipReason) {
  return materializeAnalysisRecords(
    timeline,
    batchMessages,
    startingPrefix,
    { actorMentions: [], changes: [] },
    { connectionId: null, provider: null, model: null }
  ).map((record) => ({ ...record, skipReason }));
}
function addManualItem(timeline, actorId, category2, text2) {
  const now = Date.now();
  const item = {
    id: `manual:${crypto.randomUUID()}`,
    category: category2,
    text: text2.trim(),
    status: "active",
    confidence: 1,
    targetActorIds: [],
    concealedFromActorIds: [],
    intensity: category2 === "emotion" ? 0.7 : null,
    dimensions: {},
    evidence: { messageId: "manual", swipeId: 0, excerpt: "User-authored", messageIndex: -1 },
    locked: true,
    pinned: true,
    source: "manual",
    createdAt: now,
    updatedAt: now
  };
  timeline.manualOverrides.push({ id: `override:${crypto.randomUUID()}`, actorId, operation: "upsert", item, targetItemId: null, createdAt: now });
}
function overrideItem(timeline, actorId, itemId, mutate) {
  const current = timeline.minds[actorId]?.items.find((item2) => item2.id === itemId);
  if (!current) return false;
  const item = mutate({ ...current, targetActorIds: [...current.targetActorIds], concealedFromActorIds: [...current.concealedFromActorIds], dimensions: { ...current.dimensions }, evidence: { ...current.evidence } });
  item.source = "manual";
  item.updatedAt = Date.now();
  timeline.manualOverrides.push({ id: `override:${crypto.randomUUID()}`, actorId, operation: "upsert", item, targetItemId: itemId, createdAt: Date.now() });
  return true;
}
function removeManualItem(timeline, actorId, itemId) {
  timeline.manualOverrides.push({ id: `override:${crypto.randomUUID()}`, actorId, operation: "remove", item: null, targetItemId: itemId, createdAt: Date.now() });
}
function mergeActors(timeline, sourceActorId, targetActorId) {
  const source = timeline.actors[sourceActorId];
  const target = timeline.actors[targetActorId];
  if (!source || !target || sourceActorId === targetActorId) return false;
  target.aliases = uniqueStrings([...target.aliases, source.canonicalName, ...source.aliases]);
  target.confidence = Math.max(target.confidence, source.confidence);
  target.confirmed = target.confirmed || source.confirmed;
  target.cortexEntityId ??= source.cortexEntityId;
  const remap = (id) => id === sourceActorId ? targetActorId : id;
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
function removeActor(timeline, actorId) {
  if (!timeline.actors[actorId]) return false;
  delete timeline.actors[actorId];
  delete timeline.baseMinds[actorId];
  delete timeline.minds[actorId];
  timeline.records = timeline.records.map((record) => ({
    ...record,
    actorMentions: record.actorMentions.filter((mention) => mention.ref !== actorId),
    deltas: record.deltas.filter((delta) => delta.subjectActorId !== actorId).map((delta) => ({
      ...delta,
      targetActorIds: delta.targetActorIds.filter((id) => id !== actorId),
      concealedFromActorIds: delta.concealedFromActorIds.filter((id) => id !== actorId)
    }))
  }));
  timeline.manualOverrides = timeline.manualOverrides.filter((override) => override.actorId !== actorId);
  return true;
}
function splitActor(timeline, actorId, name) {
  const source = timeline.actors[actorId];
  if (!source || !name.trim()) return null;
  const actor = createActor({ kind: "npc", name, confidence: 1, confirmed: true });
  timeline.actors[actor.id] = actor;
  timeline.baseMinds[actor.id] = makeBaseMind(actor.id);
  return actor;
}
function itemScore(item, relevantActorIds) {
  let score = CATEGORY_ORDER[item.category] * 10 + item.confidence * 10;
  if (item.locked) score += 30;
  if (item.pinned) score += 40;
  if (item.status !== "active" && item.status !== "uncertain") score -= 25;
  if (item.targetActorIds.some((id) => relevantActorIds.has(id))) score += 20;
  score += Math.min(15, (item.updatedAt || item.createdAt) / 1e12);
  return score;
}
function actorLabel(actors, id) {
  return actors[id]?.canonicalName ?? id;
}
function formatMind(mind, actors) {
  const actor = actors[mind.actorId];
  if (!actor) return "";
  const relevant = new Set(mind.presentActorIds);
  const items = [...mind.items].filter((item) => item.status === "active" || item.status === "uncertain").sort((left, right) => itemScore(right, relevant) - itemScore(left, relevant));
  const lines = [`${actor.canonicalName} (${actor.kind}${actor.present ? ", present" : ""})`];
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
function buildMindInjection(timeline, targetActorId, settings = DEFAULT_SETTINGS) {
  if (!timeline.active || timeline.paused) return null;
  const presentActors = Object.values(timeline.actors).filter((actor) => actor.present && timeline.minds[actor.id] && actorMindEnabled(actor, settings)).sort(
    (left, right) => Number(right.id === targetActorId) - Number(left.id === targetActorId) || Number(right.confirmed) - Number(left.confirmed) || right.updatedAt - left.updatedAt
  );
  const minds = presentActors.map((actor) => formatMind(timeline.minds[actor.id], timeline.actors)).filter(Boolean);
  const body = minds.join("\n\n");
  if (!body.trim()) return null;
  return [
    "[LumiMind \u2014 private subjective continuity]",
    "The following is private mental state, not objective truth. Preserve false beliefs and uncertainty.",
    "Use it to guide choices and subtext. Do not quote or summarize this block. Reveal secrets only through character-motivated behavior.",
    ...!settings.personaMindEnabled ? ["The user persona is unmanaged. Do not decide their thoughts, feelings, dialogue, or actions for them."] : [],
    "",
    body,
    "[/LumiMind]"
  ].join("\n");
}
function buildDirectorMindInjection(timeline, settings = DEFAULT_SETTINGS) {
  if (!timeline.active || timeline.paused) return null;
  const actors = Object.values(timeline.actors).filter((actor) => actor.present && actorMindEnabled(actor, settings) && timeline.minds[actor.id]).sort(
    (left, right) => Number(right.confirmed) - Number(left.confirmed) || right.updatedAt - left.updatedAt
  );
  if (!actors.length) return null;
  const body = actors.map((actor) => formatMind(timeline.minds[actor.id], timeline.actors)).filter(Boolean).join("\n\n");
  if (!body.trim()) return null;
  return [
    "[LumiMind \u2014 private ensemble continuity]",
    "The host character card is the scene's director, not an in-world actor. The following minds belong to the characters it portrays.",
    "Treat every belief as subjective rather than objective truth. Guide each portrayed character independently through choices and subtext.",
    "Do not quote or summarize this block. Reveal secrets only through character-motivated behavior, and do not narrate actions for an unmanaged user persona.",
    "",
    body,
    "[/LumiMind]"
  ].join("\n");
}
function publicStance(mind) {
  if (!mind) return "";
  const entries = mind.items.filter((item) => item.status === "active" && (item.category === "emotion" || item.category === "relationship")).sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt).slice(0, 2).map((item) => item.text);
  return entries.join("; ");
}
function makePublicSnapshot(timeline, settings = DEFAULT_SETTINGS) {
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
      publicStance: publicStance(timeline.minds[actor.id])
    }))
  };
}
function makePrivateSnapshot(timeline, settings = DEFAULT_SETTINGS) {
  const publicSnapshot = makePublicSnapshot(timeline, settings);
  const visibleIds = new Set(publicSnapshot.actors.map((actor) => actor.id));
  const minds = timeline ? Object.fromEntries(Object.entries(timeline.minds).filter(([actorId]) => visibleIds.has(actorId))) : {};
  return { ...publicSnapshot, minds };
}
function toTimelineView(timeline, settings = DEFAULT_SETTINGS) {
  const actors = Object.values(timeline.actors).filter((actor) => actorMindEnabled(actor, settings)).sort((left, right) => Number(right.present) - Number(left.present) || left.canonicalName.localeCompare(right.canonicalName));
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
    records: timeline.records.slice().filter((record) => !record.skipReason).sort((left, right) => left.messageIndex - right.messageIndex || left.createdAt - right.createdAt).map((record) => ({
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
        telemetry: record.controller.telemetry ?? null
      }
    })),
    lastValidMessageIndex: timeline.lastValidMessageIndex,
    lastAnalyzedAt: timeline.lastAnalyzedAt,
    updatedAt: timeline.updatedAt
  };
}
function compactStateForController(timeline, settings = DEFAULT_SETTINGS, _maxItemsPerActor) {
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
      ...managed ? {
        core: timeline.minds[actor.id]?.core ?? timeline.baseMinds[actor.id]?.core ?? EMPTY_CORE,
        items: (timeline.minds[actor.id]?.items ?? []).filter((item) => item.status === "active" || item.status === "uncertain").sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt).map((item) => ({
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
          source: item.source
        }))
      } : {}
    };
  });
}

// src/controller.ts
var THINK_BLOCK_RE = /<think[\s\S]*?<\/think>/gi;
function asObject2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function numberValue(value, fallback) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function booleanValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function stringArray(value) {
  return Array.isArray(value) ? uniqueStrings(value.filter((entry) => typeof entry === "string")) : [];
}
function sanitizeControllerText(value) {
  return value.replace(THINK_BLOCK_RE, "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}
function parseJsonValue(content) {
  const cleaned = sanitizeControllerText(content);
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}
function category(value) {
  return value === "belief" || value === "secret" || value === "goal" || value === "plan" || value === "emotion" || value === "relationship" || value === "awareness" ? value : null;
}
function operation(value) {
  return value === "add" || value === "update" || value === "resolve" || value === "abandon" || value === "remove" ? value : null;
}
function normalizedReference(value) {
  return value.trim().toLocaleLowerCase();
}
function sameReferences(left, right) {
  const normalizedLeft = uniqueStrings(left ?? []).map(normalizedReference).sort();
  const normalizedRight = uniqueStrings(right ?? []).map(normalizedReference).sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}
function duplicateControllerChange(left, right) {
  if (normalizedReference(left.subjectRef) !== normalizedReference(right.subjectRef) || left.category !== right.category) return false;
  if (left.targetItemId && right.targetItemId) return left.targetItemId === right.targetItemId;
  if (left.operation !== "add" || right.operation !== "add") return false;
  if (!sameReferences(left.targetRefs, right.targetRefs) || !sameReferences(left.concealedFromRefs, right.concealedFromRefs)) return false;
  const leftText = left.text ?? "";
  const rightText = right.text ?? "";
  const leftCanonical = canonicalMindText(leftText);
  const rightCanonical = canonicalMindText(rightText);
  return !!leftCanonical && leftCanonical === rightCanonical || mindTextsNearDuplicate(leftText, rightText);
}
function deduplicateControllerChanges(changes) {
  const result = [];
  for (const change of changes) {
    const existingIndex = result.findIndex((candidate) => duplicateControllerChange(candidate, change));
    if (existingIndex >= 0) result[existingIndex] = change;
    else result.push(change);
  }
  return result;
}
function normalizeControllerAnalysisResult(value) {
  const raw = asObject2(value);
  const actorMentions = Array.isArray(raw.actorMentions) ? raw.actorMentions.flatMap((entry) => {
    const item = asObject2(entry);
    const name = text(item.name);
    const messageId = text(item.messageId);
    if (!name || !messageId) return [];
    const kind = item.kind === "character" || item.kind === "persona" ? item.kind : "npc";
    return [{
      ref: text(item.ref) || name,
      name,
      aliases: stringArray(item.aliases),
      kind,
      confidence: Math.min(1, Math.max(0, numberValue(item.confidence, 0.75))),
      present: booleanValue(item.present, true),
      messageId
    }];
  }) : [];
  const changes = Array.isArray(raw.changes) ? raw.changes.flatMap((entry) => {
    const item = asObject2(entry);
    const subjectRef = text(item.subjectRef);
    const messageId = text(item.messageId);
    const normalizedCategory = category(item.category);
    const normalizedOperation = operation(item.operation);
    const normalizedText = text(item.text);
    const targetItemId = text(item.targetItemId) || null;
    if (!subjectRef || !messageId || !normalizedCategory || !normalizedOperation) return [];
    if ((normalizedOperation === "add" || normalizedOperation === "update") && !normalizedText) return [];
    if (normalizedOperation !== "add" && !targetItemId) return [];
    const dimensions = {};
    for (const [key, value2] of Object.entries(asObject2(item.dimensions))) {
      dimensions[key] = Math.min(1, Math.max(-1, numberValue(value2, 0)));
    }
    return [{
      subjectRef,
      category: normalizedCategory,
      operation: normalizedOperation,
      targetItemId,
      text: normalizedText,
      status: item.status === "resolved" || item.status === "abandoned" || item.status === "uncertain" ? item.status : "active",
      confidence: Math.min(1, Math.max(0, numberValue(item.confidence, 0.75))),
      targetRefs: stringArray(item.targetRefs),
      concealedFromRefs: stringArray(item.concealedFromRefs),
      intensity: item.intensity === null || item.intensity === void 0 ? null : Math.min(1, Math.max(0, numberValue(item.intensity, 0.5))),
      dimensions,
      messageId,
      evidenceExcerpt: text(item.evidenceExcerpt)
    }];
  }) : [];
  const deduplicatedChanges = deduplicateControllerChanges(changes);
  return {
    analysis: { actorMentions, changes: deduplicatedChanges },
    duplicatesSuppressed: changes.length - deduplicatedChanges.length,
    invalidChangesRejected: (Array.isArray(raw.changes) ? raw.changes.length : 0) - changes.length
  };
}
function policyReference(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}
function applyControllerMindPolicy(analysis, compactState, settings) {
  const excluded = /* @__PURE__ */ new Set();
  for (const entry of Array.isArray(compactState) ? compactState : []) {
    const actor = asObject2(entry);
    if (actor.managed !== false) continue;
    for (const value of [actor.ref, actor.name, ...Array.isArray(actor.aliases) ? actor.aliases : []]) {
      const key = policyReference(value);
      if (key) excluded.add(key);
    }
  }
  if (!settings.personaMindEnabled) {
    excluded.add("user");
    excluded.add("user persona");
    excluded.add("persona");
  }
  if (settings.characterCardDirectorMode) excluded.add("assistant");
  const remapCandidates = /* @__PURE__ */ new Map();
  const ambiguousRemaps = /* @__PURE__ */ new Set();
  const actorMentions = analysis.actorMentions.flatMap((mention) => {
    const keys = [mention.ref, mention.name, ...mention.aliases ?? []].map(policyReference).filter(Boolean);
    const blockedKind = !settings.personaMindEnabled && mention.kind === "persona";
    const safeName = [mention.name, ...mention.aliases ?? []].map((value) => value.trim()).find((value) => value && !excluded.has(policyReference(value)));
    const collidingKeys = keys.filter((key) => excluded.has(key));
    if (blockedKind || collidingKeys.length > 0 && !safeName) {
      for (const key of collidingKeys) ambiguousRemaps.add(key);
      for (const key of keys) excluded.add(key);
      return [];
    }
    let normalized = mention;
    if (collidingKeys.length > 0 && safeName) {
      const safeRef = excluded.has(policyReference(mention.ref)) ? safeName : mention.ref;
      normalized = {
        ...mention,
        ref: safeRef,
        name: safeName,
        aliases: (mention.aliases ?? []).filter((alias) => !excluded.has(policyReference(alias)))
      };
      for (const key of collidingKeys) {
        const candidates = remapCandidates.get(key) ?? /* @__PURE__ */ new Set();
        candidates.add(safeRef);
        remapCandidates.set(key, candidates);
      }
    }
    if (settings.characterCardDirectorMode && normalized.kind === "character") {
      return [{ ...normalized, kind: "npc" }];
    }
    return [normalized];
  });
  const remappedSubjects = /* @__PURE__ */ new Map();
  for (const [key, candidates] of remapCandidates) {
    if (!ambiguousRemaps.has(key) && candidates.size === 1) remappedSubjects.set(key, [...candidates][0]);
  }
  const changes = analysis.changes.flatMap((change) => {
    const key = policyReference(change.subjectRef);
    const remappedSubject = remappedSubjects.get(key);
    if (remappedSubject) return [{ ...change, subjectRef: remappedSubject }];
    return excluded.has(key) ? [] : [change];
  });
  return { actorMentions, changes };
}
function validateControllerAnalysisContext(analysis, messages, compactState) {
  const messageIds = new Set(messages.map((message) => message.id));
  const actorByReference = /* @__PURE__ */ new Map();
  for (const value of Array.isArray(compactState) ? compactState : []) {
    const actor = asObject2(value);
    const references = [actor.ref, actor.name, ...Array.isArray(actor.aliases) ? actor.aliases : []];
    for (const reference of references) {
      const key = policyReference(reference);
      if (key) actorByReference.set(key, actor);
    }
  }
  const actorMentions = analysis.actorMentions.filter((mention) => messageIds.has(mention.messageId));
  for (const mention of actorMentions) {
    const actor = { items: [] };
    for (const reference of [mention.ref, mention.name, ...mention.aliases ?? []]) {
      const key = policyReference(reference);
      if (key && !actorByReference.has(key)) actorByReference.set(key, actor);
    }
  }
  let invalidChangesRejected = 0;
  const changes = analysis.changes.flatMap((change) => {
    const actor = actorByReference.get(policyReference(change.subjectRef));
    if (!messageIds.has(change.messageId) || !actor) {
      invalidChangesRejected += 1;
      return [];
    }
    if (change.operation !== "add") {
      const targetItemId = change.targetItemId?.trim();
      const target = (Array.isArray(actor.items) ? actor.items : []).map(asObject2).find((item) => text(item.id) === targetItemId);
      const protectedTarget = target && (target.locked === true || target.pinned === true || text(target.source) !== "" && text(target.source) !== "controller");
      if (!targetItemId || !target || protectedTarget) {
        invalidChangesRejected += 1;
        return [];
      }
    }
    const knownReferences = (values) => (values ?? []).filter((reference) => actorByReference.has(policyReference(reference)));
    return [{
      ...change,
      targetRefs: knownReferences(change.targetRefs),
      concealedFromRefs: knownReferences(change.concealedFromRefs)
    }];
  });
  return { analysis: { actorMentions, changes }, invalidChangesRejected };
}
function isNontrivialAnalysisBatch(messages) {
  const lengths = messages.map((message) => message.content.replace(/\s+/g, " ").trim().length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return total >= 400 || lengths.some((length) => length >= 280) || messages.length >= 2 && total >= 240;
}
function makeControllerResponseTelemetry(raw, parsed, accepted, diagnostics = {}) {
  const object = asObject2(parsed);
  const rawChanges = Array.isArray(object.changes) ? object.changes.length : 0;
  const duplicatesSuppressed = diagnostics.duplicatesSuppressed ?? 0;
  return {
    responseChars: raw.length,
    responseHash: stableHash(raw),
    rawActorMentions: Array.isArray(object.actorMentions) ? object.actorMentions.length : 0,
    rawChanges,
    acceptedActorMentions: accepted.actorMentions.length,
    acceptedChanges: accepted.changes.length,
    duplicatesSuppressed,
    invalidChangesRejected: diagnostics.invalidChangesRejected ?? Math.max(0, rawChanges - accepted.changes.length - duplicatesSuppressed)
  };
}
function mergeControllerAnalyses(first, corrective) {
  const mentions = /* @__PURE__ */ new Map();
  for (const mention of [...first.actorMentions, ...corrective.actorMentions]) {
    const key = `${mention.messageId}|${mention.ref || mention.name}`.toLocaleLowerCase();
    mentions.set(key, mention);
  }
  return {
    actorMentions: [...mentions.values()],
    changes: corrective.changes.length ? corrective.changes : first.changes
  };
}
var ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    actorMentions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref: { type: "string" },
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          kind: { type: "string", enum: ["character", "persona", "npc"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          present: { type: "boolean" },
          messageId: { type: "string" }
        },
        required: ["ref", "name", "aliases", "kind", "confidence", "present", "messageId"]
      }
    },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          subjectRef: { type: "string" },
          category: { type: "string", enum: ["belief", "secret", "goal", "plan", "emotion", "relationship", "awareness"] },
          operation: { type: "string", enum: ["add", "update", "resolve", "abandon", "remove"] },
          targetItemId: { anyOf: [{ type: "string" }, { type: "null" }] },
          text: { type: "string" },
          status: { type: "string", enum: ["active", "resolved", "abandoned", "uncertain"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          targetRefs: { type: "array", items: { type: "string" } },
          concealedFromRefs: { type: "array", items: { type: "string" } },
          intensity: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
          dimensions: {
            type: "object",
            additionalProperties: { type: "number", minimum: -1, maximum: 1 }
          },
          messageId: { type: "string" },
          evidenceExcerpt: { type: "string" }
        },
        required: [
          "subjectRef",
          "category",
          "operation",
          "targetItemId",
          "text",
          "status",
          "confidence",
          "targetRefs",
          "concealedFromRefs",
          "intensity",
          "dimensions",
          "messageId",
          "evidenceExcerpt"
        ]
      }
    }
  },
  required: ["actorMentions", "changes"]
};
var SEED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    core: {
      type: "object",
      additionalProperties: false,
      properties: {
        selfConcept: { type: "string" },
        values: { type: "array", items: { type: "string" } },
        desires: { type: "array", items: { type: "string" } },
        fears: { type: "array", items: { type: "string" } },
        boundaries: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } }
      },
      required: ["selfConcept", "values", "desires", "fears", "boundaries", "notes"]
    },
    startingBeliefs: { type: "array", items: { type: "string" } },
    startingSecrets: { type: "array", items: { type: "string" } },
    startingGoals: { type: "array", items: { type: "string" } },
    relationshipPriors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { target: { type: "string" }, stance: { type: "string" } },
        required: ["target", "stance"]
      }
    },
    updatedAt: { type: "number" }
  },
  required: ["schemaVersion", "core", "startingBeliefs", "startingSecrets", "startingGoals", "relationshipPriors", "updatedAt"]
};
function structuredParameters(provider, schemaName, schema) {
  const normalized = provider?.trim().toLocaleLowerCase() ?? "";
  if (normalized === "google" || normalized === "gemini" || normalized === "google_vertex") {
    return { responseMimeType: "application/json", responseSchema: schema };
  }
  if (normalized === "openai" || normalized === "openrouter") {
    return { response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } } };
  }
  return {};
}
function noReasoningParameters(provider) {
  const normalized = provider?.trim().toLocaleLowerCase() ?? "";
  if (normalized === "google" || normalized === "gemini" || normalized === "google_vertex") {
    return { thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false } };
  }
  if (normalized === "nanogpt") return { reasoning_effort: "none" };
  return { reasoning: { effort: "none" } };
}
async function resolveConnection(settings, userId, fallbackConnectionId) {
  const id = settings.controllerConnectionId?.trim() || fallbackConnectionId?.trim() || null;
  if (!id) return { id: null, provider: null, model: null };
  const connection = await spindle.connections.get(id, userId).catch(() => null);
  return { id, provider: connection?.provider ?? null, model: connection?.model ?? null };
}
async function quietJson(prompt, systemPrompt, schemaName, schema, settings, userId, fallbackConnectionId) {
  const connection = await resolveConnection(settings, userId, fallbackConnectionId);
  const result = await spindle.generate.quiet({
    type: "quiet",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    parameters: {
      temperature: settings.controllerTemperature,
      max_tokens: settings.controllerMaxTokens,
      ...noReasoningParameters(connection.provider),
      ...structuredParameters(connection.provider, schemaName, schema)
    },
    ...connection.id ? { connection_id: connection.id } : {},
    userId
  });
  const object = asObject2(result);
  const content = sanitizeControllerText(text(object.content));
  const reasoning = sanitizeControllerText(text(object.reasoning));
  const raw = content || reasoning;
  return {
    parsed: parseJsonValue(raw),
    raw,
    meta: { connectionId: connection.id, provider: connection.provider, model: connection.model }
  };
}
function renderMessages(messages) {
  return messages.map((message) => {
    const name = message.name?.trim() || message.role;
    return `<message id="${message.id}" index="${message.index_in_chat ?? 0}" role="${message.role}" speaker="${name}">
${message.content}
</message>`;
  }).join("\n");
}
var ANALYSIS_SYSTEM_PROMPT = [
  "You are LumiMind's evidence-bound subjective-state analyst for an interactive roleplay transcript.",
  "Return JSON only. Analyze every supplied message and identify every named actor with narrative agency that the roleplay-mode instructions permit LumiMind to manage.",
  "Infer emotions, motives, goals, plans, relationships, and beliefs only when directly stated or strongly supported by subtext.",
  "Never invent objective events. Beliefs may be false or uncertain and must remain subjective.",
  "Treat a secret as information the subject knows and is deliberately concealing; concealedFromRefs names who it is hidden from.",
  "Treat mind_state as authoritative current state. Prefer updating an existing entry over adding another version of the same thought.",
  "Use existing item IDs in targetItemId when updating, resolving, abandoning, or removing state. Do not modify locked, pinned, manual, or seed entries.",
  "Add only genuinely novel state. Do not restate, paraphrase, or split information already represented by an unresolved entry.",
  "Maintain one current relationship stance per subject-target pair; update that entry when the stance changes.",
  "When an emotion, goal, plan, or awareness entry evolves, update or supersede the matching older entry instead of appending a new one.",
  "Bootstrap rule: when an actor has no active subjective-state entries, treat the supplied scene as initialization and add every clearly evidence-supported starting emotion, goal, awareness, relationship stance, plan, or belief.",
  "An entry is an add relative to mind_state even when the evidence describes a state already underway at the beginning of the transcript.",
  "A substantive scene with character choices, reactions, attention, dialogue, or strong subtext should not return an empty changes array merely because mind_state started empty.",
  "Include actorMentions for the actors actually present in the scene after each message, not merely referenced.",
  "Every actor mention and change must cite one supplied messageId and a short evidenceExcerpt."
].join("\n");
function analysisSystemPrompt(settings, corrective = false) {
  const mode = settings.characterCardDirectorMode ? "Director-card mode: host character-card entries marked managed=false are narrators/directors, not in-world actors. Never emit a mind or presence mention for those cards. Treat each named individual the card portrays as an independent NPC, even when several speak inside one assistant message." : "Actor-card mode: host character cards are in-world actors and may receive their own subjective minds.";
  const persona = settings.personaMindEnabled ? "Persona minds are enabled: the active user persona may receive evidence-supported subjective state and may be targeted during impersonation." : "Persona minds are disabled: the user persona is context only. Never emit actorMentions or changes with the user/persona as subject, and never infer actions, goals, emotions, or beliefs for them. Other managed actors may still hold beliefs or relationships about the user.";
  const correction = corrective ? [
    "This is a single corrective pass because the first pass accepted no mental-state changes from a substantive batch.",
    "Re-read analysis_batch actor by actor. Extract the smallest defensible bootstrap state supported by the text, especially viewpoint emotion, immediate goal, attention/awareness, relationship stance, and any clearly held belief.",
    "Do not manufacture facts or force every category. An empty changes array is valid only when the batch truly contains no evidence of any managed actor's subjective state."
  ].join("\n") : "";
  return [ANALYSIS_SYSTEM_PROMPT, mode, persona, correction].filter(Boolean).join("\n");
}
function buildAnalysisPrompt(input) {
  return [
    "Existing actor registry and current subjective state:",
    `<mind_state>
${JSON.stringify(input.compactState)}
</mind_state>`,
    "Recent transcript context (context only; do not emit changes for these messages):",
    `<recent_context>
${renderMessages(input.recentContext)}
</recent_context>`,
    "Messages to analyze:",
    `<analysis_batch>
${renderMessages(input.messages)}
</analysis_batch>`,
    'Return {"actorMentions": [...], "changes": [...]} now.'
  ].join("\n\n");
}
async function analyzeMessages(input) {
  const prompt = buildAnalysisPrompt(input);
  const result = await quietJson(
    prompt,
    analysisSystemPrompt(input.settings),
    "lumi_mind_analysis_v1",
    ANALYSIS_SCHEMA,
    input.settings,
    input.userId,
    input.fallbackConnectionId
  );
  if (!result.parsed) throw new Error("The LumiMind controller returned no parseable JSON.");
  const normalizedFirst = normalizeControllerAnalysisResult(result.parsed);
  const policyFirst = applyControllerMindPolicy(normalizedFirst.analysis, input.compactState, input.settings);
  const validatedFirst = validateControllerAnalysisContext(policyFirst, input.messages, input.compactState);
  const firstAnalysis = validatedFirst.analysis;
  const firstTelemetry = makeControllerResponseTelemetry(result.raw, result.parsed, normalizedFirst.analysis, {
    duplicatesSuppressed: normalizedFirst.duplicatesSuppressed,
    invalidChangesRejected: normalizedFirst.invalidChangesRejected + validatedFirst.invalidChangesRejected
  });
  const nontrivial = isNontrivialAnalysisBatch(input.messages);
  let finalAnalysis = firstAnalysis;
  let retryTelemetry = null;
  let retryError = null;
  let attempts = 1;
  if (nontrivial && firstAnalysis.changes.length === 0) {
    attempts = 2;
    try {
      const corrective = await quietJson(
        `${prompt}

The first pass produced zero accepted changes. Perform the corrective bootstrap extraction now.`,
        analysisSystemPrompt(input.settings, true),
        "lumi_mind_analysis_v1_corrective",
        ANALYSIS_SCHEMA,
        input.settings,
        input.userId,
        input.fallbackConnectionId
      );
      const normalizedCorrective = normalizeControllerAnalysisResult(corrective.parsed);
      const policyCorrective = applyControllerMindPolicy(normalizedCorrective.analysis, input.compactState, input.settings);
      const validatedCorrective = validateControllerAnalysisContext(policyCorrective, input.messages, input.compactState);
      const correctiveAnalysis = validatedCorrective.analysis;
      retryTelemetry = makeControllerResponseTelemetry(corrective.raw, corrective.parsed, normalizedCorrective.analysis, {
        duplicatesSuppressed: normalizedCorrective.duplicatesSuppressed,
        invalidChangesRejected: normalizedCorrective.invalidChangesRejected + validatedCorrective.invalidChangesRejected
      });
      if (!corrective.parsed) throw new Error("Corrective controller pass returned no parseable JSON.");
      finalAnalysis = mergeControllerAnalyses(firstAnalysis, correctiveAnalysis);
    } catch (error) {
      retryError = (error instanceof Error ? error.message : String(error)).slice(0, 240);
    }
  }
  const warningCodes = /* @__PURE__ */ new Set();
  const normalizationDropped = (telemetry) => !!telemetry && (telemetry.rawActorMentions > telemetry.acceptedActorMentions || telemetry.rawChanges - telemetry.acceptedChanges > telemetry.duplicatesSuppressed || telemetry.invalidChangesRejected > 0);
  if (normalizationDropped(firstTelemetry) || normalizationDropped(retryTelemetry)) warningCodes.add("normalization_drop");
  if (retryError) warningCodes.add("retry_failed");
  if (nontrivial && finalAnalysis.changes.length === 0) warningCodes.add("empty_nontrivial_batch");
  return {
    analysis: finalAnalysis,
    meta: result.meta,
    raw: result.raw,
    telemetry: {
      schemaVersion: 1,
      batchId: crypto.randomUUID(),
      messageCount: input.messages.length,
      inputChars: input.messages.reduce((sum, message) => sum + message.content.length, 0),
      nontrivial,
      attempts,
      retryReason: attempts === 2 ? "empty_nontrivial_batch" : null,
      first: firstTelemetry,
      retry: retryTelemetry,
      finalActorMentions: finalAnalysis.actorMentions.length,
      finalChanges: finalAnalysis.changes.length,
      warningCodes: [...warningCodes],
      retryError
    }
  };
}
var SEED_SYSTEM_PROMPT = [
  "You draft reusable LumiMind character-card seeds.",
  "Return JSON only. Extract enduring characterization from the card without inventing events, relationships, or secrets not supported by the card.",
  "The seed must be concise, portable across new chats, and written as private subjective state rather than visible roleplay prose."
].join("\n");
async function generateSeedDraft(input) {
  const prompt = [
    "Draft a reusable mind seed from this character card:",
    `<character_card>
${JSON.stringify(input.character)}
</character_card>`,
    "Use schemaVersion 1 and updatedAt equal to the current Unix time in milliseconds."
  ].join("\n\n").slice(0, 8e4);
  const result = await quietJson(prompt, SEED_SYSTEM_PROMPT, "lumi_mind_seed_v1", SEED_SCHEMA, input.settings, input.userId);
  const normalized = normalizeSeed(result.parsed);
  if (!normalized) throw new Error("The LumiMind controller returned an invalid mind seed.");
  return { ...makeEmptySeed(), ...normalized, schemaVersion: 1, updatedAt: Date.now() };
}

// src/storage.ts
var SETTINGS_PATH = "global/settings.json";
var TIMELINE_DIR = "timelines";
function timelinePath(chatId) {
  return `${TIMELINE_DIR}/${encodeURIComponent(chatId)}.json`;
}
async function loadSettings(userId) {
  const stored = await spindle.userStorage.getJson(SETTINGS_PATH, { fallback: DEFAULT_SETTINGS, userId });
  return normalizeSettings(stored);
}
async function saveSettings(userId, patch) {
  const current = await loadSettings(userId);
  const next = normalizeSettings({ ...current, ...patch });
  await spindle.userStorage.setJson(SETTINGS_PATH, next, { indent: 2, userId });
  return next;
}
async function loadTimeline(chatId, userId) {
  const stored = await spindle.userStorage.getJson(timelinePath(chatId), { fallback: null, userId });
  return normalizeTimeline(stored, chatId);
}
async function saveTimeline(timeline, userId) {
  timeline.updatedAt = Date.now();
  await spindle.userStorage.setJson(timelinePath(timeline.chatId), timeline, { indent: 2, userId });
}
async function deleteTimeline(chatId, userId) {
  await spindle.userStorage.delete(timelinePath(chatId), userId).catch(() => void 0);
}

// src/lumi-state.ts
var LUMI_STATE_PROTOCOL = "lumi_state.v1";
var LUMI_STATE_SCHEMA_VERSION = 1;
var LUMI_MIND_STATE_ENDPOINT = "lumi_mind.state.current";
function makeMindLumiStateSnapshot(timeline, settings, extensionVersion, generatedAt = Date.now()) {
  const publicSnapshot = makePublicSnapshot(timeline, settings);
  const cast = timeline ? publicSnapshot.actors.map((actor) => {
    const record = timeline.actors[actor.id];
    const links = [];
    if (record?.characterId) links.push({ namespace: "host.character", id: record.characterId, kind: "character" });
    if (record?.personaId) links.push({ namespace: "host.persona", id: record.personaId, kind: "persona" });
    return {
      id: actor.id,
      actor: { namespace: "lumi_mind.actor", id: actor.id, kind: actor.kind },
      links,
      name: actor.name,
      aliases: [...actor.aliases],
      present: actor.present,
      confirmed: actor.confirmed,
      publicStance: actor.publicStance,
      provenance: {
        extensionId: "lumi_mind",
        method: "derived",
        observedAt: record?.updatedAt ?? timeline.updatedAt,
        confidence: record?.confidence ?? 0
      }
    };
  }) : [];
  return {
    protocol: LUMI_STATE_PROTOCOL,
    schemaVersion: LUMI_STATE_SCHEMA_VERSION,
    source: {
      extensionId: "lumi_mind",
      extensionVersion,
      endpoint: LUMI_MIND_STATE_ENDPOINT
    },
    chatId: timeline?.chatId ?? null,
    revision: timeline?.revision ?? 0,
    freshness: !timeline ? "unavailable" : publicSnapshot.stale ? "stale" : "fresh",
    generatedAt,
    updatedAt: timeline?.updatedAt ?? null,
    visibility: "public",
    state: { locations: [], times: [], cast, objects: [], conditions: [], threads: [] }
  };
}

// src/backend.ts
var INTERCEPTOR_PRIORITY = 125;
var ANALYSIS_BATCH_SIZE = 6;
var MAX_RECORDS = 5e3;
var RECONCILE_DEBOUNCE_MS = 650;
var EXTENSION_VERSION = "0.1.1";
var timelines = /* @__PURE__ */ new Map();
var settingsCache = /* @__PURE__ */ new Map();
var activeChats = /* @__PURE__ */ new Map();
var chatUsers = /* @__PURE__ */ new Map();
var operations = /* @__PURE__ */ new Map();
var reconcileTimers = /* @__PURE__ */ new Map();
var generationContexts = /* @__PURE__ */ new Map();
var latestGenerationByChat = /* @__PURE__ */ new Map();
var connectionByChat = /* @__PURE__ */ new Map();
var lastFrontendUserId = null;
function cacheKey(userId, chatId) {
  return `${userId}:${chatId}`;
}
function asObject3(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function readString(value, keys) {
  const raw = asObject3(value);
  for (const key of keys) {
    const candidate = raw[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}
function extractChatId(value) {
  return readString(value, ["chatId", "chat_id"]);
}
function extractCharacterId(value) {
  return readString(value, ["characterId", "character_id", "targetCharacterId", "target_character_id"]);
}
function extractPersonaId(value) {
  return readString(value, ["personaId", "persona_id"]);
}
function extractGenerationType(value) {
  return readString(value, ["generationType", "generation_type"]) ?? "normal";
}
function rememberChatUser(chatId, userId) {
  if (chatId && userId) chatUsers.set(chatId, userId);
}
function resolveUserId(chatId, eventUserId) {
  return eventUserId || (chatId ? chatUsers.get(chatId) : null) || lastFrontendUserId;
}
function storageTimelineKey(userId, chatId) {
  return cacheKey(userId, chatId);
}
async function getSettings(userId) {
  const cached = settingsCache.get(userId);
  if (cached) return cached;
  const loaded = await loadSettings(userId);
  settingsCache.set(userId, loaded);
  return loaded;
}
async function getTimeline(chatId, userId) {
  const key = storageTimelineKey(userId, chatId);
  const cached = timelines.get(key);
  if (cached) return cached;
  const loaded = await loadTimeline(chatId, userId);
  timelines.set(key, loaded);
  return loaded;
}
function send(message, userId) {
  spindle.sendToFrontend(message, userId);
}
function notice(userId, tone, message) {
  send({ type: "notice", tone, message }, userId);
}
function hasPermission(id) {
  try {
    return spindle.permissions.has(id);
  } catch {
    return false;
  }
}
function currentPermissions() {
  return {
    generation: hasPermission("generation"),
    interceptor: hasPermission("interceptor"),
    chats: hasPermission("chats"),
    chatMutation: hasPermission("chat_mutation"),
    characters: hasPermission("characters"),
    personas: hasPermission("personas"),
    memories: hasPermission("memories")
  };
}
async function listConnections(userId) {
  if (!hasPermission("generation")) return [];
  const connections = await spindle.connections.list(userId).catch(() => []);
  return connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    model: connection.model,
    isDefault: connection.is_default,
    hasApiKey: connection.has_api_key
  }));
}
async function buildFrontendState(userId, requestedChatId, characterId) {
  const active = activeChats.get(userId) ?? { chatId: null, characterId: null };
  const chatId = requestedChatId === void 0 ? active.chatId : requestedChatId;
  if (requestedChatId !== void 0 || characterId !== void 0) {
    activeChats.set(userId, { chatId: chatId ?? null, characterId: characterId ?? active.characterId });
  }
  const [settings, connections, timeline] = await Promise.all([
    getSettings(userId),
    listConnections(userId),
    chatId ? getTimeline(chatId, userId) : Promise.resolve(null)
  ]);
  return {
    settings,
    permissions: currentPermissions(),
    connections,
    activeChatId: chatId ?? null,
    activeCharacterId: characterId ?? active.characterId,
    timeline: timeline ? toTimelineView(timeline, settings) : null
  };
}
async function sendState(userId, chatId, characterId) {
  send({ type: "state", state: await buildFrontendState(userId, chatId, characterId) }, userId);
}
function normalizeChatMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const raw = asObject3(entry);
    const id = readString(raw, ["id"]);
    const content = typeof raw.content === "string" ? raw.content : "";
    if (!id) return [];
    const role = raw.role === "user" || raw.role === "assistant" || raw.role === "system" ? raw.role : raw.is_user === true ? "user" : "assistant";
    return [{
      id,
      role,
      content,
      name: typeof raw.name === "string" ? raw.name : void 0,
      extra: asObject3(raw.extra),
      metadata: asObject3(raw.metadata),
      swipe_id: typeof raw.swipe_id === "number" ? raw.swipe_id : 0,
      swipes: Array.isArray(raw.swipes) ? raw.swipes.filter((item) => typeof item === "string") : [content],
      index_in_chat: typeof raw.index_in_chat === "number" ? raw.index_in_chat : index,
      created_at: typeof raw.created_at === "number" ? raw.created_at : void 0
    }];
  });
}
async function getChatMessages(chatId, userId) {
  const api = spindle.chat;
  return sortMessages(normalizeChatMessages(await api.getMessages(chatId, userId)));
}
function seedFromCharacter(character) {
  const extension = asObject3(character.extensions?.[EXTENSION_KEY]);
  const seedContainer = asObject3(extension.seed);
  const stored = normalizeSeed(seedContainer.v1 ?? extension.seed);
  if (stored) return stored;
  const seed = makeEmptySeed({
    selfConcept: character.description.trim(),
    notes: uniqueStrings([character.personality, character.creator_notes].filter(Boolean))
  });
  seed.startingBeliefs = [];
  seed.startingGoals = [];
  return seed;
}
function seedFromPersona(persona) {
  return makeEmptySeed({
    selfConcept: persona.description.trim(),
    notes: uniqueStrings([persona.title].filter(Boolean))
  });
}
async function initializeHostActors(timeline, userId) {
  const permissions = currentPermissions();
  const chat = permissions.chats ? await spindle.chats.get(timeline.chatId, userId).catch(() => null) : null;
  if (chat && permissions.characters) {
    const metadata = asObject3(chat.metadata);
    const groupIds = Array.isArray(metadata.character_ids) ? metadata.character_ids.filter((id) => typeof id === "string") : [];
    const characterIds = uniqueStrings(groupIds.length ? groupIds : [chat.character_id].filter(Boolean));
    for (const characterId of characterIds) {
      const character = await spindle.characters.get(characterId, userId).catch(() => null);
      if (!character) continue;
      const actor = upsertActor(timeline, {
        id: `character:${character.id}`,
        kind: "character",
        name: character.name,
        characterId: character.id,
        confidence: 1,
        confirmed: true
      });
      timeline.baseMinds[actor.id] = makeBaseMind(actor.id, seedFromCharacter(character));
    }
  }
  if (permissions.personas) {
    const persona = await spindle.personas.getActive(userId).catch(() => null);
    if (persona) {
      const actor = upsertActor(timeline, {
        id: `persona:${persona.id}`,
        kind: "persona",
        name: persona.name,
        personaId: persona.id,
        confidence: 1,
        confirmed: true
      });
      timeline.baseMinds[actor.id] = makeBaseMind(actor.id, seedFromPersona(persona));
    }
  }
  const settings = await getSettings(userId);
  if (settings.cortexImportEnabled && permissions.memories) {
    const entities = await spindle.memories.entities.list(timeline.chatId, { activeOnly: false, limit: 250, userId }).catch(() => []);
    for (const entity of entities) {
      if (entity.entityType !== "character") continue;
      upsertActor(timeline, {
        kind: "npc",
        name: entity.name,
        aliases: entity.aliases,
        cortexEntityId: entity.id,
        confidence: entity.confidence === "confirmed" ? 1 : 0.65,
        confirmed: entity.confidence === "confirmed"
      });
    }
  }
  rebuildTimeline(timeline, []);
}
async function ensurePersonaActor(timeline, personaId, userId) {
  const existing = timeline.actors[`persona:${personaId}`];
  if (existing) return existing;
  const persona = hasPermission("personas") ? await spindle.personas.get(personaId, userId).catch(() => null) : null;
  const actor = upsertActor(timeline, {
    id: `persona:${personaId}`,
    kind: "persona",
    name: persona?.name ?? "User persona",
    personaId,
    confidence: 1,
    confirmed: true
  });
  timeline.baseMinds[actor.id] = makeBaseMind(actor.id, persona ? seedFromPersona(persona) : null);
  return actor;
}
function enqueue(userId, chatId, task) {
  const key = cacheKey(userId, chatId);
  const previous = operations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => void 0).then(task);
  operations.set(key, next);
  void next.finally(() => {
    if (operations.get(key) === next) operations.delete(key);
  });
  return next;
}
async function persistAndPublish(timeline, userId, announce = true) {
  timeline.revision += 1;
  timeline.updatedAt = Date.now();
  await saveTimeline(timeline, userId);
  await publishScene(userId, timeline);
  if (announce && activeChats.get(userId)?.chatId === timeline.chatId) await sendState(userId, timeline.chatId);
}
async function reconcileChat(userId, chatId, force = false) {
  const timeline = await getTimeline(chatId, userId);
  const settings = await getSettings(userId);
  const policyHash = analysisPolicyHash(settings);
  const policyChanged = timeline.analysisPolicyHash !== policyHash;
  if (!timeline.active || timeline.paused) {
    const messages2 = hasPermission("chat_mutation") ? await getChatMessages(chatId, userId).catch(() => []) : [];
    rebuildTimeline(timeline, messages2);
    await persistAndPublish(timeline, userId);
    return;
  }
  if (!hasPermission("generation") || !hasPermission("chat_mutation")) {
    timeline.health = "error";
    timeline.error = "LumiMind requires generation and chat history permissions to analyze this chat.";
    await persistAndPublish(timeline, userId);
    return;
  }
  if (policyChanged) {
    timeline.records = [];
    timeline.analysisPolicyHash = policyHash;
    timeline.lastAnalyzedAt = null;
    timeline.error = null;
  }
  if (force) timeline.records = [];
  const messages = await getChatMessages(chatId, userId);
  let derivation = rebuildTimeline(timeline, messages);
  if (derivation.firstMissingIndex >= derivation.messages.length) {
    timeline.health = "ready";
    timeline.error = null;
    await persistAndPublish(timeline, userId);
    return;
  }
  const commitSkippedWork = (batch) => {
    if (!batch.skipReason || batch.messages.length === 0) return false;
    timeline.records.push(...materializeSkippedAnalysisRecords(
      timeline,
      batch.messages,
      derivation.nextPrefix,
      batch.skipReason
    ));
    if (timeline.records.length > MAX_RECORDS) timeline.records.splice(0, timeline.records.length - MAX_RECORDS);
    derivation = rebuildTimeline(timeline, messages);
    return true;
  };
  while (derivation.firstMissingIndex < derivation.messages.length) {
    const batch = selectAnalysisWorkBatch(
      derivation.messages,
      derivation.firstMissingIndex,
      ANALYSIS_BATCH_SIZE,
      settings
    );
    if (!commitSkippedWork(batch)) break;
  }
  if (derivation.firstMissingIndex >= derivation.messages.length) {
    timeline.health = "ready";
    timeline.error = null;
    await persistAndPublish(timeline, userId);
    return;
  }
  timeline.health = timeline.records.length ? "pending" : "initializing";
  timeline.error = null;
  await persistAndPublish(timeline, userId);
  try {
    while (derivation.firstMissingIndex < derivation.messages.length) {
      const start = derivation.firstMissingIndex;
      const work = selectAnalysisWorkBatch(derivation.messages, start, ANALYSIS_BATCH_SIZE, settings);
      if (commitSkippedWork(work)) {
        timeline.health = derivation.firstMissingIndex < derivation.messages.length ? "pending" : "ready";
        timeline.error = null;
        await persistAndPublish(timeline, userId);
        continue;
      }
      const batch = work.messages;
      const recentContext = selectAnalysisRecentContext(
        derivation.messages,
        start,
        settings.analysisContextMessageLimit
      );
      const result = await analyzeMessages({
        messages: batch,
        recentContext,
        compactState: compactStateForController(timeline, settings),
        settings,
        userId,
        fallbackConnectionId: connectionByChat.get(cacheKey(userId, chatId)) ?? null
      });
      const records = materializeAnalysisRecords(
        timeline,
        batch,
        derivation.nextPrefix,
        result.analysis,
        { ...result.meta, telemetry: result.telemetry }
      );
      timeline.records.push(...records);
      if (result.telemetry.warningCodes.length) {
        spindle.log.warn(
          `LumiMind analysis quality warning for ${chatId} batch ${result.telemetry.batchId}: ${result.telemetry.warningCodes.join(", ")} (attempts=${result.telemetry.attempts}, acceptedMentions=${result.telemetry.finalActorMentions}, acceptedChanges=${result.telemetry.finalChanges}).`
        );
      }
      if (timeline.records.length > MAX_RECORDS) timeline.records.splice(0, timeline.records.length - MAX_RECORDS);
      timeline.lastAnalyzedAt = Date.now();
      derivation = rebuildTimeline(timeline, messages);
      timeline.health = derivation.firstMissingIndex < derivation.messages.length ? "pending" : "ready";
      timeline.error = null;
      await persistAndPublish(timeline, userId);
    }
  } catch (error) {
    timeline.health = "error";
    timeline.error = error instanceof Error ? error.message : String(error);
    await persistAndPublish(timeline, userId);
    spindle.log.warn(`LumiMind analysis failed for ${chatId}: ${timeline.error}`);
  }
}
function scheduleReconcile(userId, chatId, delay = RECONCILE_DEBOUNCE_MS) {
  const key = cacheKey(userId, chatId);
  const existing = reconcileTimers.get(key);
  if (existing) clearTimeout(existing);
  reconcileTimers.set(key, setTimeout(() => {
    reconcileTimers.delete(key);
    void enqueue(userId, chatId, () => reconcileChat(userId, chatId));
  }, delay));
}
async function activateChat(userId, chatId) {
  const timeline = await getTimeline(chatId, userId);
  timeline.active = true;
  timeline.paused = false;
  timeline.health = "initializing";
  timeline.error = null;
  await initializeHostActors(timeline, userId);
  await persistAndPublish(timeline, userId);
  notice(userId, "info", "LumiMind is building this timeline in the background.");
  await reconcileChat(userId, chatId);
}
async function writeActorToCortex(userId, timeline, actor) {
  const settings = await getSettings(userId);
  if (!settings.cortexWritebackEnabled) throw new Error("Enable Cortex writeback in LumiMind settings first.");
  if (!hasPermission("memories")) throw new Error("Memory Cortex permission is not granted.");
  if (!actor.confirmed) throw new Error("Confirm this actor before writing it to Memory Cortex.");
  const entity = await spindle.memories.entities.upsert(
    timeline.chatId,
    { name: actor.canonicalName, type: "character", aliases: actor.aliases, confidence: 1, provisional: false },
    { userId }
  );
  actor.cortexEntityId = entity.id;
  actor.updatedAt = Date.now();
}
async function publishScene(userId, timeline) {
  const activeChatId = activeChats.get(userId)?.chatId ?? null;
  const resolved = timeline?.chatId === activeChatId ? timeline : activeChatId ? await getTimeline(activeChatId, userId).catch(() => null) : null;
  const settings = await getSettings(userId);
  spindle.rpcPool.sync("scene.current", makePublicSnapshot(resolved, settings), { requires: [] });
  spindle.rpcPool.sync("state.current", makeMindLumiStateSnapshot(resolved, settings, EXTENSION_VERSION), { requires: [] });
  if (settings.privateInteropEnabled) {
    spindle.rpcPool.sync("scene.private", makePrivateSnapshot(resolved, settings), { requires: ["chat_mutation"] });
  } else {
    try {
      spindle.rpcPool.unregister("scene.private");
    } catch {
    }
  }
}
function bumpAndRebuild(timeline) {
  timeline.error = null;
  const messages = [];
  if (!timeline.records.length) rebuildTimeline(timeline, messages);
}
async function mutateTimeline(userId, chatId, mutate) {
  await enqueue(userId, chatId, async () => {
    const timeline = await getTimeline(chatId, userId);
    await mutate(timeline);
    const messages = hasPermission("chat_mutation") ? await getChatMessages(chatId, userId).catch(() => []) : [];
    rebuildTimeline(timeline, messages);
    await persistAndPublish(timeline, userId);
  });
}
async function cloneFork(payload, eventUserId) {
  const sourceChatId = readString(payload, ["sourceChatId"]);
  const forkedChatId = readString(payload, ["forkedChatId"]);
  const userId = resolveUserId(sourceChatId, eventUserId);
  if (!sourceChatId || !forkedChatId || !userId) return;
  rememberChatUser(forkedChatId, userId);
  await enqueue(userId, forkedChatId, async () => {
    const source = await getTimeline(sourceChatId, userId);
    if (!source.active) return;
    const [sourceMessages, forkMessages] = await Promise.all([
      getChatMessages(sourceChatId, userId),
      getChatMessages(forkedChatId, userId)
    ]);
    const sourceIndexById = new Map(sourceMessages.map((message) => [message.id, message.index_in_chat ?? 0]));
    const forkByIndex = new Map(forkMessages.map((message) => [message.index_in_chat ?? 0, message]));
    const serialized = JSON.parse(JSON.stringify(source));
    serialized.chatId = forkedChatId;
    serialized.records = serialized.records.flatMap((record) => {
      const index = sourceIndexById.get(record.messageId) ?? record.messageIndex;
      const target = forkByIndex.get(index);
      if (!target) return [];
      const next = JSON.parse(JSON.stringify(record));
      next.id = `analysis:${crypto.randomUUID()}`;
      next.messageId = target.id;
      next.messageIndex = target.index_in_chat ?? index;
      next.actorMentions = next.actorMentions.map((mention) => ({ ...mention, evidence: { ...mention.evidence, messageId: target.id, messageIndex: target.index_in_chat ?? index } }));
      next.deltas = next.deltas.map((delta) => ({ ...delta, evidence: { ...delta.evidence, messageId: target.id, messageIndex: target.index_in_chat ?? index } }));
      return [next];
    });
    serialized.revision = 0;
    serialized.updatedAt = Date.now();
    serialized.health = serialized.paused ? "paused" : "ready";
    serialized.error = null;
    rebuildTimeline(serialized, forkMessages);
    timelines.set(storageTimelineKey(userId, forkedChatId), serialized);
    await persistAndPublish(serialized, userId, false);
    spindle.log.info(`LumiMind inherited ${serialized.records.length} analysis records into fork ${forkedChatId}.`);
  });
}
spindle.rpcPool.sync("contract.v1", {
  schemaVersion: 1,
  protocol: "lumi_state.v1",
  extension: "lumi_mind",
  extensionVersion: EXTENSION_VERSION,
  capabilities: ["subjective_minds", "timeline_swipes", "chat_forks", "scene_presence", "spoiler_safe"],
  endpoints: {
    public: "lumi_mind.scene.current",
    private: "lumi_mind.scene.private",
    state: "lumi_mind.state.current"
  },
  channels: [{
    endpoint: "lumi_mind.state.current",
    schema: "lumi_state.snapshot.v1",
    visibility: "public",
    requires: [],
    mode: "sync"
  }]
}, { requires: [] });
spindle.rpcPool.sync("state.current", makeMindLumiStateSnapshot(null, DEFAULT_SETTINGS, EXTENSION_VERSION), { requires: [] });
spindle.registerInterceptor(async (messages, context) => {
  try {
    const chatId = extractChatId(context);
    const userId = resolveUserId(chatId);
    if (!chatId || !userId) return messages;
    rememberChatUser(chatId, userId);
    const connectionId = readString(context, ["connectionId", "connection_id"]);
    if (connectionId) connectionByChat.set(cacheKey(userId, chatId), connectionId);
    const timeline = await getTimeline(chatId, userId);
    if (!timeline.active || timeline.paused) return messages;
    const settings = await getSettings(userId);
    const promptMessages = limitChatHistoryMessages(messages, settings.chatHistoryMessageLimit);
    let targetActorId = null;
    let injection = null;
    const generationType = extractGenerationType(context);
    if (generationType === "impersonate") {
      if (!settings.personaMindEnabled) return promptMessages;
      const personaId = extractPersonaId(context);
      if (personaId) targetActorId = (await ensurePersonaActor(timeline, personaId, userId)).id;
      if (targetActorId && timeline.actors[targetActorId]) {
        injection = buildMindInjection(timeline, targetActorId, settings);
      }
    } else if (settings.characterCardDirectorMode) {
      injection = buildDirectorMindInjection(timeline, settings);
    } else {
      const latest = latestGenerationByChat.get(cacheKey(userId, chatId));
      const characterId = latest?.characterId ?? extractCharacterId(context);
      if (characterId) targetActorId = `character:${characterId}`;
      if (!targetActorId || !timeline.actors[targetActorId]) {
        const chat = hasPermission("chats") ? await spindle.chats.get(chatId, userId).catch(() => null) : null;
        if (chat?.character_id) targetActorId = `character:${chat.character_id}`;
      }
      injection = buildMindInjection(timeline, targetActorId, settings);
    }
    if (!injection) return promptMessages;
    const injected = { role: "system", content: injection };
    return {
      messages: [injected, ...promptMessages],
      breakdown: [{ messageIndex: 0, name: "LumiMind \u2014 Private Mind" }]
    };
  } catch (error) {
    spindle.log.warn(`LumiMind interceptor degraded safely: ${error instanceof Error ? error.message : String(error)}`);
    return messages;
  }
}, INTERCEPTOR_PRIORITY);
var onEvent = spindle.on;
onEvent("GENERATION_STARTED", (payload, eventUserId) => {
  const chatId = extractChatId(payload);
  const userId = resolveUserId(chatId, eventUserId);
  const generationId = readString(payload, ["generationId", "generation_id"]);
  if (!chatId || !userId || !generationId) return;
  rememberChatUser(chatId, userId);
  const context = {
    generationId,
    chatId,
    characterId: extractCharacterId(payload),
    characterName: readString(payload, ["characterName", "character_name"]),
    generationType: extractGenerationType(payload),
    userId
  };
  generationContexts.set(generationId, context);
  latestGenerationByChat.set(cacheKey(userId, chatId), context);
});
onEvent("GENERATION_ENDED", (payload, eventUserId) => {
  const generationId = readString(payload, ["generationId", "generation_id"]);
  const remembered = generationId ? generationContexts.get(generationId) : null;
  const chatId = extractChatId(payload) ?? remembered?.chatId ?? null;
  const userId = resolveUserId(chatId, eventUserId ?? remembered?.userId);
  if (generationId) generationContexts.delete(generationId);
  if (!chatId || !userId) return;
  if (latestGenerationByChat.get(cacheKey(userId, chatId))?.generationId === generationId) {
    latestGenerationByChat.delete(cacheKey(userId, chatId));
  }
  const error = readString(payload, ["error"]);
  const messageId = readString(payload, ["messageId", "message_id"]);
  if (!error && messageId) scheduleReconcile(userId, chatId, 100);
});
for (const event of ["MESSAGE_SENT", "MESSAGE_EDITED", "MESSAGE_DELETED", "MESSAGE_SWIPED", "SWIPE_EDITED"]) {
  onEvent(event, (payload, eventUserId) => {
    const chatId = extractChatId(payload) ?? extractChatId(asObject3(payload).message);
    const userId = resolveUserId(chatId, eventUserId);
    if (!chatId || !userId) return;
    rememberChatUser(chatId, userId);
    scheduleReconcile(userId, chatId);
  });
}
onEvent("CHAT_FORKED", (payload, eventUserId) => {
  void cloneFork(payload, eventUserId);
});
onEvent("CHAT_DELETED", (payload, eventUserId) => {
  const chatId = extractChatId(payload) ?? readString(payload, ["id"]);
  const userId = resolveUserId(chatId, eventUserId);
  if (!chatId || !userId) return;
  timelines.delete(storageTimelineKey(userId, chatId));
  void deleteTimeline(chatId, userId);
});
spindle.permissions.onChanged(() => {
  if (!lastFrontendUserId) return;
  void sendState(lastFrontendUserId);
});
spindle.onFrontendMessage(async (payload, userId) => {
  lastFrontendUserId = userId;
  const message = payload;
  const chatId = "chatId" in message ? message.chatId ?? null : null;
  const characterId = "characterId" in message ? message.characterId ?? null : null;
  if (chatId) rememberChatUser(chatId, userId);
  if (message.type === "ready" || message.type === "refresh") {
    activeChats.set(userId, { chatId, characterId });
    const timeline = chatId ? await getTimeline(chatId, userId) : null;
    await publishScene(userId, timeline);
    await sendState(userId, chatId, characterId);
    if (timeline?.active && timeline.analysisPolicyHash !== analysisPolicyHash(await getSettings(userId))) {
      scheduleReconcile(userId, timeline.chatId, 0);
    }
    return;
  }
  try {
    if (message.type === "activate") {
      await enqueue(userId, message.chatId, () => activateChat(userId, message.chatId));
      return;
    }
    if (message.type === "pause") {
      await mutateTimeline(userId, message.chatId, (timeline) => {
        timeline.paused = message.paused;
        timeline.health = message.paused ? "paused" : "pending";
      });
      if (!message.paused) scheduleReconcile(userId, message.chatId, 0);
      return;
    }
    if (message.type === "rebuild") {
      await enqueue(userId, message.chatId, () => reconcileChat(userId, message.chatId, true));
      return;
    }
    if (message.type === "retry") {
      await enqueue(userId, message.chatId, () => reconcileChat(userId, message.chatId));
      return;
    }
    if (message.type === "save_settings") {
      const previous = await getSettings(userId);
      const next = await saveSettings(userId, message.patch);
      settingsCache.set(userId, next);
      const roleplayModeChanged = previous.personaMindEnabled !== next.personaMindEnabled || previous.characterCardDirectorMode !== next.characterCardDirectorMode;
      await publishScene(userId);
      await sendState(userId, message.chatId);
      if (roleplayModeChanged && message.chatId) {
        const timeline = await getTimeline(message.chatId, userId);
        if (timeline.active) scheduleReconcile(userId, message.chatId, 0);
      }
      notice(userId, "success", roleplayModeChanged ? "LumiMind settings saved. Activated timelines will rebuild for the new roleplay mode when opened." : "LumiMind settings saved.");
      return;
    }
    if (message.type === "generate_seed") {
      if (!hasPermission("characters") || !hasPermission("generation")) throw new Error("Character and generation permissions are required to draft a seed.");
      const character = await spindle.characters.get(message.characterId, userId);
      if (!character) throw new Error("Character card not found.");
      const seed = await generateSeedDraft({ character, settings: await getSettings(userId), userId });
      send({ type: "seed_draft", characterId: message.characterId, seed }, userId);
      return;
    }
    if (!chatId) throw new Error("This LumiMind action requires an active chat.");
    await mutateTimeline(userId, chatId, async (timeline) => {
      if (message.type === "rename_actor") {
        const actor = timeline.actors[message.actorId];
        if (!actor || !message.name.trim()) throw new Error("Actor not found or name is empty.");
        actor.aliases = uniqueStrings([...actor.aliases, actor.canonicalName]);
        actor.canonicalName = message.name.trim();
        actor.updatedAt = Date.now();
      } else if (message.type === "add_alias") {
        const actor = timeline.actors[message.actorId];
        if (!actor || !message.alias.trim()) throw new Error("Actor not found or alias is empty.");
        actor.aliases = uniqueStrings([...actor.aliases, message.alias]);
        actor.updatedAt = Date.now();
      } else if (message.type === "remove_alias") {
        const actor = timeline.actors[message.actorId];
        if (!actor) throw new Error("Actor not found.");
        actor.aliases = actor.aliases.filter((alias) => alias.toLocaleLowerCase() !== message.alias.trim().toLocaleLowerCase());
        actor.updatedAt = Date.now();
      } else if (message.type === "confirm_actor") {
        const actor = timeline.actors[message.actorId];
        if (!actor) throw new Error("Actor not found.");
        actor.confirmed = true;
        actor.confidence = 1;
        if ((await getSettings(userId)).cortexWritebackEnabled) await writeActorToCortex(userId, timeline, actor);
      } else if (message.type === "writeback_actor") {
        const actor = timeline.actors[message.actorId];
        if (!actor) throw new Error("Actor not found.");
        await writeActorToCortex(userId, timeline, actor);
      } else if (message.type === "remove_actor") {
        if (!removeActor(timeline, message.actorId)) throw new Error("Actor not found.");
      } else if (message.type === "merge_actor") {
        if (!mergeActors(timeline, message.sourceActorId, message.targetActorId)) throw new Error("Could not merge those actors.");
      } else if (message.type === "split_actor") {
        if (!splitActor(timeline, message.actorId, message.name)) throw new Error("Could not split this actor.");
      } else if (message.type === "add_item") {
        if (!timeline.actors[message.actorId] || !message.text.trim()) throw new Error("Actor not found or item is empty.");
        addManualItem(timeline, message.actorId, message.category, message.text);
      } else if (message.type === "edit_core") {
        const baseMind = timeline.baseMinds[message.actorId];
        if (!timeline.actors[message.actorId] || !baseMind) throw new Error("Actor mind not found.");
        baseMind.core = {
          selfConcept: message.core.selfConcept.trim(),
          values: uniqueStrings(message.core.values),
          desires: uniqueStrings(message.core.desires),
          fears: uniqueStrings(message.core.fears),
          boundaries: uniqueStrings(message.core.boundaries),
          notes: uniqueStrings(message.core.notes)
        };
      } else if (message.type === "edit_item") {
        if (!message.text.trim()) throw new Error("Mind item text cannot be empty.");
        if (!overrideItem(timeline, message.actorId, message.itemId, (item) => ({
          ...item,
          text: message.text.trim(),
          status: message.status ?? item.status,
          locked: true
        }))) throw new Error("Mind item not found.");
      } else if (message.type === "remove_item") {
        removeManualItem(timeline, message.actorId, message.itemId);
      } else if (message.type === "toggle_item") {
        if (!overrideItem(timeline, message.actorId, message.itemId, (item) => ({ ...item, [message.field]: !item[message.field] }))) throw new Error("Mind item not found.");
      }
      bumpAndRebuild(timeline);
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    send({ type: "error", message: detail }, userId);
    spindle.log.warn(`LumiMind frontend action failed: ${detail}`);
  }
});
spindle.log.info("LumiMind v0.1.1 loaded \u2014 subjective timeline engine ready.");
