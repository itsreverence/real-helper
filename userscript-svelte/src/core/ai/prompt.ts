import { MAX_POOL_IN_PROMPT } from "../constants";
import type { PayloadOk, Slot, PlayerPoolItem, GameInfo } from "../types";

function baseContext(payload: PayloadOk) {
  let slots: Slot[] = Array.isArray(payload?.slots) ? (payload.slots as Slot[]) : [];
  if ((!slots || slots.length === 0) && Array.isArray(payload?.drafts) && payload.drafts.length > 0) {
    slots = payload.drafts[0].slots || [];
  }
  const slotLines = (slots || [])
    .map((s, idx) => {
      const sel = s.selection ? `selected="${s.selection}"` : "selected=<empty>";
      return `- slot ${idx + 1}: multiplier=${s.multiplier}x, ${sel}`;
    })
    .join("\n");

  const pool: PlayerPoolItem[] = Array.isArray(payload?.player_pool) ? (payload.player_pool as PlayerPoolItem[]) : [];
  const poolSlice = pool.slice(0, MAX_POOL_IN_PROMPT);
  const poolLines = poolSlice
    .map(p => {
      const st = p.status ? ` (${p.status})` : "";
      const bx = typeof p.boost_x === "number" ? ` +${p.boost_x}x` : "";
      return `- ${p.name}${st}${bx}`;
    })
    .join("\n");

  const poolNote =
    pool.length > poolSlice.length
      ? `NOTE: player pool truncated to first ${poolSlice.length} of ${pool.length} for prompt size. For the full list, re-capture and inspect the payload in Debug Mode.`
      : `Player pool items: ${pool.length}.`;

  const expectedSlots =
    typeof payload?.expected_slots === "number" && payload.expected_slots > 0
      ? payload.expected_slots
      : Array.isArray(slots)
        ? slots.length
        : 5;

  // Build games context if available
  const games: GameInfo[] = Array.isArray(payload?.games) ? payload.games : [];
  const gamesLines = games.length > 0
    ? games.map(g => {
      let suffix = "";
      if (g.status === "finished" && g.score) {
        suffix = ` (Final: ${g.score})`;
      } else if (g.time) {
        suffix = ` @ ${g.time}`;
      } else if (g.status === "finished") {
        suffix = " (Final)";
      }
      return `- ${g.team1} vs ${g.team2}${suffix}`;
    }).join("\n")
    : "";

  const context = [
    "You are helping build an optimal Draft Lineup.",
    "",
    "### Context (captured from realsports.io UI)",
    `URL: ${payload?.url || "<unknown>"}`,
    `Captured At: ${payload?.captured_at || "<unknown>"}`,
    `Capture Mode: ${payload?.mode || "<unknown>"}`,
    `Sport: ${payload?.sport || "<unknown>"}`,
    "",
    ...(gamesLines ? [
      "### Today's Games",
      "The following games are scheduled. Players from these teams will be playing:",
      gamesLines,
      "",
    ] : []),
    "### Rules / how scoring multipliers work",
    `- You must select EXACTLY ${expectedSlots} unique players.`,
    "- Each lineup slot has a slot multiplier (e.g. 2.0x, 1.8x, 1.6x...).",
    "- Each player also has a boost shown as +Bx (e.g. +0.9x).",
    "- ASSUME boosts are additive with the slot multiplier:",
    "  effective_multiplier = slot_multiplier + player_boost_x",
    "  example: slot 2.0x + player +0.9x => effective 2.9x",
    "- Goal: assign the best combination of players to slots to maximize expected Real score.",
    "",
    "### Betting payouts (Rax)",
    "- Entry fee is ALWAYS 100 Rax for any bet tier.",
    "- If lineup finishes Top 50%: payout 170 Rax (profit +70).",
    "- If lineup finishes Top 20%: payout 350 Rax (profit +250).",
    "- If lineup finishes Top 10%: payout 700 Rax (profit +600).",
    "",
    "Slots (higher multiplier = bigger boost):",
    slotLines || "- <no slots found>",
    "",
    "Available player pool (with their +boost values shown in the UI):",
    poolLines || "- <no pool detected>",
    poolNote,
    "",
    "### Task",
    "Choose exactly the required number of players from the pool and assign them to slots.",
    "Prefer players who are not Out/Inactive (if status is provided).",
    "Explain briefly why each player goes into each slot.",
    "Also provide bet recommendations for: Top 50%, Top 20%, Top 10.",
    "",
  ].join("\n");

  return { context, expectedSlots };
}

// For Copy Prompt (chat UI): readable, no JSON.
export function buildChatPromptFromPayload(payload: PayloadOk): string {
  const { context, expectedSlots } = baseContext(payload);
  return [
    context,
    "### Output format (human-readable)",
    "Reply in plain English with these sections:",
    "1) Lineup (final)",
    `- List exactly ${expectedSlots} slots in order (slot 1..${expectedSlots}), showing: player, slot multiplier, player boost, and effective multiplier.`,
    "2) Why this lineup",
    "- 1–3 bullets summarizing the approach.",
    "3) Slot-by-slot rationale",
    "- Short note per slot explaining the assignment.",
    "4) Bets",
    "- Recommendations for Top 50%, Top 20%, Top 10 (recommend yes/no + confidence + one sentence reason).",
    "",
    "Do NOT include JSON. Keep it readable and actionable.",
  ].join("\n");
}

// For Ask buttons (structured outputs): do NOT discourage JSON; keep it schema-friendly.
export function buildStructuredPromptFromPayload(payload: PayloadOk, opts?: { webHint?: boolean; toolHint?: boolean; searchHint?: boolean; strategy?: "safe" | "balanced" | "risky" }): string {
  const { context } = baseContext(payload);
  const webHint = opts?.webHint
    ? "If web search is available, use it ONLY to verify time-sensitive info like injury status, starters, scratches, minutes restrictions, and recent news."
    : null;
  const toolHint = opts?.toolHint
    ? [
      "",
      "### Player Profile Lookup Tool",
      "You have access to `get_player_profile_stats` - use it to fetch detailed stats for any player when:",
      "- Boost values alone aren't enough to decide between players",
      "- You need recent performance data (game logs, rankings, trends)",
      "- A player's floor/ceiling matters for the decision",
      "Call it with the player's name exactly as shown in the pool. The tool will scrape their profile and return stats.",
      "",
    ].join("\n")
    : "If you need player projections/stats beyond the boost values, DO NOT ask the user generic follow-up questions. Instead, request player profile stats using the tool for specific players you want to evaluate.";
  const searchHint = opts?.searchHint
    ? [
      "",
      "### Draft Player Search Tool",
      "The initial player pool shows up to ~50 players, but more may be available.",
      "You have access to `search_draft_players` - use it to search for specific players by name if they aren't in the current pool.",
      "- Search by player name or partial name (e.g. 'McDavid', 'Ovi', 'Connor')",
      "- Note: only searches by player name, NOT by position or team",
      "- Useful when a player you're looking for isn't in the visible list",
      "",
    ].join("\n")
    : "";

  // Strategy-specific guidance
  let strategyHint = "";
  const strategy = opts?.strategy || "balanced";
  if (strategy === "safe") {
    strategyHint = [
      "",
      "### Lineup Strategy: SAFE",
      "The user has requested a SAFE, consistent lineup. Prioritize:",
      "- Players with high floor and consistent production",
      "- Established stars with predictable output",
      "- Lower variance, reliable performers",
      "- Avoid boom-or-bust picks",
      "",
    ].join("\n");
  } else if (strategy === "risky") {
    strategyHint = [
      "",
      "### Lineup Strategy: RISKY (High Upside)",
      "The user wants a RISKY, high-ceiling lineup. Prioritize:",
      "- Players with explosive potential who can outperform their boost",
      "- Boom-or-bust picks with high upside",
      "- Hot streaks, favorable matchups, breakout candidates",
      "- Accept lower floor for higher ceiling",
      "",
    ].join("\n");
  }
  // Balanced = no special hint, default behavior

  return [
    context,
    webHint ? `\n${webHint}\n` : "",
    toolHint,
    searchHint,
    strategyHint,
    "Return data that matches the provided JSON schema exactly.",
  ].join("\n").trim();
}
