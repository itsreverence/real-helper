import { MAX_POOL_IN_PROMPT } from "../constants";
import type { PayloadOk, Slot, PlayerPoolItem, GameInfo, GameMatchup } from "../types";

// Fixed slot multipliers (slot 1 = 2.0x, slot 2 = 1.8x, etc.)
// These are always the same in RealSports drafts.
// Used to ensure AI gets correct slot values even when scraping filled drafts
// (where the displayed value is combined slot + player boost).
const FIXED_SLOT_MULTIPLIERS = [2.0, 1.8, 1.6, 1.4, 1.2];

// Helper to parse status field - separates injury status from stat projections
// Game drafts include stat projections in the status field, league drafts only have injury status
function parseStatusField(status: string | null): { injuryStatus: string; projections: string } {
  if (!status) return { injuryStatus: "", projections: "" };

  // Common injury status patterns to extract
  const injuryPatterns = /\b(Active|Questionable|Doubtful|Out|Inactive|IR|COVID|Probable)\b/i;
  const match = status.match(injuryPatterns);

  if (match) {
    const injuryStatus = match[0];
    const projectionPart = status.replace(injuryPatterns, "").replace(/^[\s,]+|[\s,]+$/g, "").trim();
    return {
      injuryStatus,
      projections: projectionPart
    };
  }

  // No injury status found, treat entire status as projections (game draft edge case)
  return { injuryStatus: "", projections: status };
}

function baseContext(payload: PayloadOk) {
  let slots: Slot[] = Array.isArray(payload?.slots) ? (payload.slots as Slot[]) : [];
  if ((!slots || slots.length === 0) && Array.isArray(payload?.drafts) && payload.drafts.length > 0) {
    slots = payload.drafts[0].slots || [];
  }

  // Get the player pool for looking up boosts
  const pool: PlayerPoolItem[] = Array.isArray(payload?.player_pool) ? (payload.player_pool as PlayerPoolItem[]) : [];

  const slotLines = (slots || [])
    .map((s, idx) => {
      // Use fixed slot multiplier for AI
      const slotMult = FIXED_SLOT_MULTIPLIERS[idx] ?? s.multiplier;

      if (s.selection) {
        // Look up player boost from pool
        const selLower = s.selection.toLowerCase();
        const found = pool.find(p => p?.name?.toLowerCase() === selLower);
        const playerBoost = (found && typeof found.boost_x === "number") ? found.boost_x : 0;
        const effectiveMult = slotMult + playerBoost;

        // Show full breakdown: slot_mult + player_boost = effective, selected player
        return `- slot ${idx + 1}: slot_mult=${slotMult}x + player_boost=+${playerBoost}x = effective=${effectiveMult}x, selected="${s.selection}"`;
      } else {
        // Empty slot - just show slot multiplier
        return `- slot ${idx + 1}: slot_mult=${slotMult}x, selected=<empty>`;
      }
    })
    .join("\n");



  const poolSlice = pool.slice(0, MAX_POOL_IN_PROMPT);

  // Determine draft type for display formatting
  const draftType = payload?.draft_type || "league";

  // Build pool lines with different formatting for game vs league drafts
  const poolLines = poolSlice
    .map(p => {
      const { injuryStatus, projections } = parseStatusField(p.status);
      const bx = typeof p.boost_x === "number" ? ` +${p.boost_x}x` : "";

      if (draftType === "game") {
        // Game drafts: show player + injury status | projections info
        const injuryPart = injuryStatus ? ` (${injuryStatus})` : "";
        const projPart = projections ? ` | Proj: ${projections}` : "";
        return `- ${p.name}${injuryPart}${projPart}${bx}`;
      } else {
        // League drafts: show player + injury status + boost
        const st = injuryStatus ? ` (${injuryStatus})` : "";
        return `- ${p.name}${st}${bx}`;
      }
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

  // Determine draft type and build game context accordingly
  const matchup = payload?.game_matchup as GameMatchup | undefined;
  const games: GameInfo[] = Array.isArray(payload?.games) ? payload.games : [];

  // Build game/matchup context based on draft type
  let gamesContext: string[] = [];
  if (draftType === "game" && matchup) {
    // Game draft: show single matchup
    const team1Info = matchup.team1 + (matchup.team1_record ? ` (${matchup.team1_record})` : "");
    const team2Info = matchup.team2 + (matchup.team2_record ? ` (${matchup.team2_record})` : "");
    let statusLine = "";
    if (matchup.status === "finished" && matchup.team1_score !== null && matchup.team2_score !== null) {
      statusLine = `Final: ${matchup.team1} ${matchup.team1_score} - ${matchup.team2} ${matchup.team2_score}`;
    } else if (matchup.time) {
      statusLine = `Game time: ${matchup.time}`;
    } else if (matchup.status === "live") {
      statusLine = "Game in progress";
    }
    gamesContext = [
      "### Game Draft (Single Matchup)",
      "This is a GAME DRAFT for a specific matchup, not a league-wide draft.",
      `Matchup: ${team1Info} vs ${team2Info}`,
      ...(statusLine ? [statusLine] : []),
      ...(matchup.spread ? [`Spread: ${matchup.spread}`] : []),
      ...(typeof payload?.game_entries_remaining === "number" ? [`Entries remaining today: ${payload.game_entries_remaining}`] : []),
      "All players in the pool are from these two teams ONLY.",
      "",
    ];
  } else if (games.length > 0) {
    // League draft: show all games
    const gamesLines = games.map(g => {
      let suffix = "";
      if (g.status === "finished" && g.score) {
        suffix = ` (Final: ${g.score})`;
      } else if (g.time) {
        suffix = ` @ ${g.time}`;
      } else if (g.status === "finished") {
        suffix = " (Final)";
      }
      return `- ${g.team1} vs ${g.team2}${suffix}`;
    }).join("\n");
    gamesContext = [
      "### Today's Games",
      "The following games are scheduled. Players from these teams will be playing:",
      gamesLines,
      "",
    ];
  }

  // Only include betting info for league drafts (game drafts don't have top 50/20/10 betting)
  const bettingSection = draftType !== "game" ? [
    "### Betting payouts (Rax)",
    "- Entry fee is ALWAYS 100 Rax for any bet tier.",
    "- If lineup finishes Top 50%: payout 170 Rax (profit +70).",
    "- If lineup finishes Top 20%: payout 350 Rax (profit +250).",
    "- If lineup finishes Top 10%: payout 700 Rax (profit +600).",
    "",
  ] : [];

  // Bet recommendation instruction only for league drafts
  const betInstruction = draftType !== "game"
    ? "Also provide bet recommendations for: Top 50%, Top 20%, Top 10."
    : "";

  // Scoring explanation differs for game vs league drafts
  const scoringSection = draftType === "game" ? [
    "### How Scoring Works",
    `- You must select EXACTLY ${expectedSlots} unique players.`,
    "- Each lineup slot has a slot multiplier (e.g. 2.0x, 1.8x, 1.6x...).",
    "- Game drafts do NOT have player boosts - only slot multipliers apply.",
    "",
    "### Scoring Formula",
    "  lineup_score = SUM( player_real_points × slot_multiplier )",
    "",
    "- Goal: maximize total lineup_score.",
    "- Slot multipliers amplify whatever the player actually scores in the game.",
    "- Example: 20 real points × 2.0x = 40 Draft points.",
    "",
  ] : [
    "### How Scoring Works",
    `- You must select EXACTLY ${expectedSlots} unique players.`,
    "- Each lineup slot has a slot multiplier (e.g. 2.0x, 1.8x, 1.6x...).",
    "- Each player also has a boost shown as +Bx (e.g. +0.9x).",
    "- Multipliers are additive: effective_multiplier = slot_multiplier + player_boost_x",
    "  Example: slot 2.0x + player +0.9x => effective 2.9x",
    "",
    "### Scoring Formula",
    "  lineup_score = SUM( player_real_points × effective_multiplier )",
    "",
    "- Goal: maximize total lineup_score.",
    "- Multipliers amplify whatever the player actually scores that day.",
    "- Example: 5 real points × 3.0x = 15 Draft points; 20 real points × 2.0x = 40 Draft points.",
    "",
  ];

  // Pool description differs based on draft type
  const poolDescription = draftType === "game"
    ? "Available player pool:"
    : "Available player pool (with their +boost values shown in the UI):";

  const context = [
    "You are helping build an optimal Draft Lineup.",
    "",
    "### Context (captured from realsports.io UI)",
    `URL: ${payload?.url || "<unknown>"}`,
    `Captured At: ${payload?.captured_at || "<unknown>"}`,
    `Capture Mode: ${payload?.mode || "<unknown>"}`,
    `Sport: ${payload?.sport || "<unknown>"}`,
    `Draft Type: ${draftType === "game" ? "Game (single matchup)" : "League (all games)"}`,
    "",
    ...gamesContext,
    ...scoringSection,
    ...bettingSection,
    "Current slots:",
    slotLines || "- <no slots found>",
    "",
    poolDescription,
    poolLines || "- <no pool detected>",
    poolNote,
    "",
    "### Task",
    "Choose exactly the required number of players from the pool and assign them to slots.",
    "Player status meanings: Active = confirmed playing, Questionable = may or may not play, Out/Inactive = will not play.",
    "Explain briefly why each player goes into each slot.",
    betInstruction,
    "",
  ].join("\n");

  return { context, expectedSlots, draftType };
}

// For Copy Prompt (chat UI): readable, no JSON.
export function buildChatPromptFromPayload(payload: PayloadOk): string {
  const { context, expectedSlots, draftType } = baseContext(payload);

  // Only include bets section for league drafts
  const betsSection = draftType !== "game" ? [
    "4) Bets",
    "- Recommendations for Top 50%, Top 20%, Top 10 (recommend yes/no + confidence + one sentence reason).",
  ] : [];

  // Lineup output format differs for game vs league drafts
  const lineupFormat = draftType === "game"
    ? `- List exactly ${expectedSlots} slots in order (slot 1..${expectedSlots}), showing: player and slot multiplier.`
    : `- List exactly ${expectedSlots} slots in order (slot 1..${expectedSlots}), showing: player, slot multiplier, player boost, and effective multiplier.`;

  return [
    context,
    "### Output format (human-readable)",
    "Reply in plain English with these sections:",
    "1) Lineup (final)",
    lineupFormat,
    "2) Why this lineup",
    "- 1–3 bullets summarizing the approach.",
    "3) Slot-by-slot rationale",
    "- Short note per slot explaining the assignment.",
    ...betsSection,
    "",
    "Do NOT include JSON. Keep it readable and actionable.",
  ].join("\n");
}

// For Ask buttons (structured outputs): do NOT discourage JSON; keep it schema-friendly.
export function buildStructuredPromptFromPayload(payload: PayloadOk, opts?: { webHint?: boolean; toolHint?: boolean; searchHint?: boolean; strategy?: "safe" | "balanced" | "risky" }): string {
  const { context } = baseContext(payload);
  const webHint = opts?.webHint
    ? "Web search is available for: player props/betting lines (over/unders), etc."
    : null;
  const toolHint = opts?.toolHint
    ? [
      "",
      "### Available Tool: Player Profile Lookup",
      "`get_player_profile_stats` - fetches detailed stats for any player.",
      "Returns: recent performance data, game logs, rankings, trends.",
      "Usage: call with player name exactly as shown in the pool.",
      "",
    ].join("\n")
    : "";
  const searchHint = opts?.searchHint
    ? [
      "",
      "### Available Tool: Draft Player Search",
      "`search_draft_players` - searches for players by name in the full draft pool.",
      "The visible player pool shows ~50 players, but more may be available.",
      "Usage: search by player name or partial name (e.g. 'McDavid', 'Connor').",
      "",
    ].join("\n")
    : "";


  // Strategy-specific guidance
  let strategyHint = "";
  const strategy = opts?.strategy || "balanced";
  if (strategy === "safe") {
    strategyHint = [
      "",
      "### User Strategy Preference: SAFE",
      "The user prefers a conservative, low-variance lineup.",
      "Characteristics they value: consistency, high floor, predictable output, established performers.",
      "",
    ].join("\n");
  } else if (strategy === "balanced") {
    strategyHint = [
      "",
      "### User Strategy Preference: BALANCED",
      "The user wants a balanced approach - weighing both upside potential and consistency.",
      "",
    ].join("\n");
  } else if (strategy === "risky") {
    strategyHint = [
      "",
      "### User Strategy Preference: RISKY",
      "The user prefers a high-upside, high-variance lineup.",
      "Characteristics they value: explosive potential, breakout candidates, higher ceiling even if floor is lower.",
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
