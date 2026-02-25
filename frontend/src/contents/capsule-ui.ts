import type { PlasmoCSConfig } from "plasmo";
import { sendRequest } from "../lib/messaging/runtime";
import { getUiSettings } from "../lib/services/uiSettingsService";
import {
  DEFAULT_CAPSULE_SETTINGS,
  getCapsuleSettingsForHost,
  updateCapsuleSettingsForHost,
  type CapsuleAnchor,
  type CapsuleSettings,
  type CapsuleViewMode,
} from "../lib/services/capsuleSettingsService";
import type { ActiveCaptureStatus, Platform, UiThemeMode } from "../lib/types";
import { LOGO_BASE64 } from "../lib/ui/logo";
import { logger } from "../lib/utils/logger";

export const config: PlasmoCSConfig = {
  matches: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://chat.deepseek.com/*",
    "https://www.doubao.com/*",
    "https://chat.qwen.ai/*",
  ],
  run_at: "document_idle",
  all_frames: false,
};

type CapsuleRuntimeState =
  | "idle"
  | "mirroring"
  | "holding"
  | "ready_to_archive"
  | "archiving"
  | "saved"
  | "error";

type DragSource = "collapsed" | "expanded";

interface DragSession {
  active: boolean;
  pointerId: number | null;
  source: DragSource | null;
  canDrag: boolean;
  startedWithModifier: boolean;
  dragging: boolean;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
}

const CAPSULE_ROOT_ID = "vesti-capsule-root";
const CAPSULE_Z_INDEX = 2147483646;
const POLL_INTERVAL_MS = 3000;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];
const DRAG_THRESHOLD_PX = 5;
const VIEWPORT_MARGIN = 8;
const COLLAPSED_SIZE = 43.2;
const LOGO_SIZE = 21.6;
const UI_SETTINGS_STORAGE_KEY = "vesti_ui_settings";
const CAPSULE_FONT_FACE_STYLE_ID = "vesti-capsule-font-face-style";
const FONT_UI_400_URL = new URL(
  "../../public/fonts/Lexend-UI-400.woff2",
  import.meta.url
).toString();
const FONT_UI_500_URL = new URL(
  "../../public/fonts/Lexend-UI-500.woff2",
  import.meta.url
).toString();
const FONT_UI_600_URL = new URL(
  "../../public/fonts/Lexend-UI-600.woff2",
  import.meta.url
).toString();
const FONT_UI_CJK_400_URL = new URL(
  "../../public/fonts/SourceHanSansSC-UI-400.woff2",
  import.meta.url
).toString();
const FONT_UI_CJK_500_URL = new URL(
  "../../public/fonts/SourceHanSansSC-UI-500.woff2",
  import.meta.url
).toString();
const FONT_UI_CJK_600_URL = new URL(
  "../../public/fonts/SourceHanSansSC-UI-600.woff2",
  import.meta.url
).toString();
const FONT_TITLE_400_URL = new URL(
  "../../public/fonts/Exposure-Title-400.woff2",
  import.meta.url
).toString();
const PRIMARY_ROLLOUT_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "chat.deepseek.com",
  "chat.qwen.ai",
  "www.doubao.com",
]);

interface PlatformTone {
  bg: string;
  text: string;
  border: string;
}

const PLATFORM_BY_HOST: Record<string, Platform> = {
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
  "claude.ai": "Claude",
  "gemini.google.com": "Gemini",
  "chat.deepseek.com": "DeepSeek",
  "chat.qwen.ai": "Qwen",
  "www.doubao.com": "Doubao",
};

const PLATFORM_TONE: Record<UiThemeMode, Record<Platform, PlatformTone>> = {
  light: {
    ChatGPT: {
      bg: "hsl(146 46% 93%)",
      text: "hsl(146 52% 28%)",
      border: "hsl(146 32% 76%)",
    },
    Claude: {
      bg: "hsl(22 86% 93%)",
      text: "hsl(20 54% 42%)",
      border: "hsl(21 55% 79%)",
    },
    Gemini: {
      bg: "hsl(254 86% 95%)",
      text: "hsl(252 45% 47%)",
      border: "hsl(252 52% 82%)",
    },
    DeepSeek: {
      bg: "hsl(222 90% 95%)",
      text: "hsl(222 62% 44%)",
      border: "hsl(222 63% 81%)",
    },
    Qwen: {
      bg: "hsl(242 88% 95%)",
      text: "hsl(242 56% 46%)",
      border: "hsl(242 58% 82%)",
    },
    Doubao: {
      bg: "hsl(210 100% 95%)",
      text: "hsl(212 66% 44%)",
      border: "hsl(211 69% 81%)",
    },
  },
  dark: {
    ChatGPT: {
      bg: "hsl(158 33% 18%)",
      text: "hsl(150 50% 66%)",
      border: "hsl(154 30% 33%)",
    },
    Claude: {
      bg: "hsl(18 44% 20%)",
      text: "hsl(18 58% 66%)",
      border: "hsl(18 33% 34%)",
    },
    Gemini: {
      bg: "hsl(252 35% 20%)",
      text: "hsl(252 80% 76%)",
      border: "hsl(252 34% 35%)",
    },
    DeepSeek: {
      bg: "hsl(224 44% 20%)",
      text: "hsl(222 88% 75%)",
      border: "hsl(223 35% 35%)",
    },
    Qwen: {
      bg: "hsl(242 42% 20%)",
      text: "hsl(242 88% 76%)",
      border: "hsl(242 33% 35%)",
    },
    Doubao: {
      bg: "hsl(211 46% 20%)",
      text: "hsl(211 90% 76%)",
      border: "hsl(211 37% 35%)",
    },
  },
};

const FALLBACK_PLATFORM_TONE: Record<UiThemeMode, PlatformTone> = {
  light: {
    bg: "hsl(220 20% 93%)",
    text: "hsl(220 16% 36%)",
    border: "hsl(220 20% 83%)",
  },
  dark: {
    bg: "hsl(220 17% 22%)",
    text: "hsl(220 19% 73%)",
    border: "hsl(220 16% 36%)",
  },
};

const ERROR_MESSAGE_MAP: Record<string, string> = {
  ARCHIVE_MODE_DISABLED: "Archive is disabled in mirror mode.",
  ACTIVE_TAB_UNSUPPORTED: "Current tab host is unsupported.",
  ACTIVE_TAB_UNAVAILABLE: "Active tab is unavailable.",
  TRANSIENT_NOT_FOUND: "No thread snapshot available yet.",
  missing_conversation_id: "Waiting for stable conversation URL.",
  empty_payload: "No parsed messages available to archive.",
  storage_limit_blocked: "Storage is full. Export or clean up first.",
  persist_failed: "Archive failed during persistence.",
  FORCE_ARCHIVE_FAILED: "Archive action failed. Retry.",
  content_unreachable: "Capture context is temporarily unreachable.",
};

const normalizeThemeMode = (value: unknown): UiThemeMode =>
  value === "dark" ? "dark" : "light";

const parseThemeModeFromStorageValue = (value: unknown): UiThemeMode => {
  if (!value || typeof value !== "object") return "light";
  return normalizeThemeMode((value as { themeMode?: unknown }).themeMode);
};

const resolvePlatformTone = (
  platform: Platform | undefined,
  themeMode: UiThemeMode
): PlatformTone => {
  if (!platform) return FALLBACK_PLATFORM_TONE[themeMode];
  return PLATFORM_TONE[themeMode][platform] ?? FALLBACK_PLATFORM_TONE[themeMode];
};

const CAPSULE_FONT_FACE_STYLE_TEXT = `
@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_400_URL}") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0100-024F, U+0259, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2C60-2C7F, U+A720-A7FF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_500_URL}") format("woff2");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0100-024F, U+0259, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2C60-2C7F, U+A720-A7FF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_600_URL}") format("woff2");
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0100-024F, U+0259, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2C60-2C7F, U+A720-A7FF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_CJK_400_URL}") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  unicode-range: U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F, U+2B820-2CEAF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_CJK_500_URL}") format("woff2");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  unicode-range: U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F, U+2B820-2CEAF;
}

@font-face {
  font-family: "Vesti Sans UI";
  src: url("${FONT_UI_CJK_600_URL}") format("woff2");
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  unicode-range: U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F, U+2B820-2CEAF;
}

@font-face {
  font-family: "Vesti Title Serif";
  src: url("${FONT_TITLE_400_URL}") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  font-synthesis: weight;
  unicode-range: U+0000-00FF, U+0100-024F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F;
}
`;

const SHADOW_STYLE = `
:host {
  all: initial;
}

.capsule-shell {
  --capsule-bg: hsl(220 24% 95%);
  --capsule-bg2: hsl(220 23% 94%);
  --capsule-bg3: hsl(220 22% 92%);
  --capsule-border: hsl(220 17% 84%);
  --capsule-divider: hsl(220 20% 88%);
  --capsule-text1: hsl(224 15% 12%);
  --capsule-text2: hsl(224 9% 36%);
  --capsule-text3: hsl(224 7% 56%);
  --capsule-shadow: 0 8px 22px rgba(28, 20, 15, 0.1), 0 2px 6px rgba(28, 20, 15, 0.08);
  --capsule-shadow-hover: 0 10px 28px rgba(28, 20, 15, 0.12), 0 3px 9px rgba(28, 20, 15, 0.1);
  --status-held-bg: hsl(36 90% 43% / 0.12);
  --status-held-text: hsl(36 90% 43%);
  --status-held-border: hsl(36 90% 43% / 0.28);
  --status-live-bg: hsl(146 50% 38% / 0.12);
  --status-live-text: hsl(146 50% 38%);
  --status-live-border: hsl(146 50% 38% / 0.28);
  --status-ready-bg: hsl(265 83% 60% / 0.12);
  --status-ready-text: hsl(265 83% 60%);
  --status-ready-border: hsl(265 83% 60% / 0.28);
  --status-neutral-bg: hsl(224 9% 36% / 0.08);
  --status-neutral-text: hsl(224 9% 36%);
  --status-neutral-border: hsl(224 9% 36% / 0.2);
  --status-error-bg: hsl(0 55% 51% / 0.1);
  --status-error-text: hsl(0 55% 51%);
  --status-error-border: hsl(0 55% 51% / 0.24);
  --btn-primary-bg: hsl(224 15% 12%);
  --btn-primary-text: hsl(0 0% 100%);
  --btn-secondary-bg: hsl(220 23% 94%);
  --btn-secondary-text: hsl(224 9% 36%);
  --btn-secondary-border: hsl(220 17% 84%);
  position: fixed;
  pointer-events: auto;
  touch-action: none;
  z-index: ${CAPSULE_Z_INDEX};
  font-family: "Vesti Sans UI", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--capsule-text1);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  color-scheme: light;
}

.capsule-shell[data-theme="dark"] {
  --capsule-bg: hsl(0 0% 13%);
  --capsule-bg2: hsl(0 0% 16%);
  --capsule-bg3: hsl(0 0% 17%);
  --capsule-border: hsl(0 0% 25%);
  --capsule-divider: hsl(0 0% 20%);
  --capsule-text1: hsl(0 0% 96%);
  --capsule-text2: hsl(0 0% 78%);
  --capsule-text3: hsl(0 0% 62%);
  --capsule-shadow: 0 12px 30px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.3);
  --capsule-shadow-hover: 0 10px 28px rgba(0, 0, 0, 0.35), 0 3px 9px rgba(0, 0, 0, 0.25);
  --status-held-bg: hsl(40 85% 58% / 0.2);
  --status-held-text: hsl(40 85% 58%);
  --status-held-border: hsl(40 85% 58% / 0.34);
  --status-live-bg: hsl(145 55% 46% / 0.2);
  --status-live-text: hsl(145 55% 46%);
  --status-live-border: hsl(145 55% 46% / 0.34);
  --status-ready-bg: hsl(262 92% 76% / 0.2);
  --status-ready-text: hsl(262 92% 76%);
  --status-ready-border: hsl(262 92% 76% / 0.34);
  --status-neutral-bg: hsl(0 0% 78% / 0.12);
  --status-neutral-text: hsl(0 0% 78%);
  --status-neutral-border: hsl(0 0% 78% / 0.26);
  --status-error-bg: hsl(0 72% 60% / 0.2);
  --status-error-text: hsl(0 72% 60%);
  --status-error-border: hsl(0 72% 60% / 0.34);
  --btn-primary-bg: hsl(0 0% 96%);
  --btn-primary-text: hsl(0 0% 10%);
  --btn-secondary-bg: hsl(0 0% 16%);
  --btn-secondary-text: hsl(0 0% 78%);
  --btn-secondary-border: hsl(0 0% 25%);
  color-scheme: dark;
}

.capsule-shell.is-dragging,
.capsule-shell.is-dragging * {
  cursor: grabbing !important;
  user-select: none;
}

.capsule-collapsed {
  width: ${COLLAPSED_SIZE}px;
  height: ${COLLAPSED_SIZE}px;
  border: 1px solid hsl(220 17% 84%);
  border-radius: 9999px;
  background: hsl(220 24% 95%);
  box-shadow: 0 3px 9px rgba(28, 20, 15, 0.16), 0 1px 2px rgba(28, 20, 15, 0.1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
  cursor: grab;
  font-family: inherit;
  padding: 0;
  touch-action: none;
}

.capsule-collapsed:hover {
  transform: translateY(-1px) scale(1.02);
  box-shadow: 0 6px 14px rgba(28, 20, 15, 0.2), 0 2px 5px rgba(28, 20, 15, 0.12);
}

.capsule-collapsed:active {
  transform: scale(0.97);
}

.capsule-logo {
  width: ${LOGO_SIZE}px;
  height: ${LOGO_SIZE}px;
  object-fit: contain;
  -webkit-user-drag: none;
  user-select: none;
}

.capsule-panel {
  width: min(320px, calc(100vw - 16px));
  box-sizing: border-box;
  border: 1px solid var(--capsule-border);
  border-radius: 16px;
  background: var(--capsule-bg);
  box-shadow: var(--capsule-shadow);
  overflow: hidden;
}

.capsule-shell[data-view="collapsed"] .capsule-panel {
  display: none;
}

.capsule-shell[data-view="expanded"] .capsule-collapsed {
  display: none;
}

.capsule-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 14px 11px;
  border-bottom: 1px solid var(--capsule-divider);
}

.capsule-drag-handle {
  cursor: grab;
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.capsule-title {
  font-family: "Vesti Title Serif", "Tiempos Headline", "Tiempos Text", "Tiempos", ui-serif, "Apple-System-UI-Serif", "BlinkMacSystemFont", serif;
  font-size: 18px;
  line-height: 1.25;
  font-weight: 700;
  font-synthesis: weight;
  letter-spacing: -0.004em;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.capsule-platform {
  font-size: 9.5px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0.2px;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid transparent;
}

.capsule-collapse-btn {
  width: 24px;
  height: 24px;
  font-family: inherit;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--capsule-text2);
  font-size: 11px;
  line-height: 1;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.capsule-collapse-btn:hover {
  background: var(--capsule-bg3);
  color: var(--capsule-text1);
}

.capsule-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 14px 0;
  margin-bottom: 10px;
}

.capsule-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 20px;
  border: 1px solid transparent;
}

.capsule-status-dot {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: currentColor;
}

.capsule-status-badge[data-state="idle"] {
  color: var(--status-neutral-text);
  background: var(--status-neutral-bg);
  border-color: var(--status-neutral-border);
}

.capsule-status-badge[data-state="holding"] {
  color: var(--status-held-text);
  background: var(--status-held-bg);
  border-color: var(--status-held-border);
}

.capsule-status-badge[data-state="ready_to_archive"] {
  color: var(--status-ready-text);
  background: var(--status-ready-bg);
  border-color: var(--status-ready-border);
}

.capsule-status-badge[data-state="mirroring"],
.capsule-status-badge[data-state="archiving"] {
  color: var(--status-live-text);
  background: var(--status-live-bg);
  border-color: var(--status-live-border);
}

.capsule-status-badge[data-state="saved"] {
  color: var(--status-live-text);
  background: var(--status-live-bg);
  border-color: var(--status-live-border);
}

.capsule-status-badge[data-state="error"] {
  color: var(--status-error-text);
  background: var(--status-error-bg);
  border-color: var(--status-error-border);
}

.capsule-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 0 14px;
  margin-bottom: 10px;
}

.capsule-metric {
  border: 1px solid var(--capsule-divider);
  border-radius: 9px;
  background: var(--capsule-bg2);
  padding: 8px 10px;
  display: grid;
  gap: 4px;
}

.capsule-metric-label {
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--capsule-text2);
}

.capsule-domain-label {
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.01em;
  color: var(--capsule-text2);
}

.capsule-metric-value {
  font-family: "Vesti Title Serif", "Tiempos Headline", "Tiempos Text", "Tiempos", ui-serif, "Apple-System-UI-Serif", "BlinkMacSystemFont", serif;
  font-size: 20px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: -0.03em;
  color: var(--capsule-text1);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}

.capsule-metric-value.is-empty {
  font-size: 16px;
  color: var(--capsule-text3);
}

.capsule-reason {
  min-height: 17px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--capsule-text2);
  margin-bottom: 12px;
  padding: 0 14px;
}

.capsule-actions {
  display: flex;
  gap: 7px;
  padding: 0 14px 14px;
}

.capsule-action-btn {
  flex: 1;
  min-height: 34px;
  font-family: inherit;
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 8px 10px;
  font-size: 12.5px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.005em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--btn-secondary-bg);
  color: var(--btn-secondary-text);
  transition: opacity 120ms ease;
}

.capsule-action-btn:hover:enabled {
  opacity: 0.82;
}

.capsule-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.capsule-action-btn.is-primary {
  flex: 1.4;
  background: var(--btn-primary-bg);
  border-color: transparent;
  color: var(--btn-primary-text);
}

.capsule-action-btn:not(.is-primary) {
  border-color: var(--btn-secondary-border);
}

.capsule-status-badge[data-state="mirroring"] .capsule-status-dot,
.capsule-status-badge[data-state="archiving"] .capsule-status-dot,
.capsule-status-badge[data-state="saved"] .capsule-status-dot {
  animation: capsule-live-blink 1.6s ease-in-out infinite;
}

@keyframes capsule-live-blink {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.capsule-shell.is-dragging .capsule-collapsed,
.capsule-shell.is-dragging .capsule-panel {
  transition: none !important;
}

.fallback-shell .capsule-collapsed {
  cursor: pointer;
}

.fallback-shell .capsule-panel {
  display: none !important;
}

.capsule-shell[data-theme="dark"] .capsule-panel {
  box-shadow: var(--capsule-shadow);
}

.capsule-shell[data-theme="dark"] .capsule-collapse-btn:hover {
  background: var(--capsule-bg3);
}

.capsule-shell[data-theme="dark"] .capsule-action-btn:hover:enabled {
  opacity: 0.82;
}

.capsule-shell[data-theme="dark"] .capsule-domain-label,
.capsule-shell[data-theme="dark"] .capsule-metric-label,
.capsule-shell[data-theme="dark"] .capsule-reason {
  color: var(--capsule-text2);
}

.capsule-shell[data-theme="dark"] .capsule-metric-value.is-empty {
  color: var(--capsule-text3);
}

.capsule-shell[data-theme="dark"] .capsule-collapse-btn {
  color: var(--capsule-text2);
}

.capsule-shell[data-theme="dark"] .capsule-collapse-btn:hover {
  color: var(--capsule-text1);
}

.capsule-shell[data-theme="dark"] .capsule-action-btn:not(.is-primary) {
  border-color: var(--btn-secondary-border);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="idle"] {
  color: var(--status-neutral-text);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="error"] {
  color: var(--status-error-text);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="holding"] {
  color: var(--status-held-text);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="ready_to_archive"] {
  color: var(--status-ready-text);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="mirroring"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="archiving"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="saved"] {
  color: var(--status-live-text);
}

.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="idle"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="error"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="holding"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="ready_to_archive"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="mirroring"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="archiving"],
.capsule-shell[data-theme="dark"] .capsule-status-badge[data-state="saved"] {
  border-style: solid;
}

.capsule-shell[data-theme="light"] .capsule-status-badge[data-state="idle"],
.capsule-shell[data-theme="light"] .capsule-status-badge[data-state="error"],
.capsule-shell[data-theme="light"] .capsule-status-badge[data-state="holding"],
.capsule-shell[data-theme="light"] .capsule-status-badge[data-state="ready_to_archive"],
.capsule-shell[data-theme="light"] .capsule-status-badge[data-state="mirroring"],
.capsule-shell[data-theme="light"] .capsule-status-badge[data-state="archiving"],
.capsule-shell[data-theme="light"] .capsule-status-badge[data-state="saved"] {
  border-style: solid;
}

.capsule-shell[data-view="expanded"] {
  cursor: default;
}

.capsule-shell[data-view="collapsed"] .capsule-collapsed {
  cursor: grab;
}

.capsule-shell[data-view="collapsed"].is-dragging .capsule-collapsed {
  cursor: grabbing;
}

.capsule-shell[data-view="expanded"].is-dragging .capsule-drag-handle {
  cursor: grabbing !important;
}

.capsule-shell[data-view="expanded"] .capsule-drag-handle {
  cursor: grab;
}

.capsule-shell[data-view="expanded"] .capsule-collapse-btn {
  flex-shrink: 0;
}

.capsule-shell[data-view="expanded"] .capsule-platform {
  flex-shrink: 0;
}

.capsule-shell[data-view="expanded"] .capsule-title {
  flex-shrink: 0;
}

.capsule-shell[data-view="expanded"] .capsule-drag-handle {
  overflow: hidden;
}

.capsule-shell[data-view="expanded"] .capsule-title,
.capsule-shell[data-view="expanded"] .capsule-platform,
.capsule-shell[data-view="expanded"] .capsule-domain-label {
  white-space: nowrap;
}

.capsule-shell[data-view="expanded"] .capsule-domain-label {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 170px;
}

.capsule-shell[data-view="expanded"] .capsule-actions .capsule-action-btn {
  white-space: nowrap;
}

.capsule-shell[data-view="expanded"] .capsule-reason {
  word-break: break-word;
}

.capsule-shell[data-view="expanded"] .capsule-metric-value {
  overflow: hidden;
  text-overflow: ellipsis;
}

.capsule-shell[data-view="expanded"] .capsule-metric-label {
  white-space: nowrap;
}

.capsule-shell[data-view="expanded"] .capsule-status-badge {
  white-space: nowrap;
}

.capsule-shell[data-view="expanded"] .capsule-status-row {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-status-badge {
  max-width: 160px;
}

.capsule-shell[data-view="expanded"] .capsule-status-badge .capsule-status-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.capsule-shell[data-view="expanded"] .capsule-status-badge {
  overflow: hidden;
}

.capsule-shell[data-view="expanded"] .capsule-status-dot {
  flex-shrink: 0;
}

.capsule-shell[data-view="expanded"] .capsule-status-label {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-metrics,
.capsule-shell[data-view="expanded"] .capsule-actions {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-action-btn {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-panel {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-header {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-drag-handle {
  min-width: 0;
}

.capsule-shell[data-view="expanded"] .capsule-title {
  color: var(--capsule-text1);
}

.capsule-shell[data-view="expanded"] .capsule-collapse-btn {
  color: var(--capsule-text2);
}

.capsule-shell[data-view="expanded"] .capsule-collapse-btn:hover {
  color: var(--capsule-text1);
}

.capsule-shell[data-view="expanded"] .capsule-status-row,
.capsule-shell[data-view="expanded"] .capsule-metrics,
.capsule-shell[data-view="expanded"] .capsule-reason,
.capsule-shell[data-view="expanded"] .capsule-actions {
  box-sizing: border-box;
}

.capsule-shell[data-view="expanded"] .capsule-panel,
.capsule-shell[data-view="collapsed"] .capsule-collapsed {
  -webkit-font-smoothing: antialiased;
}

.capsule-shell[data-view="expanded"] .capsule-panel {
  text-rendering: optimizeLegibility;
}

.capsule-shell[data-view="expanded"] .capsule-header {
  background: transparent;
}

.capsule-shell[data-view="expanded"] .capsule-reason {
  transition: opacity 0.2s;
}

.capsule-shell[data-view="expanded"] .capsule-panel {
  border-color: var(--capsule-border);
}

.capsule-shell[data-view="expanded"] .capsule-metric {
  border-color: var(--capsule-divider);
}

.capsule-shell[data-view="expanded"] .capsule-header {
  border-bottom-color: var(--capsule-divider);
}

.capsule-shell[data-view="expanded"] .capsule-action-btn.is-primary {
  border-color: transparent;
}

.capsule-shell[data-view="expanded"] .capsule-action-btn:not(.is-primary) {
  border-color: var(--btn-secondary-border);
}

.capsule-shell[data-view="expanded"] .capsule-collapsed {
  display: none;
}

.capsule-shell[data-view="collapsed"] .capsule-panel {
  display: none;
}

.capsule-shell[data-view="collapsed"] .capsule-collapsed {
  display: inline-flex;
}

.capsule-shell[data-view="expanded"] .capsule-panel {
  display: block;
}

.capsule-shell[data-view="expanded"] .capsule-collapse-btn:focus-visible,
.capsule-shell[data-view="expanded"] .capsule-action-btn:focus-visible,
.capsule-shell[data-view="collapsed"] .capsule-collapsed:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
}

.capsule-shell[data-theme="dark"][data-view="expanded"] .capsule-collapse-btn:focus-visible,
.capsule-shell[data-theme="dark"][data-view="expanded"] .capsule-action-btn:focus-visible {
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.32);
}
`;

const ensureCapsuleFontFaceStyleInjected = (): void => {
  if (document.getElementById(CAPSULE_FONT_FACE_STYLE_ID)) return;
  const styleNode = document.createElement("style");
  styleNode.id = CAPSULE_FONT_FACE_STYLE_ID;
  styleNode.textContent = CAPSULE_FONT_FACE_STYLE_TEXT;
  (document.head ?? document.documentElement).appendChild(styleNode);
};

const clamp = (value: number, min: number, max: number): number => {
  const normalizedMax = Math.max(min, max);
  return Math.min(Math.max(value, min), normalizedMax);
};

const normalizeHost = (host: string): string =>
  String(host ?? "")
    .trim()
    .toLowerCase();

const resolvePlatform = (host: string): Platform | undefined => {
  const normalizedHost = normalizeHost(host);
  return PLATFORM_BY_HOST[normalizedHost];
};

const resolveReasonMessage = (errorCode?: string | null): string | null => {
  if (!errorCode) return null;
  const direct = ERROR_MESSAGE_MAP[errorCode];
  if (direct) return direct;
  const normalizedKey = Object.keys(ERROR_MESSAGE_MAP).find((key) =>
    errorCode.includes(key)
  );
  return normalizedKey ? ERROR_MESSAGE_MAP[normalizedKey] : errorCode;
};

const labelForState = (state: CapsuleRuntimeState): string => {
  switch (state) {
    case "idle":
      return "Unavailable";
    case "mirroring":
      return "Mirroring";
    case "holding":
      return "Held";
    case "ready_to_archive":
      return "Ready";
    case "archiving":
      return "Archiving...";
    case "saved":
      return "Saved";
    case "error":
      return "Action failed";
  }
};

const openSidepanel = async (): Promise<boolean> => {
  if (!chrome?.runtime?.sendMessage) return false;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "OPEN_SIDEPANEL", source: "capsule-ui" },
      () => {
        const lastError = chrome.runtime.lastError;
        resolve(!lastError);
      }
    );
  });
};

const getRetryDelay = (failureCount: number): number => {
  if (failureCount <= 0) return POLL_INTERVAL_MS;
  if (failureCount <= RETRY_BACKOFF_MS.length) {
    return RETRY_BACKOFF_MS[failureCount - 1];
  }
  return POLL_INTERVAL_MS;
};

const mount = async () => {
  if (window.top !== window.self) return;
  if (document.getElementById(CAPSULE_ROOT_ID)) return;
  ensureCapsuleFontFaceStyleInjected();

  const hostname = normalizeHost(window.location.hostname);
  const isPrimaryRolloutHost = PRIMARY_ROLLOUT_HOSTS.has(hostname);

  let settings: CapsuleSettings = DEFAULT_CAPSULE_SETTINGS;
  try {
    settings = await getCapsuleSettingsForHost(hostname);
  } catch (error) {
    logger.warn("content", "Failed to load capsule settings, fallback to defaults", {
      host: hostname,
      error: (error as Error).message,
    });
  }

  let themeMode: UiThemeMode = "light";
  try {
    const uiSettings = await getUiSettings();
    themeMode = normalizeThemeMode(uiSettings.themeMode);
  } catch (error) {
    logger.warn("content", "Failed to load UI theme settings, fallback to light", {
      host: hostname,
      error: (error as Error).message,
    });
  }

  if (!settings.enabled || settings.hiddenHosts.includes(hostname)) {
    logger.info("content", "Capsule hidden by settings", { host: hostname });
    return;
  }

  const host = document.createElement("div");
  host.id = CAPSULE_ROOT_ID;
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = String(CAPSULE_Z_INDEX);
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const styleNode = document.createElement("style");
  styleNode.textContent = SHADOW_STYLE;
  shadow.appendChild(styleNode);

  const shell = document.createElement("div");
  shell.className = isPrimaryRolloutHost ? "capsule-shell" : "capsule-shell fallback-shell";
  shell.dataset.view = "collapsed";
  shell.dataset.state = "idle";
  shell.dataset.theme = themeMode;
  shadow.appendChild(shell);

  const collapsedButton = document.createElement("button");
  collapsedButton.type = "button";
  collapsedButton.className = "capsule-collapsed";
  collapsedButton.setAttribute("aria-label", "Vesti capsule");
  collapsedButton.title = isPrimaryRolloutHost
    ? "Open Vesti capsule"
    : "Open Vesti Dock";
  const logo = document.createElement("img");
  logo.className = "capsule-logo";
  logo.src = LOGO_BASE64;
  logo.alt = "Vesti";
  logo.draggable = false;
  collapsedButton.appendChild(logo);
  shell.appendChild(collapsedButton);

  const panel = document.createElement("section");
  panel.className = "capsule-panel";
  panel.hidden = true;

  const header = document.createElement("div");
  header.className = "capsule-header";

  const dragHandle = document.createElement("div");
  dragHandle.className = "capsule-drag-handle";
  dragHandle.setAttribute("role", "presentation");

  const title = document.createElement("span");
  title.className = "capsule-title";
  title.textContent = "Vesti";

  const platformBadge = document.createElement("span");
  platformBadge.className = "capsule-platform";
  platformBadge.textContent = resolvePlatform(hostname) ?? "Unknown";
  const initialPlatform = resolvePlatform(hostname);
  const initialPlatformTone = resolvePlatformTone(initialPlatform, themeMode);
  platformBadge.style.backgroundColor = initialPlatformTone.bg;
  platformBadge.style.color = initialPlatformTone.text;
  platformBadge.style.borderColor = initialPlatformTone.border;

  dragHandle.appendChild(title);
  dragHandle.appendChild(platformBadge);

  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.className = "capsule-collapse-btn";
  collapseBtn.textContent = "^";
  collapseBtn.setAttribute("aria-label", "Collapse capsule");
  collapseBtn.title = "Collapse";

  header.appendChild(dragHandle);
  header.appendChild(collapseBtn);

  const statusRow = document.createElement("div");
  statusRow.className = "capsule-status-row";

  const statusBadge = document.createElement("span");
  statusBadge.className = "capsule-status-badge";
  statusBadge.dataset.state = "idle";
  const statusDot = document.createElement("span");
  statusDot.className = "capsule-status-dot";
  const statusLabel = document.createElement("span");
  statusLabel.className = "capsule-status-label";
  statusLabel.textContent = "Unavailable";
  statusBadge.appendChild(statusDot);
  statusBadge.appendChild(statusLabel);

  const statusHost = document.createElement("span");
  statusHost.className = "capsule-domain-label";
  statusHost.textContent = hostname;

  statusRow.appendChild(statusBadge);
  statusRow.appendChild(statusHost);

  const metrics = document.createElement("div");
  metrics.className = "capsule-metrics";

  const messagesMetric = document.createElement("div");
  messagesMetric.className = "capsule-metric";
  const messagesLabel = document.createElement("span");
  messagesLabel.className = "capsule-metric-label";
  messagesLabel.textContent = "Messages";
  const messagesValue = document.createElement("span");
  messagesValue.className = "capsule-metric-value is-empty";
  messagesValue.textContent = "--";
  messagesMetric.appendChild(messagesLabel);
  messagesMetric.appendChild(messagesValue);

  const turnsMetric = document.createElement("div");
  turnsMetric.className = "capsule-metric";
  const turnsLabel = document.createElement("span");
  turnsLabel.className = "capsule-metric-label";
  turnsLabel.textContent = "Turns";
  const turnsValue = document.createElement("span");
  turnsValue.className = "capsule-metric-value is-empty";
  turnsValue.textContent = "--";
  turnsMetric.appendChild(turnsLabel);
  turnsMetric.appendChild(turnsValue);

  metrics.appendChild(messagesMetric);
  metrics.appendChild(turnsMetric);

  const reasonLine = document.createElement("div");
  reasonLine.className = "capsule-reason";
  reasonLine.textContent = "Waiting for status...";

  const actions = document.createElement("div");
  actions.className = "capsule-actions";

  const archiveBtn = document.createElement("button");
  archiveBtn.type = "button";
  archiveBtn.className = "capsule-action-btn is-primary";
  archiveBtn.textContent = "Archive now";

  const openDockBtn = document.createElement("button");
  openDockBtn.type = "button";
  openDockBtn.className = "capsule-action-btn";
  openDockBtn.textContent = "Open Dock";

  actions.appendChild(archiveBtn);
  actions.appendChild(openDockBtn);

  panel.appendChild(header);
  panel.appendChild(statusRow);
  panel.appendChild(metrics);
  panel.appendChild(reasonLine);
  panel.appendChild(actions);

  if (isPrimaryRolloutHost) {
    shell.appendChild(panel);
  }

  let viewMode: CapsuleViewMode = isPrimaryRolloutHost
    ? settings.defaultView
    : "collapsed";
  let runtimeStatus: ActiveCaptureStatus | null = null;
  let runtimeError: string | null = null;
  let uiState: CapsuleRuntimeState = "idle";
  let inFlightArchive = false;
  let savedUntil = 0;
  let pollTimer: number | null = null;
  let autoCollapseTimer: number | null = null;
  let failureCount = 0;
  let destroyed = false;
  let suppressCollapsedClick = false;

  const dragSession: DragSession = {
    active: false,
    pointerId: null,
    source: null,
    canDrag: false,
    startedWithModifier: false,
    dragging: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
  };

  const getShellSize = () => {
    const rect = shell.getBoundingClientRect();
    return {
      width: Math.max(rect.width || 0, COLLAPSED_SIZE),
      height: Math.max(rect.height || 0, COLLAPSED_SIZE),
    };
  };

  const clampOffsetsToViewport = (
    anchor: CapsuleAnchor,
    offsetX: number,
    offsetY: number
  ) => {
    const { width, height } = getShellSize();
    const maxOffsetX = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxOffsetY = window.innerHeight - height - VIEWPORT_MARGIN;
    return {
      anchor,
      offsetX: clamp(offsetX, VIEWPORT_MARGIN, maxOffsetX),
      offsetY: clamp(offsetY, VIEWPORT_MARGIN, maxOffsetY),
    };
  };

  const applyAnchoredPosition = () => {
    const next = clampOffsetsToViewport(
      settings.anchor,
      settings.offsetX,
      settings.offsetY
    );
    settings = {
      ...settings,
      anchor: next.anchor,
      offsetX: next.offsetX,
      offsetY: next.offsetY,
    };

    shell.style.top = "auto";
    shell.style.bottom = `${settings.offsetY}px`;

    if (settings.anchor === "bottom_right") {
      shell.style.left = "auto";
      shell.style.right = `${settings.offsetX}px`;
      return;
    }

    shell.style.left = `${settings.offsetX}px`;
    shell.style.right = "auto";
  };

  const logAction = (
    action: "open_dock" | "archive_now" | "drag_end",
    ok: boolean,
    detail?: Record<string, unknown>
  ) => {
    const payload = {
      action,
      state: uiState,
      ok,
      ...detail,
    };
    if (ok) {
      logger.info("content", "Capsule action", payload);
    } else {
      logger.warn("content", "Capsule action failed", payload);
    }
  };

  const persistSettingsPatch = async (patch: Partial<CapsuleSettings>) => {
    try {
      settings = await updateCapsuleSettingsForHost(hostname, patch);
    } catch (error) {
      logger.warn("content", "Failed to persist capsule settings", {
        host: hostname,
        patch,
        error: (error as Error).message,
      });
    }
  };

  const deriveUiState = (): CapsuleRuntimeState => {
    if (inFlightArchive) return "archiving";
    if (savedUntil > Date.now()) return "saved";
    if (runtimeError) return "error";

    if (!runtimeStatus || !runtimeStatus.supported) {
      return "idle";
    }

    if (runtimeStatus.reason === "content_unreachable") {
      return "error";
    }

    if (runtimeStatus.mode === "mirror") {
      return "mirroring";
    }

    if (runtimeStatus.available) {
      return "ready_to_archive";
    }

    return "holding";
  };

  const buildReasonLine = () => {
    if (uiState === "error") {
      return resolveReasonMessage(runtimeError) ?? "Action failed";
    }

    switch (uiState) {
      case "idle":
        return "Open an active chat thread to continue.";
      case "mirroring":
        return "Mirror mode saves content automatically.";
      case "holding":
        return "Waiting for archivable thread snapshot.";
      case "ready_to_archive":
        return "Thread snapshot ready for manual archive.";
      case "archiving":
        return "Persisting snapshot...";
      case "saved":
        return "Archive completed.";
      default:
        return null;
    }
  };

  const renderCapsule = () => {
    if (destroyed) return;

    uiState = deriveUiState();
    shell.dataset.view = viewMode;
    shell.dataset.state = uiState;
    shell.dataset.theme = themeMode;

    if (!isPrimaryRolloutHost) {
      shell.classList.add("fallback-shell");
      return;
    }

    panel.hidden = viewMode !== "expanded";
    collapsedButton.hidden = viewMode === "expanded";
    statusBadge.dataset.state = uiState;
    statusLabel.textContent = labelForState(uiState);

    const platform =
      runtimeStatus?.platform ?? resolvePlatform(hostname) ?? "ChatGPT";
    platformBadge.textContent = platform;
    const platformTone = resolvePlatformTone(platform, themeMode);
    platformBadge.style.backgroundColor = platformTone.bg;
    platformBadge.style.color = platformTone.text;
    platformBadge.style.borderColor = platformTone.border;

    const nextMessageCount =
      typeof runtimeStatus?.messageCount === "number"
        ? String(runtimeStatus.messageCount)
        : "--";
    const nextTurnCount =
      typeof runtimeStatus?.turnCount === "number"
        ? String(runtimeStatus.turnCount)
        : "--";
    messagesValue.textContent = nextMessageCount;
    turnsValue.textContent = nextTurnCount;
    messagesValue.classList.toggle("is-empty", nextMessageCount === "--");
    turnsValue.classList.toggle("is-empty", nextTurnCount === "--");

    archiveBtn.disabled = uiState !== "ready_to_archive";
    archiveBtn.textContent = uiState === "archiving" ? "Archiving..." : "Archive now";
    reasonLine.textContent = buildReasonLine() ?? "";
  };

  const syncPosition = () => {
    if (destroyed || dragSession.dragging) return;
    window.requestAnimationFrame(() => {
      if (destroyed || dragSession.dragging) return;
      applyAnchoredPosition();
    });
  };

  const setViewMode = (next: CapsuleViewMode, persist = true) => {
    if (!isPrimaryRolloutHost) return;
    if (viewMode === next) return;
    viewMode = next;
    renderCapsule();
    syncPosition();
    if (persist) {
      void persistSettingsPatch({ defaultView: next });
    }
  };

  const triggerOpenDock = async () => {
    const ok = await openSidepanel();
    logAction("open_dock", ok, { host: hostname });
  };

  const scheduleAutoCollapse = () => {
    if (autoCollapseTimer) {
      window.clearTimeout(autoCollapseTimer);
      autoCollapseTimer = null;
    }

    if (settings.autoCollapseMs <= 0) return;
    autoCollapseTimer = window.setTimeout(() => {
      if (destroyed) return;
      savedUntil = 0;
      setViewMode("collapsed", false);
      renderCapsule();
      syncPosition();
    }, settings.autoCollapseMs);
  };

  const scheduleNextPoll = (delay: number) => {
    if (!isPrimaryRolloutHost || destroyed) return;
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    pollTimer = window.setTimeout(() => {
      void pollRuntimeStatus();
    }, delay);
  };

  const pollRuntimeStatus = async () => {
    if (!isPrimaryRolloutHost || destroyed) return;

    try {
      const status = await sendRequest<"GET_ACTIVE_CAPTURE_STATUS">(
        {
          type: "GET_ACTIVE_CAPTURE_STATUS",
          target: "background",
        },
        5000
      );

      runtimeStatus = status;
      runtimeError =
        status.reason === "content_unreachable" ? "content_unreachable" : null;
      failureCount = 0;
      renderCapsule();
      syncPosition();
      logger.info("content", "Capsule status", {
        host: hostname,
        platform: status.platform,
        mode: status.mode,
        state: deriveUiState(),
        supported: status.supported,
        available: status.available,
        paused: false,
        reason: status.reason,
        messageCount: status.messageCount,
        turnCount: status.turnCount,
        updatedAt: status.updatedAt,
      });

      scheduleNextPoll(POLL_INTERVAL_MS);
    } catch (error) {
      failureCount += 1;
      runtimeError = (error as Error).message || "ACTIVE_TAB_UNAVAILABLE";
      renderCapsule();
      scheduleNextPoll(getRetryDelay(failureCount));
      logger.warn("content", "Capsule status polling failed", {
        host: hostname,
        failureCount,
        error: runtimeError,
      });
    }
  };

  const handleArchiveNow = async () => {
    if (!isPrimaryRolloutHost || uiState !== "ready_to_archive") return;

    const startedAt = Date.now();
    inFlightArchive = true;
    runtimeError = null;
    renderCapsule();

    try {
      await sendRequest<"FORCE_ARCHIVE_TRANSIENT">(
        {
          type: "FORCE_ARCHIVE_TRANSIENT",
          target: "background",
        },
        10000
      );

      inFlightArchive = false;
      savedUntil = Date.now() + settings.autoCollapseMs;
      renderCapsule();
      scheduleAutoCollapse();
      logAction("archive_now", true, { durationMs: Date.now() - startedAt });
      void pollRuntimeStatus();
    } catch (error) {
      inFlightArchive = false;
      runtimeError = (error as Error).message || "FORCE_ARCHIVE_FAILED";
      renderCapsule();
      logAction("archive_now", false, {
        durationMs: Date.now() - startedAt,
        error: runtimeError,
      });
    }
  };

  const beginDrag = (event: PointerEvent, source: DragSource) => {
    if (!event.isPrimary || event.button !== 0 || dragSession.active) return;

    dragSession.active = true;
    dragSession.pointerId = event.pointerId;
    dragSession.source = source;
    dragSession.startedWithModifier = source === "collapsed" && event.altKey;
    dragSession.canDrag = true;
    dragSession.dragging = false;
    dragSession.startX = event.clientX;
    dragSession.startY = event.clientY;

    const rect = shell.getBoundingClientRect();
    dragSession.startLeft = rect.left;
    dragSession.startTop = rect.top;

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: PointerEvent) => {
    if (!dragSession.active || dragSession.pointerId !== event.pointerId) return;
    if (!dragSession.canDrag) return;

    const dx = event.clientX - dragSession.startX;
    const dy = event.clientY - dragSession.startY;

    if (!dragSession.dragging && Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
    if (!dragSession.dragging) {
      dragSession.dragging = true;
      shell.classList.add("is-dragging");
    }

    const { width, height } = getShellSize();
    const nextLeft = clamp(
      dragSession.startLeft + dx,
      VIEWPORT_MARGIN,
      window.innerWidth - width - VIEWPORT_MARGIN
    );
    const nextTop = clamp(
      dragSession.startTop + dy,
      VIEWPORT_MARGIN,
      window.innerHeight - height - VIEWPORT_MARGIN
    );

    shell.style.left = `${nextLeft}px`;
    shell.style.top = `${nextTop}px`;
    shell.style.right = "auto";
    shell.style.bottom = "auto";
    event.preventDefault();
  };

  const endDrag = (event: PointerEvent, cancelled: boolean) => {
    if (!dragSession.active || dragSession.pointerId !== event.pointerId) return;

    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    const completedDragging = dragSession.dragging;
    const startedWithModifier = dragSession.startedWithModifier;
    const source = dragSession.source;

    if (completedDragging) {
      const rect = shell.getBoundingClientRect();
      const anchor: CapsuleAnchor =
        rect.left + rect.width / 2 >= window.innerWidth / 2
          ? "bottom_right"
          : "bottom_left";

      const offsetXRaw =
        anchor === "bottom_right"
          ? window.innerWidth - rect.right
          : rect.left;
      const offsetYRaw = window.innerHeight - rect.bottom;
      const next = clampOffsetsToViewport(anchor, offsetXRaw, offsetYRaw);
      settings = {
        ...settings,
        anchor: next.anchor,
        offsetX: next.offsetX,
        offsetY: next.offsetY,
      };
      applyAnchoredPosition();
      void persistSettingsPatch({
        anchor: next.anchor,
        offsetX: next.offsetX,
        offsetY: next.offsetY,
      });
      logAction("drag_end", true, {
        anchor: next.anchor,
        offsetX: next.offsetX,
        offsetY: next.offsetY,
      });
      suppressCollapsedClick = true;
    } else if (source === "collapsed" && startedWithModifier && !cancelled) {
      suppressCollapsedClick = true;
    }

    dragSession.active = false;
    dragSession.pointerId = null;
    dragSession.source = null;
    dragSession.canDrag = false;
    dragSession.startedWithModifier = false;
    dragSession.dragging = false;
    shell.classList.remove("is-dragging");
  };

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (destroyed || areaName !== "local") return;
    const uiThemeChange = changes[UI_SETTINGS_STORAGE_KEY];
    if (!uiThemeChange) return;

    const nextTheme = parseThemeModeFromStorageValue(uiThemeChange.newValue);
    if (nextTheme === themeMode) return;
    themeMode = nextTheme;
    renderCapsule();
    syncPosition();
    logger.info("content", "Capsule theme updated", {
      host: hostname,
      themeMode,
    });
  };

  const onResize = () => {
    syncPosition();
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (autoCollapseTimer) {
      window.clearTimeout(autoCollapseTimer);
      autoCollapseTimer = null;
    }
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pagehide", destroy);
    window.removeEventListener("beforeunload", destroy);
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    }
    host.remove();
  };

  collapsedButton.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (isPrimaryRolloutHost) {
      setViewMode("expanded");
      return;
    }
    void triggerOpenDock();
  });

  if (!isPrimaryRolloutHost) {
    collapsedButton.addEventListener("click", () => {
      void triggerOpenDock();
    });
  } else {
    collapsedButton.addEventListener("click", (event) => {
      if (suppressCollapsedClick) {
        suppressCollapsedClick = false;
        event.preventDefault();
        return;
      }
      setViewMode("expanded");
    });

    collapsedButton.addEventListener("pointerdown", (event) => {
      beginDrag(event, "collapsed");
    });
    collapsedButton.addEventListener("pointermove", (event) => {
      moveDrag(event);
    });
    collapsedButton.addEventListener("pointerup", (event) => {
      endDrag(event, false);
    });
    collapsedButton.addEventListener("pointercancel", (event) => {
      endDrag(event, true);
    });

    dragHandle.addEventListener("pointerdown", (event) => {
      beginDrag(event, "expanded");
    });
    dragHandle.addEventListener("pointermove", (event) => {
      moveDrag(event);
    });
    dragHandle.addEventListener("pointerup", (event) => {
      endDrag(event, false);
    });
    dragHandle.addEventListener("pointercancel", (event) => {
      endDrag(event, true);
    });

    collapseBtn.addEventListener("click", () => {
      setViewMode("collapsed");
    });
    archiveBtn.addEventListener("click", () => {
      void handleArchiveNow();
    });
    openDockBtn.addEventListener("click", () => {
      void triggerOpenDock();
    });
  }

  window.addEventListener("resize", onResize);
  window.addEventListener("pagehide", destroy);
  window.addEventListener("beforeunload", destroy);
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(onStorageChanged);
  }

  renderCapsule();
  syncPosition();

  if (isPrimaryRolloutHost) {
    void pollRuntimeStatus();
  } else {
    logger.info("content", "Capsule fallback mode enabled for host", {
      host: hostname,
      mode: "fallback_open_dock_only",
    });
  }
};

if (document.readyState === "loading") {
  window.addEventListener(
    "DOMContentLoaded",
    () => {
      void mount();
    },
    { once: true }
  );
} else {
  void mount();
}
