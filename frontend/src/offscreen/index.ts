
import { isRequestMessage } from "../lib/messaging/protocol";
import type { RequestMessage, ResponseMessage } from "../lib/messaging/protocol";
import { interceptAndPersistCapture } from "../lib/capture/storage-interceptor";
import {
  listConversations,
  getTopics,
  createTopic,
  updateConversationTopic,
  updateConversation,
  listMessages,
  deleteConversation,
  updateConversationTitle,
  getDashboardStats,
  getStorageUsage,
  exportAllData,
  clearAllData,
  getSummary,
  getWeeklyReport,
} from "../lib/db/repository";
import { runGardener } from "../lib/services/gardenerService";
import { findRelatedConversations } from "../lib/services/searchService";
import { getLlmSettings, setLlmSettings } from "../lib/services/llmSettingsService";
import { callInference } from "../lib/services/llmService";
import {
  generateConversationSummary,
  generateWeeklyReport,
} from "../lib/services/insightGenerationService";
import type { LlmConfig } from "../lib/types";
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

async function handleRequest(message: RequestMessage): Promise<ResponseMessage> {
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
      case "GET_TOPICS": {
        const data = await getTopics();
        return { ok: true, type: messageType, data };
      }
      case "CREATE_TOPIC": {
        const topic = await createTopic(message.payload);
        return { ok: true, type: messageType, data: { topic } };
      }
      case "UPDATE_CONVERSATION_TOPIC": {
        const conversation = await updateConversationTopic(
          message.payload.id,
          message.payload.topic_id
        );
        return { ok: true, type: messageType, data: { updated: true, conversation } };
      }
      case "UPDATE_CONVERSATION": {
        const data = await updateConversation(
          message.payload.id,
          message.payload.changes
        );
        return { ok: true, type: messageType, data };
      }
      case "RUN_GARDENER": {
        const data = await runGardener(message.payload.conversationId);
        return { ok: true, type: messageType, data };
      }
      case "GET_RELATED_CONVERSATIONS": {
        const data = await findRelatedConversations(
          message.payload.conversationId,
          message.payload.limit
        );
        return { ok: true, type: messageType, data };
      }
      case "GET_MESSAGES": {
        const data = await listMessages(message.payload.conversationId);
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
      case "EXPORT_DATA": {
        const data = await exportAllData(message.payload.format);
        return { ok: true, type: messageType, data };
      }
      case "CLEAR_ALL_DATA": {
        const cleared = await clearAllData();
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
        const result = await callInference(settings, "Reply with OK only.");
        return {
          ok: true,
          type: messageType,
          data: { ok: true, message: result.content },
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
    logger.error("offscreen", "Request failed", error as Error);
    return {
      ok: false,
      type: messageType,
      error: (error as Error).message || "Unknown error",
    };
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (!isRequestMessage(message)) return;
    if (message.target !== "offscreen") return;

    void (async () => {
      const response = await handleRequest(message);
      sendResponse(response);
    })();

    return true;
  }
);

logger.info("offscreen", "Offscreen handler initialized");
