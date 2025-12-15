import { detectSportFromNavbar } from "../scrapers/capture";

function rgbToCss(rgb: { r: number; g: number; b: number } | null) {
  if (!rgb) return null;
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

// We reuse the existing accent detection behavior by calling detectSportFromNavbar()
// and reading its attached "accent" field when available.
export function detectAccentCss(): string | null {
  try {
    const info: any = detectSportFromNavbar();
    const rgb = info?.accent?.rgb;
    return rgbToCss(rgb || null);
  } catch {
    return null;
  }
}


