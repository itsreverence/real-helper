/**
 * User Identity Management
 * Scrapes and stores user identity from RealSports profile page.
 */

const IDENTITY_KEY = "rsdh_user_identity";

export interface UserIdentity {
    username: string;       // e.g., "wagnerpmc" (without @)
    displayName: string;    // e.g., "yevgeny prigozhin"
    linkedAt: string;       // ISO timestamp
}

/**
 * Get stored user identity, or null if not linked.
 */
export function getUserIdentity(): UserIdentity | null {
    try {
        const raw = localStorage.getItem(IDENTITY_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.username && parsed?.displayName) {
            return parsed as UserIdentity;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Save user identity to storage.
 */
export function setUserIdentity(identity: UserIdentity): void {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

/**
 * Clear stored identity (unlink).
 */
export function clearUserIdentity(): void {
    localStorage.removeItem(IDENTITY_KEY);
}

/**
 * Check if current page is the RealSports homepage where profile is visible.
 */
export function isOnProfilePage(): boolean {
    const url = window.location.href;
    // Profile panel is visible on the root/home page
    return url === "https://realsports.io/" ||
        url === "https://realsports.io" ||
        url.startsWith("https://realsports.io/?") ||
        url.startsWith("https://realsports.io/#");
}

/**
 * Attempt to scrape user identity from the current page.
 * Returns null if not on profile page or profile not found.
 */
export function scrapeProfileFromPage(): UserIdentity | null {
    if (!isOnProfilePage()) {
        return null;
    }

    // Find the @username element
    // Looking for a div whose text content starts with @ and is short (username-like)
    const allDivs = Array.from(document.querySelectorAll("div"));
    let usernameEl: HTMLElement | null = null;
    let displayNameEl: HTMLElement | null = null;

    for (const div of allDivs) {
        const text = div.textContent?.trim() || "";

        // Username: starts with @ and is short
        if (text.startsWith("@") && text.length > 1 && text.length < 30 && !text.includes(" ")) {
            // Verify this is indeed a username element (check for nearby "Karma" text to confirm profile section)
            const parent = div.closest('[style*="padding-top"]');
            if (parent?.textContent?.includes("Karma")) {
                usernameEl = div as HTMLElement;
                break;
            }
        }
    }

    if (!usernameEl) {
        return null;
    }

    // Find display name - it's typically a sibling or nearby element with larger text
    // Looking at the structure: display name is in a sibling container before the username
    const usernameParent = usernameEl.parentElement;
    if (usernameParent) {
        // The display name should be in a nearby element
        const grandParent = usernameParent.parentElement?.parentElement;
        if (grandParent) {
            const divs = Array.from(grandParent.querySelectorAll("div"));
            for (const div of divs) {
                const text = div.textContent?.trim() || "";
                // Display name: non-empty, not starting with @, reasonable length, appears before username
                if (text && !text.startsWith("@") && text.length > 1 && text.length < 50 &&
                    div !== usernameEl && !text.includes("Karma") && !text.includes("Rax")) {
                    // Check if this element only contains text (no nested with different text)
                    if (div.childElementCount === 0 || div.textContent === text) {
                        displayNameEl = div as HTMLElement;
                        break;
                    }
                }
            }
        }
    }

    const username = usernameEl.textContent?.trim().replace(/^@/, "") || "";
    const displayName = displayNameEl?.textContent?.trim() || username;

    if (!username) {
        return null;
    }

    return {
        username,
        displayName,
        linkedAt: new Date().toISOString(),
    };
}

/**
 * Check if user identity is linked.
 */
export function isIdentityLinked(): boolean {
    return getUserIdentity() !== null;
}
