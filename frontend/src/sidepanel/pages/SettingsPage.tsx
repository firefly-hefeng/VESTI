import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  CircleAlert,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  FolderGit2,
  Github,
  Loader2,
  Mail,
  Megaphone,
  Moon,
  ShieldCheck,
  Sun,
  Languages,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ActiveCaptureStatus,
  AsyncStatus,
  CaptureMode,
  CaptureSettings,
  LlmConfig,
  UiThemeMode,
} from "~lib/types";
import {
  DEFAULT_CAPTURE_SETTINGS,
  getCaptureSettings,
  setCaptureSettings,
} from "~lib/services/captureSettingsService";
import {
  DEFAULT_BACKUP_MODEL,
  DEFAULT_PROXY_BASE_URL,
  DEFAULT_PROXY_URL,
  DEFAULT_STABLE_MODEL,
  MODELSCOPE_BASE_URL,
  buildDefaultLlmSettings,
  getLlmAccessMode,
  normalizeLlmSettings,
} from "~lib/services/llmConfig";
import {
  applyUiTheme,
  getUiSettings,
  setUiThemeMode,
} from "~lib/services/uiSettingsService";
import {
  forceArchiveTransient,
  getActiveCaptureStatus,
  getLlmSettings,
  setLlmSettings,
  testLlmConnection,
} from "~lib/services/storageService";
import { DisclosureSection } from "../components/DisclosureSection";

const MODEL_OPTIONS = [DEFAULT_STABLE_MODEL, DEFAULT_BACKUP_MODEL];
const MIN_TURNS_DEFAULT = DEFAULT_CAPTURE_SETTINGS.smartConfig.minTurns;

const CAPTURE_MODE_OPTIONS: Array<{ value: CaptureMode; label: string; description: string }> = [
  {
    value: "mirror",
    label: "Full Mirror",
    description: "Capture all parsed conversation updates.",
  },
  {
    value: "smart",
    label: "Smart Denoising",
    description: "Capture only when min-turn and keyword rules pass.",
  },
  {
    value: "manual",
    label: "Manual Archive",
    description: "Hold captures until you archive the active thread manually.",
  },
];

const DOCS_HELP_URL = "https://github.com/abraxas914/VESTI#readme";
const FEEDBACK_ISSUE_URL = "https://github.com/abraxas914/VESTI/issues/new/choose";
const WHATS_NEW_URL = "https://github.com/abraxas914/VESTI/releases";
const FEEDBACK_EMAIL = "suyc23@gmail.com";
const FEEDBACK_COPY_RESET_MS = 1600;

function openExternalUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("COPY_FAILED");
  }
}

function SettingsGroupLabel({ label }: { label: string }) {
  return (
    <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
      {label}
    </p>
  );
}

function SettingsIconTile({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-secondary text-text-secondary transition-colors duration-150 group-open:text-text-primary">
      {children}
    </span>
  );
}

function LanguageSoonRow() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-4 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-secondary text-text-secondary">
        <Languages className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text-primary">Language</p>
        <p className="mt-0.5 text-[11px] text-text-tertiary">Interface language</p>
      </div>
      <span className="rounded-full border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        Soon
      </span>
    </div>
  );
}

interface SupportRowProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  expanded?: boolean;
}

function SupportRow({ label, icon, onClick, expanded = false }: SupportRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-transparent bg-bg-surface px-4 py-3 text-left transition-colors duration-150 hover:border-border-subtle hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-secondary text-text-secondary">
          {icon}
        </span>
        <span className="text-[13px] font-medium text-text-primary">{label}</span>
      </span>
      <ArrowRight
        className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-150 ${
          expanded ? "rotate-90" : ""
        }`}
        strokeWidth={1.5}
      />
    </button>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function parseKeywordsInput(value: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const segment of value.split(",")) {
    const keyword = segment.trim();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    result.push(keyword);
  }

  return result;
}

function formatCaptureStatusReason(reason?: ActiveCaptureStatus["reason"]): string {
  switch (reason) {
    case "ok":
      return "Ready";
    case "mode_mirror":
      return "Mirror mode does not need manual archive.";
    case "unsupported_tab":
      return "Open a ChatGPT, Claude, Gemini, DeepSeek, Doubao, or Qwen thread in the active tab.";
    case "no_transient":
      return "No active thread snapshot detected yet.";
    case "content_unreachable":
      return "Cannot reach page content script. Refresh the page and try again.";
    default:
      return "Status unavailable";
  }
}

function mapArchiveErrorMessage(error: unknown): string {
  const code = getErrorMessage(error);
  switch (code) {
    case "ARCHIVE_MODE_DISABLED":
      return "Manual archive is available only in Smart or Manual mode.";
    case "ACTIVE_TAB_UNSUPPORTED":
      return "Active tab is unsupported. Open ChatGPT, Claude, Gemini, DeepSeek, Doubao, or Qwen.";
    case "ACTIVE_TAB_UNAVAILABLE":
      return "No active tab found.";
    case "TRANSIENT_NOT_FOUND":
      return "No active thread snapshot found. Send one message and try again.";
    case "missing_conversation_id":
      return "Current URL has no stable conversation ID yet. Continue the thread and retry.";
    case "empty_payload":
      return "No parsed messages available to archive.";
    case "storage_limit_blocked":
      return "Storage hard limit reached. Export or clear data before archiving.";
    case "persist_failed":
      return "Archive write failed. Please retry.";
    case "FORCE_ARCHIVE_FAILED":
      return "Manual archive failed. Please retry.";
    default:
      return code;
  }
}

function formatStatusTimestamp(value?: number): string {
  if (!value) return "N/A";
  const date = new Date(value);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function getEndpointHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function resolveSettingsForMode(settings: LlmConfig): LlmConfig {
  const mode = getLlmAccessMode(settings);
  const next = normalizeLlmSettings({
    ...settings,
    baseUrl: MODELSCOPE_BASE_URL,
    gatewayLock: "modelscope",
    updatedAt: Date.now(),
  });

  if (mode === "demo_proxy") {
    return normalizeLlmSettings({
      ...next,
      mode,
      modelId: DEFAULT_STABLE_MODEL,
      proxyBaseUrl:
        (next.proxyBaseUrl || next.proxyUrl || "").trim() || DEFAULT_PROXY_BASE_URL,
      proxyUrl: DEFAULT_PROXY_URL,
      proxyServiceToken: (next.proxyServiceToken || "").trim(),
      thinkHandlingPolicy: next.thinkHandlingPolicy ?? "strip",
    });
  }

  const customModel = (next.customModelId || next.modelId || "").trim();
  return normalizeLlmSettings({
    ...next,
    mode,
    modelId: customModel || DEFAULT_STABLE_MODEL,
    customModelId: customModel || DEFAULT_STABLE_MODEL,
  });
}

interface SettingsPageProps {
  onNavigateToData?: () => void;
}

export function SettingsPage({ onNavigateToData }: SettingsPageProps) {
  const [llmSettings, setLlmSettingsState] = useState<LlmConfig>(
    buildDefaultLlmSettings()
  );
  const [captureSettings, setCaptureSettingsState] = useState<CaptureSettings>(
    DEFAULT_CAPTURE_SETTINGS
  );
  const [minTurnsInput, setMinTurnsInput] = useState(
    String(DEFAULT_CAPTURE_SETTINGS.smartConfig.minTurns)
  );
  const [blacklistInput, setBlacklistInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showProxyToken, setShowProxyToken] = useState(false);
  const [modelStatus, setModelStatus] = useState<AsyncStatus>("idle");
  const [modelMessage, setModelMessage] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<AsyncStatus>("idle");
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [activeCaptureStatus, setActiveCaptureStatus] =
    useState<ActiveCaptureStatus | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<AsyncStatus>("idle");
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [archiveSummary, setArchiveSummary] = useState<{
    reason: string;
    messageCount: number;
    time: number;
  } | null>(null);
  const [themeMode, setThemeMode] = useState<UiThemeMode>("light");
  const [themeStatus, setThemeStatus] = useState<AsyncStatus>("idle");
  const [themeMessage, setThemeMessage] = useState<string | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [compactCardsPreviewOn, setCompactCardsPreviewOn] = useState(false);
  const [modelAccessOpen, setModelAccessOpen] = useState(false);
  const [feedbackExpanded, setFeedbackExpanded] = useState(false);
  const [feedbackCopyState, setFeedbackCopyState] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const feedbackCopyTimerRef = useRef<number | null>(null);

  const mode = getLlmAccessMode(llmSettings);
  const isCustomMode = mode === "custom_byok";
  const isSmartMode = captureSettings.mode === "smart";
  const isManualMode = captureSettings.mode === "manual";
  const byokEndpointHost = getEndpointHost(MODELSCOPE_BASE_URL);
  const archiveMode = activeCaptureStatus?.mode;
  const canArchiveByMode = archiveMode === "smart" || archiveMode === "manual";
  const canArchiveNow =
    canArchiveByMode &&
    activeCaptureStatus?.supported === true &&
    activeCaptureStatus?.available === true &&
    activeCaptureStatus?.reason === "ok" &&
    archiveStatus !== "loading";

  const refreshActiveCaptureStatus = useCallback(async () => {
    try {
      const status = await getActiveCaptureStatus();
      setActiveCaptureStatus(status);
    } catch (error) {
      setActiveCaptureStatus((prev) => ({
        mode: prev?.mode ?? captureSettings.mode,
        supported: false,
        available: false,
        reason: "content_unreachable",
      }));
    }
  }, [captureSettings.mode]);

  useEffect(() => {
    getLlmSettings()
      .then((settings) => {
        if (settings) {
          setLlmSettingsState(normalizeLlmSettings(settings));
        } else {
          setLlmSettingsState(buildDefaultLlmSettings());
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    getCaptureSettings()
      .then((settings) => {
        setCaptureSettingsState(settings);
        setMinTurnsInput(String(settings.smartConfig.minTurns));
        setBlacklistInput(settings.smartConfig.blacklistKeywords.join(", "));
      })
      .catch((error) => {
        setCaptureStatus("error");
        setCaptureMessage(getErrorMessage(error));
      });
  }, []);

  useEffect(() => {
    getUiSettings()
      .then((settings) => {
        setThemeMode(settings.themeMode);
        applyUiTheme(settings.themeMode);
      })
      .catch((error) => {
        setThemeStatus("error");
        setThemeMessage(getErrorMessage(error));
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await refreshActiveCaptureStatus();
    };

    void run();
    const intervalId = window.setInterval(() => {
      void run();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [refreshActiveCaptureStatus]);

  const setMode = (custom: boolean) => {
    setLlmSettingsState((prev) =>
      resolveSettingsForMode({
        ...prev,
        mode: custom ? "custom_byok" : "demo_proxy",
      })
    );
    setModelMessage(null);
    setModelStatus("idle");
  };

  const handleSave = async () => {
    setModelStatus("loading");
    setModelMessage(null);

    try {
      const next = resolveSettingsForMode(llmSettings);
      if (getLlmAccessMode(next) === "custom_byok" && !next.apiKey.trim()) {
        setModelStatus("error");
        setModelMessage("API key is required in custom mode.");
        return;
      }

      await setLlmSettings(next);
      setLlmSettingsState(next);
      setModelStatus("ready");
      setModelMessage("Saved");
    } catch (error) {
      setModelStatus("error");
      setModelMessage(getErrorMessage(error));
    }
  };

  const handleTest = async () => {
    setModelStatus("loading");
    setModelMessage(null);

    try {
      const next = resolveSettingsForMode(llmSettings);
      if (getLlmAccessMode(next) === "custom_byok" && !next.apiKey.trim()) {
        setModelStatus("error");
        setModelMessage("API key is required in custom mode.");
        return;
      }

      await setLlmSettings(next);
      setLlmSettingsState(next);
      const result = await testLlmConnection();
      setModelStatus(result.ok ? "ready" : "error");
      setModelMessage(result.message || (result.ok ? "OK" : "Failed"));
    } catch (error) {
      setModelStatus("error");
      setModelMessage(getErrorMessage(error));
    }
  };

  const setCaptureMode = (nextMode: CaptureMode) => {
    setCaptureSettingsState((prev) => ({
      ...prev,
      mode: nextMode,
    }));
    setCaptureStatus("idle");
    setCaptureMessage(null);
  };

  const handleSaveCaptureSettings = async () => {
    setCaptureStatus("loading");
    setCaptureMessage(null);

    try {
      const draft: CaptureSettings = {
        ...captureSettings,
        smartConfig: {
          minTurns:
            minTurnsInput.trim().length === 0
              ? MIN_TURNS_DEFAULT
              : Number(minTurnsInput),
          blacklistKeywords: parseKeywordsInput(blacklistInput),
        },
      };

      await setCaptureSettings(draft);
      const normalized = await getCaptureSettings();
      setCaptureSettingsState(normalized);
      setMinTurnsInput(String(normalized.smartConfig.minTurns));
      setBlacklistInput(normalized.smartConfig.blacklistKeywords.join(", "));
      setCaptureStatus("ready");
      setCaptureMessage("Capture settings saved.");
      await refreshActiveCaptureStatus();
    } catch (error) {
      setCaptureStatus("error");
      setCaptureMessage(getErrorMessage(error));
    }
  };

  const handleArchiveActiveThread = async () => {
    setArchiveStatus("loading");
    setArchiveMessage(null);

    try {
      const result = await forceArchiveTransient();
      if (result.saved) {
        setArchiveStatus("ready");
        setArchiveSummary({
          reason: result.decision.reason,
          messageCount: result.decision.messageCount,
          time: Date.now(),
        });
        setArchiveMessage(
          `Saved (${result.decision.reason}) \u00b7 ${result.decision.messageCount} messages`
        );
      } else {
        setArchiveStatus("error");
        setArchiveMessage(mapArchiveErrorMessage(result.decision.reason));
      }
    } catch (error) {
      setArchiveStatus("error");
      setArchiveMessage(mapArchiveErrorMessage(error));
    } finally {
      await refreshActiveCaptureStatus();
    }
  };

  const handleToggleThemeMode = async () => {
    const previous = themeMode;
    const next: UiThemeMode = previous === "dark" ? "light" : "dark";

    setThemeMode(next);
    applyUiTheme(next);
    setThemeStatus("loading");
    setThemeMessage(null);

    try {
      const saved = await setUiThemeMode(next);
      setThemeMode(saved.themeMode);
      applyUiTheme(saved.themeMode);
      setThemeStatus("ready");
      setThemeMessage(
        saved.themeMode === "dark"
          ? "Dark mode enabled."
          : "Light mode enabled."
      );
    } catch (error) {
      setThemeMode(previous);
      applyUiTheme(previous);
      setThemeStatus("error");
      setThemeMessage(getErrorMessage(error));
    }
  };

  useEffect(() => {
    return () => {
      if (feedbackCopyTimerRef.current !== null) {
        window.clearTimeout(feedbackCopyTimerRef.current);
      }
    };
  }, []);

  const handleToggleFeedback = () => {
    setFeedbackExpanded((prev) => !prev);
  };

  const handleCopyFeedbackEmail = async () => {
    try {
      await copyToClipboard(FEEDBACK_EMAIL);
      setFeedbackCopyState("copied");
    } catch {
      setFeedbackCopyState("error");
    }

    if (feedbackCopyTimerRef.current !== null) {
      window.clearTimeout(feedbackCopyTimerRef.current);
    }
    feedbackCopyTimerRef.current = window.setTimeout(() => {
      setFeedbackCopyState("idle");
    }, FEEDBACK_COPY_RESET_MS);
  };

  const handleToggleAppearance = () => {
    setAppearanceOpen((prev) => !prev);
  };

  const handleToggleModelAccess = () => {
    setModelAccessOpen((prev) => !prev);
  };

  return (
    <div className="vesti-shell flex h-full flex-col overflow-y-auto vesti-scroll bg-bg-app">
      <header className="flex h-8 shrink-0 items-center px-4">
        <h1 className="vesti-page-title text-text-primary">Settings</h1>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <SettingsGroupLabel label="Personalisation" />

        <section className="appearance-shell" data-open={appearanceOpen ? "true" : "false"}>
          <button
            type="button"
            onClick={handleToggleAppearance}
            aria-expanded={appearanceOpen}
            aria-controls="settings-appearance-panel"
            className="appearance-trigger"
          >
            <span className="appearance-trigger-main">
              <span className="appearance-icon-tile">
                {themeMode === "dark" ? (
                  <Moon className="h-4 w-4" strokeWidth={1.5} />
                ) : (
                  <Sun className="h-4 w-4" strokeWidth={1.5} />
                )}
              </span>
              <span className="min-w-0">
                <span className="appearance-title">Appearance</span>
                <span className="appearance-description">Theme and display preferences.</span>
              </span>
            </span>
            <ChevronDown className="appearance-chevron h-4 w-4" strokeWidth={1.8} />
          </button>

          {appearanceOpen ? (
            <div id="settings-appearance-panel" className="appearance-body">
              <div className="appearance-inner-row">
                <div className="min-w-0">
                  <span className="appearance-inner-label">Dark Mode</span>
                  <span className="appearance-inner-sub">Minimalist dark palette.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={themeMode === "dark"}
                  onClick={handleToggleThemeMode}
                  data-state={themeMode === "dark" ? "checked" : "unchecked"}
                  className="settings-switch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  <span className="settings-switch-thumb" />
                </button>
              </div>

              <div className="appearance-inner-row">
                <div className="min-w-0">
                  <span className="appearance-inner-label">Compact Cards</span>
                  <span className="appearance-inner-sub">Reduce card padding.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={compactCardsPreviewOn}
                  onClick={() => setCompactCardsPreviewOn((prev) => !prev)}
                  data-state={compactCardsPreviewOn ? "checked" : "unchecked"}
                  className="settings-switch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  <span className="settings-switch-thumb" />
                </button>
              </div>

              {(themeStatus === "loading" || themeMessage) && (
                <p
                  className={`appearance-theme-message ${
                    themeStatus === "error" ? "text-danger" : "text-text-secondary"
                  }`}
                >
                  {themeStatus === "loading" ? "Applying theme..." : themeMessage}
                </p>
              )}
            </div>
          ) : null}
        </section>

        <LanguageSoonRow />

        <SettingsGroupLabel label="System" />

        <section className="model-access-shell" data-open={modelAccessOpen ? "true" : "false"}>
          <button
            type="button"
            onClick={handleToggleModelAccess}
            aria-expanded={modelAccessOpen}
            aria-controls="settings-model-access-panel"
            className="model-access-trigger"
          >
            <span className="model-access-trigger-main">
              <span className="model-access-icon-tile">
                <Cpu className="h-4 w-4" strokeWidth={1.4} />
              </span>
              <span className="min-w-0">
                <span className="model-access-title">Model Access</span>
                <span className="model-access-description">BYOK &amp; proxy configuration</span>
              </span>
            </span>
            <ChevronDown className="model-access-chevron h-4 w-4" strokeWidth={1.8} />
          </button>

          {modelAccessOpen ? (
            <div id="settings-model-access-panel" className="model-access-body">
              <div className="model-access-mode-row">
                <div>
                  <p className="model-access-mode-label">Use Custom API Key</p>
                  <p className="model-access-mode-sub">BYOK - your key, direct routing</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isCustomMode}
                  onClick={() => setMode(!isCustomMode)}
                  data-state={isCustomMode ? "checked" : "unchecked"}
                  className="model-access-switch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  <span className="model-access-switch-thumb" />
                </button>
              </div>

              {!isCustomMode ? (
                <>
                  <div className="model-access-info-block">
                    <div className="model-access-info-head">
                      <span className="model-access-status-chip model-access-status-chip-demo">
                        <span className="model-access-status-dot" />
                        Proxy Active
                      </span>
                      <CircleAlert className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={1.4} />
                    </div>
                    <div className="model-access-info-divider" />
                    <div className="model-access-info-row">
                      <span className="model-access-info-key">Primary</span>
                      <span className="model-access-info-value">{DEFAULT_STABLE_MODEL}</span>
                    </div>
                    <div className="model-access-info-row">
                      <span className="model-access-info-key">Backup</span>
                      <span className="model-access-info-value">{DEFAULT_BACKUP_MODEL}</span>
                    </div>
                  </div>

                  <div className="model-access-section-divider">
                    <span>Proxy</span>
                  </div>

                  <div className="model-access-field-group">
                    <label className="model-access-input-label">Base URL</label>
                    <input
                      type="text"
                      value={llmSettings.proxyBaseUrl ?? DEFAULT_PROXY_BASE_URL}
                      onChange={(event) =>
                        setLlmSettingsState((prev) =>
                          normalizeLlmSettings({
                            ...prev,
                            proxyBaseUrl: event.target.value,
                          })
                        )
                      }
                      className="model-access-input"
                      placeholder="https://vesti-proxy.vercel.app"
                    />
                  </div>

                  <div className="model-access-field-group">
                    <label className="model-access-input-label">
                      Service Token <span className="model-access-label-optional">- optional</span>
                    </label>
                    <div className="model-access-input-wrap">
                      <input
                        type={showProxyToken ? "text" : "password"}
                        value={llmSettings.proxyServiceToken ?? ""}
                        onChange={(event) =>
                          setLlmSettingsState((prev) =>
                            normalizeLlmSettings({
                              ...prev,
                              proxyServiceToken: event.target.value,
                            })
                          )
                        }
                        className="model-access-input model-access-input-with-icon"
                        placeholder="local-proxy-token"
                      />
                      <button
                        type="button"
                        onClick={() => setShowProxyToken((prev) => !prev)}
                        className="model-access-input-eye focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        aria-label="Toggle proxy token visibility"
                      >
                        {showProxyToken ? (
                          <EyeOff className="h-3.5 w-3.5" strokeWidth={1.4} />
                        ) : (
                          <Eye className="h-3.5 w-3.5" strokeWidth={1.4} />
                        )}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="model-access-info-block">
                    <div className="model-access-info-head">
                      <span className="model-access-status-chip model-access-status-chip-byok">
                        <span className="model-access-status-dot" />
                        BYOK Active
                      </span>
                      <CircleAlert className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={1.4} />
                    </div>
                    <div className="model-access-info-divider" />
                    <div className="model-access-info-row">
                      <span className="model-access-info-key">Endpoint</span>
                      <span className="model-access-info-value">{byokEndpointHost}</span>
                    </div>
                  </div>

                  <div className="model-access-section-divider">
                    <span>Credentials</span>
                  </div>

                  <div className="model-access-field-group">
                    <label className="model-access-input-label">API Key</label>
                    <div className="model-access-input-wrap">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={llmSettings.apiKey}
                        onChange={(event) =>
                          setLlmSettingsState((prev) => ({
                            ...prev,
                            apiKey: event.target.value,
                          }))
                        }
                        className="model-access-input model-access-input-with-icon"
                        placeholder="ms-..."
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((prev) => !prev)}
                        className="model-access-input-eye focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        aria-label="Toggle API key visibility"
                      >
                        {showApiKey ? (
                          <EyeOff className="h-3.5 w-3.5" strokeWidth={1.4} />
                        ) : (
                          <Eye className="h-3.5 w-3.5" strokeWidth={1.4} />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="model-access-field-group">
                    <label className="model-access-input-label">
                      Model <span className="model-access-label-optional">- optional override</span>
                    </label>
                    <input
                      type="text"
                      list="model-access-model-options"
                      value={llmSettings.customModelId ?? llmSettings.modelId}
                      onChange={(event) =>
                        setLlmSettingsState((prev) =>
                          normalizeLlmSettings({
                            ...prev,
                            customModelId: event.target.value,
                            modelId: event.target.value,
                          })
                        )
                      }
                      className="model-access-input"
                      placeholder="claude-sonnet-4-20250514"
                    />
                    <datalist id="model-access-model-options">
                      {MODEL_OPTIONS.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  </div>
                </>
              )}

              <div className="model-access-actions">
                <button
                  type="button"
                  onClick={handleSave}
                  className="model-access-save-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleTest}
                  className="model-access-test-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  Test
                </button>
              </div>

              {modelStatus === "loading" && (
                <div className="model-access-feedback text-text-tertiary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Working...
                </div>
              )}

              {modelMessage && modelStatus !== "loading" && (
                <p
                  className={`model-access-feedback ${
                    modelStatus === "error" ? "text-danger" : "text-text-secondary"
                  }`}
                >
                  {modelMessage}
                </p>
              )}
            </div>
          ) : null}
        </section>

        <DisclosureSection
          title="Capture Engine"
          description="Mode and archive controls."
          icon={
            <SettingsIconTile>
              <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
            </SettingsIconTile>
          }
        >
          <div className="card-shadow-warm rounded-card border border-border-subtle bg-bg-surface p-4">
            <div className="grid gap-3">
              <div className="grid gap-2" role="radiogroup" aria-label="Capture Mode">
                {CAPTURE_MODE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-md border px-3 py-2 transition-colors duration-200 ${
                      captureSettings.mode === option.value
                        ? "border-text-primary bg-bg-primary/70"
                        : "border-border-subtle bg-bg-surface-hover hover:bg-bg-primary/65"
                    }`}
                  >
                    <span className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="capture-mode"
                        value={option.value}
                        checked={captureSettings.mode === option.value}
                        onChange={() => setCaptureMode(option.value)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-text-primary">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-[1.45] text-text-secondary">
                          {option.description}
                        </span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {isSmartMode && (
                <div className="grid gap-2 rounded-md border border-border-subtle bg-bg-surface-hover p-3">
                  <div className="grid gap-1">
                    <label className="text-[11px] text-text-tertiary">
                      Minimum turns (1-20)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={minTurnsInput}
                      onChange={(event) => setMinTurnsInput(event.target.value)}
                      className="settings-input"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-[11px] text-text-tertiary">
                      Blacklist keywords (comma separated)
                    </label>
                    <input
                      type="text"
                      value={blacklistInput}
                      onChange={(event) => setBlacklistInput(event.target.value)}
                      className="settings-input"
                      placeholder="translation, draft"
                    />
                  </div>
                </div>
              )}

              {isManualMode && (
                <p className="rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2 text-[12px] text-text-secondary">
                  Manual mode blocks automatic writes until you archive.
                </p>
              )}

              <p className="text-[11px] text-text-tertiary">
                Capture writes only after a stable conversation URL ID is available.
              </p>

              <div className="grid gap-1 rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2 text-[11px] text-text-secondary">
                <p>
                  Active thread: {formatCaptureStatusReason(activeCaptureStatus?.reason)}
                </p>
                <p>
                  Snapshot:{" "}
                  {activeCaptureStatus?.available
                    ? `${activeCaptureStatus.messageCount ?? 0} messages - ${
                        activeCaptureStatus.turnCount ?? 0
                      } turns`
                    : "Unavailable"}
                </p>
                <p>
                  Last update: {formatStatusTimestamp(activeCaptureStatus?.updatedAt)}
                </p>
                {activeCaptureStatus?.lastDecision && (
                  <p>
                    Last decision: {activeCaptureStatus.lastDecision.reason} -{" "}
                    {activeCaptureStatus.lastDecision.messageCount} messages
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-surface-hover p-3">
                <div>
                  <p className="text-[12px] font-medium text-text-primary">
                    Archive Active Thread
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-tertiary">
                    Available in Smart/Manual mode with an active snapshot.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleArchiveActiveThread}
                  disabled={!canArchiveNow}
                  aria-disabled={!canArchiveNow}
                  className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 ${
                    canArchiveNow
                      ? "border-border-default bg-transparent text-text-primary hover:bg-bg-surface"
                      : "border-border-default bg-transparent text-text-tertiary opacity-60"
                  }`}
                >
                  {archiveStatus === "loading" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                  {archiveStatus === "loading" ? "Archiving..." : "Archive"}
                </button>
              </div>

              {(archiveMessage || archiveSummary) && (
                <div className="rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2 text-[11px] text-text-secondary">
                  {archiveMessage && (
                    <p
                      className={
                        archiveStatus === "error" ? "text-danger" : "text-text-secondary"
                      }
                    >
                      {archiveMessage}
                    </p>
                  )}
                  {archiveSummary && (
                    <p className="mt-0.5 text-text-tertiary">
                      Saved at {formatStatusTimestamp(archiveSummary.time)} -{" "}
                      {archiveSummary.reason} - {archiveSummary.messageCount} messages
                    </p>
                  )}
                </div>
              )}

              <div className="mt-1 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleSaveCaptureSettings}
                  className="rounded-md border border-text-primary bg-text-primary px-4 py-2 text-[13px] font-medium text-text-inverse transition-colors duration-200 hover:bg-accent-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  Save Capture Settings
                </button>
                {captureStatus === "loading" && (
                  <div className="flex items-center gap-1 text-[12px] text-text-tertiary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Working...
                  </div>
                )}
                {captureMessage && captureStatus !== "loading" && (
                  <span
                    className={`text-[12px] ${
                      captureStatus === "error" ? "text-danger" : "text-text-secondary"
                    }`}
                  >
                    {captureMessage}
                  </span>
                )}
              </div>
            </div>
          </div>
        </DisclosureSection>

        <DisclosureSection
          title="Data Management"
          description="Storage, export, and cleanup."
          icon={
            <SettingsIconTile>
              <FolderGit2 className="h-4 w-4" strokeWidth={1.5} />
            </SettingsIconTile>
          }
        >
          <div className="card-shadow-warm rounded-card border border-border-subtle bg-bg-surface p-4">
            <div className="rounded-md border border-border-subtle bg-bg-surface-hover p-3">
              <p className="text-[13px] font-medium text-text-primary">
                Data tools are available in the Data tab.
              </p>
              <p className="mt-1 text-[12px] text-text-secondary">
                Use it for storage overview, exports, and cleanup.
              </p>
              <button
                type="button"
                onClick={onNavigateToData}
                disabled={!onNavigateToData}
                className={`mt-3 inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                  onNavigateToData
                    ? "border-text-primary bg-text-primary text-text-inverse hover:bg-accent-primary-hover"
                    : "border-border-default bg-bg-surface text-text-tertiary"
                }`}
              >
                Open Data Management
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </DisclosureSection>

        <SettingsGroupLabel label="Support" />

        <div className="grid gap-2">
          <SupportRow
            label="Docs & Help"
            icon={<Github className="h-4 w-4" strokeWidth={1.5} />}
            onClick={() => openExternalUrl(DOCS_HELP_URL)}
          />

          <SupportRow
            label="Send Feedback"
            icon={<Mail className="h-4 w-4" strokeWidth={1.5} />}
            onClick={handleToggleFeedback}
            expanded={feedbackExpanded}
          />

          {feedbackExpanded ? (
            <div className="mx-1 rounded-xl border border-border-subtle bg-bg-surface px-3 py-3">
              <p className="text-[11px] text-text-tertiary">
                Contact us directly or open an issue on GitHub.
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2">
                <span className="text-[12px] font-mono text-text-secondary">
                  {FEEDBACK_EMAIL}
                </span>
                <button
                  type="button"
                  onClick={handleCopyFeedbackEmail}
                  className="inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-[11px] font-medium text-text-primary transition-colors duration-150 hover:bg-bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  {feedbackCopyState === "copied" ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                  {feedbackCopyState === "copied"
                    ? "Copied"
                    : feedbackCopyState === "error"
                    ? "Retry"
                    : "Copy"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => openExternalUrl(FEEDBACK_ISSUE_URL)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary underline underline-offset-2 transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                Open a GitHub Issue
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          ) : null}

          <SupportRow
            label="What's New"
            icon={<Megaphone className="h-4 w-4" strokeWidth={1.5} />}
            onClick={() => openExternalUrl(WHATS_NEW_URL)}
          />
        </div>
      </div>
    </div>
  );
}
