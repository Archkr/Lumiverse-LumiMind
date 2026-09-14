import { describe, expect, it } from "vitest";
import { addManualItem, buildProjectedMindInjection, createTimeline, DEFAULT_SETTINGS, rebuildTimeline, upsertActor } from "./engine";
import { projectInjection } from "./injection";

const countTokens = async (value: string) => ({ totalTokens: value.length, model: "test", tokenizerName: "test", approximate: false, fallback: false });
function fixture() {
  const timeline = createTimeline("chat"); timeline.active = true; timeline.revision = 7;
  const actor = upsertActor(timeline, { id: "character:mira", kind: "character", characterId: "mira", name: "Mira" });

  addManualItem(timeline, actor.id, "belief", "The observatory is safe.");
  addManualItem(timeline, actor.id, "secret", "Hides the missing key.");
  rebuildTimeline(timeline, []); actor.present = true;
  return { timeline, actor, settings: { ...DEFAULT_SETTINGS, injectionTokenBudget: 0 }, permissions: { interceptor: true },
    targetActorId: actor.id, impersonate: false, context: [], countTokens };
}

describe("injection snapshots", () => {
  it("uses the exact production projection and includes selection metadata", async () => {
    const input = fixture(); const before = structuredClone(input.timeline);
    const result = await projectInjection(input);
    const production = await buildProjectedMindInjection(input.timeline, input.actor.id, input.settings, [], countTokens);
    expect(result.content).toBe(production.content);
    expect(result.selection.entries).toHaveLength(2);
    expect(result.selection.entries.every((entry) => entry.included)).toBe(true);
    expect(result).toMatchObject({ chatId: "chat", revision: 7, targetLabel: "Mira", reason: null });
    expect(input.timeline).toEqual(before);
    input.timeline.minds[input.actor.id].items[0].text = "Changed after generation";
    expect(result.content).not.toContain("Changed after generation");
    expect(result.selection.entries[0].text).not.toContain("Changed after generation");
  });

  it("reports exact omitted entries with a constrained budget", async () => {
    const input = fixture(); input.settings.injectionTokenBudget = 1;
    const result = await projectInjection(input);
    expect(result.selection.actors).toEqual([{ id: input.actor.id, name: "Mira" }]);
    expect(result.telemetry?.itemsOmitted).toBe(2);
    expect(result.selection.entries.every((entry) => !entry.included)).toBe(true);
    expect(result.content).not.toContain("Hides the missing key");
  });

  it.each(["inactive", "paused", "permission", "persona"])("explains %s injection absence", async (mode) => {
    const input = fixture();
    if (mode === "inactive") input.timeline.active = false;
    if (mode === "paused") input.timeline.paused = true;
    if (mode === "permission") input.permissions.interceptor = false;
    if (mode === "persona") { input.impersonate = true; input.settings.personaMindEnabled = false; }
    const result = await projectInjection(input);
    expect(result.content).toBeNull();
    expect(result.reason).toBeTruthy();
    expect(result.selection.entries).toEqual([]);
  });

  it("handles director cast and impersonation separately", async () => {
    const input = fixture();
    const npc = upsertActor(input.timeline, { kind: "npc", name: "Rowan" }); npc.present = true;
    addManualItem(input.timeline, npc.id, "goal", "Find the observatory key.");
    rebuildTimeline(input.timeline, []); npc.present = true; input.actor.present = true;
    input.settings.characterCardDirectorMode = true;
    const ensemble = await projectInjection(input);
    expect(ensemble.targetLabel).toBe("Director ensemble");
    expect(ensemble.selection.actors.map((actor) => actor.name)).toEqual(["Rowan"]);
    const persona = upsertActor(input.timeline, { id: "persona:player", kind: "persona", personaId: "player", name: "Player" });
    addManualItem(input.timeline, persona.id, "goal", "Help Mira.");
    rebuildTimeline(input.timeline, []); persona.present = true; npc.present = true;
    const impersonation = await projectInjection({ ...input, targetActorId: persona.id, impersonate: true });
    expect(impersonation.targetLabel).toBe("Player");
    expect(impersonation.selection.actors.some((actor) => actor.id === persona.id)).toBe(true);
    expect(impersonation.content).not.toContain("private ensemble continuity");
  });
});
