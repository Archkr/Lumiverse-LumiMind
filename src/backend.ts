declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

import type { CharacterDTO, PersonaDTO } from "lumiverse-spindle-types";
import { analyzeMessages, generateSeedDraft } from "./controller";
import {
  DEFAULT_SETTINGS,
  addManualItem,
  analysisPolicyHash,
  buildDirectorMindInjection,
  buildMindInjection,
  compactStateForController,
  createTimeline,
  makeBaseMind,
  makeEmptySeed,
  makePrivateSnapshot,
  makePublicSnapshot,
  materializeAnalysisRecords,
  materializeSkippedAnalysisRecords,
  mergeActors,
  normalizeSeed,
  overrideItem,
  rebuildTimeline,
  removeActor,
  removeManualItem,
  resolveActorId,
  splitActor,
  selectAnalysisRecentContext,
  selectAnalysisWorkBatch,
  sortMessages,
  toTimelineView,
  uniqueStrings,
  upsertActor,
} from "./engine";
import { deleteTimeline, loadSettings, loadTimeline, saveSettings, saveTimeline } from "./storage";
import { makeMindLumiStateSnapshot } from "./lumi-state";
import {
  EXTENSION_KEY,
  type ActorRecord,
  type BackendToFrontend,
  type ChatMessageLike,
  type ChatTimelineV1,
  type ConnectionOption,
  type FrontendState,
  type FrontendToBackend,
  type LumiMindSettings,
  type MindSeedV1,
  type PermissionState,
} from "./types";

const INTERCEPTOR_PRIORITY = 125;
const ANALYSIS_BATCH_SIZE = 6;
const MAX_RECORDS = 5000;
const RECONCILE_DEBOUNCE_MS = 650;
const EXTENSION_VERSION = "0.1.1";

type GenerationContext = {
  generationId: string;
  chatId: string;
  characterId: string | null;
  characterName: string | null;
  generationType: string;
  userId: string;
};

const timelines = new Map<string, ChatTimelineV1>();
const settingsCache = new Map<string, LumiMindSettings>();
const activeChats = new Map<string, { chatId: string | null; characterId: string | null }>();
const chatUsers = new Map<string, string>();
const operations = new Map<string, Promise<void>>();
const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();
const generationContexts = new Map<string, GenerationContext>();
const latestGenerationByChat = new Map<string, GenerationContext>();
const connectionByChat = new Map<string, string>();
let lastFrontendUserId: string | null = null;

function cacheKey(userId: string, chatId: string): string {
  return `${userId}:${chatId}`;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, keys: string[]): string | null {
  const raw = asObject(value);
  for (const key of keys) {
    const candidate = raw[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function extractChatId(value: unknown): string | null {
  return readString(value, ["chatId", "chat_id"]);
}

function extractCharacterId(value: unknown): string | null {
  return readString(value, ["characterId", "character_id", "targetCharacterId", "target_character_id"]);
}

function extractPersonaId(value: unknown): string | null {
  return readString(value, ["personaId", "persona_id"]);
}

function extractGenerationType(value: unknown): string {
  return readString(value, ["generationType", "generation_type"]) ?? "normal";
}

function rememberChatUser(chatId: string | null | undefined, userId: string | null | undefined): void {
  if (chatId && userId) chatUsers.set(chatId, userId);
}

function resolveUserId(chatId?: string | null, eventUserId?: string | null): string | null {
  return eventUserId || (chatId ? chatUsers.get(chatId) : null) || lastFrontendUserId;
}

function storageTimelineKey(userId: string, chatId: string): string {
  return cacheKey(userId, chatId);
}

async function getSettings(userId: string): Promise<LumiMindSettings> {
  const cached = settingsCache.get(userId);
  if (cached) return cached;
  const loaded = await loadSettings(userId);
  settingsCache.set(userId, loaded);
  return loaded;
}

async function getTimeline(chatId: string, userId: string): Promise<ChatTimelineV1> {
  const key = storageTimelineKey(userId, chatId);
  const cached = timelines.get(key);
  if (cached) return cached;
  const loaded = await loadTimeline(chatId, userId);
  timelines.set(key, loaded);
  return loaded;
}

function send(message: BackendToFrontend, userId: string): void {
  (spindle.sendToFrontend as unknown as (payload: unknown, targetUserId?: string) => void)(message, userId);
}

function notice(userId: string, tone: "info" | "success" | "warning" | "error", message: string): void {
  send({ type: "notice", tone, message }, userId);
}

function hasPermission(id: string): boolean {
  try {
    return spindle.permissions.has(id as never);
  } catch {
    return false;
  }
}

function currentPermissions(): PermissionState {
  return {
    generation: hasPermission("generation"),
    interceptor: hasPermission("interceptor"),
    chats: hasPermission("chats"),
    chatMutation: hasPermission("chat_mutation"),
    characters: hasPermission("characters"),
    personas: hasPermission("personas"),
    memories: hasPermission("memories"),
  };
}

async function listConnections(userId: string): Promise<ConnectionOption[]> {
  if (!hasPermission("generation")) return [];
  const connections = await spindle.connections.list(userId).catch(() => []);
  return connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    model: connection.model,
    isDefault: connection.is_default,
    hasApiKey: connection.has_api_key,
  }));
}

async function buildFrontendState(userId: string, requestedChatId?: string | null, characterId?: string | null): Promise<FrontendState> {
  const active = activeChats.get(userId) ?? { chatId: null, characterId: null };
  const chatId = requestedChatId === undefined ? active.chatId : requestedChatId;
  if (requestedChatId !== undefined || characterId !== undefined) {
    activeChats.set(userId, { chatId: chatId ?? null, characterId: characterId ?? active.characterId });
  }
  const [settings, connections, timeline] = await Promise.all([
    getSettings(userId),
    listConnections(userId),
    chatId ? getTimeline(chatId, userId) : Promise.resolve(null),
  ]);
  return {
    settings,
    permissions: currentPermissions(),
    connections,
    activeChatId: chatId ?? null,
    activeCharacterId: characterId ?? active.characterId,
    timeline: timeline ? toTimelineView(timeline, settings) : null,
  };
}

async function sendState(userId: string, chatId?: string | null, characterId?: string | null): Promise<void> {
  send({ type: "state", state: await buildFrontendState(userId, chatId, characterId) }, userId);
}

function normalizeChatMessages(value: unknown): ChatMessageLike[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const raw = asObject(entry);
    const id = readString(raw, ["id"]);
    const content = typeof raw.content === "string" ? raw.content : "";
    if (!id) return [];
    const role = raw.role === "user" || raw.role === "assistant" || raw.role === "system"
      ? raw.role
      : raw.is_user === true
        ? "user"
        : "assistant";
    return [{
      id,
      role,
      content,
      name: typeof raw.name === "string" ? raw.name : undefined,
      extra: asObject(raw.extra),
      metadata: asObject(raw.metadata),
      swipe_id: typeof raw.swipe_id === "number" ? raw.swipe_id : 0,
      swipes: Array.isArray(raw.swipes) ? raw.swipes.filter((item): item is string => typeof item === "string") : [content],
      index_in_chat: typeof raw.index_in_chat === "number" ? raw.index_in_chat : index,
      created_at: typeof raw.created_at === "number" ? raw.created_at : undefined,
    } satisfies ChatMessageLike];
  });
}

async function getChatMessages(chatId: string, userId: string): Promise<ChatMessageLike[]> {
  const api = (spindle as unknown as { chat: { getMessages(chatId: string, userId?: string): Promise<unknown> } }).chat;
  return sortMessages(normalizeChatMessages(await api.getMessages(chatId, userId)));
}

function seedFromCharacter(character: CharacterDTO): MindSeedV1 {
  const extension = asObject(character.extensions?.[EXTENSION_KEY]);
  const seedContainer = asObject(extension.seed);
  const stored = normalizeSeed(seedContainer.v1 ?? extension.seed);
  if (stored) return stored;
  const seed = makeEmptySeed({
    selfConcept: character.description.trim(),
    notes: uniqueStrings([character.personality, character.creator_notes].filter(Boolean)),
  });
  seed.startingBeliefs = [];
  seed.startingGoals = [];
  return seed;
}

function seedFromPersona(persona: PersonaDTO): MindSeedV1 {
  return makeEmptySeed({
    selfConcept: persona.description.trim(),
    notes: uniqueStrings([persona.title].filter(Boolean)),
  });
}

async function initializeHostActors(timeline: ChatTimelineV1, userId: string): Promise<void> {
  const permissions = currentPermissions();
  const chat = permissions.chats ? await spindle.chats.get(timeline.chatId, userId).catch(() => null) : null;
  if (chat && permissions.characters) {
    const metadata = asObject(chat.metadata);
    const groupIds = Array.isArray(metadata.character_ids)
      ? metadata.character_ids.filter((id): id is string => typeof id === "string")
      : [];
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
        confirmed: true,
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
        confirmed: true,
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
        confirmed: entity.confidence === "confirmed",
      });
    }
  }
  rebuildTimeline(timeline, []);
}

async function ensurePersonaActor(timeline: ChatTimelineV1, personaId: string, userId: string): Promise<ActorRecord> {
  const existing = timeline.actors[`persona:${personaId}`];
  if (existing) return existing;
  const persona = hasPermission("personas") ? await spindle.personas.get(personaId, userId).catch(() => null) : null;
  const actor = upsertActor(timeline, {
    id: `persona:${personaId}`,
    kind: "persona",
    name: persona?.name ?? "User persona",
    personaId,
    confidence: 1,
    confirmed: true,
  });
  timeline.baseMinds[actor.id] = makeBaseMind(actor.id, persona ? seedFromPersona(persona) : null);
  return actor;
}

function enqueue(userId: string, chatId: string, task: () => Promise<void>): Promise<void> {
  const key = cacheKey(userId, chatId);
  const previous = operations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  operations.set(key, next);
  void next.finally(() => {
    if (operations.get(key) === next) operations.delete(key);
  });
  return next;
}

async function persistAndPublish(timeline: ChatTimelineV1, userId: string, announce = true): Promise<void> {
  timeline.revision += 1;
  timeline.updatedAt = Date.now();
  await saveTimeline(timeline, userId);
  await publishScene(userId, timeline);
  if (announce && activeChats.get(userId)?.chatId === timeline.chatId) await sendState(userId, timeline.chatId);
}

async function reconcileChat(userId: string, chatId: string, force = false): Promise<void> {
  const timeline = await getTimeline(chatId, userId);
  const settings = await getSettings(userId);
  const policyHash = analysisPolicyHash(settings);
  const policyChanged = timeline.analysisPolicyHash !== policyHash;
  if (!timeline.active || timeline.paused) {
    const messages = hasPermission("chat_mutation") ? await getChatMessages(chatId, userId).catch(() => []) : [];
    rebuildTimeline(timeline, messages);
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
  const commitSkippedWork = (batch: ReturnType<typeof selectAnalysisWorkBatch>): boolean => {
    if (!batch.skipReason || batch.messages.length === 0) return false;
    timeline.records.push(...materializeSkippedAnalysisRecords(
      timeline,
      batch.messages,
      derivation.nextPrefix,
      batch.skipReason,
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
      settings,
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
        settings.analysisContextMessageLimit,
      );
      const result = await analyzeMessages({
        messages: batch,
        recentContext,
        compactState: compactStateForController(timeline, settings),
        settings,
        userId,
        fallbackConnectionId: connectionByChat.get(cacheKey(userId, chatId)) ?? null,
      });
      const records = materializeAnalysisRecords(
        timeline,
        batch,
        derivation.nextPrefix,
        result.analysis,
        { ...result.meta, telemetry: result.telemetry },
      );
      timeline.records.push(...records);
      if (result.telemetry.warningCodes.length) {
        spindle.log.warn(
          `LumiMind analysis quality warning for ${chatId} batch ${result.telemetry.batchId}: ${result.telemetry.warningCodes.join(", ")} ` +
          `(attempts=${result.telemetry.attempts}, acceptedMentions=${result.telemetry.finalActorMentions}, acceptedChanges=${result.telemetry.finalChanges}).`,
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

function scheduleReconcile(userId: string, chatId: string, delay = RECONCILE_DEBOUNCE_MS): void {
  const key = cacheKey(userId, chatId);
  const existing = reconcileTimers.get(key);
  if (existing) clearTimeout(existing);
  reconcileTimers.set(key, setTimeout(() => {
    reconcileTimers.delete(key);
    void enqueue(userId, chatId, () => reconcileChat(userId, chatId));
  }, delay));
}

async function activateChat(userId: string, chatId: string): Promise<void> {
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

async function writeActorToCortex(userId: string, timeline: ChatTimelineV1, actor: ActorRecord): Promise<void> {
  const settings = await getSettings(userId);
  if (!settings.cortexWritebackEnabled) throw new Error("Enable Cortex writeback in LumiMind settings first.");
  if (!hasPermission("memories")) throw new Error("Memory Cortex permission is not granted.");
  if (!actor.confirmed) throw new Error("Confirm this actor before writing it to Memory Cortex.");
  const entity = await spindle.memories.entities.upsert(
    timeline.chatId,
    { name: actor.canonicalName, type: "character", aliases: actor.aliases, confidence: 1, provisional: false },
    { userId },
  );
  actor.cortexEntityId = entity.id;
  actor.updatedAt = Date.now();
}

async function publishScene(userId: string, timeline?: ChatTimelineV1 | null): Promise<void> {
  const activeChatId = activeChats.get(userId)?.chatId ?? null;
  const resolved = timeline?.chatId === activeChatId ? timeline : activeChatId ? await getTimeline(activeChatId, userId).catch(() => null) : null;
  const settings = await getSettings(userId);
  spindle.rpcPool.sync("scene.current", makePublicSnapshot(resolved, settings), { requires: [] });
  spindle.rpcPool.sync("state.current", makeMindLumiStateSnapshot(resolved, settings, EXTENSION_VERSION), { requires: [] });
  if (settings.privateInteropEnabled) {
    spindle.rpcPool.sync("scene.private", makePrivateSnapshot(resolved, settings), { requires: ["chat_mutation"] });
  } else {
    try { spindle.rpcPool.unregister("scene.private"); } catch { /* It may not be registered yet. */ }
  }
}

function bumpAndRebuild(timeline: ChatTimelineV1): void {
  timeline.error = null;
  const messages = [] as ChatMessageLike[];
  // Manual overrides are applied by the real rebuild before persistence; this
  // local pass keeps empty/new timelines coherent until history is fetched.
  if (!timeline.records.length) rebuildTimeline(timeline, messages);
}

async function mutateTimeline(
  userId: string,
  chatId: string,
  mutate: (timeline: ChatTimelineV1) => void | Promise<void>,
): Promise<void> {
  await enqueue(userId, chatId, async () => {
    const timeline = await getTimeline(chatId, userId);
    await mutate(timeline);
    const messages = hasPermission("chat_mutation") ? await getChatMessages(chatId, userId).catch(() => []) : [];
    rebuildTimeline(timeline, messages);
    await persistAndPublish(timeline, userId);
  });
}

async function cloneFork(payload: unknown, eventUserId?: string): Promise<void> {
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
      getChatMessages(forkedChatId, userId),
    ]);
    const sourceIndexById = new Map(sourceMessages.map((message) => [message.id, message.index_in_chat ?? 0]));
    const forkByIndex = new Map(forkMessages.map((message) => [message.index_in_chat ?? 0, message]));
    const serialized = JSON.parse(JSON.stringify(source)) as ChatTimelineV1;
    serialized.chatId = forkedChatId;
    serialized.records = serialized.records.flatMap((record) => {
      const index = sourceIndexById.get(record.messageId) ?? record.messageIndex;
      const target = forkByIndex.get(index);
      if (!target) return [];
      const next = JSON.parse(JSON.stringify(record)) as typeof record;
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
    state: "lumi_mind.state.current",
  },
  channels: [{
    endpoint: "lumi_mind.state.current",
    schema: "lumi_state.snapshot.v1",
    visibility: "public",
    requires: [],
    mode: "sync",
  }],
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
    let targetActorId: string | null = null;
    let injection: string | null = null;
    const generationType = extractGenerationType(context);
    if (generationType === "impersonate") {
      if (!settings.personaMindEnabled) return messages;
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
    if (!injection) return messages;
    const injected = { role: "system" as const, content: injection };
    return {
      messages: [injected, ...messages],
      breakdown: [{ messageIndex: 0, name: "LumiMind — Private Mind" }],
    };
  } catch (error) {
    spindle.log.warn(`LumiMind interceptor degraded safely: ${error instanceof Error ? error.message : String(error)}`);
    return messages;
  }
}, INTERCEPTOR_PRIORITY);

const onEvent = spindle.on as unknown as (event: string, handler: (payload: unknown, userId?: string) => void) => () => void;

onEvent("GENERATION_STARTED", (payload, eventUserId) => {
  const chatId = extractChatId(payload);
  const userId = resolveUserId(chatId, eventUserId);
  const generationId = readString(payload, ["generationId", "generation_id"]);
  if (!chatId || !userId || !generationId) return;
  rememberChatUser(chatId, userId);
  const context: GenerationContext = {
    generationId,
    chatId,
    characterId: extractCharacterId(payload),
    characterName: readString(payload, ["characterName", "character_name"]),
    generationType: extractGenerationType(payload),
    userId,
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

for (const event of ["MESSAGE_SENT", "MESSAGE_EDITED", "MESSAGE_DELETED", "MESSAGE_SWIPED", "SWIPE_EDITED"] as const) {
  onEvent(event, (payload, eventUserId) => {
    const chatId = extractChatId(payload) ?? extractChatId(asObject(payload).message);
    const userId = resolveUserId(chatId, eventUserId);
    if (!chatId || !userId) return;
    rememberChatUser(chatId, userId);
    scheduleReconcile(userId, chatId);
  });
}

onEvent("CHAT_FORKED", (payload, eventUserId) => { void cloneFork(payload, eventUserId); });

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
  const message = payload as FrontendToBackend;
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
      const roleplayModeChanged = previous.personaMindEnabled !== next.personaMindEnabled
        || previous.characterCardDirectorMode !== next.characterCardDirectorMode;
      await publishScene(userId);
      await sendState(userId, message.chatId);
      if (roleplayModeChanged && message.chatId) {
        const timeline = await getTimeline(message.chatId, userId);
        if (timeline.active) scheduleReconcile(userId, message.chatId, 0);
      }
      notice(userId, "success", roleplayModeChanged
        ? "LumiMind settings saved. Activated timelines will rebuild for the new roleplay mode when opened."
        : "LumiMind settings saved.");
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
          notes: uniqueStrings(message.core.notes),
        };
      } else if (message.type === "edit_item") {
        if (!message.text.trim()) throw new Error("Mind item text cannot be empty.");
        if (!overrideItem(timeline, message.actorId, message.itemId, (item) => ({
          ...item,
          text: message.text.trim(),
          status: message.status ?? item.status,
          locked: true,
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

spindle.log.info("LumiMind v0.1.1 loaded — subjective timeline engine ready.");
