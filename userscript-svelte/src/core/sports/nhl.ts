/**
 * NHL (National Hockey League) sport configuration
 */
import type { SportConfig } from "./types";

export const nhlConfig: SportConfig = {
    code: "NHL",
    name: "National Hockey League",

    stats: [
        // Primary scoring stats
        { code: "G", name: "Goals", aliases: ["goal", "goals", "g"], isPrimary: true },
        { code: "A", name: "Assists", aliases: ["ast", "assist", "assists", "a"], isPrimary: true },
        { code: "PTS", name: "Points", aliases: ["pt", "pts", "points"], isPrimary: true },

        // Shooting stats
        { code: "SOG", name: "Shots on Goal", aliases: ["sog", "shot", "shots"] },

        // Physical stats
        { code: "BLK", name: "Blocks", aliases: ["blk", "blks", "block", "blocks"] },
        { code: "HIT", name: "Hits", aliases: ["hit", "hits"] },

        // Plus/Minus
        { code: "+/-", name: "Plus/Minus", aliases: ["+/-", "plusminus", "pm"] },

        // Penalties
        { code: "PIM", name: "Penalty Minutes", aliases: ["pim", "penalty"] },

        // Faceoffs
        { code: "FOW", name: "Faceoff Wins", aliases: ["fow", "fo", "faceoff"] },
        { code: "FO%", name: "Faceoff Percentage", aliases: ["fo%", "fopct"] },

        // Goalie stats
        { code: "SV", name: "Saves", aliases: ["sv", "save", "saves"] },
        { code: "GA", name: "Goals Against", aliases: ["ga", "goalsagainst"] },
        { code: "SV%", name: "Save Percentage", aliases: ["sv%", "savepct"] },
        { code: "GAA", name: "Goals Against Average", aliases: ["gaa"] },
        { code: "SO", name: "Shutouts", aliases: ["so", "shutout", "shutouts"] },
        { code: "GP", name: "Games Played", aliases: ["gp", "games"] },
        { code: "W", name: "Wins", aliases: ["w", "win", "wins"] },
        { code: "L", name: "Losses", aliases: ["l", "loss", "losses"] },
        { code: "OTL", name: "Overtime Losses", aliases: ["otl", "ot loss"] },

        // Misc
        { code: "TOI", name: "Time on Ice", aliases: ["toi"] },
        { code: "GVA", name: "Giveaways", aliases: ["gva", "gwa", "giveaway", "giveaways"] },
        { code: "TKA", name: "Takeaways", aliases: ["tka", "takeaway", "takeaways"] },

        // Power play / Short handed
        { code: "PPG", name: "Power Play Goals", aliases: ["ppg", "pp goal"] },
        { code: "SHG", name: "Short Handed Goals", aliases: ["shg", "sh goal"] },
    ],

    periods: {
        pattern: /P[1-3]|OT\d?|SO/i,
        labels: ["P1", "P2", "P3", "OT", "SO"],
        hasClock: true,
        timePattern: /:?\d{1,2}(?::\d{2})?/,  // Handles both ":55" and "12:34"
    },

    scoring: {
        pattern: /\d+-\d+/,
        separator: "-",
    },

    fpsPattern: /(\d+(?:\.\d+)?)\s*fps/i,

    primaryStats: ["G", "A", "PTS", "SOG", "BLK"],
};

export default nhlConfig;
