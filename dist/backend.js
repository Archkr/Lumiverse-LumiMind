// src/types.ts
var MIND_SCHEMA_VERSION = 1;
var ANALYSIS_SCHEMA_VERSION = 1;
var EXTENSION_KEY = "lumi_mind";

// src/engine.ts
var DEFAULT_SETTINGS = {
  controllerConnectionId: null,
  controllerTemperature: 0.1,
  controllerMaxTokens: 1800,
  analysisStateTokenBudget: 24e3,
  injectionTokenBudget: 8e3,
  injectionPosition: "prompt_start",
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
  const controllerMaxTokens = typeof raw.controllerMaxTokens === "number" ? raw.controllerMaxTokens : Number(raw.controllerMaxTokens);
  const analysisStateTokenBudget = typeof raw.analysisStateTokenBudget === "number" ? raw.analysisStateTokenBudget : Number(raw.analysisStateTokenBudget);
  const injectionTokenBudget = typeof raw.injectionTokenBudget === "number" ? raw.injectionTokenBudget : Number(raw.injectionTokenBudget);
  const analysisContextMessageLimit = typeof raw.analysisContextMessageLimit === "number" ? raw.analysisContextMessageLimit : Number(raw.analysisContextMessageLimit);
  const chatHistoryMessageLimit = typeof raw.chatHistoryMessageLimit === "number" ? raw.chatHistoryMessageLimit : Number(raw.chatHistoryMessageLimit);
  return {
    controllerConnectionId: stringValue(raw.controllerConnectionId) || null,
    controllerTemperature: clamp(raw.controllerTemperature, 0, 2, DEFAULT_SETTINGS.controllerTemperature),
    controllerMaxTokens: Math.round(Number.isFinite(controllerMaxTokens) ? Math.max(300, controllerMaxTokens) : DEFAULT_SETTINGS.controllerMaxTokens),
    analysisStateTokenBudget: Math.round(Number.isFinite(analysisStateTokenBudget) ? Math.max(0, analysisStateTokenBudget) : DEFAULT_SETTINGS.analysisStateTokenBudget),
    injectionTokenBudget: Math.round(Number.isFinite(injectionTokenBudget) ? Math.max(0, injectionTokenBudget) : DEFAULT_SETTINGS.injectionTokenBudget),
    injectionPosition: raw.injectionPosition === "before_last_user" || raw.injectionPosition === "prompt_end" ? raw.injectionPosition : DEFAULT_SETTINGS.injectionPosition,
    analysisContextMessageLimit: Math.round(Number.isFinite(analysisContextMessageLimit) ? Math.max(0, analysisContextMessageLimit) : DEFAULT_SETTINGS.analysisContextMessageLimit),
    chatHistoryMessageLimit: Math.round(Number.isFinite(chatHistoryMessageLimit) ? Math.max(0, chatHistoryMessageLimit) : DEFAULT_SETTINGS.chatHistoryMessageLimit),
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
  return stableHash(`ledger-policy:1|${directorPolicy}${personaPolicy}persona:${settings.personaMindEnabled ? 1 : 0}|director:${settings.characterCardDirectorMode ? 1 : 0}`);
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
function mindInjectionIndex(messages, position) {
  if (position === "prompt_end") return messages.length;
  if (position === "before_last_user") {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") return index;
    }
    return messages.length;
  }
  return 0;
}
function createActor(input) {
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
    suppressedCortexEntityIds: [],
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
    actor.suppressedAliases = uniqueStrings(Array.isArray(actor.suppressedAliases) ? actor.suppressedAliases : []);
    const suppressed = new Set(actor.suppressedAliases.map((alias) => alias.toLocaleLowerCase()));
    actor.aliases = uniqueStrings(Array.isArray(actor.aliases) ? actor.aliases : []).filter((alias) => !suppressed.has(alias.toLocaleLowerCase()));
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
    suppressedCortexEntityIds: uniqueStrings(
      Array.isArray(raw.suppressedCortexEntityIds) ? raw.suppressedCortexEntityIds.filter((id) => typeof id === "string") : []
    ),
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
    existing.suppressedAliases ??= [];
    const suppressed = new Set(existing.suppressedAliases.map((alias) => alias.toLocaleLowerCase()));
    existing.aliases = uniqueStrings([
      ...existing.aliases,
      ...input.aliases ?? [],
      ...existing.canonicalName.toLocaleLowerCase() !== input.name.trim().toLocaleLowerCase() ? [input.name] : []
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
function attachCortexIdentity(actor, identity) {
  actor.suppressedAliases ??= [];
  const suppressedAliases = new Set(actor.suppressedAliases.map((alias) => alias.toLocaleLowerCase()));
  actor.aliases = uniqueStrings([
    ...actor.aliases,
    ...identity.aliases,
    ...actor.canonicalName.toLocaleLowerCase() !== identity.name.toLocaleLowerCase() ? [identity.name] : []
  ]).filter((alias) => !suppressedAliases.has(alias.toLocaleLowerCase()));
  actor.cortexEntityId = identity.id;
  actor.confidence = Math.max(actor.confidence, clamp(identity.confidence, 0, 1, actor.confidence));
  actor.confirmed = actor.confirmed || identity.confirmed;
  actor.updatedAt = Date.now();
}
function clearCortexBindings(timeline) {
  for (const actor of Object.values(timeline.actors)) actor.cortexEntityId = null;
  timeline.suppressedCortexEntityIds = [];
}
function reconcileCortexIdentities(timeline, input) {
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
    new Set([identity.name, ...identity.aliases].map((name) => name.trim().toLocaleLowerCase()).filter(Boolean))
  ]));
  const unlinkedActors = Object.values(timeline.actors).filter((actor) => !actor.cortexEntityId);
  const matchesByIdentity = /* @__PURE__ */ new Map();
  const matchCountByActor = /* @__PURE__ */ new Map();
  for (const identity of identities) {
    const names = identityNames.get(identity.id) ?? /* @__PURE__ */ new Set();
    const matches = unlinkedActors.filter((actor) => actorNames(actor).some((name) => names.has(name)));
    matchesByIdentity.set(identity.id, matches);
    for (const actor of matches) matchCountByActor.set(actor.id, (matchCountByActor.get(actor.id) ?? 0) + 1);
  }
  for (const identity of identities) {
    const linked = Object.values(timeline.actors).find((actor2) => actor2.cortexEntityId === identity.id);
    if (linked) {
      attachCortexIdentity(linked, identity);
      continue;
    }
    const matches = (matchesByIdentity.get(identity.id) ?? []).filter((actor2) => !actor2.cortexEntityId && matchCountByActor.get(actor2.id) === 1);
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
      confirmed: identity.confirmed
    });
    timeline.actors[actor.id] = actor;
    timeline.baseMinds[actor.id] = makeBaseMind(actor.id);
    attachCortexIdentity(actor, identity);
  }
}
function confirmActor(timeline, actorId) {
  const actor = timeline.actors[actorId];
  if (!actor) return false;
  actor.confirmed = true;
  actor.confidence = 1;
  actor.updatedAt = Date.now();
  return true;
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
function createCheckpointTimeline(source, targetChatId) {
  const checkpoint = createTimeline(targetChatId);
  checkpoint.analysisPolicyHash = source.analysisPolicyHash;
  checkpoint.active = true;
  checkpoint.paused = false;
  checkpoint.health = "ready";
  checkpoint.actors = Object.fromEntries(Object.entries(source.actors).map(([actorId, actor]) => [actorId, {
    ...actor,
    aliases: [...actor.aliases],
    suppressedAliases: [...actor.suppressedAliases ?? []]
  }]));
  checkpoint.suppressedCortexEntityIds = [...source.suppressedCortexEntityIds ?? []];
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
  return item.locked;
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
  return {
    duplicatesSuppressed: 0,
    entriesUpdated: 0,
    entriesSuperseded: 0,
    invalidChangesRejected: 0,
    invalidChangeReasons: {}
  };
}
function rejectMindChange(reduction, reason) {
  reduction.invalidChangesRejected += 1;
  reduction.invalidChangeReasons[reason] = (reduction.invalidChangeReasons[reason] ?? 0) + 1;
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
      const suppressed = new Set((actor.suppressedAliases ?? []).map((alias) => alias.toLocaleLowerCase()));
      actor.aliases = uniqueStrings([...actor.aliases, ...mention.aliases]).filter((alias) => !suppressed.has(alias.toLocaleLowerCase()));
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
          ...target,
          status: delta.operation === "resolve" ? "resolved" : "abandoned",
          evidence: { ...delta.evidence },
          updatedAt: delta.createdAt
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
    prefixHash = nextPrefixHash(prefixHash, contentHash, swipeId);
  }
  const overrides = [...timeline.manualOverrides].sort((left, right) => left.createdAt - right.createdAt);
  let overrideIndex = 0;
  for (const record of matchedRecords) {
    const beforeRecord = [];
    while (overrideIndex < overrides.length && overrides[overrideIndex].createdAt <= record.createdAt) {
      beforeRecord.push(overrides[overrideIndex]);
      overrideIndex += 1;
    }
    applyManualOverrides(minds, beforeRecord);
    record.reduction = applyRecord(record, timeline.actors, minds);
  }
  applyManualOverrides(minds, overrides.slice(overrideIndex));
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
    const suppressed = new Set((actor.suppressedAliases ?? []).map((alias) => alias.toLocaleLowerCase()));
    actor.aliases = uniqueStrings([...actor.aliases, ...raw.aliases ?? []]).filter((alias) => !suppressed.has(alias.toLocaleLowerCase()));
    refs.set(stableReference.toLocaleLowerCase(), id);
    refs.set(raw.name.trim().toLocaleLowerCase(), id);
    for (const alias of actor.aliases) refs.set(alias.trim().toLocaleLowerCase(), id);
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
function mergeActors(timeline, sourceActorId, targetActorId, cortexLink) {
  const source = timeline.actors[sourceActorId];
  const target = timeline.actors[targetActorId];
  if (!source || !target || sourceActorId === targetActorId) return false;
  const cortexConflict = !!source.cortexEntityId && !!target.cortexEntityId && source.cortexEntityId !== target.cortexEntityId;
  if (cortexConflict && !cortexLink) return false;
  timeline.suppressedCortexEntityIds ??= [];
  if (cortexConflict) {
    const discardedId = cortexLink === "source" ? target.cortexEntityId : source.cortexEntityId;
    if (discardedId) timeline.suppressedCortexEntityIds = uniqueStrings([...timeline.suppressedCortexEntityIds, discardedId]);
    if (cortexLink === "source") target.cortexEntityId = source.cortexEntityId;
  }
  target.suppressedAliases = uniqueStrings([...target.suppressedAliases ?? [], ...source.suppressedAliases ?? []]);
  const suppressed = new Set(target.suppressedAliases.map((alias) => alias.toLocaleLowerCase()));
  target.aliases = uniqueStrings([...target.aliases, source.canonicalName, ...source.aliases]).filter((alias) => !suppressed.has(alias.toLocaleLowerCase()));
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
  const sourceMind = timeline.minds[actorId] ?? timeline.baseMinds[actorId] ?? makeBaseMind(actorId);
  const cloned = cloneMind(sourceMind);
  cloned.actorId = actor.id;
  cloned.items = cloned.items.map((item) => ({ ...item, id: `${item.id}:split:${crypto.randomUUID()}` }));
  timeline.baseMinds[actor.id] = cloned;
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
function formatMind(mind, actors, includedItemIds, includeEmpty = false) {
  const actor = actors[mind.actorId];
  if (!actor) return "";
  const relevant = new Set(mind.presentActorIds);
  const items = [...mind.items].filter((item) => item.status === "active" || item.status === "uncertain").filter((item) => !includedItemIds || includedItemIds.has(item.id)).sort((left, right) => itemScore(right, relevant) - itemScore(left, relevant));
  const details = [];
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
function presentManagedActors(timeline, settings, targetActorId) {
  return Object.values(timeline.actors).filter((actor) => actor.present && timeline.minds[actor.id] && actorMindEnabled(actor, settings)).sort(
    (left, right) => Number(right.id === targetActorId) - Number(left.id === targetActorId) || Number(right.confirmed) - Number(left.confirmed) || right.updatedAt - left.updatedAt
  );
}
function renderMindInjection(timeline, targetActorId, settings, includedItemIds) {
  const presentActors = presentManagedActors(timeline, settings, targetActorId);
  const minds = presentActors.map((actor) => formatMind(timeline.minds[actor.id], timeline.actors, includedItemIds, !!includedItemIds)).filter(Boolean);
  const body = minds.join("\n\n");
  const unmanagedPersonaGuidance = !settings.personaMindEnabled ? "The user persona is unmanaged. Do not decide their thoughts, feelings, dialogue, or actions for them." : "";
  if (!body.trim() && !unmanagedPersonaGuidance) return null;
  return [
    "[LumiMind \u2014 private subjective continuity]",
    "The following is private mental state, not objective truth. Preserve false beliefs and uncertainty.",
    "Use it to guide choices and subtext. Do not quote or summarize this block. Reveal secrets only through character-motivated behavior.",
    ...unmanagedPersonaGuidance ? [unmanagedPersonaGuidance] : [],
    "",
    ...body ? [body] : [],
    "[/LumiMind]"
  ].join("\n");
}
function renderDirectorMindInjection(timeline, settings, includedItemIds) {
  const actors = presentManagedActors(timeline, settings, null);
  if (!actors.length) return null;
  const body = actors.map((actor) => formatMind(timeline.minds[actor.id], timeline.actors, includedItemIds, !!includedItemIds)).filter(Boolean).join("\n\n");
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
function compactStateForController(timeline, settings = DEFAULT_SETTINGS) {
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
          source: item.source,
          controllerWritable: !protectedMindItem(item)
        }))
      } : {}
    };
  });
}
function projectionTelemetry(budget, measurement, available, included, actorCount) {
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
    tokenCountFallback: measurement.fallback
  };
}
function referenceAppears(content, reference) {
  const value = reference.trim();
  if (value.length < 2) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(content);
}
function textTokenSet(value) {
  return new Set(canonicalMindText(value).split(" ").filter(Boolean));
}
function sharedTokenCount(value, tokens) {
  if (!value || tokens.size === 0) return 0;
  let shared = 0;
  for (const token of textTokenSet(value)) if (tokens.has(token)) shared += 1;
  return shared;
}
function roundRobinOrder(queues) {
  const orderedQueues = queues.filter((queue) => queue.values.length > 0).sort((left, right) => right.score - left.score);
  const result = [];
  const consumed = new Map(orderedQueues.map((queue) => [queue, 0]));
  const maxLead = Math.max(0, ...orderedQueues.map((queue) => queue.lead));
  for (let depth = 0; depth < maxLead; depth += 1) {
    for (const queue of orderedQueues) {
      if (depth >= queue.lead) continue;
      const value = queue.values[depth];
      if (value !== void 0) {
        result.push(value);
        consumed.set(queue, depth + 1);
      }
    }
  }
  while (orderedQueues.some((queue) => (consumed.get(queue) ?? 0) < queue.values.length)) {
    for (const queue of orderedQueues) {
      const index = consumed.get(queue) ?? 0;
      const value = queue.values[index];
      if (value !== void 0) {
        result.push(value);
        consumed.set(queue, index + 1);
      }
    }
  }
  return result;
}
async function fitProjectionToBudget(fullText, baseText, orderedCandidates, tokenBudget, countTokens, render) {
  const fullMeasurement = await countTokens(fullText);
  if (tokenBudget === 0 || fullMeasurement.totalTokens <= tokenBudget) {
    return {
      text: fullText,
      includedIds: new Set(orderedCandidates.map((candidate) => candidate.id)),
      measurement: fullMeasurement
    };
  }
  const baseMeasurement = await countTokens(baseText);
  if (baseMeasurement.totalTokens >= tokenBudget || orderedCandidates.length === 0) {
    return { text: baseText, includedIds: /* @__PURE__ */ new Set(), measurement: baseMeasurement };
  }
  const charsPerToken = Math.max(1, fullText.length / Math.max(1, fullMeasurement.totalTokens));
  const estimatedAvailableChars = Math.max(0, (tokenBudget - baseMeasurement.totalTokens) * charsPerToken);
  const selectedOrder = [];
  let estimatedChars = 0;
  for (const candidate of orderedCandidates) {
    if (estimatedChars + candidate.estimatedChars > estimatedAvailableChars) continue;
    selectedOrder.push(candidate.id);
    estimatedChars += candidate.estimatedChars;
  }
  let includedIds = new Set(selectedOrder);
  let text2 = render(includedIds);
  let measurement = await countTokens(text2);
  while (measurement.totalTokens > tokenBudget && selectedOrder.length > 0) {
    const keepRatio = tokenBudget / Math.max(1, measurement.totalTokens);
    const keepCount = Math.max(0, Math.min(selectedOrder.length - 1, Math.floor(selectedOrder.length * keepRatio) - 1));
    selectedOrder.splice(keepCount);
    includedIds = new Set(selectedOrder);
    text2 = render(includedIds);
    measurement = await countTokens(text2);
  }
  return { text: text2, includedIds, measurement };
}
function compactActors(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const actor = asObject(entry);
    const items = Array.isArray(actor.items) ? actor.items.flatMap((item) => {
      const raw = asObject(item);
      const id = stringValue(raw.id);
      return id ? [{ ...raw, id }] : [];
    }) : void 0;
    return {
      ...actor,
      ref: stringValue(actor.ref),
      name: stringValue(actor.name),
      aliases: strings(actor.aliases),
      ...items ? { items } : {}
    };
  });
}
function renderCompactStateProjection(actors, includedIds) {
  return actors.map((actor) => {
    if (!actor.items) return { ...actor };
    const items = actor.items.filter((item) => includedIds.has(item.id));
    return {
      ...actor,
      items,
      availableItemCount: actor.items.length,
      omittedItemCount: actor.items.length - items.length
    };
  });
}
function orderedCompactStateCandidates(actors, messages, recentContext) {
  const currentText = messages.map((message) => `${message.name ?? ""}
${message.content}`).join("\n");
  const contextText = recentContext.map((message) => `${message.name ?? ""}
${message.content}`).join("\n");
  const currentTokens = textTokenSet(currentText);
  const contextTokens = textTokenSet(contextText);
  const relevantActorRefs = new Set(
    actors.filter((actor) => [actor.name, ...actor.aliases].some((reference) => referenceAppears(currentText, reference))).map((actor) => actor.ref)
  );
  return roundRobinOrder(actors.map((actor) => {
    const currentMention = [actor.name, ...actor.aliases].some((reference) => referenceAppears(currentText, reference));
    const contextMention = [actor.name, ...actor.aliases].some((reference) => referenceAppears(contextText, reference));
    const actorScore = Number(currentMention) * 1e3 + Number(actor.present) * 500 + Number(contextMention) * 250 + Number(actor.confirmed) * 25;
    const values = (actor.items ?? []).map((item, index) => {
      const protectedItem = item.controllerWritable === false || item.locked === true || item.pinned === true;
      const targetRelevant = (item.targetActorIds ?? []).some((ref) => relevantActorRefs.has(ref));
      const score = Number(protectedItem) * 2e3 + Number(targetRelevant) * 750 + sharedTokenCount(item.text ?? "", currentTokens) * 120 + sharedTokenCount(item.text ?? "", contextTokens) * 30 + (item.category ? CATEGORY_ORDER[item.category] ?? 0 : 0) * 5 - index;
      return { item, score };
    }).sort((left, right) => right.score - left.score).map(({ item }) => ({ id: item.id, estimatedChars: JSON.stringify(item).length + 2 }));
    return { score: actorScore, lead: currentMention ? 3 : actor.present || contextMention ? 1 : 0, values };
  }));
}
async function projectControllerState(compactState, messages, recentContext, tokenBudget, countTokens) {
  const actors = compactActors(compactState);
  const available = actors.reduce((sum, actor) => sum + (actor.items?.length ?? 0), 0);
  const fullText = JSON.stringify(compactState);
  const orderedCandidates = orderedCompactStateCandidates(actors, messages, recentContext);
  const baseState = renderCompactStateProjection(actors, /* @__PURE__ */ new Set());
  const render = (includedIds) => JSON.stringify(renderCompactStateProjection(actors, includedIds));
  const fitted = await fitProjectionToBudget(
    fullText,
    JSON.stringify(baseState),
    orderedCandidates,
    tokenBudget,
    countTokens,
    render
  );
  const fullIncluded = tokenBudget === 0 || fitted.includedIds.size === orderedCandidates.length;
  const state = fullIncluded ? compactState : JSON.parse(fitted.text);
  return {
    state,
    telemetry: projectionTelemetry(tokenBudget, fitted.measurement, available, fullIncluded ? available : fitted.includedIds.size, actors.length)
  };
}
function orderedInjectionCandidates(timeline, actors, targetActorId, contextMessages) {
  const contextText = contextMessages.map((message) => `${message.name ?? ""}
${message.content}`).join("\n");
  const contextTokens = textTokenSet(contextText);
  const relevantActorIds = new Set(
    actors.filter((actor) => actor.id === targetActorId || [actor.canonicalName, ...actor.aliases].some((reference) => referenceAppears(contextText, reference))).map((actor) => actor.id)
  );
  return roundRobinOrder(actors.map((actor) => {
    const actorScore = Number(actor.id === targetActorId) * 2e3 + Number(relevantActorIds.has(actor.id)) * 1e3 + Number(actor.confirmed) * 25;
    const values = (timeline.minds[actor.id]?.items ?? []).filter((item) => item.status === "active" || item.status === "uncertain").map((item) => ({
      item,
      score: Number(protectedMindItem(item)) * 2e3 + Number(item.targetActorIds.some((id) => relevantActorIds.has(id))) * 750 + sharedTokenCount(item.text, contextTokens) * 100 + itemScore(item, relevantActorIds)
    })).sort((left, right) => right.score - left.score).map(({ item }) => ({ id: item.id, estimatedChars: item.text.length + item.id.length + 48 }));
    return { score: actorScore, lead: actor.id === targetActorId ? 4 : relevantActorIds.has(actor.id) ? 2 : 0, values };
  }));
}
async function projectMindInjection(timeline, targetActorId, settings, contextMessages, countTokens, director) {
  const actors = presentManagedActors(timeline, settings, director ? null : targetActorId);
  const allItems = actors.flatMap(
    (actor) => (timeline.minds[actor.id]?.items ?? []).filter((item) => item.status === "active" || item.status === "uncertain")
  );
  const allItemIds = new Set(allItems.map((item) => item.id));
  const available = allItems.length;
  const fullContent = director ? renderDirectorMindInjection(timeline, settings, allItemIds) : renderMindInjection(timeline, targetActorId, settings, allItemIds);
  const emptyMeasurement = await countTokens(fullContent ?? "");
  if (!fullContent) {
    return { content: null, telemetry: projectionTelemetry(settings.injectionTokenBudget, emptyMeasurement, available, 0, actors.length) };
  }
  const orderedCandidates = orderedInjectionCandidates(timeline, actors, targetActorId, contextMessages);
  const render = (includedIds) => (director ? renderDirectorMindInjection(timeline, settings, includedIds) : renderMindInjection(timeline, targetActorId, settings, includedIds)) ?? "";
  const fitted = await fitProjectionToBudget(
    fullContent,
    render(/* @__PURE__ */ new Set()),
    orderedCandidates,
    settings.injectionTokenBudget,
    countTokens,
    render
  );
  const fullIncluded = settings.injectionTokenBudget === 0 || fitted.includedIds.size === orderedCandidates.length;
  return {
    content: fullIncluded ? fullContent : fitted.text,
    telemetry: projectionTelemetry(settings.injectionTokenBudget, fitted.measurement, available, fullIncluded ? available : fitted.includedIds.size, actors.length)
  };
}
function buildProjectedMindInjection(timeline, targetActorId, settings, contextMessages, countTokens) {
  return projectMindInjection(timeline, targetActorId, settings, contextMessages, countTokens, false);
}
function buildProjectedDirectorMindInjection(timeline, settings, contextMessages, countTokens) {
  return projectMindInjection(timeline, null, settings, contextMessages, countTokens, true);
}

// src/controller.ts
var THINK_BLOCK_RE = /<think[\s\S]*?<\/think>/gi;
function isAbortError(error) {
  return !!error && typeof error === "object" && "name" in error && error.name === "AbortError";
}
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
function incrementInvalidReason(counts, reason) {
  counts[reason] = (counts[reason] ?? 0) + 1;
}
function mergeInvalidReasons(...sources) {
  const result = {};
  for (const source of sources) {
    for (const [reason, count] of Object.entries(source)) {
      if (count > 0) result[reason] = (result[reason] ?? 0) + count;
    }
  }
  return result;
}
function invalidReasonTotal(counts) {
  return Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
}
function normalizeControllerAnalysisResult(value) {
  const raw = asObject2(value);
  const invalidChangeReasons = {};
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
    const rejectionReason = !subjectRef ? "missing_subject" : !messageId ? "missing_message_id" : !normalizedCategory ? "invalid_category" : !normalizedOperation ? "invalid_operation" : (normalizedOperation === "add" || normalizedOperation === "update") && !normalizedText ? "missing_text" : normalizedOperation !== "add" && !targetItemId ? "missing_target_id" : null;
    if (rejectionReason) {
      incrementInvalidReason(invalidChangeReasons, rejectionReason);
      return [];
    }
    if (!normalizedCategory || !normalizedOperation) return [];
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
    invalidChangesRejected: invalidReasonTotal(invalidChangeReasons),
    invalidChangeReasons
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
function resolveControllerTarget(items, targetItemId) {
  const exact = items.find((item) => text(item.id) === targetItemId);
  if (exact) return exact;
  const separatorIndex = targetItemId.lastIndexOf(":");
  if (separatorIndex < 0 || targetItemId.length - separatorIndex - 1 < 8) return null;
  const prefixMatches = items.filter((item) => text(item.id).startsWith(targetItemId));
  return prefixMatches.length === 1 ? prefixMatches[0] : null;
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
  const invalidChangeReasons = {};
  const changes = analysis.changes.flatMap((change) => {
    const actor = actorByReference.get(policyReference(change.subjectRef));
    if (!messageIds.has(change.messageId)) {
      incrementInvalidReason(invalidChangeReasons, "message_outside_batch");
      return [];
    }
    if (!actor) {
      incrementInvalidReason(invalidChangeReasons, "unknown_subject");
      return [];
    }
    if (change.operation !== "add") {
      const targetItemId = change.targetItemId?.trim();
      if (!targetItemId) {
        incrementInvalidReason(invalidChangeReasons, "missing_target_id");
        return [];
      }
      const target = resolveControllerTarget(
        (Array.isArray(actor.items) ? actor.items : []).map(asObject2),
        targetItemId
      );
      if (!target) {
        incrementInvalidReason(invalidChangeReasons, "target_not_found");
        return [];
      }
      const protectedTarget = target.locked === true;
      if (protectedTarget) {
        incrementInvalidReason(invalidChangeReasons, "protected_target");
        return [];
      }
      change = { ...change, targetItemId: text(target.id) };
    }
    const knownReferences = (values) => (values ?? []).filter((reference) => actorByReference.has(policyReference(reference)));
    return [{
      ...change,
      targetRefs: knownReferences(change.targetRefs),
      concealedFromRefs: knownReferences(change.concealedFromRefs)
    }];
  });
  return {
    analysis: { actorMentions, changes },
    invalidChangesRejected: invalidReasonTotal(invalidChangeReasons),
    invalidChangeReasons
  };
}
function isNontrivialAnalysisBatch(messages) {
  const lengths = messages.map((message) => message.content.replace(/\s+/g, " ").trim().length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return total >= 400 || lengths.some((length) => length >= 280) || messages.length >= 2 && total >= 240;
}
function makeControllerResponseTelemetry(raw, parsed, accepted, diagnostics = {}, outputMode = "json") {
  const object = asObject2(parsed);
  const rawChanges = Array.isArray(object.changes) ? object.changes.length : 0;
  const duplicatesSuppressed = diagnostics.duplicatesSuppressed ?? 0;
  return {
    outputMode,
    responseChars: raw.length,
    responseHash: stableHash(raw),
    rawActorMentions: Array.isArray(object.actorMentions) ? object.actorMentions.length : 0,
    rawChanges,
    acceptedActorMentions: accepted.actorMentions.length,
    acceptedChanges: accepted.changes.length,
    duplicatesSuppressed,
    invalidChangesRejected: diagnostics.invalidChangesRejected ?? Math.max(0, rawChanges - accepted.changes.length - duplicatesSuppressed),
    invalidChangeReasons: diagnostics.invalidChangeReasons ?? {}
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
function toolChoiceParameters(provider) {
  const normalized = provider?.trim().toLocaleLowerCase() ?? "";
  if (normalized === "google" || normalized === "gemini" || normalized === "google_vertex") {
    return { toolConfig: { functionCallingConfig: { mode: "ANY" } } };
  }
  if (normalized === "anthropic") return { tool_choice: { type: "any" } };
  return { tool_choice: "required" };
}
async function resolveConnection(settings, userId, fallbackConnectionId) {
  const id = settings.controllerConnectionId?.trim() || fallbackConnectionId?.trim() || null;
  if (!id) return { id: null, provider: null, model: null };
  const connection = await spindle.connections.get(id, userId).catch(() => null);
  return { id, provider: connection?.provider ?? null, model: connection?.model ?? null };
}
function fallbackTokenMeasurement(textValue, model) {
  return {
    totalTokens: Math.ceil(textValue.length / 4),
    model,
    tokenizerName: "Approximate chars / 4",
    approximate: true,
    fallback: true
  };
}
async function countTextTokens(textValue, connection, userId) {
  try {
    const result = await spindle.tokens.countText(textValue, connection.model ? { model: connection.model, userId } : { modelSource: "main", userId });
    return {
      totalTokens: result.total_tokens,
      model: result.model || connection.model,
      tokenizerName: result.tokenizer_name,
      approximate: result.approximate,
      fallback: false
    };
  } catch {
    return fallbackTokenMeasurement(textValue, connection.model);
  }
}
async function countMessageTokens(messages, connection, userId) {
  try {
    const result = await spindle.tokens.countMessages(messages, connection.model ? { model: connection.model, userId } : { modelSource: "main", userId });
    return {
      totalTokens: result.total_tokens,
      model: result.model || connection.model,
      tokenizerName: result.tokenizer_name,
      approximate: result.approximate,
      fallback: false
    };
  } catch {
    return fallbackTokenMeasurement(messages.map((message) => `${message.role}
${message.content}`).join("\n"), connection.model);
  }
}
function controllerTokenCounter(connection, userId) {
  return (value) => countTextTokens(value, connection, userId);
}
async function quietJson(prompt, systemPrompt, schemaName, schema, settings, userId, fallbackConnectionId, resolvedConnection, signal) {
  const connection = resolvedConnection ?? await resolveConnection(settings, userId, fallbackConnectionId);
  const result = await spindle.generate.quiet({
    type: "quiet",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    parameters: {
      temperature: settings.controllerTemperature,
      max_tokens: settings.controllerMaxTokens,
      ...toolChoiceParameters(connection.provider)
    },
    tools: [{
      name: schemaName,
      description: "Submit the complete structured LumiMind result exactly once.",
      parameters: schema
    }],
    reasoning: { source: "off" },
    ...connection.id ? { connection_id: connection.id } : {},
    userId,
    signal
  });
  const object = asObject2(result);
  const content = sanitizeControllerText(text(object.content));
  const reasoning = sanitizeControllerText(text(object.reasoning));
  const toolCall = (Array.isArray(object.tool_calls) ? object.tool_calls : []).map(asObject2).find((call) => text(call.name) === schemaName && Object.keys(asObject2(call.args)).length > 0);
  const toolArgs = toolCall ? asObject2(toolCall.args) : null;
  const outputMode = toolArgs ? "tool" : "json";
  const raw = toolArgs ? JSON.stringify(toolArgs) : content || reasoning;
  const usage = asObject2(object.usage);
  const providerInputTokens = typeof usage.prompt_tokens === "number" && Number.isFinite(usage.prompt_tokens) ? Math.max(0, Math.round(usage.prompt_tokens)) : null;
  return {
    parsed: toolArgs ?? parseJsonValue(raw),
    raw,
    meta: { connectionId: connection.id, provider: connection.provider, model: connection.model },
    outputMode,
    providerInputTokens
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
  "Call the required LumiMind result tool exactly once. Analyze every supplied message and identify every named actor with narrative agency that the roleplay-mode instructions permit LumiMind to manage.",
  "Infer emotions, motives, goals, plans, relationships, and beliefs only when directly stated or strongly supported by subtext.",
  "Never invent objective events. Beliefs may be false or uncertain and must remain subjective.",
  "Treat a secret as information the subject knows and is deliberately concealing; concealedFromRefs names who it is hidden from.",
  "Treat mind_state as an authoritative ledger to reconcile, not background prose to summarize. Adds are the last resort, not the default output.",
  "For every candidate state, compare its meaning against every unresolved item for the same subject, category, targets, and concealed audience. Compare semantic claims and functions, not wording or sentence structure.",
  "Classify each candidate internally as exactly one of COVERED, EVOLVED, ENDED, PROTECTED, or NOVEL before emitting JSON. Do not output these labels.",
  "COVERED: an existing item already expresses the same claim, intent, reaction, stance, or a broader state that entails it. Emit no change, even when the new wording is more vivid, specific, or paraphrased.",
  "EVOLVED: the same continuing state materially changed and its existing item has controllerWritable=true. Emit update with that exact item ID; never add a second version.",
  "ENDED: an existing controllerWritable=true state clearly concluded or became obsolete. Resolve, abandon, or remove that exact item rather than adding its opposite.",
  "PROTECTED: the best semantic match has controllerWritable=false. Emit no change. Never add a replacement, workaround, refinement, contradiction, or scene-specific restatement of protected state.",
  "NOVEL: no existing item or earlier change in this response covers the same semantic proposition or continuity function. Only NOVEL candidates may use add. When uncertain between COVERED and NOVEL, choose COVERED and emit nothing.",
  "Use existing item IDs in targetItemId for every update, resolve, abandon, or remove operation. Never target an item with controllerWritable=false.",
  "Represent one emotional reaction to the same event, cause, and target as one concise composite emotion; do not split its adjectives or facets into separate entries.",
  "Represent one intended outcome as one goal and one method as one plan. Do not turn each action, sentence, observation, or rhetorical question into another state item.",
  "Maintain one current relationship stance per subject-target pair. Update the writable stance when it changes; if the stance is protected, emit nothing.",
  "Before returning JSON, silently audit the entire changes array: no add may overlap an unresolved item or another emitted change, no protected item may be targeted or bypassed, and each add must carry genuinely new continuity value for a future turn.",
  "Bootstrap rule: only when an actor has no unresolved subjective-state entries, add the smallest coherent set needed for continuity. Combine related facets and omit incidental observations.",
  "An entry is an add relative to mind_state even when the evidence describes a state already underway at the beginning of the transcript.",
  "A substantive scene may correctly return an empty changes array when mind_state already covers its supported state. An empty result is suspicious only for a true bootstrap actor with clear subjective evidence and no unresolved entries.",
  "Include actorMentions for the actors actually present in the scene after each message, not merely referenced.",
  "For an actor already in mind_state, copy its exact ref into actorMentions and subjectRef. For a newly discovered actor, use one stable ref consistently in both its actorMention and every change.",
  "A positive omittedItemCount means lower-ranked state remains stored outside this request. Do not treat omission as proof that the actor has no other state.",
  "Every actor mention and change must cite one supplied messageId and a short evidenceExcerpt."
].join("\n");
function correctiveBootstrapNeeded(compactState, mentions) {
  const stateActors = (Array.isArray(compactState) ? compactState : []).map(asObject2).filter((actor) => policyReference(actor.ref) || policyReference(actor.name));
  const actors = stateActors.filter((actor) => actor.managed !== false).map((actor) => ({
    references: [actor.ref, actor.name, ...Array.isArray(actor.aliases) ? actor.aliases : []].map(policyReference).filter(Boolean),
    itemCount: Array.isArray(actor.items) ? actor.items.length : 0
  }));
  if (actors.length === 0) return stateActors.length === 0 || mentions.length > 0;
  if (actors.every((actor) => actor.itemCount === 0)) return true;
  return mentions.some((mention) => {
    const mentionReferences = [mention.ref, mention.name, ...mention.aliases ?? []].map(policyReference).filter(Boolean);
    const actor = actors.find((candidate) => candidate.references.some((reference) => mentionReferences.includes(reference)));
    return !actor || actor.itemCount === 0;
  });
}
function analysisSystemPrompt(settings, corrective = false) {
  const mode = settings.characterCardDirectorMode ? "Director-card mode: host character-card entries marked managed=false are narrators/directors, not in-world actors. Never emit a mind or presence mention for those cards. Treat each named individual the card portrays as an independent NPC, even when several speak inside one assistant message." : "Actor-card mode: host character cards are in-world actors and may receive their own subjective minds.";
  const persona = settings.personaMindEnabled ? "Persona minds are enabled: the active user persona may receive evidence-supported subjective state and may be targeted during impersonation." : "Persona minds are disabled: the user persona is context only. Never emit actorMentions or changes with the user/persona as subject, and never infer actions, goals, emotions, or beliefs for them. Other managed actors may still hold beliefs or relationships about the user.";
  const correction = corrective ? [
    "This is a single corrective pass because the first pass accepted no mental-state changes from a substantive batch.",
    "This pass is permitted only because at least one managed actor genuinely lacks unresolved state. Re-read analysis_batch actor by actor and extract the smallest defensible bootstrap state supported by the text.",
    "Apply the COVERED/EVOLVED/ENDED/PROTECTED/NOVEL reconciliation protocol before every change. Do not fill categories or duplicate state belonging to an already initialized actor.",
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
    "Reconcile; do not summarize. If every supported candidate is COVERED or PROTECTED by mind_state, return actorMentions as appropriate with an empty changes array.",
    'Call the required result tool with {"actorMentions": [...], "changes": [...]} now.'
  ].join("\n\n");
}
async function analyzeMessages(input) {
  const connection = await resolveConnection(input.settings, input.userId, input.fallbackConnectionId);
  const stateProjection = await projectControllerState(
    input.compactState,
    input.messages,
    input.recentContext,
    input.settings.analysisStateTokenBudget,
    controllerTokenCounter(connection, input.userId)
  );
  const prompt = buildAnalysisPrompt({ ...input, compactState: stateProjection.state });
  const systemPrompt = analysisSystemPrompt(input.settings);
  const inputMeasurement = await countMessageTokens([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt }
  ], connection, input.userId);
  const result = await quietJson(
    prompt,
    systemPrompt,
    "lumi_mind_analysis_v1",
    ANALYSIS_SCHEMA,
    input.settings,
    input.userId,
    input.fallbackConnectionId,
    connection,
    input.signal
  );
  input.signal?.throwIfAborted();
  if (!result.parsed) throw new Error("The LumiMind controller returned no parseable structured result.");
  const normalizedFirst = normalizeControllerAnalysisResult(result.parsed);
  const policyFirst = applyControllerMindPolicy(normalizedFirst.analysis, input.compactState, input.settings);
  const validatedFirst = validateControllerAnalysisContext(policyFirst, input.messages, input.compactState);
  const firstAnalysis = validatedFirst.analysis;
  const firstTelemetry = makeControllerResponseTelemetry(result.raw, result.parsed, normalizedFirst.analysis, {
    duplicatesSuppressed: normalizedFirst.duplicatesSuppressed,
    invalidChangesRejected: normalizedFirst.invalidChangesRejected + validatedFirst.invalidChangesRejected,
    invalidChangeReasons: mergeInvalidReasons(normalizedFirst.invalidChangeReasons, validatedFirst.invalidChangeReasons)
  }, result.outputMode);
  const nontrivial = isNontrivialAnalysisBatch(input.messages);
  const bootstrapNeeded = correctiveBootstrapNeeded(input.compactState, firstAnalysis.actorMentions);
  let finalAnalysis = firstAnalysis;
  let retryTelemetry = null;
  let retryRaw = null;
  let retryError = null;
  let attempts = 1;
  if (nontrivial && bootstrapNeeded && firstAnalysis.changes.length === 0) {
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
        input.fallbackConnectionId,
        connection,
        input.signal
      );
      input.signal?.throwIfAborted();
      retryRaw = corrective.raw;
      const normalizedCorrective = normalizeControllerAnalysisResult(corrective.parsed);
      const policyCorrective = applyControllerMindPolicy(normalizedCorrective.analysis, input.compactState, input.settings);
      const validatedCorrective = validateControllerAnalysisContext(policyCorrective, input.messages, input.compactState);
      const correctiveAnalysis = validatedCorrective.analysis;
      retryTelemetry = makeControllerResponseTelemetry(corrective.raw, corrective.parsed, normalizedCorrective.analysis, {
        duplicatesSuppressed: normalizedCorrective.duplicatesSuppressed,
        invalidChangesRejected: normalizedCorrective.invalidChangesRejected + validatedCorrective.invalidChangesRejected,
        invalidChangeReasons: mergeInvalidReasons(normalizedCorrective.invalidChangeReasons, validatedCorrective.invalidChangeReasons)
      }, corrective.outputMode);
      if (!corrective.parsed) throw new Error("Corrective controller pass returned no parseable structured result.");
      finalAnalysis = mergeControllerAnalyses(firstAnalysis, correctiveAnalysis);
    } catch (error) {
      if (isAbortError(error)) throw error;
      retryError = (error instanceof Error ? error.message : String(error)).slice(0, 240);
    }
  }
  const warningCodes = /* @__PURE__ */ new Set();
  const normalizationDropped = (telemetry) => !!telemetry && (telemetry.rawActorMentions > telemetry.acceptedActorMentions || telemetry.rawChanges - telemetry.acceptedChanges > telemetry.duplicatesSuppressed || telemetry.invalidChangesRejected > 0);
  if (normalizationDropped(firstTelemetry) || normalizationDropped(retryTelemetry)) warningCodes.add("normalization_drop");
  if (retryError) warningCodes.add("retry_failed");
  if (nontrivial && bootstrapNeeded && finalAnalysis.changes.length === 0) warningCodes.add("empty_nontrivial_batch");
  return {
    analysis: finalAnalysis,
    meta: result.meta,
    raw: result.raw,
    rawResponses: { first: result.raw, retry: retryRaw },
    telemetry: {
      schemaVersion: 1,
      batchId: crypto.randomUUID(),
      messageCount: input.messages.length,
      inputChars: input.messages.reduce((sum, message) => sum + message.content.length, 0),
      inputTokens: result.providerInputTokens ?? inputMeasurement.totalTokens,
      stateTokens: stateProjection.telemetry.totalTokens,
      stateTokenBudget: stateProjection.telemetry.tokenBudget,
      stateItemsAvailable: stateProjection.telemetry.itemsAvailable,
      stateItemsIncluded: stateProjection.telemetry.itemsIncluded,
      stateItemsOmitted: stateProjection.telemetry.itemsOmitted,
      stateActorCount: stateProjection.telemetry.actorCount,
      tokenModel: result.meta.model ?? stateProjection.telemetry.tokenModel ?? inputMeasurement.model,
      tokenizerName: stateProjection.telemetry.tokenizerName ?? inputMeasurement.tokenizerName,
      tokenCountApproximate: stateProjection.telemetry.tokenCountApproximate || result.providerInputTokens === null && inputMeasurement.approximate,
      tokenCountFallback: stateProjection.telemetry.tokenCountFallback || result.providerInputTokens === null && inputMeasurement.fallback,
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
  "Call the required LumiMind result tool exactly once. Extract enduring characterization from the card without inventing events, relationships, or secrets not supported by the card.",
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

// src/diagnostics.ts
function credentialField(key) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase();
  return normalized.endsWith("apikey") && !normalized.startsWith("has") || normalized === "authorization" || normalized === "accesstoken" || normalized === "refreshtoken" || normalized === "authtoken" || normalized === "bearertoken" || normalized === "clientsecret" || normalized === "password";
}
function redactDiagnosticCredentials(value) {
  if (Array.isArray(value)) return value.map(redactDiagnosticCredentials);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    credentialField(key) ? "[REDACTED]" : redactDiagnosticCredentials(entry)
  ]));
}

// src/backend.ts
var INTERCEPTOR_PRIORITY = 125;
var ANALYSIS_BATCH_SIZE = 6;
var RECONCILE_DEBOUNCE_MS = 650;
var EXTENSION_VERSION = "0.1.1";
var timelines = /* @__PURE__ */ new Map();
var settingsCache = /* @__PURE__ */ new Map();
var activeChats = /* @__PURE__ */ new Map();
var chatUsers = /* @__PURE__ */ new Map();
var operations = /* @__PURE__ */ new Map();
var reconcileTimers = /* @__PURE__ */ new Map();
var analysisAbortControllers = /* @__PURE__ */ new Map();
var pauseRequests = /* @__PURE__ */ new Set();
var rebuildRequests = /* @__PURE__ */ new Set();
var generationContexts = /* @__PURE__ */ new Map();
var latestGenerationByChat = /* @__PURE__ */ new Map();
var connectionByChat = /* @__PURE__ */ new Map();
var controllerDebugResponses = /* @__PURE__ */ new Map();
var lastInjectionProjections = /* @__PURE__ */ new Map();
var lastFrontendUserId = null;
function cacheKey(userId, chatId) {
  return `${userId}:${chatId}`;
}
function asObject3(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
function makeDatabaseArchive(timeline) {
  return {
    format: "lumi_mind.timeline_database.v1",
    schemaVersion: 1,
    exportedAt: Date.now(),
    sourceChatId: timeline.chatId,
    timeline: cloneJson(timeline)
  };
}
function timelineFromDatabaseArchive(value) {
  const archive = asObject3(value);
  if (archive.format !== "lumi_mind.timeline_database.v1" || archive.schemaVersion !== 1) {
    throw new Error("This is not a supported LumiMind timeline database export.");
  }
  const rawTimeline = asObject3(archive.timeline);
  const sourceChatId = typeof archive.sourceChatId === "string" ? archive.sourceChatId.trim() : "";
  if (!sourceChatId || rawTimeline.schemaVersion !== 1 || rawTimeline.chatId !== sourceChatId || !("actors" in rawTimeline) || !("minds" in rawTimeline)) {
    throw new Error("The LumiMind database export is incomplete or invalid.");
  }
  return normalizeTimeline(cloneJson(rawTimeline), sourceChatId);
}
function remapImportedTimeline(source, targetChatId, targetMessages) {
  const crossChat = source.chatId !== targetChatId;
  const imported = cloneJson(source);
  const targetByIndex = new Map(targetMessages.map((message) => [message.index_in_chat ?? 0, message]));
  imported.chatId = targetChatId;
  imported.records = imported.records.flatMap((record) => {
    const target = targetByIndex.get(record.messageIndex);
    if (!target) return [];
    const next = cloneJson(record);
    next.id = `analysis:${crypto.randomUUID()}`;
    next.messageId = target.id;
    next.messageIndex = target.index_in_chat ?? record.messageIndex;
    next.actorMentions = next.actorMentions.map((mention) => ({
      ...mention,
      evidence: { ...mention.evidence, messageId: target.id, messageIndex: target.index_in_chat ?? record.messageIndex }
    }));
    next.deltas = next.deltas.map((delta) => ({
      ...delta,
      evidence: { ...delta.evidence, messageId: target.id, messageIndex: target.index_in_chat ?? record.messageIndex }
    }));
    return [next];
  });
  imported.revision = 0;
  imported.updatedAt = Date.now();
  imported.health = imported.paused ? "paused" : "ready";
  imported.error = null;
  if (crossChat) clearCortexBindings(imported);
  rebuildTimeline(imported, targetMessages);
  return imported;
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
function approximateTokenMeasurement(value, model) {
  return {
    totalTokens: Math.ceil(value.length / 4),
    model,
    tokenizerName: "Approximate chars / 4",
    approximate: true,
    fallback: true
  };
}
async function tokenCounterForConnection(userId, connectionId) {
  const connection = connectionId ? await spindle.connections.get(connectionId, userId).catch(() => null) : null;
  return async (value) => {
    try {
      const result = await spindle.tokens.countText(value, connection?.model ? { model: connection.model, userId } : { modelSource: "main", userId });
      return {
        totalTokens: result.total_tokens,
        model: result.model || connection?.model || null,
        tokenizerName: result.tokenizer_name,
        approximate: result.approximate,
        fallback: false
      };
    } catch {
      return approximateTokenMeasurement(value, connection?.model ?? null);
    }
  };
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
    timeline: timeline ? toTimelineView(timeline, settings) : null,
    lastInjectionProjection: chatId ? lastInjectionProjections.get(cacheKey(userId, chatId)) ?? null : null
  };
}
async function sendState(userId, chatId, characterId) {
  send({ type: "state", state: await buildFrontendState(userId, chatId, characterId) }, userId);
}
async function buildDeveloperDiagnostics(userId, requestedChatId) {
  const active = activeChats.get(userId) ?? { chatId: null, characterId: null };
  const chatId = requestedChatId ?? active.chatId;
  const [settings, connections, timeline, transcript, character, persona] = await Promise.all([
    getSettings(userId),
    hasPermission("generation") ? spindle.connections.list(userId).catch(() => []) : Promise.resolve([]),
    chatId ? getTimeline(chatId, userId).catch(() => null) : Promise.resolve(null),
    chatId && hasPermission("chat_mutation") ? spindle.chat.getMessages(chatId, userId).catch(() => null) : Promise.resolve(null),
    active.characterId && hasPermission("characters") ? spindle.characters.get(active.characterId, userId).catch(() => null) : Promise.resolve(null),
    hasPermission("personas") ? spindle.personas.getActive(userId).catch(() => null) : Promise.resolve(null)
  ]);
  return redactDiagnosticCredentials({
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    userId,
    activeContext: { chatId, characterId: active.characterId },
    permissions: currentPermissions(),
    settings,
    connections,
    timeline,
    transcript,
    activeCharacter: character,
    activePersona: persona,
    controllerRawResponses: chatId ? controllerDebugResponses.get(cacheKey(userId, chatId)) ?? [] : [],
    lastInjectionProjection: chatId ? lastInjectionProjections.get(cacheKey(userId, chatId)) ?? null : null,
    unavailable: ["API credential values", "raw controller responses created before the current extension runtime"]
  });
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
  await refreshCortexBridge(timeline, userId);
  rebuildTimeline(timeline, []);
}
async function refreshCortexBridge(timeline, userId) {
  const settings = await getSettings(userId);
  if (!settings.cortexImportEnabled || !hasPermission("memories")) return;
  let entities;
  try {
    entities = await spindle.memories.entities.list(timeline.chatId, { activeOnly: false, limit: 250, userId });
  } catch {
    return;
  }
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const unavailableLinkedIds = /* @__PURE__ */ new Set();
  const missingLinkedIds = uniqueStrings(Object.values(timeline.actors).map((actor) => actor.cortexEntityId ?? "").filter((id) => id && !byId.has(id)));
  await Promise.all(missingLinkedIds.map(async (entityId) => {
    try {
      const entity = await spindle.memories.entities.get(entityId, userId);
      if (entity) byId.set(entity.id, entity);
    } catch {
      unavailableLinkedIds.add(entityId);
    }
  }));
  const identities = [...byId.values()].filter((entity) => entity.entityType === "character").map((entity) => ({
    id: entity.id,
    name: entity.name,
    aliases: entity.aliases,
    confidence: entity.confidence === "confirmed" ? 1 : 0.65,
    confirmed: entity.confidence === "confirmed"
  }));
  for (const entityId of unavailableLinkedIds) {
    const actor = Object.values(timeline.actors).find((candidate) => candidate.cortexEntityId === entityId);
    if (actor) identities.push({
      id: entityId,
      name: actor.canonicalName,
      aliases: actor.aliases,
      confidence: actor.confidence,
      confirmed: actor.confirmed
    });
  }
  reconcileCortexIdentities(timeline, identities);
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
function cancelScheduledReconcile(userId, chatId) {
  const key = cacheKey(userId, chatId);
  const timer = reconcileTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  reconcileTimers.delete(key);
}
function cancelActiveAnalysis(userId, chatId) {
  analysisAbortControllers.get(cacheKey(userId, chatId))?.abort();
}
async function persistAndPublish(timeline, userId, announce = true) {
  timeline.revision += 1;
  timeline.updatedAt = Date.now();
  await saveTimeline(timeline, userId);
  await publishScene(userId, timeline);
  if (announce && activeChats.get(userId)?.chatId === timeline.chatId) await sendState(userId, timeline.chatId);
}
async function reconcileChat(userId, chatId, force = false) {
  const key = cacheKey(userId, chatId);
  if (force) rebuildRequests.delete(key);
  if (pauseRequests.has(key) || !force && rebuildRequests.has(key)) return;
  const timeline = await getTimeline(chatId, userId);
  await refreshCortexBridge(timeline, userId);
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
    timeline.records = timeline.records.filter((record) => record.skipReason === "pre_activation_history");
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
  if (pauseRequests.has(key) || !force && rebuildRequests.has(key)) return;
  const abortController = new AbortController();
  analysisAbortControllers.set(key, abortController);
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
        fallbackConnectionId: connectionByChat.get(cacheKey(userId, chatId)) ?? null,
        signal: abortController.signal
      });
      abortController.signal.throwIfAborted();
      const debugKey = cacheKey(userId, chatId);
      const debugResponses = controllerDebugResponses.get(debugKey) ?? [];
      debugResponses.push({
        batchId: result.telemetry.batchId,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        first: result.rawResponses.first,
        retry: result.rawResponses.retry
      });
      controllerDebugResponses.set(debugKey, debugResponses.slice(-10));
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
      timeline.lastAnalyzedAt = Date.now();
      derivation = rebuildTimeline(timeline, messages);
      timeline.health = derivation.firstMissingIndex < derivation.messages.length ? "pending" : "ready";
      timeline.error = null;
      await persistAndPublish(timeline, userId);
    }
  } catch (error) {
    if (isAbortError(error)) return;
    timeline.health = "error";
    timeline.error = error instanceof Error ? error.message : String(error);
    await persistAndPublish(timeline, userId);
    spindle.log.warn(`LumiMind analysis failed for ${chatId}: ${timeline.error}`);
  } finally {
    if (analysisAbortControllers.get(key) === abortController) analysisAbortControllers.delete(key);
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
async function activateChat(userId, chatId, historyMode = "full", recentMessageLimit = 0) {
  const timeline = await getTimeline(chatId, userId);
  timeline.active = true;
  timeline.paused = false;
  timeline.health = "initializing";
  timeline.error = null;
  await initializeHostActors(timeline, userId);
  if (historyMode === "recent" && recentMessageLimit > 0 && timeline.records.length === 0) {
    const messages = await getChatMessages(chatId, userId);
    const skipped = messages.slice(0, Math.max(0, messages.length - Math.floor(recentMessageLimit)));
    if (skipped.length > 0) {
      timeline.records.push(...materializeSkippedAnalysisRecords(timeline, skipped, "root", "pre_activation_history"));
      rebuildTimeline(timeline, messages);
    }
  }
  await persistAndPublish(timeline, userId);
  notice(userId, "info", historyMode === "recent" ? `LumiMind is analyzing the most recent ${Math.max(1, Math.floor(recentMessageLimit))} messages in the background.` : "LumiMind is building this timeline from the full committed history in the background.");
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
  timeline.suppressedCortexEntityIds = (timeline.suppressedCortexEntityIds ?? []).filter((id) => id !== entity.id);
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
    clearCortexBindings(serialized);
    await refreshCortexBridge(serialized, userId);
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
    const generationConnectionId = connectionId ?? connectionByChat.get(cacheKey(userId, chatId)) ?? null;
    const timeline = await getTimeline(chatId, userId);
    if (!timeline.active || timeline.paused) return messages;
    const settings = await getSettings(userId);
    const promptMessages = limitChatHistoryMessages(messages, settings.chatHistoryMessageLimit);
    const injectionContext = promptMessages.flatMap((message) => typeof message.content === "string" ? [{ content: message.content, name: typeof message.name === "string" ? message.name : void 0 }] : []);
    const countTokens = await tokenCounterForConnection(userId, generationConnectionId);
    let targetActorId = null;
    let injection = null;
    let projection = null;
    const generationType = extractGenerationType(context);
    if (generationType === "impersonate") {
      if (!settings.personaMindEnabled) return promptMessages;
      const personaId = extractPersonaId(context);
      if (personaId) targetActorId = (await ensurePersonaActor(timeline, personaId, userId)).id;
      if (targetActorId && timeline.actors[targetActorId]) {
        projection = await buildProjectedMindInjection(timeline, targetActorId, settings, injectionContext, countTokens);
        injection = projection.content;
      }
    } else if (settings.characterCardDirectorMode) {
      projection = await buildProjectedDirectorMindInjection(timeline, settings, injectionContext, countTokens);
      injection = projection.content;
    } else {
      const latest = latestGenerationByChat.get(cacheKey(userId, chatId));
      const characterId = latest?.characterId ?? extractCharacterId(context);
      if (characterId) targetActorId = `character:${characterId}`;
      if (!targetActorId || !timeline.actors[targetActorId]) {
        const chat = hasPermission("chats") ? await spindle.chats.get(chatId, userId).catch(() => null) : null;
        if (chat?.character_id) targetActorId = `character:${chat.character_id}`;
      }
      projection = await buildProjectedMindInjection(timeline, targetActorId, settings, injectionContext, countTokens);
      injection = projection.content;
    }
    if (projection) lastInjectionProjections.set(cacheKey(userId, chatId), projection.telemetry);
    if (!injection) return promptMessages;
    const injected = { role: "system", content: injection };
    const injectionIndex = mindInjectionIndex(promptMessages, settings.injectionPosition);
    const injectedMessages = [...promptMessages];
    injectedMessages.splice(injectionIndex, 0, injected);
    return {
      messages: injectedMessages,
      breakdown: [{ messageIndex: injectionIndex, name: "LumiMind \u2014 Private Mind" }]
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
for (const event of ["MESSAGE_EDITED", "MESSAGE_DELETED", "MESSAGE_SWIPED", "SWIPE_EDITED"]) {
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
for (const event of ["CORTEX_INGESTION_PROGRESS", "CORTEX_REBUILD_PROGRESS"]) {
  onEvent(event, (payload, eventUserId) => {
    const raw = asObject3(payload);
    if (raw.status !== "complete" && raw.phase !== "complete") return;
    const chatId = extractChatId(payload);
    const userId = resolveUserId(chatId, eventUserId);
    if (!chatId || !userId) return;
    rememberChatUser(chatId, userId);
    scheduleReconcile(userId, chatId, 100);
  });
}
onEvent("CHAT_DELETED", (payload, eventUserId) => {
  const chatId = extractChatId(payload) ?? readString(payload, ["id"]);
  const userId = resolveUserId(chatId, eventUserId);
  if (!chatId || !userId) return;
  cancelScheduledReconcile(userId, chatId);
  cancelActiveAnalysis(userId, chatId);
  pauseRequests.delete(cacheKey(userId, chatId));
  rebuildRequests.delete(cacheKey(userId, chatId));
  timelines.delete(storageTimelineKey(userId, chatId));
  controllerDebugResponses.delete(cacheKey(userId, chatId));
  lastInjectionProjections.delete(cacheKey(userId, chatId));
  void deleteTimeline(chatId, userId);
});
spindle.permissions.onChanged(() => {
  if (!lastFrontendUserId) return;
  void sendState(lastFrontendUserId);
  const chatId = activeChats.get(lastFrontendUserId)?.chatId;
  if (chatId) scheduleReconcile(lastFrontendUserId, chatId, 0);
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
    if (timeline?.active) scheduleReconcile(userId, timeline.chatId, 0);
    return;
  }
  try {
    if (message.type === "developer_report") {
      const report = await buildDeveloperDiagnostics(userId, message.chatId);
      send({ type: "developer_report", requestId: message.requestId, report }, userId);
      return;
    }
    if (message.type === "export_database") {
      const timeline = await getTimeline(message.chatId, userId);
      send({ type: "database_export", requestId: message.requestId, archive: makeDatabaseArchive(timeline) }, userId);
      return;
    }
    if (message.type === "import_database") {
      cancelScheduledReconcile(userId, message.chatId);
      cancelActiveAnalysis(userId, message.chatId);
      await enqueue(userId, message.chatId, async () => {
        const source = timelineFromDatabaseArchive(message.archive);
        const targetMessages = hasPermission("chat_mutation") ? await getChatMessages(message.chatId, userId).catch(() => []) : [];
        const imported = message.mode === "full" ? remapImportedTimeline(source, message.chatId, targetMessages) : createCheckpointTimeline(source, message.chatId);
        await refreshCortexBridge(imported, userId);
        imported.analysisPolicyHash = analysisPolicyHash(await getSettings(userId));
        pauseRequests.delete(cacheKey(userId, message.chatId));
        rebuildRequests.delete(cacheKey(userId, message.chatId));
        lastInjectionProjections.delete(cacheKey(userId, message.chatId));
        timelines.set(storageTimelineKey(userId, message.chatId), imported);
        await persistAndPublish(imported, userId);
      });
      notice(userId, "success", message.mode === "full" ? "LumiMind database restored and matched to this chat's transcript." : "LumiMind checkpoint imported. This chat will continue from the exported folded state.");
      return;
    }
    if (message.type === "activation_preview") {
      try {
        const messages = await getChatMessages(message.chatId, userId);
        send({ type: "activation_preview", requestId: message.requestId, chatId: message.chatId, messageCount: messages.length }, userId);
      } catch (error) {
        send({
          type: "activation_preview_error",
          requestId: message.requestId,
          chatId: message.chatId,
          message: error instanceof Error ? error.message : "LumiMind could not inspect this chat's history."
        }, userId);
      }
      return;
    }
    if (message.type === "activate") {
      await enqueue(userId, message.chatId, () => activateChat(
        userId,
        message.chatId,
        message.historyMode ?? "full",
        message.recentMessageLimit ?? 0
      ));
      return;
    }
    if (message.type === "pause") {
      const key = cacheKey(userId, message.chatId);
      if (message.paused) {
        pauseRequests.add(key);
        cancelScheduledReconcile(userId, message.chatId);
        cancelActiveAnalysis(userId, message.chatId);
      } else {
        pauseRequests.delete(key);
      }
      await mutateTimeline(userId, message.chatId, (timeline) => {
        timeline.paused = message.paused;
        timeline.health = message.paused ? "paused" : "pending";
      });
      if (!message.paused) scheduleReconcile(userId, message.chatId, 0);
      return;
    }
    if (message.type === "rebuild") {
      rebuildRequests.add(cacheKey(userId, message.chatId));
      cancelScheduledReconcile(userId, message.chatId);
      cancelActiveAnalysis(userId, message.chatId);
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
      const cortexImportChanged = previous.cortexImportEnabled !== next.cortexImportEnabled;
      await publishScene(userId);
      await sendState(userId, message.chatId);
      if (roleplayModeChanged && message.chatId) {
        const timeline = await getTimeline(message.chatId, userId);
        if (timeline.active) scheduleReconcile(userId, message.chatId, 0);
      }
      if (cortexImportChanged && next.cortexImportEnabled && message.chatId) {
        scheduleReconcile(userId, message.chatId, 0);
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
        actor.suppressedAliases = (actor.suppressedAliases ?? []).filter((alias) => alias.toLocaleLowerCase() !== message.alias.trim().toLocaleLowerCase());
        actor.aliases = uniqueStrings([...actor.aliases, message.alias]);
        actor.updatedAt = Date.now();
      } else if (message.type === "remove_alias") {
        const actor = timeline.actors[message.actorId];
        if (!actor) throw new Error("Actor not found.");
        const removed = message.alias.trim();
        if (!removed) throw new Error("Alias is empty.");
        actor.suppressedAliases = uniqueStrings([...actor.suppressedAliases ?? [], removed]);
        actor.aliases = actor.aliases.filter((alias) => alias.toLocaleLowerCase() !== removed.toLocaleLowerCase());
        actor.updatedAt = Date.now();
      } else if (message.type === "confirm_actor") {
        if (!confirmActor(timeline, message.actorId)) throw new Error("Actor not found.");
      } else if (message.type === "writeback_actor") {
        const actor = timeline.actors[message.actorId];
        if (!actor) throw new Error("Actor not found.");
        await writeActorToCortex(userId, timeline, actor);
      } else if (message.type === "remove_actor") {
        if (!removeActor(timeline, message.actorId)) throw new Error("Actor not found.");
      } else if (message.type === "merge_actor") {
        if (!mergeActors(timeline, message.sourceActorId, message.targetActorId, message.cortexLink)) {
          throw new Error("Could not merge those actors. Choose which Cortex identity to keep when both actors are linked.");
        }
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
    if (message.type === "developer_report") {
      send({ type: "developer_report_error", requestId: message.requestId, message: detail }, userId);
      return;
    }
    send({ type: "error", message: detail }, userId);
    spindle.log.warn(`LumiMind frontend action failed: ${detail}`);
  }
});
spindle.log.info("LumiMind v0.1.1 loaded \u2014 subjective timeline engine ready.");
