import type {
  SpindleCharacterEditorState,
  SpindleFrontendContext,
} from "lumiverse-spindle-types";
import type {
  ActorMind,
  ActorRecord,
  BackendToFrontend,
  FrontendState,
  FrontendToBackend,
  LumiMindSettings,
  MindCategory,
  MindCore,
  MindItem,
  MindItemStatus,
  MindSeedV1,
  TimelineDatabaseArchiveV1,
  TimelineImportMode,
} from "./types";
import {
  MIND_CATEGORIES,
  actorInitials,
  actorItemCount,
  asRecord,
  availableRecentHistoryLimit,
  cloneSeed,
  cloneSettings,
  compactChatId,
  createRequestId,
  findActor,
  formatRelativeTime,
  healthLabel,
  healthTone,
  makeBlankSeed,
  missingAnalysisPermissions,
  normalizeMindCore,
  normalizeMindSeed,
  parseRelationshipLines,
  readReviewedSeed,
  relationshipLines,
  removeReviewedSeed,
  seedFromCharacterCard,
  summarizeTimelineQuality,
  uniqueLines,
  writeReviewedSeed,
} from "./ui/helpers";
import { LUMI_MIND_CSS } from "./ui/styles";
import { redactDiagnosticCredentials } from "./diagnostics";

type LensView = "cast" | "scene" | "history" | "settings";
type NoticeTone = "info" | "success" | "warning" | "error";

interface UiNotice {
  tone: NoticeTone;
  message: string;
}

const MIND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.2 4.2a6.7 6.7 0 0 1 8.4 6.5c0 1.8-.7 3.2-1.8 4.3-.8.8-1.2 1.6-1.2 2.7v.6H8.8v-.9c0-1.2-.5-2-1.4-2.9a5.8 5.8 0 0 1-1.8-4.2c0-1.3.4-2.6 1.1-3.6"/><path d="M9.4 21h4.5"/><path d="M8.4 7.8c1.7-1.6 4.8-1.4 6.2.5"/><path d="M9 11.1c1.2-1.1 3.3-1 4.3.3"/><circle cx="6.5" cy="4.3" r="1.5" fill="currentColor" stroke="none"/></svg>`;

const ICONS: Record<string, string> = {
  refresh: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>`,
  more: `<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.8V14h2.2L13 6.2 9.8 3 2 10.8z"/><path d="M8.8 4l3.2 3.2"/></svg>`,
  plus: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>`,
  lock: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>`,
  unlock: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.4"/><path d="M10.5 7V5a2.5 2.5 0 0 0-4.7-1.2"/></svg>`,
  pin: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2.5h6M6 2.5v4L4.5 8v1h7V8L10 6.5v-4M8 9v4.5"/></svg>`,
  trash: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6 2.5h4l.5 2H5.5l.5-2zM4.5 4.5l.6 9h5.8l.6-9M6.7 7v4M9.3 7v4"/></svg>`,
  chevron: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 6.5L8 9l2.5-2.5"/></svg>`,
  eye: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 8s2.2-3.6 6.2-3.6S14.2 8 14.2 8 12 11.6 8 11.6 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.6"/></svg>`,
  spark: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8c.3 2.5 1.7 3.9 4.2 4.2C9.7 6.3 8.3 7.7 8 10.2 7.7 7.7 6.3 6.3 3.8 6 6.3 5.7 7.7 4.3 8 1.8z"/><path d="M12.5 10c.2 1.3.9 2 2.2 2.2-1.3.2-2 .9-2.2 2.2-.2-1.3-.9-2-2.2-2.2 1.3-.2 2-.9 2.2-2.2z"/></svg>`,
  pause: `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="2.5" height="10" rx=".8"/><rect x="9.5" y="3" width="2.5" height="10" rx=".8"/></svg>`,
  play: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.8v10.4c0 .8.9 1.2 1.5.8l7.1-5.2a1 1 0 0 0 0-1.6L5.5 2c-.6-.4-1.5 0-1.5.8z"/></svg>`,
  close: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
};

const CATEGORY_LABELS: Record<MindCategory, string> = {
  belief: "Beliefs",
  secret: "Secrets",
  goal: "Goals",
  plan: "Plans",
  emotion: "Emotions",
  relationship: "Relationships",
  awareness: "Awareness",
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgIcon(name: string): HTMLSpanElement {
  const node = element("span", "lm-icon");
  node.innerHTML = ICONS[name] ?? "";
  return node;
}

function iconButton(name: string, label: string, onClick: (event: MouseEvent) => void, className = ""): HTMLButtonElement {
  const button = element("button", `lm-icon-btn ${className}`.trim());
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(svgIcon(name));
  button.addEventListener("click", onClick);
  return button;
}

function textButton(label: string, onClick: () => void, variant: "primary" | "secondary" | "danger" | "quiet" = "secondary"): HTMLButtonElement {
  const button = element("button", `lm-button lm-button-${variant}`, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLDivElement {
  const wrapper = element("div", "lm-field");
  wrapper.append(element("label", "lm-label", label), control);
  if (hint) wrapper.appendChild(element("div", "lm-field-hint", hint));
  return wrapper;
}

function input(value: string, placeholder = ""): HTMLInputElement {
  const control = element("input", "lm-input");
  control.value = value;
  control.placeholder = placeholder;
  return control;
}

function textarea(value: string, rows = 4, placeholder = ""): HTMLTextAreaElement {
  const control = element("textarea", "lm-textarea");
  control.value = value;
  control.rows = rows;
  control.placeholder = placeholder;
  return control;
}

function categoryLabel(category: MindCategory): string {
  return CATEGORY_LABELS[category];
}

function actorKindLabel(actor: ActorRecord): string {
  return actor.kind === "npc" ? "Timeline NPC" : actor.kind === "persona" ? "Persona" : "Character card";
}

function safeActiveChat(ctx: SpindleFrontendContext): { chatId: string | null; characterId: string | null } {
  try {
    return ctx.getActiveChat();
  } catch {
    return { chatId: null, characterId: null };
  }
}

export function setup(ctx: SpindleFrontendContext): () => void {
  ctx.deferReady();
  const cleanups: Array<() => void> = [];
  cleanups.push(ctx.dom.addStyle(LUMI_MIND_CSS));

  const drawer = ctx.ui.registerDrawerTab({
    id: "mind-lens",
    title: "LumiMind — Mind Lens",
    shortName: "Mind",
    headerTitle: "Mind Lens",
    description: "Inspect timeline-aware subjective minds, scene awareness, and provenance",
    keywords: ["mind", "beliefs", "secrets", "goals", "cast", "timeline"],
    iconSvg: MIND_ICON,
  });
  cleanups.push(() => drawer.destroy());

  const root = element("div", "lm-root lm-drawer");
  drawer.root.appendChild(root);
  cleanups.push(() => root.remove());

  let currentState: FrontendState | null = null;
  let activeView: LensView = "cast";
  let selectedActorId: string | null = null;
  const mindSectionDisclosure = new Map<string, boolean>();
  const dismissedAnalysisWarnings = new Set<string>();
  let settingsDraft: LumiMindSettings | null = null;
  let settingsDirty = false;
  let notice: UiNotice | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let diagnosticsModal: ReturnType<SpindleFrontendContext["ui"]["showModal"]> | null = null;
  let diagnosticsRefresh: (() => void) | null = null;
  const developerReportRequests = new Map<string, {
    resolve: (report: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  const activationPreviewRequests = new Map<string, {
    resolve: (preview: { messageCount: number; recentMessageLimit: number }) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  const settingsSaveRequests = new Map<string, {
    resolve: (settings: LumiMindSettings) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  const npcCoreDraftRequests = new Map<string, {
    resolve: (core: MindCore) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  const npcCoreGenerating = new Set<string>();
  let settingsRevision = 0;
  let settingsSaving = false;
  let settingsSavePromise: Promise<LumiMindSettings> | null = null;

  let seedTab: ReturnType<SpindleFrontendContext["ui"]["registerCharacterEditorTab"]> | null = null;
  let seedRoot: HTMLElement | null = null;
  let seedEditorUnsub: (() => void) | null = null;
  let seedActivateUnsub: (() => void) | null = null;
  let seedCharacterId: string | null = null;
  let seedDraft: MindSeedV1 | null = null;
  let seedPersisted = false;
  let seedDirty = false;
  let seedLoading = false;
  let seedGenerating = false;
  let seedNotice: UiNotice | null = null;
  let seedLoadVersion = 0;

  function send(message: FrontendToBackend): void {
    try {
      ctx.sendToBackend(message);
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : "LumiMind could not reach its backend.");
    }
  }

  function showNotice(tone: NoticeTone, message: string, ttl = 7000): void {
    if (noticeTimer) clearTimeout(noticeTimer);
    notice = { tone, message };
    render();
    noticeTimer = setTimeout(() => {
      notice = null;
      render();
    }, ttl);
  }

  function syncContext(): void {
    const active = safeActiveChat(ctx);
    send({ type: "refresh", chatId: active.chatId, characterId: active.characterId });
  }

  async function copyText(value: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Fall through to a host-safe selection copy.
    }
    const fallback = element("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "true");
    fallback.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(fallback);
    fallback.focus();
    fallback.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      fallback.remove();
    }
  }

  function downloadDatabaseArchive(archive: TimelineDatabaseArchiveV1): void {
    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = element("a") as HTMLAnchorElement;
    const stamp = new Date(archive.exportedAt).toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `lumimind-timeline-${stamp}.json`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function requestDatabaseExport(): void {
    const chatId = currentState?.activeChatId;
    if (!chatId) {
      showNotice("warning", "Open a chat before exporting its LumiMind database.");
      return;
    }
    send({ type: "export_database", chatId, requestId: createRequestId() });
  }

  async function importDatabaseArchive(archive: TimelineDatabaseArchiveV1): Promise<void> {
    const chatId = currentState?.activeChatId;
    if (!chatId) {
      showNotice("warning", "Open the destination chat before importing a LumiMind database.");
      return;
    }
    const modal = ctx.ui.showModal({ title: "Import LumiMind database", width: 560, maxHeight: 620 });
    const form = element("form", "lm-modal-form");
    const mode = element("select", "lm-select");
    const choices: Array<[TimelineImportMode, string]> = [
      ["checkpoint", "Continue from exported checkpoint"],
      ["full", "Restore full timeline against matching history"],
    ];
    for (const [value, label] of choices) {
      const option = element("option", undefined, label);
      option.value = value;
      mode.appendChild(option);
    }
    form.append(
      element("p", "lm-settings-description", "Importing replaces the LumiMind database for the current chat. The chat transcript itself is never changed."),
      field(
        "Import mode",
        mode,
        "Checkpoint is best for sequels and alternate scenarios. Full timeline is for backups or forks whose messages match the exported transcript positions.",
      ),
    );
    const actions = element("div", "lm-modal-actions");
    actions.append(textButton("Cancel", () => modal.dismiss(), "secondary"), element("button", "lm-button lm-button-primary", "Replace database"));
    (actions.lastElementChild as HTMLButtonElement).type = "submit";
    form.appendChild(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      send({ type: "import_database", chatId, archive, mode: mode.value as TimelineImportMode });
      modal.dismiss();
    });
    modal.root.appendChild(form);
  }

  function chooseDatabaseImport(): void {
    if (!currentState?.activeChatId) {
      showNotice("warning", "Open the destination chat before importing a LumiMind database.");
      return;
    }
    const picker = element("input") as HTMLInputElement;
    picker.type = "file";
    picker.accept = ".json,application/json";
    picker.style.display = "none";
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      picker.remove();
      if (!file) return;
      void file.text().then((text) => {
        const archive = JSON.parse(text) as TimelineDatabaseArchiveV1;
        return importDatabaseArchive(archive);
      }).catch((error) => {
        showNotice("error", error instanceof Error ? `Could not read LumiMind database: ${error.message}` : "Could not read that LumiMind database file.");
      });
    }, { once: true });
    document.body.appendChild(picker);
    picker.click();
  }

  function buildDiagnosticReport(): Record<string, unknown> {
    const state = currentState;
    const timeline = state?.timeline ?? null;
    const actors = timeline?.actors ?? [];
    const minds = timeline ? Object.values(timeline.minds) : [];
    const items = minds.flatMap((mind) => mind.items);
    const quality = summarizeTimelineQuality(timeline);
    const countBy = <T extends string>(values: T[]): Record<string, number> => values.reduce<Record<string, number>>((counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    }, {});
    let editorState: SpindleCharacterEditorState | null = null;
    try {
      if (state?.permissions.characters) editorState = ctx.ui.characterEditor.getState();
    } catch {
      editorState = null;
    }
    const active = safeActiveChat(ctx);
    return {
      reportFormat: "lumi_mind.diagnostics.v1",
      generatedAt: new Date().toISOString(),
      privacy: {
        sanitized: true,
        excluded: ["mind entry text", "beliefs", "secrets", "evidence excerpts", "actor names", "aliases", "API credentials", "full entity IDs"],
      },
      extension: {
        identifier: ctx.manifest.identifier,
        name: ctx.manifest.name,
        version: ctx.manifest.version,
        minimumLumiverseVersion: ctx.manifest.minimum_lumiverse_version ?? null,
      },
      browser: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        online: navigator.onLine,
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      },
      frontend: {
        activeView,
        drawer: ctx.ui.events.getDrawerState(),
        activeChat: {
          available: !!active.chatId,
          reference: active.chatId ? compactChatId(active.chatId) : null,
          characterAvailable: !!active.characterId,
          matchesBackendState: active.chatId === (state?.activeChatId ?? null),
        },
        seedEditor: {
          available: !!seedTab,
          open: editorState?.open ?? false,
          characterAvailable: !!editorState?.characterId,
          draftLoaded: !!seedDraft,
          persisted: seedPersisted,
          dirty: seedDirty,
          loading: seedLoading,
          generating: seedGenerating,
        },
      },
      permissions: state?.permissions ?? null,
      controller: state ? {
        dedicatedConnectionSelected: !!state.settings.controllerConnectionId,
        connectionCount: state.connections.length,
        connections: state.connections.map((connection) => ({
          provider: connection.provider,
          model: connection.model,
          default: connection.isDefault,
          credentialConfigured: connection.hasApiKey,
        })),
        temperature: state.settings.controllerTemperature,
        maxOutputTokens: state.settings.controllerMaxTokens,
        stateTokenBudget: state.settings.analysisStateTokenBudget,
        contextMessageLimit: state.settings.analysisContextMessageLimit,
      } : null,
      injection: state ? {
        presentActorsOnly: true,
        unresolvedStateOnly: true,
        tokenBudget: state.settings.injectionTokenBudget,
        chatHistoryMessageLimit: state.settings.chatHistoryMessageLimit,
        interceptorAvailable: state.permissions.interceptor,
        lastProjection: state.lastInjectionProjection ?? null,
      } : null,
      features: state ? {
        spoilerSafe: state.settings.spoilerSafe,
        personaMind: state.settings.personaMindEnabled,
        characterCardMode: state.settings.characterCardDirectorMode ? "director" : "actor",
        cortexImport: state.settings.cortexImportEnabled,
        cortexWriteback: state.settings.cortexWritebackEnabled,
        privateInterop: state.settings.privateInteropEnabled,
      } : null,
      timeline: timeline ? {
        available: true,
        chatReference: compactChatId(timeline.chatId),
        active: timeline.active,
        paused: timeline.paused,
        revision: timeline.revision,
        health: timeline.health,
        error: timeline.error,
        lastValidMessageIndex: timeline.lastValidMessageIndex,
        lastAnalyzedAt: timeline.lastAnalyzedAt ? new Date(timeline.lastAnalyzedAt).toISOString() : null,
        updatedAt: new Date(timeline.updatedAt).toISOString(),
        actors: {
          total: actors.length,
          byKind: countBy(actors.map((actor) => actor.kind)),
          present: actors.filter((actor) => actor.present).length,
          confirmed: actors.filter((actor) => actor.confirmed).length,
          cortexLinked: actors.filter((actor) => !!actor.cortexEntityId).length,
        },
        minds: {
          total: minds.length,
          entries: items.length,
          byCategory: countBy(items.map((item) => item.category)),
          byStatus: countBy(items.map((item) => item.status)),
          bySource: countBy(items.map((item) => item.source)),
          locked: items.filter((item) => item.locked).length,
          pinned: items.filter((item) => item.pinned).length,
        },
        analysisRecords: {
          total: timeline.records.length,
          quality: {
            acceptedMentions: quality.acceptedMentions,
            acceptedChanges: quality.acceptedChanges,
            instrumentedBatches: quality.instrumentedBatches,
            uninstrumentedRecords: quality.uninstrumentedRecords,
            correctiveAttempts: quality.correctiveAttempts,
            emptyNontrivialBatches: quality.emptyNontrivialBatches,
            normalizationDrops: quality.normalizationDrops,
            retryFailures: quality.retryFailures,
            duplicatesSuppressed: quality.duplicatesSuppressed,
            entriesUpdated: quality.entriesUpdated,
            entriesSuperseded: quality.entriesSuperseded,
            invalidChangesRejected: quality.invalidChangesRejected,
            invalidChangeReasons: quality.invalidChangeReasons,
            warningCodes: quality.warningCodes,
            legacyEmptyResult: quality.legacyEmptyResult,
            needsAttention: quality.needsAttention,
          },
          batches: quality.batches.slice(-10).reverse(),
          recent: timeline.records.slice(-10).reverse().map((record) => ({
            messageIndex: record.messageIndex,
            swipe: record.swipeId,
            mentions: record.mentionCount,
            changes: record.changeCount,
            floodControl: record.reduction,
            controller: {
              provider: record.controller.provider,
              model: record.controller.model,
              dedicatedConnection: record.controller.dedicatedConnection,
              batchId: record.controller.telemetry?.batchId ?? null,
            },
            createdAt: new Date(record.createdAt).toISOString(),
          })),
        },
      } : { available: false },
    };
  }

  function requestDeveloperReport(): Promise<unknown> {
    const requestId = createRequestId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        developerReportRequests.delete(requestId);
        reject(new Error("The developer report request timed out."));
      }, 15_000);
      developerReportRequests.set(requestId, { resolve, reject, timeout });
      send({ type: "developer_report", chatId: currentState?.activeChatId ?? null, requestId });
    });
  }

  function requestActivationPreview(chatId: string): Promise<{ messageCount: number; recentMessageLimit: number }> {
    const requestId = createRequestId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        activationPreviewRequests.delete(requestId);
        reject(new Error("The history check timed out."));
      }, 15_000);
      activationPreviewRequests.set(requestId, { resolve, reject, timeout });
      send({ type: "activation_preview", chatId, requestId });
    });
  }

  function requestSettingsSave(patch: LumiMindSettings, chatId: string | null): Promise<LumiMindSettings> {
    const requestId = createRequestId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        settingsSaveRequests.delete(requestId);
        reject(new Error("Saving LumiMind settings timed out."));
      }, 15_000);
      settingsSaveRequests.set(requestId, { resolve, reject, timeout });
      send({ type: "save_settings", requestId, patch, chatId });
    });
  }

  function requestNpcCoreDraft(chatId: string, actorId: string, lore: string): Promise<MindCore> {
    const requestId = createRequestId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        npcCoreDraftRequests.delete(requestId);
        reject(new Error("The NPC core draft request timed out."));
      }, 120_000);
      npcCoreDraftRequests.set(requestId, { resolve, reject, timeout });
      send({ type: "generate_npc_core", chatId, actorId, lore, requestId });
    });
  }

  function persistSettingsDraft(): Promise<LumiMindSettings> {
    if (settingsSavePromise) return settingsSavePromise;
    if (!settingsDraft) return Promise.reject(new Error("LumiMind settings are not available."));

    const patch = cloneSettings(settingsDraft);
    const revision = settingsRevision;
    settingsSaving = true;
    if (activeView === "settings") render();

    settingsSavePromise = requestSettingsSave(patch, currentState?.activeChatId ?? null)
      .then((settings) => {
        if (currentState) currentState = { ...currentState, settings: cloneSettings(settings) };
        if (settingsRevision === revision) {
          settingsDraft = cloneSettings(settings);
          settingsDirty = false;
        }
        return settings;
      })
      .finally(() => {
        settingsSaving = false;
        settingsSavePromise = null;
        if (activeView === "settings") render();
      });
    return settingsSavePromise;
  }

  async function flushSettingsBeforeActivation(): Promise<void> {
    while (settingsDirty || settingsSaving) await persistSettingsDraft();
  }

  function chooseActivationHistory(
    messageCount: number,
    recentMessageLimit: number,
  ): Promise<"full" | "recent" | null> {
    return new Promise((resolve) => {
      const modal = ctx.ui.showModal({ title: "Choose history to analyze", width: 520, maxHeight: 560 });
      const form = element("div", "lm-modal-form");
      form.appendChild(element(
        "p",
        "lm-activation-text",
        `This chat already has ${messageCount.toLocaleString()} committed messages. Full history may require many background controller calls.`,
      ));
      const availableRecentLimit = availableRecentHistoryLimit(messageCount, recentMessageLimit);
      const canUseRecent = availableRecentLimit !== null;
      form.appendChild(element(
        "p",
        "lm-seed-hint",
        canUseRecent
          ? `Analyze everything, or start with only the most recent ${availableRecentLimit.toLocaleString()} messages from your Chat history setting. Older messages will be intentionally checkpointed as skipped.`
          : "Your Chat history setting is unlimited (or already covers this chat), so there is no smaller configured range. Change that setting first if you want a recent-history option.",
      ));
      const actions = element("div", "lm-modal-actions");
      let settled = false;
      const finish = (choice: "full" | "recent" | null) => {
        if (settled) return;
        settled = true;
        resolve(choice);
        modal.dismiss();
      };
      actions.appendChild(textButton("Cancel", () => finish(null), "secondary"));
      if (canUseRecent) {
        actions.appendChild(textButton(`Recent ${availableRecentLimit.toLocaleString()}`, () => finish("recent"), "secondary"));
      }
      actions.appendChild(textButton("Full history", () => finish("full"), "primary"));
      form.appendChild(actions);
      modal.root.appendChild(form);
      modal.onDismiss(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      });
    });
  }

  function buildDeveloperReport(backend: unknown): Record<string, unknown> {
    let editorState: SpindleCharacterEditorState | null = null;
    try {
      if (currentState?.permissions.characters) editorState = ctx.ui.characterEditor.getState();
    } catch {
      editorState = null;
    }
    return redactDiagnosticCredentials({
      reportFormat: "lumi_mind.developer_diagnostics.v1",
      generatedAt: new Date().toISOString(),
      privacy: {
        sanitized: false,
        containsPrivateData: true,
        excluded: ["API credential values"],
        warning: "Contains full story, identity, mind, evidence, and entity data. Share only with trusted developers.",
      },
      sanitizedOverview: buildDiagnosticReport(),
      extension: {
        identifier: ctx.manifest.identifier,
        name: ctx.manifest.name,
        version: ctx.manifest.version,
        minimumLumiverseVersion: ctx.manifest.minimum_lumiverse_version ?? null,
      },
      browser: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        online: navigator.onLine,
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      },
      frontend: {
        activeView,
        drawer: ctx.ui.events.getDrawerState(),
        activeChat: safeActiveChat(ctx),
        state: currentState,
        settingsDraft,
        seedEditor: {
          state: editorState,
          characterId: seedCharacterId,
          draft: seedDraft,
          persisted: seedPersisted,
          dirty: seedDirty,
          loading: seedLoading,
          generating: seedGenerating,
          notice: seedNotice,
        },
      },
      backend,
    }) as Record<string, unknown>;
  }

  function openDiagnostics(): void {
    if (diagnosticsModal) {
      diagnosticsRefresh?.();
      return;
    }
    const modal = ctx.ui.showModal({ title: "LumiMind Diagnostics", width: 760, maxHeight: 820 });
    diagnosticsModal = modal;
    const shell = element("div", "lm-root lm-diagnostics");
    const intro = element("div", "lm-diagnostics-intro");
    const introCopy = element("div");
    introCopy.append(element("div", "lm-kicker", "Sanitized support report"), element("p", undefined, "Copy this report into a bug report or support conversation. Private mind content and credentials are excluded."));
    introCopy.appendChild(element("p", "lm-diagnostics-private-warning", "Developer copy includes the full transcript, identities, minds, evidence, seeds, overrides, and internal records. Share it only with trusted developers."));
    const privacy = element("span", "lm-diagnostics-privacy", "No story text");
    intro.append(introCopy, privacy);

    const summary = element("div", "lm-diagnostics-summary");
    const output = element("pre", "lm-diagnostics-output");
    const generated = element("span", "lm-diagnostics-generated");
    const toolbar = element("div", "lm-diagnostics-toolbar");
    const copy = textButton("Copy report", () => {
      void copyText(output.textContent ?? "").then((copied) => {
        copy.textContent = copied ? "Copied" : "Copy failed";
        copy.classList.toggle("lm-copy-failed", !copied);
        setTimeout(() => {
          copy.textContent = "Copy report";
          copy.classList.remove("lm-copy-failed");
        }, 1800);
      });
    }, "primary");
    const developerCopy = textButton("Copy developer report", () => {
      developerCopy.disabled = true;
      developerCopy.textContent = "Building developer report…";
      void requestDeveloperReport()
        .then((backend) => copyText(JSON.stringify(buildDeveloperReport(backend), null, 2)))
        .then((copied) => {
          developerCopy.textContent = copied ? "Developer report copied" : "Copy failed";
          developerCopy.classList.toggle("lm-copy-failed", !copied);
        })
        .catch((error) => {
          developerCopy.textContent = "Copy failed";
          developerCopy.classList.add("lm-copy-failed");
          showNotice("error", error instanceof Error ? error.message : "Could not build the developer report.");
        })
        .finally(() => {
          setTimeout(() => {
            developerCopy.disabled = false;
            developerCopy.textContent = "Copy developer report";
            developerCopy.classList.remove("lm-copy-failed");
          }, 1800);
        });
    }, "secondary");
    developerCopy.title = "Copies private story and LumiMind state. API credential fields remain redacted.";
    const refresh = textButton("Refresh snapshot", () => {
      refresh.disabled = true;
      refresh.textContent = "Refreshing…";
      syncContext();
      setTimeout(() => {
        diagnosticsRefresh?.();
        refresh.disabled = false;
        refresh.textContent = "Refresh snapshot";
      }, 350);
    });
    toolbar.append(generated, refresh, developerCopy, copy);
    shell.append(intro, summary, toolbar, output);
    modal.root.appendChild(shell);

    diagnosticsRefresh = () => {
      const report = buildDiagnosticReport();
      const timeline = currentState?.timeline;
      const quality = summarizeTimelineQuality(timeline ?? null);
      summary.replaceChildren();
      const stats: Array<[string, string]> = [
        ["Timeline", timeline ? healthLabel(timeline.health) : "No active timeline"],
        ["Revision", timeline ? String(timeline.revision) : "—"],
        ["Actors", timeline ? String(timeline.actors.length) : "0"],
        ["Analysis", quality.needsAttention ? "Needs attention" : timeline?.records.length ? "Healthy" : "No records"],
      ];
      for (const [label, value] of stats) {
        const stat = element("div", "lm-diagnostic-stat");
        stat.append(element("span", undefined, label), element("strong", undefined, value));
        summary.appendChild(stat);
      }
      output.textContent = JSON.stringify(report, null, 2);
      generated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    };
    diagnosticsRefresh();
    modal.onDismiss(() => {
      diagnosticsModal = null;
      diagnosticsRefresh = null;
    });
  }

  function ensureSelection(): void {
    const actors = currentState?.timeline?.actors ?? [];
    if (!actors.length) {
      selectedActorId = null;
      return;
    }
    if (!findActor(actors, selectedActorId)) {
      selectedActorId = actors.find((actor) => actor.present)?.id ?? actors[0].id;
    }
  }

  function updateBadge(): void {
    const timeline = currentState?.timeline;
    if (!timeline || !timeline.active || timeline.health === "ready") {
      drawer.setBadge(null);
      return;
    }
    drawer.setBadge(timeline.health === "error" ? "!" : timeline.health === "paused" ? "Ⅱ" : "•••");
  }

  function renderHeader(): HTMLElement {
    const header = element("header", "lm-brand-header");
    const mark = element("div", "lm-brand-mark");
    mark.innerHTML = MIND_ICON;
    const identity = element("div", "lm-brand-copy");
    identity.append(element("div", "lm-eyebrow", "LumiMind"), element("div", "lm-brand-title", "Private continuity, in character"));
    const health = currentState?.timeline?.health ?? "inactive";
    const actions = element("div", "lm-header-actions");
    actions.append(
      element("span", `lm-status lm-status-${healthTone(health)}`, healthLabel(health)),
      iconButton("refresh", "Refresh Mind Lens", syncContext),
    );
    header.append(mark, identity, actions);
    return header;
  }

  function renderNotice(): HTMLElement | null {
    if (!notice) return null;
    const banner = element("div", `lm-notice lm-notice-${notice.tone}`);
    banner.append(element("span", "lm-notice-dot"), element("span", "lm-notice-copy", notice.message));
    return banner;
  }

  function renderNav(): HTMLElement {
    const nav = element("nav", "lm-nav");
    const entries: Array<[LensView, string]> = [
      ["cast", "Cast"],
      ["scene", "Scene"],
      ["history", "Changes"],
      ["settings", "Settings"],
    ];
    for (const [id, label] of entries) {
      const button = element("button", `lm-nav-item${activeView === id ? " active" : ""}`, label);
      button.type = "button";
      button.addEventListener("click", () => {
        activeView = id;
        render();
      });
      nav.appendChild(button);
    }
    return nav;
  }

  function renderPermissionState(missing: string[]): HTMLElement {
    const card = element("section", "lm-empty-card lm-permission-card");
    const icon = element("div", "lm-empty-icon");
    icon.innerHTML = MIND_ICON;
    card.append(icon, element("h2", "lm-empty-title", "Mind Lens is waiting for access"));
    card.appendChild(element("p", "lm-empty-copy", "LumiMind stays inert when required permissions are unavailable. Grant the missing access to analyze and inject private continuity."));
    const list = element("div", "lm-permission-list");
    for (const permission of missing) list.appendChild(element("span", "lm-permission-chip missing", permission));
    card.appendChild(list);
    card.appendChild(textButton("Open extension permissions", () => ctx.events.emit("open-settings", { view: "extensions" }), "primary"));
    return card;
  }

  function renderNoChat(): HTMLElement {
    const card = element("section", "lm-empty-card");
    const orbit = element("div", "lm-orbit");
    orbit.append(element("span"), element("span"), element("span"));
    card.append(orbit, element("h2", "lm-empty-title", "Open a conversation"));
    card.appendChild(element("p", "lm-empty-copy", "Mind Lens follows the active timeline. Choose a chat to inspect its cast and explicitly activate analysis."));
    return card;
  }

  function renderActivation(): HTMLElement {
    const timeline = currentState?.timeline;
    const card = element("section", "lm-activation");
    const visual = element("div", "lm-activation-visual");
    visual.innerHTML = `<span class="lm-activation-ring"></span><span class="lm-activation-ring"></span>${MIND_ICON}`;
    const copy = element("div", "lm-activation-copy");
    copy.append(element("div", "lm-kicker", "Private by default"), element("h2", "lm-activation-title", "Awaken this timeline?"));
    copy.appendChild(element("p", "lm-activation-text", "LumiMind will read committed turns in the background and build subjective minds for this chat. Nothing is analyzed until you activate it."));
    const points = element("div", "lm-activation-points");
    points.append(
      element("span", "lm-activation-point", "Timeline-local NPCs"),
      element("span", "lm-activation-point", "Edit-safe replay"),
      element("span", "lm-activation-point", "Spoilers collapsed"),
    );
    copy.append(points);
    const button = textButton("Activate Mind Lens", async () => {
      if (!timeline || button.disabled) return;
      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Checking history…";
      try {
        if (settingsDirty || settingsSaving) {
          button.textContent = "Saving settings…";
          await flushSettingsBeforeActivation();
          button.textContent = "Checking history…";
        }
        const { messageCount, recentMessageLimit } = await requestActivationPreview(timeline.chatId);
        const historyMode = messageCount >= 50
          ? await chooseActivationHistory(messageCount, recentMessageLimit)
          : "full";
        if (!historyMode) return;
        send({
          type: "activate",
          chatId: timeline.chatId,
          historyMode,
          recentMessageLimit: historyMode === "recent" ? recentMessageLimit : undefined,
        });
      } catch (error) {
        showNotice("error", error instanceof Error ? error.message : "LumiMind could not inspect this chat's history.");
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }, "primary");
    button.classList.add("lm-activation-button");
    copy.appendChild(button);
    card.append(visual, copy);
    return card;
  }

  function renderTimelineStatus(): HTMLElement | null {
    const timeline = currentState?.timeline;
    if (!timeline || timeline.health === "ready" || timeline.health === "inactive") return null;
    const panel = element("section", `lm-timeline-status lm-timeline-${healthTone(timeline.health)}`);
    const pulse = element("span", "lm-pulse");
    const copy = element("div", "lm-timeline-status-copy");
    copy.appendChild(element("strong", undefined, healthLabel(timeline.health)));
    const detail = timeline.error
      ?? (timeline.health === "paused"
        ? "Automatic analysis is paused. The last valid checkpoint remains available for injection."
        : `Processed through message ${Math.max(0, timeline.lastValidMessageIndex + 1)}. Normal generation remains available.`);
    copy.appendChild(element("span", undefined, detail));
    const actions = element("div", "lm-inline-actions");
    if (timeline.health === "error") {
      actions.appendChild(textButton("Retry", () => send({ type: "retry", chatId: timeline.chatId }), "quiet"));
    }
    actions.appendChild(textButton(timeline.paused ? "Resume" : "Pause", () => send({ type: "pause", chatId: timeline.chatId, paused: !timeline.paused }), "quiet"));
    panel.append(pulse, copy, actions);
    return panel;
  }

  async function requestTimelineRebuild(chatId: string): Promise<void> {
    const result = await ctx.ui.showConfirm({
      title: "Rebuild LumiMind timeline?",
      message: "Controller-derived records will be recomputed from committed history using the current analysis rules. Manual locked edits remain applied.",
      variant: "warning",
      confirmLabel: "Rebuild",
    });
    if (result.confirmed) send({ type: "rebuild", chatId });
  }

  function renderAnalysisQualityWarning(): HTMLElement | null {
    const timeline = currentState?.timeline ?? null;
    const quality = summarizeTimelineQuality(timeline);
    if (!timeline || !quality.needsAttention) return null;
    const warningKey = `${timeline.chatId}:${quality.legacyEmptyResult}:${quality.batches
      .filter((batch) => batch.warningCodes.length > 0)
      .map((batch) => `${batch.batchId}:${batch.warningCodes.join(",")}`)
      .join("|")}`;
    if (dismissedAnalysisWarnings.has(warningKey)) return null;
    const panel = element("section", "lm-analysis-quality-warning");
    const marker = element("span", "lm-quality-marker", "!");
    const copy = element("div", "lm-timeline-status-copy");
    copy.appendChild(element("strong", undefined, "Analysis completed with limited usable state"));
    const details: string[] = [];
    if (quality.legacyEmptyResult) details.push("Existing records contain no mental-state changes; rebuild to run bootstrap extraction.");
    if (quality.emptyNontrivialBatches) details.push(`${quality.emptyNontrivialBatches} substantive ${quality.emptyNontrivialBatches === 1 ? "batch remained" : "batches remained"} empty after the corrective pass.`);
    if (quality.normalizationDrops) details.push(`${quality.normalizationDrops} ${quality.normalizationDrops === 1 ? "batch had" : "batches had"} structured entries rejected during normalization.`);
    if (quality.retryFailures) details.push(`${quality.retryFailures} corrective ${quality.retryFailures === 1 ? "request failed" : "requests failed"}; the valid first pass was retained.`);
    copy.appendChild(element("span", undefined, details.join(" ")));
    const actions = element("div", "lm-inline-actions");
    actions.append(
      textButton("Diagnostics", openDiagnostics, "quiet"),
      textButton("Rebuild analysis", () => void requestTimelineRebuild(timeline.chatId), "secondary"),
    );
    const dismiss = iconButton("close", "Dismiss analysis warning", () => {
      dismissedAnalysisWarnings.add(warningKey);
      render();
    }, "lm-quality-dismiss");
    panel.append(marker, copy, actions, dismiss);
    return panel;
  }

  function renderActorRail(actors: ActorRecord[], minds: Record<string, ActorMind>): HTMLElement {
    const section = element("section", "lm-actor-rail-section");
    const heading = element("div", "lm-section-heading");
    heading.append(element("div", "lm-section-title", "Cast"), element("span", "lm-count", String(actors.length)));
    section.appendChild(heading);
    const rail = element("div", "lm-actor-rail");
    for (const actor of actors) {
      const button = element("button", `lm-actor-pill${actor.id === selectedActorId ? " active" : ""}`);
      button.type = "button";
      const avatar = element("span", "lm-actor-avatar", actorInitials(actor.canonicalName));
      if (actor.present) avatar.appendChild(element("i", "lm-presence-dot"));
      const copy = element("span", "lm-actor-pill-copy");
      copy.append(element("strong", undefined, actor.canonicalName), element("small", undefined, `${actorItemCount(minds[actor.id])} signals`));
      button.append(avatar, copy);
      button.addEventListener("click", () => {
        selectedActorId = actor.id;
        render();
      });
      rail.appendChild(button);
    }
    section.appendChild(rail);
    return section;
  }

  async function promptText(options: {
    title: string;
    label: string;
    value?: string;
    placeholder?: string;
    hint?: string;
    multiline?: boolean;
    confirmLabel?: string;
  }): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = ctx.ui.showModal({ title: options.title, width: 480, maxHeight: 620 });
      const form = element("form", "lm-modal-form");
      const control = options.multiline
        ? textarea(options.value ?? "", 7, options.placeholder)
        : input(options.value ?? "", options.placeholder);
      form.appendChild(field(options.label, control, options.hint));
      const actions = element("div", "lm-modal-actions");
      const cancel = textButton("Cancel", () => modal.dismiss(), "secondary");
      const confirm = element("button", "lm-button lm-button-primary", options.confirmLabel ?? "Save");
      confirm.type = "submit";
      actions.append(cancel, confirm);
      form.appendChild(actions);
      modal.root.appendChild(form);
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      modal.onDismiss(() => finish(null));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = control.value.trim();
        if (!value) {
          control.setAttribute("aria-invalid", "true");
          control.focus();
          return;
        }
        finish(value);
        modal.dismiss();
      });
      setTimeout(() => control.focus(), 0);
    });
  }

  async function editCore(actor: ActorRecord, mind: ActorMind, draft?: MindCore): Promise<void> {
    const initial = draft ?? mind.core;
    const modal = ctx.ui.showModal({ title: draft ? `${actor.canonicalName} — Review core draft` : `${actor.canonicalName} — Core`, width: 620, maxHeight: 760 });
    const form = element("form", "lm-modal-form lm-core-form");
    if (draft) form.appendChild(element("div", "lm-seed-hint", "Generated from the lore you provided. Review every field; nothing changes until you save this core."));
    const selfConcept = textarea(initial.selfConcept, 5, "How this person understands themself…");
    const values = textarea(initial.values.join("\n"), 4, "One value per line");
    const desires = textarea(initial.desires.join("\n"), 4, "One desire per line");
    const fears = textarea(initial.fears.join("\n"), 4, "One fear per line");
    const boundaries = textarea(initial.boundaries.join("\n"), 4, "One boundary per line");
    const notes = textarea(initial.notes.join("\n"), 4, "One enduring note per line");
    form.append(
      field("Self-concept", selfConcept),
      field("Values", values),
      field("Desires", desires),
      field("Fears", fears),
      field("Boundaries", boundaries),
      field("Notes", notes),
    );
    const actions = element("div", "lm-modal-actions");
    actions.append(textButton("Cancel", () => modal.dismiss()), element("button", "lm-button lm-button-primary", draft ? "Save reviewed core" : "Save core"));
    (actions.lastElementChild as HTMLButtonElement).type = "submit";
    form.appendChild(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const core: MindCore = {
        selfConcept: selfConcept.value.trim(),
        values: uniqueLines(values.value),
        desires: uniqueLines(desires.value),
        fears: uniqueLines(fears.value),
        boundaries: uniqueLines(boundaries.value),
        notes: uniqueLines(notes.value),
      };
      const timeline = currentState?.timeline;
      if (timeline) send({ type: "edit_core", chatId: timeline.chatId, actorId: actor.id, core });
      modal.dismiss();
    });
    modal.root.appendChild(form);
  }

  async function generateNpcCore(actor: ActorRecord): Promise<void> {
    if (actor.kind !== "npc" || npcCoreGenerating.has(actor.id)) return;
    const lore = await promptText({
      title: `${actor.canonicalName} — Generate core draft`,
      label: "NPC lore",
      placeholder: "Describe their background, personality, motivations, fears, values, and boundaries…",
      hint: "This lore is sent to the selected LumiMind controller. The generated enduring frame remains editable and is not saved automatically.",
      multiline: true,
      confirmLabel: "Generate draft",
    });
    const sourceTimeline = currentState?.timeline;
    if (!lore || !sourceTimeline) return;

    npcCoreGenerating.add(actor.id);
    showNotice("info", `Generating an enduring-frame draft for ${actor.canonicalName}…`, 120_000);
    try {
      const core = await requestNpcCoreDraft(sourceTimeline.chatId, actor.id, lore);
      const timeline = currentState?.timeline;
      const currentActor = timeline?.chatId === sourceTimeline.chatId
        ? timeline.actors.find((candidate) => candidate.id === actor.id)
        : null;
      const currentMind = currentActor && timeline ? timeline.minds[currentActor.id] : null;
      if (!currentActor || !currentMind) {
        showNotice("warning", "The NPC draft finished after the active timeline changed. No core was modified.");
        return;
      }
      showNotice("success", "NPC core draft ready for review. Nothing has been saved yet.");
      await editCore(currentActor, currentMind, core);
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : "LumiMind could not generate the NPC core draft.");
    } finally {
      npcCoreGenerating.delete(actor.id);
      render();
    }
  }

  async function editMindItem(actor: ActorRecord, item: MindItem): Promise<void> {
    const modal = ctx.ui.showModal({ title: `Edit ${categoryLabel(item.category).slice(0, -1)}`, width: 520, maxHeight: 620 });
    const form = element("form", "lm-modal-form");
    const content = textarea(item.text, 6, "Subjective state…");
    const status = element("select", "lm-select");
    for (const value of ["active", "uncertain", "resolved", "abandoned"] as MindItemStatus[]) {
      const option = element("option", undefined, value[0].toLocaleUpperCase() + value.slice(1));
      option.value = value;
      option.selected = value === item.status;
      status.appendChild(option);
    }
    form.append(field("State", content), field("Status", status, "Editing an inferred entry makes it user-authored and locks it."));
    const actions = element("div", "lm-modal-actions");
    actions.append(textButton("Cancel", () => modal.dismiss()), element("button", "lm-button lm-button-primary", "Save entry"));
    (actions.lastElementChild as HTMLButtonElement).type = "submit";
    form.appendChild(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = content.value.trim();
      if (!text) return;
      const timeline = currentState?.timeline;
      if (timeline) {
        send({
          type: "edit_item",
          chatId: timeline.chatId,
          actorId: actor.id,
          itemId: item.id,
          text,
          status: status.value as MindItemStatus,
        });
      }
      modal.dismiss();
    });
    modal.root.appendChild(form);
  }

  async function addMindItem(actor: ActorRecord, initialCategory?: MindCategory): Promise<void> {
    const modal = ctx.ui.showModal({ title: `Add state for ${actor.canonicalName}`, width: 520, maxHeight: 620 });
    const form = element("form", "lm-modal-form");
    const category = element("select", "lm-select");
    for (const value of MIND_CATEGORIES) {
      const option = element("option", undefined, categoryLabel(value));
      option.value = value;
      option.selected = value === (initialCategory ?? "belief");
      category.appendChild(option);
    }
    const content = textarea("", 6, "Write a concise, subjective mental-state entry…");
    form.append(field("Section", category), field("State", content, "Manual entries are locked and pinned by default."));
    const actions = element("div", "lm-modal-actions");
    actions.append(textButton("Cancel", () => modal.dismiss()), element("button", "lm-button lm-button-primary", "Add entry"));
    (actions.lastElementChild as HTMLButtonElement).type = "submit";
    form.appendChild(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = content.value.trim();
      const timeline = currentState?.timeline;
      if (!text || !timeline) return;
      send({ type: "add_item", chatId: timeline.chatId, actorId: actor.id, category: category.value as MindCategory, text });
      modal.dismiss();
    });
    modal.root.appendChild(form);
    setTimeout(() => content.focus(), 0);
  }

  function renderCore(actor: ActorRecord, mind: ActorMind): HTMLElement {
    const card = element("section", "lm-core-card");
    const heading = element("div", "lm-card-heading");
    const title = element("div");
    title.append(element("div", "lm-kicker", "Enduring frame"), element("h3", "lm-card-title", "Core self"));
    const actions = element("div", "lm-inline-actions");
    if (actor.kind === "npc") {
      const generate = iconButton("spark", npcCoreGenerating.has(actor.id) ? "Generating core draft" : "Generate core draft from NPC lore", () => void generateNpcCore(actor));
      generate.disabled = npcCoreGenerating.has(actor.id) || !currentState?.permissions.generation;
      actions.appendChild(generate);
    }
    actions.appendChild(iconButton("edit", "Edit core self", () => void editCore(actor, mind)));
    heading.append(title, actions);
    card.appendChild(heading);
    if (mind.core.selfConcept) card.appendChild(element("p", "lm-self-concept", mind.core.selfConcept));
    else card.appendChild(element("p", "lm-empty-inline", "No reviewed self-concept yet."));
    return card;
  }

  function renderItem(actor: ActorRecord, item: MindItem): HTMLElement {
    const row = element("article", `lm-mind-item${item.pinned ? " pinned" : ""}${item.locked ? " locked" : ""}`);
    const main = element("div", "lm-mind-item-main");
    const badges = element("div", "lm-item-badges");
    if (item.status !== "active") badges.appendChild(element("span", `lm-mini-badge status-${item.status}`, item.status));
    if (item.source === "manual" || item.source === "seed") badges.appendChild(element("span", "lm-mini-badge", item.source === "seed" ? "seed" : "manual"));
    if (item.intensity !== null) badges.appendChild(element("span", "lm-mini-badge", `${Math.round(item.intensity * 100)}% intensity`));
    if (badges.childElementCount) main.appendChild(badges);
    main.appendChild(element("p", "lm-item-text", item.text));
    const meta = element("div", "lm-item-meta");
    meta.appendChild(element("span", undefined, `${Math.round(item.confidence * 100)}% confidence`));
    if (item.evidence.messageIndex >= 0) meta.appendChild(element("span", undefined, `Message ${item.evidence.messageIndex + 1} · swipe ${item.evidence.swipeId + 1}`));
    else meta.appendChild(element("span", undefined, item.evidence.excerpt));
    main.appendChild(meta);
    if (item.evidence.excerpt && item.evidence.messageIndex >= 0) {
      const provenance = element("details", "lm-provenance");
      provenance.append(element("summary", undefined, "Evidence"), element("blockquote", undefined, item.evidence.excerpt));
      main.appendChild(provenance);
    }
    const actions = element("div", "lm-item-actions");
    const timeline = currentState?.timeline;
    actions.append(
      iconButton("pin", item.pinned ? "Unpin entry" : "Pin entry", () => {
        if (timeline) send({ type: "toggle_item", chatId: timeline.chatId, actorId: actor.id, itemId: item.id, field: "pinned" });
      }, item.pinned ? "active" : ""),
      iconButton(item.locked ? "lock" : "unlock", item.locked ? "Unlock entry" : "Lock entry", () => {
        if (timeline) send({ type: "toggle_item", chatId: timeline.chatId, actorId: actor.id, itemId: item.id, field: "locked" });
      }, item.locked ? "active" : ""),
      iconButton("edit", "Edit entry", () => void editMindItem(actor, item)),
      iconButton("trash", "Remove entry", () => {
        void (async () => {
          const result = await ctx.ui.showConfirm({
            title: "Remove mental-state entry?",
            message: "This removes the entry from the current folded timeline. Controller evidence remains in the change history.",
            variant: "danger",
            confirmLabel: "Remove",
          });
          if (result.confirmed && timeline) send({ type: "remove_item", chatId: timeline.chatId, actorId: actor.id, itemId: item.id });
        })();
      }, "danger"),
    );
    row.append(main, actions);
    return row;
  }

  function renderMindSection(actor: ActorRecord, mind: ActorMind, category: MindCategory): HTMLElement {
    const items = mind.items.filter((item) => item.category === category);
    const spoiler = currentState?.settings.spoilerSafe && (category === "belief" || category === "secret");
    const section = element("details", `lm-mind-section${spoiler ? " spoiler" : ""}`);
    const disclosureKey = `${currentState?.timeline?.chatId ?? "no-chat"}:${actor.id}:${category}`;
    section.open = mindSectionDisclosure.get(disclosureKey) ?? !spoiler;
    section.addEventListener("toggle", () => mindSectionDisclosure.set(disclosureKey, section.open));
    const summary = element("summary", "lm-mind-section-summary");
    const title = element("span", "lm-mind-section-name");
    title.append(element("strong", undefined, categoryLabel(category)), element("small", undefined, spoiler ? `${items.length} hidden until revealed` : `${items.length} entries`));
    const right = element("span", "lm-summary-right");
    if (spoiler) right.appendChild(svgIcon("eye"));
    right.appendChild(svgIcon("chevron"));
    summary.append(title, right);
    section.appendChild(summary);
    const body = element("div", "lm-mind-section-body");
    if (spoiler) body.appendChild(element("div", "lm-spoiler-warning", `${categoryLabel(category)} may reveal private character knowledge. This affects only the lens display.`));
    const toolbar = element("div", "lm-section-toolbar");
    toolbar.appendChild(textButton(`Add ${categoryLabel(category).slice(0, -1).toLocaleLowerCase()}`, () => void addMindItem(actor, category), "quiet"));
    body.appendChild(toolbar);
    if (!items.length) body.appendChild(element("div", "lm-empty-inline", `No ${categoryLabel(category).toLocaleLowerCase()} in the current checkpoint.`));
    for (const item of items) body.appendChild(renderItem(actor, item));
    section.appendChild(body);
    return section;
  }

  async function mergeActor(actor: ActorRecord, actors: ActorRecord[]): Promise<void> {
    const candidates = actors.filter((candidate) => candidate.id !== actor.id);
    if (!candidates.length) return;
    const modal = ctx.ui.showModal({ title: `Merge ${actor.canonicalName}`, width: 480, maxHeight: 520 });
    const form = element("form", "lm-modal-form");
    const select = element("select", "lm-select");
    for (const candidate of candidates) {
      const option = element("option", undefined, `${candidate.canonicalName} · ${actorKindLabel(candidate)}`);
      option.value = candidate.id;
      select.appendChild(option);
    }
    form.appendChild(field("Keep this identity", select, `${actor.canonicalName} will be folded into the selected actor. Aliases and compatible state are preserved.`));
    const cortexChoice = element("div");
    const cortexSelect = element("select", "lm-select");
    const renderCortexChoice = () => {
      cortexChoice.replaceChildren();
      const target = candidates.find((candidate) => candidate.id === select.value);
      if (!target?.cortexEntityId || !actor.cortexEntityId || target.cortexEntityId === actor.cortexEntityId) return;
      cortexSelect.replaceChildren();
      const keepTarget = element("option", undefined, `Keep ${target.canonicalName}'s Cortex identity`);
      keepTarget.value = "target";
      const keepSource = element("option", undefined, `Keep ${actor.canonicalName}'s Cortex identity`);
      keepSource.value = "source";
      cortexSelect.append(keepTarget, keepSource);
      cortexChoice.appendChild(field(
        "Cortex link",
        cortexSelect,
        "Both actors point to different chat-local Cortex entities. Choose which link LumiMind keeps; the other remains unchanged in Cortex and stays hidden from this timeline.",
      ));
    };
    select.addEventListener("change", renderCortexChoice);
    renderCortexChoice();
    form.appendChild(cortexChoice);
    const actions = element("div", "lm-modal-actions");
    actions.append(textButton("Cancel", () => modal.dismiss()), element("button", "lm-button lm-button-primary", "Merge actors"));
    (actions.lastElementChild as HTMLButtonElement).type = "submit";
    form.appendChild(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const timeline = currentState?.timeline;
      const target = candidates.find((candidate) => candidate.id === select.value);
      const cortexLink = target?.cortexEntityId && actor.cortexEntityId && target.cortexEntityId !== actor.cortexEntityId
        ? cortexSelect.value as "source" | "target"
        : undefined;
      if (timeline) send({
        type: "merge_actor",
        chatId: timeline.chatId,
        sourceActorId: actor.id,
        targetActorId: select.value,
        cortexLink,
      });
      selectedActorId = select.value;
      modal.dismiss();
    });
    modal.root.appendChild(form);
  }

  async function showActorMenu(event: MouseEvent, actor: ActorRecord, actors: ActorRecord[]): Promise<void> {
    const canWriteback = !!currentState?.settings.cortexWritebackEnabled && !!currentState.permissions.memories && actor.confirmed;
    const { selectedKey } = await ctx.ui.showContextMenu({
      position: { x: event.clientX, y: event.clientY },
      items: [
        { key: "rename", label: "Rename actor" },
        { key: "alias", label: "Add alias" },
        { key: "split", label: "Split into a new NPC" },
        { key: "merge", label: "Merge into another actor", disabled: actors.length < 2 },
        { key: "divider-1", label: "", type: "divider" },
        { key: "confirm", label: actor.confirmed ? "Identity confirmed" : "Confirm identity", disabled: actor.confirmed },
        { key: "writeback", label: "Publish identity to Cortex", disabled: !canWriteback },
        { key: "divider-2", label: "", type: "divider" },
        { key: "remove", label: "Remove from this timeline", danger: true },
      ],
    });
    const timeline = currentState?.timeline;
    if (!selectedKey || !timeline) return;
    if (selectedKey === "rename") {
      const value = await promptText({ title: "Rename actor", label: "Canonical name", value: actor.canonicalName });
      if (value) send({ type: "rename_actor", chatId: timeline.chatId, actorId: actor.id, name: value });
    } else if (selectedKey === "alias") {
      const value = await promptText({ title: "Add alias", label: "Alias", placeholder: "Name used in the transcript" });
      if (value) send({ type: "add_alias", chatId: timeline.chatId, actorId: actor.id, alias: value });
    } else if (selectedKey === "split") {
      const value = await promptText({ title: "Split actor", label: "New NPC name", placeholder: "Distinct identity" });
      if (value) send({ type: "split_actor", chatId: timeline.chatId, actorId: actor.id, name: value });
    } else if (selectedKey === "merge") {
      await mergeActor(actor, actors);
    } else if (selectedKey === "confirm") {
      send({ type: "confirm_actor", chatId: timeline.chatId, actorId: actor.id });
    } else if (selectedKey === "writeback") {
      send({ type: "writeback_actor", chatId: timeline.chatId, actorId: actor.id });
    } else if (selectedKey === "remove") {
      const result = await ctx.ui.showConfirm({
        title: `Remove ${actor.canonicalName}?`,
        message: "This removes the identity and its folded mind from this timeline. It does not delete a character card, persona, or Cortex entity.",
        variant: "danger",
        confirmLabel: "Remove actor",
      });
      if (result.confirmed) {
        send({ type: "remove_actor", chatId: timeline.chatId, actorId: actor.id });
        selectedActorId = null;
      }
    }
  }

  function renderActorDetail(actor: ActorRecord, mind: ActorMind): HTMLElement {
    const detail = element("div", "lm-actor-detail");
    const hero = element("section", "lm-actor-hero");
    const avatar = element("div", "lm-hero-avatar", actorInitials(actor.canonicalName));
    if (actor.present) avatar.appendChild(element("i", "lm-presence-dot"));
    const identity = element("div", "lm-hero-identity");
    const titleRow = element("div", "lm-hero-title-row");
    titleRow.append(element("h2", "lm-hero-title", actor.canonicalName));
    if (actor.confirmed) titleRow.appendChild(element("span", "lm-verified", "Confirmed"));
    identity.append(titleRow, element("div", "lm-hero-subtitle", `${actorKindLabel(actor)} · ${Math.round(actor.confidence * 100)}% identity confidence`));
    if (actor.aliases.length) {
      const aliases = element("div", "lm-alias-row");
      for (const alias of actor.aliases) {
        const chip = element("span", "lm-alias-chip");
        chip.appendChild(element("span", undefined, alias));
        const remove = element("button", undefined, "×");
        remove.type = "button";
        remove.title = `Remove alias ${alias}`;
        remove.addEventListener("click", () => {
          const timeline = currentState?.timeline;
          if (timeline) send({ type: "remove_alias", chatId: timeline.chatId, actorId: actor.id, alias });
        });
        chip.appendChild(remove);
        aliases.appendChild(chip);
      }
      identity.appendChild(aliases);
    }
    const menu = iconButton("more", "Actor tools", (event) => void showActorMenu(event, actor, currentState?.timeline?.actors ?? []));
    hero.append(avatar, identity, menu);
    detail.append(hero, renderCore(actor, mind));
    const sections = element("div", "lm-mind-sections");
    for (const category of MIND_CATEGORIES) sections.appendChild(renderMindSection(actor, mind, category));
    detail.appendChild(sections);
    return detail;
  }

  function renderCast(): HTMLElement {
    const timeline = currentState?.timeline;
    const container = element("div", "lm-view lm-cast-view");
    if (!timeline) return container;
    container.appendChild(renderActorRail(timeline.actors, timeline.minds));
    const actor = findActor(timeline.actors, selectedActorId);
    const mind = actor ? timeline.minds[actor.id] : null;
    if (actor && mind) container.appendChild(renderActorDetail(actor, mind));
    else container.appendChild(element("div", "lm-empty-inline lm-large-empty", "LumiMind has not resolved any actors yet. Cast members will appear as initialization advances."));
    return container;
  }

  function renderScene(): HTMLElement {
    const timeline = currentState?.timeline;
    const container = element("div", "lm-view lm-scene-view");
    if (!timeline) return container;
    const present = timeline.actors.filter((actor) => actor.present);
    const heading = element("section", "lm-scene-heading");
    heading.append(element("div", "lm-kicker", "Current checkpoint"), element("h2", "lm-view-title", present.length ? `${present.length} ${present.length === 1 ? "mind" : "minds"} in the room` : "No one is marked present"));
    heading.appendChild(element("p", "lm-view-copy", `Revision ${timeline.revision} · ${timeline.records.length} committed analysis records · updated ${formatRelativeTime(timeline.updatedAt)}`));
    container.appendChild(heading);
    const actors = present.length ? present : timeline.actors;
    const grid = element("div", "lm-scene-grid");
    for (const actor of actors) {
      const mind = timeline.minds[actor.id];
      const card = element("button", "lm-scene-card");
      card.type = "button";
      const top = element("div", "lm-scene-card-top");
      top.append(element("span", "lm-actor-avatar", actorInitials(actor.canonicalName)), element("strong", undefined, actor.canonicalName));
      top.appendChild(element("span", `lm-presence-label${actor.present ? " present" : ""}`, actor.present ? "Present" : "Off-scene"));
      card.appendChild(top);
      if (mind?.attention) card.appendChild(element("p", "lm-scene-attention", mind.attention));
      else if (mind?.sceneSummary) card.appendChild(element("p", "lm-scene-attention", mind.sceneSummary));
      else card.appendChild(element("p", "lm-scene-attention muted", "No explicit attention signal in this checkpoint."));
      const signals = (mind?.items ?? [])
        .filter((item) => item.status === "active" && item.category !== "secret" && item.category !== "belief")
        .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
        .slice(0, 3);
      const list = element("div", "lm-scene-signals");
      for (const signal of signals) {
        const row = element("div", "lm-scene-signal");
        row.append(element("span", undefined, signal.category), element("p", undefined, signal.text));
        list.appendChild(row);
      }
      card.appendChild(list);
      card.addEventListener("click", () => {
        selectedActorId = actor.id;
        activeView = "cast";
        render();
      });
      grid.appendChild(card);
    }
    if (!actors.length) grid.appendChild(element("div", "lm-empty-inline lm-large-empty", "The scene roster will appear after the first analysis pass."));
    container.appendChild(grid);
    return container;
  }

  function renderHistory(): HTMLElement {
    const timeline = currentState?.timeline;
    const container = element("div", "lm-view lm-history-view");
    if (!timeline) return container;
    const heading = element("section", "lm-history-heading");
    const title = element("div");
    title.append(element("div", "lm-kicker", "Deterministic fold"), element("h2", "lm-view-title", "Change timeline"));
    const actions = element("div", "lm-inline-actions");
    actions.append(
      textButton(timeline.paused ? "Resume" : "Pause", () => send({ type: "pause", chatId: timeline.chatId, paused: !timeline.paused }), "quiet"),
      textButton("Rebuild", () => void requestTimelineRebuild(timeline.chatId), "secondary"),
    );
    heading.append(title, actions);
    heading.appendChild(element("p", "lm-view-copy", `Checkpoint through message ${Math.max(0, timeline.lastValidMessageIndex + 1)} · last analyzed ${formatRelativeTime(timeline.lastAnalyzedAt)}`));
    container.appendChild(heading);
    const feed = element("div", "lm-change-feed");
    const records = timeline.records.slice().reverse();
    for (const record of records.slice(0, 200)) {
      const row = element("article", `lm-change-row${record.changeCount ? " changed" : ""}`);
      const marker = element("span", "lm-change-marker");
      const copy = element("div", "lm-change-copy");
      const telemetry = record.controller.telemetry;
      const qualityNote = telemetry?.warningCodes.length ? ` · ${telemetry.warningCodes.join(", ")}` : "";
      copy.append(
        element("strong", undefined, `Message ${record.messageIndex + 1}`),
        element("span", undefined, `Swipe ${record.swipeId + 1} · ${record.mentionCount} ${record.mentionCount === 1 ? "mention" : "mentions"} · ${record.changeCount} ${record.changeCount === 1 ? "change" : "changes"}${qualityNote}`),
      );
      const time = element("time", undefined, formatRelativeTime(record.createdAt));
      row.append(marker, copy, time);
      feed.appendChild(row);
    }
    if (!records.length) feed.appendChild(element("div", "lm-empty-inline lm-large-empty", "No controller deltas have been committed to this branch yet."));
    container.appendChild(feed);
    return container;
  }

  function markSettingsDirty(saveButton: HTMLButtonElement): void {
    settingsDirty = true;
    settingsRevision += 1;
    if (!settingsSaving) {
      saveButton.disabled = false;
      saveButton.textContent = "Save settings";
    }
  }

  function renderToggle(label: string, description: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
    const row = element("label", "lm-toggle-row");
    const copy = element("span", "lm-toggle-copy");
    copy.append(element("strong", undefined, label), element("small", undefined, description));
    const control = element("input") as HTMLInputElement;
    control.type = "checkbox";
    control.checked = checked;
    const visual = element("span", "lm-toggle");
    control.addEventListener("change", () => onChange(control.checked));
    row.append(copy, control, visual);
    return row;
  }

  function renderSettings(): HTMLElement {
    const container = element("div", "lm-view lm-settings-view");
    if (!currentState || !settingsDraft) return container;
    const heading = element("section", "lm-settings-heading");
    heading.append(element("div", "lm-kicker", "Roleplay, controller & privacy"), element("h2", "lm-view-title", "Mind Lens settings"));
    heading.appendChild(element("p", "lm-view-copy", "Settings are user-scoped. Roleplay-mode changes rebuild activated timelines when they are opened."));
    container.appendChild(heading);

    const save = textButton(settingsSaving ? "Saving…" : settingsDirty ? "Save settings" : "Saved", () => {
      void persistSettingsDraft().catch((error) => {
        showNotice("error", error instanceof Error ? error.message : "LumiMind settings could not be saved.");
      });
    }, "primary");
    save.disabled = settingsSaving || !settingsDirty;

    const behavior = element("section", "lm-settings-card");
    behavior.appendChild(element("h3", "lm-settings-title", "Roleplay behavior"));
    behavior.appendChild(element("p", "lm-settings-description", "Choose who LumiMind is allowed to manage. Reviewed seeds and locked manual edits remain stored while disabled actors are excluded from analysis, display, and injection."));
    behavior.appendChild(renderToggle(
      "Manage the active persona",
      "Track and inject a mind for your persona, including during impersonation. Turn this off when you alone control the persona.",
      settingsDraft.personaMindEnabled,
      (checked) => {
        if (!settingsDraft) return;
        settingsDraft.personaMindEnabled = checked;
        markSettingsDirty(save);
      },
    ));
    behavior.appendChild(renderToggle(
      "Character card acts as director",
      "Treat the host card as a narrator rather than an in-scene mind, then track the named characters it portrays as the cast.",
      settingsDraft.characterCardDirectorMode,
      (checked) => {
        if (!settingsDraft) return;
        settingsDraft.characterCardDirectorMode = checked;
        markSettingsDirty(save);
      },
    ));
    const injectionPosition = element("select", "lm-select");
    const injectionPositions: Array<[LumiMindSettings["injectionPosition"], string]> = [
      ["prompt_start", "Start of prompt"],
      ["before_last_user", "Before latest user message"],
      ["prompt_end", "End of prompt"],
    ];
    for (const [value, label] of injectionPositions) {
      const option = element("option", undefined, label);
      option.value = value;
      option.selected = settingsDraft.injectionPosition === value;
      injectionPosition.appendChild(option);
    }
    injectionPosition.addEventListener("change", () => {
      if (!settingsDraft) return;
      settingsDraft.injectionPosition = injectionPosition.value as LumiMindSettings["injectionPosition"];
      markSettingsDirty(save);
    });
    behavior.appendChild(field(
      "Mind block position",
      injectionPosition,
      "Choose where the private LumiMind system block is inserted into the assembled roleplay prompt.",
    ));
    container.appendChild(behavior);

    const controller = element("section", "lm-settings-card");
    controller.appendChild(element("h3", "lm-settings-title", "Analysis controller"));
    const connection = element("select", "lm-select");
    const fallback = element("option", undefined, "Use active Lumiverse connection");
    fallback.value = "";
    fallback.selected = !settingsDraft.controllerConnectionId;
    connection.appendChild(fallback);
    for (const option of currentState.connections) {
      const item = element("option", undefined, `${option.name} · ${option.model || option.provider}`);
      item.value = option.id;
      item.selected = settingsDraft.controllerConnectionId === option.id;
      connection.appendChild(item);
    }
    connection.addEventListener("change", () => {
      if (!settingsDraft) return;
      settingsDraft.controllerConnectionId = connection.value || null;
      markSettingsDirty(save);
    });
    controller.appendChild(field("Connection", connection, "Falls back to the chat's active connection when no dedicated controller is selected."));
    const numberGrid = element("div", "lm-settings-grid");
    const numberSetting = (
      label: string,
      key: "controllerTemperature" | "controllerMaxTokens" | "analysisStateTokenBudget" | "injectionTokenBudget" | "analysisContextMessageLimit" | "chatHistoryMessageLimit",
      min: number,
      max: number | null,
      step: number,
      description?: string,
    ) => {
      const control = element("input", "lm-input") as HTMLInputElement;
      control.type = "number";
      control.min = String(min);
      if (max !== null) control.max = String(max);
      control.step = String(step);
      control.value = String(settingsDraft?.[key] ?? 0);
      control.addEventListener("input", () => {
        if (!settingsDraft) return;
        const parsed = Number(control.value);
        const value = Number.isFinite(parsed)
          ? max === null ? Math.max(min, parsed) : Math.min(max, Math.max(min, parsed))
          : settingsDraft[key];
        settingsDraft[key] = value;
        control.value = String(value);
        markSettingsDirty(save);
      });
      return field(label, control, description);
    };
    numberGrid.append(
      numberSetting("Temperature", "controllerTemperature", 0, 2, 0.05),
      numberSetting(
        "Analysis output tokens",
        "controllerMaxTokens",
        300,
        null,
        100,
        "Maximum output requested for each analysis call. LumiMind does not impose an upper limit; the selected model or provider may still enforce one.",
      ),
      numberSetting(
        "Analysis state tokens",
        "analysisStateTokenBudget",
        0,
        null,
        500,
        "Target token budget for unresolved mind state sent to the controller. Actor identities remain available. Set to 0 for unlimited.",
      ),
      numberSetting(
        "Private injection tokens",
        "injectionTokenBudget",
        0,
        null,
        500,
        "Target token budget for LumiMind state added to the roleplay prompt. Stored state is never deleted. Set to 0 for unlimited.",
      ),
      numberSetting(
        "Analysis context messages",
        "analysisContextMessageLimit",
        0,
        null,
        1,
        "Maximum earlier transcript messages included as context for each analysis batch. Set to 0 for none.",
      ),
      numberSetting(
        "Chat history messages",
        "chatHistoryMessageLimit",
        0,
        null,
        1,
        "Maximum stored chat messages retained in the main generation prompt and the optional recent range offered on first activation. Set to 0 for unlimited.",
      ),
    );
    controller.appendChild(numberGrid);
    container.appendChild(controller);

    const privacy = element("section", "lm-settings-card");
    privacy.appendChild(element("h3", "lm-settings-title", "Privacy & interoperability"));
    const toggles: Array<[string, string, keyof LumiMindSettings]> = [
      ["Spoiler-safe lens", "Collapse beliefs and secrets until deliberately revealed.", "spoilerSafe"],
      ["Import Cortex identities", "Use character entities and aliases only for name resolution.", "cortexImportEnabled"],
      ["Cortex identity writeback", "Allow confirmed names and aliases to be published. Private mind state is never written.", "cortexWritebackEnabled"],
      ["Private extension interop", "Register the chat_mutation-gated private scene snapshot.", "privateInteropEnabled"],
    ];
    for (const [label, description, key] of toggles) {
      privacy.appendChild(renderToggle(label, description, Boolean(settingsDraft[key]), (checked) => {
        if (!settingsDraft) return;
        (settingsDraft[key] as boolean) = checked;
        markSettingsDirty(save);
      }));
    }
    container.appendChild(privacy);

    const database = element("section", "lm-settings-card");
    database.appendChild(element("h3", "lm-settings-title", "Timeline database"));
    database.appendChild(element(
      "p",
      "lm-settings-description",
      "Export the current chat's complete LumiMind timeline, or import one into the current chat to continue a sequel, fork, or alternate scenario.",
    ));
    const databaseActions = element("div", "lm-inline-actions");
    const exportButton = textButton("Export current timeline", requestDatabaseExport, "secondary");
    const importButton = textButton("Import into current chat", chooseDatabaseImport, "secondary");
    exportButton.disabled = !currentState.activeChatId;
    importButton.disabled = !currentState.activeChatId;
    databaseActions.append(exportButton, importButton);
    database.appendChild(databaseActions);
    container.appendChild(database);

    const permissions = element("section", "lm-settings-card");
    const permissionHeading = element("div", "lm-settings-title-row");
    permissionHeading.appendChild(element("h3", "lm-settings-title", "Live capabilities"));
    permissionHeading.appendChild(textButton("Manage permissions", () => ctx.events.emit("open-settings", { view: "extensions" }), "quiet"));
    permissions.appendChild(permissionHeading);
    const list = element("div", "lm-capability-grid");
    const entries: Array<[string, boolean]> = [
      ["Generation", currentState.permissions.generation],
      ["Interceptor", currentState.permissions.interceptor],
      ["Chat history", currentState.permissions.chatMutation],
      ["Characters", currentState.permissions.characters],
      ["Personas", currentState.permissions.personas],
      ["Memory Cortex", currentState.permissions.memories],
    ];
    for (const [label, granted] of entries) {
      const row = element("div", `lm-capability${granted ? " granted" : " denied"}`);
      row.append(element("span", "lm-capability-dot"), element("span", undefined, label), element("strong", undefined, granted ? "Granted" : "Unavailable"));
      list.appendChild(row);
    }
    permissions.appendChild(list);

    const diagnostics = element("section", "lm-settings-card lm-diagnostics-card");
    const diagnosticsHeading = element("div", "lm-settings-title-row");
    const diagnosticsCopy = element("div");
    diagnosticsCopy.append(element("h3", "lm-settings-title", "Diagnostics"), element("p", "lm-settings-description", "Inspect a sanitized snapshot of UI context, permissions, controller availability, timeline health, and aggregate state."));
    diagnosticsHeading.append(diagnosticsCopy, textButton("Open diagnostics", openDiagnostics, "secondary"));
    diagnostics.appendChild(diagnosticsHeading);
    diagnostics.appendChild(element("div", "lm-diagnostics-safe-note", "Safe to share: story text, private mental state, actor names, aliases, evidence, credentials, and full IDs are omitted."));

    container.append(permissions, diagnostics, save);
    return container;
  }

  function render(): void {
    root.replaceChildren();
    root.appendChild(renderHeader());
    const banner = renderNotice();
    if (banner) root.appendChild(banner);
    if (!currentState) {
      const loading = element("div", "lm-loading");
      loading.append(element("span", "lm-loader"), element("span", undefined, "Connecting to LumiMind…"));
      root.appendChild(loading);
      return;
    }
    root.appendChild(renderNav());
    if (activeView === "settings") {
      root.appendChild(renderSettings());
      return;
    }
    const missing = missingAnalysisPermissions(currentState);
    if (missing.length) {
      root.appendChild(renderPermissionState(missing));
      return;
    }
    if (!currentState.activeChatId || !currentState.timeline) {
      root.appendChild(renderNoChat());
      return;
    }
    if (!currentState.timeline.active) {
      root.appendChild(renderActivation());
      return;
    }
    const status = renderTimelineStatus();
    if (status) root.appendChild(status);
    const qualityWarning = renderAnalysisQualityWarning();
    if (qualityWarning) root.appendChild(qualityWarning);
    if (activeView === "scene") root.appendChild(renderScene());
    else if (activeView === "history") root.appendChild(renderHistory());
    else root.appendChild(renderCast());
  }

  function destroySeedTab(): void {
    seedEditorUnsub?.();
    seedActivateUnsub?.();
    seedEditorUnsub = null;
    seedActivateUnsub = null;
    try { seedTab?.destroy(); } catch { /* The host may have removed it after permission revocation. */ }
    seedTab = null;
    seedRoot = null;
    seedCharacterId = null;
    seedDraft = null;
    seedDirty = false;
    seedLoadVersion += 1;
  }

  function ensureSeedTab(): void {
    if (!currentState?.permissions.characters) {
      if (seedTab) destroySeedTab();
      return;
    }
    if (seedTab) return;
    try {
      seedTab = ctx.ui.registerCharacterEditorTab({ id: "mind-seed", title: "Mind Seed" });
      seedRoot = element("div", "lm-root lm-seed-root");
      seedTab.root.appendChild(seedRoot);
      seedEditorUnsub = ctx.ui.characterEditor.onChange((editorState) => syncSeedEditor(editorState));
      seedActivateUnsub = seedTab.onActivate(() => syncSeedEditor(ctx.ui.characterEditor.getState()));
      syncSeedEditor(ctx.ui.characterEditor.getState());
    } catch {
      seedTab = null;
      seedRoot = null;
    }
  }

  function syncSeedEditor(editorState: SpindleCharacterEditorState): void {
    if (!seedRoot) return;
    if (!editorState.open || !editorState.characterId) {
      seedCharacterId = null;
      seedDraft = null;
      seedDirty = false;
      seedLoading = false;
      renderSeedEditor();
      return;
    }
    const reviewed = readReviewedSeed(editorState.extensions);
    if (editorState.characterId !== seedCharacterId) {
      seedCharacterId = editorState.characterId;
      seedDraft = reviewed ? cloneSeed(reviewed) : null;
      seedPersisted = !!reviewed;
      seedDirty = false;
      seedNotice = null;
      seedGenerating = false;
      const version = ++seedLoadVersion;
      if (!reviewed) {
        seedLoading = true;
        renderSeedEditor();
        void ctx.characters.get(editorState.characterId).then((card) => {
          if (version !== seedLoadVersion || editorState.characterId !== seedCharacterId) return;
          seedDraft = seedFromCharacterCard(card);
          seedLoading = false;
          renderSeedEditor();
        }).catch(() => {
          if (version !== seedLoadVersion) return;
          seedDraft = makeBlankSeed();
          seedLoading = false;
          seedNotice = { tone: "warning", message: "Card fields could not be loaded; starting from a blank transient seed." };
          renderSeedEditor();
        });
        return;
      }
    } else if (reviewed && !seedDirty && reviewed.updatedAt !== seedDraft?.updatedAt) {
      seedDraft = cloneSeed(reviewed);
      seedPersisted = true;
    } else if (!reviewed) {
      seedPersisted = false;
    }
    renderSeedEditor();
  }

  function markSeedDirty(): void {
    seedDirty = true;
    if (!seedRoot) return;
    const stateLabel = seedRoot.querySelector(".lm-seed-state");
    if (stateLabel) {
      stateLabel.textContent = "Unsaved review";
      stateLabel.className = "lm-seed-state dirty";
    }
    const save = seedRoot.querySelector<HTMLButtonElement>(".lm-seed-save");
    if (save) save.disabled = false;
  }

  function seedTextField(label: string, value: string, onInput: (value: string) => void, hint?: string, rows = 4): HTMLElement {
    const control = textarea(value, rows);
    control.addEventListener("input", () => {
      onInput(control.value);
      markSeedDirty();
    });
    return field(label, control, hint);
  }

  async function saveSeed(): Promise<void> {
    if (!seedDraft || !seedCharacterId) return;
    const snapshot = cloneSeed({ ...seedDraft, updatedAt: Date.now() });
    try {
      ctx.ui.characterEditor.updateExtensions((extensions) => writeReviewedSeed(extensions, snapshot), { immediate: true });
      await ctx.ui.characterEditor.flush();
      seedDraft = snapshot;
      seedDirty = false;
      seedPersisted = true;
      seedNotice = { tone: "success", message: "Reviewed Mind Seed saved to this character card." };
      renderSeedEditor();
    } catch (error) {
      seedNotice = { tone: "error", message: error instanceof Error ? error.message : "Mind Seed could not be saved." };
      renderSeedEditor();
    }
  }

  async function removeSeed(): Promise<void> {
    if (!seedPersisted) return;
    const result = await ctx.ui.showConfirm({
      title: "Remove reviewed Mind Seed?",
      message: "Future chats will fall back to transient character-card fields. Existing chat timelines are not erased.",
      variant: "danger",
      confirmLabel: "Remove seed",
    });
    if (!result.confirmed) return;
    try {
      ctx.ui.characterEditor.updateExtensions((extensions) => removeReviewedSeed(extensions), { immediate: true });
      await ctx.ui.characterEditor.flush();
      seedPersisted = false;
      seedDirty = false;
      seedNotice = { tone: "success", message: "Reviewed seed removed. The current draft remains transient until saved." };
      renderSeedEditor();
    } catch (error) {
      seedNotice = { tone: "error", message: error instanceof Error ? error.message : "Mind Seed could not be removed." };
      renderSeedEditor();
    }
  }

  function renderSeedEditor(): void {
    if (!seedRoot) return;
    seedRoot.replaceChildren();
    const header = element("header", "lm-seed-header");
    const title = element("div");
    title.append(element("div", "lm-kicker", "Character baseline"), element("h2", "lm-view-title", "Mind Seed"));
    title.appendChild(element("p", "lm-view-copy", "Review enduring traits before they become a reusable baseline. Controller drafts never save themselves."));
    const stateLabel = element("span", `lm-seed-state${seedDirty ? " dirty" : seedPersisted ? " saved" : " transient"}`, seedDirty ? "Unsaved review" : seedPersisted ? "Reviewed & saved" : "Transient card baseline");
    header.append(title, stateLabel);
    seedRoot.appendChild(header);
    if (seedNotice) {
      const banner = element("div", `lm-notice lm-notice-${seedNotice.tone}`);
      banner.append(element("span", "lm-notice-dot"), element("span", "lm-notice-copy", seedNotice.message));
      seedRoot.appendChild(banner);
    }
    if (!seedCharacterId) {
      seedRoot.appendChild(element("div", "lm-empty-card", "Open a character in the editor to review its Mind Seed."));
      return;
    }
    if (seedLoading || !seedDraft) {
      const loading = element("div", "lm-loading");
      loading.append(element("span", "lm-loader"), element("span", undefined, "Preparing transient baseline from card fields…"));
      seedRoot.appendChild(loading);
      return;
    }
    const draft = seedDraft;
    const toolbar = element("div", "lm-seed-toolbar");
    const generate = textButton(seedGenerating ? "Generating draft…" : "Generate draft", () => {
      if (!seedCharacterId || seedGenerating) return;
      seedGenerating = true;
      seedNotice = { tone: "info", message: "The controller is drafting from this character card. Nothing will be saved automatically." };
      renderSeedEditor();
      send({ type: "generate_seed", characterId: seedCharacterId });
    }, "secondary");
    generate.prepend(svgIcon("spark"));
    generate.disabled = seedGenerating || !currentState?.permissions.generation;
    const save = textButton("Save reviewed seed", () => void saveSeed(), "primary");
    save.classList.add("lm-seed-save");
    save.disabled = !seedDirty && seedPersisted;
    toolbar.append(generate, save);
    if (seedPersisted) toolbar.appendChild(textButton("Remove seed", () => void removeSeed(), "danger"));
    seedRoot.appendChild(toolbar);
    if (!currentState?.permissions.generation) {
      seedRoot.appendChild(element("div", "lm-seed-hint warning", "Generation permission is unavailable. You can still review, edit, and save the transient card baseline manually."));
    } else if (!seedPersisted) {
      seedRoot.appendChild(element("div", "lm-seed-hint", "No reviewed seed exists. These values are transient until you choose Save reviewed seed."));
    }

    const form = element("div", "lm-seed-form");
    const core = element("section", "lm-seed-section");
    core.appendChild(element("h3", "lm-seed-section-title", "Core self"));
    core.append(
      seedTextField("Self-concept", draft.core.selfConcept, (value) => { draft.core.selfConcept = value.trim(); }, "A stable first-person identity frame, not a scene summary.", 6),
    );
    const coreGrid = element("div", "lm-seed-grid");
    const arrayField = (label: string, key: "values" | "desires" | "fears" | "boundaries" | "notes", hint: string) =>
      seedTextField(label, draft.core[key].join("\n"), (value) => { draft.core[key] = uniqueLines(value); }, hint, 5);
    coreGrid.append(
      arrayField("Values", "values", "One value per line"),
      arrayField("Desires", "desires", "One enduring desire per line"),
      arrayField("Fears", "fears", "One fear per line"),
      arrayField("Boundaries", "boundaries", "One hard or soft boundary per line"),
      arrayField("Notes", "notes", "Other enduring characterization, one note per line"),
    );
    core.appendChild(coreGrid);
    form.appendChild(core);

    const starting = element("section", "lm-seed-section");
    starting.appendChild(element("h3", "lm-seed-section-title", "Starting subjective state"));
    const startingGrid = element("div", "lm-seed-grid");
    startingGrid.append(
      seedTextField("Beliefs", draft.startingBeliefs.join("\n"), (value) => { draft.startingBeliefs = uniqueLines(value); }, "One supported starting belief per line", 6),
      seedTextField("Secrets", draft.startingSecrets.join("\n"), (value) => { draft.startingSecrets = uniqueLines(value); }, "Only secrets supported by the card", 6),
      seedTextField("Goals", draft.startingGoals.join("\n"), (value) => { draft.startingGoals = uniqueLines(value); }, "One active starting goal per line", 6),
      seedTextField("Relationship priors", relationshipLines(draft), (value) => { draft.relationshipPriors = parseRelationshipLines(value); }, "One per line: Target :: stance", 6),
    );
    starting.appendChild(startingGrid);
    form.appendChild(starting);
    seedRoot.appendChild(form);
  }

  const backendUnsub = ctx.onBackendMessage((payload) => {
    const message = payload as BackendToFrontend;
    if (message.type === "state") {
      currentState = message.state;
      if (!settingsDraft || !settingsDirty) {
        settingsDraft = cloneSettings(message.state.settings);
        settingsDirty = false;
      }
      ensureSelection();
      ensureSeedTab();
      updateBadge();
      render();
      diagnosticsRefresh?.();
    } else if (message.type === "developer_report" || message.type === "developer_report_error") {
      const pending = developerReportRequests.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      developerReportRequests.delete(message.requestId);
      if (message.type === "developer_report") pending.resolve(message.report);
      else pending.reject(new Error(message.message));
    } else if (message.type === "database_export") {
      downloadDatabaseArchive(message.archive);
      showNotice("success", "LumiMind timeline database exported.");
    } else if (message.type === "activation_preview" || message.type === "activation_preview_error") {
      const pending = activationPreviewRequests.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      activationPreviewRequests.delete(message.requestId);
      if (message.type === "activation_preview") pending.resolve({
        messageCount: message.messageCount,
        recentMessageLimit: message.recentMessageLimit,
      });
      else pending.reject(new Error(message.message));
    } else if (message.type === "settings_saved" || message.type === "settings_save_error") {
      const pending = settingsSaveRequests.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      settingsSaveRequests.delete(message.requestId);
      if (message.type === "settings_saved") pending.resolve(message.settings);
      else pending.reject(new Error(message.message));
    } else if (message.type === "npc_core_draft" || message.type === "npc_core_draft_error") {
      const pending = npcCoreDraftRequests.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      npcCoreDraftRequests.delete(message.requestId);
      if (message.type === "npc_core_draft") pending.resolve(message.core);
      else pending.reject(new Error(message.message));
    } else if (message.type === "seed_draft") {
      if (message.characterId === seedCharacterId) {
        const next = normalizeMindSeed(message.seed);
        if (next) seedDraft = cloneSeed(next);
        seedGenerating = false;
        seedDirty = true;
        seedNotice = { tone: "success", message: "Draft ready for review. Inspect every field, then save deliberately." };
        renderSeedEditor();
      }
    } else if (message.type === "notice") {
      showNotice(message.tone, message.message);
    } else if (message.type === "error") {
      seedGenerating = false;
      if (seedCharacterId) {
        seedNotice = { tone: "error", message: message.message };
        renderSeedEditor();
      }
      showNotice("error", message.message);
    }
  });
  cleanups.push(backendUnsub);

  cleanups.push(drawer.onActivate(syncContext));
  for (const eventName of ["CHAT_SWITCHED", "CHAT_CHANGED"] as const) {
    cleanups.push(ctx.events.on(eventName, () => setTimeout(syncContext, 0)));
  }
  cleanups.push(ctx.events.on("PERMISSION_CHANGED", syncContext));

  render();
  ctx.ready();
  const active = safeActiveChat(ctx);
  send({ type: "ready", chatId: active.chatId, characterId: active.characterId });

  return () => {
    if (noticeTimer) clearTimeout(noticeTimer);
    diagnosticsModal?.dismiss();
    diagnosticsModal = null;
    diagnosticsRefresh = null;
    for (const pending of developerReportRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("LumiMind closed before the developer report completed."));
    }
    developerReportRequests.clear();
    for (const pending of activationPreviewRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("LumiMind closed before the history check completed."));
    }
    activationPreviewRequests.clear();
    for (const pending of settingsSaveRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("LumiMind closed before settings were saved."));
    }
    settingsSaveRequests.clear();
    for (const pending of npcCoreDraftRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("LumiMind closed before the NPC core draft completed."));
    }
    npcCoreDraftRequests.clear();
    npcCoreGenerating.clear();
    destroySeedTab();
    while (cleanups.length) {
      try { cleanups.pop()?.(); } catch { /* Best-effort teardown. */ }
    }
    ctx.dom.cleanup();
  };
}
