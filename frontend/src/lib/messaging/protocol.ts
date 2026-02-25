import type {
  ActiveCaptureStatus,
  CaptureDecisionMeta,
  Conversation,
  DataOverviewSnapshot,
  Message,
  DashboardStats,
  ExportFormat,
  ExportPayload,
  Platform,
  LlmConfig,
  ForceArchiveTransientResult,
  StorageUsageSnapshot,
  SummaryRecord,
  WeeklyReportRecord,
} from "../types";
import type { AstRoot, AstVersion } from "../types/ast";

export interface DateRange {
  start: number;
  end: number;
}

export interface ConversationFilters {
  platform?: Platform;
  search?: string;
  dateRange?: DateRange;
}

export interface ConversationDraft {
  uuid: string;
  platform: Platform;
  title: string;
  snippet: string;
  url: string;
  source_created_at: number | null;
  created_at: number;
  updated_at: number;
  message_count: number;
  turn_count: number;
  is_archived: boolean;
  is_trash: boolean;
  tags: string[];
}

export interface ParsedMessage {
  role: "user" | "ai";
  textContent: string;
  contentAst?: AstRoot | null;
  contentAstVersion?: AstVersion | null;
  degradedNodesCount?: number;
  htmlContent?: string;
  timestamp?: number;
}

export type InsightPipelineScope = "summary" | "weekly";

export type InsightPipelineStage =
  | "initiating_pipeline"
  | "distilling_core_logic"
  | "curating_summary"
  | "aggregating_weekly_digest"
  | "persisting_result"
  | "completed"
  | "degraded_fallback";

export type InsightPipelineStatus =
  | "in_progress"
  | "completed"
  | "degraded_fallback";

export type InsightPipelineRoute = "proxy" | "modelscope" | "unknown";

export interface InsightPipelineProgressPayload {
  pipelineId: string;
  scope: InsightPipelineScope;
  targetId: string;
  stage: InsightPipelineStage;
  status: InsightPipelineStatus;
  attempt: number;
  startedAt: number;
  updatedAt: number;
  route: InsightPipelineRoute;
  modelId: string;
  promptVersion: string;
  seq: number;
}

export interface InsightPipelineProgressMessage {
  type: "INSIGHT_PIPELINE_PROGRESS";
  payload: InsightPipelineProgressPayload;
}

export type RequestMessage =
  | {
      type: "CAPTURE_CONVERSATION";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: {
        conversation: ConversationDraft;
        messages: ParsedMessage[];
        forceFlag?: boolean;
      };
    }
  | {
      type: "GET_CONVERSATIONS";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload?: ConversationFilters;
    }
  | {
      type: "GET_MESSAGES";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { conversationId: number };
    }
  | {
      type: "SEARCH_CONVERSATION_IDS_BY_TEXT";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { query: string };
    }
  | {
      type: "DELETE_CONVERSATION";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { id: number };
    }
  | {
      type: "UPDATE_CONVERSATION_TITLE";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { id: number; title: string };
    }
  | {
      type: "GET_DASHBOARD_STATS";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
    }
  | {
      type: "GET_STORAGE_USAGE";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
    }
  | {
      type: "GET_DATA_OVERVIEW";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
    }
  | {
      type: "EXPORT_DATA";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { format: ExportFormat };
    }
  | {
      type: "CLEAR_ALL_DATA";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
    }
  | {
      type: "CLEAR_INSIGHTS_CACHE";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
    }
  | {
      type: "GET_LLM_SETTINGS";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
    }
  | {
      type: "SET_LLM_SETTINGS";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { settings: LlmConfig };
    }
  | {
      type: "TEST_LLM_CONNECTION";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
    }
  | {
      type: "GET_CONVERSATION_SUMMARY";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { conversationId: number };
    }
  | {
      type: "GENERATE_CONVERSATION_SUMMARY";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { conversationId: number };
    }
  | {
      type: "GET_WEEKLY_REPORT";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { rangeStart: number; rangeEnd: number };
    }
  | {
      type: "GENERATE_WEEKLY_REPORT";
      target?: "offscreen";
      via?: "background";
      requestId?: string;
      payload: { rangeStart: number; rangeEnd: number };
    }
  | {
      type: "GET_ACTIVE_CAPTURE_STATUS";
      target?: "background";
      requestId?: string;
    }
  | {
      type: "FORCE_ARCHIVE_TRANSIENT";
      target?: "background";
      requestId?: string;
    };

export type ResponseDataMap = {
  CAPTURE_CONVERSATION: {
    saved: boolean;
    newMessages: number;
    conversationId?: number;
    decision: CaptureDecisionMeta;
  };
  GET_CONVERSATIONS: Conversation[];
  GET_MESSAGES: Message[];
  SEARCH_CONVERSATION_IDS_BY_TEXT: number[];
  DELETE_CONVERSATION: { deleted: boolean };
  UPDATE_CONVERSATION_TITLE: { updated: boolean; conversation: Conversation };
  GET_DASHBOARD_STATS: DashboardStats;
  GET_STORAGE_USAGE: StorageUsageSnapshot;
  GET_DATA_OVERVIEW: DataOverviewSnapshot;
  EXPORT_DATA: ExportPayload;
  CLEAR_ALL_DATA: { cleared: boolean };
  CLEAR_INSIGHTS_CACHE: { cleared: boolean };
  GET_LLM_SETTINGS: { settings: LlmConfig | null };
  SET_LLM_SETTINGS: { saved: boolean };
  TEST_LLM_CONNECTION: { ok: boolean; message?: string };
  GET_CONVERSATION_SUMMARY: SummaryRecord | null;
  GENERATE_CONVERSATION_SUMMARY: SummaryRecord;
  GET_WEEKLY_REPORT: WeeklyReportRecord | null;
  GENERATE_WEEKLY_REPORT: WeeklyReportRecord;
  GET_ACTIVE_CAPTURE_STATUS: ActiveCaptureStatus;
  FORCE_ARCHIVE_TRANSIENT: ForceArchiveTransientResult;
};

export type ResponseMessage<T extends keyof ResponseDataMap = keyof ResponseDataMap> =
  | {
      ok: true;
      type: T;
      requestId?: string;
      data: ResponseDataMap[T];
    }
  | {
      ok: false;
      type: T;
      requestId?: string;
      error: string;
    };

export function isRequestMessage(value: unknown): value is RequestMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as { type?: unknown };
  return typeof msg.type === "string";
}

export function isInsightPipelineProgressMessage(
  value: unknown
): value is InsightPipelineProgressMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as {
    type?: unknown;
    payload?: Partial<InsightPipelineProgressPayload>;
  };
  if (message.type !== "INSIGHT_PIPELINE_PROGRESS") return false;
  if (!message.payload || typeof message.payload !== "object") return false;

  const payload = message.payload;
  return (
    typeof payload.pipelineId === "string" &&
    typeof payload.scope === "string" &&
    typeof payload.targetId === "string" &&
    typeof payload.stage === "string" &&
    typeof payload.status === "string" &&
    typeof payload.attempt === "number" &&
    typeof payload.startedAt === "number" &&
    typeof payload.updatedAt === "number" &&
    typeof payload.route === "string" &&
    typeof payload.modelId === "string" &&
    typeof payload.promptVersion === "string" &&
    typeof payload.seq === "number"
  );
}
