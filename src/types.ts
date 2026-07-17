export const MIND_SCHEMA_VERSION = 1 as const;
export const ANALYSIS_SCHEMA_VERSION = 1 as const;
export const EXTENSION_KEY = "lumi_mind" as const;

export type ActorKind = "character" | "persona" | "npc";
export type MindCategory = "belief" | "secret" | "goal" | "plan" | "emotion" | "relationship" | "awareness";
export type MindOperation = "add" | "update" | "resolve" | "abandon" | "remove";
export type MindItemStatus = "active" | "resolved" | "abandoned" | "uncertain";
export type MindCoreField = keyof MindCore;

export interface EvidenceRef {
  messageId: string;
  swipeId: number;
  excerpt: string;
  messageIndex: number;
}

export interface MindCore {
  selfConcept: string;
  values: string[];
  desires: string[];
  fears: string[];
  boundaries: string[];
  notes: string[];
}

export interface MindSeedV1 {
  schemaVersion: 1;
  core: MindCore;
  startingBeliefs: string[];
  startingSecrets: string[];
  startingGoals: string[];
  relationshipPriors: Array<{ target: string; stance: string }>;
  updatedAt: number;
}

export interface ActorRecord {
  id: string;
  kind: ActorKind;
  canonicalName: string;
  aliases: string[];
  characterId: string | null;
  personaId: string | null;
  cortexEntityId: string | null;
  confidence: number;
  confirmed: boolean;
  present: boolean;
  firstSeenMessageId: string | null;
  lastSeenMessageId: string | null;
  updatedAt: number;
}

export interface MindItem {
  id: string;
  category: MindCategory;
  text: string;
  status: MindItemStatus;
  confidence: number;
  targetActorIds: string[];
  concealedFromActorIds: string[];
  intensity: number | null;
  dimensions: Record<string, number>;
  evidence: EvidenceRef;
  locked: boolean;
  pinned: boolean;
  source: "controller" | "manual" | "seed";
  createdAt: number;
  updatedAt: number;
}

export interface ActorMind {
  actorId: string;
  core: MindCore;
  items: MindItem[];
  sceneSummary: string;
  attention: string;
  presentActorIds: string[];
  lastUpdatedMessageId: string | null;
}

export interface ActorMentionDelta {
  ref: string;
  name: string;
  aliases: string[];
  kind: ActorKind;
  confidence: number;
  present: boolean;
  evidence: EvidenceRef;
}

export interface MindDelta {
  id: string;
  subjectActorId: string;
  category: MindCategory;
  operation: MindOperation;
  targetItemId: string | null;
  text: string;
  status: MindItemStatus;
  confidence: number;
  targetActorIds: string[];
  concealedFromActorIds: string[];
  intensity: number | null;
  dimensions: Record<string, number>;
  evidence: EvidenceRef;
  createdAt: number;
}

export interface AnalysisRecord {
  id: string;
  analysisVersion: 1;
  messageId: string;
  messageIndex: number;
  swipeId: number;
  contentHash: string;
  prefixHash: string;
  actorMentions: ActorMentionDelta[];
  deltas: MindDelta[];
  skipReason?: "unmanaged_user_message";
  controller: {
    connectionId: string | null;
    provider: string | null;
    model: string | null;
    telemetry?: ControllerBatchTelemetry;
  };
  createdAt: number;
}

export type ControllerWarningCode = "empty_nontrivial_batch" | "normalization_drop" | "retry_failed";

export interface ControllerResponseTelemetry {
  responseChars: number;
  responseHash: string;
  rawActorMentions: number;
  rawChanges: number;
  acceptedActorMentions: number;
  acceptedChanges: number;
}

export interface ControllerBatchTelemetry {
  schemaVersion: 1;
  batchId: string;
  messageCount: number;
  inputChars: number;
  nontrivial: boolean;
  attempts: number;
  retryReason: "empty_nontrivial_batch" | null;
  first: ControllerResponseTelemetry;
  retry: ControllerResponseTelemetry | null;
  finalActorMentions: number;
  finalChanges: number;
  warningCodes: ControllerWarningCode[];
  retryError: string | null;
}

export interface ManualOverride {
  id: string;
  actorId: string;
  operation: "upsert" | "remove";
  item: MindItem | null;
  targetItemId: string | null;
  createdAt: number;
}

export type TimelineHealth = "inactive" | "initializing" | "ready" | "pending" | "stale" | "paused" | "error";

export interface ChatTimelineV1 {
  schemaVersion: 1;
  chatId: string;
  analysisPolicyHash: string;
  active: boolean;
  paused: boolean;
  revision: number;
  health: TimelineHealth;
  error: string | null;
  actors: Record<string, ActorRecord>;
  baseMinds: Record<string, ActorMind>;
  minds: Record<string, ActorMind>;
  records: AnalysisRecord[];
  manualOverrides: ManualOverride[];
  lastValidMessageIndex: number;
  lastAnalyzedAt: number | null;
  updatedAt: number;
}

export interface LumiMindSettings {
  controllerConnectionId: string | null;
  controllerTemperature: number;
  controllerMaxTokens: number;
  injectionTokenBudget: number;
  secondaryActorLimit: number;
  personaMindEnabled: boolean;
  characterCardDirectorMode: boolean;
  cortexImportEnabled: boolean;
  cortexWritebackEnabled: boolean;
  privateInteropEnabled: boolean;
  spoilerSafe: boolean;
}

export interface PermissionState {
  generation: boolean;
  interceptor: boolean;
  chats: boolean;
  chatMutation: boolean;
  characters: boolean;
  personas: boolean;
  memories: boolean;
}

export interface ConnectionOption {
  id: string;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
  hasApiKey: boolean;
}

export interface PublicSceneActorV1 {
  id: string;
  kind: ActorKind;
  name: string;
  aliases: string[];
  present: boolean;
  confirmed: boolean;
  publicStance: string;
}

export interface PublicSceneSnapshotV1 {
  schemaVersion: 1;
  chatId: string | null;
  revision: number;
  stale: boolean;
  generatedAt: number;
  actors: PublicSceneActorV1[];
}

export interface PrivateSceneSnapshotV1 extends PublicSceneSnapshotV1 {
  minds: Record<string, ActorMind>;
}

export interface TimelineView {
  chatId: string;
  active: boolean;
  paused: boolean;
  revision: number;
  health: TimelineHealth;
  error: string | null;
  actors: ActorRecord[];
  minds: Record<string, ActorMind>;
  records: Array<Pick<AnalysisRecord, "id" | "messageId" | "messageIndex" | "swipeId" | "createdAt"> & {
    changeCount: number;
    mentionCount: number;
    controller: {
      provider: string | null;
      model: string | null;
      dedicatedConnection: boolean;
      telemetry: ControllerBatchTelemetry | null;
    };
  }>;
  lastValidMessageIndex: number;
  lastAnalyzedAt: number | null;
  updatedAt: number;
}

export interface FrontendState {
  settings: LumiMindSettings;
  permissions: PermissionState;
  connections: ConnectionOption[];
  activeChatId: string | null;
  activeCharacterId: string | null;
  timeline: TimelineView | null;
}

export type FrontendToBackend =
  | { type: "ready"; chatId?: string | null; characterId?: string | null }
  | { type: "refresh"; chatId?: string | null; characterId?: string | null }
  | { type: "activate"; chatId: string }
  | { type: "pause"; chatId: string; paused: boolean }
  | { type: "rebuild"; chatId: string }
  | { type: "retry"; chatId: string }
  | { type: "save_settings"; patch: Partial<LumiMindSettings>; chatId?: string | null }
  | { type: "rename_actor"; chatId: string; actorId: string; name: string }
  | { type: "add_alias"; chatId: string; actorId: string; alias: string }
  | { type: "remove_alias"; chatId: string; actorId: string; alias: string }
  | { type: "confirm_actor"; chatId: string; actorId: string }
  | { type: "remove_actor"; chatId: string; actorId: string }
  | { type: "merge_actor"; chatId: string; sourceActorId: string; targetActorId: string }
  | { type: "split_actor"; chatId: string; actorId: string; name: string }
  | { type: "add_item"; chatId: string; actorId: string; category: MindCategory; text: string }
  | { type: "edit_core"; chatId: string; actorId: string; core: MindCore }
  | { type: "edit_item"; chatId: string; actorId: string; itemId: string; text: string; status?: MindItemStatus }
  | { type: "remove_item"; chatId: string; actorId: string; itemId: string }
  | { type: "toggle_item"; chatId: string; actorId: string; itemId: string; field: "locked" | "pinned" }
  | { type: "generate_seed"; characterId: string }
  | { type: "writeback_actor"; chatId: string; actorId: string };

export type BackendToFrontend =
  | { type: "state"; state: FrontendState }
  | { type: "seed_draft"; characterId: string; seed: MindSeedV1 }
  | { type: "notice"; tone: "info" | "success" | "warning" | "error"; message: string }
  | { type: "error"; message: string };

export interface ChatMessageLike {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
  extra?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  swipe_id?: number;
  swipes?: string[];
  index_in_chat?: number;
  created_at?: number;
}

export interface ControllerActorMention {
  ref: string;
  name: string;
  aliases?: string[];
  kind?: ActorKind;
  confidence?: number;
  present?: boolean;
  messageId: string;
}

export interface ControllerChange {
  subjectRef: string;
  category: MindCategory;
  operation: MindOperation;
  targetItemId?: string | null;
  text?: string;
  status?: MindItemStatus;
  confidence?: number;
  targetRefs?: string[];
  concealedFromRefs?: string[];
  intensity?: number | null;
  dimensions?: Record<string, number>;
  messageId: string;
  evidenceExcerpt?: string;
}

export interface ControllerAnalysis {
  actorMentions: ControllerActorMention[];
  changes: ControllerChange[];
}
