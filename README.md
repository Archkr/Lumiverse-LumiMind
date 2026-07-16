# LumiMind

Timeline-aware subjective minds for Lumiverse 1.0.6 and newer.

LumiMind is a Lumiverse Spindle extension that maintains private, branch-aware mental continuity for character cards, the active persona, and named NPCs. It analyzes committed turns in the background, folds immutable controller deltas into the current timeline, and injects a compact private-state checkpoint before the next generation.

Chats are inactive until you explicitly enable them. Beliefs and secrets are collapsed in Mind Lens by default.

## What v0.1 includes

- Per-chat actor registry with stable character/persona IDs and timeline-local NPC UUIDs.
- Optional persona minds for players who want LumiMind to model the active persona; disable them when the persona is exclusively player-controlled.
- Actor-card and director-card roleplay modes. Director mode manages the named cast portrayed by the card without assigning a mind to the host card itself.
- Subjective beliefs, secrets, goals, plans, emotions, relationships, awareness, and enduring core traits.
- Evidence, confidence, message index, swipe, source, lock, and pin metadata for every mind entry.
- Deterministic timeline replay across edits, deletions, swipe navigation, and forks.
- Background controller analysis with tolerant structured-output parsing.
- Explicit first-scene bootstrapping plus one bounded corrective pass when a substantive batch produces no usable mental-state changes.
- Cached, generation-free prompt interception with an approximately 1,600-token default budget.
- Mind Lens drawer with Cast, Scene, Changes, and Settings views.
- Spoiler-safe beliefs and secrets, editable state, actor identity tools, provenance, pause/retry/rebuild, and live capability status.
- Mind Seed character-editor tab with transient card baselines and review-before-save controller drafts.
- Optional Memory Cortex identity import and confirmed-identity writeback.
- Public and opt-in private shared RPC scene snapshots.

## Installation

Install the repository URL from Lumiverse's Extensions panel, then grant the permissions needed for the features you want. The committed `dist/` directory allows Lumiverse to load the extension without building it during installation.

For local development:

```bash
bun install
bun run typecheck
bun run test
bun run build
```

The manifest is [`spindle.json`](./spindle.json). Both runtime bundles are written to `dist/` and are intended to be committed.

## First use

1. Open a chat.
2. Open **Mind Lens** from the Lumiverse drawer or command palette.
3. Select **Activate Mind Lens**.
4. LumiMind initializes the existing transcript in the background. Normal generation remains available while it works.
5. Review the Cast and Scene views. Beliefs and secrets stay collapsed until you deliberately open them.

Activated forks inherit activation and compatible analysis through the fork point. Unrelated chats do not automatically share discovered NPC identities.

## Mind Lens

The drawer has four views:

- **Cast** — actor registry, core self, mental-state sections, evidence, confidence, lock/pin controls, and identity management.
- **Scene** — actors marked present and their current non-spoiler attention, emotion, relationship, goal, plan, and awareness signals.
- **Changes** — per-message analysis records, swipe provenance, checkpoint freshness, pause/resume, retry, and rebuild controls.
- **Settings** — controller connection, analysis and injection budgets, privacy controls, Cortex behavior, interoperability, and live permissions.

Settings also includes a **Diagnostics** window. It summarizes frontend context, live permissions, controller availability, timeline health, aggregate actor/mind counts, recent analysis metadata, accepted mention/change counts, corrective attempts, normalization drops, and privacy-safe response lengths/hashes. **Copy report** produces formatted JSON suitable for a bug report while excluding story text, beliefs, secrets, raw controller output, evidence excerpts, actor names, aliases, credentials, and full entity IDs.

When a substantive batch still produces no usable state after the corrective pass, Mind Lens shows an analysis-quality warning even though the compatible timeline checkpoint is technically current. Rebuild reruns committed history with the latest extraction rules.

User edits become locked manual overrides. Controller analysis cannot overwrite a locked item until it is unlocked.

### Roleplay behavior

- **Manage the active persona** — when enabled, LumiMind may track the persona's subjective state and inject it during impersonation. When disabled, the persona remains context for other characters but receives no managed mind or prompt injection.
- **Character card acts as director** — when disabled, the host card is treated as the primary in-world actor. When enabled, the card is treated as a narrator/director and LumiMind instead tracks the individual named characters it portrays.

Changing either option invalidates the affected analysis policy. Activated timelines rebuild under the new mode when opened. Reviewed seeds and locked manual work remain stored; controller-inferred state is recomputed from committed history under the new policy.

Actor tools support rename, alias add/remove, confirm, merge, split, timeline removal, and optional identity-only Cortex publication. Removing an actor from LumiMind does not delete a character card, persona, or Cortex entity.

## Mind Seed

The **Mind Seed** tab appears in Lumiverse's character editor when the `characters` permission is granted.

- Without a reviewed seed, character description, personality, and creator notes form a transient baseline.
- **Generate draft** asks the configured controller to extract enduring characterization from the card.
- Generated drafts remain local to the open editor until you choose **Save reviewed seed**.
- Reviewed data is stored at `character.extensions.lumi_mind.seed.v1`.
- Removing a reviewed seed restores transient card-field fallback for future timelines; it does not erase existing chat history.

## Permissions and graceful degradation

| Permission | Used for | When unavailable |
| --- | --- | --- |
| `generation` | Quiet controller analysis and seed drafts | Analysis and draft generation show an inactive state. |
| `interceptor` | Private checkpoint injection | No prompt injection is attempted. |
| `chats` | Active chat/card enrichment | Timeline UI remains scoped to context supplied by the frontend. |
| `chat_mutation` | Reading committed history and private RPC gating | Timeline analysis is disabled; the extension does not break normal chat. |
| `characters` | Stable card identities and Mind Seed editing | Character enrichment and the editor tab are unavailable. |
| `personas` | Stable active-persona identity | Persona enrichment is unavailable. |
| `memories` | Optional Cortex identity import/writeback | The independent actor registry remains fully functional. |

Permissions are checked live. Granting or revoking access updates Mind Lens without requiring a data reset.

## Controller selection and cost

LumiMind uses the dedicated controller connection selected in Settings. If none is selected, it falls back to Lumiverse's active connection for the chat.

Defaults:

- Temperature: `0.1`
- Maximum analysis output: approximately `1,800` tokens
- Prompt injection budget: approximately `1,600` tokens
- Secondary actors: up to `4`
- Initial-history rebuilds: bounded batches

Controller analysis normally runs once per newly committed turn. If a substantive batch returns no accepted mental-state changes, LumiMind makes at most one corrective call focused on evidence-bound bootstrap extraction. Rebuilds, edits, swipe changes, initial history, and corrective passes can therefore create additional calls. Pause a timeline when you do not want background analysis costs.

The interceptor never performs a model call. When analysis is pending, it uses the last valid folded checkpoint.

## Privacy model

LumiMind stores settings and timelines in user-scoped extension storage. Reviewed seeds live on their character cards.

Private state is ordinary JSON, not cryptographically encrypted. Anyone with direct access to the Lumiverse data directory or character-card extension data may be able to read it.

Cortex writeback is disabled by default. When enabled, LumiMind publishes only user-confirmed actor names and aliases. It never writes beliefs, secrets, goals, plans, emotions, relationships, or private scene state to Cortex.

Private shared RPC is also disabled by default and requires `chat_mutation` when enabled.

## Prompt behavior

Before generation, LumiMind resolves the exact target actor captured by `GENERATION_STARTED`:

- Solo/group character generation targets the selected character card.
- Impersonation targets the active persona.
- The target receives roughly 60% of the available compact-state budget.
- Present/relevant secondary actors share the remainder.

The injected system message tells the model that beliefs are subjective, private state must not be quoted, and secrets should emerge only through character-motivated behavior. Prompt Breakdown attributes it as **LumiMind — Private Mind**.

## Shared RPC interoperability

Spindle namespaces these endpoints under the `lumi_mind` manifest identifier:

- `lumi_mind.contract.v1` — schema version, capabilities, and endpoint metadata.
- `lumi_mind.scene.current` — public actor identity, aliases, presence, confirmation, and public stance. Readable without delegated permissions.
- `lumi_mind.scene.private` — compact private minds. Registered only when private interoperability is enabled and gated by `chat_mutation`.

Every scene snapshot includes `chatId`, `revision`, and `schemaVersion: 1`. Consumers such as LumiWorld, LoreRecall, and future extensions should reject snapshots with an unsupported schema, a different active chat, or an older revision than the newest value they have already accepted. If an endpoint is missing or rejected, consumers should continue without LumiMind data.

## Troubleshooting

**Mind Lens says access is missing**

Open Lumiverse Settings → Extensions and grant the permissions named in the inactive state.

**A timeline is stale or in error**

Open Changes and choose **Retry**. Use **Rebuild** when transcript history changed substantially or a controller response was malformed. Manual locked edits remain applied.

**The timeline is current but contains no mind entries**

Mind Lens reports this separately as an analysis-quality warning. Open Diagnostics to compare raw and accepted structured-output counts, then use **Rebuild analysis** to run the current bootstrap and corrective-pass rules over committed history.

**No controller connection appears**

Grant `generation`, configure a Lumiverse connection, then refresh Mind Lens. Leaving the selector on its default uses the chat's active connection.

**A character has the wrong identity**

Use actor tools to rename, add an alias, merge duplicates, or split an ambiguous actor. Confirm an NPC only after reviewing it.

**Secrets are visible in storage**

Spoiler-safe mode is a UI disclosure control, not encryption. This is expected in v0.1.

**Prompt injection is missing**

Confirm that the chat is active, not paused, `interceptor` is granted, and the target character/persona exists in the actor registry. Check Prompt Breakdown for **LumiMind — Private Mind**.

**Support needs more detail**

Open Mind Lens → Settings → Diagnostics, choose **Refresh snapshot**, then **Copy report**. The copied JSON is sanitized and does not include private story or mind content.

## Development layout

- `src/backend.ts` — event coordination, queueing, persistence, RPC, and interception.
- `src/controller.ts` — prompts, provider-specific structured output, and tolerant parsing.
- `src/engine.ts` — actor resolution, immutable records, reducer, ranking, and compaction.
- `src/frontend.ts` — Mind Lens and Mind Seed host integration.
- `src/ui/` — UI helpers, styling, and focused tests.
- `src/storage.ts` — user-scoped settings and timeline storage.
- `src/types.ts` — versioned contracts shared by both bundles.

## License

See [`LICENSE.md`](./LICENSE.md).
