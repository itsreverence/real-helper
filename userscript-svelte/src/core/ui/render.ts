import type { PayloadOk } from "../types";

function escapeHtml(s: unknown) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtX(n: unknown) {
  const v = typeof n === "number" && !Number.isNaN(n) ? n : null;
  if (v == null) return "—";
  const s = (Math.round(v * 100) / 100).toString();
  return `${s}X`;
}

export function renderPayloadHtml(payload: PayloadOk | any): string {
  if (!payload || payload.ok !== true) {
    return `
      <div class="card" style="border-left-color: var(--rsdh-accent-red);">
        <div class="h">SIGNAL INTERRUPTED</div>
        <div class="sub">${escapeHtml(payload?.error || "Awaiting RealSports draft synchronization.")}</div>
      </div>
    `;
  }

  let slots = Array.isArray(payload?.slots) ? payload.slots : [];
  if ((!slots || slots.length === 0) && Array.isArray(payload?.drafts) && payload.drafts.length > 0) {
    slots = payload.drafts[0].slots || [];
  }

  const expectedSlots = (typeof payload?.expected_slots === "number" && payload.expected_slots > 0) ? payload.expected_slots : slots.length;
  const sport = payload?.sport || "—";
  const mode = payload?.mode || "—";
  const pool = Array.isArray(payload?.player_pool) ? payload.player_pool : [];

  const slotRows = (slots || []).map((s: any, i: number) => {
    const sel = s?.selection ? escapeHtml(s.selection) : "<span style='opacity: 0.3;'>EMPTY_SLOT</span>";
    const mult = fmtX(s?.multiplier);
    return `
      <tr>
        <td><span class="font-mono">${i + 1}</span></td>
        <td><span class="text-accent font-mono">${mult}</span></td>
        <td style="font-weight: 700;">${sel}</td>
      </tr>
    `;
  }).join("");

  const poolRows = pool.slice(0, 40).map((p: any, i: number) => {
    const name = escapeHtml(p?.name || "");
    const st = p?.status ? `<span class="status-pill" style="background: rgba(255,255,255,0.05); color: var(--rsdh-text-dim); margin-left: 8px;">${escapeHtml(p.status)}</span>` : "";
    const bx = (typeof p?.boost_x === "number") ? `<span class="text-green font-mono">+${escapeHtml(p.boost_x)}X</span>` : "";
    return `
      <div class="player-row">
        <div class="player-rank">#${i + 1}</div>
        <div class="player-info">
          <div class="player-name">${name}${st}</div>
          <div class="player-meta">${p.team || sport} • ${p.position || mode}</div>
        </div>
        <div class="player-stats">
          ${bx}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="card">
      <div class="h">TRANSMISSION DATA</div>
      <div class="sub">
        <span class="text-accent">SPORT:</span> ${escapeHtml(sport)} &nbsp;•&nbsp; 
        <span class="text-accent">MODE:</span> ${escapeHtml(mode)} &nbsp;•&nbsp; 
        <span class="text-accent">SLOTS:</span> ${escapeHtml(expectedSlots)}
      </div>
    </div>
    
    <div class="card">
      <div class="h">ROSTER CONFIGURATION</div>
      <table class="table">
        <thead>
          <tr>
            <th>SLOT</th>
            <th>MULT</th>
            <th>SELECTION</th>
          </tr>
        </thead>
        <tbody>
          ${slotRows || "<tr><td colspan='3' style='text-align:center; padding: 24px; opacity: 0.3;'>NO SLOTS DETECTED</td></tr>"}
        </tbody>
      </table>
    </div>

    <div class="card" style="border-left-color: var(--rsdh-accent-green);">
      <div class="h">
        <span>AVAILABLE ASSETS</span>
        <span class="status-pill text-green status-pulsing">LIVE_POOL</span>
      </div>
      <div class="list">
        ${poolRows || "<div style='text-align:center; padding: 24px; opacity: 0.3;'>POOL DATA UNAVAILABLE</div>"}
      </div>
      ${pool.length > 40 ? `<div class="sub" style="margin-top: 12px; text-align: center;">+ ${pool.length - 40} MORE ASSETS IN POOL</div>` : ""}
    </div>
  `.trim();
}

export function renderAiJsonHtml(obj: any, sources: string[] = []): string {
  const lineup = Array.isArray(obj?.lineup) ? obj.lineup : [];
  const bets = Array.isArray(obj?.bets) ? obj.bets : [];
  const assumptions = Array.isArray(obj?.assumptions) ? obj.assumptions : [];
  const questions = Array.isArray(obj?.questions) ? obj.questions : [];

  const rows = lineup.map((s: any) => {
    const idx = escapeHtml(s?.slot_index);
    const player = escapeHtml(s?.player || "");
    const sm = fmtX(s?.slot_multiplier);
    const pb = (typeof s?.player_boost_x === "number") ? `+${escapeHtml(s.player_boost_x)}X` : "+0X";
    const em = fmtX(s?.effective_multiplier);
    return `
      <tr>
        <td class="font-mono">${idx}</td>
        <td style="font-weight: 800;">${player}</td>
        <td class="font-mono">${sm}</td>
        <td class="text-green font-mono">${pb}</td>
        <td><span class="text-accent font-mono" style="font-weight: 900;">${em}</span></td>
      </tr>
    `;
  }).join("");

  const betRows = bets.map((b: any) => {
    const tier = escapeHtml(b?.tier || "");
    const rec = b?.recommend ? "OPTIMAL" : "AVOID";
    const recClass = b?.recommend ? "" : "text-red";
    const color = b?.recommend ? "var(--rsdh-accent-green)" : "var(--rsdh-accent-red)";
    const conf = Math.min(100, Math.max(0, parseInt(b?.confidence) || 0));
    const reason = escapeHtml(b?.reason || "");

    return `
      <div class="card" style="border-left-color: ${color}; padding: 12px 16px;">
        <div class="h" style="margin-bottom: 4px;">
          <span style="font-size: 11px;">${tier}</span>
          <span class="status-pill ${recClass}" style="background: ${color}20; color: ${color};">${rec}</span>
        </div>
        <div class="sub" style="margin-bottom: 8px;">${reason}</div>
        <div class="flex-row space-between">
          <span class="player-meta">CONFIDENCE SCORE</span>
          <span class="font-mono text-accent" style="font-size: 10px;">${conf}%</span>
        </div>
        <div class="meter-container">
          <div class="meter-fill" style="width: ${conf}%; background: ${color};"></div>
        </div>
      </div>
    `;
  }).join("");

  const srcRows = (sources || []).slice(0, 5).map(u => `
    <div class="row">
      <a class="link font-mono" style="font-size: 10px; overflow: hidden; text-overflow: ellipsis;" href="${escapeHtml(u)}" target="_blank" rel="noreferrer">
        LINK: ${escapeHtml(u)}
      </a>
    </div>
  `).join("");

  return `
    <div class="card" style="border-left: 4px solid var(--rsdh-accent-green);">
      <div class="h">AI CO-PILOT ANALYSIS</div>
      <div class="sub">Structured data synchronization complete. Multi-source validation active.</div>
    </div>

    <div class="card">
      <div class="h">OPTIMIZED LINEUP</div>
      <table class="table">
        <thead>
          <tr>
            <th>SLOT</th>
            <th>PLAYER</th>
            <th>MULT</th>
            <th>BOOST</th>
            <th>EFF.</th>
          </tr>
        </thead>
        <tbody>
          ${rows || "<tr><td colspan='5' style='text-align:center; padding: 24px; opacity: 0.3;'>ANALYSIS PENDING</td></tr>"}
        </tbody>
      </table>
    </div>

    <div class="h" style="padding-left: 4px; border-left: 3px solid var(--rsdh-accent); margin: 24px 0 12px 0;">BETTING INTEL</div>
    ${betRows || "<div class='card sub' style='text-align:center;'>NO INTELLIGENCE GATHERED</div>"}

    ${(questions.length ? `<div class="card"><div class="h">ANOMALIES DETECTED</div><div class="list">${questions.map((q: any) => `<div class="row text-red">${escapeHtml(q)}</div>`).join("")}</div></div>` : "")}
    ${(assumptions.length ? `<div class="card"><div class="h">MODEL ASSUMPTIONS</div><div class="list">${assumptions.map((a: any) => `<div class="row">${escapeHtml(a)}</div>`).join("")}</div></div>` : "")}
    ${(srcRows ? `<div class="card"><div class="h">INTELLIGENCE SOURCES</div><div class="list">${srcRows}</div></div>` : "")}
  `.trim();
}
