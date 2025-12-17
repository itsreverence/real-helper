export type Slot = {
  multiplier: number;
  selection: string | null;
  is_empty: boolean;
};

export type PlayerPoolItem = {
  name: string;
  status: string | null;
  boost_x: number | null;
  profile_url?: string | null;
};

export type SportInfo = {
  sport: string | null;
  method: string;
  [k: string]: unknown;
};

export type GameInfo = {
  team1: string;
  team1_record: string | null;
  team2: string;
  team2_record: string | null;
  time: string | null;            // "7:00 PM" for upcoming
  status: "upcoming" | "live" | "finished";
  score?: string | null;          // For live/finished games
};

/** For game-specific drafts: the two teams in the matchup */
export type GameMatchup = {
  team1: string;
  team1_record?: string | null;
  team1_score?: number | null;    // For live/finished games
  team2: string;
  team2_record?: string | null;
  team2_score?: number | null;    // For live/finished games
  time?: string | null;           // "8:00 PM" for upcoming
  spread?: string | null;         // e.g., "CLE by 5.5"
  status: "upcoming" | "live" | "finished";
};

export type PayloadOk = {
  ok: true;
  mode: "modal" | "tile";
  url: string;
  captured_at: string;
  sport: string | null;
  sport_detection_method: string;
  /** Type of draft: "league" for all games, "game" for single matchup */
  draft_type?: "league" | "game";
  /** For game drafts: remaining entries allowed today */
  game_entries_remaining?: number;
  /** For game drafts: the two teams in this matchup */
  game_matchup?: GameMatchup;
  expected_slots?: number | null;
  slots?: Slot[];
  player_pool_count?: number;
  player_pool?: PlayerPoolItem[];
  games?: GameInfo[];
  drafts?: { text: string; slots: Slot[] }[];
  [k: string]: unknown;
};

export type PayloadErr = {
  ok: false;
  error: string;
  url: string;
  sport: string | null;
  sport_detection_method: string;
  [k: string]: unknown;
};

export type Payload = PayloadOk | PayloadErr;

export type OpenRouterConfig = {
  apiKey: string;
  model: string;
  temperature: number;
  max_tokens: number;
  web_max_results: number;
  structured: boolean;
  response_healing: boolean;
};



