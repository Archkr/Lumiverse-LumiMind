declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

import { makeEmptySeed, normalizeSeed, stableHash, uniqueStrings } from "./engine";
import type {
  ChatMessageLike,
  ControllerBatchTelemetry,
  ControllerActorMention,
  ControllerAnalysis,
  ControllerChange,
  ControllerResponseTelemetry,
  ControllerWarningCode,
  LumiMindSettings,
  MindCategory,
  MindOperation,
  MindSeedV1,
} from "./types";

const THINK_BLOCK_RE = /<think[\s\S]*?<\/think>/gi;

export interface ControllerMeta {
  connectionId: string | null;
  provider: string | null;
  model: string | null;
}

export interface AnalysisControllerResult {
  analysis: ControllerAnalysis;
  meta: ControllerMeta;
  raw: string;
  telemetry: ControllerBatchTelemetry;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.filter((entry): entry is string => typeof entry === "string")) : [];
}

export function sanitizeControllerText(value: string): string {
  return value
    .replace(THINK_BLOCK_RE, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export function parseJsonValue(content: string): unknown {
  const cleaned = sanitizeControllerText(content);
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try {
      return JSON.parse(objectMatch[0]) as unknown;
    } catch {
      return null;
    }
  }
}

function category(value: unknown): MindCategory {
  return value === "secret" || value === "goal" || value === "plan" || value === "emotion" || value === "relationship" || value === "awareness"
    ? value
    : "belief";
}

function operation(value: unknown): MindOperation {
  return value === "update" || value === "resolve" || value === "abandon" || value === "remove" ? value : "add";
}

export function normalizeControllerAnalysis(value: unknown): ControllerAnalysis {
  const raw = asObject(value);
  const actorMentions: ControllerActorMention[] = Array.isArray(raw.actorMentions)
    ? raw.actorMentions.flatMap((entry) => {
        const item = asObject(entry);
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
          messageId,
        }];
      })
    : [];
  const changes: ControllerChange[] = Array.isArray(raw.changes)
    ? raw.changes.flatMap((entry) => {
        const item = asObject(entry);
        const subjectRef = text(item.subjectRef);
        const messageId = text(item.messageId);
        if (!subjectRef || !messageId) return [];
        const dimensions: Record<string, number> = {};
        for (const [key, value] of Object.entries(asObject(item.dimensions))) {
          dimensions[key] = Math.min(1, Math.max(-1, numberValue(value, 0)));
        }
        return [{
          subjectRef,
          category: category(item.category),
          operation: operation(item.operation),
          targetItemId: text(item.targetItemId) || null,
          text: text(item.text),
          status: item.status === "resolved" || item.status === "abandoned" || item.status === "uncertain" ? item.status : "active",
          confidence: Math.min(1, Math.max(0, numberValue(item.confidence, 0.75))),
          targetRefs: stringArray(item.targetRefs),
          concealedFromRefs: stringArray(item.concealedFromRefs),
          intensity: item.intensity === null || item.intensity === undefined ? null : Math.min(1, Math.max(0, numberValue(item.intensity, 0.5))),
          dimensions,
          messageId,
          evidenceExcerpt: text(item.evidenceExcerpt),
        }];
      })
    : [];
  return { actorMentions, changes };
}

function policyReference(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

export function applyControllerMindPolicy(
  analysis: ControllerAnalysis,
  compactState: unknown,
  settings: LumiMindSettings,
): ControllerAnalysis {
  const excluded = new Set<string>();
  for (const entry of Array.isArray(compactState) ? compactState : []) {
    const actor = asObject(entry);
    if (actor.managed !== false) continue;
    for (const value of [actor.ref, actor.name, ...(Array.isArray(actor.aliases) ? actor.aliases : [])]) {
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

  const actorMentions = analysis.actorMentions.flatMap((mention) => {
    const keys = [mention.ref, mention.name, ...(mention.aliases ?? [])].map(policyReference).filter(Boolean);
    if (keys.some((key) => excluded.has(key)) || (!settings.personaMindEnabled && mention.kind === "persona")) {
      for (const key of keys) excluded.add(key);
      return [];
    }
    if (settings.characterCardDirectorMode && mention.kind === "character") {
      return [{ ...mention, kind: "npc" as const }];
    }
    return [mention];
  });
  const changes = analysis.changes.filter((change) => !excluded.has(policyReference(change.subjectRef)));
  return { actorMentions, changes };
}

export function isNontrivialAnalysisBatch(messages: ChatMessageLike[]): boolean {
  const lengths = messages.map((message) => message.content.replace(/\s+/g, " ").trim().length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return total >= 400 || lengths.some((length) => length >= 280) || (messages.length >= 2 && total >= 240);
}

export function makeControllerResponseTelemetry(
  raw: string,
  parsed: unknown,
  accepted: ControllerAnalysis,
): ControllerResponseTelemetry {
  const object = asObject(parsed);
  return {
    responseChars: raw.length,
    responseHash: stableHash(raw),
    rawActorMentions: Array.isArray(object.actorMentions) ? object.actorMentions.length : 0,
    rawChanges: Array.isArray(object.changes) ? object.changes.length : 0,
    acceptedActorMentions: accepted.actorMentions.length,
    acceptedChanges: accepted.changes.length,
  };
}

export function mergeControllerAnalyses(first: ControllerAnalysis, corrective: ControllerAnalysis): ControllerAnalysis {
  const mentions = new Map<string, ControllerActorMention>();
  for (const mention of [...first.actorMentions, ...corrective.actorMentions]) {
    const key = `${mention.messageId}|${mention.ref || mention.name}`.toLocaleLowerCase();
    mentions.set(key, mention);
  }
  return {
    actorMentions: [...mentions.values()],
    changes: corrective.changes.length ? corrective.changes : first.changes,
  };
}

const ANALYSIS_SCHEMA: Record<string, unknown> = {
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
          messageId: { type: "string" },
        },
        required: ["ref", "name", "aliases", "kind", "confidence", "present", "messageId"],
      },
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
            additionalProperties: { type: "number", minimum: -1, maximum: 1 },
          },
          messageId: { type: "string" },
          evidenceExcerpt: { type: "string" },
        },
        required: [
          "subjectRef", "category", "operation", "targetItemId", "text", "status", "confidence",
          "targetRefs", "concealedFromRefs", "intensity", "dimensions", "messageId", "evidenceExcerpt"
        ],
      },
    },
  },
  required: ["actorMentions", "changes"],
};

const SEED_SCHEMA: Record<string, unknown> = {
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
        notes: { type: "array", items: { type: "string" } },
      },
      required: ["selfConcept", "values", "desires", "fears", "boundaries", "notes"],
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
        required: ["target", "stance"],
      },
    },
    updatedAt: { type: "number" },
  },
  required: ["schemaVersion", "core", "startingBeliefs", "startingSecrets", "startingGoals", "relationshipPriors", "updatedAt"],
};

function structuredParameters(provider: string | null, schemaName: string, schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = provider?.trim().toLocaleLowerCase() ?? "";
  if (normalized === "google" || normalized === "gemini" || normalized === "google_vertex") {
    return { responseMimeType: "application/json", responseSchema: schema };
  }
  if (normalized === "openai" || normalized === "openrouter") {
    return { response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } } };
  }
  return {};
}

function noReasoningParameters(provider: string | null): Record<string, unknown> {
  const normalized = provider?.trim().toLocaleLowerCase() ?? "";
  if (normalized === "google" || normalized === "gemini" || normalized === "google_vertex") {
    return { thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false } };
  }
  if (normalized === "nanogpt") return { reasoning_effort: "none" };
  return { reasoning: { effort: "none" } };
}

async function resolveConnection(settings: LumiMindSettings, userId: string, fallbackConnectionId?: string | null): Promise<{
  id: string | null;
  provider: string | null;
  model: string | null;
}> {
  const id = settings.controllerConnectionId?.trim() || fallbackConnectionId?.trim() || null;
  if (!id) return { id: null, provider: null, model: null };
  const connection = await spindle.connections.get(id, userId).catch(() => null);
  return { id, provider: connection?.provider ?? null, model: connection?.model ?? null };
}

async function quietJson(
  prompt: string,
  systemPrompt: string,
  schemaName: string,
  schema: Record<string, unknown>,
  settings: LumiMindSettings,
  userId: string,
  fallbackConnectionId?: string | null,
): Promise<{ parsed: unknown; raw: string; meta: ControllerMeta }> {
  const connection = await resolveConnection(settings, userId, fallbackConnectionId);
  const result = await spindle.generate.quiet({
    type: "quiet",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    parameters: {
      temperature: settings.controllerTemperature,
      max_tokens: settings.controllerMaxTokens,
      ...noReasoningParameters(connection.provider),
      ...structuredParameters(connection.provider, schemaName, schema),
    },
    ...(connection.id ? { connection_id: connection.id } : {}),
    userId,
  } as unknown as Parameters<typeof spindle.generate.quiet>[0]);
  const object = asObject(result);
  const content = sanitizeControllerText(text(object.content));
  const reasoning = sanitizeControllerText(text(object.reasoning));
  const raw = content || reasoning;
  return {
    parsed: parseJsonValue(raw),
    raw,
    meta: { connectionId: connection.id, provider: connection.provider, model: connection.model },
  };
}

function renderMessages(messages: ChatMessageLike[]): string {
  return messages.map((message) => {
    const name = message.name?.trim() || message.role;
    return `<message id="${message.id}" index="${message.index_in_chat ?? 0}" role="${message.role}" speaker="${name}">\n${message.content}\n</message>`;
  }).join("\n");
}

const ANALYSIS_SYSTEM_PROMPT = [
  "You are LumiMind's evidence-bound subjective-state analyst for an interactive roleplay transcript.",
  "Return JSON only. Analyze every supplied message and identify every named actor with narrative agency that the roleplay-mode instructions permit LumiMind to manage.",
  "Infer emotions, motives, goals, plans, relationships, and beliefs only when directly stated or strongly supported by subtext.",
  "Never invent objective events. Beliefs may be false or uncertain and must remain subjective.",
  "Treat a secret as information the subject knows and is deliberately concealing; concealedFromRefs names who it is hidden from.",
  "Use existing item IDs in targetItemId when updating, resolving, abandoning, or removing state. Do not modify locked entries.",
  "Bootstrap rule: when an actor has no active subjective-state entries, treat the supplied scene as initialization and add every clearly evidence-supported starting emotion, goal, awareness, relationship stance, plan, or belief.",
  "An entry is an add relative to mind_state even when the evidence describes a state already underway at the beginning of the transcript.",
  "A substantive scene with character choices, reactions, attention, dialogue, or strong subtext should not return an empty changes array merely because mind_state started empty.",
  "Include actorMentions for the actors actually present in the scene after each message, not merely referenced.",
  "Every actor mention and change must cite one supplied messageId and a short evidenceExcerpt.",
].join("\n");

function analysisSystemPrompt(settings: LumiMindSettings, corrective = false): string {
  const mode = settings.characterCardDirectorMode
    ? "Director-card mode: host character-card entries marked managed=false are narrators/directors, not in-world actors. Never emit a mind or presence mention for those cards. Treat each named individual the card portrays as an independent NPC, even when several speak inside one assistant message."
    : "Actor-card mode: host character cards are in-world actors and may receive their own subjective minds.";
  const persona = settings.personaMindEnabled
    ? "Persona minds are enabled: the active user persona may receive evidence-supported subjective state and may be targeted during impersonation."
    : "Persona minds are disabled: the user persona is context only. Never emit actorMentions or changes with the user/persona as subject, and never infer actions, goals, emotions, or beliefs for them. Other managed actors may still hold beliefs or relationships about the user.";
  const correction = corrective
    ? [
      "This is a single corrective pass because the first pass accepted no mental-state changes from a substantive batch.",
      "Re-read analysis_batch actor by actor. Extract the smallest defensible bootstrap state supported by the text, especially viewpoint emotion, immediate goal, attention/awareness, relationship stance, and any clearly held belief.",
      "Do not manufacture facts or force every category. An empty changes array is valid only when the batch truly contains no evidence of any managed actor's subjective state.",
    ].join("\n")
    : "";
  return [ANALYSIS_SYSTEM_PROMPT, mode, persona, correction].filter(Boolean).join("\n");
}

export async function analyzeMessages(input: {
  messages: ChatMessageLike[];
  recentContext: ChatMessageLike[];
  compactState: unknown;
  settings: LumiMindSettings;
  userId: string;
  fallbackConnectionId?: string | null;
}): Promise<AnalysisControllerResult> {
  const prompt = [
    "Existing actor registry and current subjective state:",
    `<mind_state>\n${JSON.stringify(input.compactState)}\n</mind_state>`,
    "Recent transcript context (context only; do not emit changes for these messages):",
    `<recent_context>\n${renderMessages(input.recentContext)}\n</recent_context>`,
    "Messages to analyze:",
    `<analysis_batch>\n${renderMessages(input.messages)}\n</analysis_batch>`,
    "Return {\"actorMentions\": [...], \"changes\": [...]} now.",
  ].join("\n\n").slice(0, 120_000);
  const result = await quietJson(
    prompt,
    analysisSystemPrompt(input.settings),
    "lumi_mind_analysis_v1",
    ANALYSIS_SCHEMA,
    input.settings,
    input.userId,
    input.fallbackConnectionId,
  );
  if (!result.parsed) throw new Error("The LumiMind controller returned no parseable JSON.");
  const normalizedFirstAnalysis = normalizeControllerAnalysis(result.parsed);
  const firstAnalysis = applyControllerMindPolicy(normalizedFirstAnalysis, input.compactState, input.settings);
  const firstTelemetry = makeControllerResponseTelemetry(result.raw, result.parsed, normalizedFirstAnalysis);
  const nontrivial = isNontrivialAnalysisBatch(input.messages);
  let finalAnalysis = firstAnalysis;
  let retryTelemetry: ControllerResponseTelemetry | null = null;
  let retryError: string | null = null;
  let attempts = 1;

  if (nontrivial && firstAnalysis.changes.length === 0) {
    attempts = 2;
    try {
      const corrective = await quietJson(
        `${prompt}\n\nThe first pass produced zero accepted changes. Perform the corrective bootstrap extraction now.`,
        analysisSystemPrompt(input.settings, true),
        "lumi_mind_analysis_v1_corrective",
        ANALYSIS_SCHEMA,
        input.settings,
        input.userId,
        input.fallbackConnectionId,
      );
      const normalizedCorrectiveAnalysis = normalizeControllerAnalysis(corrective.parsed);
      const correctiveAnalysis = applyControllerMindPolicy(normalizedCorrectiveAnalysis, input.compactState, input.settings);
      retryTelemetry = makeControllerResponseTelemetry(corrective.raw, corrective.parsed, normalizedCorrectiveAnalysis);
      if (!corrective.parsed) throw new Error("Corrective controller pass returned no parseable JSON.");
      finalAnalysis = mergeControllerAnalyses(firstAnalysis, correctiveAnalysis);
    } catch (error) {
      retryError = (error instanceof Error ? error.message : String(error)).slice(0, 240);
    }
  }

  const warningCodes = new Set<ControllerWarningCode>();
  const normalizationDropped = (telemetry: ControllerResponseTelemetry | null) => !!telemetry && (
    telemetry.rawActorMentions > telemetry.acceptedActorMentions || telemetry.rawChanges > telemetry.acceptedChanges
  );
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
      retryError,
    },
  };
}

const SEED_SYSTEM_PROMPT = [
  "You draft reusable LumiMind character-card seeds.",
  "Return JSON only. Extract enduring characterization from the card without inventing events, relationships, or secrets not supported by the card.",
  "The seed must be concise, portable across new chats, and written as private subjective state rather than visible roleplay prose.",
].join("\n");

export async function generateSeedDraft(input: {
  character: unknown;
  settings: LumiMindSettings;
  userId: string;
}): Promise<MindSeedV1> {
  const prompt = [
    "Draft a reusable mind seed from this character card:",
    `<character_card>\n${JSON.stringify(input.character)}\n</character_card>`,
    "Use schemaVersion 1 and updatedAt equal to the current Unix time in milliseconds.",
  ].join("\n\n").slice(0, 80_000);
  const result = await quietJson(prompt, SEED_SYSTEM_PROMPT, "lumi_mind_seed_v1", SEED_SCHEMA, input.settings, input.userId);
  const normalized = normalizeSeed(result.parsed);
  if (!normalized) throw new Error("The LumiMind controller returned an invalid mind seed.");
  return { ...makeEmptySeed(), ...normalized, schemaVersion: 1, updatedAt: Date.now() };
}
