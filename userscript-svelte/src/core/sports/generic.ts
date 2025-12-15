/**
 * Generic sport configuration (fallback for unsupported sports)
 * Used for: CFB, CBB, UFC, Golf, FC, WNBA, and any unknown sports
 */
import type { SportConfig, SportCode } from "./types";

export const genericConfig: SportConfig = {
    code: "NFL" as SportCode, // Will be overridden
    name: "Generic Sport",

    stats: [
        // Common across many sports
        { code: "PTS", name: "Points", aliases: ["pt", "pts", "points", "point"], isPrimary: true },
        { code: "AST", name: "Assists", aliases: ["ast", "assist", "assists", "a"] },
        { code: "REB", name: "Rebounds", aliases: ["reb", "rebs", "rebound", "rebounds"] },
        { code: "BLK", name: "Blocks", aliases: ["blk", "blks", "block", "blocks"] },
        { code: "STL", name: "Steals", aliases: ["stl", "steal", "steals"] },
        { code: "G", name: "Goals", aliases: ["goal", "goals", "g"] },
        { code: "SOG", name: "Shots", aliases: ["sog", "shot", "shots"] },
        { code: "TO", name: "Turnovers", aliases: ["to", "tov", "turnover", "turnovers"] },
        { code: "FG", name: "Field Goals", aliases: ["fg", "fgs", "field goal"] },
        { code: "3PM", name: "3-Pointers", aliases: ["3pm", "3pt", "three", "threes"] },
        { code: "TD", name: "Touchdowns", aliases: ["td", "tds", "touchdown"] },
        { code: "YD", name: "Yards", aliases: ["yd", "yds", "yards"] },
        { code: "REC", name: "Receptions", aliases: ["rec", "recs", "reception"] },

        // Golf
        { code: "BIRDIE", name: "Birdies", aliases: ["birdie", "birdies"] },
        { code: "PAR", name: "Pars", aliases: ["par", "pars"] },
        { code: "BOGEY", name: "Bogeys", aliases: ["bogey", "bogeys"] },
        { code: "EAGLE", name: "Eagles", aliases: ["eagle", "eagles"] },

        // UFC/MMA
        { code: "KO", name: "Knockouts", aliases: ["ko", "knockout", "knockouts"] },
        { code: "SUB", name: "Submissions", aliases: ["sub", "submission", "submissions"] },
        { code: "TKD", name: "Takedowns", aliases: ["tkd", "takedown", "takedowns"] },
        { code: "STR", name: "Strikes", aliases: ["str", "strike", "strikes"] },

        // Soccer/FC
        { code: "GLS", name: "Goals", aliases: ["gls", "goal", "goals"] },
        { code: "SHT", name: "Shots", aliases: ["sht", "shot", "shots"] },
        { code: "SOT", name: "Shots on Target", aliases: ["sot"] },
        { code: "CRN", name: "Corners", aliases: ["crn", "corner", "corners"] },
    ],

    periods: {
        // Very flexible pattern for various formats
        pattern: /(?:P[1-3]|Q[1-4]|H[1-2]|OT\d?|SO|R\d+|RD\s*\d+)/i,
        labels: ["1", "2", "3", "4", "OT"],
        hasClock: true,
        timePattern: /\d{1,2}:\d{2}/,
    },

    scoring: {
        pattern: /\d+-\d+/,
        separator: "-",
    },

    fpsPattern: /(\d+(?:\.\d+)?)\s*fps/i,

    primaryStats: ["PTS", "G", "TD", "REC"],
};

/**
 * Create a generic config for a specific sport code
 */
export function createGenericConfig(code: SportCode, name: string): SportConfig {
    return {
        ...genericConfig,
        code,
        name,
    };
}

export default genericConfig;
