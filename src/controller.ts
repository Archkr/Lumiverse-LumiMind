declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

import { makeEmptySeed, normalizeSeed, uniqueStrings } from "./engine";
import type {
  ChatMessageLike,
  ControllerActorMention,
  ControllerAnalysis,
  ControllerChange,
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
  "Return JSON only. Analyze every supplied message and identify every named actor with narrative agency: cards, the user persona, and NPCs.",
  "Infer emotions, motives, goals, plans, relationships, and beliefs only when directly stated or strongly supported by subtext.",
  "Never invent objective events. Beliefs may be false or uncertain and must remain subjective.",
  "Treat a secret as information the subject knows and is deliberately concealing; concealedFromRefs names who it is hidden from.",
  "Use existing item IDs in targetItemId when updating, resolving, abandoning, or removing state. Do not modify locked entries.",
  "Include actorMentions for the actors actually present in the scene after each message, not merely referenced.",
  "Every actor mention and change must cite one supplied messageId and a short evidenceExcerpt.",
].join("\n");

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
    ANALYSIS_SYSTEM_PROMPT,
    "lumi_mind_analysis_v1",
    ANALYSIS_SCHEMA,
    input.settings,
    input.userId,
    input.fallbackConnectionId,
  );
  if (!result.parsed) throw new Error("The LumiMind controller returned no parseable JSON.");
  return { analysis: normalizeControllerAnalysis(result.parsed), meta: result.meta, raw: result.raw };
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
