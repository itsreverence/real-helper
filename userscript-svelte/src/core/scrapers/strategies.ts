/**
 * Draft Capture Strategies
 * Implements the Strategy pattern for handling different draft types (league vs game)
 */

import type {
  DetectionResult,
  DraftCaptureStrategy,
  DraftCaptureFactory,
  GameInfo,
  GameMatchup,
} from "../types";
import { scrapeGamesFromSidebar, scrapeGameMatchupFromHeader } from "../scrapers/capture";

/**
 * League Draft Capture Strategy
 * Handles drafts that cover all games for a sport (unlimited entries)
 */
export class LeagueDraftCaptureStrategy implements DraftCaptureStrategy {
  readonly strategyType: "league" = "league";

  detect(): DetectionResult {
    // League drafts are the default - we detect them by absence of game-specific signals
    // Low confidence because we're detecting by exclusion
    return {
      type: "league",
      confidence: 0.5,
      evidence: ["default_draft_type"],
    };
  }

  scrapeGameData(): { games: GameInfo[] } {
    const games = scrapeGamesFromSidebar();
    return { games };
  }

  buildPayloadFields(): Record<string, unknown> {
    return {
      draft_type: "league" as const,
    };
  }
}

/**
 * Game Draft Capture Strategy
 * Handles drafts for a single specific game (limited entries per day)
 */
export class GameDraftCaptureStrategy implements DraftCaptureStrategy {
  readonly strategyType: "game" = "game";
  private detection: DetectionResult;

  constructor(detection: DetectionResult) {
    this.detection = detection;
  }

  detect(): DetectionResult {
    return this.detection;
  }

  scrapeGameData(): { gameMatchup?: GameMatchup } {
    const gameMatchup = scrapeGameMatchupFromHeader() ?? undefined;
    return { gameMatchup };
  }

  buildPayloadFields(): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      draft_type: "game" as const,
    };

    // Add entries remaining if detected
    if (this.detection.entriesRemaining !== null && this.detection.entriesRemaining !== undefined) {
      fields.game_entries_remaining = this.detection.entriesRemaining;
    }

    return fields;
  }
}

/**
 * Draft Detection Helper
 * Provides robust detection of draft types using multiple signals
 */
export function detectDraftType(): DetectionResult {
  // Track all detection evidence
  const evidence: string[] = [];
  let gameSignals = 0;
  let leagueSignals = 0;

  // Method 1: Check for "N SPORT entries remaining today" text
  // This is the most reliable indicator of a game draft
  const entriesRe = /^(\d+)\s+(NFL|NHL|NBA|MLB|CFB|CBB|FC|WNBA)\s+entr(?:y|ies)\s+remaining\s+today$/i;
  const divCandidates = typeof document !== "undefined"
    ? Array.from(document.querySelectorAll<Element>("div"))
    : [];

  for (const el of divCandidates) {
    const t = (el.textContent || "").trim();
    const match = t.match(entriesRe);
    if (match) {
      gameSignals += 3; // High weight - this is definitive
      evidence.push(`entries_text:"${match[0]}"`);
      return {
        type: "game",
        confidence: 1.0,
        evidence,
        sport: match[2].toUpperCase(),
        entriesRemaining: parseInt(match[1], 10),
      };
    }
  }

  // Method 2: Check for Clear/trash button (only present on game drafts when updating)
  // The trash icon SVG has a distinctive path starting with "M53.21 467"
  if (typeof document !== "undefined") {
    const trashSvgs = Array.from(document.querySelectorAll<SVGElement>("svg"));
    for (const svg of trashSvgs) {
      const paths = Array.from(svg.querySelectorAll("path"));
      for (const path of paths) {
        const d = path.getAttribute("d") || "";
        // The trash can icon path starts with "M53.21 467" (delete button)
        if (d.startsWith("M53.21 467")) {
          gameSignals += 2;
          evidence.push("clear_button_svg_detected");
          return {
            type: "game",
            confidence: 0.9,
            evidence,
            sport: null,
            entriesRemaining: null,
          };
        }
      }
    }
  }

  // Method 3: Check for game-specific URL patterns
  if (typeof location !== "undefined") {
    const href = location.href.toLowerCase();
    // Game drafts often have game-specific paths or parameters
    if (href.includes("/game/") || href.includes("game_id=") || href.includes("matchup=")) {
      gameSignals += 1;
      evidence.push("game_url_pattern");
    }
    // League drafts typically have sport-level URLs
    if (href.includes("/nfl") || href.includes("/nba") || href.includes("/nhl") || href.includes("/mlb")) {
      leagueSignals += 1;
      evidence.push("sport_url_pattern");
    }
  }

  // Method 4: Check for multiple games in sidebar (league indicator)
  // League drafts show all games for the sport
  if (typeof document !== "undefined") {
    const sidebarGames = scrapeGamesFromSidebar();
    if (sidebarGames.length >= 2) {
      leagueSignals += 1;
      evidence.push(`multiple_games_in_sidebar:${sidebarGames.length}`);
    } else if (sidebarGames.length === 1) {
      // Could be either, slight bias toward game draft
      evidence.push(`single_game_in_sidebar:${sidebarGames.length}`);
    }
  }

  // Default determination
  if (gameSignals > leagueSignals) {
    return {
      type: "game",
      confidence: Math.min(0.8, gameSignals / 3),
      evidence,
      sport: null,
      entriesRemaining: null,
    };
  }

  return {
    type: "league",
    confidence: Math.min(0.7, leagueSignals / 2),
    evidence,
  };
}

/**
 * Draft Capture Factory
 * Creates the appropriate strategy based on detected draft type
 */
export class DefaultDraftCaptureFactory implements DraftCaptureFactory {
  createStrategy(detection: DetectionResult): DraftCaptureStrategy {
    switch (detection.type) {
      case "game":
        return new GameDraftCaptureStrategy(detection);
      case "league":
      default:
        return new LeagueDraftCaptureStrategy();
    }
  }

  autoDetect(): DraftCaptureStrategy {
    const detection = detectDraftType();
    return this.createStrategy(detection);
  }
}

// Singleton factory instance for convenient access
let factoryInstance: DraftCaptureFactory | null = null;

export function getDraftCaptureFactory(): DraftCaptureFactory {
  if (!factoryInstance) {
    factoryInstance = new DefaultDraftCaptureFactory();
  }
  return factoryInstance;
}

