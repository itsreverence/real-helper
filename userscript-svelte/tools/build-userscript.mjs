import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const distBundle = path.join(projectRoot, "dist", "bundle.js");
const outFile = path.join(projectRoot, "script", "realsports-draft-helper.user.js");

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = String(pkg.version || "0.0.0");

// Configure these for auto-updates.
// Defaults match the previous handwritten userscript header; override with env vars if needed.
const repo = process.env.RSDH_GITHUB_REPO || "itsreverence/real-helper";
const branch = process.env.RSDH_GITHUB_BRANCH || "main";
const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`;
const filePath = "userscript-svelte/script/realsports-draft-helper.user.js";
const downloadUrl = `${rawBase}/${filePath}`;
const updateUrl = `${rawBase}/${filePath}`;
const homepageUrl = process.env.RSDH_HOMEPAGE_URL || `https://github.com/${repo}`;
const supportUrl = process.env.RSDH_SUPPORT_URL || `https://github.com/${repo}/issues`;

if (!fs.existsSync(distBundle)) {
  console.error("Missing dist/bundle.js. Run `npm run build` first.");
  process.exit(1);
}

const bundle = fs.readFileSync(distBundle, "utf8");

const header = `// ==UserScript==
// @name         RealSports Draft Helper
// @namespace    local.realsports.drafthelper
// @version      ${version}
// @description  RealSports Draft Helper (Svelte + TypeScript)
// @homepageURL  ${homepageUrl}
// @supportURL   ${supportUrl}
// @downloadURL  ${downloadUrl}
// @updateURL    ${updateUrl}
// @match        https://realsports.io/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      openrouter.ai
// @connect      realsports.io
// ==/UserScript==

`;

fs.writeFileSync(outFile, header + bundle, "utf8");
console.log(`Wrote userscript: ${outFile}`);


