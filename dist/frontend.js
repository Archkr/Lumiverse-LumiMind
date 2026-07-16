// src/ui/helpers.ts
var MIND_CATEGORIES = [
  "belief",
  "secret",
  "goal",
  "plan",
  "emotion",
  "relationship",
  "awareness"
];
var EMPTY_MIND_CORE = {
  selfConcept: "",
  values: [],
  desires: [],
  fears: [],
  boundaries: [],
  notes: []
};
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function uniqueLines(value) {
  const raw = Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : typeof value === "string" ? value.split(/\r?\n/) : [];
  const seen = /* @__PURE__ */ new Set();
  return raw.flatMap((entry) => {
    const text = entry.trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) return [];
    seen.add(key);
    return [text];
  });
}
function normalizeMindCore(value) {
  const raw = asRecord(value);
  return {
    selfConcept: typeof raw.selfConcept === "string" ? raw.selfConcept.trim() : "",
    values: uniqueLines(raw.values),
    desires: uniqueLines(raw.desires),
    fears: uniqueLines(raw.fears),
    boundaries: uniqueLines(raw.boundaries),
    notes: uniqueLines(raw.notes)
  };
}
function makeBlankSeed() {
  return {
    schemaVersion: 1,
    core: { ...EMPTY_MIND_CORE },
    startingBeliefs: [],
    startingSecrets: [],
    startingGoals: [],
    relationshipPriors: [],
    updatedAt: Date.now()
  };
}
function normalizeMindSeed(value) {
  const raw = asRecord(value);
  if (raw.schemaVersion !== 1 && !Object.keys(raw).length) return null;
  const relationshipPriors = Array.isArray(raw.relationshipPriors) ? raw.relationshipPriors.flatMap((entry) => {
    const relationship = asRecord(entry);
    const target = typeof relationship.target === "string" ? relationship.target.trim() : "";
    const stance = typeof relationship.stance === "string" ? relationship.stance.trim() : "";
    return target && stance ? [{ target, stance }] : [];
  }) : [];
  return {
    schemaVersion: 1,
    core: normalizeMindCore(raw.core),
    startingBeliefs: uniqueLines(raw.startingBeliefs),
    startingSecrets: uniqueLines(raw.startingSecrets),
    startingGoals: uniqueLines(raw.startingGoals),
    relationshipPriors,
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now()
  };
}
function readReviewedSeed(extensions) {
  const root = asRecord(extensions);
  const extension = asRecord(root.lumi_mind);
  const seed = asRecord(extension.seed);
  return normalizeMindSeed(seed.v1);
}
function writeReviewedSeed(extensions, seed) {
  const extension = asRecord(extensions.lumi_mind);
  const seedContainer = asRecord(extension.seed);
  return {
    ...extensions,
    lumi_mind: {
      ...extension,
      seed: {
        ...seedContainer,
        v1: { ...seed, updatedAt: Date.now() }
      }
    }
  };
}
function removeReviewedSeed(extensions) {
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
function seedFromCharacterCard(value) {
  const card = asRecord(value);
  const seed = makeBlankSeed();
  seed.core.selfConcept = typeof card.description === "string" ? card.description.trim() : "";
  seed.core.notes = uniqueLines([card.personality, card.creator_notes]);
  return seed;
}
function cloneSeed(seed) {
  return {
    ...seed,
    core: {
      ...seed.core,
      values: [...seed.core.values],
      desires: [...seed.core.desires],
      fears: [...seed.core.fears],
      boundaries: [...seed.core.boundaries],
      notes: [...seed.core.notes]
    },
    startingBeliefs: [...seed.startingBeliefs],
    startingSecrets: [...seed.startingSecrets],
    startingGoals: [...seed.startingGoals],
    relationshipPriors: seed.relationshipPriors.map((entry) => ({ ...entry }))
  };
}
function cloneSettings(settings) {
  return { ...settings };
}
function relationshipLines(seed) {
  return seed.relationshipPriors.map((entry) => `${entry.target} :: ${entry.stance}`).join("\n");
}
function parseRelationshipLines(value) {
  return uniqueLines(value).flatMap((line) => {
    const separator = line.indexOf("::");
    if (separator < 1) return [];
    const target = line.slice(0, separator).trim();
    const stance = line.slice(separator + 2).trim();
    return target && stance ? [{ target, stance }] : [];
  });
}
function healthLabel(health) {
  return {
    inactive: "Inactive",
    initializing: "Initializing",
    ready: "Current",
    pending: "Analyzing",
    stale: "Using checkpoint",
    paused: "Paused",
    error: "Needs attention"
  }[health];
}
function healthTone(health) {
  if (health === "ready") return "good";
  if (health === "initializing" || health === "pending") return "working";
  if (health === "stale" || health === "paused") return "warning";
  if (health === "error") return "danger";
  return "neutral";
}
function missingAnalysisPermissions(state) {
  const permissions = state.permissions;
  return [
    !permissions.generation ? "Generation" : "",
    !permissions.interceptor ? "Prompt interceptor" : "",
    !permissions.chatMutation ? "Chat history" : ""
  ].filter(Boolean);
}
function actorInitials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words.at(-1)?.[0] ?? ""}`).toLocaleUpperCase();
}
function actorItemCount(mind) {
  return mind?.items.filter((item) => item.status === "active" || item.status === "uncertain").length ?? 0;
}
function findActor(actors, actorId) {
  return actors.find((actor) => actor.id === actorId) ?? null;
}
function formatRelativeTime(timestamp, now = Date.now()) {
  if (!timestamp) return "Never";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1e3));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
function compactChatId(chatId) {
  return chatId.length <= 16 ? chatId : `${chatId.slice(0, 7)}\u2026${chatId.slice(-6)}`;
}

// src/ui/styles.ts
var LUMI_MIND_CSS = `
.lm-root {
  --lm-text: var(--lumiverse-text, #ececf2);
  --lm-muted: var(--lumiverse-text-muted, #a3a5b4);
  --lm-dim: var(--lumiverse-text-dim, #747788);
  --lm-bg: var(--lumiverse-bg-deep, #111219);
  --lm-panel: var(--lumiverse-bg-elevated, #191a23);
  --lm-raised: var(--lumiverse-bg-hover, #22242f);
  --lm-fill: var(--lumiverse-fill-subtle, rgba(255,255,255,.045));
  --lm-fill-hover: var(--lumiverse-fill-hover, rgba(255,255,255,.075));
  --lm-line: var(--lumiverse-border, rgba(255,255,255,.1));
  --lm-line-hover: var(--lumiverse-border-hover, rgba(255,255,255,.18));
  --lm-accent: var(--lumiverse-primary, #8b7cf6);
  --lm-accent-hover: var(--lumiverse-primary-hover, #9b8eff);
  --lm-accent-soft: var(--lumiverse-primary-light, rgba(139,124,246,.18));
  --lm-accent-muted: var(--lumiverse-primary-muted, rgba(139,124,246,.1));
  --lm-accent-fg: var(--lumiverse-primary-contrast, #fff);
  --lm-success: var(--lumiverse-success, #69c79f);
  --lm-warning: var(--lumiverse-warning, #e1a75c);
  --lm-danger: var(--lumiverse-danger, #e17078);
  --lm-radius-sm: var(--lumiverse-radius-sm, 6px);
  --lm-radius: var(--lumiverse-radius-md, 9px);
  --lm-radius-lg: var(--lumiverse-radius-lg, 13px);
  --lm-radius-xl: var(--lumiverse-radius-xl, 18px);
  --lm-transition: var(--lumiverse-transition-fast, 150ms ease);
  color: var(--lm-text);
  font-family: var(--lumiverse-font-family, inherit);
  font-size: 13px;
  line-height: 1.48;
}

.lm-root *, .lm-root *::before, .lm-root *::after { box-sizing: border-box; }
.lm-root h1, .lm-root h2, .lm-root h3, .lm-root p { margin: 0; }
.lm-root button, .lm-root input, .lm-root select, .lm-root textarea { font: inherit; }
.lm-root button { color: inherit; }
.lm-root svg { display: block; width: 100%; height: 100%; }

.lm-drawer {
  min-height: 100%;
  padding: 15px 14px 28px;
  display: flex;
  flex-direction: column;
  gap: 13px;
  background:
    radial-gradient(circle at 100% 0, color-mix(in srgb, var(--lm-accent) 8%, transparent), transparent 32%),
    transparent;
}

.lm-brand-header { display: grid; grid-template-columns: 38px minmax(0,1fr) auto; gap: 10px; align-items: center; }
.lm-brand-mark {
  width: 38px; height: 38px; padding: 8px;
  border: 1px solid color-mix(in srgb, var(--lm-accent) 35%, var(--lm-line));
  border-radius: 12px;
  color: var(--lm-accent);
  background: linear-gradient(145deg, var(--lm-accent-soft), var(--lm-fill));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 8px 25px rgba(0,0,0,.15);
}
.lm-brand-copy { min-width: 0; }
.lm-eyebrow, .lm-kicker { color: var(--lm-accent); font-size: 10px; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; }
.lm-brand-title { color: var(--lm-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.lm-header-actions { display: flex; align-items: center; gap: 5px; }
.lm-status { padding: 4px 7px; border: 1px solid var(--lm-line); border-radius: 999px; color: var(--lm-muted); font-size: 10px; font-weight: 700; white-space: nowrap; background: var(--lm-fill); }
.lm-status-good { color: var(--lm-success); border-color: color-mix(in srgb, var(--lm-success) 35%, var(--lm-line)); background: color-mix(in srgb, var(--lm-success) 9%, transparent); }
.lm-status-working { color: var(--lm-accent); border-color: color-mix(in srgb, var(--lm-accent) 35%, var(--lm-line)); background: var(--lm-accent-muted); }
.lm-status-warning { color: var(--lm-warning); border-color: color-mix(in srgb, var(--lm-warning) 35%, var(--lm-line)); }
.lm-status-danger { color: var(--lm-danger); border-color: color-mix(in srgb, var(--lm-danger) 35%, var(--lm-line)); }

.lm-icon { width: 15px; height: 15px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.lm-icon-btn {
  appearance: none; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 6px; border: 1px solid transparent; border-radius: 8px;
  color: var(--lm-muted); background: transparent; cursor: pointer; transition: all var(--lm-transition);
}
.lm-icon-btn:hover { color: var(--lm-text); background: var(--lm-fill-hover); border-color: var(--lm-line); }
.lm-icon-btn.active { color: var(--lm-accent); background: var(--lm-accent-muted); border-color: color-mix(in srgb, var(--lm-accent) 25%, var(--lm-line)); }
.lm-icon-btn.danger:hover { color: var(--lm-danger); background: color-mix(in srgb, var(--lm-danger) 10%, transparent); }

.lm-nav { display: grid; grid-template-columns: repeat(4,1fr); gap: 3px; padding: 3px; border: 1px solid var(--lm-line); border-radius: 10px; background: var(--lm-fill); }
.lm-nav-item { appearance: none; border: 0; border-radius: 7px; padding: 7px 4px; background: transparent; color: var(--lm-muted); font-size: 11px; font-weight: 650; cursor: pointer; transition: all var(--lm-transition); }
.lm-nav-item:hover { color: var(--lm-text); background: var(--lm-fill-hover); }
.lm-nav-item.active { color: var(--lm-text); background: var(--lm-raised); box-shadow: 0 1px 4px rgba(0,0,0,.16), inset 0 1px 0 rgba(255,255,255,.04); }

.lm-notice { display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border: 1px solid var(--lm-line); border-radius: var(--lm-radius); background: var(--lm-panel); color: var(--lm-muted); font-size: 11px; }
.lm-notice-dot { width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; flex: 0 0 auto; background: var(--lm-accent); box-shadow: 0 0 0 3px var(--lm-accent-muted); }
.lm-notice-success .lm-notice-dot { background: var(--lm-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lm-success) 12%, transparent); }
.lm-notice-warning .lm-notice-dot { background: var(--lm-warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lm-warning) 12%, transparent); }
.lm-notice-error .lm-notice-dot { background: var(--lm-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lm-danger) 12%, transparent); }
.lm-notice-copy { min-width: 0; }

.lm-view { display: flex; flex-direction: column; gap: 13px; min-width: 0; }
.lm-view-title { margin-top: 2px !important; font-size: 19px; line-height: 1.2; letter-spacing: -.018em; }
.lm-view-copy { margin-top: 6px !important; color: var(--lm-muted); font-size: 11px; }
.lm-empty-card { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; margin-top: 22px; padding: 26px 18px; border: 1px solid var(--lm-line); border-radius: var(--lm-radius-lg); background: linear-gradient(150deg, var(--lm-panel), var(--lm-fill)); }
.lm-empty-icon { width: 48px; height: 48px; padding: 12px; color: var(--lm-accent); border: 1px solid color-mix(in srgb,var(--lm-accent) 28%,var(--lm-line)); border-radius: 16px; background: var(--lm-accent-muted); }
.lm-empty-title { font-size: 17px; }
.lm-empty-copy { max-width: 360px; color: var(--lm-muted); font-size: 12px; }
.lm-empty-inline { padding: 11px; border: 1px dashed var(--lm-line); border-radius: var(--lm-radius); color: var(--lm-dim); text-align: center; font-size: 11px; background: var(--lm-fill); }
.lm-large-empty { padding: 25px 14px; }
.lm-permission-list { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
.lm-permission-chip { padding: 4px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.lm-permission-chip.missing { color: var(--lm-danger); background: color-mix(in srgb,var(--lm-danger) 10%,transparent); border: 1px solid color-mix(in srgb,var(--lm-danger) 28%,var(--lm-line)); }
.lm-orbit { position: relative; width: 62px; height: 62px; border: 1px solid color-mix(in srgb,var(--lm-accent) 28%,transparent); border-radius: 50%; }
.lm-orbit::before { content:""; position:absolute; inset:12px; border:1px solid color-mix(in srgb,var(--lm-accent) 45%,transparent); border-radius:50%; }
.lm-orbit span { position:absolute; width:7px; height:7px; border-radius:50%; background:var(--lm-accent); box-shadow:0 0 12px var(--lm-accent); }
.lm-orbit span:nth-child(1){top:-3px;left:27px}.lm-orbit span:nth-child(2){bottom:5px;left:5px}.lm-orbit span:nth-child(3){bottom:7px;right:4px}

.lm-button { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 32px; padding: 7px 11px; border: 1px solid var(--lm-line); border-radius: 8px; background: var(--lm-panel); color: var(--lm-text); font-size: 11px; font-weight: 700; cursor: pointer; transition: all var(--lm-transition); }
.lm-button:hover:not(:disabled) { border-color: var(--lm-line-hover); background: var(--lm-raised); transform: translateY(-1px); }
.lm-button:disabled { opacity: .45; cursor: default; }
.lm-button-primary { color: var(--lm-accent-fg); background: var(--lm-accent); border-color: var(--lm-accent); }
.lm-button-primary:hover:not(:disabled) { color: var(--lm-accent-fg); background: var(--lm-accent-hover); border-color: var(--lm-accent-hover); }
.lm-button-danger { color: var(--lm-danger); background: color-mix(in srgb,var(--lm-danger) 8%,var(--lm-panel)); border-color: color-mix(in srgb,var(--lm-danger) 25%,var(--lm-line)); }
.lm-button-quiet { min-height: 26px; padding: 4px 7px; color: var(--lm-muted); background: transparent; border-color: transparent; }
.lm-button-quiet:hover:not(:disabled) { color: var(--lm-text); background: var(--lm-fill-hover); border-color: var(--lm-line); transform: none; }

.lm-activation { position: relative; overflow: hidden; display: grid; gap: 20px; padding: 24px 18px; margin-top: 8px; border: 1px solid color-mix(in srgb,var(--lm-accent) 22%,var(--lm-line)); border-radius: var(--lm-radius-xl); background: linear-gradient(145deg, color-mix(in srgb,var(--lm-accent) 8%,var(--lm-panel)), var(--lm-panel)); }
.lm-activation::after { content:""; position:absolute; width:180px; height:180px; border-radius:50%; right:-100px; top:-110px; background:var(--lm-accent); filter:blur(70px); opacity:.09; pointer-events:none; }
.lm-activation-visual { position:relative; width:88px; height:88px; margin:0 auto; display:flex; align-items:center; justify-content:center; color:var(--lm-accent); }
.lm-activation-visual > svg { width:34px; height:34px; z-index:1; }
.lm-activation-ring { position:absolute; inset:5px; border:1px solid color-mix(in srgb,var(--lm-accent) 35%,transparent); border-radius:50%; }
.lm-activation-ring:nth-child(2) { inset:18px; border-style:dashed; animation:lm-spin 14s linear infinite; }
@keyframes lm-spin { to { transform:rotate(360deg) } }
.lm-activation-copy { text-align:center; display:flex; flex-direction:column; align-items:center; gap:9px; }
.lm-activation-title { font-size:22px; line-height:1.15; }
.lm-activation-text { color:var(--lm-muted); max-width:380px; font-size:12px; }
.lm-activation-points { display:flex; justify-content:center; gap:6px; flex-wrap:wrap; }
.lm-activation-point { padding:4px 7px; border:1px solid var(--lm-line); border-radius:999px; color:var(--lm-muted); font-size:9px; background:var(--lm-fill); }
.lm-activation-button { margin-top:4px; min-width:160px; }

.lm-timeline-status { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:9px; align-items:start; padding:9px 10px; border:1px solid var(--lm-line); border-radius:var(--lm-radius); background:var(--lm-fill); }
.lm-pulse { width:8px; height:8px; margin-top:5px; border-radius:50%; background:var(--lm-accent); box-shadow:0 0 0 0 var(--lm-accent-soft); animation:lm-pulse 1.8s ease-out infinite; }
@keyframes lm-pulse { 70% { box-shadow:0 0 0 7px transparent } 100% { box-shadow:0 0 0 0 transparent } }
.lm-timeline-warning .lm-pulse { background:var(--lm-warning); animation:none; }
.lm-timeline-danger .lm-pulse { background:var(--lm-danger); animation:none; }
.lm-timeline-status-copy { display:flex; flex-direction:column; gap:1px; min-width:0; }
.lm-timeline-status-copy strong { font-size:11px; }
.lm-timeline-status-copy span { color:var(--lm-muted); font-size:10px; }
.lm-inline-actions { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }

.lm-section-heading { display:flex; align-items:center; gap:6px; margin-bottom:7px; }
.lm-section-title { color:var(--lm-muted); font-size:10px; font-weight:750; letter-spacing:.09em; text-transform:uppercase; }
.lm-count { min-width:18px; padding:1px 5px; border-radius:999px; color:var(--lm-dim); background:var(--lm-fill); text-align:center; font-size:9px; }
.lm-actor-rail { display:flex; gap:7px; overflow-x:auto; scrollbar-width:none; padding-bottom:2px; }
.lm-actor-rail::-webkit-scrollbar { display:none; }
.lm-actor-pill { appearance:none; flex:0 0 auto; display:grid; grid-template-columns:30px auto; align-items:center; gap:7px; min-width:120px; max-width:170px; padding:6px 9px 6px 6px; border:1px solid var(--lm-line); border-radius:11px; background:var(--lm-fill); text-align:left; cursor:pointer; transition:all var(--lm-transition); }
.lm-actor-pill:hover { border-color:var(--lm-line-hover); background:var(--lm-fill-hover); }
.lm-actor-pill.active { border-color:color-mix(in srgb,var(--lm-accent) 45%,var(--lm-line)); background:var(--lm-accent-muted); box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lm-accent) 10%,transparent); }
.lm-actor-avatar, .lm-hero-avatar { position:relative; display:inline-flex; align-items:center; justify-content:center; border:1px solid color-mix(in srgb,var(--lm-accent) 25%,var(--lm-line)); border-radius:10px; color:var(--lm-accent); background:linear-gradient(145deg,var(--lm-accent-soft),var(--lm-fill)); font-size:10px; font-weight:800; letter-spacing:.02em; }
.lm-actor-avatar { width:30px; height:30px; }
.lm-actor-pill-copy { min-width:0; display:flex; flex-direction:column; }
.lm-actor-pill-copy strong { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:11px; }
.lm-actor-pill-copy small { color:var(--lm-dim); font-size:9px; }
.lm-presence-dot { position:absolute; right:-2px; bottom:-2px; width:8px; height:8px; border:2px solid var(--lm-panel); border-radius:50%; background:var(--lm-success); box-shadow:0 0 8px color-mix(in srgb,var(--lm-success) 70%,transparent); }

.lm-actor-detail { display:flex; flex-direction:column; gap:11px; }
.lm-actor-hero { display:grid; grid-template-columns:43px minmax(0,1fr) auto; gap:10px; align-items:center; padding:12px; border:1px solid var(--lm-line); border-radius:var(--lm-radius-lg); background:linear-gradient(135deg,var(--lm-panel),var(--lm-fill)); }
.lm-hero-avatar { width:43px; height:43px; border-radius:13px; font-size:13px; }
.lm-hero-identity { min-width:0; }
.lm-hero-title-row { display:flex; align-items:center; gap:6px; min-width:0; }
.lm-hero-title { font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lm-verified { padding:2px 5px; border:1px solid color-mix(in srgb,var(--lm-success) 30%,var(--lm-line)); border-radius:999px; color:var(--lm-success); background:color-mix(in srgb,var(--lm-success) 8%,transparent); font-size:8px; font-weight:750; text-transform:uppercase; }
.lm-hero-subtitle { color:var(--lm-muted); font-size:9px; margin-top:1px; }
.lm-alias-row { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
.lm-alias-chip { display:inline-flex; align-items:center; gap:3px; padding:2px 3px 2px 6px; border:1px solid var(--lm-line); border-radius:999px; color:var(--lm-muted); background:var(--lm-fill); font-size:9px; }
.lm-alias-chip button { appearance:none; width:15px; height:15px; padding:0; border:0; border-radius:50%; color:var(--lm-dim); background:transparent; cursor:pointer; line-height:1; }
.lm-alias-chip button:hover { color:var(--lm-danger); background:color-mix(in srgb,var(--lm-danger) 10%,transparent); }

.lm-core-card { padding:12px; border:1px solid var(--lm-line); border-radius:var(--lm-radius-lg); background:var(--lm-panel); }
.lm-card-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
.lm-card-title { margin-top:1px !important; font-size:14px; }
.lm-self-concept { margin-top:9px !important; color:var(--lm-text); font-size:12px; line-height:1.55; }
.lm-core-grid { display:grid; gap:8px; margin-top:11px; }
.lm-core-group { display:grid; grid-template-columns:64px minmax(0,1fr); gap:7px; align-items:start; }
.lm-core-label { padding-top:3px; color:var(--lm-dim); font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
.lm-chip-row { display:flex; gap:4px; flex-wrap:wrap; }
.lm-chip { padding:3px 6px; border:1px solid var(--lm-line); border-radius:6px; color:var(--lm-muted); background:var(--lm-fill); font-size:9px; }

.lm-mind-sections { display:flex; flex-direction:column; gap:6px; }
.lm-mind-section { border:1px solid var(--lm-line); border-radius:var(--lm-radius); background:var(--lm-panel); overflow:hidden; }
.lm-mind-section[open] { border-color:var(--lm-line-hover); }
.lm-mind-section-summary { list-style:none; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 11px; cursor:pointer; user-select:none; transition:background var(--lm-transition); }
.lm-mind-section-summary::-webkit-details-marker { display:none; }
.lm-mind-section-summary:hover { background:var(--lm-fill-hover); }
.lm-mind-section-name { display:flex; align-items:baseline; gap:7px; }
.lm-mind-section-name strong { font-size:11px; }
.lm-mind-section-name small { color:var(--lm-dim); font-size:9px; }
.lm-summary-right { display:flex; align-items:center; gap:6px; color:var(--lm-dim); }
.lm-mind-section[open] .lm-summary-right .lm-icon:last-child { transform:rotate(180deg); }
.lm-mind-section.spoiler { border-color:color-mix(in srgb,var(--lm-warning) 20%,var(--lm-line)); background:linear-gradient(120deg,color-mix(in srgb,var(--lm-warning) 4%,var(--lm-panel)),var(--lm-panel)); }
.lm-mind-section.spoiler .lm-mind-section-name small { color:color-mix(in srgb,var(--lm-warning) 75%,var(--lm-muted)); }
.lm-mind-section-body { display:flex; flex-direction:column; gap:6px; padding:0 7px 7px; border-top:1px solid var(--lm-line); }
.lm-section-toolbar { display:flex; justify-content:flex-end; padding-top:4px; }
.lm-spoiler-warning { margin:7px 3px 0; padding:7px 8px; border-radius:7px; color:var(--lm-warning); background:color-mix(in srgb,var(--lm-warning) 8%,transparent); font-size:9px; }
.lm-mind-item { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px; padding:9px; border:1px solid var(--lm-line); border-radius:8px; background:var(--lm-fill); }
.lm-mind-item.pinned { border-left:2px solid var(--lm-accent); }
.lm-mind-item.locked { background:linear-gradient(90deg,var(--lm-accent-muted),var(--lm-fill) 26%); }
.lm-mind-item-main { min-width:0; }
.lm-item-badges { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:4px; }
.lm-mini-badge { padding:1px 4px; border:1px solid var(--lm-line); border-radius:4px; color:var(--lm-dim); background:var(--lm-panel); font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; }
.lm-mini-badge.status-uncertain { color:var(--lm-warning); }
.lm-mini-badge.status-resolved { color:var(--lm-success); }
.lm-mini-badge.status-abandoned { color:var(--lm-danger); }
.lm-item-text { font-size:11px; line-height:1.45; overflow-wrap:anywhere; }
.lm-item-meta { display:flex; gap:7px; flex-wrap:wrap; margin-top:5px; color:var(--lm-dim); font-size:8px; }
.lm-item-actions { display:flex; flex-direction:column; gap:1px; }
.lm-item-actions .lm-icon-btn { width:24px; height:24px; padding:5px; }
.lm-provenance { margin-top:5px; color:var(--lm-dim); font-size:8px; }
.lm-provenance summary { cursor:pointer; }
.lm-provenance blockquote { margin:4px 0 0; padding:5px 7px; border-left:2px solid var(--lm-line-hover); color:var(--lm-muted); font-size:9px; }

.lm-scene-heading, .lm-history-heading, .lm-settings-heading { padding:5px 2px 2px; }
.lm-history-heading { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:start; }
.lm-history-heading > .lm-view-copy { grid-column:1/-1; }
.lm-scene-grid { display:grid; gap:8px; }
.lm-scene-card { appearance:none; width:100%; padding:11px; border:1px solid var(--lm-line); border-radius:var(--lm-radius-lg); background:var(--lm-panel); text-align:left; cursor:pointer; transition:all var(--lm-transition); }
.lm-scene-card:hover { border-color:var(--lm-line-hover); background:var(--lm-raised); transform:translateY(-1px); }
.lm-scene-card-top { display:grid; grid-template-columns:30px minmax(0,1fr) auto; gap:7px; align-items:center; }
.lm-scene-card-top strong { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:12px; }
.lm-presence-label { padding:2px 5px; border-radius:999px; color:var(--lm-dim); background:var(--lm-fill); font-size:8px; }
.lm-presence-label.present { color:var(--lm-success); background:color-mix(in srgb,var(--lm-success) 9%,transparent); }
.lm-scene-attention { margin:9px 1px !important; color:var(--lm-text); font-size:10px; }
.lm-scene-attention.muted { color:var(--lm-dim); }
.lm-scene-signals { display:flex; flex-direction:column; gap:4px; }
.lm-scene-signal { display:grid; grid-template-columns:64px minmax(0,1fr); gap:7px; padding-top:5px; border-top:1px solid var(--lm-line); }
.lm-scene-signal > span { color:var(--lm-dim); font-size:8px; font-weight:700; text-transform:uppercase; }
.lm-scene-signal p { color:var(--lm-muted); font-size:9px; }

.lm-change-feed { position:relative; display:flex; flex-direction:column; }
.lm-change-feed::before { content:""; position:absolute; left:5px; top:12px; bottom:12px; width:1px; background:var(--lm-line); }
.lm-change-row { position:relative; display:grid; grid-template-columns:11px minmax(0,1fr) auto; gap:9px; align-items:center; padding:8px 0; }
.lm-change-marker { position:relative; z-index:1; width:9px; height:9px; border:2px solid var(--lm-panel); border-radius:50%; background:var(--lm-dim); box-shadow:0 0 0 1px var(--lm-line); }
.lm-change-row.changed .lm-change-marker { background:var(--lm-accent); box-shadow:0 0 0 1px color-mix(in srgb,var(--lm-accent) 50%,var(--lm-line)); }
.lm-change-copy { display:flex; flex-direction:column; }
.lm-change-copy strong { font-size:10px; }
.lm-change-copy span, .lm-change-row time { color:var(--lm-dim); font-size:8px; }

.lm-settings-card { display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid var(--lm-line); border-radius:var(--lm-radius-lg); background:var(--lm-panel); }
.lm-settings-title { font-size:13px; }
.lm-settings-title-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.lm-settings-description { max-width:440px; margin-top:3px !important; color:var(--lm-muted); font-size:9px; }
.lm-settings-grid, .lm-seed-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.lm-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
.lm-label { color:var(--lm-muted); font-size:10px; font-weight:650; }
.lm-field-hint { color:var(--lm-dim); font-size:9px; }
.lm-input, .lm-select, .lm-textarea { appearance:none; width:100%; border:1px solid var(--lm-line); border-radius:8px; outline:none; background:var(--lm-fill); color:var(--lm-text); transition:border-color var(--lm-transition),background var(--lm-transition),box-shadow var(--lm-transition); }
.lm-input, .lm-select { min-height:34px; padding:7px 9px; }
.lm-textarea { padding:8px 9px; line-height:1.5; resize:vertical; }
.lm-input:hover, .lm-select:hover, .lm-textarea:hover { border-color:var(--lm-line-hover); }
.lm-input:focus, .lm-select:focus, .lm-textarea:focus { border-color:var(--lm-accent); background:var(--lm-panel); box-shadow:0 0 0 3px var(--lm-accent-muted); }
.lm-input[aria-invalid="true"], .lm-textarea[aria-invalid="true"] { border-color:var(--lm-danger); }
.lm-select option { background:var(--lm-panel); color:var(--lm-text); }
.lm-toggle-row { position:relative; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:center; padding:8px 0; border-top:1px solid var(--lm-line); cursor:pointer; }
.lm-toggle-row:first-of-type { border-top:0; }
.lm-toggle-copy { display:flex; flex-direction:column; gap:1px; }
.lm-toggle-copy strong { font-size:10px; }
.lm-toggle-copy small { color:var(--lm-muted); font-size:9px; }
.lm-toggle-row input { position:absolute; opacity:0; pointer-events:none; }
.lm-toggle { position:relative; width:32px; height:18px; border:1px solid var(--lm-line-hover); border-radius:999px; background:var(--lm-fill); transition:all var(--lm-transition); }
.lm-toggle::after { content:""; position:absolute; width:12px; height:12px; left:2px; top:2px; border-radius:50%; background:var(--lm-muted); transition:all var(--lm-transition); }
.lm-toggle-row input:checked + .lm-toggle { border-color:var(--lm-accent); background:var(--lm-accent); }
.lm-toggle-row input:checked + .lm-toggle::after { left:16px; background:var(--lm-accent-fg); }
.lm-toggle-row input:focus-visible + .lm-toggle { box-shadow:0 0 0 3px var(--lm-accent-muted); }
.lm-capability-grid { display:grid; gap:4px; }
.lm-capability { display:grid; grid-template-columns:7px minmax(0,1fr) auto; gap:7px; align-items:center; padding:5px 7px; border-radius:6px; background:var(--lm-fill); font-size:9px; }
.lm-capability strong { color:var(--lm-muted); font-size:8px; }
.lm-capability-dot { width:6px; height:6px; border-radius:50%; background:var(--lm-danger); }
.lm-capability.granted .lm-capability-dot { background:var(--lm-success); }
.lm-diagnostics-card { background:linear-gradient(135deg,color-mix(in srgb,var(--lm-accent) 5%,var(--lm-panel)),var(--lm-panel)); }
.lm-diagnostics-safe-note { padding:7px 8px; border:1px solid color-mix(in srgb,var(--lm-success) 22%,var(--lm-line)); border-radius:7px; color:var(--lm-muted); background:color-mix(in srgb,var(--lm-success) 6%,transparent); font-size:9px; }

.lm-diagnostics { display:flex; flex-direction:column; gap:12px; color:var(--lm-text); }
.lm-diagnostics-intro { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:start; padding:11px; border:1px solid var(--lm-line); border-radius:var(--lm-radius-lg); background:linear-gradient(135deg,var(--lm-accent-muted),var(--lm-fill)); }
.lm-diagnostics-intro p { margin-top:4px !important; color:var(--lm-muted); font-size:10px; }
.lm-diagnostics-privacy { padding:3px 7px; border:1px solid color-mix(in srgb,var(--lm-success) 28%,var(--lm-line)); border-radius:999px; color:var(--lm-success); background:color-mix(in srgb,var(--lm-success) 8%,transparent); font-size:8px; font-weight:750; white-space:nowrap; text-transform:uppercase; letter-spacing:.04em; }
.lm-diagnostics-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:7px; }
.lm-diagnostic-stat { display:flex; flex-direction:column; gap:2px; min-width:0; padding:8px 9px; border:1px solid var(--lm-line); border-radius:8px; background:var(--lm-fill); }
.lm-diagnostic-stat span { color:var(--lm-dim); font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
.lm-diagnostic-stat strong { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:11px; }
.lm-diagnostics-toolbar { display:flex; align-items:center; justify-content:flex-end; gap:7px; }
.lm-diagnostics-generated { margin-right:auto; color:var(--lm-dim); font-family:var(--lumiverse-font-mono,ui-monospace,monospace); font-size:8px; }
.lm-diagnostics-output { width:100%; max-height:470px; margin:0; padding:12px; overflow:auto; border:1px solid var(--lm-line); border-radius:var(--lm-radius); background:var(--lm-bg); color:var(--lm-muted); font:10px/1.55 var(--lumiverse-font-mono,ui-monospace,SFMono-Regular,Consolas,monospace); white-space:pre; tab-size:2; user-select:text; }
.lm-copy-failed { color:var(--lm-accent-fg) !important; background:var(--lm-danger) !important; border-color:var(--lm-danger) !important; }

.lm-modal-form { display:flex; flex-direction:column; gap:13px; padding:3px 1px 1px; color:var(--lm-text); }
.lm-core-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
.lm-core-form .lm-field:first-child, .lm-core-form .lm-modal-actions { grid-column:1/-1; }
.lm-modal-actions { display:flex; justify-content:flex-end; gap:7px; padding-top:4px; }

.lm-loading { display:flex; align-items:center; justify-content:center; gap:9px; min-height:150px; color:var(--lm-muted); font-size:11px; }
.lm-loader { width:16px; height:16px; border:2px solid var(--lm-line); border-top-color:var(--lm-accent); border-radius:50%; animation:lm-spin .8s linear infinite; }

.lm-seed-root { display:flex; flex-direction:column; gap:14px; padding:5px 2px 28px; max-width:980px; margin:0 auto; }
.lm-seed-header { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:15px; align-items:start; padding:4px 2px 2px; }
.lm-seed-state { padding:4px 8px; border:1px solid var(--lm-line); border-radius:999px; color:var(--lm-muted); background:var(--lm-fill); font-size:9px; font-weight:700; white-space:nowrap; }
.lm-seed-state.saved { color:var(--lm-success); border-color:color-mix(in srgb,var(--lm-success) 30%,var(--lm-line)); }
.lm-seed-state.dirty { color:var(--lm-warning); border-color:color-mix(in srgb,var(--lm-warning) 30%,var(--lm-line)); }
.lm-seed-state.transient { color:var(--lm-accent); border-color:color-mix(in srgb,var(--lm-accent) 30%,var(--lm-line)); }
.lm-seed-toolbar { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:7px; flex-wrap:wrap; padding:9px; border:1px solid var(--lm-line); border-radius:var(--lm-radius-lg); background:var(--lcs-glass-bg,var(--lm-panel)); backdrop-filter:blur(var(--lcs-glass-blur,12px)); box-shadow:var(--lumiverse-shadow-sm,0 4px 16px rgba(0,0,0,.16)); }
.lm-seed-toolbar .lm-button-primary { margin-left:auto; }
.lm-seed-hint { padding:9px 11px; border:1px solid color-mix(in srgb,var(--lm-accent) 25%,var(--lm-line)); border-radius:var(--lm-radius); color:var(--lm-muted); background:var(--lm-accent-muted); font-size:10px; }
.lm-seed-hint.warning { color:var(--lm-warning); border-color:color-mix(in srgb,var(--lm-warning) 30%,var(--lm-line)); background:color-mix(in srgb,var(--lm-warning) 8%,transparent); }
.lm-seed-form { display:flex; flex-direction:column; gap:13px; }
.lm-seed-section { display:flex; flex-direction:column; gap:12px; padding:15px; border:1px solid var(--lm-line); border-radius:var(--lm-radius-lg); background:var(--lm-panel); }
.lm-seed-section-title { padding-bottom:9px; border-bottom:1px solid var(--lm-line); font-size:14px; }

@media (max-width: 520px) {
  .lm-drawer { padding-left:10px; padding-right:10px; }
  .lm-status { display:none; }
  .lm-brand-header { grid-template-columns:36px minmax(0,1fr) auto; }
  .lm-core-form, .lm-settings-grid, .lm-seed-grid { grid-template-columns:1fr; }
  .lm-core-form .lm-field:first-child, .lm-core-form .lm-modal-actions { grid-column:auto; }
  .lm-history-heading { grid-template-columns:1fr; }
  .lm-history-heading > .lm-view-copy { grid-column:auto; }
  .lm-mind-section-name { flex-direction:column; gap:0; }
  .lm-timeline-status { grid-template-columns:auto minmax(0,1fr); }
  .lm-timeline-status > .lm-inline-actions { grid-column:2; }
  .lm-seed-header { grid-template-columns:1fr; }
  .lm-seed-toolbar .lm-button-primary { margin-left:0; }
  .lm-diagnostics-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .lm-diagnostics-intro { grid-template-columns:1fr; }
  .lm-diagnostics-toolbar { align-items:stretch; flex-wrap:wrap; }
  .lm-diagnostics-generated { width:100%; margin-right:0; }
}

@media (prefers-reduced-motion: reduce) {
  .lm-root *, .lm-root *::before, .lm-root *::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; }
}
`;

// src/frontend.ts
var MIND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.2 4.2a6.7 6.7 0 0 1 8.4 6.5c0 1.8-.7 3.2-1.8 4.3-.8.8-1.2 1.6-1.2 2.7v.6H8.8v-.9c0-1.2-.5-2-1.4-2.9a5.8 5.8 0 0 1-1.8-4.2c0-1.3.4-2.6 1.1-3.6"/><path d="M9.4 21h4.5"/><path d="M8.4 7.8c1.7-1.6 4.8-1.4 6.2.5"/><path d="M9 11.1c1.2-1.1 3.3-1 4.3.3"/><circle cx="6.5" cy="4.3" r="1.5" fill="currentColor" stroke="none"/></svg>`;
var ICONS = {
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
  play: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.8v10.4c0 .8.9 1.2 1.5.8l7.1-5.2a1 1 0 0 0 0-1.6L5.5 2c-.6-.4-1.5 0-1.5.8z"/></svg>`
};
var CATEGORY_LABELS = {
  belief: "Beliefs",
  secret: "Secrets",
  goal: "Goals",
  plan: "Plans",
  emotion: "Emotions",
  relationship: "Relationships",
  awareness: "Awareness"
};
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== void 0) node.textContent = text;
  return node;
}
function svgIcon(name) {
  const node = element("span", "lm-icon");
  node.innerHTML = ICONS[name] ?? "";
  return node;
}
function iconButton(name, label, onClick, className = "") {
  const button = element("button", `lm-icon-btn ${className}`.trim());
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(svgIcon(name));
  button.addEventListener("click", onClick);
  return button;
}
function textButton(label, onClick, variant = "secondary") {
  const button = element("button", `lm-button lm-button-${variant}`, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}
function field(label, control, hint) {
  const wrapper = element("div", "lm-field");
  wrapper.append(element("label", "lm-label", label), control);
  if (hint) wrapper.appendChild(element("div", "lm-field-hint", hint));
  return wrapper;
}
function input(value, placeholder = "") {
  const control = element("input", "lm-input");
  control.value = value;
  control.placeholder = placeholder;
  return control;
}
function textarea(value, rows = 4, placeholder = "") {
  const control = element("textarea", "lm-textarea");
  control.value = value;
  control.rows = rows;
  control.placeholder = placeholder;
  return control;
}
function categoryLabel(category) {
  return CATEGORY_LABELS[category];
}
function actorKindLabel(actor) {
  return actor.kind === "npc" ? "Timeline NPC" : actor.kind === "persona" ? "Persona" : "Character card";
}
function safeActiveChat(ctx) {
  try {
    return ctx.getActiveChat();
  } catch {
    return { chatId: null, characterId: null };
  }
}
function setup(ctx) {
  ctx.deferReady();
  const cleanups = [];
  cleanups.push(ctx.dom.addStyle(LUMI_MIND_CSS));
  const drawer = ctx.ui.registerDrawerTab({
    id: "mind-lens",
    title: "LumiMind \u2014 Mind Lens",
    shortName: "Mind",
    headerTitle: "Mind Lens",
    description: "Inspect timeline-aware subjective minds, scene awareness, and provenance",
    keywords: ["mind", "beliefs", "secrets", "goals", "cast", "timeline"],
    iconSvg: MIND_ICON
  });
  cleanups.push(() => drawer.destroy());
  const root = element("div", "lm-root lm-drawer");
  drawer.root.appendChild(root);
  cleanups.push(() => root.remove());
  let currentState = null;
  let activeView = "cast";
  let selectedActorId = null;
  let settingsDraft = null;
  let settingsDirty = false;
  let notice = null;
  let noticeTimer = null;
  let diagnosticsModal = null;
  let diagnosticsRefresh = null;
  let seedTab = null;
  let seedRoot = null;
  let seedEditorUnsub = null;
  let seedActivateUnsub = null;
  let seedCharacterId = null;
  let seedDraft = null;
  let seedPersisted = false;
  let seedDirty = false;
  let seedLoading = false;
  let seedGenerating = false;
  let seedNotice = null;
  let seedLoadVersion = 0;
  function send(message) {
    try {
      ctx.sendToBackend(message);
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : "LumiMind could not reach its backend.");
    }
  }
  function showNotice(tone, message, ttl = 7e3) {
    if (noticeTimer) clearTimeout(noticeTimer);
    notice = { tone, message };
    render();
    noticeTimer = setTimeout(() => {
      notice = null;
      render();
    }, ttl);
  }
  function syncContext() {
    const active2 = safeActiveChat(ctx);
    send({ type: "refresh", chatId: active2.chatId, characterId: active2.characterId });
  }
  async function copyText(value) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
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
  function buildDiagnosticReport() {
    const state = currentState;
    const timeline = state?.timeline ?? null;
    const actors = timeline?.actors ?? [];
    const minds = timeline ? Object.values(timeline.minds) : [];
    const items = minds.flatMap((mind) => mind.items);
    const countBy = (values) => values.reduce((counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    }, {});
    let editorState = null;
    try {
      if (state?.permissions.characters) editorState = ctx.ui.characterEditor.getState();
    } catch {
      editorState = null;
    }
    const active2 = safeActiveChat(ctx);
    return {
      reportFormat: "lumi_mind.diagnostics.v1",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      privacy: {
        sanitized: true,
        excluded: ["mind entry text", "beliefs", "secrets", "evidence excerpts", "actor names", "aliases", "API credentials", "full entity IDs"]
      },
      extension: {
        identifier: ctx.manifest.identifier,
        name: ctx.manifest.name,
        version: ctx.manifest.version,
        minimumLumiverseVersion: ctx.manifest.minimum_lumiverse_version ?? null
      },
      browser: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        online: navigator.onLine,
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }
      },
      frontend: {
        activeView,
        drawer: ctx.ui.events.getDrawerState(),
        activeChat: {
          available: !!active2.chatId,
          reference: active2.chatId ? compactChatId(active2.chatId) : null,
          characterAvailable: !!active2.characterId,
          matchesBackendState: active2.chatId === (state?.activeChatId ?? null)
        },
        seedEditor: {
          available: !!seedTab,
          open: editorState?.open ?? false,
          characterAvailable: !!editorState?.characterId,
          draftLoaded: !!seedDraft,
          persisted: seedPersisted,
          dirty: seedDirty,
          loading: seedLoading,
          generating: seedGenerating
        }
      },
      permissions: state?.permissions ?? null,
      controller: state ? {
        dedicatedConnectionSelected: !!state.settings.controllerConnectionId,
        connectionCount: state.connections.length,
        connections: state.connections.map((connection) => ({
          provider: connection.provider,
          model: connection.model,
          default: connection.isDefault,
          credentialConfigured: connection.hasApiKey
        })),
        temperature: state.settings.controllerTemperature,
        maxOutputTokens: state.settings.controllerMaxTokens
      } : null,
      injection: state ? {
        tokenBudget: state.settings.injectionTokenBudget,
        secondaryActorLimit: state.settings.secondaryActorLimit,
        interceptorAvailable: state.permissions.interceptor
      } : null,
      features: state ? {
        spoilerSafe: state.settings.spoilerSafe,
        cortexImport: state.settings.cortexImportEnabled,
        cortexWriteback: state.settings.cortexWritebackEnabled,
        privateInterop: state.settings.privateInteropEnabled
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
          cortexLinked: actors.filter((actor) => !!actor.cortexEntityId).length
        },
        minds: {
          total: minds.length,
          entries: items.length,
          byCategory: countBy(items.map((item) => item.category)),
          byStatus: countBy(items.map((item) => item.status)),
          bySource: countBy(items.map((item) => item.source)),
          locked: items.filter((item) => item.locked).length,
          pinned: items.filter((item) => item.pinned).length
        },
        analysisRecords: {
          total: timeline.records.length,
          recent: timeline.records.slice(-10).reverse().map((record) => ({
            messageIndex: record.messageIndex,
            swipe: record.swipeId,
            changes: record.changeCount,
            createdAt: new Date(record.createdAt).toISOString()
          }))
        }
      } : { available: false }
    };
  }
  function openDiagnostics() {
    if (diagnosticsModal) {
      diagnosticsRefresh?.();
      return;
    }
    const modal = ctx.ui.showModal({ title: "LumiMind Diagnostics", width: 760, maxHeight: 820 });
    diagnosticsModal = modal;
    const shell = element("div", "lm-root lm-diagnostics");
    const intro = element("div", "lm-diagnostics-intro");
    const introCopy = element("div");
    introCopy.append(element("div", "lm-kicker", "Sanitized support report"), element("p", void 0, "Copy this report into a bug report or support conversation. Private mind content and credentials are excluded."));
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
    const refresh = textButton("Refresh snapshot", () => {
      refresh.disabled = true;
      refresh.textContent = "Refreshing\u2026";
      syncContext();
      setTimeout(() => {
        diagnosticsRefresh?.();
        refresh.disabled = false;
        refresh.textContent = "Refresh snapshot";
      }, 350);
    });
    toolbar.append(generated, refresh, copy);
    shell.append(intro, summary, toolbar, output);
    modal.root.appendChild(shell);
    diagnosticsRefresh = () => {
      const report = buildDiagnosticReport();
      const timeline = currentState?.timeline;
      summary.replaceChildren();
      const stats = [
        ["Timeline", timeline ? healthLabel(timeline.health) : "No active timeline"],
        ["Revision", timeline ? String(timeline.revision) : "\u2014"],
        ["Actors", timeline ? String(timeline.actors.length) : "0"],
        ["Records", timeline ? String(timeline.records.length) : "0"]
      ];
      for (const [label, value] of stats) {
        const stat = element("div", "lm-diagnostic-stat");
        stat.append(element("span", void 0, label), element("strong", void 0, value));
        summary.appendChild(stat);
      }
      output.textContent = JSON.stringify(report, null, 2);
      generated.textContent = `Updated ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
    };
    diagnosticsRefresh();
    modal.onDismiss(() => {
      diagnosticsModal = null;
      diagnosticsRefresh = null;
    });
  }
  function ensureSelection() {
    const actors = currentState?.timeline?.actors ?? [];
    if (!actors.length) {
      selectedActorId = null;
      return;
    }
    if (!findActor(actors, selectedActorId)) {
      selectedActorId = actors.find((actor) => actor.present)?.id ?? actors[0].id;
    }
  }
  function updateBadge() {
    const timeline = currentState?.timeline;
    if (!timeline || !timeline.active || timeline.health === "ready") {
      drawer.setBadge(null);
      return;
    }
    drawer.setBadge(timeline.health === "error" ? "!" : timeline.health === "paused" ? "\u2161" : "\u2022\u2022\u2022");
  }
  function renderHeader() {
    const header = element("header", "lm-brand-header");
    const mark = element("div", "lm-brand-mark");
    mark.innerHTML = MIND_ICON;
    const identity = element("div", "lm-brand-copy");
    identity.append(element("div", "lm-eyebrow", "LumiMind"), element("div", "lm-brand-title", "Private continuity, in character"));
    const health = currentState?.timeline?.health ?? "inactive";
    const actions = element("div", "lm-header-actions");
    actions.append(
      element("span", `lm-status lm-status-${healthTone(health)}`, healthLabel(health)),
      iconButton("refresh", "Refresh Mind Lens", syncContext)
    );
    header.append(mark, identity, actions);
    return header;
  }
  function renderNotice() {
    if (!notice) return null;
    const banner = element("div", `lm-notice lm-notice-${notice.tone}`);
    banner.append(element("span", "lm-notice-dot"), element("span", "lm-notice-copy", notice.message));
    return banner;
  }
  function renderNav() {
    const nav = element("nav", "lm-nav");
    const entries = [
      ["cast", "Cast"],
      ["scene", "Scene"],
      ["history", "Changes"],
      ["settings", "Settings"]
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
  function renderPermissionState(missing) {
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
  function renderNoChat() {
    const card = element("section", "lm-empty-card");
    const orbit = element("div", "lm-orbit");
    orbit.append(element("span"), element("span"), element("span"));
    card.append(orbit, element("h2", "lm-empty-title", "Open a conversation"));
    card.appendChild(element("p", "lm-empty-copy", "Mind Lens follows the active timeline. Choose a chat to inspect its cast and explicitly activate analysis."));
    return card;
  }
  function renderActivation() {
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
      element("span", "lm-activation-point", "Spoilers collapsed")
    );
    copy.append(points);
    const button = textButton("Activate Mind Lens", () => {
      if (timeline) send({ type: "activate", chatId: timeline.chatId });
    }, "primary");
    button.classList.add("lm-activation-button");
    copy.appendChild(button);
    card.append(visual, copy);
    return card;
  }
  function renderTimelineStatus() {
    const timeline = currentState?.timeline;
    if (!timeline || timeline.health === "ready" || timeline.health === "inactive") return null;
    const panel = element("section", `lm-timeline-status lm-timeline-${healthTone(timeline.health)}`);
    const pulse = element("span", "lm-pulse");
    const copy = element("div", "lm-timeline-status-copy");
    copy.appendChild(element("strong", void 0, healthLabel(timeline.health)));
    const detail = timeline.error ?? (timeline.health === "paused" ? "Automatic analysis is paused. The last valid checkpoint remains available for injection." : `Processed through message ${Math.max(0, timeline.lastValidMessageIndex + 1)}. Normal generation remains available.`);
    copy.appendChild(element("span", void 0, detail));
    const actions = element("div", "lm-inline-actions");
    if (timeline.health === "error") {
      actions.appendChild(textButton("Retry", () => send({ type: "retry", chatId: timeline.chatId }), "quiet"));
    }
    actions.appendChild(textButton(timeline.paused ? "Resume" : "Pause", () => send({ type: "pause", chatId: timeline.chatId, paused: !timeline.paused }), "quiet"));
    panel.append(pulse, copy, actions);
    return panel;
  }
  function renderActorRail(actors, minds) {
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
      copy.append(element("strong", void 0, actor.canonicalName), element("small", void 0, `${actorItemCount(minds[actor.id])} signals`));
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
  async function promptText(options) {
    return new Promise((resolve) => {
      const modal = ctx.ui.showModal({ title: options.title, width: 480, maxHeight: 620 });
      const form = element("form", "lm-modal-form");
      const control = options.multiline ? textarea(options.value ?? "", 7, options.placeholder) : input(options.value ?? "", options.placeholder);
      form.appendChild(field(options.label, control));
      const actions = element("div", "lm-modal-actions");
      const cancel = textButton("Cancel", () => modal.dismiss(), "secondary");
      const confirm = element("button", "lm-button lm-button-primary", options.confirmLabel ?? "Save");
      confirm.type = "submit";
      actions.append(cancel, confirm);
      form.appendChild(actions);
      modal.root.appendChild(form);
      let settled = false;
      const finish = (value) => {
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
  async function editCore(actor, mind) {
    const modal = ctx.ui.showModal({ title: `${actor.canonicalName} \u2014 Core`, width: 620, maxHeight: 760 });
    const form = element("form", "lm-modal-form lm-core-form");
    const selfConcept = textarea(mind.core.selfConcept, 5, "How this person understands themself\u2026");
    const values = textarea(mind.core.values.join("\n"), 4, "One value per line");
    const desires = textarea(mind.core.desires.join("\n"), 4, "One desire per line");
    const fears = textarea(mind.core.fears.join("\n"), 4, "One fear per line");
    const boundaries = textarea(mind.core.boundaries.join("\n"), 4, "One boundary per line");
    const notes = textarea(mind.core.notes.join("\n"), 4, "One enduring note per line");
    form.append(
      field("Self-concept", selfConcept),
      field("Values", values),
      field("Desires", desires),
      field("Fears", fears),
      field("Boundaries", boundaries),
      field("Notes", notes)
    );
    const actions = element("div", "lm-modal-actions");
    actions.append(textButton("Cancel", () => modal.dismiss()), element("button", "lm-button lm-button-primary", "Save core"));
    actions.lastElementChild.type = "submit";
    form.appendChild(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const core = {
        selfConcept: selfConcept.value.trim(),
        values: uniqueLines(values.value),
        desires: uniqueLines(desires.value),
        fears: uniqueLines(fears.value),
        boundaries: uniqueLines(boundaries.value),
        notes: uniqueLines(notes.value)
      };
      const timeline = currentState?.timeline;
      if (timeline) send({ type: "edit_core", chatId: timeline.chatId, actorId: actor.id, core });
      modal.dismiss();
    });
    modal.root.appendChild(form);
  }
  async function editMindItem(actor, item) {
    const modal = ctx.ui.showModal({ title: `Edit ${categoryLabel(item.category).slice(0, -1)}`, width: 520, maxHeight: 620 });
    const form = element("form", "lm-modal-form");
    const content = textarea(item.text, 6, "Subjective state\u2026");
    const status = element("select", "lm-select");
    for (const value of ["active", "uncertain", "resolved", "abandoned"]) {
      const option = element("option", void 0, value[0].toLocaleUpperCase() + value.slice(1));
      option.value = value;
      option.selected = value === item.status;
      status.appendChild(option);
    }
    form.append(field("State", content), field("Status", status, "Editing an inferred entry makes it user-authored and locks it."));
    const actions = element("div", "lm-modal-actions");
    actions.append(textButton("Cancel", () => modal.dismiss()), element("button", "lm-button lm-button-primary", "Save entry"));
    actions.lastElementChild.type = "submit";
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
          status: status.value
        });
      }
      modal.dismiss();
    });
    modal.root.appendChild(form);
  }
  async function addMindItem(actor, initialCategory) {
    const modal = ctx.ui.showModal({ title: `Add state for ${actor.canonicalName}`, width: 520, maxHeight: 620 });
    const form = element("form", "lm-modal-form");
    const category = element("select", "lm-select");
    for (const value of MIND_CATEGORIES) {
      const option = element("option", void 0, categoryLabel(value));
      option.value = value;
      option.selected = value === (initialCategory ?? "belief");
      category.appendChild(option);
    }
    const content = textarea("", 6, "Write a concise, subjective mental-state entry\u2026");
    form.append(field("Section", category), field("State", content, "Manual entries are locked and pinned by default."));
    const actions = element("div", "lm-modal-actions");
    actions.append(textButton("Cancel", () => modal.dismiss()), element("button", "lm-button lm-button-primary", "Add entry"));
    actions.lastElementChild.type = "submit";
    form.appendChild(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = content.value.trim();
      const timeline = currentState?.timeline;
      if (!text || !timeline) return;
      send({ type: "add_item", chatId: timeline.chatId, actorId: actor.id, category: category.value, text });
      modal.dismiss();
    });
    modal.root.appendChild(form);
    setTimeout(() => content.focus(), 0);
  }
  function renderCore(actor, mind) {
    const card = element("section", "lm-core-card");
    const heading = element("div", "lm-card-heading");
    const title = element("div");
    title.append(element("div", "lm-kicker", "Enduring frame"), element("h3", "lm-card-title", "Core self"));
    heading.append(title, iconButton("edit", "Edit core self", () => void editCore(actor, mind)));
    card.appendChild(heading);
    if (mind.core.selfConcept) card.appendChild(element("p", "lm-self-concept", mind.core.selfConcept));
    else card.appendChild(element("p", "lm-empty-inline", "No reviewed self-concept yet."));
    const groups = [
      ["Values", mind.core.values],
      ["Desires", mind.core.desires],
      ["Fears", mind.core.fears],
      ["Boundaries", mind.core.boundaries]
    ];
    const grid = element("div", "lm-core-grid");
    for (const [label, values] of groups) {
      if (!values.length) continue;
      const group = element("div", "lm-core-group");
      group.appendChild(element("span", "lm-core-label", label));
      const chips = element("div", "lm-chip-row");
      for (const value of values) chips.appendChild(element("span", "lm-chip", value));
      group.appendChild(chips);
      grid.appendChild(group);
    }
    if (grid.childElementCount) card.appendChild(grid);
    return card;
  }
  function renderItem(actor, item) {
    const row = element("article", `lm-mind-item${item.pinned ? " pinned" : ""}${item.locked ? " locked" : ""}`);
    const main = element("div", "lm-mind-item-main");
    const badges = element("div", "lm-item-badges");
    if (item.status !== "active") badges.appendChild(element("span", `lm-mini-badge status-${item.status}`, item.status));
    if (item.source === "manual" || item.source === "seed") badges.appendChild(element("span", "lm-mini-badge", item.source === "seed" ? "seed" : "manual"));
    if (item.intensity !== null) badges.appendChild(element("span", "lm-mini-badge", `${Math.round(item.intensity * 100)}% intensity`));
    if (badges.childElementCount) main.appendChild(badges);
    main.appendChild(element("p", "lm-item-text", item.text));
    const meta = element("div", "lm-item-meta");
    meta.appendChild(element("span", void 0, `${Math.round(item.confidence * 100)}% confidence`));
    if (item.evidence.messageIndex >= 0) meta.appendChild(element("span", void 0, `Message ${item.evidence.messageIndex + 1} \xB7 swipe ${item.evidence.swipeId + 1}`));
    else meta.appendChild(element("span", void 0, item.evidence.excerpt));
    main.appendChild(meta);
    if (item.evidence.excerpt && item.evidence.messageIndex >= 0) {
      const provenance = element("details", "lm-provenance");
      provenance.append(element("summary", void 0, "Evidence"), element("blockquote", void 0, item.evidence.excerpt));
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
            confirmLabel: "Remove"
          });
          if (result.confirmed && timeline) send({ type: "remove_item", chatId: timeline.chatId, actorId: actor.id, itemId: item.id });
        })();
      }, "danger")
    );
    row.append(main, actions);
    return row;
  }
  function renderMindSection(actor, mind, category) {
    const items = mind.items.filter((item) => item.category === category);
    const spoiler = currentState?.settings.spoilerSafe && (category === "belief" || category === "secret");
    const section = element("details", `lm-mind-section${spoiler ? " spoiler" : ""}`);
    section.open = !spoiler;
    const summary = element("summary", "lm-mind-section-summary");
    const title = element("span", "lm-mind-section-name");
    title.append(element("strong", void 0, categoryLabel(category)), element("small", void 0, spoiler ? `${items.length} hidden until revealed` : `${items.length} entries`));
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
  async function mergeActor(actor, actors) {
    const candidates = actors.filter((candidate) => candidate.id !== actor.id);
    if (!candidates.length) return;
    const modal = ctx.ui.showModal({ title: `Merge ${actor.canonicalName}`, width: 480, maxHeight: 520 });
    const form = element("form", "lm-modal-form");
    const select = element("select", "lm-select");
    for (const candidate of candidates) {
      const option = element("option", void 0, `${candidate.canonicalName} \xB7 ${actorKindLabel(candidate)}`);
      option.value = candidate.id;
      select.appendChild(option);
    }
    form.appendChild(field("Keep this identity", select, `${actor.canonicalName} will be folded into the selected actor. Aliases and compatible state are preserved.`));
    const actions = element("div", "lm-modal-actions");
    actions.append(textButton("Cancel", () => modal.dismiss()), element("button", "lm-button lm-button-primary", "Merge actors"));
    actions.lastElementChild.type = "submit";
    form.appendChild(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const timeline = currentState?.timeline;
      if (timeline) send({ type: "merge_actor", chatId: timeline.chatId, sourceActorId: actor.id, targetActorId: select.value });
      selectedActorId = select.value;
      modal.dismiss();
    });
    modal.root.appendChild(form);
  }
  async function showActorMenu(event, actor, actors) {
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
        { key: "remove", label: "Remove from this timeline", danger: true }
      ]
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
        confirmLabel: "Remove actor"
      });
      if (result.confirmed) {
        send({ type: "remove_actor", chatId: timeline.chatId, actorId: actor.id });
        selectedActorId = null;
      }
    }
  }
  function renderActorDetail(actor, mind) {
    const detail = element("div", "lm-actor-detail");
    const hero = element("section", "lm-actor-hero");
    const avatar = element("div", "lm-hero-avatar", actorInitials(actor.canonicalName));
    if (actor.present) avatar.appendChild(element("i", "lm-presence-dot"));
    const identity = element("div", "lm-hero-identity");
    const titleRow = element("div", "lm-hero-title-row");
    titleRow.append(element("h2", "lm-hero-title", actor.canonicalName));
    if (actor.confirmed) titleRow.appendChild(element("span", "lm-verified", "Confirmed"));
    identity.append(titleRow, element("div", "lm-hero-subtitle", `${actorKindLabel(actor)} \xB7 ${Math.round(actor.confidence * 100)}% identity confidence`));
    if (actor.aliases.length) {
      const aliases = element("div", "lm-alias-row");
      for (const alias of actor.aliases) {
        const chip = element("span", "lm-alias-chip");
        chip.appendChild(element("span", void 0, alias));
        const remove = element("button", void 0, "\xD7");
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
  function renderCast() {
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
  function renderScene() {
    const timeline = currentState?.timeline;
    const container = element("div", "lm-view lm-scene-view");
    if (!timeline) return container;
    const present = timeline.actors.filter((actor) => actor.present);
    const heading = element("section", "lm-scene-heading");
    heading.append(element("div", "lm-kicker", "Current checkpoint"), element("h2", "lm-view-title", present.length ? `${present.length} ${present.length === 1 ? "mind" : "minds"} in the room` : "No one is marked present"));
    heading.appendChild(element("p", "lm-view-copy", `Revision ${timeline.revision} \xB7 ${timeline.records.length} committed analysis records \xB7 updated ${formatRelativeTime(timeline.updatedAt)}`));
    container.appendChild(heading);
    const actors = present.length ? present : timeline.actors;
    const grid = element("div", "lm-scene-grid");
    for (const actor of actors) {
      const mind = timeline.minds[actor.id];
      const card = element("button", "lm-scene-card");
      card.type = "button";
      const top = element("div", "lm-scene-card-top");
      top.append(element("span", "lm-actor-avatar", actorInitials(actor.canonicalName)), element("strong", void 0, actor.canonicalName));
      top.appendChild(element("span", `lm-presence-label${actor.present ? " present" : ""}`, actor.present ? "Present" : "Off-scene"));
      card.appendChild(top);
      if (mind?.attention) card.appendChild(element("p", "lm-scene-attention", mind.attention));
      else if (mind?.sceneSummary) card.appendChild(element("p", "lm-scene-attention", mind.sceneSummary));
      else card.appendChild(element("p", "lm-scene-attention muted", "No explicit attention signal in this checkpoint."));
      const signals = (mind?.items ?? []).filter((item) => item.status === "active" && item.category !== "secret" && item.category !== "belief").sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt).slice(0, 3);
      const list = element("div", "lm-scene-signals");
      for (const signal of signals) {
        const row = element("div", "lm-scene-signal");
        row.append(element("span", void 0, signal.category), element("p", void 0, signal.text));
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
  function renderHistory() {
    const timeline = currentState?.timeline;
    const container = element("div", "lm-view lm-history-view");
    if (!timeline) return container;
    const heading = element("section", "lm-history-heading");
    const title = element("div");
    title.append(element("div", "lm-kicker", "Deterministic fold"), element("h2", "lm-view-title", "Change timeline"));
    const actions = element("div", "lm-inline-actions");
    actions.append(
      textButton(timeline.paused ? "Resume" : "Pause", () => send({ type: "pause", chatId: timeline.chatId, paused: !timeline.paused }), "quiet"),
      textButton("Rebuild", () => {
        void (async () => {
          const result = await ctx.ui.showConfirm({
            title: "Rebuild LumiMind timeline?",
            message: "Controller-derived records will be recomputed from committed history. Manual locked edits remain applied.",
            variant: "warning",
            confirmLabel: "Rebuild"
          });
          if (result.confirmed) send({ type: "rebuild", chatId: timeline.chatId });
        })();
      }, "secondary")
    );
    heading.append(title, actions);
    heading.appendChild(element("p", "lm-view-copy", `Checkpoint through message ${Math.max(0, timeline.lastValidMessageIndex + 1)} \xB7 last analyzed ${formatRelativeTime(timeline.lastAnalyzedAt)}`));
    container.appendChild(heading);
    const feed = element("div", "lm-change-feed");
    const records = timeline.records.slice().reverse();
    for (const record of records.slice(0, 200)) {
      const row = element("article", `lm-change-row${record.changeCount ? " changed" : ""}`);
      const marker = element("span", "lm-change-marker");
      const copy = element("div", "lm-change-copy");
      copy.append(element("strong", void 0, `Message ${record.messageIndex + 1}`), element("span", void 0, `Swipe ${record.swipeId + 1} \xB7 ${record.changeCount} ${record.changeCount === 1 ? "change" : "changes"}`));
      const time = element("time", void 0, formatRelativeTime(record.createdAt));
      row.append(marker, copy, time);
      feed.appendChild(row);
    }
    if (!records.length) feed.appendChild(element("div", "lm-empty-inline lm-large-empty", "No controller deltas have been committed to this branch yet."));
    container.appendChild(feed);
    return container;
  }
  function markSettingsDirty(saveButton) {
    settingsDirty = true;
    saveButton.disabled = false;
    saveButton.textContent = "Save settings";
  }
  function renderToggle(label, description, checked, onChange) {
    const row = element("label", "lm-toggle-row");
    const copy = element("span", "lm-toggle-copy");
    copy.append(element("strong", void 0, label), element("small", void 0, description));
    const control = element("input");
    control.type = "checkbox";
    control.checked = checked;
    const visual = element("span", "lm-toggle");
    control.addEventListener("change", () => onChange(control.checked));
    row.append(copy, control, visual);
    return row;
  }
  function renderSettings() {
    const container = element("div", "lm-view lm-settings-view");
    if (!currentState || !settingsDraft) return container;
    const heading = element("section", "lm-settings-heading");
    heading.append(element("div", "lm-kicker", "Controller & privacy"), element("h2", "lm-view-title", "Mind Lens settings"));
    heading.appendChild(element("p", "lm-view-copy", "Settings are user-scoped. Changes affect newly scheduled analysis and future prompt injections."));
    container.appendChild(heading);
    const save = textButton(settingsDirty ? "Save settings" : "Saved", () => {
      if (!settingsDraft) return;
      send({ type: "save_settings", patch: { ...settingsDraft }, chatId: currentState?.activeChatId });
      settingsDirty = false;
      save.disabled = true;
      save.textContent = "Saved";
    }, "primary");
    save.disabled = !settingsDirty;
    const controller = element("section", "lm-settings-card");
    controller.appendChild(element("h3", "lm-settings-title", "Analysis controller"));
    const connection = element("select", "lm-select");
    const fallback = element("option", void 0, "Use active Lumiverse connection");
    fallback.value = "";
    fallback.selected = !settingsDraft.controllerConnectionId;
    connection.appendChild(fallback);
    for (const option of currentState.connections) {
      const item = element("option", void 0, `${option.name} \xB7 ${option.model || option.provider}`);
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
    const numberSetting = (label, key, min, max, step) => {
      const control = element("input", "lm-input");
      control.type = "number";
      control.min = String(min);
      control.max = String(max);
      control.step = String(step);
      control.value = String(settingsDraft?.[key] ?? 0);
      control.addEventListener("change", () => {
        if (!settingsDraft) return;
        const value = Math.min(max, Math.max(min, Number(control.value)));
        settingsDraft[key] = value;
        control.value = String(value);
        markSettingsDirty(save);
      });
      return field(label, control);
    };
    numberGrid.append(
      numberSetting("Temperature", "controllerTemperature", 0, 2, 0.05),
      numberSetting("Analysis output tokens", "controllerMaxTokens", 300, 8e3, 100),
      numberSetting("Injection token budget", "injectionTokenBudget", 400, 4e3, 100),
      numberSetting("Secondary actors", "secondaryActorLimit", 0, 8, 1)
    );
    controller.appendChild(numberGrid);
    container.appendChild(controller);
    const privacy = element("section", "lm-settings-card");
    privacy.appendChild(element("h3", "lm-settings-title", "Privacy & interoperability"));
    const toggles = [
      ["Spoiler-safe lens", "Collapse beliefs and secrets until deliberately revealed.", "spoilerSafe"],
      ["Import Cortex identities", "Use character entities and aliases only for name resolution.", "cortexImportEnabled"],
      ["Cortex identity writeback", "Allow confirmed names and aliases to be published. Private mind state is never written.", "cortexWritebackEnabled"],
      ["Private extension interop", "Register the chat_mutation-gated private scene snapshot.", "privateInteropEnabled"]
    ];
    for (const [label, description, key] of toggles) {
      privacy.appendChild(renderToggle(label, description, Boolean(settingsDraft[key]), (checked) => {
        if (!settingsDraft) return;
        settingsDraft[key] = checked;
        markSettingsDirty(save);
      }));
    }
    container.appendChild(privacy);
    const permissions = element("section", "lm-settings-card");
    const permissionHeading = element("div", "lm-settings-title-row");
    permissionHeading.appendChild(element("h3", "lm-settings-title", "Live capabilities"));
    permissionHeading.appendChild(textButton("Manage permissions", () => ctx.events.emit("open-settings", { view: "extensions" }), "quiet"));
    permissions.appendChild(permissionHeading);
    const list = element("div", "lm-capability-grid");
    const entries = [
      ["Generation", currentState.permissions.generation],
      ["Interceptor", currentState.permissions.interceptor],
      ["Chat history", currentState.permissions.chatMutation],
      ["Characters", currentState.permissions.characters],
      ["Personas", currentState.permissions.personas],
      ["Memory Cortex", currentState.permissions.memories]
    ];
    for (const [label, granted] of entries) {
      const row = element("div", `lm-capability${granted ? " granted" : " denied"}`);
      row.append(element("span", "lm-capability-dot"), element("span", void 0, label), element("strong", void 0, granted ? "Granted" : "Unavailable"));
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
  function render() {
    root.replaceChildren();
    root.appendChild(renderHeader());
    const banner = renderNotice();
    if (banner) root.appendChild(banner);
    if (!currentState) {
      const loading = element("div", "lm-loading");
      loading.append(element("span", "lm-loader"), element("span", void 0, "Connecting to LumiMind\u2026"));
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
    if (activeView === "scene") root.appendChild(renderScene());
    else if (activeView === "history") root.appendChild(renderHistory());
    else root.appendChild(renderCast());
  }
  function destroySeedTab() {
    seedEditorUnsub?.();
    seedActivateUnsub?.();
    seedEditorUnsub = null;
    seedActivateUnsub = null;
    try {
      seedTab?.destroy();
    } catch {
    }
    seedTab = null;
    seedRoot = null;
    seedCharacterId = null;
    seedDraft = null;
    seedDirty = false;
    seedLoadVersion += 1;
  }
  function ensureSeedTab() {
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
  function syncSeedEditor(editorState) {
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
  function markSeedDirty() {
    seedDirty = true;
    if (!seedRoot) return;
    const stateLabel = seedRoot.querySelector(".lm-seed-state");
    if (stateLabel) {
      stateLabel.textContent = "Unsaved review";
      stateLabel.className = "lm-seed-state dirty";
    }
    const save = seedRoot.querySelector(".lm-seed-save");
    if (save) save.disabled = false;
  }
  function seedTextField(label, value, onInput, hint, rows = 4) {
    const control = textarea(value, rows);
    control.addEventListener("input", () => {
      onInput(control.value);
      markSeedDirty();
    });
    return field(label, control, hint);
  }
  async function saveSeed() {
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
  async function removeSeed() {
    if (!seedPersisted) return;
    const result = await ctx.ui.showConfirm({
      title: "Remove reviewed Mind Seed?",
      message: "Future chats will fall back to transient character-card fields. Existing chat timelines are not erased.",
      variant: "danger",
      confirmLabel: "Remove seed"
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
  function renderSeedEditor() {
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
      loading.append(element("span", "lm-loader"), element("span", void 0, "Preparing transient baseline from card fields\u2026"));
      seedRoot.appendChild(loading);
      return;
    }
    const draft = seedDraft;
    const toolbar = element("div", "lm-seed-toolbar");
    const generate = textButton(seedGenerating ? "Generating draft\u2026" : "Generate draft", () => {
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
      seedTextField("Self-concept", draft.core.selfConcept, (value) => {
        draft.core.selfConcept = value.trim();
      }, "A stable first-person identity frame, not a scene summary.", 6)
    );
    const coreGrid = element("div", "lm-seed-grid");
    const arrayField = (label, key, hint) => seedTextField(label, draft.core[key].join("\n"), (value) => {
      draft.core[key] = uniqueLines(value);
    }, hint, 5);
    coreGrid.append(
      arrayField("Values", "values", "One value per line"),
      arrayField("Desires", "desires", "One enduring desire per line"),
      arrayField("Fears", "fears", "One fear per line"),
      arrayField("Boundaries", "boundaries", "One hard or soft boundary per line"),
      arrayField("Notes", "notes", "Other enduring characterization, one note per line")
    );
    core.appendChild(coreGrid);
    form.appendChild(core);
    const starting = element("section", "lm-seed-section");
    starting.appendChild(element("h3", "lm-seed-section-title", "Starting subjective state"));
    const startingGrid = element("div", "lm-seed-grid");
    startingGrid.append(
      seedTextField("Beliefs", draft.startingBeliefs.join("\n"), (value) => {
        draft.startingBeliefs = uniqueLines(value);
      }, "One supported starting belief per line", 6),
      seedTextField("Secrets", draft.startingSecrets.join("\n"), (value) => {
        draft.startingSecrets = uniqueLines(value);
      }, "Only secrets supported by the card", 6),
      seedTextField("Goals", draft.startingGoals.join("\n"), (value) => {
        draft.startingGoals = uniqueLines(value);
      }, "One active starting goal per line", 6),
      seedTextField("Relationship priors", relationshipLines(draft), (value) => {
        draft.relationshipPriors = parseRelationshipLines(value);
      }, "One per line: Target :: stance", 6)
    );
    starting.appendChild(startingGrid);
    form.appendChild(starting);
    seedRoot.appendChild(form);
  }
  const backendUnsub = ctx.onBackendMessage((payload) => {
    const message = payload;
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
  for (const eventName of ["CHAT_SWITCHED", "CHAT_CHANGED"]) {
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
    destroySeedTab();
    while (cleanups.length) {
      try {
        cleanups.pop()?.();
      } catch {
      }
    }
    ctx.dom.cleanup();
  };
}
export {
  setup
};
