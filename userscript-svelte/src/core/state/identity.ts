/**
 * User Identity Management
 * Scrapes and stores user identity from RealSports profile page.
 */

const IDENTITY_KEY = "rsdh_user_identity";

export interface UserIdentity {
    username: string;       // e.g., "wagnerpmc" (without @)
    displayName: string;    // e.g., "yevgeny prigozhin"
    avatarUrl?: string;     // Profile picture URL
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
 * Find the profile avatar button in the navbar.
 * It's the element with an img that has a user avatar URL.
 */
function findProfileNavButton(): HTMLElement | null {
    // Look for the navbar item containing a user avatar image
    const imgs = Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        // User avatars are hosted at media.realapp.com/assets/user/
        if (src.includes('media.realapp.com/assets/user/')) {
            // Find the clickable parent (has tabindex="0")
            const clickable = img.closest('[tabindex="0"]') as HTMLElement | null;
            if (clickable) {
                return clickable;
            }
        }
    }
    return null;
}

/**
 * Navigate to the profile page by clicking the profile avatar in navbar.
 * Returns true if navigation was triggered, false if button not found.
 */
export async function navigateToProfile(): Promise<boolean> {
    const profileBtn = findProfileNavButton();
    if (!profileBtn) {
        return false;
    }

    profileBtn.click();

    // Wait a moment for the profile panel to render
    await new Promise(resolve => setTimeout(resolve, 500));

    return true;
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
                // Display name: non-empty, not starting with @, doesn't contain @, reasonable length
                if (text && !text.startsWith("@") && !text.includes("@") && text.length > 1 && text.length < 50 &&
                    div !== usernameEl && !text.includes("Karma") && !text.includes("Rax")) {
                    // Check if this element only contains text (leaf node with no child elements)
                    if (div.childElementCount === 0) {
                        displayNameEl = div as HTMLElement;
                        break;
                    }
                }
            }
        }
    }

    const username = usernameEl.textContent?.trim().replace(/^@/, "") || "";
    const displayName = displayNameEl?.textContent?.trim() || username;

    // Find avatar URL - look for user avatar image in the page
    // The avatar is typically near the username, or we can find it by looking for
    // images with the user avatar URL pattern
    let avatarUrl: string | undefined;

    // First try to find it near the username element (within a few parents)
    let searchEl: Element | null = usernameEl;
    for (let i = 0; i < 10 && searchEl && !avatarUrl; i++) {
        searchEl = searchEl.parentElement;
        if (searchEl) {
            const imgs = Array.from(searchEl.querySelectorAll('img'));
            for (const img of imgs) {
                const src = img.getAttribute('src') || '';
                // User avatars are hosted at media.realapp.com/assets/user/
                if (src.includes('media.realapp.com/assets/user/')) {
                    // Upgrade to larger resolution (replace /xsmall/ or /small/ with /large/)
                    avatarUrl = src.replace(/\/(xsmall|small)\//, '/large/');
                    break;
                }
            }
        }
    }

    if (!username) {
        return null;
    }

    return {
        username,
        displayName,
        avatarUrl,
        linkedAt: new Date().toISOString(),
    };
}

/**
 * Check if user identity is linked.
 */
export function isIdentityLinked(): boolean {
    return getUserIdentity() !== null;
}
