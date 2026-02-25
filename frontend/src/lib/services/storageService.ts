import type {
  ActiveCaptureStatus,
  Conversation,
  DataOverviewSnapshot,
  DashboardStats,
  ExportFormat,
  ForceArchiveTransientResult,
  LlmConfig,
  Message,
  Platform,
  StorageUsageSnapshot,
  SummaryRecord,
  WeeklyReportRecord,
} from "../types";
import { sendRequest } from "../messaging/runtime";

const LONG_RUNNING_TIMEOUT_MS = 120000;
const TEST_CONNECTION_TIMEOUT_MS = 30000;
const FULL_TEXT_SEARCH_TIMEOUT_MS = 15000;

export async function getConversations(filters?: {
  platform?: Platform;
  search?: string;
  dateRange?: { start: number; end: number };
}): Promise<Conversation[]> {
  return sendRequest({
    type: "GET_CONVERSATIONS",
    target: "offscreen",
    payload: filters,
  }) as Promise<Conversation[]>;
}

export async function getMessages(
  conversationId: number
): Promise<Message[]> {
  return sendRequest({
    type: "GET_MESSAGES",
    target: "offscreen",
    payload: { conversationId },
  }) as Promise<Message[]>;
}

export async function searchConversationIdsByText(
  query: string
): Promise<number[]> {
  return sendRequest(
    {
      type: "SEARCH_CONVERSATION_IDS_BY_TEXT",
      target: "offscreen",
      payload: { query },
    },
    FULL_TEXT_SEARCH_TIMEOUT_MS
  ) as Promise<number[]>;
}

export async function deleteConversation(id: number): Promise<void> {
  await sendRequest({
    type: "DELETE_CONVERSATION",
    target: "offscreen",
    payload: { id },
  });

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError;
  });
}

export async function updateConversationTitle(
  id: number,
  title: string
): Promise<Conversation> {
  const result = (await sendRequest({
    type: "UPDATE_CONVERSATION_TITLE",
    target: "offscreen",
    payload: { id, title },
  })) as { updated: boolean; conversation: Conversation };

  if (result.updated) {
    chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
      void chrome.runtime.lastError;
    });
  }

  return result.conversation;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  return sendRequest({
    type: "GET_DASHBOARD_STATS",
    target: "offscreen",
  }) as Promise<DashboardStats>;
}

export async function getStorageUsage(): Promise<StorageUsageSnapshot> {
  return sendRequest({
    type: "GET_STORAGE_USAGE",
    target: "offscreen",
  }) as Promise<StorageUsageSnapshot>;
}

export async function getDataOverview(): Promise<DataOverviewSnapshot> {
  return sendRequest({
    type: "GET_DATA_OVERVIEW",
    target: "offscreen",
  }) as Promise<DataOverviewSnapshot>;
}

export async function exportData(
  format: ExportFormat
): Promise<{ blob: Blob; filename: string; mime: string }> {
  const result = (await sendRequest({
    type: "EXPORT_DATA",
    target: "offscreen",
    payload: { format },
  })) as { content: string; filename: string; mime: string };

  return {
    blob: new Blob([result.content], { type: result.mime }),
    filename: result.filename,
    mime: result.mime,
  };
}

export async function clearAllData(): Promise<void> {
  await sendRequest({
    type: "CLEAR_ALL_DATA",
    target: "offscreen",
  });

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError;
  });
}

export async function clearInsightsCache(): Promise<void> {
  await sendRequest({
    type: "CLEAR_INSIGHTS_CACHE",
    target: "offscreen",
  });

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError;
  });
}

export async function getLlmSettings(): Promise<LlmConfig | null> {
  const result = (await sendRequest({
    type: "GET_LLM_SETTINGS",
    target: "offscreen",
  })) as { settings: LlmConfig | null };
  return result.settings;
}

export async function setLlmSettings(settings: LlmConfig): Promise<void> {
  await sendRequest({
    type: "SET_LLM_SETTINGS",
    target: "offscreen",
    payload: { settings },
  });
}

export async function testLlmConnection(): Promise<{ ok: boolean; message?: string }> {
  return sendRequest(
    {
      type: "TEST_LLM_CONNECTION",
      target: "offscreen",
    },
    TEST_CONNECTION_TIMEOUT_MS
  ) as Promise<{ ok: boolean; message?: string }>;
}

export async function getConversationSummary(
  conversationId: number
): Promise<SummaryRecord | null> {
  return sendRequest({
    type: "GET_CONVERSATION_SUMMARY",
    target: "offscreen",
    payload: { conversationId },
  }) as Promise<SummaryRecord | null>;
}

export async function generateConversationSummary(
  conversationId: number
): Promise<SummaryRecord> {
  return sendRequest(
    {
      type: "GENERATE_CONVERSATION_SUMMARY",
      target: "offscreen",
      payload: { conversationId },
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<SummaryRecord>;
}

export async function getWeeklyReport(
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord | null> {
  return sendRequest({
    type: "GET_WEEKLY_REPORT",
    target: "offscreen",
    payload: { rangeStart, rangeEnd },
  }) as Promise<WeeklyReportRecord | null>;
}

export async function generateWeeklyReport(
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord> {
  return sendRequest(
    {
      type: "GENERATE_WEEKLY_REPORT",
      target: "offscreen",
      payload: { rangeStart, rangeEnd },
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<WeeklyReportRecord>;
}

export async function getActiveCaptureStatus(): Promise<ActiveCaptureStatus> {
  return sendRequest({
    type: "GET_ACTIVE_CAPTURE_STATUS",
    target: "background",
  }) as Promise<ActiveCaptureStatus>;
}

export async function forceArchiveTransient(): Promise<ForceArchiveTransientResult> {
  return sendRequest({
    type: "FORCE_ARCHIVE_TRANSIENT",
    target: "background",
  }) as Promise<ForceArchiveTransientResult>;
}
