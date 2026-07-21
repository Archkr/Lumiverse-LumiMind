import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeMessages,
  applyControllerMindPolicy,
  buildAnalysisPrompt,
  generateNpcCoreDraft,
  isNontrivialAnalysisBatch,
  makeControllerResponseTelemetry,
  mergeControllerAnalyses,
  normalizeControllerAnalysis,
  parseJsonValue,
  sanitizeControllerText,
} from "./controller";
import { DEFAULT_SETTINGS } from "./engine";
import type { ChatMessageLike, ControllerAnalysis } from "./types";

afterEach(() => {
  delete (globalThis as Record<string, unknown>).spindle;
});

describe("controller response parsing", () => {
  it("accepts fenced JSON with provider chatter", () => {
    const parsed = parseJsonValue("Here is the result:\n```json\n{\"actorMentions\":[],\"changes\":[]}\n```\nDone.");
    expect(parsed).toEqual({ actorMentions: [], changes: [] });
  });

  it("strips common structured-output wrappers", () => {
    expect(sanitizeControllerText("```JSON\n{\"ok\":true}\n``` ")).toBe('{"ok":true}');
  });

  it("normalizes malformed optional fields without inventing changes", () => {
    const result = normalizeControllerAnalysis({
      actorMentions: [{ ref: "mira", name: "Mira", kind: "unknown", confidence: 4, present: true, messageId: "m1" }],
      changes: [{ subjectRef: "mira", category: "emotion", operation: "add", text: "Wary", confidence: -2, messageId: "m1" }],
    });
    expect(result.actorMentions[0]).toMatchObject({ kind: "npc", confidence: 1, present: true });
    expect(result.changes[0]).toMatchObject({ category: "emotion", confidence: 0, text: "Wary" });
  });

  it("rejects malformed changes instead of defaulting them to additions", () => {
    const result = normalizeControllerAnalysis({
      actorMentions: [],
      changes: [
        { subjectRef: "mira", category: "unknown", operation: "add", text: "Invented belief", messageId: "m1" },
        { subjectRef: "mira", category: "belief", operation: "unknown", text: "Invented belief", messageId: "m1" },
        { subjectRef: "mira", category: "belief", operation: "add", text: "", messageId: "m1" },
        { subjectRef: "mira", category: "belief", operation: "update", text: "Changed", messageId: "m1" },
        { subjectRef: "mira", category: "belief", operation: "add", text: "The door is locked", messageId: "m1" },
      ],
    });
    expect(result.changes).toEqual([
      expect.objectContaining({ category: "belief", operation: "add", text: "The door is locked" }),
    ]);
  });

  it("deduplicates paraphrased additions within one controller response", () => {
    const result = normalizeControllerAnalysis({
      actorMentions: [],
      changes: [
        { subjectRef: "mira", category: "goal", operation: "add", text: "Wants to escape the tower", targetRefs: [], messageId: "m1" },
        { subjectRef: "Mira", category: "goal", operation: "add", text: "Escape the tower", targetRefs: [], messageId: "m2" },
      ],
    });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ text: "Escape the tower", messageId: "m2" });
  });

  it("preserves the current analysis batch after very large state context", () => {
    const prompt = buildAnalysisPrompt({
      messages: [{ id: "current", role: "assistant", content: "CURRENT_BATCH_SENTINEL" }],
      recentContext: [],
      compactState: [{ ref: "mira", items: [{ text: "x".repeat(125_000) }] }],
    });
    expect(prompt.length).toBeGreaterThan(120_000);
    expect(prompt).toContain('<message id="current"');
    expect(prompt).toContain("CURRENT_BATCH_SENTINEL");
    expect(prompt).toContain("</analysis_batch>");
  });

  it("detects substantive bootstrap batches without flagging trivial greetings", () => {
    expect(isNontrivialAnalysisBatch([{ id: "m1", role: "user", content: "hello" }])).toBe(false);
    expect(isNontrivialAnalysisBatch([{ id: "m1", role: "assistant", content: "A".repeat(400) }])).toBe(true);
  });

  it("reports raw entries rejected during normalization without storing raw text", () => {
    const parsed = { actorMentions: [{ name: "Missing message id" }], changes: [{ text: "Missing subject" }] };
    const accepted = normalizeControllerAnalysis(parsed);
    expect(makeControllerResponseTelemetry(JSON.stringify(parsed), parsed, accepted)).toMatchObject({
      rawActorMentions: 1,
      rawChanges: 1,
      acceptedActorMentions: 0,
      acceptedChanges: 0,
    });
  });

  it("reports normalization and context rejection reasons without exposing mind content", async () => {
    const quiet = vi.fn().mockResolvedValue({ content: JSON.stringify({
      actorMentions: [],
      changes: [
        {
          subjectRef: "mira",
          category: "goal",
          operation: "update",
          targetItemId: "seed:goal",
          text: "Changed goal",
          messageId: "m1",
        },
        {
          subjectRef: "mira",
          category: "emotion",
          operation: "add",
          text: "Wary",
          messageId: "m1",
        },
        {
          subjectRef: "mira",
          category: "unsupported",
          operation: "add",
          text: "Malformed category",
          messageId: "m1",
        },
      ],
    }) });
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const result = await analyzeMessages({
      messages: [{ id: "m1", role: "assistant", content: "Mira becomes wary.", index_in_chat: 0 }],
      recentContext: [],
      compactState: [{
        ref: "mira",
        name: "Mira",
        aliases: [],
        items: [{ id: "seed:goal", locked: true, pinned: true, source: "seed" }],
      }],
      settings: DEFAULT_SETTINGS,
      userId: "user",
    });

    expect(result.analysis.changes).toHaveLength(1);
    expect(result.telemetry.first).toMatchObject({
      invalidChangesRejected: 2,
      invalidChangeReasons: { invalid_category: 1, protected_target: 1 },
    });
    expect(result.telemetry).toMatchObject({
      stateTokenBudget: 24_000,
      stateItemsAvailable: 1,
      stateItemsIncluded: 1,
      stateItemsOmitted: 0,
      tokenCountApproximate: true,
      tokenCountFallback: true,
    });
  });

  it.each([
    ["deepseek", { tool_choice: "required" }],
    ["google", { toolConfig: { functionCallingConfig: { mode: "ANY" } } }],
  ] as const)("forces one structured tool call for direct %s connections", async (provider, expectedChoice) => {
    const toolArgs = {
      actorMentions: [{
        ref: "npc:mira-exact",
        name: "Mira",
        aliases: [],
        kind: "npc",
        confidence: 0.95,
        present: true,
        messageId: "m1",
      }],
      changes: [{
        subjectRef: "npc:mira-exact",
        category: "emotion",
        operation: "add",
        targetItemId: null,
        text: "Wary of the visitor",
        status: "active",
        confidence: 0.88,
        targetRefs: [],
        concealedFromRefs: [],
        intensity: 0.6,
        dimensions: {},
        messageId: "m1",
        evidenceExcerpt: "Mira watches the visitor closely.",
      }],
    };
    const quiet = vi.fn().mockResolvedValue({
      content: "",
      tool_calls: [{ name: "lumi_mind_analysis_v1", args: toolArgs, call_id: "call-1" }],
      usage: { prompt_tokens: 321, completion_tokens: 40, total_tokens: 361 },
    });
    const countText = vi.fn(async (value: string) => ({
      total_tokens: Math.ceil(value.length / 5),
      model: "provider-model",
      tokenizer_name: "provider-tokenizer",
      approximate: provider === "google",
    }));
    const countMessages = vi.fn(async (messages: Array<{ content: string }>) => ({
      total_tokens: Math.ceil(messages.reduce((sum, entry) => sum + entry.content.length, 0) / 5),
      model: "provider-model",
      tokenizer_name: "provider-tokenizer",
      approximate: provider === "google",
    }));
    (globalThis as Record<string, unknown>).spindle = {
      generate: { quiet },
      connections: { get: vi.fn().mockResolvedValue({ provider, model: "provider-model" }) },
      tokens: { countText, countMessages },
    };
    const result = await analyzeMessages({
      messages: [{ id: "m1", role: "assistant", content: "Mira watches the visitor closely.", index_in_chat: 0 }],
      recentContext: [],
      compactState: [{
        ref: "npc:mira-exact",
        name: "Mira",
        aliases: [],
        managed: true,
        items: [{ id: "seed:belief", category: "belief", text: "The room was safe", controllerWritable: false }],
      }],
      settings: { ...DEFAULT_SETTINGS, controllerConnectionId: "connection-1" },
      userId: "user",
    });

    expect(result.analysis.changes).toEqual([expect.objectContaining({
      subjectRef: "npc:mira-exact",
      text: "Wary of the visitor",
    })]);
    expect(result.telemetry.first.outputMode).toBe("tool");
    expect(result.telemetry).toMatchObject({
      tokenModel: "provider-model",
      tokenizerName: "provider-tokenizer",
      tokenCountApproximate: provider === "google",
      tokenCountFallback: false,
      inputTokens: 321,
    });
    const request = quiet.mock.calls[0][0] as {
      parameters: Record<string, unknown>;
      reasoning: unknown;
      tools: Array<{ name: string; parameters: Record<string, unknown> }>;
    };
    expect(request.parameters).toMatchObject(expectedChoice);
    expect(request.reasoning).toEqual({ source: "off" });
    expect(request.tools).toHaveLength(1);
    expect(request.tools[0]).toMatchObject({ name: "lumi_mind_analysis_v1" });
    expect(request.tools[0].parameters.required).toEqual(["actorMentions", "changes"]);
  });

  it("falls back to plain JSON when a provider does not return tool arguments", async () => {
    const quiet = vi.fn().mockResolvedValue({ content: JSON.stringify({ actorMentions: [], changes: [] }) });
    (globalThis as Record<string, unknown>).spindle = {
      generate: { quiet },
      connections: { get: vi.fn().mockResolvedValue({ provider: "deepseek", model: "deepseek-chat" }) },
      tokens: {
        countText: vi.fn(async (value: string) => ({ total_tokens: Math.ceil(value.length / 4), model: "deepseek-chat", tokenizer_name: "test", approximate: false })),
        countMessages: vi.fn(async () => ({ total_tokens: 100, model: "deepseek-chat", tokenizer_name: "test", approximate: false })),
      },
    };
    const result = await analyzeMessages({
      messages: [{ id: "m1", role: "assistant", content: "A short covered scene.", index_in_chat: 0 }],
      recentContext: [],
      compactState: [{
        ref: "mira",
        name: "Mira",
        aliases: [],
        managed: true,
        items: [{ id: "seed:belief", category: "belief", text: "The room is safe", controllerWritable: false }],
      }],
      settings: { ...DEFAULT_SETTINGS, controllerConnectionId: "connection-1" },
      userId: "user",
    });
    expect(result.telemetry.first.outputMode).toBe("json");
    expect(result.analysis).toEqual({ actorMentions: [], changes: [] });
  });

  it("merges corrective mentions while taking corrective state changes", () => {
    const first: ControllerAnalysis = {
      actorMentions: [{ ref: "aster", name: "Aster", messageId: "m1" }],
      changes: [],
    };
    const corrective: ControllerAnalysis = {
      actorMentions: [
        { ref: "aster", name: "Aster", messageId: "m1", present: true },
        { ref: "mira", name: "Mira", messageId: "m1" },
      ],
      changes: [{ subjectRef: "aster", category: "emotion", operation: "add", text: "Wary", messageId: "m1" }],
    };
    const merged = mergeControllerAnalyses(first, corrective);
    expect(merged.actorMentions).toHaveLength(2);
    expect(merged.changes).toHaveLength(1);
  });

  it("blocks disabled persona and director-card minds while treating portrayed characters as NPCs", () => {
    const analysis: ControllerAnalysis = {
      actorMentions: [
        { ref: "character:card", name: "The Director", kind: "character", messageId: "m1" },
        { ref: "persona:player", name: "Player", kind: "persona", messageId: "m1" },
        { ref: "mira", name: "Mira", kind: "character", messageId: "m1" },
      ],
      changes: [
        { subjectRef: "The Director", category: "goal", operation: "add", text: "Advance the plot", messageId: "m1" },
        { subjectRef: "Player", category: "emotion", operation: "add", text: "Afraid", messageId: "m1" },
        { subjectRef: "Mira", category: "emotion", operation: "add", text: "Wary", messageId: "m1" },
      ],
    };
    const state = [
      { ref: "character:card", name: "The Director", aliases: [], kind: "character", managed: false },
      { ref: "persona:player", name: "Player", aliases: [], kind: "persona", managed: false },
    ];
    const result = applyControllerMindPolicy(analysis, state, {
      ...DEFAULT_SETTINGS,
      personaMindEnabled: false,
      characterCardDirectorMode: true,
    });
    expect(result.actorMentions).toEqual([
      expect.objectContaining({ name: "Mira", kind: "npc" }),
    ]);
    expect(result.changes).toEqual([
      expect.objectContaining({ subjectRef: "Mira", text: "Wary" }),
    ]);
  });

  it("allows controller changes to unlocked manual, seed, and pinned entries while still blocking locks", async () => {
    const changes: ControllerAnalysis["changes"] = [
      { subjectRef: "Mira", category: "goal", operation: "update", targetItemId: "manual", text: "Manual evolved", messageId: "m1" },
      { subjectRef: "Mira", category: "belief", operation: "remove", targetItemId: "seed", messageId: "m1" },
      { subjectRef: "Mira", category: "emotion", operation: "update", targetItemId: "locked", text: "Locked evolved", messageId: "m1" },
    ];
    const quiet = vi.fn().mockResolvedValue({ content: JSON.stringify({ actorMentions: [], changes }) });
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const result = await analyzeMessages({
      messages: [{ id: "m1", role: "assistant", content: "Mira changes her mind.", index_in_chat: 0 }],
      recentContext: [],
      compactState: [{
        ref: "mira",
        name: "Mira",
        aliases: [],
        items: [
          { id: "manual", locked: false, pinned: true, source: "manual" },
          { id: "seed", locked: false, pinned: false, source: "seed" },
          { id: "locked", locked: true, pinned: false, source: "controller" },
        ],
      }],
      settings: DEFAULT_SETTINGS,
      userId: "user",
    });

    expect(result.analysis.changes.map((change) => change.targetItemId)).toEqual(["manual", "seed"]);
    expect(result.telemetry.first.invalidChangeReasons).toMatchObject({ protected_target: 1 });
  });

  it("expands a unique abbreviated item ID while rejecting an ambiguous prefix", async () => {
    const exactId = "delta:3f4ec3c8-1111-4111-8111-111111111111";
    const changes: ControllerAnalysis["changes"] = [
      { subjectRef: "Mira", category: "belief", operation: "update", targetItemId: "delta:3f4ec3c8", text: "Unique target evolved", messageId: "m1" },
      { subjectRef: "Mira", category: "goal", operation: "update", targetItemId: "delta:aaaaaaaa", text: "Ambiguous target evolved", messageId: "m1" },
      { subjectRef: "Mira", category: "plan", operation: "update", targetItemId: "delta:bbbb", text: "Underspecified target evolved", messageId: "m1" },
    ];
    const quiet = vi.fn().mockResolvedValue({ content: JSON.stringify({ actorMentions: [], changes }) });
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const result = await analyzeMessages({
      messages: [{ id: "m1", role: "assistant", content: "Mira changes her mind.", index_in_chat: 0 }],
      recentContext: [],
      compactState: [{
        ref: "mira",
        name: "Mira",
        aliases: [],
        items: [
          { id: exactId, locked: false },
          { id: "delta:aaaaaaaa-1111-4111-8111-111111111111", locked: false },
          { id: "delta:aaaaaaaa-2222-4222-8222-222222222222", locked: false },
          { id: "delta:bbbbbbbb-1111-4111-8111-111111111111", locked: false },
        ],
      }],
      settings: DEFAULT_SETTINGS,
      userId: "user",
    });

    expect(result.analysis.changes).toEqual([
      expect.objectContaining({ targetItemId: exactId, text: "Unique target evolved" }),
    ]);
    expect(result.telemetry.first.invalidChangeReasons).toMatchObject({ target_not_found: 2 });
  });

  it.each(["assistant", "character:card"])("preserves a portrayed NPC when its controller ref collides with %s", (collidingRef) => {
    const analysis: ControllerAnalysis = {
      actorMentions: [{
        ref: collidingRef,
        name: "Mira",
        aliases: [],
        kind: "character",
        messageId: "m1",
      }],
      changes: [{
        subjectRef: collidingRef,
        category: "emotion",
        operation: "add",
        text: "Wary",
        messageId: "m1",
      }],
    };
    const result = applyControllerMindPolicy(analysis, [{
      ref: "character:card",
      name: "The Director",
      aliases: [],
      kind: "character",
      managed: false,
    }], {
      ...DEFAULT_SETTINGS,
      personaMindEnabled: false,
      characterCardDirectorMode: true,
    });
    expect(result.actorMentions).toEqual([
      expect.objectContaining({ ref: "Mira", name: "Mira", aliases: [], kind: "npc" }),
    ]);
    expect(result.changes).toEqual([
      expect.objectContaining({ subjectRef: "Mira", text: "Wary" }),
    ]);
  });

  it("treats an empty reconciliation as healthy when existing state already initializes the actor", async () => {
    const quiet = vi.fn().mockResolvedValue({ content: JSON.stringify({ actorMentions: [], changes: [] }) });
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const messages: ChatMessageLike[] = [{ id: "m1", role: "assistant", content: "A".repeat(500), index_in_chat: 0 }];
    const result = await analyzeMessages({
      messages,
      recentContext: [],
      compactState: [{
        ref: "aster",
        name: "Aster",
        aliases: [],
        managed: true,
        items: [{ id: "seed:belief", category: "belief", text: "The room is safe", controllerWritable: false }],
      }],
      settings: DEFAULT_SETTINGS,
      userId: "user",
    });

    expect(quiet).toHaveBeenCalledTimes(1);
    expect(result.analysis.changes).toEqual([]);
    expect(result.telemetry).toMatchObject({ attempts: 1, finalChanges: 0, warningCodes: [] });
    const request = quiet.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
    expect(systemPrompt).toContain("COVERED, EVOLVED, ENDED, PROTECTED, or NOVEL");
    expect(systemPrompt).toContain("When uncertain between COVERED and NOVEL, choose COVERED and emit nothing.");
    expect(systemPrompt).toContain("one concise composite emotion");
  });

  it("does not retry a substantive batch when the registry contains only unmanaged context actors", async () => {
    const quiet = vi.fn().mockResolvedValue({ content: JSON.stringify({
      actorMentions: [
        { ref: "character:card", name: "The Director", kind: "character", messageId: "m1" },
        { ref: "persona:player", name: "Player", kind: "persona", messageId: "m1" },
      ],
      changes: [],
    }) });
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const messages: ChatMessageLike[] = [{ id: "m1", role: "assistant", content: "A".repeat(500), index_in_chat: 0 }];
    const result = await analyzeMessages({
      messages,
      recentContext: [],
      compactState: [
        { ref: "character:card", name: "The Director", aliases: [], kind: "character", managed: false },
        { ref: "persona:player", name: "Player", aliases: [], kind: "persona", managed: false },
      ],
      settings: { ...DEFAULT_SETTINGS, personaMindEnabled: false, characterCardDirectorMode: true },
      userId: "user",
    });

    expect(quiet).toHaveBeenCalledTimes(1);
    expect(result.analysis).toEqual({ actorMentions: [], changes: [] });
    expect(result.telemetry).toMatchObject({ attempts: 1, finalChanges: 0, warningCodes: [] });
  });

  it("runs exactly one corrective pass for an empty substantive bootstrap", async () => {
    const quiet = vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ actorMentions: [], changes: [] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({
        actorMentions: [{
          ref: "Aster",
          name: "Aster",
          aliases: [],
          kind: "npc",
          confidence: 0.9,
          present: true,
          messageId: "m1",
        }],
        changes: [{
          subjectRef: "Aster",
          category: "emotion",
          operation: "add",
          targetItemId: null,
          text: "Wary of the unexpected visitor",
          status: "active",
          confidence: 0.82,
          targetRefs: [],
          concealedFromRefs: [],
          intensity: 0.55,
          dimensions: { valence: -0.3 },
          messageId: "m1",
          evidenceExcerpt: "Aster watched the doorway and lowered her voice.",
        }],
      }) });
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const messages: ChatMessageLike[] = [{ id: "m1", role: "assistant", content: "Aster watched the doorway and lowered her voice. ".repeat(10), index_in_chat: 0 }];
    const result = await analyzeMessages({ messages, recentContext: [], compactState: [], settings: DEFAULT_SETTINGS, userId: "user" });
    expect(quiet).toHaveBeenCalledTimes(2);
    expect(result.analysis.changes).toHaveLength(1);
    expect(result.telemetry).toMatchObject({ attempts: 2, finalChanges: 1, warningCodes: [] });
  });

  it("retains a valid first pass and warns when the corrective request fails", async () => {
    const quiet = vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ actorMentions: [], changes: [] }) })
      .mockRejectedValueOnce(new Error("temporary provider failure"));
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const messages: ChatMessageLike[] = [{ id: "m1", role: "assistant", content: "B".repeat(500), index_in_chat: 0 }];
    const result = await analyzeMessages({ messages, recentContext: [], compactState: [], settings: DEFAULT_SETTINGS, userId: "user" });
    expect(result.analysis.changes).toEqual([]);
    expect(result.telemetry.warningCodes).toEqual(expect.arrayContaining(["retry_failed", "empty_nontrivial_batch"]));
    expect(result.telemetry.retryError).toBe("temporary provider failure");
  });

  it("forwards an abort signal to every controller pass and propagates cancellation", async () => {
    const abortController = new AbortController();
    const abortError = Object.assign(new Error("The generation was cancelled."), { name: "AbortError" });
    const quiet = vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ actorMentions: [], changes: [] }) })
      .mockImplementationOnce(async () => {
        abortController.abort();
        throw abortError;
      });
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet }, connections: { get: vi.fn() } };
    const messages: ChatMessageLike[] = [{ id: "m1", role: "assistant", content: "C".repeat(500), index_in_chat: 0 }];

    await expect(analyzeMessages({
      messages,
      recentContext: [],
      compactState: [],
      settings: DEFAULT_SETTINGS,
      userId: "user",
      signal: abortController.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(quiet).toHaveBeenCalledTimes(2);
    expect(quiet.mock.calls[0][0]).toMatchObject({ signal: abortController.signal });
    expect(quiet.mock.calls[1][0]).toMatchObject({ signal: abortController.signal });
  });
});

describe("NPC core drafting", () => {
  it("drafts an enduring frame from supplied NPC lore through structured output", async () => {
    const quiet = vi.fn().mockResolvedValue({
      content: "",
      tool_calls: [{
        name: "lumi_mind_npc_core_v1",
        call_id: "call-npc-core",
        args: {
          selfConcept: "I am the last keeper of the eastern gate.",
          values: ["Duty", "Measured mercy"],
          desires: ["Keep the city safe"],
          fears: ["Failing those under her protection"],
          boundaries: ["Will not abandon civilians"],
          notes: ["Reserved and observant"],
        },
      }],
    });
    (globalThis as Record<string, unknown>).spindle = { generate: { quiet } };

    const core = await generateNpcCoreDraft({
      actorName: "Mira Vale",
      lore: "Mira is a reserved gate captain who survived the old siege and protects civilians above all else.",
      settings: DEFAULT_SETTINGS,
      userId: "user",
    });

    expect(core).toMatchObject({
      selfConcept: "I am the last keeper of the eastern gate.",
      values: ["Duty", "Measured mercy"],
      boundaries: ["Will not abandon civilians"],
    });
    const request = quiet.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ name: string; parameters: { required: string[] } }>;
    };
    expect(request.messages[1].content).toContain("Mira Vale");
    expect(request.messages[1].content).toContain("reserved gate captain");
    expect(request.tools[0]).toMatchObject({ name: "lumi_mind_npc_core_v1" });
    expect(request.tools[0].parameters.required).toEqual(["selfConcept", "values", "desires", "fears", "boundaries", "notes"]);
  });

  it("rejects blank lore before calling the controller", async () => {
    await expect(generateNpcCoreDraft({
      actorName: "Mira Vale",
      lore: "   ",
      settings: DEFAULT_SETTINGS,
      userId: "user",
    })).rejects.toThrow("NPC lore is required");
  });
});
