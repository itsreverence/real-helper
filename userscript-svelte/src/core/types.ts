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

export type PayloadOk = {
  ok: true;
  mode: "modal" | "tile";
  url: string;
  captured_at: string;
  sport: string | null;
  sport_detection_method: string;
  expected_slots?: number | null;
  slots?: Slot[];
  player_pool_count?: number;
  player_pool?: PlayerPoolItem[];
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



