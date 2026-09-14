import { buildProjectedDirectorMindInjection, buildProjectedMindInjection, type TokenCounter } from "./engine";
import type { ChatTimelineV1, InjectionSnapshot, LumiMindSettings, PermissionState } from "./types";

/** Shared by the interceptor and the read-only preview. */
export async function projectInjection(input: {
  timeline: ChatTimelineV1;
  settings: LumiMindSettings;
  permissions: Pick<PermissionState, "interceptor">;
  targetActorId: string | null;
  impersonate: boolean;
  context: Array<{ content: string; name?: string }>;
  countTokens: TokenCounter;
}): Promise<InjectionSnapshot> {
  const { timeline, settings, targetActorId } = input;
  const target = targetActorId ? timeline.actors[targetActorId] : null;
  const director = settings.characterCardDirectorMode && !input.impersonate;
  const reason = !input.permissions.interceptor ? "Interceptor permission is unavailable."
    : !timeline.active ? "LumiMind is inactive for this chat."
    : timeline.paused ? "LumiMind is paused for this chat."
    : input.impersonate && !settings.personaMindEnabled ? "Persona mind management is disabled."
    : input.impersonate && !target ? "No persona is available for impersonation."
    : null;
  const snapshot: InjectionSnapshot = {
    chatId: timeline.chatId, revision: timeline.revision, capturedAt: Date.now(), targetActorId,
    targetLabel: director ? "Director ensemble" : target?.canonicalName ?? "Present cast",
    content: null, reason, position: settings.injectionPosition, telemetry: null, selection: { actors: [], entries: [] },
  };
  if (reason) return snapshot;
  const projection = director
    ? await buildProjectedDirectorMindInjection(timeline, settings, input.context, input.countTokens)
    : await buildProjectedMindInjection(timeline, targetActorId, settings, input.context, input.countTokens);
  return { ...snapshot, ...projection, reason: projection.content ? null : "No managed mind state is available for injection." };
}
