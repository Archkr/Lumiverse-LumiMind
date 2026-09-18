declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

import {
  makeEmptySeed,
  matchingMindItem,
  normalizeCore,
  normalizeSeed,
  projectControllerState,
  stableHash,
  uniqueStrings,
  type TokenCounter,
  type TokenMeasurement,
} from "./engine";
import { controllerRequest, ControllerRequestTimeoutError, CONTROLLER_LOOKUP_TIMEOUT_MS } from "./controller-requests";
import { waitForControllerRpmSlot, withControllerSlot } from "./controller-scheduling";
import type {
  ActorMind,
  ActorRecord,
  ChatMessageLike,
  ControllerBatchTelemetry,
  ControllerAttempt,
  ControllerPhase,
  ControllerOperationCounts,
  ControllerRun,
  ControllerTarget,
  ControllerTestResult,
  ControllerActorMention,
  ControllerAnalysis,
  ControllerChange,
  ControllerResponseTelemetry,
  ControllerWarningCode,
  InvalidMindChangeReason,
  InvalidMindChangeReasonCounts,
  LumiMindSettings,
  MindCategory,
  MindCore,
  MindOperation,
  MindItemStatus,
  MindSeedV1,
  MindTidyItemDraft,
  MindTidyProposal,
} from "./types";

const THINK_BLOCK_RE = /<think[\s\S]*?<\/think>/gi;
const ANALYSIS_TOOL_NAME = "lumi_mind_analysis_v1";
const MIND_CATEGORIES = ["belief", "secret", "goal", "plan", "emotion", "relationship", "awareness"] as const satisfies readonly MindCategory[];
const MIND_OPERATIONS = ["add", "update", "resolve", "abandon"] as const satisfies readonly MindOperation[];
const CATEGORY_NORMALIZATIONS: Readonly<Record<string, MindCategory>> = {
  belief: "belief",
  beliefs: "belief",
  secret: "secret",
  secrets: "secret",
  goal: "goal",
  goals: "goal",
  plan: "plan",
  plans: "plan",
  emotion: "emotion",
  emotions: "emotion",
  relationship: "relationship",
  relationships: "relationship",
  awareness: "awareness",
  awarenesses: "awareness",
};

export interface ControllerMeta {
  connectionId: string | null;
  provider: string | null;
  model: string | null;
}

export interface AnalysisControllerResult {
  analysis: ControllerAnalysis;
  meta: ControllerMeta;
  raw: string;
  rawResponses: { first: string; retry: string | null };
  telemetry: ControllerBatchTelemetry;
}

export function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && error.name === "AbortError";
}

type ResolvedConnection = {
  id: string | null;
  provider: string | null;
  model: string | null;
};

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

function category(value: unknown): MindCategory | null {
  const normalized = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  return CATEGORY_NORMALIZATIONS[normalized] ?? null;
}

function operation(value: unknown): MindOperation | null {
  const normalized = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  return MIND_OPERATIONS.find((candidate) => candidate === normalized) ?? null;
}

function duplicateControllerChange(left: ControllerChange, right: ControllerChange): boolean {
  // Distinct edits, including later transitions on the same item, are history.
  return JSON.stringify(left) === JSON.stringify(right);
}

function deduplicateControllerChanges(changes: ControllerChange[]): ControllerChange[] {
  const result: ControllerChange[] = [];
  for (const change of changes) {
    const existingIndex = result.findIndex((candidate) => duplicateControllerChange(candidate, change));
    if (existingIndex >= 0) result[existingIndex] = change;
    else result.push(change);
  }
  return result;
}

interface ControllerNormalizationResult {
  analysis: ControllerAnalysis;
  duplicatesSuppressed: number;
  invalidChangesRejected: number;
  invalidChangeReasons: InvalidMindChangeReasonCounts;
}

function incrementInvalidReason(counts: InvalidMindChangeReasonCounts, reason: InvalidMindChangeReason): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function mergeInvalidReasons(...sources: InvalidMindChangeReasonCounts[]): InvalidMindChangeReasonCounts {
  const result: InvalidMindChangeReasonCounts = {};
  for (const source of sources) {
    for (const [reason, count] of Object.entries(source) as Array<[InvalidMindChangeReason, number]>) {
      if (count > 0) result[reason] = (result[reason] ?? 0) + count;
    }
  }
  return result;
}

function invalidReasonTotal(counts: InvalidMindChangeReasonCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
}

function normalizeControllerAnalysisResult(value: unknown): ControllerNormalizationResult {
  const raw = asObject(value);
  const invalidChangeReasons: InvalidMindChangeReasonCounts = {};
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
        const normalizedCategory = category(item.category);
        const normalizedOperation = operation(item.operation);
        const normalizedText = text(item.text);
        const normalizedStatus = text(item.status).toLocaleLowerCase();
        const targetItemId = text(item.targetItemId) || null;
        let rejectionReason: InvalidMindChangeReason | null = null;
        if (!subjectRef) rejectionReason = "missing_subject";
        else if (!messageId) rejectionReason = "missing_message_id";
        else if (!normalizedCategory) rejectionReason = "invalid_category";
        else if (text(item.operation).toLocaleLowerCase() === "remove") rejectionReason = "forbidden_remove";
        else if (!normalizedOperation) rejectionReason = "invalid_operation";
        else if (normalizedOperation === "add" && targetItemId) rejectionReason = "unexpected_target_id";
        else if ((normalizedOperation === "add" || normalizedOperation === "update") && (normalizedStatus === "resolved" || normalizedStatus === "abandoned")) rejectionReason = "invalid_status";
        else if (normalizedStatus && !["active", "uncertain", "resolved", "abandoned"].includes(normalizedStatus)) rejectionReason = "invalid_status";
        else if ((normalizedOperation === "add" || normalizedOperation === "update") && !normalizedText) rejectionReason = "missing_text";
        else if (normalizedOperation !== "add" && !targetItemId) rejectionReason = "missing_target_id";
        if (rejectionReason) {
          incrementInvalidReason(invalidChangeReasons, rejectionReason);
          return [];
        }
        if (!normalizedCategory || !normalizedOperation) return [];
        const dimensions: Record<string, number> = {};
        for (const [key, value] of Object.entries(asObject(item.dimensions))) {
          dimensions[key] = Math.min(1, Math.max(-1, numberValue(value, 0)));
        }
        return [{
          subjectRef,
          category: normalizedCategory,
          operation: normalizedOperation,
          targetItemId,
          text: normalizedText,
          status: normalizedOperation === "resolve" ? "resolved" : normalizedOperation === "abandon" ? "abandoned" : normalizedStatus === "uncertain" ? "uncertain" : "active",
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
  const deduplicatedChanges = deduplicateControllerChanges(changes);
  return {
    analysis: { actorMentions, changes: deduplicatedChanges },
    duplicatesSuppressed: changes.length - deduplicatedChanges.length,
    invalidChangesRejected: invalidReasonTotal(invalidChangeReasons),
    invalidChangeReasons,
  };
}

export function normalizeControllerAnalysis(value: unknown): ControllerAnalysis {
  return normalizeControllerAnalysisResult(value).analysis;
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

  const remapCandidates = new Map<string, Set<string>>();
  const ambiguousRemaps = new Set<string>();
  const actorMentions = analysis.actorMentions.flatMap((mention) => {
    const keys = [mention.ref, mention.name, ...(mention.aliases ?? [])].map(policyReference).filter(Boolean);
    const blockedKind = !settings.personaMindEnabled && mention.kind === "persona";
    const safeName = [mention.name, ...(mention.aliases ?? [])]
      .map((value) => value.trim())
      .find((value) => value && !excluded.has(policyReference(value)));
    const collidingKeys = keys.filter((key) => excluded.has(key));
    if (blockedKind || (collidingKeys.length > 0 && !safeName)) {
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
        aliases: (mention.aliases ?? []).filter((alias) => !excluded.has(policyReference(alias))),
      };
      for (const key of collidingKeys) {
        const candidates = remapCandidates.get(key) ?? new Set<string>();
        candidates.add(safeRef);
        remapCandidates.set(key, candidates);
      }
    }
    if (settings.characterCardDirectorMode && normalized.kind === "character") {
      return [{ ...normalized, kind: "npc" as const }];
    }
    return [normalized];
  });
  const remappedSubjects = new Map<string, string>();
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

interface ControllerContextValidationResult {
  analysis: ControllerAnalysis;
  duplicatesSuppressed: number;
  correctionTargets: Array<{ subjectRef: string; targetItemId: string }>;
  invalidChangesRejected: number;
  invalidChangeReasons: InvalidMindChangeReasonCounts;
}

function resolveControllerTarget(
  items: Record<string, unknown>[],
  targetItemId: string,
): Record<string, unknown> | null {
  const exact = items.find((item) => text(item.id) === targetItemId);
  if (exact) return exact;

  // Some structured-output models copy only the namespace plus the first UUID
  // segment. Recover that form only when it is specific and unambiguous.
  const separatorIndex = targetItemId.lastIndexOf(":");
  if (separatorIndex < 0 || targetItemId.length - separatorIndex - 1 < 8) return null;
  const prefixMatches = items.filter((item) => text(item.id).startsWith(targetItemId));
  return prefixMatches.length === 1 ? prefixMatches[0] : null;
}

function validateControllerAnalysisContext(
  analysis: ControllerAnalysis,
  messages: ChatMessageLike[],
  compactState: unknown,
): ControllerContextValidationResult {
  const messageOrder = new Map(messages.map((message, index) => [message.id, index]));
  const actorByReference = new Map<string, Record<string, unknown>>();
  for (const value of Array.isArray(compactState) ? compactState : []) {
    const actor = structuredClone(asObject(value));
    actor.items = (Array.isArray(actor.items) ? actor.items : []).map(asObject);
    for (const reference of [actor.ref, actor.name, ...(Array.isArray(actor.aliases) ? actor.aliases : [])]) {
      const key = policyReference(reference);
      if (key) actorByReference.set(key, actor);
    }
  }
  const actorMentions = analysis.actorMentions.filter((mention) => messageOrder.has(mention.messageId));
  for (const mention of actorMentions) {
    // Materialization resolves an existing actor by ref, then by name. Reuse
    // the same ledger when a model invents a fresh ref for a known actor.
    const actor = actorByReference.get(policyReference(mention.ref))
      ?? actorByReference.get(policyReference(mention.name))
      ?? { ref: mention.ref, items: [] };
    for (const reference of [mention.ref, mention.name, ...(mention.aliases ?? [])]) {
      const key = policyReference(reference);
      if (key && !actorByReference.has(key)) actorByReference.set(key, actor);
    }
  }

  let duplicatesSuppressed = 0;
  const correctionTargets: ControllerContextValidationResult["correctionTargets"] = [];
  const invalidChangeReasons: InvalidMindChangeReasonCounts = {};
  const ordered = [...analysis.changes].sort((left, right) => (messageOrder.get(left.messageId) ?? Infinity) - (messageOrder.get(right.messageId) ?? Infinity));
  const changes = ordered.flatMap((change) => {
    const actor = actorByReference.get(policyReference(change.subjectRef));
    const reject = (reason: InvalidMindChangeReason) => { incrementInvalidReason(invalidChangeReasons, reason); return []; };
    if (!messageOrder.has(change.messageId)) return reject("message_outside_batch");
    if (!actor) return reject("unknown_subject");
    const knownReferences = (values: string[] | undefined) => uniqueStrings((values ?? [])
      .map((reference) => actorByReference.get(policyReference(reference)))
      .filter((value): value is Record<string, unknown> => !!value)
      .map((value) => text(value.ref)));
    change = { ...change, targetRefs: knownReferences(change.targetRefs), concealedFromRefs: knownReferences(change.concealedFromRefs) };
    const items = actor.items as Record<string, unknown>[];
    if (change.operation !== "add") {
      const targetItemId = change.targetItemId?.trim();
      if (!targetItemId) return reject("missing_target_id");
      const target = resolveControllerTarget(items, targetItemId);
      if (!target) return reject("target_not_found");
      if (target.locked === true || target.controllerWritable === false) return reject("protected_target");
      change = { ...change, targetItemId: text(target.id) };
      // Validate subsequent additions against the state after this transition.
      if (change.operation === "update") Object.assign(target, {
        category: change.category, text: change.text, status: change.status,
        targetActorIds: change.targetRefs, concealedFromActorIds: change.concealedFromRefs,
        intensity: change.intensity, dimensions: change.dimensions,
      });
      else target.status = change.operation === "resolve" ? "resolved" : "abandoned";
    } else {
      const matchable = items.flatMap((item) => {
        const itemCategory = category(item.category);
        return itemCategory ? [{ source: item, id: text(item.id), category: itemCategory, text: text(item.text),
          status: (item.status === "resolved" || item.status === "abandoned" || item.status === "uncertain" ? item.status : "active") as MindItemStatus,
          targetActorIds: stringArray(item.targetActorIds), concealedFromActorIds: stringArray(item.concealedFromActorIds),
        }] : [];
      });
      const match = matchingMindItem({ items: matchable }, {
        operation: "add", targetItemId: null, category: change.category, text: change.text ?? "",
        targetActorIds: change.targetRefs ?? [], concealedFromActorIds: change.concealedFromRefs ?? [],
      });
      if (match) {
        const matched = matchable[match.index];
        const original = matched.source;
        const previousDimensions = asObject(original.dimensions);
        const nextDimensions = change.dimensions ?? {};
        const changedDimensions = [...new Set([...Object.keys(previousDimensions), ...Object.keys(nextDimensions)])]
          .some((key) => previousDimensions[key] !== nextDimensions[key]);
        const unchanged = matched.status === change.status && (original.intensity ?? null) === (change.intensity ?? null) && !changedDimensions;
        if (match.kind === "exact" && unchanged) { duplicatesSuppressed++; return []; }
        if (original?.locked === true || original?.controllerWritable === false) return reject("protected_target");
        if (matched.id) correctionTargets.push({ subjectRef: text(actor.ref), targetItemId: matched.id });
        return reject("implicit_replacement");
      }
      // A new entry has no addressable stored ID until this batch is committed.
      items.push({ id: "", category: change.category, text: change.text, status: change.status,
        targetActorIds: change.targetRefs, concealedFromActorIds: change.concealedFromRefs,
        intensity: change.intensity, dimensions: change.dimensions });
    }
    return [change];
  });
  return {
    analysis: { actorMentions, changes }, duplicatesSuppressed, correctionTargets,
    invalidChangesRejected: invalidReasonTotal(invalidChangeReasons), invalidChangeReasons,
  };
}

export function isNontrivialAnalysisBatch(messages: ChatMessageLike[]): boolean {
  const lengths = messages.map((message) => message.content.replace(/\s+/g, " ").trim().length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return total >= 400 || lengths.some((length) => length >= 280) || (messages.length >= 2 && total >= 240);
}

function operationCounts(changes: unknown[]): ControllerOperationCounts {
  const counts: ControllerOperationCounts = { add: 0, update: 0, resolve: 0, abandon: 0, remove: 0 };
  for (const change of changes) {
    const key = text(asObject(change).operation).toLocaleLowerCase();
    if (Object.hasOwn(counts, key)) counts[key as MindOperation]++;
  }
  return counts;
}

export function makeControllerResponseTelemetry(
  raw: string,
  parsed: unknown,
  accepted: ControllerAnalysis,
  diagnostics: Partial<Pick<ControllerResponseTelemetry, "duplicatesSuppressed" | "invalidChangesRejected" | "invalidChangeReasons">> = {},
  outputMode: ControllerResponseTelemetry["outputMode"] = "json",
  transport: Partial<Pick<
    ControllerResponseTelemetry,
    "structuredSource" | "toolCallsReceived" | "matchingToolCalls" | "usableToolCalls"
  >> = {},
): ControllerResponseTelemetry {
  const object = asObject(parsed);
  const rawChanges = Array.isArray(object.changes) ? object.changes.length : 0;
  const duplicatesSuppressed = diagnostics.duplicatesSuppressed ?? 0;
  return {
    outputMode,
    ...transport,
    responseChars: raw.length,
    responseHash: stableHash(raw),
    rawActorMentions: Array.isArray(object.actorMentions) ? object.actorMentions.length : 0,
    rawChanges,
    emittedOperations: operationCounts(Array.isArray(object.changes) ? object.changes : []),
    acceptedOperations: operationCounts(accepted.changes),
    acceptedActorMentions: accepted.actorMentions.length,
    acceptedChanges: accepted.changes.length,
    duplicatesSuppressed,
    invalidChangesRejected: diagnostics.invalidChangesRejected ?? Math.max(0, rawChanges - accepted.changes.length - duplicatesSuppressed),
    invalidChangeReasons: diagnostics.invalidChangeReasons ?? {},
  };
}


const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  description: "The complete LumiMind analysis result. Always include both arrays, using empty arrays when nothing qualifies.",
  properties: {
    actorMentions: {
      type: "array",
      description: "Actors actually present after each analyzed message. Every mention cites an exact analysis-batch messageId.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref: { type: "string", description: "Stable actor reference. Copy the exact existing mind_state ref when one matches." },
          name: { type: "string", description: "Actor name as supported by the transcript." },
          aliases: { type: "array", items: { type: "string" }, description: "Supported alternate names; otherwise an empty array." },
          kind: { type: "string", enum: ["character", "persona", "npc"], description: "Use exactly character, persona, or npc." },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          present: { type: "boolean" },
          messageId: { type: "string", description: "Exact id of one message in analysis_batch supporting this presence mention." },
        },
        required: ["ref", "name", "aliases", "kind", "confidence", "present", "messageId"],
      },
    },
    changes: {
      type: "array",
      description: "Accepted ledger operations only. Use an empty array when all supported state is covered or protected.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          subjectRef: { type: "string", description: "Exact existing actor ref, or the same stable ref used in a new actorMention." },
          category: {
            type: "string",
            enum: [...MIND_CATEGORIES],
            description: "Use exactly one category: belief, secret, goal, plan, emotion, relationship, or awareness. Motives/desires/intentions are goals; methods/strategies are plans; current fears/feelings/reactions are emotions.",
          },
          operation: {
            type: "string",
            enum: [...MIND_OPERATIONS],
            description: "Use exactly one operation: add, update, resolve, or abandon. Permanent deletion is available only through human-reviewed Tidy or manual editing. These are verbs; never use status words such as active, resolved, or abandoned here.",
          },
          targetItemId: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "Null for add. For every other operation, copy the exact writable mind_state item id.",
          },
          text: { type: "string", description: "Concise subjective-state text. Required for add and update; use an empty string for other operations." },
          status: {
            type: "string",
            enum: ["active", "resolved", "abandoned", "uncertain"],
            description: "Use active or uncertain for add/update, resolved for resolve, and abandoned for abandon. Do not place this status token in operation.",
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          targetRefs: { type: "array", items: { type: "string" }, description: "Known actor refs targeted by this state; otherwise an empty array." },
          concealedFromRefs: { type: "array", items: { type: "string" }, description: "Known actor refs from whom a secret is concealed; otherwise an empty array." },
          intensity: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
          dimensions: {
            type: "object",
            additionalProperties: { type: "number", minimum: -1, maximum: 1 },
          },
          messageId: { type: "string", description: "Exact id of one message in analysis_batch supporting this change." },
          evidenceExcerpt: { type: "string", description: "Short excerpt from that message supporting the subjective inference." },
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

const CORE_SCHEMA: Record<string, unknown> = {
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
};

const SEED_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    core: CORE_SCHEMA,
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

const TIDY_ITEM_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: [...MIND_CATEGORIES] },
    text: { type: "string" },
    status: { type: "string", enum: ["active", "resolved", "abandoned", "uncertain"] },
    targetActorIds: { type: "array", items: { type: "string" } },
    concealedFromActorIds: { type: "array", items: { type: "string" } },
    intensity: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
    dimensions: { type: "object", additionalProperties: { type: "number", minimum: -1, maximum: 1 } },
  },
  required: ["category", "text", "status", "targetActorIds", "concealedFromActorIds", "intensity", "dimensions"],
};

const TIDY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          actorId: { type: "string" },
          finding: { type: "string", enum: ["missing", "mislabeled", "outdated", "duplicate", "inconsistent"] },
          operation: { type: "string", enum: ["replace_core", "add_item", "update_item", "merge_items", "remove_items"] },
          rationale: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          targetItemIds: { type: "array", items: { type: "string" } },
          core: { anyOf: [CORE_SCHEMA, { type: "null" }] },
          item: { anyOf: [TIDY_ITEM_SCHEMA, { type: "null" }] },
        },
        required: ["actorId", "finding", "operation", "rationale", "confidence", "targetItemIds", "core", "item"],
      },
    },
  },
  required: ["proposals"],
};

function toolChoiceParameters(provider: string | null): Record<string, unknown> {
  const normalized = provider?.trim().toLocaleLowerCase() ?? "";
  if (normalized === "google" || normalized === "gemini" || normalized === "google_vertex") {
    return { toolConfig: { functionCallingConfig: { mode: "ANY" } } };
  }
  if (normalized === "anthropic") return { tool_choice: { type: "any" } };
  return { tool_choice: "required" };
}

async function resolveConnection(settings: LumiMindSettings, userId: string, fallbackConnectionId?: string | null, signal?: AbortSignal): Promise<ResolvedConnection> {
  const id = settings.controllerConnectionId?.trim() || fallbackConnectionId?.trim() || null;
  const configuredModel = settings.controllerModel?.trim() || null;
  if (!id && typeof spindle.connections?.list === "function") {
    const profiles = await controllerRequest(() => spindle.connections.list(userId), signal, CONTROLLER_LOOKUP_TIMEOUT_MS, "Connection lookup").catch((error) => { if (signal?.aborted || isAbortError(error)) throw error; return []; });
    const defaultProfile = profiles.find((profile) => profile.is_default) ?? profiles[0];
    if (defaultProfile) return { id: defaultProfile.id, provider: defaultProfile.provider, model: configuredModel ?? defaultProfile.model };
  }
  if (!id) return { id: null, provider: null, model: configuredModel };
  const connection = await controllerRequest(() => spindle.connections.get(id, userId), signal, CONTROLLER_LOOKUP_TIMEOUT_MS, "Connection lookup").catch((error) => { if (signal?.aborted || isAbortError(error)) throw error; return null; });
  return { id, provider: connection?.provider ?? null, model: configuredModel ?? connection?.model ?? null };
}

function fallbackTokenMeasurement(textValue: string, model: string | null): TokenMeasurement {
  return {
    totalTokens: Math.ceil(textValue.length / 4),
    model,
    tokenizerName: "Approximate chars / 4",
    approximate: true,
    fallback: true,
  };
}

async function countTextTokens(textValue: string, connection: ResolvedConnection, userId: string, signal?: AbortSignal): Promise<TokenMeasurement> {
  try {
    const result = await controllerRequest(() => spindle.tokens.countText(textValue, connection.model
      ? { model: connection.model, userId }
      : { modelSource: "main", userId }), signal, CONTROLLER_LOOKUP_TIMEOUT_MS, "Token counting");
    return {
      totalTokens: result.total_tokens,
      model: result.model || connection.model,
      tokenizerName: result.tokenizer_name,
      approximate: result.approximate,
      fallback: false,
    };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    return fallbackTokenMeasurement(textValue, connection.model);
  }
}

async function countMessageTokens(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  connection: ResolvedConnection,
  userId: string,
  signal?: AbortSignal,
): Promise<TokenMeasurement> {
  try {
    const result = await controllerRequest(() => spindle.tokens.countMessages(messages, connection.model
      ? { model: connection.model, userId }
      : { modelSource: "main", userId }), signal, CONTROLLER_LOOKUP_TIMEOUT_MS, "Token counting");
    return {
      totalTokens: result.total_tokens,
      model: result.model || connection.model,
      tokenizerName: result.tokenizer_name,
      approximate: result.approximate,
      fallback: false,
    };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    return fallbackTokenMeasurement(messages.map((message) => `${message.role}\n${message.content}`).join("\n"), connection.model);
  }
}

function controllerTokenCounter(connection: ResolvedConnection, userId: string, signal?: AbortSignal): TokenCounter {
  return (value) => countTextTokens(value, connection, userId, signal);
}

async function quietJson(
  prompt: string,
  systemPrompt: string,
  schemaName: string,
  schema: Record<string, unknown>,
  settings: LumiMindSettings,
  userId: string,
  fallbackConnectionId?: string | null,
  resolvedConnection?: ResolvedConnection,
  signal?: AbortSignal,
  onProgress?: (phase: ControllerPhase) => void,
  chatId?: string | null,
): Promise<{
  parsed: unknown;
  raw: string;
  meta: ControllerMeta;
  outputMode: ControllerResponseTelemetry["outputMode"];
  structuredSource: NonNullable<ControllerResponseTelemetry["structuredSource"]>;
  toolCallsReceived: number;
  matchingToolCalls: number;
  usableToolCalls: number;
  providerInputTokens: number | null;
}> {
  const connection = resolvedConnection ?? await resolveConnection(settings, userId, fallbackConnectionId, signal);
  onProgress?.("queued");
  const result = await withControllerSlot(userId, settings.controllerParallelRequests, signal, async () => {
    if (spindle.permissions && !spindle.permissions.has("generation")) throw new LocalControllerError("Generation permission is required to use the controller.");
    if (settings.controllerRequestsPerMinute > 0) onProgress?.("rate_limited");
    await waitForControllerRpmSlot({
      userId,
      provider: connection.provider,
      requestsPerMinute: settings.controllerRequestsPerMinute,
      signal,
    });
    onProgress?.("requesting");
    return controllerRequest((requestSignal) => spindle.generate.quiet({
      type: "quiet",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      parameters: {
        temperature: settings.controllerTemperature,
        // A blank override deliberately selects the connection default and keeps
        // legacy preset model fields from replacing it inside quiet generation.
        model: settings.controllerModel?.trim() ?? "",
        ...toolChoiceParameters(connection.provider),
      },
      tools: [{
        name: schemaName,
        description: "Submit the complete structured LumiMind result exactly once.",
        parameters: schema,
      }],
      reasoning: { source: "off" },
      ...(connection.id ? { connection_id: connection.id } : {}),
      ...(chatId ? { chat_id: chatId } : {}),
      userId,
      signal: requestSignal,
    } as unknown as Parameters<typeof spindle.generate.quiet>[0]), signal, (settings.controllerTimeoutSeconds ?? 120) * 1000);
  });
  const object = asObject(result);
  const content = sanitizeControllerText(text(object.content));
  const reasoning = sanitizeControllerText(text(object.reasoning));
  const toolCalls = (Array.isArray(object.tool_calls) ? object.tool_calls : []).map(asObject);
  const matchingToolCalls = toolCalls.filter((call) => text(call.name) === schemaName);
  const usableToolCalls = matchingToolCalls.filter((call) => Object.keys(asObject(call.args)).length > 0);
  const toolArgs = usableToolCalls.length ? asObject(usableToolCalls[0].args) : null;
  const contentParsed = toolArgs ? null : parseJsonValue(content);
  const reasoningParsed = toolArgs || contentParsed !== null ? null : parseJsonValue(reasoning);
  const parsed = toolArgs ?? (contentParsed !== null ? contentParsed : reasoningParsed);
  const structuredSource: NonNullable<ControllerResponseTelemetry["structuredSource"]> = toolArgs
    ? "tool"
    : contentParsed !== null
      ? "content_json"
      : reasoningParsed !== null
        ? "reasoning_json"
        : "none";
  const outputMode: ControllerResponseTelemetry["outputMode"] = toolArgs ? "tool" : "json";
  const raw = toolArgs
    ? JSON.stringify(toolArgs)
    : contentParsed !== null
      ? content
      : reasoningParsed !== null
        ? reasoning
        : content || reasoning;
  const usage = asObject(object.usage);
  const providerInputTokens = typeof usage.prompt_tokens === "number" && Number.isFinite(usage.prompt_tokens)
    ? Math.max(0, Math.round(usage.prompt_tokens))
    : null;
  return {
    parsed,
    raw,
    meta: { connectionId: connection.id, provider: connection.provider, model: connection.model },
    outputMode,
    structuredSource,
    toolCallsReceived: toolCalls.length,
    matchingToolCalls: matchingToolCalls.length,
    usableToolCalls: usableToolCalls.length,
    providerInputTokens,
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
  "Call the required LumiMind result tool exactly once. Analyze every supplied message and identify every named actor with narrative agency that the roleplay-mode instructions permit LumiMind to manage.",
  `Use only these category tokens: ${MIND_CATEGORIES.join(", ")}.`,
  "Map a motive, desire, intention, or intended outcome to goal; a chosen method, strategy, or intended action sequence to plan; a current fear, feeling, or reaction to emotion; a noticed, witnessed, or currently known fact to awareness; a subjective proposition accepted as true or likely to belief; deliberately concealed knowledge to secret; and a stance toward another actor to relationship.",
  `Use only these operation tokens: ${MIND_OPERATIONS.join(", ")}. Use add for novel state, update for materially evolved writable state, resolve for concluded state, and abandon for explicitly renounced state. Never permanently delete state; deletion requires human review in Tidy.`,
  "An existing plan changes from entering through the gate to using the tunnel: update the same plan ID. Finding the sought notebook: resolve the existing find-notebook goal ID. Explicitly giving up the search: abandon that goal ID.",
  "A belief materially changes after new evidence: update its existing ID. A repeated goal or paraphrase: emit no edit. A genuinely independent new objective: add with targetItemId=null.",
  "Do not resolve or abandon an item merely because it is old, omitted from recent dialogue, or absent from the projected state. Never force a mixture of operations.",
  "Preserve supported transitions in transcript order. If one entry changes in one message and concludes in a later message, emit both operations with their respective message IDs.",
  "Infer subjective state only when directly stated or strongly supported by subtext.",
  "Never invent objective events. Beliefs may be false or uncertain and must remain subjective.",
  "Treat a secret as information the subject knows and is deliberately concealing; concealedFromRefs names who it is hidden from.",
  "Treat mind_state as an authoritative ledger to reconcile, not background prose to summarize. Adds are the last resort, not the default output.",
  "For every candidate state, compare its meaning against every unresolved item for the same subject, category, targets, and concealed audience. Compare semantic claims and functions, not wording or sentence structure.",
  "Classify each candidate internally as exactly one of COVERED, EVOLVED, ENDED, PROTECTED, or NOVEL before emitting JSON. Do not output these labels.",
  "COVERED: an existing item already expresses the same claim, intent, reaction, stance, or a broader state that entails it. Emit no change, even when the new wording is more vivid, specific, or paraphrased.",
  "EVOLVED: the same continuing state materially changed and its existing item has controllerWritable=true. Emit update with that exact item ID; never add a second version.",
  "ENDED: an existing controllerWritable=true state clearly concluded or was explicitly renounced. Resolve a concluded state or abandon an explicitly renounced state using that exact item. Never delete it or add its opposite.",
  "PROTECTED: the best semantic match has controllerWritable=false. Emit no change. Never add a replacement, workaround, refinement, contradiction, or scene-specific restatement of protected state.",
  "NOVEL: no existing item or earlier change in this response covers the same semantic proposition or continuity function. Only NOVEL candidates may use add. When uncertain between COVERED and NOVEL, choose COVERED and emit nothing.",
  "Use existing item IDs in targetItemId for every update, resolve, or abandon operation. Never target an item with controllerWritable=false.",
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
  "Every actor mention must cite one supplied messageId. Every change must cite one supplied messageId and a short evidenceExcerpt.",
].join("\n");

function correctiveBootstrapNeeded(compactState: unknown, mentions: ControllerActorMention[]): boolean {
  const stateActors = (Array.isArray(compactState) ? compactState : [])
    .map(asObject)
    .filter((actor) => policyReference(actor.ref) || policyReference(actor.name));
  const actors = stateActors
    .filter((actor) => actor.managed !== false)
    .map((actor) => ({
      references: [actor.ref, actor.name, ...(Array.isArray(actor.aliases) ? actor.aliases : [])]
        .map(policyReference)
        .filter(Boolean),
      itemCount: Array.isArray(actor.items) ? actor.items.length : 0,
    }));
  if (actors.length === 0) return stateActors.length === 0 || mentions.length > 0;
  if (actors.every((actor) => actor.itemCount === 0)) return true;
  return mentions.some((mention) => {
    const mentionReferences = [mention.ref, mention.name, ...(mention.aliases ?? [])].map(policyReference).filter(Boolean);
    const actor = actors.find((candidate) => candidate.references.some((reference) => mentionReferences.includes(reference)));
    return !actor || actor.itemCount === 0;
  });
}

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
      "This pass is permitted only because at least one managed actor genuinely lacks unresolved state. Re-read analysis_batch actor by actor and extract the smallest defensible bootstrap state supported by the text.",
      "Apply the COVERED/EVOLVED/ENDED/PROTECTED/NOVEL reconciliation protocol before every change. Do not fill categories or duplicate state belonging to an already initialized actor.",
      "Do not manufacture facts or force every category. An empty changes array is valid only when the batch truly contains no evidence of any managed actor's subjective state.",
    ].join("\n")
    : "";
  return [ANALYSIS_SYSTEM_PROMPT, mode, persona, correction].filter(Boolean).join("\n");
}

function correctiveFeedback(telemetry: ControllerResponseTelemetry): string {
  const reasons = (Object.entries(telemetry.invalidChangeReasons) as Array<[InvalidMindChangeReason, number]>)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");
  return [
    `First pass raw changes: ${telemetry.rawChanges}. Accepted changes: ${telemetry.acceptedChanges}.`,
    `Rejected change reasons: ${reasons || "none; the first pass emitted no usable state changes"}.`,
    `Category must be exactly one of: ${MIND_CATEGORIES.join(", ")}.`,
    `Operation must be exactly one of: ${MIND_OPERATIONS.join(", ")}.`,
    "Use goal for motives/desires/intentions, plan for methods/strategies, and emotion for current fears/feelings/reactions. Do not emit motive, desire, fear, feeling, create, replace, active, resolved, or abandoned as category/operation values.",
    "Copy subjectRef and messageId exactly from mind_state, actorMentions, or analysis_batch. Non-add operations require an exact writable targetItemId.",
  ].join("\n");
}

export function buildAnalysisPrompt(input: Pick<Parameters<typeof analyzeMessages>[0], "messages" | "recentContext" | "compactState">): string {
  return [
    "Existing actor registry and current subjective state:",
    `<mind_state>\n${JSON.stringify(input.compactState)}\n</mind_state>`,
    "Recent transcript context (context only; do not emit changes for these messages):",
    `<recent_context>\n${renderMessages(input.recentContext)}\n</recent_context>`,
    "Messages to analyze:",
    `<analysis_batch>\n${renderMessages(input.messages)}\n</analysis_batch>`,
    "Reconcile; do not summarize. If every supported candidate is COVERED or PROTECTED by mind_state, return actorMentions as appropriate with an empty changes array.",
    "Call the required result tool with {\"actorMentions\": [...], \"changes\": [...]} now.",
  ].join("\n\n");
}

async function analyzeMessagesOnce(input: ControllerHooks & {
  messages: ChatMessageLike[];
  recentContext: ChatMessageLike[];
  compactState: unknown;
  settings: LumiMindSettings;
  userId: string;
  fallbackConnectionId?: string | null;
  signal?: AbortSignal;
}): Promise<AnalysisControllerResult> {
  const connection = await resolveConnection(input.settings, input.userId, input.fallbackConnectionId, input.signal);
  const stateProjection = await projectControllerState(
    input.compactState,
    input.messages,
    input.recentContext,
    input.settings.analysisStateTokenBudget,
    controllerTokenCounter(connection, input.userId, input.signal),
  );
  const prompt = buildAnalysisPrompt({ ...input, compactState: stateProjection.state });
  const systemPrompt = analysisSystemPrompt(input.settings);
  const inputMeasurement = await countMessageTokens([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ], connection, input.userId, input.signal);
  const result = await quietJson(
    prompt,
    systemPrompt,
    ANALYSIS_TOOL_NAME,
    ANALYSIS_SCHEMA,
    input.settings,
    input.userId,
    input.fallbackConnectionId,
    connection,
    input.signal,
    input.onProgress,
    input.chatId,
  );
  input.signal?.throwIfAborted();
  if (!result.parsed) throw new UnusableControllerOutput("The LumiMind controller returned no parseable structured result.");
  const shape = asObject(result.parsed);
  if (!Array.isArray(shape.actorMentions) || !Array.isArray(shape.changes)) throw new UnusableControllerOutput("The LumiMind controller returned an invalid analysis result.");
  const normalizedFirst = normalizeControllerAnalysisResult(result.parsed);
  const policyFirst = applyControllerMindPolicy(normalizedFirst.analysis, input.compactState, input.settings);
  const validatedFirst = validateControllerAnalysisContext(policyFirst, input.messages, input.compactState);
  const firstAnalysis = validatedFirst.analysis;
  const firstTelemetry = makeControllerResponseTelemetry(result.raw, result.parsed, firstAnalysis, {
    duplicatesSuppressed: normalizedFirst.duplicatesSuppressed + validatedFirst.duplicatesSuppressed,
    invalidChangesRejected: normalizedFirst.invalidChangesRejected + validatedFirst.invalidChangesRejected,
    invalidChangeReasons: mergeInvalidReasons(normalizedFirst.invalidChangeReasons, validatedFirst.invalidChangeReasons),
  }, result.outputMode, {
    structuredSource: result.structuredSource,
    toolCallsReceived: result.toolCallsReceived,
    matchingToolCalls: result.matchingToolCalls,
    usableToolCalls: result.usableToolCalls,
  });
  const nontrivial = isNontrivialAnalysisBatch(input.messages);
  const bootstrapNeeded = correctiveBootstrapNeeded(input.compactState, firstAnalysis.actorMentions);
  let finalAnalysis = firstAnalysis;
  let retryTelemetry: ControllerResponseTelemetry | null = null;
  let retryRaw: string | null = null;
  let retryError: string | null = null;
  let policyDrops = { mentions: normalizedFirst.analysis.actorMentions.length - policyFirst.actorMentions.length, changes: normalizedFirst.analysis.changes.length - policyFirst.changes.length };
  let attempts = 1;

  const bootstrapRetry = nontrivial && bootstrapNeeded && firstAnalysis.changes.length === 0;
  const operationRetry = firstTelemetry.invalidChangesRejected > 0;
  if (bootstrapRetry || operationRetry) {
    attempts = 2;
    try {
      const corrective = await quietJson(
        `${prompt}\n\n<corrective_feedback>\n${correctiveFeedback(firstTelemetry)}\n${JSON.stringify({ replacementTargets: validatedFirst.correctionTargets })}\n</corrective_feedback>\n\n<valid_first_pass_edits>\n${JSON.stringify(firstAnalysis)}\n</valid_first_pass_edits>\n\nReturn a complete corrected result for this entire analysis_batch, including every valid first-pass edit that is still warranted. Do not return only a patch. Reconsider forbidden removals as resolve or abandon only when supported; otherwise omit them. For implicit replacements, use the existing writable ID to update changed state or omit covered state. Never invent IDs for proposed additions.`,
        analysisSystemPrompt(input.settings, bootstrapRetry),
        ANALYSIS_TOOL_NAME,
        ANALYSIS_SCHEMA,
        input.settings,
        input.userId,
        input.fallbackConnectionId,
        connection,
        input.signal,
        input.onProgress,
        input.chatId,
      );
      input.signal?.throwIfAborted();
      retryRaw = corrective.raw;
      const normalizedCorrective = normalizeControllerAnalysisResult(corrective.parsed);
      const policyCorrective = applyControllerMindPolicy(normalizedCorrective.analysis, input.compactState, input.settings);
      const validatedCorrective = validateControllerAnalysisContext(policyCorrective, input.messages, input.compactState);
      const correctiveAnalysis = validatedCorrective.analysis;
      retryTelemetry = makeControllerResponseTelemetry(corrective.raw, corrective.parsed, correctiveAnalysis, {
        duplicatesSuppressed: normalizedCorrective.duplicatesSuppressed + validatedCorrective.duplicatesSuppressed,
        invalidChangesRejected: normalizedCorrective.invalidChangesRejected + validatedCorrective.invalidChangesRejected,
        invalidChangeReasons: mergeInvalidReasons(normalizedCorrective.invalidChangeReasons, validatedCorrective.invalidChangeReasons),
      }, corrective.outputMode, {
        structuredSource: corrective.structuredSource,
        toolCallsReceived: corrective.toolCallsReceived,
        matchingToolCalls: corrective.matchingToolCalls,
        usableToolCalls: corrective.usableToolCalls,
      });
      if (!corrective.parsed) throw new UnusableControllerOutput("Corrective controller pass returned no parseable structured result.");
      const correctiveShape = asObject(corrective.parsed);
      if (!Array.isArray(correctiveShape.actorMentions) || !Array.isArray(correctiveShape.changes)) throw new UnusableControllerOutput("Corrective controller pass returned an invalid analysis result.");
      if (retryTelemetry.invalidChangesRejected > 0) throw new UnusableControllerOutput("Corrective controller pass still contained invalid operations; valid first-pass analysis was retained.");
      finalAnalysis = correctiveAnalysis;
      policyDrops = { mentions: normalizedCorrective.analysis.actorMentions.length - policyCorrective.actorMentions.length, changes: normalizedCorrective.analysis.changes.length - policyCorrective.changes.length };
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error) || error instanceof LocalControllerError || permissionFailure(error)) throw error;
      retryError = error instanceof UnusableControllerOutput ? error.message : "Corrective controller request failed.";
    }
  }

  const warningCodes = new Set<ControllerWarningCode>();
  const normalizationDropped = (telemetry: ControllerResponseTelemetry | null) => !!telemetry && (
    telemetry.rawActorMentions - policyDrops.mentions > telemetry.acceptedActorMentions ||
    telemetry.rawChanges - policyDrops.changes - telemetry.acceptedChanges > telemetry.duplicatesSuppressed ||
    telemetry.invalidChangesRejected > 0
  );
  const effectiveTelemetry = retryTelemetry && !retryError ? retryTelemetry : firstTelemetry;
  if (normalizationDropped(effectiveTelemetry)) warningCodes.add("normalization_drop");
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
      tokenCountApproximate: stateProjection.telemetry.tokenCountApproximate || (result.providerInputTokens === null && inputMeasurement.approximate),
      tokenCountFallback: stateProjection.telemetry.tokenCountFallback || (result.providerInputTokens === null && inputMeasurement.fallback),
      nontrivial,
      attempts,
      retryReason: attempts === 2 ? operationRetry ? "invalid_operations" : "empty_nontrivial_batch" : null,
      first: firstTelemetry,
      retry: retryTelemetry,
      finalActorMentions: finalAnalysis.actorMentions.length,
      finalChanges: finalAnalysis.changes.length,
      finalOperations: operationCounts(finalAnalysis.changes),
      warningCodes: [...warningCodes],
      retryError,
    },
  };
}

const SEED_SYSTEM_PROMPT = [
  "You draft reusable LumiMind character-card seeds.",
  "Call the required LumiMind result tool exactly once. Extract enduring characterization from the card without inventing events, relationships, or secrets not supported by the card.",
  "The seed must be concise, portable across new chats, and written as private subjective state rather than visible roleplay prose.",
].join("\n");

async function generateSeedDraftOnce(input: ControllerHooks & {
  character: unknown;
  settings: LumiMindSettings;
  userId: string;
}): Promise<MindSeedV1> {
  const prompt = [
    "Draft a reusable mind seed from this character card:",
    `<character_card>\n${JSON.stringify(input.character)}\n</character_card>`,
    "Use schemaVersion 1 and updatedAt equal to the current Unix time in milliseconds.",
  ].join("\n\n").slice(0, 80_000);
  const result = await quietJson(prompt, SEED_SYSTEM_PROMPT, "lumi_mind_seed_v1", SEED_SCHEMA, input.settings, input.userId, input.fallbackConnectionId, undefined, input.signal, input.onProgress, input.chatId);
  const normalized = normalizeSeed(result.parsed);
  if (!normalized || !Object.keys(asObject(asObject(result.parsed).core)).length) throw new UnusableControllerOutput("The LumiMind controller returned an invalid mind seed.");
  if (!normalized.core.selfConcept && ![...normalized.core.values, ...normalized.core.desires, ...normalized.core.fears, ...normalized.core.boundaries, ...normalized.core.notes,
    ...normalized.startingBeliefs, ...normalized.startingSecrets, ...normalized.startingGoals, ...normalized.relationshipPriors].length) {
    throw new UnusableControllerOutput("The LumiMind controller returned an empty mind seed.");
  }
  return { ...makeEmptySeed(), ...normalized, schemaVersion: 1, updatedAt: Date.now() };
}

const NPC_CORE_SYSTEM_PROMPT = [
  "You draft editable LumiMind enduring frames for timeline NPCs from user-provided lore.",
  "Call the required LumiMind result tool exactly once. Use only characterization supported by the lore; do not invent events, relationships, secrets, or temporary scene state.",
  "Write a concise private subjective frame covering stable self-concept, values, desires, fears, boundaries, and other enduring notes.",
].join("\n");

async function generateNpcCoreDraftOnce(input: ControllerHooks & {
  actorName: string;
  lore: string;
  settings: LumiMindSettings;
  userId: string;
}): Promise<MindCore> {
  const lore = input.lore.trim();
  if (!lore) throw new LocalControllerError("NPC lore is required to generate a core draft.");
  const boundedLore = lore.slice(0, 75_000);
  const prompt = [
    `Draft an enduring frame for the timeline NPC named ${JSON.stringify(input.actorName.trim() || "Unnamed NPC")}.`,
    `<npc_lore>\n${boundedLore}\n</npc_lore>`,
    "Return only characterization supported by this lore.",
  ].join("\n\n");
  const result = await quietJson(prompt, NPC_CORE_SYSTEM_PROMPT, "lumi_mind_npc_core_v1", CORE_SCHEMA, input.settings, input.userId, input.fallbackConnectionId, undefined, input.signal, input.onProgress, input.chatId);
  const raw = asObject(result.parsed);
  if (!Object.keys(raw).length) throw new UnusableControllerOutput("The LumiMind controller returned an invalid NPC core draft.");
  const core = normalizeCore(raw);
  if (!core.selfConcept && !core.values.length && !core.desires.length && !core.fears.length && !core.boundaries.length && !core.notes.length) {
    throw new UnusableControllerOutput("The LumiMind controller returned an empty NPC core draft.");
  }
  return core;
}

export function composeNpcCoreLore(description: string, facts: string[], notes = ""): string {
  const sections: string[] = [];
  const cleanDescription = description.trim();
  const cleanFacts = uniqueStrings(facts);
  const cleanNotes = notes.trim();
  if (cleanDescription) sections.push(`Cortex description:\n${cleanDescription}`);
  if (cleanFacts.length) sections.push(`Cortex facts:\n${cleanFacts.map((fact) => `- ${fact}`).join("\n")}`);
  if (cleanNotes) sections.push(`${sections.length ? "User-provided supplemental lore" : "User-provided lore"}:\n${cleanNotes}`);
  return sections.join("\n\n");
}

const TIDY_SYSTEM_PROMPT = [
  "Compare one actor's complete current LumiMind checkpoint against the supplied committed chat history and return all warranted edits as separate proposals for explicit human approval.",
  "Call the required result tool exactly once. Do not directly rewrite state and do not propose identity, alias, actor-merge, or Cortex-link changes.",
  "Use replace_core only for a complete improved enduring core; do not place temporary scene state in the core.",
  "Use add_item for strongly supported missing state, update_item for one existing entry, merge_items for two or more semantic duplicates, and remove_items only for entries that should not remain in the ledger.",
  "A status change or category correction is an update_item. Copy actor and item IDs exactly. Preserve target, concealment, intensity, and dimensions unless the evidence supports changing them.",
  "Locked, manual, seed, and pinned entries may be flagged because a human will review every proposal, but explain clearly why changing protected material is warranted.",
  "Read the supplied history chronologically and compare its latest supported state against every current entry and the core. Find missing, outdated, contradictory, mislabeled, and duplicate state. Mark achieved goals resolved, renounced plans abandoned, and evolved state updated rather than deleted.",
  "The history is selected using the user's Chat history setting: 0 means all committed history, otherwise only the latest N messages. Use its stated scope and stored evidence; do not infer unsupported events or treat absence from a limited window as proof an entry is wrong.",
  "Return independently applicable, non-overlapping proposals. Do not propose multiple competing edits to the same entry or core. Explain the evidence and relevant message numbers in each rationale. No edit will be applied until the user approves it.",
].join("\n");

function normalizeTidyItem(value: unknown, knownActorIds: Set<string>): MindTidyItemDraft | null {
  const raw = asObject(value);
  const normalizedCategory = category(raw.category);
  const normalizedText = text(raw.text);
  const normalizedStatus = raw.status === "active" || raw.status === "resolved" || raw.status === "abandoned" || raw.status === "uncertain"
    ? raw.status
    : null;
  if (!normalizedCategory || !normalizedText || !normalizedStatus) return null;
  const dimensions: Record<string, number> = {};
  for (const [key, entry] of Object.entries(asObject(raw.dimensions))) {
    dimensions[key] = Math.min(1, Math.max(-1, numberValue(entry, 0)));
  }
  const targetActorIds = uniqueStrings(stringArray(raw.targetActorIds));
  const concealedFromActorIds = uniqueStrings(stringArray(raw.concealedFromActorIds));
  if (targetActorIds.some((id) => !knownActorIds.has(id)) || concealedFromActorIds.some((id) => !knownActorIds.has(id))) return null;
  return {
    category: normalizedCategory,
    text: normalizedText,
    status: normalizedStatus,
    targetActorIds,
    concealedFromActorIds,
    intensity: raw.intensity === null || raw.intensity === undefined ? null : Math.min(1, Math.max(0, numberValue(raw.intensity, 0.5))),
    dimensions,
  };
}

async function generateMindTidyProposalsOnce(input: ControllerHooks & {
  actor: ActorRecord;
  mind: ActorMind;
  knownActors: ActorRecord[];
  history: ChatMessageLike[];
  settings: LumiMindSettings;
  userId: string;
  fallbackConnectionId?: string | null;
  signal?: AbortSignal;
}): Promise<MindTidyProposal[]> {
  const knownActorIds = new Set(input.knownActors.map((actor) => actor.id));
  const itemIds = new Set(input.mind.items.map((item) => item.id));
  const statePayload = {
    actor: {
      id: input.actor.id,
      name: input.actor.canonicalName,
      aliases: input.actor.aliases,
      kind: input.actor.kind,
      confirmed: input.actor.confirmed,
    },
    core: input.mind.core,
    items: input.mind.items,
    knownActors: input.knownActors.map((actor) => ({ id: actor.id, name: actor.canonicalName, aliases: actor.aliases })),
  };
  const stateJson = JSON.stringify(statePayload);
  const connection = await resolveConnection(input.settings, input.userId, input.fallbackConnectionId, input.signal);
  const stateMeasurement = await countTextTokens(stateJson, connection, input.userId, input.signal);
  if (input.settings.analysisStateTokenBudget > 0 && stateMeasurement.totalTokens > input.settings.analysisStateTokenBudget) {
    throw new LocalControllerError(
      `This actor needs ${stateMeasurement.totalTokens.toLocaleString()} state tokens, above the ${input.settings.analysisStateTokenBudget.toLocaleString()} tidy limit. Increase Analysis state tokens or set it to 0.`,
    );
  }
  const prompt = [
    "Actor registry and complete current checkpoint:",
    `<tidy_state>\n${stateJson}\n</tidy_state>`,
    `Review history: ${input.history.length} committed messages; Chat history setting: ${input.settings.chatHistoryMessageLimit === 0 ? "all committed history" : `latest ${input.settings.chatHistoryMessageLimit} messages`}. Message index attributes are zero-based; cite index + 1 as the message number in rationales.`,
    `<chat_history>\n${renderMessages(input.history)}\n</chat_history>`,
    "Return only meaningful proposals. An empty proposals array is correct when the checkpoint is already coherent.",
  ].join("\n\n");
  const result = await quietJson(
    prompt,
    TIDY_SYSTEM_PROMPT,
    "lumi_mind_tidy_v1",
    TIDY_SCHEMA,
    input.settings,
    input.userId,
    input.fallbackConnectionId,
    connection,
    input.signal,
    input.onProgress,
    input.chatId,
  );
  input.signal?.throwIfAborted();
  const raw = asObject(result.parsed);
  if (!Array.isArray(raw.proposals)) throw new UnusableControllerOutput("The LumiMind controller returned an invalid tidy result.");
  const proposals = raw.proposals.flatMap((entry) => {
    const proposal = asObject(entry);
    if (text(proposal.actorId) !== input.actor.id) return [];
    const finding = proposal.finding === "missing" || proposal.finding === "mislabeled" || proposal.finding === "outdated" || proposal.finding === "duplicate" || proposal.finding === "inconsistent"
      ? proposal.finding
      : null;
    const operation = proposal.operation === "replace_core" || proposal.operation === "add_item" || proposal.operation === "update_item" || proposal.operation === "merge_items" || proposal.operation === "remove_items"
      ? proposal.operation
      : null;
    const rationale = text(proposal.rationale);
    if (!finding || !operation || !rationale) return [];
    const rawTargetItemIds = uniqueStrings(stringArray(proposal.targetItemIds));
    if (rawTargetItemIds.some((id) => !itemIds.has(id))) return [];
    const targetItemIds = rawTargetItemIds;
    const rawCore = asObject(proposal.core);
    const core = operation === "replace_core" && Object.keys(rawCore).length ? normalizeCore(rawCore) : null;
    const item = operation === "add_item" || operation === "update_item" || operation === "merge_items"
      ? normalizeTidyItem(proposal.item, knownActorIds)
      : null;
    const valid = operation === "replace_core"
      ? !!core && targetItemIds.length === 0
      : operation === "add_item"
        ? !!item && targetItemIds.length === 0
        : operation === "update_item"
          ? !!item && targetItemIds.length === 1
          : operation === "merge_items"
            ? !!item && targetItemIds.length >= 2
            : targetItemIds.length > 0;
    if (!valid) return [];
    return [{
      id: `tidy:${crypto.randomUUID()}`,
      actorId: input.actor.id,
      finding,
      operation,
      rationale,
      confidence: Math.min(1, Math.max(0, numberValue(proposal.confidence, 0.75))),
      targetItemIds,
      core,
      item,
    } satisfies MindTidyProposal];
  });
  if (raw.proposals.length && !proposals.length) throw new UnusableControllerOutput("The LumiMind controller returned no valid tidy proposals.");
  return proposals;
}

interface ControllerHooks {
  chatId?: string | null;
  onProgress?: (phase: ControllerPhase) => void;
  onRun?: (run: ControllerRun) => void;
  fallbackConnectionId?: string | null;
  signal?: AbortSignal;
}

class UnusableControllerOutput extends Error {}
class LocalControllerError extends Error {}
const lastControllerRuns = new Map<string, ControllerRun>();
export function getLastControllerRun(userId: string): ControllerRun | null {
  return lastControllerRuns.get(userId) ?? null;
}

function permissionFailure(error: unknown): boolean {
  const value = asObject(error);
  const message = error instanceof Error ? error.message : "";
  return value.code === "PERMISSION_DENIED" || /permission (?:denied|required|not granted)|missing .*permission/i.test(message);
}

async function withFallbacks<T>(input: {
  settings: LumiMindSettings; userId: string; fallbackConnectionId?: string | null; signal?: AbortSignal; onProgress?: (phase: ControllerPhase) => void; onRun?: (run: ControllerRun) => void;
}, operation: string, run: (settings: LumiMindSettings) => Promise<T>, usable: (result: T) => boolean = () => true): Promise<T> {
  const targets: ControllerTarget[] = [
    { connectionId: input.settings.controllerConnectionId ?? input.fallbackConnectionId ?? null, model: input.settings.controllerModel },
    ...(input.settings.controllerFallbacks ?? []).slice(0, 3),
  ].filter((entry, index, entries) => entries.findIndex((other) => other.connectionId === entry.connectionId && other.model === entry.model) === index);
  const attempts: ControllerAttempt[] = [];
  const attemptedTargets = new Set<string>();
  let partial: { result: T; target: ControllerTarget } | null = null;
  let lastError: unknown;
  const finish = (result: T, selected: ControllerTarget): T => {
    const report = { operation, attempts, selected };
    lastControllerRuns.set(input.userId, report);
    input.onRun?.(report);
    if (operation === "Analysis") (result as AnalysisControllerResult).telemetry.connectionAttempts = attempts;
    return result;
  };
  for (const target of targets) {
    input.signal?.throwIfAborted();
    const settings = { ...input.settings, controllerConnectionId: target.connectionId, controllerModel: target.model, controllerFallbacks: [] };
    let connection: ResolvedConnection = { id: target.connectionId, provider: null, model: target.model };
    try {
      input.onProgress?.("preparing");
      connection = await resolveConnection(settings, input.userId, input.fallbackConnectionId, input.signal);
      const targetKey = JSON.stringify([connection.id, connection.model]);
      if (attemptedTargets.has(targetKey)) continue;
      attemptedTargets.add(targetKey);
      const result = await run(settings);
      input.signal?.throwIfAborted();
      const accepted = usable(result);
      const resolved = { connectionId: connection.id, model: connection.model };
      attempts.push({ ...resolved, provider: connection.provider, outcome: accepted ? "success" : "unusable_output" });
      if (accepted) return finish(result, resolved);
      const analysis = operation === "Analysis" ? (result as AnalysisControllerResult).analysis : null;
      // Preserve the original warning behavior when no backups were configured.
      if (targets.length === 1 || !analysis || analysis.actorMentions.length || analysis.changes.length) partial ??= { result, target: resolved };
      lastError = new UnusableControllerOutput("The configured controllers returned no usable analysis. Try Test controller or choose another connection.");
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error) || error instanceof LocalControllerError || permissionFailure(error)) throw error;
      attempts.push({ connectionId: connection.id, model: connection.model, provider: connection.provider, outcome: error instanceof UnusableControllerOutput ? "unusable_output" : "request_failed" });
      lastError = error;
    }
  }
  if (partial) return finish(partial.result, partial.target);
  const report = { operation, attempts, selected: null };
  lastControllerRuns.set(input.userId, report);
  input.onRun?.(report);
  // Provider exceptions can contain request bodies and credentials. Keep details out of UI/diagnostics.
  throw new Error(lastError instanceof UnusableControllerOutput || lastError instanceof ControllerRequestTimeoutError ? lastError.message : "All configured LumiMind controllers failed. Check the connections and try Test controller.");
}

export function analyzeMessages(input: Parameters<typeof analyzeMessagesOnce>[0] & ControllerHooks): Promise<AnalysisControllerResult> {
  return withFallbacks(input, "Analysis", (settings) => analyzeMessagesOnce({ ...input, settings }), (result) => {
    if (result.telemetry.warningCodes.includes("empty_nontrivial_batch")) return false;
    const effective = result.telemetry.retry && !result.telemetry.retryError ? result.telemetry.retry : result.telemetry.first;
    const rejectedAllChanges = effective.rawChanges > 0 && result.telemetry.finalChanges === 0 && effective.invalidChangesRejected > 0;
    const rejectedAllMentions = effective.rawActorMentions > 0 && effective.acceptedActorMentions === 0 && result.telemetry.finalActorMentions === 0;
    return !rejectedAllChanges && !rejectedAllMentions;
  });
}

export function generateSeedDraft(input: Parameters<typeof generateSeedDraftOnce>[0] & ControllerHooks): Promise<MindSeedV1> {
  return withFallbacks(input, "Mind Seed", (settings) => generateSeedDraftOnce({ ...input, settings }));
}

export function generateNpcCoreDraft(input: Parameters<typeof generateNpcCoreDraftOnce>[0] & ControllerHooks): Promise<MindCore> {
  if (!input.lore.trim()) return Promise.reject(new LocalControllerError("NPC lore is required to generate a core draft."));
  return withFallbacks(input, "NPC core", (settings) => generateNpcCoreDraftOnce({ ...input, settings }));
}

export function generateMindTidyProposals(input: Parameters<typeof generateMindTidyProposalsOnce>[0] & ControllerHooks): Promise<MindTidyProposal[]> {
  return withFallbacks(input, "Tidy", (settings) => generateMindTidyProposalsOnce({ ...input, settings }));
}

export async function testController(input: {
  target: ControllerTarget; settings: LumiMindSettings; userId: string; fallbackConnectionId?: string | null; chatId?: string | null;
}): Promise<ControllerTestResult> {
  const started = Date.now();
  const settings = { ...input.settings, controllerConnectionId: input.target.connectionId, controllerModel: input.target.model, controllerFallbacks: [], personaMindEnabled: true, characterCardDirectorMode: false };
  const connection = await resolveConnection(settings, input.userId, input.fallbackConnectionId);
  const meta = { connectionId: connection.id, provider: connection.provider, model: connection.model };
  try {
    const result = await analyzeMessagesOnce({
      settings, userId: input.userId, fallbackConnectionId: input.fallbackConnectionId, chatId: input.chatId,
      messages: [{ id: "controller-test-scene", role: "assistant", index_in_chat: 0, content: "Mira stands alone outside a locked observatory. She believes her missing notebook is inside because she saw it through the window. She wants to retrieve it before the rain begins. Mira feels worried about the approaching storm and plans to ask the caretaker for a key. No other person is present." }],
      recentContext: [], compactState: [],
    });
    const passed = result.analysis.changes.length > 0;
    const response = result.telemetry.retry?.acceptedChanges ? result.telemetry.retry : result.telemetry.first;
    return { ...meta, passed, elapsedMs: Date.now() - started, outputMode: response.structuredSource ?? response.outputMode,
      message: passed ? "The controller returned usable, evidence-linked analysis for the test scene." : "The controller returned no usable mental-state changes for the test scene." };
  } catch (error) {
    return { ...meta, passed: false, elapsedMs: Date.now() - started, outputMode: null,
      message: error instanceof UnusableControllerOutput || error instanceof ControllerRequestTimeoutError ? error.message : "The test request failed. Check connection access, model availability, and provider limits." };
  }
}
