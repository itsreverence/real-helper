import { qsa, textOf } from "../dom/dom";
import {
  ACCENT_CACHE_KEY,
  BOOST_LINE_RE,
  MODAL_ANCHORS,
  MULT_TOKEN_RE,
  SPORTS,
} from "../constants";
import { getDebugMode } from "../state/storage";
import type { Payload, Slot, PlayerPoolItem, SportInfo } from "../types";

type RGB = { r: number; g: number; b: number };

function parseRgb(color: string | null | undefined): RGB | null {
  const s = String(color || "");
  const m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!m) return null;
  return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
}

function luminance(rgb: RGB) {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

function colorDistance(a: RGB, b: RGB) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function saturation(rgb: RGB) {
  const mx = Math.max(rgb.r, rgb.g, rgb.b);
  const mn = Math.min(rgb.r, rgb.g, rgb.b);
  return (mx - mn) / 255;
}

function isTransparent(colorStr: string | null | undefined) {
  const s = String(colorStr || "").toLowerCase();
  return s === "transparent" || (s.includes("rgba(") && s.endsWith(", 0)")) || s.includes(",0)");
}

function findLeftSidebarNavRoot(): Element | null {
  const minH = Math.max(240, window.innerHeight * 0.6);
  const candidates = qsa<Element>("div,nav,aside")
    .map(el => {
      try {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.width > 95) return null;
        if (r.height < minH) return null;
        if (r.left > 40) return null;
        if (r.top > 80) return null;
        return { el, area: r.width * r.height };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { el: Element; area: number }[];
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.area - a.area);
  return candidates[0].el;
}

function detectThemeAccentColor(): { rgb: RGB; source: string; scope: string } | null {
  function readCachedAccent(): RGB | null {
    try {
      const raw = localStorage.getItem(ACCENT_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.r !== "number" || typeof obj.g !== "number" || typeof obj.b !== "number") return null;
      return { r: obj.r, g: obj.g, b: obj.b };
    } catch {
      return null;
    }
  }

  function writeCachedAccent(rgb: RGB) {
    try {
      localStorage.setItem(ACCENT_CACHE_KEY, JSON.stringify(rgb));
    } catch {
      // ignore
    }
  }

  const scopeRoot = findLeftSidebarNavRoot() || document;
  const scopeRect = scopeRoot === document ? null : (() => {
    try {
      const r = (scopeRoot as Element).getBoundingClientRect();
      return { top: r.top, height: r.height };
    } catch {
      return null;
    }
  })();

  const candidates = qsa<Element>("div,button,a,span", scopeRoot as ParentNode)
    .map(el => {
      try {
        const r = el.getBoundingClientRect();
        if (r.width < 16 || r.width > 80 || r.height < 16 || r.height > 80) return null;
        if (r.width / r.height < 0.7 || r.width / r.height > 1.3) return null;

        const cs = getComputedStyle(el);
        const bw = parseFloat(cs.borderWidth || "0");
        const ow = parseFloat(cs.outlineWidth || "0");
        if ((Number.isNaN(bw) || bw <= 0) && (Number.isNaN(ow) || ow <= 0)) return null;

        const rgb = parseRgb(cs.borderColor) || parseRgb(cs.outlineColor);
        if (!rgb) return null;
        const sat = saturation(rgb);
        if (sat < 0.1) return null;

        let posBoost = 1.0;
        if (scopeRect) {
          const y = (r.top - scopeRect.top) / Math.max(1, scopeRect.height);
          posBoost = (y > 0.4) ? 1.4 : 0.8;
        }

        const sizeBoost = (Math.min(r.width, r.height) >= 20) ? 1.1 : 1.0;
        const score = (sat * 3.0 + (bw >= 2 ? 0.2 : 0)) * posBoost * sizeBoost;
        return { rgb, score };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { rgb: RGB; score: number }[];

  if (candidates.length === 0) {
    const cached = readCachedAccent();
    return cached ? { rgb: cached, source: "cache", scope: scopeRoot === document ? "document" : "sidebar" } : null;
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  writeCachedAccent(top.rgb);
  return { rgb: top.rgb, source: "borderColor", scope: scopeRoot === document ? "document" : "sidebar" };
}

export function detectAccentCss(): string | null {
  try {
    const accent = detectThemeAccentColor();
    if (!accent?.rgb) return null;
    const { r, g, b } = accent.rgb;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null;
  }
}

export function detectSportFromNavbar(): SportInfo {
  const candidates = qsa<Element>("div,nav,header").filter(el => {
    const t = textOf(el);
    if (!t) return false;
    const hits = SPORTS.filter(s => t.includes(s)).length;
    return hits >= 4;
  });
  const nav = candidates[0] || null;
  if (!nav) return { sport: null, method: "not_found" };

  const available = SPORTS.filter(s => textOf(nav).includes(s));
  const sportEls = qsa<Element>("a,button,[role='tab'],[role='button'],div,span", nav)
    .map(el => ({ el, t: textOf(el) }))
    .filter(x => available.includes(x.t as any));

  function isActive(el: Element) {
    const aSel = el.getAttribute("aria-selected");
    const aCur = el.getAttribute("aria-current");
    if (aSel === "true") return true;
    if (aCur && aCur !== "false") return true;
    if (el.getAttribute("data-active") === "true") return true;
    if (el.getAttribute("data-state") === "active") return true;
    const cls = (el.className || "").toString().toLowerCase();
    if (cls.includes("active") || cls.includes("selected") || cls.includes("current")) return true;
    return false;
  }

  const active = sportEls.find(x => isActive(x.el));
  if (active) return { sport: String(active.t), method: "navbar_active_attr" };

  const accent = detectThemeAccentColor();
  if (accent?.rgb && sportEls.length > 0) {
    const scoredByAccent = sportEls
      .map(x => {
        let best = Infinity;
        try {
          const cs = getComputedStyle(x.el);
          const c = parseRgb(cs.color);
          const bb = parseRgb(cs.borderBottomColor);
          const bc = parseRgb(cs.borderColor);
          if (c) best = Math.min(best, colorDistance(accent.rgb, c));
          if (bb && !isTransparent(cs.borderBottomColor)) best = Math.min(best, colorDistance(accent.rgb, bb));
          if (bc && !isTransparent(cs.borderColor)) best = Math.min(best, colorDistance(accent.rgb, bc));
        } catch {
          // ignore
        }
        return { sport: String(x.t), dist: best };
      })
      .sort((a, b) => a.dist - b.dist);
    if (scoredByAccent.length > 0 && scoredByAccent[0].dist < 60) {
      return { sport: scoredByAccent[0].sport, method: "navbar_theme_accent", accent };
    }
  }

  if (sportEls.length > 0) {
    const scored = sportEls
      .map(x => {
        let score = 0;
        try {
          const cs = getComputedStyle(x.el);
          const fw = parseInt(cs.fontWeight, 10);
          if (!Number.isNaN(fw) && fw >= 600) score += 2;
          const op = parseFloat(cs.opacity);
          if (!Number.isNaN(op) && op >= 0.95) score += 1;
          if ((cs.textDecorationLine || "").includes("underline")) score += 2;
          const bbw = parseFloat(cs.borderBottomWidth);
          if (!Number.isNaN(bbw) && bbw > 0 && (cs.borderBottomStyle || "") !== "none") score += 2;
          const rgb = parseRgb(cs.color);
          if (rgb) score += luminance(rgb);
        } catch {
          // ignore
        }
        return { sport: String(x.t), score };
      })
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1) return { sport: scored[0].sport, method: "navbar_style_single" };
    if (scored.length >= 2 && (scored[0].score - scored[1].score) >= 1.0) {
      return { sport: scored[0].sport, method: "navbar_style_score" };
    }
  }

  const href = location.href.toUpperCase();
  const fromUrl = available.find(s => href.includes("/" + s + "/") || href.endsWith("/" + s) || href.includes("SPORT=" + s));
  if (fromUrl) return { sport: String(fromUrl), method: "url_hint" };

  return { sport: null, method: "navbar_no_active" };
}

export function findModalRoot(): Element | null {
  // If our injected action bar exists, use it to locate the modal reliably.
  const injected = document.querySelector("#rsdh-modal-actions") as HTMLElement | null;
  if (injected) {
    let cur: Element | null = injected;
    // Walk up to find a container that looks like the draft modal (contains several multipliers)
    for (let i = 0; i < 18 && cur; i++) {
      const t = textOf(cur);
      const multCount = (t.match(/\d+(?:\.\d+)?x\b/gi) || []).length;
      if (multCount >= 3) return cur;
      cur = cur.parentElement;
    }
    return injected.parentElement;
  }

  const candidates = qsa<Element>('div[tabindex="0"]');
  for (const el of candidates) {
    const t = textOf(el);
    if (!t) continue;
    const hasAnchor = /(Select\s+\d+\s+players|Press\s+two\s+players?|to\s+swap)/i.test(t);
    const multCount = (t.match(/\d+(?:\.\d+)?x\b/gi) || []).length;
    if (hasAnchor && multCount >= 3) return el;
  }
  for (const el of candidates) {
    const t = textOf(el);
    if (t && /(Select\s+\d+\s+players|Press\s+two\s+players?|to\s+swap)/i.test(t)) return el;
  }
  return null;
}

function sliceBeforeStop(text: string, stopPhrases: string[] = []) {
  let cut = -1;
  for (const s of stopPhrases) {
    const i = text.indexOf(s);
    if (i !== -1 && (cut === -1 || i < cut)) cut = i;
  }
  return cut === -1 ? text : text.slice(0, cut);
}

function sliceAfterFirstStop(text: string, stopPhrases: string[] = []) {
  let cut = -1;
  for (const s of stopPhrases) {
    const i = text.indexOf(s);
    if (i !== -1 && (cut === -1 || i < cut)) cut = i;
  }
  if (cut === -1) return "";
  const nl = text.indexOf("\n", cut);
  return nl === -1 ? "" : text.slice(nl + 1);
}

export function parseSlotsFromText(text: string, stopPhrases: string[] = [], maxSlots: number | null = null): Slot[] {
  text = sliceBeforeStop(text, stopPhrases);

  const matches: { idx: number; end: number; mult: number }[] = [];
  MULT_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MULT_TOKEN_RE.exec(text)) !== null) {
    if (m.index > 0 && text[m.index - 1] === "+") continue;
    matches.push({ idx: m.index, end: m.index + m[0].length, mult: parseFloat(m[1]) });
  }

  const slots: Slot[] = [];
  for (let i = 0; i < matches.length; i++) {
    if (typeof maxSlots === "number" && slots.length >= maxSlots) break;
    const cur = matches[i];
    const next = matches[i + 1];
    let chunk = text.slice(cur.end, next ? next.idx : text.length).trim();
    for (const a of stopPhrases) {
      const p = chunk.indexOf(a);
      if (p !== -1) chunk = chunk.slice(0, p).trim();
    }
    chunk = chunk.split("\n")[0].trim();
    if (chunk.length > 80) chunk = chunk.slice(0, 80).trim();

    let selection: string | null = chunk || null;
    let isEmpty = false;
    if (selection && selection.toLowerCase() === "empty") {
      selection = null;
      isEmpty = true;
    }
    slots.push({ multiplier: cur.mult, selection, is_empty: isEmpty });
  }
  return slots;
}

export function parsePlayerPoolFromModalText(modalText: string): PlayerPoolItem[] {
  const after = sliceAfterFirstStop(modalText, ["Press two player", "Press two players"]);
  if (!after) return [];

  const lines = after
    .split("\n")
    .map(s => (s || "").trim())
    .filter(Boolean);

  const pool: PlayerPoolItem[] = [];
  let pending: PlayerPoolItem | null = null;

  function flushPending() {
    if (!pending) return;
    if (pending.name && !/%$/.test(pending.name.trim())) pool.push(pending);
    pending = null;
  }

  for (const line of lines) {
    if (/^(submit|update|cancel|close|done)$/i.test(line)) {
      flushPending();
      break;
    }
    if (/^(draft lineup)$/i.test(line)) continue;
    if (/^\d+%$/.test(line)) continue;

    const boostMatch = line.match(BOOST_LINE_RE);
    if (boostMatch) {
      const boost = parseFloat(boostMatch[1]);
      if (pending) pending.boost_x = boost;
      else if (pool.length > 0 && pool[pool.length - 1].boost_x == null) pool[pool.length - 1].boost_x = boost;
      if (pending) flushPending();
      continue;
    }

    const parts = line.split("·").map(s => s.trim()).filter(Boolean);
    const name = parts[0] || line;
    const status = parts.length > 1 ? parts.slice(1).join(" · ") : null;
    if (pending) flushPending();
    pending = { name, status, boost_x: null };
  }

  flushPending();
  return pool;
}

function parsePlayerPoolFromModalDom(modal: Element): PlayerPoolItem[] {
  // Heuristic: player rows tend to be tabbable and contain a boost like "+0.9x"
  const boostTokenRe = /\+(\d+(?:\.\d+)?)x\b/i;
  const candidates = qsa<HTMLElement>("div[tabindex='0'],[role='button'],button,a", modal)
    .filter(el => {
      const t = textOf(el);
      if (!t) return false;
      if (!boostTokenRe.test(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 120 && r.height >= 28;
    })
    .slice(0, 400);

  const seen = new Set<string>();
  const pool: PlayerPoolItem[] = [];

  for (const el of candidates) {
    const t = textOf(el);
    const bm = t.match(boostTokenRe);
    if (!bm) continue;
    const boost_x = parseFloat(bm[1]);
    if (!Number.isFinite(boost_x)) continue;

    const beforeBoost = t.slice(0, t.toLowerCase().lastIndexOf(bm[0].toLowerCase())).trim();
    const parts = beforeBoost.split("·").map(s => s.trim()).filter(Boolean);
    const name = parts[0] || "";
    if (!name) continue;
    const status = parts.length > 1 ? parts.slice(1).join(" · ") : null;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    // Try to find a profile link near the row (icon on the right is often an <a> or a button containing an <svg>)
    let href: string | null = null;
    const link =
      (el.querySelector("a[href]") as HTMLAnchorElement | null) ||
      (el.parentElement?.querySelector("a[href]") as HTMLAnchorElement | null) ||
      (el.closest("a[href]") as HTMLAnchorElement | null);
    if (link?.getAttribute("href")) href = link.getAttribute("href");
    if (!href) {
      const svg = el.querySelector("svg") || el.parentElement?.querySelector("svg");
      const svgLink = svg ? (svg.closest("a[href]") as HTMLAnchorElement | null) : null;
      if (svgLink?.getAttribute("href")) href = svgLink.getAttribute("href");
    }
    const profile_url = href ? new URL(href, location.href).toString() : null;

    pool.push({ name, status, boost_x, profile_url });
    seen.add(key);
  }

  return pool;
}

function findDraftTiles(): Element[] {
  const candidates = qsa<Element>("div,button").filter(el => {
    const t = textOf(el);
    return t.includes("Draft") && /\bUpdate\b/i.test(t) && /\bx\b/i.test(t);
  });
  const seen = new Set<string>();
  const tiles: Element[] = [];
  for (const el of candidates) {
    const t = textOf(el);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tiles.push(el);
  }
  return tiles.slice(0, 10);
}

export function clickFirstDraftOrUpdateButton(): boolean {
  function humanActivate(el: HTMLElement) {
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch { /* ignore */ }
    try { el.focus(); } catch { /* ignore */ }
    let cx = 0;
    let cy = 0;
    try {
      const r = el.getBoundingClientRect();
      cx = Math.max(1, Math.floor(r.left + r.width / 2));
      cy = Math.max(1, Math.floor(r.top + r.height / 2));
    } catch { /* ignore */ }

    // Pointer events (preferred in many React Native Web style UIs)
    try {
      const PE = (window as any).PointerEvent;
      if (typeof PE === "function") {
        el.dispatchEvent(new PE("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse", buttons: 1, clientX: cx, clientY: cy }));
        el.dispatchEvent(new PE("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse", buttons: 1, clientX: cx, clientY: cy }));
      }
    } catch { /* ignore */ }

    // Mouse events (fallback)
    try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, buttons: 1, clientX: cx, clientY: cy })); } catch { /* ignore */ }
    try { el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, buttons: 1, clientX: cx, clientY: cy })); } catch { /* ignore */ }
    try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, buttons: 1, clientX: cx, clientY: cy })); } catch { /* ignore */ }

    // Some components only respond to keyboard activation.
    try { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); } catch { /* ignore */ }
    try { el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true })); } catch { /* ignore */ }

    // Last resort
    try { el.click(); } catch { /* ignore */ }
  }

  const homeRoot = (document.querySelector("#realrootcontents") || document) as ParentNode;

  // Look for small, button-like elements whose text is exactly "Draft" or "Update"
  const candidates = qsa<HTMLElement>("div[tabindex='0'],button,[role='button'],a,span", homeRoot)
    .map(el => {
      const t = textOf(el);
      if (!t) return null;
      // Must be exactly "Draft" or "Update" (not a card containing other text)
      if (!/^(draft|update)$/i.test(t.trim())) return null;
      const r = el.getBoundingClientRect();
      // Button-sized: wide enough to be clickable, but not a huge card
      if (!(r.width >= 60 && r.width <= 500 && r.height >= 20 && r.height <= 80)) return null;
      // Prefer wider buttons and those in viewport
      const inViewportBoost = (r.top >= 0 && r.top <= window.innerHeight) ? 1.5 : 1.0;
      const score = r.width * inViewportBoost;
      return { el, score, text: t.trim() };
    })
    .filter(Boolean) as { el: HTMLElement; score: number; text: string }[];

  if (candidates.length === 0) return false;
  candidates.sort((a, b) => b.score - a.score);
  humanActivate(candidates[0].el);
  return true;
}

// NOTE: Kept for debugging/manual usage, but tool flow no longer relies on synthetic clicks
// to reopen the draft modal (some sites reject untrusted events).
export async function openDraftModalFromHome(opts?: { timeoutMs?: number }): Promise<{ clicked: boolean; opened: boolean }> {
  const timeoutMs = typeof opts?.timeoutMs === "number" ? opts!.timeoutMs : 9000;
  const start = Date.now();

  function hasOpened() {
    // Our injected bar is a strong signal the draft modal is open.
    if (document.querySelector("#rsdh-modal-actions")) return true;
    return !!findModalRoot();
  }

  function bestCandidate(): HTMLElement | null {
    const homeRoot = (document.querySelector("#realrootcontents") || document) as ParentNode;
    // Look for small, button-like elements whose text is exactly "Draft" or "Update"
    const candidates = qsa<HTMLElement>("div[tabindex='0'],button,[role='button'],a,span", homeRoot)
      .map(el => {
        const t = textOf(el);
        if (!t) return null;
        // Must be exactly "Draft" or "Update" (not a card containing other text)
        if (!/^(draft|update)$/i.test(t.trim())) return null;
        const r = el.getBoundingClientRect();
        // Button-sized: wide enough to be clickable, but not a huge card
        if (!(r.width >= 60 && r.width <= 500 && r.height >= 20 && r.height <= 80)) return null;
        return { el, width: r.width };
      })
      .filter(Boolean) as { el: HTMLElement; width: number }[];
    if (candidates.length === 0) return null;
    // Prefer wider buttons
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0].el;
  }

  function isTopMost(el: HTMLElement) {
    try {
      const r = el.getBoundingClientRect();
      const x = Math.floor(r.left + r.width / 2);
      const y = Math.floor(r.top + r.height / 2);
      const top = document.elementFromPoint(x, y);
      return top === el || (!!top && el.contains(top));
    } catch {
      return true;
    }
  }

  // Wait until we're on a "home-ish" page where the Draft/Update tile exists.
  while (Date.now() - start < timeoutMs) {
    if (hasOpened()) return { clicked: false, opened: true };
    const el = bestCandidate();
    if (el && isTopMost(el)) break;
    await new Promise(r => setTimeout(r, 200));
  }

  let clicked = false;

  // Try up to 3 attempts: element, then a parent wrapper, then element again (in case of rerender).
  for (let attempt = 0; attempt < 3 && Date.now() - start < timeoutMs; attempt++) {
    if (hasOpened()) return { clicked, opened: true };

    const el = bestCandidate();
    if (!el) {
      await new Promise(r => setTimeout(r, 250));
      continue;
    }

    // Attempt 1: click the element itself.
    try {
      clicked = clickFirstDraftOrUpdateButton() || clicked;
    } catch {
      // ignore
    }

    // If still not opened, try clicking a parent wrapper (some UIs attach handlers above the text node).
    if (!hasOpened()) {
      const parent = el.parentElement as HTMLElement | null;
      if (parent) {
        try { parent.scrollIntoView({ block: "center" }); } catch { /* ignore */ }
        try { parent.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } catch { /* ignore */ }
      }
    }

    // Give SPA time to open modal + our injection to run.
    const opened = await new Promise<boolean>(resolve => {
      const endAt = Date.now() + 2200;
      const tick = () => {
        if (hasOpened()) return resolve(true);
        if (Date.now() > endAt) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });

    if (opened) return { clicked, opened: true };
    await new Promise(r => setTimeout(r, 350));
  }

  return { clicked, opened: hasOpened() };
}

function parseDraftTile(tileEl: Element) {
  const t = textOf(tileEl);
  const stop = ["Update", ...MODAL_ANCHORS];
  const slots = parseSlotsFromText(t, stop);
  return { text: t.slice(0, 500), slots };
}

export function buildPayload(opts: { includeDebug?: boolean } = {}): Payload {
  const includeDebug = typeof opts.includeDebug === "boolean" ? opts.includeDebug : getDebugMode();
  const sportInfo = detectSportFromNavbar();
  const modal = findModalRoot();
  if (!modal) {
    const tiles = findDraftTiles().map(parseDraftTile).filter(x => x.slots.length > 0);
    if (tiles.length === 0) {
      return {
        ok: false,
        error: "Draft modal not found. Click the site's Draft/Update button to open the Draft Lineup modal, then click Capture again.",
        url: location.href,
        sport: sportInfo.sport,
        sport_detection_method: sportInfo.method,
        ...(includeDebug ? { sport_detection: sportInfo } : {}),
      } as Payload;
    }
    return {
      ok: true,
      mode: "tile",
      url: location.href,
      captured_at: new Date().toISOString(),
      sport: sportInfo.sport,
      sport_detection_method: sportInfo.method,
      ...(includeDebug ? { sport_detection: sportInfo } : {}),
      drafts: tiles,
    } as Payload;
  }

  const modalText = textOf(modal);
  const expectedMatch = modalText.match(/Select\s+(\d+)\s+players/i);
  const expectedSlots = expectedMatch ? parseInt(expectedMatch[1], 10) : null;
  const stopPhrases = ["Press two player", "Press two players"];
  const slots = parseSlotsFromText(modalText, stopPhrases, expectedSlots);
  const domPool = parsePlayerPoolFromModalDom(modal);
  const player_pool = domPool.length > 0 ? domPool : parsePlayerPoolFromModalText(modalText);

  return {
    ok: true,
    mode: "modal",
    url: location.href,
    captured_at: new Date().toISOString(),
    sport: sportInfo.sport,
    sport_detection_method: sportInfo.method,
    ...(includeDebug ? { sport_detection: sportInfo } : {}),
    ...(includeDebug ? { modal_text_sample: modalText.slice(0, 400) } : {}),
    expected_slots: expectedSlots,
    slots,
    player_pool_count: player_pool.length,
    player_pool,
  } as Payload;
}



