export const LUMI_MIND_CSS = `
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
}

@media (prefers-reduced-motion: reduce) {
  .lm-root *, .lm-root *::before, .lm-root *::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; }
}
`;
