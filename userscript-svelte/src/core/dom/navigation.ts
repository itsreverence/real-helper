import { textOf } from "./dom";
import { emitDebugEvent } from "../ui/debugBus";
import { humanActivate, waitFor } from "./dom-helpers";

/**
 * Find Feed/Plays toggle buttons and detect which tab is active
 */
export function findFeedPlaysToggle(): { feedBtn: HTMLElement | null; playsBtn: HTMLElement | null; activeTab: 'feed' | 'plays' | null } {
    const root = (document.querySelector("#realrootcontents") || document.querySelector("#realweb") || document.body) as Element;

    // Look for elements containing "Feed" or "Plays" text
    const allElements = Array.from(root.querySelectorAll<HTMLElement>("div, span, button"));

    let feedBtn: HTMLElement | null = null;
    let playsBtn: HTMLElement | null = null;
    let activeTab: 'feed' | 'plays' | null = null;

    for (const el of allElements) {
        const text = textOf(el).trim().toLowerCase();
        const r = el.getBoundingClientRect();

        // Skip elements that are too big (containers) or too small/invisible
        if (r.width <= 20 || r.width > 200 || r.height <= 10 || r.height > 60) continue;

        if (text === "feed") {
            feedBtn = el;
            // Check various active indicators
            const styles = window.getComputedStyle(el);
            const hasActiveStyle =
                el.className.includes("r-1q142lx") ||
                styles.borderBottomColor === "rgb(4, 131, 215)" ||
                styles.color === "rgb(4, 131, 215)" ||
                el.getAttribute("aria-selected") === "true";
            if (hasActiveStyle) activeTab = "feed";
        } else if (text === "plays") {
            playsBtn = el;
            const styles = window.getComputedStyle(el);
            const hasActiveStyle =
                el.className.includes("r-1q142lx") ||
                styles.borderBottomColor === "rgb(4, 131, 215)" ||
                styles.color === "rgb(4, 131, 215)" ||
                el.getAttribute("aria-selected") === "true";
            if (hasActiveStyle) activeTab = "plays";
        }
    }

    // If we couldn't determine active tab from styles, try to infer from content
    if (activeTab === null && (feedBtn || playsBtn)) {
        const pageText = textOf(root).toLowerCase();
        // If we see "fps" patterns with game info, probably on Feed
        if (/\d+(?:\.\d+)?\s*fps\s+\d/.test(pageText) && /vs\s+[A-Z]{2,4}|@\s+[A-Z]{2,4}/i.test(pageText)) {
            activeTab = "feed";
        }
        // If we see score/period/time patterns, probably on Plays
        else if (/\d+-\d+\s+P\d+\s+\d{1,2}:\d{2}/i.test(pageText)) {
            activeTab = "plays";
        }
    }

    return { feedBtn, playsBtn, activeTab };
}

/**
 * Switch to Feed tab view
 */
export async function toggleToFeedView(): Promise<boolean> {
    const { feedBtn, activeTab } = findFeedPlaysToggle();

    emitDebugEvent("info", `Toggle to Feed: activeTab=${activeTab}, feedBtn=${feedBtn ? 'found' : 'not found'}`, { scope: "scrape" });

    if (activeTab === "feed") return true; // Already on feed
    if (!feedBtn) return false; // Can't find feed button

    emitDebugEvent("step", "Clicking Feed button with humanActivate", { scope: "scrape" });
    humanActivate(feedBtn);

    // Wait for the view to switch
    const switched = await waitFor(() => findFeedPlaysToggle().activeTab === "feed", { timeoutMs: 4000 });
    emitDebugEvent("info", `Feed tab switch result: ${switched}`, { scope: "scrape" });
    return switched;
}

/**
 * Try to find the top navigation bar
 */
export function tryFindTopNav(): HTMLElement | null {
    const root = (document.querySelector("#realrootcontents") || document.querySelector("#realweb") || document.body) as HTMLElement;
    const candidates = Array.from(root.querySelectorAll<HTMLElement>("div,header"))
        .map(el => {
            const t = textOf(el);
            if (!t || !t.includes("Player")) return null;
            const r = el.getBoundingClientRect();
            if (r.top < -5 || r.top > 80) return null;
            if (r.height < 32 || r.height > 90) return null;
            return { el, area: r.width * r.height };
        })
        .filter(Boolean) as { el: HTMLElement; area: number }[];
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.area - a.area);
    return candidates[0].el;
}

/**
 * Click the back button in navigation
 */
export function clickBackButtonInNav(): boolean {
    const nav = tryFindTopNav();
    if (!nav) return false;
    const clickables = Array.from(nav.querySelectorAll<HTMLElement>("button,[role='button'],a,div[tabindex='0']"));
    const scored = clickables
        .map(el => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return null;
            if (r.width > 80 || r.height > 80) return null;
            const leftScore = Math.max(0, 120 - r.left);
            const hasSvg = el.querySelector("svg") ? 20 : 0;
            const txt = textOf(el).toLowerCase();
            const aria = (el.getAttribute("aria-label") || "").toLowerCase();
            const backHint = (txt.includes("back") || aria.includes("back")) ? 30 : 0;
            return { el, score: leftScore + hasSvg + backHint };
        })
        .filter(Boolean) as { el: HTMLElement; score: number }[];
    if (scored.length === 0) return false;
    scored.sort((a, b) => b.score - a.score);
    try { scored[0].el.click(); return true; } catch { return false; }
}
