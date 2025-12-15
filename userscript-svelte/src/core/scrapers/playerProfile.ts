import { textOf } from "../dom/dom";
import { findModalRoot, openDraftModalFromHome } from "./capture";
import { emitDebugEvent } from "../ui/debugBus";
import { getDebugMode } from "../state/storage";
import { getSportConfig } from "../sports";
import { highlightElement, removeHighlight, removeAllHighlights, waitFor, humanActivate } from "../dom/dom-helpers";
import { findFeedPlaysToggle, toggleToFeedView, tryFindTopNav, clickBackButtonInNav } from "../dom/navigation";

function normName(s: string) {
  return (s || "").trim().toLowerCase();
}

function splitRowName(text: string): { name: string; rest: string } {
  const t = (text || "").trim();
  const parts = t.split("·").map(x => x.trim()).filter(Boolean);
  const name = parts[0] || t;
  const rest = parts.slice(1).join(" · ");
  return { name, rest };
}

function findPlayerRowEl(modal: Element, playerName: string): HTMLElement | null {
  const target = normName(playerName);
  if (!target) return null;
  const boostTokenRe = /\+(\d+(?:\.\d+)?)x\b/i;
  const candidates = Array.from(modal.querySelectorAll<HTMLElement>("div[tabindex='0'],[role='button'],button"))
    .map(el => {
      const full = textOf(el);
      if (!full) return null;
      if (!boostTokenRe.test(full)) return null;
      const { name } = splitRowName(full);
      const r = el.getBoundingClientRect();
      if (r.width <= 140 || r.height < 28) return null;
      const score =
        (normName(name) === target ? 1000 : (normName(name).includes(target) ? 100 : 0)) +
        Math.min(200, Math.round(r.width));
      if (score <= 0) return null;
      return { el, score, rect: r, name };
    })
    .filter(Boolean) as { el: HTMLElement; score: number; rect: DOMRect; name: string }[];
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].el;
}

function findProfileIconButton(rowEl: HTMLElement): HTMLElement | null {
  const scope = rowEl as HTMLElement;
  const clickables = Array.from(scope.querySelectorAll<HTMLElement>("a[href],a,button,div[tabindex='0'],[role='button']"));
  const withSvg = clickables.filter(el => !!el.querySelector("svg"));

  const small = withSvg
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(x => x.r.width > 8 && x.r.width <= 28 && x.r.height > 8 && x.r.height <= 28);

  if (small.length === 0) return null;
  small.sort((a, b) => b.r.left - a.r.left);
  const best = small[0].el;
  const anchor =
    (best instanceof HTMLAnchorElement ? best : null) ||
    (best.querySelector("a[href]") as HTMLAnchorElement | null) ||
    (best.closest("a[href]") as HTMLAnchorElement | null);
  return anchor || best;
}

export async function discoverProfileUrlViaClick(playerName: string): Promise<string | null> {
  const modal = findModalRoot();
  if (!modal) {
    emitDebugEvent("warn", "No modal found for profile URL discovery", { scope: "profile" });
    return null;
  }

  emitDebugEvent("step", `Finding player row: ${playerName}`, { scope: "profile" });
  const rowEl = findPlayerRowEl(modal as Element, playerName);
  if (!rowEl) {
    emitDebugEvent("warn", "Player row not found", { scope: "profile" });
    return null;
  }

  const iconBtn = findProfileIconButton(rowEl);
  if (!iconBtn) {
    emitDebugEvent("warn", "Profile icon button not found", { scope: "profile" });
    return null;
  }

  // If it's an <a href>, just read the URL directly
  const asAnchor = iconBtn instanceof HTMLAnchorElement ? iconBtn : (iconBtn.closest("a[href]") as HTMLAnchorElement | null);
  if (asAnchor?.getAttribute("href")) {
    const url = new URL(String(asAnchor.getAttribute("href")), location.href).toString();
    emitDebugEvent("info", "Got profile URL from href", { scope: "profile", data: { url } });
    return url;
  }

  // No href - return a special marker so we know to click the icon during navigation
  emitDebugEvent("info", "No href on icon, will click to navigate", { scope: "profile" });
  return "__CLICK_TO_NAVIGATE__";
}

// Extractors for profile page content
function extractProfileHeaderText(doc: Document): string | null {
  const root = (doc.querySelector("#realrootcontents") || doc.querySelector("#realweb") || doc.body) as Element;
  const els = Array.from(root.querySelectorAll<HTMLElement>("div,section,header,article")).slice(0, 2000);

  const candidates = els
    .map(el => {
      const t = (textOf(el) || "").replace(/\s+/g, " ").trim();
      if (!t) return null;
      if (t.length < 40 || t.length > 320) return null;
      const u = t.toUpperCase();
      let score = 0;
      if (u.includes("7-DAY")) score += 4;
      if (u.includes("30-DAY")) score += 4;
      if (u.includes("SEASON")) score += 3;
      if (u.includes("CARD")) score += 2;
      if (t.includes("·")) score += 2;
      if (/#\d+/.test(t)) score += 1;
      if (/\b\d+(st|nd|rd|th)\b/i.test(t)) score += 2;
      if (score < 6) return null;
      return { t, score };
    })
    .filter(Boolean) as { t: string; score: number }[];

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].t;
}

function parseProfileHeaderText(headerText: string): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {};
  const rankMatch = headerText.match(/(\d+)(st|nd|rd|th)\s*(7-DAY|30-DAY|SEASON)?/gi);
  if (rankMatch) {
    for (const m of rankMatch) {
      const parts = m.match(/(\d+)(st|nd|rd|th)\s*(7-DAY|30-DAY|SEASON)?/i);
      if (parts) {
        const rank = parseInt(parts[1], 10);
        const period = parts[3] || "overall";
        result[`rank_${period.toLowerCase().replace("-", "_")}`] = rank;
      }
    }
  }
  const teamMatch = headerText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*·\s*([A-Z]+)\s*·\s*#(\d+)/);
  if (teamMatch) {
    result.team = teamMatch[1];
    result.position = teamMatch[2];
    result.number = parseInt(teamMatch[3], 10);
  }
  return result;
}

function parseSeasonSummaryBlockFromText(rawText: string): { entries: { stat: string; value: string; rank: number | null }[] } | null {
  // Normalize whitespace
  const normalizedText = rawText.replace(/\s+/g, " ");

  // Look for pattern like "PTS 21 104th GOAL 11 53rd AST 10 167th..."
  // Handle various stat formats including FO%, +/-, TOI with time format, etc.
  const statRe = /([A-Z]+(?:%|±|\+\/-)?)\s+(-?\d+(?:\.\d+)?(?::\d+)?)\s+(\d+)(?:st|nd|rd|th)\b/gi;
  const entries: { stat: string; value: string; rank: number | null }[] = [];
  let m: RegExpExecArray | null;
  while ((m = statRe.exec(normalizedText)) !== null) {
    entries.push({
      stat: m[1],
      value: m[2],
      rank: parseInt(m[3], 10),
    });
  }
  return entries.length > 0 ? { entries } : null;
}

function parseRecentPerformancesFromText(rawText: string): { entries: string[] } | null {
  // Normalize whitespace
  const normalizedText = rawText.replace(/\s+/g, " ");
  let entries: string[] = [];

  // Look for patterns like "A. Fantilli · 14.4 fps 2.7 1 ast 3 sog 2 hits 3 1 day ago vs OTT L"
  // Split by player initials pattern
  const fpsMatches = normalizedText.match(/[A-Z]\.\s*\w+\s*·\s*\d+(?:\.\d+)?\s*fps[^A-Z]*/gi);
  if (fpsMatches) {
    entries = fpsMatches
      .map(match => match.trim().slice(0, 200))
      .filter(e => e.length > 20) // Skip too-short matches
      .slice(0, 15);
  }

  // Also try newline-separated parsing as fallback
  if (entries.length === 0) {
    const lines = rawText.split(/\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/\d+(?:\.\d+)?\s*fps/i.test(line) || /\d+(?:\.\d+)?\s*@\s*[A-Z]{2,4}/i.test(line)) {
        entries.push(line.slice(0, 200));
        if (entries.length >= 15) break;
      }
    }
  }

  return entries.length > 0 ? { entries } : null;
}

function extractFeedEntriesFromText(rawText: string): { player: string; fps: number | null; multiplier: number | null; stats: string; date: string; opponent: string; result: string }[] {
  // Normalize whitespace
  const normalizedText = rawText.replace(/\s+/g, " ");
  const entries: { player: string; fps: number | null; multiplier: number | null; stats: string; date: string; opponent: string; result: string }[] = [];

  // Actual format from DOM: "M. Boldy · 8 fps 1.2 0 goal 3 sog 2 blks 3 15 7 hours ago vs OTT W"
  // Pattern: NAME · FPS fps [MULTIPLIER] STATS... TIME_AGO (vs|@) TEAM W/L

  // First, find all player blocks by matching "Name · N fps" pattern
  // Then extract the rest of the details from each block
  const blockPattern = /([A-Z]\.[\s]*[\w'-]+)\s*·\s*(\d+(?:\.\d+)?)\s*fps\s+([\d.]+)?/gi;

  let match: RegExpExecArray | null;
  const blocks: { player: string; fps: number; multiplier: number | null; startIdx: number; endIdx: number }[] = [];

  while ((match = blockPattern.exec(normalizedText)) !== null) {
    blocks.push({
      player: match[1].trim(),
      fps: parseFloat(match[2]),
      multiplier: match[3] ? parseFloat(match[3]) : null,
      startIdx: match.index,
      endIdx: match.index + match[0].length,
    });
    if (blocks.length >= 30) break;
  }

  // For each block, extract the content until the next block or end
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const nextBlockStart = blocks[i + 1]?.startIdx ?? normalizedText.length;
    const blockContent = normalizedText.slice(block.endIdx, nextBlockStart).trim();

    // Parse stats (format like "0 goal 3 sog 2 blks" or individual stat items)
    // Parse time (format like "7 hours ago", "1 day ago", "yesterday", "2 days ago")
    // Parse opponent (format like "vs OTT" or "@ DAL")
    // Parse result (W or L)

    const timeMatch = blockContent.match(/(\d+\s+(?:hours?|days?|weeks?|months?)\s+ago|yesterday|today)/i);
    const opponentMatch = blockContent.match(/(vs|@)\s*([A-Z]{2,4})\s*([WL])?/i);

    // Extract stats: everything before the time marker
    let statsText = blockContent;
    if (timeMatch) {
      statsText = blockContent.slice(0, timeMatch.index).trim();
    } else if (opponentMatch) {
      statsText = blockContent.slice(0, opponentMatch.index).trim();
    }

    // Clean up stats: remove trailing numbers that are reaction counts
    statsText = statsText.replace(/\s+\d+\s*$/, "").trim();

    entries.push({
      player: block.player,
      fps: block.fps,
      multiplier: block.multiplier,
      stats: statsText.slice(0, 100), // Limit length
      date: timeMatch?.[1] || "",
      opponent: opponentMatch?.[2] || "",
      result: opponentMatch?.[3] || "",
    });
  }

  return entries;
}

async function scrapeProfileFromCurrentDom(playerName: string, profileUrl: string, sport: string | null = null) {
  const sportConfig = getSportConfig(sport);
  emitDebugEvent("step", "Scraping profile from current DOM", { scope: "scrape" });

  const header_text = extractProfileHeaderText(document);
  const header_parsed = header_text ? parseProfileHeaderText(header_text) : null;

  const root = (document.querySelector("#realrootcontents") || document.querySelector("#realweb") || document.body) as Element;
  const initialRawText = textOf(root);

  const season_summary = parseSeasonSummaryBlockFromText(initialRawText);

  // Check which tab is currently active
  const { activeTab: initialTab } = findFeedPlaysToggle();
  emitDebugEvent("info", `Initial tab: ${initialTab || 'unknown'}`, { scope: "scrape" });

  let feed_entries: any[] = [];
  let recent_performances: any = null;

  // Most profiles start on Feed tab - if we have feed data, use it
  // If on Plays tab, switch to Feed (Feed data is more useful for draft decisions)
  if (initialTab === "plays") {
    // Switch to Feed tab
    emitDebugEvent("step", "Switching to Feed tab", { scope: "scrape" });
    const switchedToFeed = await toggleToFeedView();
    if (switchedToFeed) {
      // Wait for feed content using smart polling
      await waitFor(() => {
        const newText = textOf(root).replace(/\s+/g, " ");
        return /[A-Z]\.\s*\w+\s*·\s*\d+(?:\.\d+)?\s*fps/i.test(newText);
      }, { timeoutMs: 3000, intervalMs: 100 });

      const feedRawText = textOf(root);
      feed_entries = extractFeedEntriesFromText(feedRawText);
      recent_performances = parseRecentPerformancesFromText(feedRawText);
    }
  } else {
    // Already on Feed tab or unknown - scrape current content
    feed_entries = extractFeedEntriesFromText(initialRawText);
    recent_performances = parseRecentPerformancesFromText(initialRawText);
  }

  emitDebugEvent("info", `Feed extraction: ${feed_entries.length} entries`, { scope: "scrape" });


  const result = {
    player_name: playerName,
    profile_url: profileUrl,
    title: document.title || "",
    header_text,
    header_parsed,
    season_summary,
    recent_performances,
    feed_entries,
    active_tab: initialTab,
    raw_text_length: initialRawText.length,
  };

  emitDebugEvent("info", "Scrape complete", {
    scope: "scrape",
    data: {
      header: !!header_text,
      season_summary: season_summary?.entries?.length ?? 0,
      recent_performances: recent_performances?.entries?.length ?? 0,
      feed_entries: feed_entries.length,
      active_tab: initialTab,
    },
  });

  return result;
}

/**
 * Simple, direct flow for scraping a player profile:
 * 1. Click profile icon → navigate to profile page
 * 2. Wait for profile to render → scrape the DOM
 * 3. Click back → return to home page
 * 4. Click Draft/Update button → reopen modal
 */
export async function navigateScrapeAndReturnToDraft(opts: { player_name: string; profile_url: string; return_to_draft: boolean; sport?: string | null }) {
  const prevUrl = location.href;
  const needsClick = opts.profile_url === "__CLICK_TO_NAVIGATE__";

  emitDebugEvent("step", "Starting profile scrape flow", {
    scope: "flow",
    data: { player_name: opts.player_name, profile_url: needsClick ? "(will click icon)" : opts.profile_url, return_to_draft: opts.return_to_draft },
  });

  const modal = findModalRoot();
  emitDebugEvent("info", `Draft modal at start: ${modal ? "found" : "not found"}`, { scope: "flow" });

  // Step 1: Navigate to the profile page
  emitDebugEvent("step", "Navigating to profile page", { scope: "flow" });

  const rowEl = modal ? findPlayerRowEl(modal as Element, opts.player_name) : null;
  const iconBtn = rowEl ? findProfileIconButton(rowEl) : null;

  // Visual debugging: highlight the player row and icon
  let rowHighlightId: string | null = null;
  let iconHighlightId: string | null = null;

  if (rowEl && getDebugMode()) {
    rowHighlightId = highlightElement(rowEl, `Player: ${opts.player_name}`, "rgba(0, 161, 99, 0.3)");
  }

  if (iconBtn && getDebugMode()) {
    iconHighlightId = highlightElement(iconBtn, "Profile Icon", "rgba(4, 131, 215, 0.5)");
  }

  if (needsClick || iconBtn) {
    // Click the icon to navigate (this is the primary method)
    if (iconBtn) {
      emitDebugEvent("step", "Clicking profile icon", { scope: "flow" });
      iconBtn.click();
    } else {
      emitDebugEvent("warn", "Could not find icon button to click", { scope: "flow" });
    }
  } else if (opts.profile_url && !needsClick) {
    // Fallback: use history.pushState if we have a URL
    emitDebugEvent("step", "Using pushState to navigate", { scope: "flow" });
    try {
      const u = new URL(opts.profile_url, location.href);
      history.pushState({}, "", u.pathname + u.search + u.hash);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e) {
      emitDebugEvent("warn", "pushState failed", { scope: "flow", data: { error: String(e) } });
    }
  }

  // Clean up highlights after click
  removeHighlight(rowHighlightId);
  removeHighlight(iconHighlightId);

  // Step 2: Wait for URL change and profile content to render
  emitDebugEvent("step", "Waiting for profile page to load", { scope: "flow" });

  const navigated = await waitFor(() => location.href !== prevUrl, { timeoutMs: 6000, intervalMs: 100 });
  emitDebugEvent("info", `Navigation result: ${navigated ? "URL changed" : "URL unchanged"}`, {
    scope: "flow",
    data: { prevUrl, currentUrl: location.href },
  });

  if (navigated) {
    // Wait for profile content - specifically wait for feed entry patterns (NAME · N fps)
    emitDebugEvent("step", "Waiting for profile content to render", { scope: "flow" });
    await waitFor(() => {
      const root = (document.querySelector("#realrootcontents") || document.body) as Element;
      const t = textOf(root);
      // Look for feed entry pattern: "A. Name · 3.2 fps" or season summary pattern "PTS 21"
      const hasFeedPattern = /[A-Z]\.\s*[\w'-]+\s*·\s*\d+(?:\.\d+)?\s*fps/i.test(t);
      const hasSeasonStats = /PTS\s+\d+\s+\d+/i.test(t) || /GOAL\s+\d+/i.test(t);
      return hasFeedPattern || hasSeasonStats;
    }, { timeoutMs: 10000, intervalMs: 100 });
  }

  // Step 3: Scrape the profile
  // Use current URL as profile_url if we navigated via click
  const actualProfileUrl = navigated ? location.href : opts.profile_url;
  const scraped = await scrapeProfileFromCurrentDom(opts.player_name, actualProfileUrl, opts.sport || null);

  // Step 4: Return to draft page
  let returned = false;
  let modal_reopened = false;

  if (opts.return_to_draft && navigated) {
    emitDebugEvent("step", "Going back to home page", { scope: "flow" });

    // Try history.back()
    try { history.back(); } catch { /* ignore */ }

    // Wait for home page
    returned = await waitFor(() => {
      return location.href === prevUrl || document.querySelector("#realrootcontents") !== null;
    }, { timeoutMs: 6000, intervalMs: 100 });

    if (!returned) {
      // Fallback: click back button in nav
      emitDebugEvent("step", "Clicking back button in nav", { scope: "flow" });
      if (clickBackButtonInNav()) {
        returned = await waitFor(() => {
          return location.href === prevUrl || document.querySelector("#realrootcontents") !== null;
        }, { timeoutMs: 6000, intervalMs: 100 });
      }
    }

    emitDebugEvent("info", `Returned to home: ${returned}`, { scope: "flow", data: { currentUrl: location.href } });

    // Step 5: Reopen draft modal
    if (returned) {
      emitDebugEvent("step", "Reopening draft modal", { scope: "flow" });

      // Wait a moment for page to stabilize
      await new Promise(r => setTimeout(r, 500));

      // Check if modal is already open
      if (findModalRoot()) {
        modal_reopened = true;
        emitDebugEvent("info", "Modal already open", { scope: "flow" });
      } else {
        // Try to click Draft/Update button
        const result = await openDraftModalFromHome({ timeoutMs: 8000 });
        modal_reopened = result.opened;
        emitDebugEvent("info", `Modal reopen attempt: clicked=${result.clicked}, opened=${result.opened}`, { scope: "flow" });
      }
    }
  }

  // Clean up any remaining debug highlights
  removeAllHighlights();

  return {
    ...scraped,
    return_to_draft: opts.return_to_draft,
    returned_to_draft: returned,
    modal_reopened,
    prev_url: prevUrl,
    navigated_to_profile: navigated,
    modal_was_open: !!modal,
  };
}
