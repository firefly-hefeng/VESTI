// ============================================================
// --- types/index.ts ---
// All interface definitions for Vesti (kept in sync with frontend)
// ============================================================

import type { AstRoot, AstVersion } from "./ast";

export type Platform =
  | "ChatGPT"
  | "Claude"
  | "Gemini"
  | "DeepSeek"
  | "Qwen"
  | "Doubao";

export interface Conversation {
  id: number;
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

export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "ai";
  content_text: string;
  content_ast?: AstRoot | null;
  content_ast_version?: AstVersion | null;
  degraded_nodes_count?: number;
  created_at: number;
}

export interface DashboardStats {
  totalConversations: number;
  totalTokens: number;
  activeStreak: number;
  todayCount: number;
  platformDistribution: Record<Platform, number>;
  heatmapData: { date: string; count: number }[];
}

export type ExportFormat = "json" | "txt" | "md";

export interface ExportPayload {
  content: string;
  mime: string;
  filename: string;
}

export type StorageUsageStatus = "ok" | "warning" | "blocked";

export interface StorageUsageSnapshot {
  originUsed: number;
  originQuota: number | null;
  localUsed: number;
  unlimitedStorageEnabled: boolean;
  softLimit: number;
  hardLimit: number;
  status: StorageUsageStatus;
}

export type CapsuleState = "RECORDING" | "STANDBY" | "PAUSED" | "SAVED";

export type CaptureMode = "mirror" | "smart" | "manual";

export interface CaptureSettings {
  mode: CaptureMode;
  smartConfig: {
    minTurns: number;
    blacklistKeywords: string[];
  };
}

export type CaptureDecision = "committed" | "held" | "rejected";

export type CaptureDecisionReason =
  | "missing_conversation_id"
  | "force_archive"
  | "mode_mirror"
  | "mode_manual_hold"
  | "smart_below_min_turns"
  | "smart_keyword_blocked"
  | "smart_pass"
  | "empty_payload"
  | "storage_limit_blocked"
  | "persist_failed";

export interface CaptureDecisionMeta {
  mode: CaptureMode;
  decision: CaptureDecision;
  reason: CaptureDecisionReason;
  messageCount: number;
  turnCount: number;
  blacklistHit: boolean;
  forceFlag: boolean;
  intercepted: boolean;
  occurredAt: number;
}

export type ActiveCaptureStatusReason =
  | "ok"
  | "mode_mirror"
  | "unsupported_tab"
  | "no_transient"
  | "content_unreachable";

export interface ActiveCaptureStatus {
  mode: CaptureMode;
  supported: boolean;
  available: boolean;
  reason: ActiveCaptureStatusReason;
  platform?: Platform;
  sessionUUID?: string;
  transientKey?: string;
  messageCount?: number;
  turnCount?: number;
  lastDecision?: CaptureDecisionMeta;
  updatedAt?: number;
}

export interface ForceArchiveTransientResult {
  forced: true;
  saved: boolean;
  newMessages: number;
  conversationId?: number;
  decision: CaptureDecisionMeta;
}

export type PageId = "timeline" | "insights" | "data" | "settings";
export type UiThemeMode = "light" | "dark";

export interface UiSettings {
  themeMode: UiThemeMode;
}

export type UiSemanticLayer = "app_shell" | "artifact_content";
export type TypographySemantic = "ui_sans" | "reading_serif";
export type VisualDensityMode = "guardrail_v1_1" | "target_v1_2";

export type LlmProvider = "modelscope";
export type LlmAccessMode = "demo_proxy" | "custom_byok";
export type StreamMode = "off" | "on";
export type ReasoningPolicy = "off" | "auto" | "force";
export type CapabilitySource = "model_id_heuristic" | "provider_catalog";
export type ThinkHandlingPolicy = "strip" | "keep_debug" | "keep_raw";

export interface LlmConfig {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  updatedAt: number;
  mode?: LlmAccessMode;
  proxyBaseUrl?: string;
  proxyUrl?: string;
  proxyServiceToken?: string;
  gatewayLock?: "modelscope";
  customModelId?: string;
  streamMode?: StreamMode;
  reasoningPolicy?: ReasoningPolicy;
  capabilitySource?: CapabilitySource;
  thinkHandlingPolicy?: ThinkHandlingPolicy;
}

export type InsightFormat = "plain_text" | "structured_v1" | "fallback_plain_text";
export type InsightStatus = "ok" | "fallback";

export interface ConversationSummaryV1 {
  topic_title: string;
  key_takeaways: string[];
  sentiment: "neutral" | "positive" | "negative";
  action_items?: string[];
  tech_stack_detected: string[];
}

export interface ConversationSummaryV2 {
  core_question: string;
  thinking_journey: Array<{
    step: number;
    speaker: "User" | "AI";
    assertion: string;
    real_world_anchor: string | null;
  }>;
  key_insights: Array<{
    term: string;
    definition: string;
  }>;
  unresolved_threads: string[];
  meta_observations: {
    thinking_style: string;
    emotional_tone: string;
    depth_level: "superficial" | "moderate" | "deep";
  };
  actionable_next_steps: string[];
}

export interface ConversationSummaryV2Legacy {
  core_question: string;
  thinking_journey: {
    initial_state: string;
    key_turns: string[];
    final_understanding: string;
  };
  key_insights: string[];
  unresolved_threads: string[];
  meta_observations: {
    thinking_style: string;
    emotional_tone: string;
    depth_level: "superficial" | "moderate" | "deep";
  };
  actionable_next_steps: string[];
}

export interface WeeklyReportV1 {
  period_title: string;
  main_themes: string[];
  key_takeaways: string[];
  action_items?: string[];
  tech_stack_detected: string[];
}

export interface WeeklyLiteReportV1 {
  time_range: {
    start: string;
    end: string;
    total_conversations: number;
  };
  highlights: string[];
  recurring_questions: string[];
  cross_domain_echoes: Array<{
    domain_a: string;
    domain_b: string;
    shared_logic: string;
    evidence_ids: number[];
  }>;
  unresolved_threads: string[];
  suggested_focus: string[];
  evidence: Array<{
    conversation_id: number;
    note: string;
  }>;
  insufficient_data: boolean;
}

export interface SummaryRecord {
  id: number;
  conversationId: number;
  content: string;
  structured?:
    | ConversationSummaryV1
    | ConversationSummaryV2
    | ConversationSummaryV2Legacy
    | null;
  format?: InsightFormat;
  status?: InsightStatus;
  schemaVersion?: "conversation_summary.v1" | "conversation_summary.v2";
  modelId: string;
  createdAt: number;
  sourceUpdatedAt: number;
}

export interface WeeklyReportRecord {
  id: number;
  rangeStart: number;
  rangeEnd: number;
  content: string;
  structured?: WeeklyReportV1 | WeeklyLiteReportV1 | null;
  format?: InsightFormat;
  status?: InsightStatus;
  schemaVersion?: "weekly_report.v1" | "weekly_lite.v1";
  modelId: string;
  createdAt: number;
  sourceHash: string;
}

export type AsyncStatus = "idle" | "loading" | "ready" | "error";
