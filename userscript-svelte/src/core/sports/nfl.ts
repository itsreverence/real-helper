/**
 * NFL (National Football League) sport configuration
 */
import type { SportConfig } from "./types";

export const nflConfig: SportConfig = {
    code: "NFL",
    name: "National Football League",

    stats: [
        // Passing
        { code: "PASS_YD", name: "Passing Yards", aliases: ["pass yd", "pass yds", "passing", "pass"], isPrimary: true },
        { code: "PASS_TD", name: "Passing Touchdowns", aliases: ["pass td", "pass tds", "ptd"] },
        { code: "INT", name: "Interceptions Thrown", aliases: ["int", "ints", "interception"] },
        { code: "CMP", name: "Completions", aliases: ["cmp", "comp", "completions"] },
        { code: "ATT", name: "Pass Attempts", aliases: ["att", "attempts"] },

        // Rushing
        { code: "RUSH_YD", name: "Rushing Yards", aliases: ["rush yd", "rush yds", "rushing", "rush"], isPrimary: true },
        { code: "RUSH_TD", name: "Rushing Touchdowns", aliases: ["rush td", "rush tds", "rtd"] },
        { code: "CAR", name: "Carries", aliases: ["car", "carry", "carries"] },

        // Receiving
        { code: "REC", name: "Receptions", aliases: ["rec", "recs", "reception", "receptions"], isPrimary: true },
        { code: "REC_YD", name: "Receiving Yards", aliases: ["rec yd", "rec yds", "receiving"] },
        { code: "REC_TD", name: "Receiving Touchdowns", aliases: ["rec td", "rec tds"] },
        { code: "TGT", name: "Targets", aliases: ["tgt", "target", "targets"] },

        // General
        { code: "TD", name: "Touchdowns", aliases: ["td", "tds", "touchdown", "touchdowns"], isPrimary: true },
        { code: "YD", name: "Total Yards", aliases: ["yd", "yds", "yards"] },

        // Kicking
        { code: "FG", name: "Field Goals", aliases: ["fg", "fgs", "field goal"] },
        { code: "XP", name: "Extra Points", aliases: ["xp", "pat", "extra point"] },

        // Defense
        { code: "SACK", name: "Sacks", aliases: ["sack", "sacks", "sk"] },
        { code: "TKL", name: "Tackles", aliases: ["tkl", "tackle", "tackles"] },
        { code: "FF", name: "Forced Fumbles", aliases: ["ff", "forced fumble"] },
        { code: "FR", name: "Fumble Recoveries", aliases: ["fr", "fumble recovery"] },
        { code: "DEF_INT", name: "Defensive Interceptions", aliases: ["def int", "pick"] },
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

    primaryStats: ["PASS_YD", "RUSH_YD", "REC", "TD"],
};

export default nflConfig;
