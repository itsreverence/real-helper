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
  return `${s}x`;
}

export function renderPayloadHtml(payload: PayloadOk | any): string {
  if (!payload || payload.ok !== true) {
    return `<div class="card"><div class="h">Nothing captured</div><div class="sub">${escapeHtml(payload?.error || "Open a draft modal and click Capture.")}</div></div>`;
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
    const sel = s?.selection ? escapeHtml(s.selection) : "<span class='muted'>Empty</span>";
    const mult = fmtX(s?.multiplier);
    return `<tr><td>${i + 1}</td><td>${mult}</td><td>${sel}</td></tr>`;
  }).join("");

  const poolRows = pool.slice(0, 40).map((p: any) => {
    const name = escapeHtml(p?.name || "");
    const st = p?.status ? `<span class="muted">(${escapeHtml(p.status)})</span>` : "";
    const bx = (typeof p?.boost_x === "number") ? `<span class="pill">+${escapeHtml(p.boost_x)}x</span>` : "";
    return `<div class="row"><div class="rowLeft">${name} ${st}</div><div class="rowRight">${bx}</div></div>`;
  }).join("");

  const poolNote = pool.length > 40 ? `<div class="sub">Showing 40 of ${pool.length} players.</div>` : `<div class="sub">Players: ${pool.length}.</div>`;

  return `
    <div class="card">
      <div class="h">Capture</div>
      <div class="sub">Sport: <b>${escapeHtml(sport)}</b> · Mode: <b>${escapeHtml(mode)}</b> · Slots: <b>${escapeHtml(expectedSlots)}</b></div>
    </div>
    <div class="card">
      <div class="h">Slots</div>
      <table class="table">
        <thead><tr><th>#</th><th>Multiplier</th><th>Selection</th></tr></thead>
        <tbody>${slotRows || "<tr><td colspan='3' class='muted'>No slots found.</td></tr>"}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="h">Player pool</div>
      ${poolNote}
      <div class="list">${poolRows || "<div class='muted'>No pool detected.</div>"}</div>
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
    const pb = (typeof s?.player_boost_x === "number") ? `+${escapeHtml(s.player_boost_x)}x` : "+0x";
    const em = fmtX(s?.effective_multiplier);
    return `<tr><td>${idx}</td><td>${player}</td><td>${sm}</td><td>${pb}</td><td><b>${em}</b></td></tr>`;
  }).join("");

  const betRows = bets.map((b: any) => {
    const tier = escapeHtml(b?.tier || "");
    const rec = b?.recommend ? "YES" : "NO";
    const recClass = b?.recommend ? "yes" : "no";
    const conf = escapeHtml(b?.confidence || "");
    const reason = escapeHtml(b?.reason || "");
    return `<div class="bet-item"><div class="bet-header"><span class="bet-tier">${tier}</span><span class="bet-rec ${recClass}">${rec}</span><span class="muted">(${conf})</span></div><div class="bet-reason">${reason}</div></div>`;
  }).join("");

  const srcRows = (sources || []).slice(0, 8).map(u => `<div class="row"><a class="link" href="${escapeHtml(u)}" target="_blank" rel="noreferrer">${escapeHtml(u)}</a></div>`).join("");

  return `
    <div class="card"><div class="h">AI result</div><div class="sub">Structured JSON parsed successfully.</div></div>
    <div class="card">
      <div class="h">Lineup</div>
      <table class="table">
        <thead><tr><th>Slot</th><th>Player</th><th>Slot</th><th>Boost</th><th>Effective</th></tr></thead>
        <tbody>${rows || "<tr><td colspan='5' class='muted'>No lineup returned.</td></tr>"}</tbody>
      </table>
    </div>
    <div class="card"><div class="h">Bets</div><div class="list">${betRows || "<div class='muted'>No bets returned.</div>"}</div></div>
    ${(questions.length ? `<div class="card"><div class="h">Questions</div><div class="list">${questions.map((q: any) => `<div class="row">${escapeHtml(q)}</div>`).join("")}</div></div>` : "")}
    ${(assumptions.length ? `<div class="card"><div class="h">Assumptions</div><div class="list">${assumptions.map((a: any) => `<div class="row">${escapeHtml(a)}</div>`).join("")}</div></div>` : "")}
    ${(srcRows ? `<div class="card"><div class="h">Sources</div><div class="list">${srcRows}</div></div>` : "")}
  `.trim();
}



