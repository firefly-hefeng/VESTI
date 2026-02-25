
import { isRequestMessage } from "../lib/messaging/protocol";
import type { RequestMessage, ResponseMessage } from "../lib/messaging/protocol";
import { interceptAndPersistCapture } from "../lib/capture/storage-interceptor";
import {
  listConversations,
  listMessages,
  searchConversationIdsByText,
  deleteConversation,
  updateConversationTitle,
  getDashboardStats,
  getDataOverview,
  getStorageUsage,
  exportAllData,
  clearAllData,
  clearInsightsCache,
  getSummary,
  getWeeklyReport,
} from "../lib/db/repository";
import { getLlmSettings, setLlmSettings } from "../lib/services/llmSettingsService";
import { callInference } from "../lib/services/llmService";
import {
  generateConversationSummary,
  generateWeeklyReport,
} from "../lib/services/insightGenerationService";
import { getCaptureSettings } from "../lib/services/captureSettingsService";
import type {
  ActiveCaptureStatus,
  CaptureMode,
  ForceArchiveTransientResult,
  LlmConfig,
  Platform,
} from "../lib/types";
import { logger } from "../lib/utils/logger";
import { getLlmAccessMode, normalizeLlmSettings } from "../lib/services/llmConfig";

function requireSettings(settings: LlmConfig | null): LlmConfig {
  if (!settings) {
    throw new Error("LLM_CONFIG_MISSING");
  }
  const normalized = normalizeLlmSettings(settings);
  const mode = getLlmAccessMode(normalized);
  if (mode === "demo_proxy") {
    if ((!normalized.proxyBaseUrl && !normalized.proxyUrl) || !normalized.modelId) {
      throw new Error("LLM_CONFIG_MISSING");
    }
    return normalized;
  }
  if (!normalized.apiKey || !normalized.modelId || !normalized.baseUrl) {
    throw new Error("LLM_CONFIG_MISSING");
  }
  return normalized;
}

type ContentTransientStatusResponse =
  | {
      ok: true;
      status: {
        available: boolean;
        reason: "ok" | "no_transient";
        platform?: Platform;
        sessionUUID?: string;
        transientKey?: string;
        messageCount?: number;
        turnCount?: number;
        lastDecision?: ActiveCaptureStatus["lastDecision"];
        updatedAt?: number;
      };
    }
  | { ok: false; error: string };

type ContentForceArchiveResponse =
  | {
      ok: true;
      result: {
        saved: boolean;
        newMessages: number;
        conversationId?: number;
        decision: ForceArchiveTransientResult["decision"];
      };
    }
  | { ok: false; error: string };

const SUPPORTED_CAPTURE_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "chat.deepseek.com",
  "www.doubao.com",
  "chat.qwen.ai",
]);

function resolvePlatformFromUrl(url: string): Platform | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
      return "ChatGPT";
    }
    if (host.includes("claude.ai")) {
      return "Claude";
    }
    if (host.includes("gemini.google.com")) {
      return "Gemini";
    }
    if (host.includes("chat.deepseek.com")) {
      return "DeepSeek";
    }
    if (host.includes("www.doubao.com")) {
      return "Doubao";
    }
    if (host.includes("chat.qwen.ai")) {
      return "Qwen";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isSupportedCaptureTabUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return Array.from(SUPPORTED_CAPTURE_HOSTS).some((supportedHost) =>
      host.includes(supportedHost)
    );
  } catch {
    return false;
  }
}

function getModeFromSettings(mode: CaptureMode): CaptureMode {
  if (mode === "mirror" || mode === "smart" || mode === "manual") {
    return mode;
  }
  return "mirror";
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] ?? null);
    });
  });
}

async function sendMessageToTab<T>(
  tabId: number,
  message: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

async function buildActiveCaptureStatus(mode: CaptureMode): Promise<ActiveCaptureStatus> {
  const tab = await getActiveTab();
  if (!tab?.id || !isSupportedCaptureTabUrl(tab.url)) {
    return {
      mode,
      supported: false,
      available: false,
      reason: "unsupported_tab",
    };
  }

  const platform = tab.url ? resolvePlatformFromUrl(tab.url) : undefined;

  if (mode === "mirror") {
    return {
      mode,
      supported: true,
      available: false,
      reason: "mode_mirror",
      platform,
    };
  }

  try {
    const response = await sendMessageToTab<ContentTransientStatusResponse>(tab.id, {
      type: "GET_TRANSIENT_CAPTURE_STATUS",
    });

    if (!response?.ok) {
      return {
        mode,
        supported: true,
        available: false,
        reason: "content_unreachable",
        platform,
      };
    }

    return {
      mode,
      supported: true,
      available: response.status.available,
      reason: response.status.reason === "ok" ? "ok" : "no_transient",
      platform: response.status.platform ?? platform,
      sessionUUID: response.status.sessionUUID,
      transientKey: response.status.transientKey,
      messageCount: response.status.messageCount,
      turnCount: response.status.turnCount,
      lastDecision: response.status.lastDecision,
      updatedAt: response.status.updatedAt,
    };
  } catch {
    return {
      mode,
      supported: true,
      available: false,
      reason: "content_unreachable",
      platform,
    };
  }
}

async function handleBackgroundRequest(
  message: Extract<RequestMessage, { target?: "background" }>
): Promise<ResponseMessage> {
  const messageType = message.type;

  try {
    switch (message.type) {
      case "GET_ACTIVE_CAPTURE_STATUS": {
        const settings = await getCaptureSettings();
        const mode = getModeFromSettings(settings.mode);
        const data = await buildActiveCaptureStatus(mode);
        return { ok: true, type: messageType, data };
      }
      case "FORCE_ARCHIVE_TRANSIENT": {
        const settings = await getCaptureSettings();
        const mode = getModeFromSettings(settings.mode);
        if (mode === "mirror") {
          throw new Error("ARCHIVE_MODE_DISABLED");
        }

        const tab = await getActiveTab();
        if (!tab?.id) {
          throw new Error("ACTIVE_TAB_UNAVAILABLE");
        }
        if (!isSupportedCaptureTabUrl(tab.url)) {
          throw new Error("ACTIVE_TAB_UNSUPPORTED");
        }

        let response: ContentForceArchiveResponse;
        try {
          response = await sendMessageToTab<ContentForceArchiveResponse>(tab.id, {
            type: "FORCE_ARCHIVE_TRANSIENT",
          });
        } catch (error) {
          throw new Error((error as Error).message || "FORCE_ARCHIVE_FAILED");
        }

        if (!response?.ok) {
          throw new Error(response?.error || "FORCE_ARCHIVE_FAILED");
        }

        const data: ForceArchiveTransientResult = {
          forced: true,
          saved: response.result.saved,
          newMessages: response.result.newMessages,
          conversationId: response.result.conversationId,
          decision: response.result.decision,
        };

        return { ok: true, type: messageType, data };
      }
      default:
        return {
          ok: false,
          type: messageType,
          error: `Unsupported message type: ${messageType}`,
        };
    }
  } catch (error) {
    logger.error("background", "Background request failed", error as Error);
    return {
      ok: false,
      type: messageType,
      error: (error as Error).message || "Unknown error",
    };
  }
}

async function handleOffscreenRequest(message: RequestMessage): Promise<ResponseMessage> {
  const messageType = message.type;
  try {
    switch (message.type) {
      case "CAPTURE_CONVERSATION": {
        const result = await interceptAndPersistCapture(message.payload);
        return { ok: true, type: messageType, data: result };
      }
      case "GET_CONVERSATIONS": {
        const data = await listConversations(message.payload);
        return { ok: true, type: messageType, data };
      }
      case "GET_MESSAGES": {
        const data = await listMessages(message.payload.conversationId);
        return { ok: true, type: messageType, data };
      }
      case "SEARCH_CONVERSATION_IDS_BY_TEXT": {
        const data = await searchConversationIdsByText(message.payload.query);
        return { ok: true, type: messageType, data };
      }
      case "DELETE_CONVERSATION": {
        const deleted = await deleteConversation(message.payload.id);
        return { ok: true, type: messageType, data: { deleted } };
      }
      case "UPDATE_CONVERSATION_TITLE": {
        const conversation = await updateConversationTitle(
          message.payload.id,
          message.payload.title
        );
        return { ok: true, type: messageType, data: { updated: true, conversation } };
      }
      case "GET_DASHBOARD_STATS": {
        const data = await getDashboardStats();
        return { ok: true, type: messageType, data };
      }
      case "GET_STORAGE_USAGE": {
        const data = await getStorageUsage();
        return { ok: true, type: messageType, data };
      }
      case "GET_DATA_OVERVIEW": {
        const data = await getDataOverview();
        return { ok: true, type: messageType, data };
      }
      case "EXPORT_DATA": {
        const data = await exportAllData(message.payload.format);
        return { ok: true, type: messageType, data };
      }
      case "CLEAR_ALL_DATA": {
        const cleared = await clearAllData();
        return { ok: true, type: messageType, data: { cleared } };
      }
      case "CLEAR_INSIGHTS_CACHE": {
        const cleared = await clearInsightsCache();
        return { ok: true, type: messageType, data: { cleared } };
      }
      case "GET_LLM_SETTINGS": {
        const settings = await getLlmSettings();
        return { ok: true, type: messageType, data: { settings } };
      }
      case "SET_LLM_SETTINGS": {
        await setLlmSettings(message.payload.settings);
        return { ok: true, type: messageType, data: { saved: true } };
      }
      case "TEST_LLM_CONNECTION": {
        const settings = requireSettings(await getLlmSettings());
        await callInference(settings, "Reply with OK only.", {
          systemPrompt: "You are a connectivity probe. Reply with OK only.",
        });
        return {
          ok: true,
          type: messageType,
          data: { ok: true, message: "Connection verified." },
        };
      }
      case "GET_CONVERSATION_SUMMARY": {
        const data = await getSummary(message.payload.conversationId);
        return { ok: true, type: messageType, data };
      }
      case "GENERATE_CONVERSATION_SUMMARY": {
        const settings = requireSettings(await getLlmSettings());
        const record = await generateConversationSummary(
          settings,
          message.payload.conversationId
        );
        return { ok: true, type: messageType, data: record };
      }
      case "GET_WEEKLY_REPORT": {
        const data = await getWeeklyReport(
          message.payload.rangeStart,
          message.payload.rangeEnd
        );
        return { ok: true, type: messageType, data };
      }
      case "GENERATE_WEEKLY_REPORT": {
        const settings = requireSettings(await getLlmSettings());
        const record = await generateWeeklyReport(
          settings,
          message.payload.rangeStart,
          message.payload.rangeEnd
        );
        return { ok: true, type: messageType, data: record };
      }
      default:
        return {
          ok: false,
          type: messageType,
          error: `Unsupported message type: ${messageType}`,
        };
    }
  } catch (error) {
    logger.error("background", "Request failed", error as Error);
    return {
      ok: false,
      type: messageType,
      error: (error as Error).message || "Unknown error",
    };
  }
}

function openSidepanelForTab(tabId: number): void {
  if (!chrome?.sidePanel?.open) {
    logger.warn("background", "sidePanel API not available");
    return;
  }
  chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true }, () => {
    chrome.sidePanel.open({ tabId }, () => {
      void chrome.runtime.lastError;
    });
  });
}

chrome.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (!message || typeof message !== "object") return;
  const type = (message as { type?: string }).type;
  if (type !== "OPEN_SIDEPANEL") return;

  const tabId = sender.tab?.id;
  if (typeof tabId === "number") {
    openSidepanelForTab(tabId);
    sendResponse?.({ ok: true });
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeId = tabs[0]?.id;
    if (typeof activeId === "number") {
      openSidepanelForTab(activeId);
    }
    sendResponse?.({ ok: true });
  });

  return true;
});
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (!isRequestMessage(message)) return;
    if (message.target !== "offscreen") return;

    void (async () => {
      const response = await handleOffscreenRequest(message);
      sendResponse(response);
    })();

    return true;
  }
);

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (!isRequestMessage(message)) return;
    if (message.target !== "background") return;

    void (async () => {
      const response = await handleBackgroundRequest(
        message as Extract<RequestMessage, { target?: "background" }>
      );
      sendResponse(response);
    })();

    return true;
  }
);

