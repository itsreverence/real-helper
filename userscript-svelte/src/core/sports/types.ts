/**
 * Sport-specific configuration types
 * Each sport has unique stat categories, period formats, and scoring patterns
 */

export type SportCode = "NHL" | "NBA" | "NFL" | "MLB" | "CFB" | "CBB" | "UFC" | "Golf" | "FC" | "WNBA";

/**
 * Definition of a statistic category
 */
export interface StatDef {
    /** Short code used in UI (e.g., "G", "AST", "TD") */
    code: string;
    /** Full display name (e.g., "Goals", "Assists", "Touchdowns") */
    name: string;
    /** Aliases that might appear in data (e.g., ["goal", "goals", "g"]) */
    aliases: string[];
    /** Whether this is a key/primary stat for the sport */
    isPrimary?: boolean;
}

/**
 * Period/quarter/inning format for a sport
 */
export interface PeriodFormat {
    /** Regex pattern to match period indicators (e.g., /P[1-3]|OT/i for hockey) */
    pattern: RegExp;
    /** Labels for periods (e.g., ["P1", "P2", "P3", "OT"]) */
    labels: string[];
    /** Whether the sport uses a game clock */
    hasClock: boolean;
    /** Time format pattern if hasClock is true (e.g., /\d{1,2}:\d{2}/) */
    timePattern?: RegExp;
}

/**
 * Score format for a sport
 */
export interface ScoreFormat {
    /** Pattern to match scores (e.g., /\d+-\d+/ for most sports) */
    pattern: RegExp;
    /** Separator between scores */
    separator: string;
}

/**
 * Complete sport configuration
 */
export interface SportConfig {
    /** Sport code identifier */
    code: SportCode;
    /** Display name */
    name: string;
    /** All stat definitions for this sport */
    stats: StatDef[];
    /** Period/quarter/inning format */
    periods: PeriodFormat;
    /** Score format */
    scoring: ScoreFormat;
    /** Pattern to match FPS value */
    fpsPattern: RegExp;
    /** Primary stat codes to highlight */
    primaryStats: string[];
}

/**
 * Parsed stat from raw text
 */
export interface ParsedStat {
    code: string;
    value: number | string;
    raw: string;
}

/**
 * Parsed play entry
 */
export interface ParsedPlay {
    score: string;
    period: string;
    time: string;
    relativeTime: string;
    fps: number;
    action: string;
    players: { name: string; stats: ParsedStat[] }[];
}
