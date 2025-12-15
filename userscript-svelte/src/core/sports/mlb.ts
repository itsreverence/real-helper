/**
 * MLB (Major League Baseball) sport configuration
 */
import type { SportConfig } from "./types";

export const mlbConfig: SportConfig = {
    code: "MLB",
    name: "Major League Baseball",

    stats: [
        // Hitting
        { code: "H", name: "Hits", aliases: ["h", "hit", "hits"], isPrimary: true },
        { code: "HR", name: "Home Runs", aliases: ["hr", "hrs", "homer", "homers", "home run"], isPrimary: true },
        { code: "RBI", name: "Runs Batted In", aliases: ["rbi", "rbis"], isPrimary: true },
        { code: "R", name: "Runs", aliases: ["r", "run", "runs"], isPrimary: true },
        { code: "SB", name: "Stolen Bases", aliases: ["sb", "stolen", "steal", "steals"] },
        { code: "BB", name: "Walks", aliases: ["bb", "walk", "walks"] },
        { code: "K", name: "Strikeouts", aliases: ["k", "so", "strikeout", "strikeouts"] },
        { code: "AB", name: "At Bats", aliases: ["ab", "at bat", "at bats"] },
        { code: "2B", name: "Doubles", aliases: ["2b", "double", "doubles"] },
        { code: "3B", name: "Triples", aliases: ["3b", "triple", "triples"] },
        { code: "AVG", name: "Batting Average", aliases: ["avg", "average"] },

        // Pitching
        { code: "IP", name: "Innings Pitched", aliases: ["ip", "innings"] },
        { code: "ER", name: "Earned Runs", aliases: ["er", "earned run", "earned runs"] },
        { code: "W", name: "Wins", aliases: ["w", "win", "wins"] },
        { code: "L", name: "Losses", aliases: ["l", "loss", "losses"] },
        { code: "SV", name: "Saves", aliases: ["sv", "save", "saves"] },
        { code: "ERA", name: "Earned Run Average", aliases: ["era"] },
        { code: "WHIP", name: "Walks+Hits per IP", aliases: ["whip"] },
        { code: "QS", name: "Quality Starts", aliases: ["qs", "quality start"] },
    ],

    periods: {
        // Innings don't have a standard abbreviation like periods/quarters
        pattern: /(?:Top|Bot|T|B)\s*\d+|Inning\s*\d+|\d+(?:st|nd|rd|th)/i,
        labels: ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "Extra"],
        hasClock: false, // Baseball has no game clock
    },

    scoring: {
        pattern: /\d+-\d+/,
        separator: "-",
    },

    fpsPattern: /(\d+(?:\.\d+)?)\s*fps/i,

    primaryStats: ["H", "HR", "RBI", "R", "SB"],
};

export default mlbConfig;
