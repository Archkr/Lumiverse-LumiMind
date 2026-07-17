<div align="center">

<img width="680" height="680" alt="LumiFox" src="https://github.com/user-attachments/assets/17fd5a88-a577-4e0e-a119-5f89bbee2126" />

# LumiMind

**Timeline-aware subjective minds for Lumiverse.**

[![Version](https://img.shields.io/badge/version-0.1.1-8b7cf6)](./spindle.json)
[![Lumiverse](https://img.shields.io/badge/Lumiverse-%E2%89%A5%201.0.6-d4a35a)](https://github.com/prolix-oc/Lumiverse)
[![Status](https://img.shields.io/badge/status-beta-e6a45a)](https://github.com/Archkr/Lumiverse-LumiMind)
[![License](https://img.shields.io/badge/license-Lumiverse%20Community%202.0-6f9f78)](./LICENSE.md)

*Let every character remember the same scene differently.*

</div>

LumiMind gives characters private, evolving points of view.

One character can trust a lie. Another can notice the truth but keep it secret. A third can leave the room without magically learning what happened afterward. LumiMind follows those differences across the conversation and gives the model the unresolved subjective state of the characters currently present.

It supports ordinary single-card roleplay, group chats, player personas, and director-style cards that portray an entire cast.

> **Beta note:** LumiMind `0.1.1` is an early release. Use the built-in Diagnostics report when a controller behaves unexpectedly.

> **Privacy note:** “Private” means hidden from normal story output and handled as private prompt context. Mind data is stored as ordinary JSON; it is not encrypted.

---

## Table of contents

1. [At a glance](#at-a-glance)
2. [Why LumiMind](#why-lumimind)
3. [How it works](#how-it-works)
4. [Compatibility](#compatibility)
5. [Installation](#installation)
6. [Quick start](#quick-start)
7. [Choose your roleplay style](#choose-your-roleplay-style)
8. [Mind Lens](#mind-lens)
9. [Mind Seed](#mind-seed)
10. [Timeline behavior](#timeline-behavior)
11. [Settings reference](#settings-reference)
12. [Controller usage and cost](#controller-usage-and-cost)
13. [Permissions](#permissions)
14. [Privacy](#privacy)
15. [Memory Cortex integration](#memory-cortex-integration)
16. [Extension interoperability](#extension-interoperability)
17. [Tips](#tips)
18. [Troubleshooting](#troubleshooting)
19. [Development](#development)
20. [License](#license)

---

## At a glance

| | |
|---|---|
| **Subjective continuity** | Tracks what each actor personally believes, including uncertainty and false beliefs. |
| **Evolving inner state** | Maintains emotions, goals, plans, fears, relationships, secrets, attention, and awareness. |
| **Independent cast** | Supports character cards, the active persona, and named NPCs with separate identities. |
| **Two card styles** | Use a card as one in-world actor or as a director that portrays many characters. |
| **Player control** | Persona minds are optional. Turn them off when the player alone controls the persona. |
| **Timeline aware** | Reconciles edits, deletions, swipes, regenerations, and chat forks. |
| **Spoiler-safe lens** | Beliefs and secrets stay collapsed until you deliberately reveal them. |
| **Editable state** | Correct, pin, lock, merge, split, rename, or remove inferred information. |
| **Background analysis** | Uses a controller after committed turns without blocking normal generation. |
| **Private injection** | Adds one cached system message containing the present cast's unresolved state; the interceptor makes no model call. |
| **Diagnostics** | Produces a privacy-safe report for controller and timeline troubleshooting. |

---

## Why LumiMind

Most roleplay context describes the world from a shared, mostly objective point of view. That works until characters begin to disagree.

Without separate minds, a model may:

- let a character know something they never witnessed;
- forget that a lie was believed;
- reveal a secret without motivation;
- flatten a complicated relationship back into a generic attitude;
- abandon a goal between replies;
- treat every character portrayed by a director card as one blended personality.

LumiMind keeps a different continuity record for each actor. The model still writes the story, but it receives the unresolved state of the managed cast members currently present in the scene.

The controller is evidence-bound. It may infer strong subtext, motives, emotions, or likely beliefs, but it is instructed not to invent objective events.

---

## How it works

```text
Completed turn
      │
      ▼
Background controller analysis
      │
      ├── Aster believes the warning
      ├── Mira suspects it is a trap
      └── Rowan never heard it
      │
      ▼
Branch-aware timeline checkpoint
      │
      ▼
Next generation receives every present managed mind's unresolved state
```

1. **You activate a chat.** New chats remain off until you explicitly enable them.
2. **LumiMind reads committed history.** Existing messages are initialized in bounded background batches.
3. **The controller returns evidence-linked changes.** Each accepted entry records its source message, swipe, confidence, and provenance.
4. **The timeline is folded deterministically.** Current minds are rebuilt from the compatible records on the active branch.
5. **The next reply gets a cached checkpoint.** LumiMind injects every present managed actor and all of their active or uncertain state.
6. **You remain the editor.** Manual changes are locked and cannot be overwritten until you unlock them.

If a substantive batch leaves a genuinely uninitialized actor without usable mental state, LumiMind performs at most one focused corrective pass. An empty change set is healthy when the existing ledger already covers the scene.

---

## Compatibility

| Requirement | Value |
|---|---|
| Lumiverse | `1.0.6` or newer |
| Extension version | `0.1.1` beta |
| Required for automatic analysis | `generation`, `chat_mutation` |
| Required for prompt injection | `interceptor` |
| Controller connection | Dedicated connection or the active chat connection |
| Build output | Committed `dist/backend.js` and `dist/frontend.js` |

LumiMind degrades by capability. Optional identity, seed, and Memory Cortex features disappear when their permissions are unavailable without breaking normal Lumiverse chat.

---

## Installation

### Install from GitHub

```text
1. Copy:    https://github.com/Archkr/Lumiverse-LumiMind
2. Open:    Lumiverse → Extensions → Install
3. Paste:   the URL into the repository field
4. Press:   Install
5. Enable:  LumiMind and grant the permissions you want to use
6. Verify:  Mind Lens appears in the drawer and command palette
```

No local build is required for a normal installation because the release-ready `dist/` bundles are committed.

### Update

Use the update action on LumiMind’s entry in Lumiverse’s Extensions panel, then reload the extension if Lumiverse asks you to.

---

## Quick start

| Step | Action | Where |
|---|---|---|
| 1 | Open a character or group chat | Lumiverse |
| 2 | Open **Mind Lens** | Drawer or `Ctrl+K` |
| 3 | Choose **Activate Mind Lens** | Mind Lens |
| 4 | Select a controller connection, or keep the active-connection fallback | Settings |
| 5 | Choose whether LumiMind may manage your persona | Settings → Roleplay behavior |
| 6 | Enable Director mode if the card portrays a cast instead of itself | Settings → Roleplay behavior |
| 7 | Let initialization finish while you continue chatting normally | Changes / status bar |
| 8 | Review the resolved cast and current scene | Cast / Scene |

Activated forks inherit activation and compatible analysis through the fork point. An unrelated chat receives its own timeline and does not automatically share discovered NPC identities.

---

## Choose your roleplay style

LumiMind supports the two most common card patterns without asking you to restructure your cards.

### Actor card — default

Use this when the active character card represents one in-world character.

- The card receives its own mind.
- Solo and group generations target the exact selected character.
- Every present managed actor is included in the private injection.
- Active and uncertain state is included without an extension-level injection cap.
- Self-concept remains available to analysis and Mind Lens but is omitted from generation injection because the host already supplies the character card.

### Director card

Enable **Character card acts as director** when the card is a narrator, scenario engine, or multi-character director.

- The host card is not treated as an in-world mind.
- Named individuals portrayed inside assistant messages become independent NPC actors.
- The normal target injection becomes an ensemble injection containing every present managed cast member.

### Persona control

**Manage the active persona** is enabled by default for users who want persona continuity and impersonation support.

Turn it off when you alone control the persona:

- LumiMind stops analyzing or displaying a persona mind.
- User-authored turns advance the timeline without a controller call, while remaining context for the next assistant-turn analysis.
- The persona is excluded from private state injection.
- Impersonation receives no LumiMind persona injection.
- Other characters may still hold beliefs and relationships about the persona.
- The injected guidance tells the model not to decide the persona’s thoughts, feelings, dialogue, or actions.

Changing either roleplay option invalidates the previous analysis policy. Activated timelines rebuild under the new policy when opened. Reviewed seeds and locked manual edits remain stored; controller-derived state is recomputed from committed history.

---

## Mind Lens

Mind Lens is LumiMind’s main drawer interface.

<details open>
<summary><b>Cast</b> &mdash; inspect and correct individual minds</summary>

- Browse every managed card, persona, and discovered NPC.
- Review core self-concept, values, desires, fears, and boundaries.
- Inspect beliefs, secrets, goals, plans, emotions, relationships, and awareness.
- See confidence, evidence, source message, and swipe provenance.
- Add or edit state manually; user-authored entries are locked and pinned by default.
- Rename actors, add aliases, confirm identities, merge duplicates, split mistakes, or remove actors from the timeline.

</details>

<details>
<summary><b>Scene</b> &mdash; see who matters right now</summary>

- Shows actors currently marked present.
- Summarizes non-spoiler attention and active signals.
- Keeps beliefs and secrets out of the overview.
- Falls back to the wider cast when no one has been marked present yet.

</details>

<details>
<summary><b>Changes</b> &mdash; follow timeline health and controller results</summary>

- View committed analysis records by message and swipe.
- See accepted actor mentions, state changes, and quality warnings.
- Pause or resume automatic analysis.
- Retry a failed or stale suffix.
- Rebuild committed history under the current rules and roleplay mode.

</details>

<details>
<summary><b>Settings</b> &mdash; controller, roleplay, privacy, and diagnostics</summary>

- Choose the controller connection and analysis limits.
- Toggle persona management and Director mode.
- Configure spoiler safety and Memory Cortex behavior.
- Enable private extension interoperability when desired.
- Review live permission availability.
- Open the privacy-safe Diagnostics window.

</details>

### Spoiler safety

Beliefs and secrets are collapsed by default. They are revealed only when you deliberately open those sections.

This protects the reading experience, not the files on disk. See [Privacy](#privacy).

### Diagnostics

Open **Mind Lens → Settings → Diagnostics** to inspect:

- frontend and active-chat context;
- granted permissions;
- controller availability and provider metadata;
- timeline freshness and health;
- aggregate actor, mind, and record counts;
- raw-versus-normalized structured-output counts;
- accepted mentions and mental-state changes;
- privacy-safe rejection reasons for malformed, stale, unknown, missing-target, or protected changes;
- corrective attempts and retry failures;
- privacy-safe response lengths and hashes.

**Copy report** produces formatted JSON suitable for a bug report. It excludes story text, beliefs, secrets, raw controller output, evidence excerpts, actor names, aliases, credentials, and full entity IDs.

**Copy developer report** includes the full available transcript, identities, mind state, evidence, seeds, overrides, analysis records, and entity IDs. API credential fields remain redacted. Treat this report as private and share it only with trusted developers.

---

## Mind Seed

Mind Seeds provide reusable starting characterization before timeline-specific events begin.

Open a character’s editor, then scroll the top tab strip to the far right. **Mind Seed** appears after **Advanced** when the `characters` permission is granted.

| Action | Behavior |
|---|---|
| No reviewed seed | Character description, personality, and creator notes form a transient baseline. |
| **Generate draft** | The controller extracts an editable draft from the card fields. Nothing is saved automatically. |
| **Save reviewed seed** | Stores the reviewed seed at `character.extensions.lumi_mind.seed.v1`. |
| Remove reviewed seed | Future timelines return to transient card-field fallback; existing chat history remains intact. |

Seeds are for enduring characterization. Timeline state is for what this particular version of the character has experienced, inferred, and decided in one chat branch.

---

## Timeline behavior

LumiMind is designed for conversations that do not stay perfectly linear.

| Event | What LumiMind does |
|---|---|
| New committed turn | Analyzes the new suffix in the background. |
| Regeneration or swipe | Restores a compatible cached checkpoint when possible and replays the affected suffix when needed. |
| Message edit | Invalidates analysis from the earliest changed message forward. |
| Message deletion | Rebuilds from the earliest affected point. |
| Chat fork | Copies compatible records through the fork point, preserves actor IDs, then evolves independently. |
| Rapid changes | Coalesces work through one serialized queue per chat. |
| Controller delay | Keeps normal generation available and uses the last valid checkpoint. |
| Controller error | Exposes stale/error status and retains recoverable state. |

Controller results are stored as evidence-linked deltas rather than one repeatedly rewritten state blob. Manual locked edits are folded on top and survive deterministic rebuilds.

---

## Settings reference

LumiMind settings are user-scoped and apply across chats.

### Roleplay behavior

| Setting | Default | What it does |
|---|---:|---|
| Manage the active persona | On | Allows persona analysis, display, secondary state, and impersonation injection. |
| Character card acts as director | Off | Excludes host card minds and manages the named cast portrayed by the card. |

### Analysis and injection

| Setting | Default | What it does |
|---|---:|---|
| Controller connection | Active connection | Uses a dedicated Lumiverse connection when selected. |
| Temperature | `0.1` | Sampling temperature for background controller calls. |
| Analysis output tokens | `1,800` | Maximum output requested per analysis call, with no LumiMind-imposed upper bound. The selected model or provider may enforce its own limit. |
| Analysis context messages | `4` | Maximum number of earlier transcript messages supplied as context for each analysis batch; `0` disables prior-message context. |
| Chat history messages | Unlimited | Maximum number of stored chat messages retained in the main generation prompt while LumiMind is active; `0` keeps the full history. |

### Privacy and interoperability

| Setting | Default | What it does |
|---|---:|---|
| Spoiler-safe lens | On | Collapses beliefs and secrets in Mind Lens. |
| Import Cortex identities | On | Imports character entity names and aliases for identity resolution. |
| Cortex identity writeback | Off | Publishes only confirmed identity and aliases—never private mind state. |
| Private extension interop | Off | Registers the permission-gated private scene snapshot. |

---

## Controller usage and cost

LumiMind normally makes one quiet controller call after each newly committed analyzable turn. When persona management is off, user-authored turns are checkpointed without calling the controller.

Additional calls can occur when:

- activating a chat with existing history;
- rebuilding a timeline;
- replaying edits, deletions, or changed swipes;
- changing Persona or Director policy;
- retrying transient failures;
- running one corrective pass after a substantive empty bootstrap result;
- generating a Mind Seed draft.

Initial history is analyzed in bounded batches. You can pause a timeline whenever you do not want background analysis costs.

The prompt interceptor itself makes **no model call**. It reads the latest valid checkpoint and injects every present managed actor's active or uncertain state in one system message. Self-concept is retained for analysis and review but omitted from this generation-time block to avoid repeating the character card. Prompt Breakdown attributes the block as **LumiMind — Private Mind**.

LumiMind uses the dedicated controller connection selected in Settings. If none is selected, it falls back to the active connection for the chat. It uses Lumiverse connection profiles and does not read or store API credentials.

---

## Permissions

| Permission | Used for | If unavailable |
|---|---|---|
| `generation` | Background analysis, connection listing, and Mind Seed drafts | Controller features become inactive. |
| `interceptor` | Private checkpoint injection before generation | Analysis can remain stored, but no mind block is injected. |
| `chats` | Active chat and card routing | Host enrichment is limited to context supplied elsewhere. |
| `chat_mutation` | Read-only access to committed raw message history and private RPC gating | Automatic timeline analysis is disabled. |
| `characters` | Stable card identity, reviewed seeds, and Mind Seed editor tab | Card enrichment and seed editing are unavailable. |
| `personas` | Stable active-persona identity | Persona enrichment is unavailable. |
| `memories` | Optional Memory Cortex identity import and writeback | The independent actor registry continues to work. |

Despite the `chat_mutation` permission name, LumiMind does not edit, delete, hide, append, or swipe Lumiverse chat messages. It reads committed history and stores its own extension timeline separately.

Permissions are checked live. Denying an optional permission should remove only the dependent capability rather than breaking Lumiverse.

---

## Privacy

LumiMind stores:

- user-scoped global settings;
- per-chat actor registries and timeline records;
- inferred and manually edited mental-state entries;
- reviewed Mind Seeds on their character cards;
- privacy-safe diagnostics metadata.

LumiMind does **not** claim cryptographic secrecy. Anyone with direct access to the Lumiverse data directory or exported character extension data may be able to read stored minds and seeds.

### Controller data

The selected controller receives up to the configured number of previous transcript messages, the current analysis batch, and the compact state needed to update the timeline. Treat that connection with the same privacy expectations as any model connection used for chat.

Diagnostics store counts, lengths, hashes, provider metadata, warning codes, and sanitized rejection reason codes—not raw controller responses or private story content.

---

## Memory Cortex integration

LumiMind has its own actor registry and works normally without Memory Cortex. Cortex integration is an optional identity bridge, not a storage destination for character minds.

### Identity import — on by default

When **Import Cortex identities** is enabled and the `memories` permission is available, LumiMind can read Memory Cortex `character` entities for the active chat.

It uses only:

- entity names;
- known aliases;
- confirmation confidence;
- the Cortex entity ID needed to preserve the optional link.

This helps LumiMind recognize that “Captain Mira,” “Mira,” and an already-known Cortex character refer to the same actor. Imported identities join the chat-local registry, while unrelated chats still do not automatically share LumiMind’s discovered NPC IDs.

### Identity writeback — off by default

LumiMind never publishes an inferred identity automatically. To write an actor back to Cortex, you must:

1. enable **Cortex identity writeback** in Settings;
2. review and confirm the actor in Mind Lens;
3. correct its canonical name and aliases if needed;
4. deliberately use the writeback action.

Writeback is limited to the confirmed actor’s name and aliases. LumiMind never writes beliefs, secrets, goals, plans, emotions, relationships, evidence, or private scene state to Memory Cortex.

### Without the `memories` permission

Nothing essential breaks. LumiMind continues resolving character cards, personas, and chat-local NPCs through its independent registry. Cortex import, linkage, and writeback controls simply become unavailable.

---

## Extension interoperability

LumiMind publishes shared RPC snapshots so other extensions can use scene context without reading LumiMind’s storage format.

| Endpoint | Access | Contents |
|---|---|---|
| `lumi_mind.contract.v1` | Public | Schema version, capabilities, and endpoint metadata. |
| `lumi_mind.scene.current` | Public | Active chat, revision, freshness, actor identities, aliases, presence, and public stance. |
| `lumi_mind.state.current` | Public | The same spoiler-safe cast mapped into the shared LumiState v1 scene schema. |
| `lumi_mind.scene.private` | Opt-in, requires `chat_mutation` | Compact private beliefs, secrets, goals, and relationships. |

Every scene snapshot includes `chatId`, `revision`, and `schemaVersion: 1`. Consumers should reject unsupported schemas, snapshots for another active chat, or revisions older than the newest one already accepted.

If LumiMind is missing, permission-gated, disabled, or stale, LumiState and future extensions should continue without LumiMind data.

---

## Tips

> **Start with one short chat.** Activate LumiMind on a small transcript before rebuilding a long-running roleplay. This confirms that your controller returns usable structured state.

> **Use Director mode for scenario cards.** If the card narrates several named characters, enabling Director mode prevents their motives from collapsing into the card’s identity.

> **Turn persona management off if authorship matters.** Other characters can still react to the player; LumiMind simply stops assigning the player an internal state or injecting instructions for it.

> **Treat beliefs as beliefs.** Correct a mind when the character would not reasonably know something. Do not “fix” a false belief merely because you know the objective truth.

> **Lock deliberate corrections.** Manual edits are locked automatically. Keep them locked when the controller should not reinterpret them.

> **Confirm identities before Cortex writeback.** Merge duplicates and review aliases first. Writeback is intentionally identity-only.

> **Watch Changes after switching controllers.** Different providers vary in structured-output reliability. The quality banner and Diagnostics report show whether entries were dropped or a corrective pass was needed.

---

## Troubleshooting

<details>
<summary><b>Mind Lens says access is missing</b></summary>

Open **Lumiverse → Settings → Extensions**, select LumiMind, and grant the permissions listed in the inactive state.

Automatic analysis needs `generation` and `chat_mutation`. Prompt injection additionally needs `interceptor`.

</details>

<details>
<summary><b>The timeline is current but contains no mind entries</b></summary>

Mind Lens treats a technically compatible but suspiciously empty bootstrap result as an analysis-quality problem. Empty reconciliations for already initialized actors are valid no-ops.

1. Open **Settings → Diagnostics**.
2. Compare raw, normalized, and final accepted counts.
3. Check whether the corrective pass ran or failed.
4. Choose **Rebuild analysis** from the warning or Changes view.
5. If it remains empty, try a controller with stronger structured-output support and copy the sanitized report for a bug report.

</details>

<details>
<summary><b>The timeline is stale or in error</b></summary>

Open **Changes** and choose **Retry**. Use **Rebuild** when committed history changed substantially, a roleplay mode changed, or the controller repeatedly returned malformed output.

Locked manual edits remain applied.

</details>

<details>
<summary><b>Prompt injection is missing</b></summary>

Check that:

- the chat is activated and not paused;
- `interceptor` is granted;
- analysis has produced a valid checkpoint;
- Actor-card mode has the correct target card in the registry;
- Director mode has discovered at least one portrayed cast member;
- persona management is enabled if you expect impersonation injection.

Open Prompt Breakdown and look for **LumiMind — Private Mind**.

</details>

<details>
<summary><b>My persona disappeared from Mind Lens</b></summary>

Open **Settings → Roleplay behavior** and enable **Manage the active persona**. LumiMind will rebuild the activated timeline under the new policy.

If the setting is on but no persona appears, confirm that the `personas` permission is granted and an active persona is selected in Lumiverse.

</details>

<details>
<summary><b>The director card appears as a character, or the cast is blended together</b></summary>

Enable **Character card acts as director**, save Settings, and let the timeline rebuild. The host card will be excluded from managed minds and named individuals in its replies will be resolved as NPC cast members.

Use actor tools to merge any duplicates left from earlier analysis.

</details>

<details>
<summary><b>Mind Seed is not visible in the character editor</b></summary>

Confirm that the `characters` permission is granted. Open a character editor and scroll its top tab strip all the way to the right; **Mind Seed** is appended after **Advanced**.

</details>

<details>
<summary><b>A character has the wrong identity</b></summary>

Use the actor menu in Cast to:

- rename the actor;
- add or remove aliases;
- merge duplicates;
- split an incorrectly combined identity;
- confirm a reviewed NPC;
- remove the actor from this LumiMind timeline.

Unrelated chats do not automatically share discovered NPC identities.

</details>

<details>
<summary><b>No controller connection appears</b></summary>

Grant `generation`, configure at least one Lumiverse connection, and refresh Mind Lens. Leaving the selector on **Use active Lumiverse connection** uses the connection associated with the chat.

</details>

<details>
<summary><b>Secrets are visible in files or exported data</b></summary>

This is expected. Spoiler-safe mode controls disclosure in Mind Lens; it is not encryption. See [Privacy](#privacy).

</details>

<details>
<summary><b>I need to report a bug</b></summary>

Open **Mind Lens → Settings → Diagnostics**, choose **Refresh snapshot**, then **Copy report**.

The copied JSON omits private story text, mind entries, actor names, aliases, evidence, credentials, raw controller output, and full IDs.

</details>

---

## Development

### Source layout

```text
src/
  backend.ts          lifecycle events, queues, persistence, RPC, interception
  controller.ts       controller prompts, structured output, tolerant parsing
  engine.ts           actor resolution, deltas, reducer, ranking, compaction
  frontend.ts         Mind Lens, Diagnostics, and Mind Seed integration
  storage.ts          user-scoped settings and timeline storage
  types.ts            shared versioned contracts
  ui/
    helpers.ts        UI normalization and formatting helpers
    styles.ts         Mind Lens and Mind Seed styling

dist/
  backend.js          bundled backend entrypoint
  frontend.js         bundled frontend entrypoint

spindle.json          LumiMind manifest
```

### Commands

```bash
bun install            # install development dependencies
bun run typecheck      # strict TypeScript validation
bun run test           # Vitest suite
bun run build          # rebuild backend and frontend bundles
bun run build:backend  # backend bundle only
bun run build:frontend # frontend bundle only
```

Built `dist/` files are committed so Lumiverse can install and run LumiMind directly from the repository.

---

## License

LumiMind is provided under the **Lumiverse Community License 2.0**. See [`LICENSE.md`](./LICENSE.md) for the complete terms.
