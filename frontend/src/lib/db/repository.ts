import type {
  Conversation,
  ConversationSummaryV2,
  DataOverviewSnapshot,
  ExportFormat,
  ExportPayload,
  Message,
  DashboardStats,
  Platform,
  InsightFormat,
  InsightStatus,
  StorageUsageSnapshot,
  SummaryRecord,
  WeeklyLiteReportV1,
  WeeklyReportRecord,
} from "../types";
import type { ConversationFilters } from "../messaging/protocol";
import {
  buildExportJsonV1,
  buildExportMdV1,
  buildExportTxtV1,
} from "../services/exportSerializers";
import { db } from "./schema";
import { enforceStorageWriteGuard, getStorageUsageSnapshot } from "./storageLimits";
import type {
  ConversationRecord,
  MessageRecord,
  SummaryRecordRecord,
  WeeklyReportRecordRecord,
} from "./schema";

function toConversation(record: ConversationRecord): Conversation {
  if (record.id === undefined) {
    throw new Error("Conversation record missing id");
  }
  const messageCount =
    typeof record.message_count === "number" && Number.isFinite(record.message_count)
      ? Math.max(0, Math.floor(record.message_count))
      : 0;
  const turnCount =
    typeof record.turn_count === "number" && Number.isFinite(record.turn_count)
      ? Math.max(0, Math.floor(record.turn_count))
      : Math.floor(messageCount / 2);

  return {
    ...(record as Conversation),
    turn_count: turnCount,
  };
}

function toMessage(record: MessageRecord): Message {
  if (record.id === undefined) {
    throw new Error("Message record missing id");
  }
  const degradedNodesCount =
    typeof record.degraded_nodes_count === "number" &&
    Number.isFinite(record.degraded_nodes_count)
      ? Math.max(0, Math.floor(record.degraded_nodes_count))
      : 0;

  return {
    ...(record as Message),
    content_ast: record.content_ast ?? null,
    content_ast_version: record.content_ast_version ?? null,
    degraded_nodes_count: degradedNodesCount,
  };
}

function toSummary(record: SummaryRecordRecord): SummaryRecord {
  if (record.id === undefined) {
    throw new Error("Summary record missing id");
  }

  const summary = record as SummaryRecord;
  const format: InsightFormat =
    summary.format ?? (summary.structured ? "structured_v1" : "plain_text");
  const status: InsightStatus =
    summary.status ?? (summary.structured ? "ok" : "fallback");

  const isV2Structured = (value: unknown): value is ConversationSummaryV2 => {
    if (!value || typeof value !== "object") return false;
    return "core_question" in value && "thinking_journey" in value;
  };

  return {
    ...summary,
    structured: summary.structured ?? null,
    format,
    status,
    schemaVersion:
      summary.schemaVersion ??
      (isV2Structured(summary.structured)
        ? "conversation_summary.v2"
        : summary.structured
          ? "conversation_summary.v1"
          : undefined),
  };
}

function toWeeklyReport(record: WeeklyReportRecordRecord): WeeklyReportRecord {
  if (record.id === undefined) {
    throw new Error("Weekly report record missing id");
  }

  const weekly = record as WeeklyReportRecord;
  const format: InsightFormat =
    weekly.format ?? (weekly.structured ? "structured_v1" : "plain_text");
  const status: InsightStatus =
    weekly.status ?? (weekly.structured ? "ok" : "fallback");

  const isWeeklyLiteStructured = (value: unknown): value is WeeklyLiteReportV1 => {
    if (!value || typeof value !== "object") return false;
    return "time_range" in value && "highlights" in value;
  };

  return {
    ...weekly,
    structured: weekly.structured ?? null,
    format,
    status,
    schemaVersion:
      weekly.schemaVersion ??
      (isWeeklyLiteStructured(weekly.structured)
        ? "weekly_lite.v1"
        : weekly.structured
          ? "weekly_report.v1"
          : undefined),
  };
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function initPlatformDistribution(): Record<Platform, number> {
  return {
    ChatGPT: 0,
    Claude: 0,
    Gemini: 0,
    DeepSeek: 0,
    Qwen: 0,
    Doubao: 0,
  };
}

const MAX_CONVERSATION_TITLE_LENGTH = 120;

export async function listConversations(
  filters?: ConversationFilters
): Promise<Conversation[]> {
  let results: ConversationRecord[];

  if (filters?.platform) {
    results = await db.conversations
      .where("platform")
      .equals(filters.platform)
      .toArray();
  } else {
    results = await db.conversations.toArray();
  }

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.snippet.toLowerCase().includes(q)
    );
  }

  if (filters?.dateRange) {
    results = results.filter(
      (c) =>
        c.created_at >= filters.dateRange!.start &&
        c.created_at <= filters.dateRange!.end
    );
  }

  return results
    .sort((a, b) => b.updated_at - a.updated_at)
    .map(toConversation);
}

export async function getConversationById(id: number): Promise<Conversation | null> {
  const record = await db.conversations.get(id);
  return record ? toConversation(record) : null;
}

export async function listConversationsByRange(
  rangeStart: number,
  rangeEnd: number
): Promise<Conversation[]> {
  const records = await db.conversations
    .where("created_at")
    .between(rangeStart, rangeEnd, true, true)
    .toArray();
  return records
    .sort((a, b) => b.updated_at - a.updated_at)
    .map(toConversation);
}

export async function listMessages(
  conversationId: number
): Promise<Message[]> {
  const records = await db.messages
    .where("conversation_id")
    .equals(conversationId)
    .sortBy("created_at");

  return records.map(toMessage);
}

export async function searchConversationIdsByText(query: string): Promise<number[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return [];
  }

  const conversationIds = new Set<number>();
  await db.messages.toCollection().each((record) => {
    const conversationId = record.conversation_id;
    if (typeof conversationId !== "number" || conversationIds.has(conversationId)) {
      return;
    }

    const content = record.content_text;
    if (typeof content !== "string") {
      return;
    }

    if (content.toLowerCase().includes(normalizedQuery)) {
      conversationIds.add(conversationId);
    }
  });

  return Array.from(conversationIds);
}

export async function deleteConversation(id: number): Promise<boolean> {
  await db.transaction("rw", db.conversations, db.messages, async () => {
    await db.messages.where("conversation_id").equals(id).delete();
    await db.conversations.delete(id);
  });
  return true;
}

export async function updateConversationTitle(
  id: number,
  title: string
): Promise<Conversation> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new Error("TITLE_EMPTY");
  }
  if (normalizedTitle.length > MAX_CONVERSATION_TITLE_LENGTH) {
    throw new Error("TITLE_TOO_LONG");
  }

  const existing = await db.conversations.get(id);
  if (!existing) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }
  if (existing.id === undefined) {
    throw new Error("Conversation record missing id");
  }
  if (existing.title === normalizedTitle) {
    return toConversation(existing);
  }

  await db.conversations.update(id, { title: normalizedTitle });
  return toConversation({ ...existing, title: normalizedTitle, id: existing.id });
}

export async function clearAllData(): Promise<boolean> {
  await db.transaction(
    "rw",
    db.conversations,
    db.messages,
    db.summaries,
    db.weekly_reports,
    async () => {
      await db.messages.clear();
      await db.conversations.clear();
      await db.summaries.clear();
      await db.weekly_reports.clear();
    }
  );
  return true;
}

export async function clearInsightsCache(): Promise<boolean> {
  await db.transaction(
    "rw",
    db.summaries,
    db.weekly_reports,
    async () => {
      await db.summaries.clear();
      await db.weekly_reports.clear();
    }
  );
  return true;
}

async function collectExportDataset() {
  const conversations = (await db.conversations.toArray()).map(toConversation);
  const messages = (await db.messages.toArray()).map(toMessage);
  const summaries = (await db.summaries.toArray()).map(toSummary);
  const weeklyReports = (await db.weekly_reports.toArray()).map(toWeeklyReport);
  return { conversations, messages, summaries, weeklyReports };
}

export async function getStorageUsage(): Promise<StorageUsageSnapshot> {
  return getStorageUsageSnapshot();
}

export async function getDataOverview(): Promise<DataOverviewSnapshot> {
  const [storage, totalConversations, summaryRecordCount, weeklyReportCount] =
    await Promise.all([
      getStorageUsageSnapshot(),
      db.conversations.count(),
      db.summaries.count(),
      db.weekly_reports.count(),
    ]);

  const [uniqueSummaryConversationIds, lastSummary] = await Promise.all([
    db.summaries.orderBy("conversationId").uniqueKeys(),
    db.summaries.orderBy("createdAt").last(),
  ]);

  return {
    storage,
    totalConversations,
    compactedThreads: uniqueSummaryConversationIds.length,
    summaryRecordCount,
    weeklyReportCount,
    lastCompactionAt:
      typeof lastSummary?.createdAt === "number" ? lastSummary.createdAt : null,
    indexedDbName: db.name,
  };
}

export async function exportAllData(format: ExportFormat): Promise<ExportPayload> {
  const dataset = await collectExportDataset();
  if (format === "txt") {
    return buildExportTxtV1(dataset);
  }
  if (format === "md") {
    return buildExportMdV1(dataset);
  }
  return buildExportJsonV1(dataset);
}

export async function exportAllDataAsJson(): Promise<string> {
  const payload = await exportAllData("json");
  return payload.content;
}

export async function getSummary(
  conversationId: number
): Promise<SummaryRecord | null> {
  const record = await db.summaries
    .where("conversationId")
    .equals(conversationId)
    .last();
  return record ? toSummary(record) : null;
}

export async function saveSummary(
  record: Omit<SummaryRecord, "id">
): Promise<SummaryRecord> {
  await enforceStorageWriteGuard();

  const existing = await db.summaries
    .where("conversationId")
    .equals(record.conversationId)
    .first();

  if (existing?.id !== undefined) {
    await db.summaries.update(existing.id, record);
    return toSummary({ ...existing, ...record, id: existing.id });
  }

  const id = await db.summaries.add(record);
  return toSummary({ ...record, id });
}

export async function getWeeklyReport(
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord | null> {
  const record = await db.weekly_reports
    .where("rangeStart")
    .equals(rangeStart)
    .and((item) => item.rangeEnd === rangeEnd)
    .first();
  return record ? toWeeklyReport(record) : null;
}

export async function saveWeeklyReport(
  record: Omit<WeeklyReportRecord, "id">
): Promise<WeeklyReportRecord> {
  await enforceStorageWriteGuard();

  const existing = await db.weekly_reports
    .where("rangeStart")
    .equals(record.rangeStart)
    .and((item) => item.rangeEnd === record.rangeEnd)
    .first();

  if (existing?.id !== undefined) {
    await db.weekly_reports.update(existing.id, record);
    return toWeeklyReport({ ...existing, ...record, id: existing.id });
  }

  const id = await db.weekly_reports.add(record);
  return toWeeklyReport({ ...record, id });
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const conversations = await db.conversations.toArray();
  const distribution = initPlatformDistribution();

  for (const c of conversations) {
    distribution[c.platform] += 1;
  }

  const today = dayKey(Date.now());
  const todayCount = conversations.filter(
    (c) => dayKey(c.created_at) === today
  ).length;

  const daysWithConversations = new Set(
    conversations.map((c) => dayKey(c.created_at))
  );

  let activeStreak = 0;
  let cursor = new Date();
  while (daysWithConversations.has(dayKey(cursor.getTime()))) {
    activeStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const heatmapData = Array.from(daysWithConversations).map((d) => ({
    date: d,
    count: conversations.filter((c) => dayKey(c.created_at) === d).length,
  }));

  return {
    totalConversations: conversations.length,
    totalTokens: 0,
    activeStreak,
    todayCount,
    platformDistribution: distribution,
    heatmapData,
  };
}
