import type { Platform } from "../types";

// Shared source of truth for web/dashboard/options platform badges.
// Sidepanel does not consume this constant set.
export const PLATFORM_COLORS: Record<Platform, string> = {
  ChatGPT: "#10A37F",
  Claude: "#CC785C",
  Gemini: "#AD89EB",
  DeepSeek: "#0D28F3",
  Qwen: "#615CED",
  Doubao: "#1E6FFF",
};

const DARK_TEXT = "#1A1A1A";
const LIGHT_TEXT = "#FFFFFF";
const WCAG_DARK_REFERENCE = "#000000";

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);

  return [r, g, b];
}

function toLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(firstHex: string, secondHex: string): number {
  const first = luminance(firstHex);
  const second = luminance(secondHex);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function getAccessibleTextColor(backgroundHex: string): string {
  const darkContrast = contrastRatio(backgroundHex, WCAG_DARK_REFERENCE);
  const lightContrast = contrastRatio(backgroundHex, LIGHT_TEXT);
  return darkContrast >= lightContrast ? DARK_TEXT : LIGHT_TEXT;
}

function buildPlatformTextColors(): Record<Platform, string> {
  const result = {} as Record<Platform, string>;
  for (const platform of Object.keys(PLATFORM_COLORS) as Platform[]) {
    result[platform] = getAccessibleTextColor(PLATFORM_COLORS[platform]);
  }
  return result;
}

export const PLATFORM_TEXT_COLORS: Record<Platform, string> = buildPlatformTextColors();
