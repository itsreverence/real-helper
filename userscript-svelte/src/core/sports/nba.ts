/**
 * NBA (National Basketball Association) sport configuration
 */
import type { SportConfig } from "./types";

export const nbaConfig: SportConfig = {
    code: "NBA",
    name: "National Basketball Association",

    stats: [
        // Scoring
        { code: "PTS", name: "Points", aliases: ["pt", "pts", "points", "point"], isPrimary: true },
        { code: "FGM", name: "Field Goals Made", aliases: ["fgm", "fg"] },
        { code: "FGA", name: "Field Goals Attempted", aliases: ["fga"] },
        { code: "3PM", name: "3-Pointers Made", aliases: ["3pm", "3pt", "three", "threes"], isPrimary: true },
        { code: "3PA", name: "3-Pointers Attempted", aliases: ["3pa"] },
        { code: "FTM", name: "Free Throws Made", aliases: ["ftm", "ft"] },
        { code: "FTA", name: "Free Throws Attempted", aliases: ["fta"] },

        // Rebounds
        { code: "REB", name: "Rebounds", aliases: ["reb", "rebs", "rebound", "rebounds"], isPrimary: true },
        { code: "OREB", name: "Offensive Rebounds", aliases: ["oreb", "or"] },
        { code: "DREB", name: "Defensive Rebounds", aliases: ["dreb", "dr"] },

        // Playmaking
        { code: "AST", name: "Assists", aliases: ["ast", "assist", "assists", "a"], isPrimary: true },
        { code: "TO", name: "Turnovers", aliases: ["to", "tov", "turnover", "turnovers"] },

        // Defense
        { code: "STL", name: "Steals", aliases: ["stl", "steal", "steals"], isPrimary: true },
        { code: "BLK", name: "Blocks", aliases: ["blk", "block", "blocks"], isPrimary: true },

        // Misc
        { code: "MIN", name: "Minutes", aliases: ["min", "mins", "minutes"] },
        { code: "PF", name: "Personal Fouls", aliases: ["pf", "foul", "fouls"] },
        { code: "+/-", name: "Plus/Minus", aliases: ["+/-", "plusminus", "pm"] },
    ],

    periods: {
        pattern: /Q[1-4]|OT\d?/i,
        labels: ["Q1", "Q2", "Q3", "Q4", "OT"],
        hasClock: true,
        timePattern: /\d{1,2}:\d{2}/,
    },

    scoring: {
        pattern: /\d+-\d+/,
        separator: "-",
    },

    fpsPattern: /(\d+(?:\.\d+)?)\s*fps/i,

    primaryStats: ["PTS", "REB", "AST", "STL", "BLK", "3PM"],
};

export default nbaConfig;
