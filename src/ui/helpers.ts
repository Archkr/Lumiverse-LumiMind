import type {
  ActorMind,
  ActorRecord,
  ControllerBatchTelemetry,
  ControllerWarningCode,
  FrontendState,
  LumiMindSettings,
  MindCategory,
  MindCore,
  MindSeedV1,
  TimelineHealth,
  TimelineView,
} from "../types";

export const MIND_CATEGORIES: MindCategory[] = [
  "belief",
  "secret",
  "goal",
  "plan",
  "emotion",
  "relationship",
  "awareness",
];

export const EMPTY_MIND_CORE: MindCore = {
  selfConcept: "",
  values: [],
  desires: [],
  fears: [],
  boundaries: [],
  notes: [],
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function uniqueLines(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];
  const seen = new Set<string>();
  return raw.flatMap((entry) => {
    const text = entry.trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) return [];
    seen.add(key);
    return [text];
  });
}

export function normalizeMindCore(value: unknown): MindCore {
  const raw = asRecord(value);
  return {
    selfConcept: typeof raw.selfConcept === "string" ? raw.selfConcept.trim() : "",
    values: uniqueLines(raw.values),
    desires: uniqueLines(raw.desires),
    fears: uniqueLines(raw.fears),
    boundaries: uniqueLines(raw.boundaries),
    notes: uniqueLines(raw.notes),
  };
}

export function makeBlankSeed(): MindSeedV1 {
  return {
    schemaVersion: 1,
    core: { ...EMPTY_MIND_CORE },
    startingBeliefs: [],
    startingSecrets: [],
    startingGoals: [],
    relationshipPriors: [],
    updatedAt: Date.now(),
  };
}

export function normalizeMindSeed(value: unknown): MindSeedV1 | null {
  const raw = asRecord(value);
  if (raw.schemaVersion !== 1 && !Object.keys(raw).length) return null;
  const relationshipPriors = Array.isArray(raw.relationshipPriors)
    ? raw.relationshipPriors.flatMap((entry) => {
        const relationship = asRecord(entry);
        const target = typeof relationship.target === "string" ? relationship.target.trim() : "";
        const stance = typeof relationship.stance === "string" ? relationship.stance.trim() : "";
        return target && stance ? [{ target, stance }] : [];
      })
    : [];
  return {
    schemaVersion: 1,
    core: normalizeMindCore(raw.core),
    startingBeliefs: uniqueLines(raw.startingBeliefs),
    startingSecrets: uniqueLines(raw.startingSecrets),
    startingGoals: uniqueLines(raw.startingGoals),
    relationshipPriors,
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

export function readReviewedSeed(extensions: unknown): MindSeedV1 | null {
  const root = asRecord(extensions);
  const extension = asRecord(root.lumi_mind);
  const seed = asRecord(extension.seed);
  return normalizeMindSeed(seed.v1);
}

export function writeReviewedSeed(extensions: Record<string, unknown>, seed: MindSeedV1): Record<string, unknown> {
  const extension = asRecord(extensions.lumi_mind);
  const seedContainer = asRecord(extension.seed);
  return {
    ...extensions,
    lumi_mind: {
      ...extension,
      seed: {
        ...seedContainer,
        v1: { ...seed, updatedAt: Date.now() },
      },
    },
  };
}

export function removeReviewedSeed(extensions: Record<string, unknown>): Record<string, unknown> {
  const next = { ...extensions };
  const extension = { ...asRecord(next.lumi_mind) };
  const seed = { ...asRecord(extension.seed) };
  delete seed.v1;
  if (Object.keys(seed).length) extension.seed = seed;
  else delete extension.seed;
  if (Object.keys(extension).length) next.lumi_mind = extension;
  else delete next.lumi_mind;
  return next;
}

export function seedFromCharacterCard(value: unknown): MindSeedV1 {
  const card = asRecord(value);
  const seed = makeBlankSeed();
  seed.core.selfConcept = typeof card.description === "string" ? card.description.trim() : "";
  seed.core.notes = uniqueLines([card.personality, card.creator_notes]);
  return seed;
}

export function cloneSeed(seed: MindSeedV1): MindSeedV1 {
  return {
    ...seed,
    core: {
      ...seed.core,
      values: [...seed.core.values],
      desires: [...seed.core.desires],
      fears: [...seed.core.fears],
      boundaries: [...seed.core.boundaries],
      notes: [...seed.core.notes],
    },
    startingBeliefs: [...seed.startingBeliefs],
    startingSecrets: [...seed.startingSecrets],
    startingGoals: [...seed.startingGoals],
    relationshipPriors: seed.relationshipPriors.map((entry) => ({ ...entry })),
  };
}

export function cloneSettings(settings: LumiMindSettings): LumiMindSettings {
  return { ...settings };
}

export function relationshipLines(seed: MindSeedV1): string {
  return seed.relationshipPriors.map((entry) => `${entry.target} :: ${entry.stance}`).join("\n");
}

export function parseRelationshipLines(value: string): MindSeedV1["relationshipPriors"] {
  return uniqueLines(value).flatMap((line) => {
    const separator = line.indexOf("::");
    if (separator < 1) return [];
    const target = line.slice(0, separator).trim();
    const stance = line.slice(separator + 2).trim();
    return target && stance ? [{ target, stance }] : [];
  });
}

export function healthLabel(health: TimelineHealth): string {
  return ({
    inactive: "Inactive",
    initializing: "Initializing",
    ready: "Current",
    pending: "Analyzing",
    stale: "Using checkpoint",
    paused: "Paused",
    error: "Needs attention",
  } satisfies Record<TimelineHealth, string>)[health];
}

export function healthTone(health: TimelineHealth): "neutral" | "good" | "working" | "warning" | "danger" {
  if (health === "ready") return "good";
  if (health === "initializing" || health === "pending") return "working";
  if (health === "stale" || health === "paused") return "warning";
  if (health === "error") return "danger";
  return "neutral";
}

export function missingAnalysisPermissions(state: FrontendState): string[] {
  const permissions = state.permissions;
  return [
    !permissions.generation ? "Generation" : "",
    !permissions.interceptor ? "Prompt interceptor" : "",
    !permissions.chatMutation ? "Chat history" : "",
  ].filter(Boolean);
}

export function actorInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words.at(-1)?.[0] ?? ""}`).toLocaleUpperCase();
}

export function actorItemCount(mind: ActorMind | undefined): number {
  return mind?.items.filter((item) => item.status === "active" || item.status === "uncertain").length ?? 0;
}

export function findActor(actors: ActorRecord[], actorId: string | null): ActorRecord | null {
  return actors.find((actor) => actor.id === actorId) ?? null;
}

export function formatRelativeTime(timestamp: number | null, now = Date.now()): string {
  if (!timestamp) return "Never";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function compactChatId(chatId: string): string {
  return chatId.length <= 16 ? chatId : `${chatId.slice(0, 7)}…${chatId.slice(-6)}`;
}

export interface TimelineQualitySummary {
  recordCount: number;
  acceptedMentions: number;
  acceptedChanges: number;
  instrumentedBatches: number;
  uninstrumentedRecords: number;
  correctiveAttempts: number;
  emptyNontrivialBatches: number;
  normalizationDrops: number;
  retryFailures: number;
  warningCodes: ControllerWarningCode[];
  legacyEmptyResult: boolean;
  needsAttention: boolean;
  batches: ControllerBatchTelemetry[];
}

export function summarizeTimelineQuality(timeline: TimelineView | null): TimelineQualitySummary {
  const records = timeline?.records ?? [];
  const batchesById = new Map<string, ControllerBatchTelemetry>();
  for (const record of records) {
    const telemetry = record.controller.telemetry;
    if (telemetry) batchesById.set(telemetry.batchId, telemetry);
  }
  const batches = [...batchesById.values()];
  const warningCodes = new Set<ControllerWarningCode>();
  for (const batch of batches) for (const code of batch.warningCodes) warningCodes.add(code);
  const acceptedMentions = records.reduce((sum, record) => sum + record.mentionCount, 0);
  const acceptedChanges = records.reduce((sum, record) => sum + record.changeCount, 0);
  const entryCount = timeline ? Object.values(timeline.minds).reduce((sum, mind) => sum + mind.items.length, 0) : 0;
  const legacyEmptyResult = records.length > 0 && batches.length === 0 && acceptedChanges === 0 && entryCount === 0;
  return {
    recordCount: records.length,
    acceptedMentions,
    acceptedChanges,
    instrumentedBatches: batches.length,
    uninstrumentedRecords: records.filter((record) => !record.controller.telemetry).length,
    correctiveAttempts: batches.filter((batch) => batch.attempts > 1).length,
    emptyNontrivialBatches: batches.filter((batch) => batch.warningCodes.includes("empty_nontrivial_batch")).length,
    normalizationDrops: batches.filter((batch) => batch.warningCodes.includes("normalization_drop")).length,
    retryFailures: batches.filter((batch) => batch.warningCodes.includes("retry_failed")).length,
    warningCodes: [...warningCodes],
    legacyEmptyResult,
    needsAttention: warningCodes.size > 0 || legacyEmptyResult,
    batches,
  };
}
