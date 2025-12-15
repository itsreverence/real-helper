/**
 * Sport Configuration Module
 * 
 * Provides sport-specific stat definitions, period formats, and parsing patterns.
 * Use getSportConfig(sport) to get the appropriate configuration for a sport.
 */

import type { SportConfig, SportCode, StatDef, ParsedStat } from "./types";
import { nhlConfig } from "./nhl";
import { nbaConfig } from "./nba";
import { nflConfig } from "./nfl";
import { mlbConfig } from "./mlb";
import { genericConfig, createGenericConfig } from "./generic";

// Re-export types
export type { SportConfig, SportCode, StatDef, ParsedStat, PeriodFormat, ScoreFormat, ParsedPlay } from "./types";

// Sport config registry
// Note: College sports (CFB, CBB) use same stats as pro equivalents
const SPORT_CONFIGS: Record<string, SportConfig> = {
    NHL: nhlConfig,
    NBA: nbaConfig,
    NFL: nflConfig,
    MLB: mlbConfig,
    // College sports mirror their pro equivalents
    CFB: { ...nflConfig, code: "CFB" as any, name: "College Football" },
    CBB: { ...nbaConfig, code: "CBB" as any, name: "College Basketball" },
    // WNBA mirrors NBA
    WNBA: { ...nbaConfig, code: "WNBA" as any, name: "Women's NBA" },
    // FC (Soccer) uses generic for now
    FC: createGenericConfig("FC", "Football Club / Soccer"),
    // Note: UFC and Golf don't have drafts, not included
};

/**
 * Get the sport configuration for a given sport code
 * Returns generic config if sport is unknown
 */
export function getSportConfig(sport: string | null | undefined): SportConfig {
    if (!sport) return genericConfig;

    const normalized = sport.toUpperCase().trim();
    return SPORT_CONFIGS[normalized] || genericConfig;
}

/**
 * Check if we have a dedicated config for this sport (vs generic fallback)
 */
export function hasDedicatedConfig(sport: string | null | undefined): boolean {
    if (!sport) return false;
    const normalized = sport.toUpperCase().trim();
    return ["NHL", "NBA", "NFL", "MLB"].includes(normalized);
}

/**
 * Get all supported sport codes
 */
export function getSupportedSports(): string[] {
    return Object.keys(SPORT_CONFIGS);
}

/**
 * Parse stats from a text string using the sport's stat definitions
 */
export function parseStatsFromText(text: string, sport: string | null | undefined): ParsedStat[] {
    const config = getSportConfig(sport);
    const stats: ParsedStat[] = [];
    const normalized = text.toLowerCase();

    for (const statDef of config.stats) {
        for (const alias of statDef.aliases) {
            // Match patterns like "2 goal" or "2 goals" or "goal: 2"
            const patterns = [
                new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${alias}s?\\b`, "gi"),
                new RegExp(`${alias}s?\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)`, "gi"),
            ];

            for (const pattern of patterns) {
                let match: RegExpExecArray | null;
                while ((match = pattern.exec(normalized)) !== null) {
                    const value = parseFloat(match[1]);
                    if (!isNaN(value)) {
                        // Avoid duplicates
                        if (!stats.some(s => s.code === statDef.code && s.value === value)) {
                            stats.push({
                                code: statDef.code,
                                value,
                                raw: match[0],
                            });
                        }
                    }
                }
            }
        }
    }

    return stats;
}

/**
 * Get display name for a stat code
 */
export function getStatDisplayName(code: string, sport: string | null | undefined): string {
    const config = getSportConfig(sport);
    const stat = config.stats.find(s => s.code === code);
    return stat?.name || code;
}

/**
 * Check if a stat is a primary/key stat for the sport
 */
export function isPrimaryStat(code: string, sport: string | null | undefined): boolean {
    const config = getSportConfig(sport);
    return config.primaryStats.includes(code);
}
