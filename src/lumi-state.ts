import { makePublicSnapshot } from "./engine";
import type { ChatTimelineV1, LumiMindSettings } from "./types";

export const LUMI_STATE_PROTOCOL = "lumi_state.v1" as const;
export const LUMI_STATE_SCHEMA_VERSION = 1 as const;
export const LUMI_MIND_STATE_ENDPOINT = "lumi_mind.state.current";

export interface LumiStateProvenanceV1 {
  extensionId: string;
  method: string;
  observedAt: number;
  confidence?: number;
}

export interface LumiStateEntityRefV1 {
  namespace: string;
  id: string;
  kind: "character" | "persona" | "npc" | "object" | "thread";
}

export interface LumiStateCastClaimV1 {
  id: string;
  actor: LumiStateEntityRefV1;
  links: LumiStateEntityRefV1[];
  name: string;
  aliases: string[];
  present: boolean;
  confirmed: boolean;
  publicStance: string;
  provenance: LumiStateProvenanceV1;
}

export interface LumiStateSceneV1 {
  locations: unknown[];
  times: unknown[];
  cast: LumiStateCastClaimV1[];
  objects: unknown[];
  conditions: unknown[];
  threads: unknown[];
}

export interface LumiStateSnapshotV1 {
  protocol: typeof LUMI_STATE_PROTOCOL;
  schemaVersion: typeof LUMI_STATE_SCHEMA_VERSION;
  source: {
    extensionId: string;
    extensionVersion: string;
    endpoint: string;
  };
  chatId: string | null;
  revision: number;
  freshness: "fresh" | "stale" | "unavailable";
  generatedAt: number;
  updatedAt: number | null;
  visibility: "public";
  state: LumiStateSceneV1;
}

export function makeMindLumiStateSnapshot(
  timeline: ChatTimelineV1 | null,
  settings: LumiMindSettings,
  extensionVersion: string,
  generatedAt = Date.now(),
): LumiStateSnapshotV1 {
  const publicSnapshot = makePublicSnapshot(timeline, settings);
  const cast: LumiStateCastClaimV1[] = timeline
    ? publicSnapshot.actors.map((actor) => {
        const record = timeline.actors[actor.id];
        const links: LumiStateEntityRefV1[] = [];
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
            confidence: record?.confidence ?? 0,
          },
        };
      })
    : [];

  return {
    protocol: LUMI_STATE_PROTOCOL,
    schemaVersion: LUMI_STATE_SCHEMA_VERSION,
    source: {
      extensionId: "lumi_mind",
      extensionVersion,
      endpoint: LUMI_MIND_STATE_ENDPOINT,
    },
    chatId: timeline?.chatId ?? null,
    revision: timeline?.revision ?? 0,
    freshness: !timeline ? "unavailable" : publicSnapshot.stale ? "stale" : "fresh",
    generatedAt,
    updatedAt: timeline?.updatedAt ?? null,
    visibility: "public",
    state: { locations: [], times: [], cast, objects: [], conditions: [], threads: [] },
  };
}
