import type {
  Conversation,
  ConversationSummaryV1,
  ConversationSummaryV2,
  InsightFormat,
  InsightStatus,
  LlmConfig,
  Message,
  SummaryRecord,
  WeeklyLiteReportV1,
  WeeklyReportRecord,
  WeeklyReportV1,
} from "../types";
import {
  getConversationById,
  getSummary,
  getWeeklyReport,
  listConversationsByRange,
  listMessages,
  saveSummary,
  saveWeeklyReport,
} from "../db/repository";
import { getPrompt } from "../prompts";
import {
  buildWeeklySourceHash,
  callInference,
  sanitizeSummaryText,
  truncateForContext,
} from "./llmService";
import {
  insightSchemaHints,
  parseConversationSummaryObject,
  parseConversationSummaryV2Object,
  parseJsonObjectFromText,
  parseWeeklyLiteReportObject,
  parseWeeklyReportObject,
} from "./insightSchemas";
import { logger } from "../utils/logger";
import { getEffectiveModelId } from "./llmConfig";

const SUMMARY_MAX_CHARS = 12000;
const WEEKLY_MAX_CHARS = 12000;
const WEEKLY_DEFAULT_INPUT_LIMIT = 8;
const WEEKLY_CANDIDATE_LIMIT = 10;
const SUMMARY_REFERENCE_MAX_CHARS = 240;
const COMPACTION_OUTPUT_MIN_CHARS = 24;

type PromptType = "compaction" | "conversationSummary" | "weeklyDigest";
type GenerationMode = "plain_text" | "json_mode" | "prompt_json" | "fallback_text";
type SummarySchemaVersion = "conversation_summary.v1" | "conversation_summary.v2";
type WeeklySchemaVersion = "weekly_report.v1" | "weekly_lite.v1";
type SummaryStructured = ConversationSummaryV1 | ConversationSummaryV2;
type WeeklyStructured = WeeklyReportV1 | WeeklyLiteReportV1;
type SummaryPath = "compacted" | "direct";

interface ParseResult<T, TVersion extends string> {
  data: T | null;
  errors: string[];
  schemaVersion?: TVersion;
}

interface StructuredGenerationResult<T, TVersion extends string> {
  promptType: PromptType;
  promptVersion: string;
  structured: T | null;
  content: string;
  format: InsightFormat;
  status: InsightStatus;
  schemaVersion?: TVersion;
  mode: GenerationMode;
  attempt: number;
  validationErrors: string[];
  fallbackStage?: "none" | "repair_json" | "fallback_text";
  compactionUsed?: boolean;
  compactionFailed?: boolean;
  compactionCharsIn?: number;
  compactionCharsOut?: number;
  summaryPath?: SummaryPath;
}

interface PromptUsageLog {
  promptType: PromptType;
  promptVersion: string;
  mode: GenerationMode;
  attempt: number;
  validationErrors: string[];
  schemaVersion?: string;
  inputCount?: number;
  format?: InsightFormat;
  status?: InsightStatus;
  route?: "proxy" | "modelscope";
  fallbackStage?: "none" | "repair_json" | "fallback_text";
  compactionUsed?: boolean;
  compactionFailed?: boolean;
  compactionCharsIn?: number;
  compactionCharsOut?: number;
  summaryPath?: SummaryPath;
  latencyMs: number;
  success: boolean;
}

function logPromptUsage(entry: PromptUsageLog): void {
  const message = entry.success
    ? "Prompt usage"
    : "Prompt usage (fallback or validation issue)";

  if (entry.success) {
    logger.info("service", message, entry);
    return;
  }

  logger.warn("service", message, entry);
}

function renderSummaryTextV1(summary: ConversationSummaryV1): string {
  const lines = [summary.topic_title, ...summary.key_takeaways];
  if (summary.action_items?.length) {
    lines.push("Action Items:", ...summary.action_items);
  }
  return sanitizeSummaryText(lines.join("\n"));
}

function renderSummaryTextV2(summary: ConversationSummaryV2): string {
  const depthLabel =
    summary.meta_observations.depth_level === "deep"
      ? "深度拆解"
      : summary.meta_observations.depth_level === "moderate"
        ? "逐步深挖"
        : "轻量梳理";

  const lines = [`核心问题：${summary.core_question}`, "思考轨迹："];

  for (const step of summary.thinking_journey) {
    lines.push(`${step.step}. [${step.speaker}] ${step.assertion}`);
    if (step.real_world_anchor) {
      lines.push(`   实证案例：${step.real_world_anchor}`);
    }
  }

  lines.push("关键洞察：");
  for (const [index, insight] of summary.key_insights.entries()) {
    lines.push(`${index + 1}. ${insight.term}：${insight.definition}`);
  }

  if (summary.unresolved_threads.length) {
    lines.push("未决线索：", ...summary.unresolved_threads.map((item, index) => `${index + 1}. ${item}`));
  }

  if (summary.actionable_next_steps.length) {
    lines.push(
      "下一步建议：",
      ...summary.actionable_next_steps.map((item, index) => `${index + 1}. ${item}`)
    );
  }

  lines.push(
    `思维风格：${summary.meta_observations.thinking_style}`,
    `情绪基调：${summary.meta_observations.emotional_tone}`,
    `深度等级：${depthLabel}`
  );

  return sanitizeSummaryText(lines.join("\n"));
}

function renderSummaryText(
  summary: SummaryStructured,
  schemaVersion: SummarySchemaVersion
): string {
  if (schemaVersion === "conversation_summary.v2") {
    return renderSummaryTextV2(summary as ConversationSummaryV2);
  }
  return renderSummaryTextV1(summary as ConversationSummaryV1);
}

function renderWeeklyTextV1(report: WeeklyReportV1): string {
  const lines = [report.period_title, ...report.main_themes, ...report.key_takeaways];
  if (report.action_items?.length) {
    lines.push("Action Items:", ...report.action_items);
  }
  return sanitizeSummaryText(lines.join("\n"));
}

function renderWeeklyTextLite(report: WeeklyLiteReportV1): string {
  const lines = [
    `时间范围：${report.time_range.start} ~ ${report.time_range.end}`,
    `样本会话：${report.time_range.total_conversations}`,
    ...report.highlights.map((item, index) => `亮点 ${index + 1}: ${item}`),
  ];

  if (report.recurring_questions.length) {
    lines.push(
      "反复问题：",
      ...report.recurring_questions.map((item, index) => `${index + 1}. ${item}`)
    );
  }

  if (report.unresolved_threads.length) {
    lines.push(
      "未决线索：",
      ...report.unresolved_threads.map((item, index) => `${index + 1}. ${item}`)
    );
  }

  lines.push("下周聚焦：", ...report.suggested_focus.map((item, index) => `${index + 1}. ${item}`));

  if (report.insufficient_data) {
    lines.push("提示：本周样本较少，仅提供轻量复盘建议。");
  }

  return sanitizeSummaryText(lines.join("\n"));
}

function renderWeeklyText(
  report: WeeklyStructured,
  schemaVersion: WeeklySchemaVersion
): string {
  if (schemaVersion === "weekly_lite.v1") {
    return renderWeeklyTextLite(report as WeeklyLiteReportV1);
  }
  return renderWeeklyTextV1(report as WeeklyReportV1);
}

function formatRangeLabel(rangeStart: number, rangeEnd: number): string {
  const start = new Date(rangeStart).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
  const end = new Date(rangeEnd).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
  return `${start} - ${end}`;
}

function buildRepairPrompt(
  kind: "summary" | "weekly",
  rawOutput: string,
  validationErrors: string[]
): string {
  const schemaHint =
    kind === "summary" ? insightSchemaHints.summary_v2 : insightSchemaHints.weekly_lite;

  return `Fix the output below into a valid JSON object.
Return JSON only.

Target schema: ${JSON.stringify(schemaHint)}
Validation errors: ${validationErrors.join("; ") || "JSON parse failed"}

Raw output:
${rawOutput}`;
}

function toParsableJsonText(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, " ").trim();
}

function parseSummaryFromRaw(raw: string): ParseResult<SummaryStructured, SummarySchemaVersion> {
  try {
    const parsedJson = parseJsonObjectFromText(toParsableJsonText(raw));

    const v2 = parseConversationSummaryV2Object(parsedJson);
    if (v2.success) {
      return {
        data: v2.data,
        errors: [],
        schemaVersion: "conversation_summary.v2",
      };
    }

    const v1 = parseConversationSummaryObject(parsedJson);
    if (v1.success) {
      return {
        data: v1.data,
        errors: [],
        schemaVersion: "conversation_summary.v1",
      };
    }

    return {
      data: null,
      errors: [...v2.errors, ...v1.errors],
    };
  } catch (error) {
    return {
      data: null,
      errors: [(error as Error).message || "INVALID_JSON_PAYLOAD"],
    };
  }
}

function parseWeeklyFromRaw(raw: string): ParseResult<WeeklyStructured, WeeklySchemaVersion> {
  try {
    const parsedJson = parseJsonObjectFromText(toParsableJsonText(raw));

    const lite = parseWeeklyLiteReportObject(parsedJson);
    if (lite.success) {
      return {
        data: lite.data,
        errors: [],
        schemaVersion: "weekly_lite.v1",
      };
    }

    const legacy = parseWeeklyReportObject(parsedJson);
    if (legacy.success) {
      return {
        data: legacy.data,
        errors: [],
        schemaVersion: "weekly_report.v1",
      };
    }

    return {
      data: null,
      errors: [...lite.errors, ...legacy.errors],
    };
  } catch (error) {
    return {
      data: null,
      errors: [(error as Error).message || "INVALID_JSON_PAYLOAD"],
    };
  }
}

interface CompactionExecution {
  used: boolean;
  failed: boolean;
  content: string;
  charsIn: number;
  charsOut: number;
}

function countInputChars(messages: Message[]): number {
  return messages.reduce((sum, message) => sum + message.content_text.length, 0);
}

function buildSummaryPromptFromCompaction(
  conversation: Conversation,
  compactedContext: string
): string {
  return `请基于下面的压缩骨架输出 conversation_summary.v2 JSON。

对话标题：${conversation.title}
平台：${conversation.platform}
消息数：${conversation.message_count}

压缩骨架：
${compactedContext}

约束：
1) 只输出 JSON 对象。
2) 不引入骨架中不存在的新事实。
3) 如果某字段缺证据，使用空数组或 null。`;
}

async function runCompaction(
  settings: LlmConfig,
  conversation: Conversation,
  messages: Message[]
): Promise<CompactionExecution> {
  const prompt = getPrompt("compaction", { variant: "current" });
  const charsIn = countInputChars(messages);
  const payload = {
    conversationTitle: conversation.title,
    conversationPlatform: conversation.platform,
    conversationCreatedAt: conversation.created_at,
    messages,
    locale: "zh" as const,
  };

  const startedAt = Date.now();
  try {
    const compactionPrompt = truncateForContext(
      prompt.userTemplate(payload),
      SUMMARY_MAX_CHARS
    );
    const result = await callInference(settings, compactionPrompt, {
      systemPrompt: prompt.system,
    });
    const content = result.content.trim();
    const charsOut = content.length;

    if (charsOut < COMPACTION_OUTPUT_MIN_CHARS) {
      throw new Error("COMPACTION_OUTPUT_TOO_SHORT");
    }

    logPromptUsage({
      promptType: "compaction",
      promptVersion: prompt.version,
      mode: result.mode,
      attempt: 1,
      validationErrors: [],
      inputCount: messages.length,
      route: result.route,
      fallbackStage: "none",
      compactionUsed: true,
      compactionFailed: false,
      compactionCharsIn: charsIn,
      compactionCharsOut: charsOut,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return {
      used: true,
      failed: false,
      content,
      charsIn,
      charsOut,
    };
  } catch (error) {
    const reason = (error as Error).message || "COMPACTION_FAILED";
    logPromptUsage({
      promptType: "compaction",
      promptVersion: prompt.version,
      mode: "fallback_text",
      attempt: 1,
      validationErrors: [reason],
      inputCount: messages.length,
      fallbackStage: "fallback_text",
      compactionUsed: false,
      compactionFailed: true,
      compactionCharsIn: charsIn,
      compactionCharsOut: 0,
      latencyMs: Date.now() - startedAt,
      success: false,
    });

    return {
      used: false,
      failed: true,
      content: "",
      charsIn,
      charsOut: 0,
    };
  }
}

function buildSummaryReference(content: string): string {
  const compact = sanitizeSummaryText(content).replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(summary unavailable)";
  }
  if (compact.length <= SUMMARY_REFERENCE_MAX_CHARS) {
    return compact;
  }
  return `${compact.slice(0, SUMMARY_REFERENCE_MAX_CHARS)}...`;
}

function buildStructuredSummaryReference(
  structured: SummaryRecord["structured"]
): string | null {
  if (!structured || typeof structured !== "object") {
    return null;
  }

  if ("core_question" in structured) {
    const v2 = structured as ConversationSummaryV2;
    const parts: string[] = [];
    if (v2.core_question) {
      parts.push(v2.core_question);
    }
    if (Array.isArray(v2.key_insights) && v2.key_insights.length > 0) {
      parts.push(
        ...v2.key_insights
          .slice(0, 2)
          .map((item) => `${item.term}: ${item.definition}`)
      );
    }
    if (Array.isArray(v2.unresolved_threads) && v2.unresolved_threads.length > 0) {
      parts.push(v2.unresolved_threads[0]);
    }
    const text = parts.join(" ");
    return text ? buildSummaryReference(text) : null;
  }

  if ("topic_title" in structured) {
    const v1 = structured as ConversationSummaryV1;
    const text = [v1.topic_title, ...(v1.key_takeaways || []).slice(0, 2)].join(" ");
    return text ? buildSummaryReference(text) : null;
  }

  return null;
}

function buildSummaryReferenceFromRecord(summaryRecord: SummaryRecord): string {
  const structuredRef = buildStructuredSummaryReference(summaryRecord.structured);
  if (structuredRef) {
    return structuredRef;
  }
  return buildSummaryReference(summaryRecord.content || "");
}

function selectWeeklyCandidates(conversations: Conversation[]): Conversation[] {
  const sorted = [...conversations].sort((a, b) => b.created_at - a.created_at);
  return sorted.slice(0, WEEKLY_CANDIDATE_LIMIT);
}

async function buildWeeklyLiteInput(
  conversations: Conversation[]
): Promise<{
  selectedConversations: Conversation[];
  selectedSummaries: Array<{ conversationId: number; summary: string }>;
  summaryEvidenceCount: number;
  structuredEvidenceCount: number;
}> {
  const candidates = selectWeeklyCandidates(conversations);
  const summaries = await Promise.all(
    candidates.map(async (conversation) => {
      const summaryRecord = await getSummary(conversation.id);
      return {
        conversation,
        summaryRecord,
      };
    })
  );

  const ranked = summaries
    .sort((a, b) => {
      const aHasStructured = a.summaryRecord?.structured ? 1 : 0;
      const bHasStructured = b.summaryRecord?.structured ? 1 : 0;
      if (aHasStructured !== bHasStructured) {
        return bHasStructured - aHasStructured;
      }

      const aHasSummary = a.summaryRecord?.content ? 1 : 0;
      const bHasSummary = b.summaryRecord?.content ? 1 : 0;
      if (aHasSummary !== bHasSummary) {
        return bHasSummary - aHasSummary;
      }
      if (a.conversation.message_count !== b.conversation.message_count) {
        return b.conversation.message_count - a.conversation.message_count;
      }
      return b.conversation.created_at - a.conversation.created_at;
    })
    .slice(0, WEEKLY_DEFAULT_INPUT_LIMIT);

  const selectedConversations = ranked.map((item) => item.conversation);
  const selectedWithEvidence = ranked
    .filter((item) => !!item.summaryRecord?.content || !!item.summaryRecord?.structured);
  const selectedSummaries = selectedWithEvidence.map((item) => ({
    conversationId: item.conversation.id,
    summary: buildSummaryReferenceFromRecord(item.summaryRecord!),
  }));

  return {
    selectedConversations,
    selectedSummaries,
    summaryEvidenceCount: selectedWithEvidence.length,
    structuredEvidenceCount: selectedWithEvidence.filter(
      (item) => !!item.summaryRecord?.structured
    ).length,
  };
}

async function generateStructuredSummary(
  settings: LlmConfig,
  conversation: Conversation,
  messages: Message[]
): Promise<
  StructuredGenerationResult<SummaryStructured, SummarySchemaVersion>
> {
  const prompt = getPrompt("conversationSummary", { variant: "current" });
  const compaction = await runCompaction(settings, conversation, messages);
  const summaryPath: SummaryPath = compaction.used ? "compacted" : "direct";

  const payload = {
    conversationTitle: conversation.title,
    conversationPlatform: conversation.platform,
    conversationCreatedAt: conversation.created_at,
    messages,
    locale: "zh" as const,
  };

  const summaryPromptInput = compaction.used
    ? buildSummaryPromptFromCompaction(conversation, compaction.content)
    : prompt.userTemplate(payload);

  const firstAttemptStartedAt = Date.now();
  const primaryPrompt = truncateForContext(
    summaryPromptInput,
    SUMMARY_MAX_CHARS
  );
  const first = await callInference(settings, primaryPrompt, {
    responseFormat: "json_object",
    systemPrompt: prompt.system,
  });
  const firstParsed = parseSummaryFromRaw(first.content);

  logPromptUsage({
    promptType: "conversationSummary",
    promptVersion: prompt.version,
    mode: first.mode,
    attempt: 1,
    validationErrors: firstParsed.errors,
    schemaVersion: firstParsed.schemaVersion,
    inputCount: messages.length,
    route: first.route,
    fallbackStage: firstParsed.data ? "none" : "repair_json",
    compactionUsed: compaction.used,
    compactionFailed: compaction.failed,
    compactionCharsIn: compaction.charsIn,
    compactionCharsOut: compaction.charsOut,
    summaryPath,
    latencyMs: Date.now() - firstAttemptStartedAt,
    success: !!firstParsed.data,
  });

  if (firstParsed.data && firstParsed.schemaVersion) {
    return {
      promptType: "conversationSummary",
      promptVersion: prompt.version,
      structured: firstParsed.data,
      content: renderSummaryText(firstParsed.data, firstParsed.schemaVersion),
      format: "structured_v1",
      status: "ok",
      schemaVersion: firstParsed.schemaVersion,
      mode: first.mode,
      attempt: 1,
      validationErrors: [],
      fallbackStage: "none",
      compactionUsed: compaction.used,
      compactionFailed: compaction.failed,
      compactionCharsIn: compaction.charsIn,
      compactionCharsOut: compaction.charsOut,
      summaryPath,
    };
  }

  const secondAttemptStartedAt = Date.now();
  const repairPrompt = truncateForContext(
    buildRepairPrompt("summary", first.content, firstParsed.errors),
    SUMMARY_MAX_CHARS
  );
  const second = await callInference(settings, repairPrompt, {
    responseFormat: "json_object",
    systemPrompt: prompt.system,
  });
  const secondParsed = parseSummaryFromRaw(second.content);

  logPromptUsage({
    promptType: "conversationSummary",
    promptVersion: prompt.version,
    mode: second.mode,
    attempt: 2,
    validationErrors: secondParsed.errors,
    schemaVersion: secondParsed.schemaVersion,
    inputCount: messages.length,
    route: second.route,
    fallbackStage: secondParsed.data ? "none" : "fallback_text",
    compactionUsed: compaction.used,
    compactionFailed: compaction.failed,
    compactionCharsIn: compaction.charsIn,
    compactionCharsOut: compaction.charsOut,
    summaryPath,
    latencyMs: Date.now() - secondAttemptStartedAt,
    success: !!secondParsed.data,
  });

  if (secondParsed.data && secondParsed.schemaVersion) {
    return {
      promptType: "conversationSummary",
      promptVersion: prompt.version,
      structured: secondParsed.data,
      content: renderSummaryText(secondParsed.data, secondParsed.schemaVersion),
      format: "structured_v1",
      status: "ok",
      schemaVersion: secondParsed.schemaVersion,
      mode: second.mode,
      attempt: 2,
      validationErrors: firstParsed.errors,
      fallbackStage: "repair_json",
      compactionUsed: compaction.used,
      compactionFailed: compaction.failed,
      compactionCharsIn: compaction.charsIn,
      compactionCharsOut: compaction.charsOut,
      summaryPath,
    };
  }

  const fallbackStartedAt = Date.now();
  const fallbackPrompt = truncateForContext(
    prompt.fallbackTemplate(payload),
    SUMMARY_MAX_CHARS
  );
  const fallbackResponse = await callInference(settings, fallbackPrompt, {
    systemPrompt: prompt.fallbackSystem ?? prompt.system,
  });
  const fallbackContent =
    sanitizeSummaryText(fallbackResponse.content) || "摘要生成失败，请重试。";

  logPromptUsage({
    promptType: "conversationSummary",
    promptVersion: prompt.version,
    mode: "fallback_text",
    attempt: 3,
    validationErrors: [...firstParsed.errors, ...secondParsed.errors],
    inputCount: messages.length,
    route: fallbackResponse.route,
    fallbackStage: "fallback_text",
    compactionUsed: compaction.used,
    compactionFailed: compaction.failed,
    compactionCharsIn: compaction.charsIn,
    compactionCharsOut: compaction.charsOut,
    summaryPath,
    latencyMs: Date.now() - fallbackStartedAt,
    format: "fallback_plain_text",
    status: "fallback",
    success: false,
  });

  return {
    promptType: "conversationSummary",
    promptVersion: prompt.version,
    structured: null,
    content: fallbackContent,
    format: "fallback_plain_text",
    status: "fallback",
    mode: "fallback_text",
    attempt: 3,
    validationErrors: [...firstParsed.errors, ...secondParsed.errors],
    fallbackStage: "fallback_text",
    compactionUsed: compaction.used,
    compactionFailed: compaction.failed,
    compactionCharsIn: compaction.charsIn,
    compactionCharsOut: compaction.charsOut,
    summaryPath,
  };
}

async function generateStructuredWeekly(
  settings: LlmConfig,
  conversations: Conversation[],
  rangeStart: number,
  rangeEnd: number
): Promise<StructuredGenerationResult<WeeklyStructured, WeeklySchemaVersion>> {
  const prompt = getPrompt("weeklyDigest", { variant: "current" });

  if (conversations.length === 0) {
    const emptyReport: WeeklyLiteReportV1 = {
      time_range: {
        start: new Date(rangeStart).toISOString().slice(0, 10),
        end: new Date(rangeEnd).toISOString().slice(0, 10),
        total_conversations: 0,
      },
      highlights: ["该时间范围内没有可汇总的会话。"],
      recurring_questions: [],
      unresolved_threads: [],
      suggested_focus: ["继续记录更多对话，以便下周生成更有依据的复盘。"],
      evidence: [],
      insufficient_data: true,
    };

    return {
      promptType: "weeklyDigest",
      promptVersion: prompt.version,
      structured: emptyReport,
      content: renderWeeklyText(emptyReport, "weekly_lite.v1"),
      format: "structured_v1",
      status: "ok",
      schemaVersion: "weekly_lite.v1",
      mode: "prompt_json",
      attempt: 0,
      validationErrors: [],
      fallbackStage: "none",
    };
  }

  const weeklyInput = await buildWeeklyLiteInput(conversations);
  const payload = {
    conversations: weeklyInput.selectedConversations,
    selectedSummaries: weeklyInput.selectedSummaries,
    rangeStart,
    rangeEnd,
    maxConversations: weeklyInput.selectedConversations.length,
    locale: "zh" as const,
  };

  logger.info("service", "Weekly input assembled", {
    candidateCount: conversations.length,
    selectedConversationCount: weeklyInput.selectedConversations.length,
    summaryEvidenceCount: weeklyInput.summaryEvidenceCount,
    structuredEvidenceCount: weeklyInput.structuredEvidenceCount,
  });

  const firstAttemptStartedAt = Date.now();
  const primaryPrompt = truncateForContext(
    prompt.userTemplate(payload),
    WEEKLY_MAX_CHARS
  );
  const first = await callInference(settings, primaryPrompt, {
    responseFormat: "json_object",
    systemPrompt: prompt.system,
  });
  const firstParsed = parseWeeklyFromRaw(first.content);

  logPromptUsage({
    promptType: "weeklyDigest",
    promptVersion: prompt.version,
    mode: first.mode,
    attempt: 1,
    validationErrors: firstParsed.errors,
    schemaVersion: firstParsed.schemaVersion,
    inputCount: weeklyInput.selectedConversations.length,
    route: first.route,
    fallbackStage: firstParsed.data ? "none" : "repair_json",
    latencyMs: Date.now() - firstAttemptStartedAt,
    success: !!firstParsed.data,
  });

  if (firstParsed.data && firstParsed.schemaVersion) {
    return {
      promptType: "weeklyDigest",
      promptVersion: prompt.version,
      structured: firstParsed.data,
      content: renderWeeklyText(firstParsed.data, firstParsed.schemaVersion),
      format: "structured_v1",
      status: "ok",
      schemaVersion: firstParsed.schemaVersion,
      mode: first.mode,
      attempt: 1,
      validationErrors: [],
      fallbackStage: "none",
    };
  }

  const secondAttemptStartedAt = Date.now();
  const repairPrompt = truncateForContext(
    buildRepairPrompt("weekly", first.content, firstParsed.errors),
    WEEKLY_MAX_CHARS
  );
  const second = await callInference(settings, repairPrompt, {
    responseFormat: "json_object",
    systemPrompt: prompt.system,
  });
  const secondParsed = parseWeeklyFromRaw(second.content);

  logPromptUsage({
    promptType: "weeklyDigest",
    promptVersion: prompt.version,
    mode: second.mode,
    attempt: 2,
    validationErrors: secondParsed.errors,
    schemaVersion: secondParsed.schemaVersion,
    inputCount: weeklyInput.selectedConversations.length,
    route: second.route,
    fallbackStage: secondParsed.data ? "none" : "fallback_text",
    latencyMs: Date.now() - secondAttemptStartedAt,
    success: !!secondParsed.data,
  });

  if (secondParsed.data && secondParsed.schemaVersion) {
    return {
      promptType: "weeklyDigest",
      promptVersion: prompt.version,
      structured: secondParsed.data,
      content: renderWeeklyText(secondParsed.data, secondParsed.schemaVersion),
      format: "structured_v1",
      status: "ok",
      schemaVersion: secondParsed.schemaVersion,
      mode: second.mode,
      attempt: 2,
      validationErrors: firstParsed.errors,
      fallbackStage: "repair_json",
    };
  }

  const fallbackStartedAt = Date.now();
  const fallbackPrompt = truncateForContext(
    prompt.fallbackTemplate(payload),
    WEEKLY_MAX_CHARS
  );
  const fallbackResponse = await callInference(settings, fallbackPrompt, {
    systemPrompt: prompt.fallbackSystem ?? prompt.system,
  });
  const fallbackContent =
    sanitizeSummaryText(fallbackResponse.content) || "周报生成失败，请重试。";

  logPromptUsage({
    promptType: "weeklyDigest",
    promptVersion: prompt.version,
    mode: "fallback_text",
    attempt: 3,
    validationErrors: [...firstParsed.errors, ...secondParsed.errors],
    inputCount: weeklyInput.selectedConversations.length,
    route: fallbackResponse.route,
    fallbackStage: "fallback_text",
    latencyMs: Date.now() - fallbackStartedAt,
    format: "fallback_plain_text",
    status: "fallback",
    success: false,
  });

  return {
    promptType: "weeklyDigest",
    promptVersion: prompt.version,
    structured: null,
    content: fallbackContent,
    format: "fallback_plain_text",
    status: "fallback",
    mode: "fallback_text",
    attempt: 3,
    validationErrors: [...firstParsed.errors, ...secondParsed.errors],
    fallbackStage: "fallback_text",
  };
}

export async function generateConversationSummary(
  settings: LlmConfig,
  conversationId: number
): Promise<SummaryRecord> {
  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const messages = await listMessages(conversationId);
  if (messages.length === 0) {
    throw new Error("CONVERSATION_MESSAGES_EMPTY");
  }

  const previous = await getSummary(conversationId);
  const generated = await generateStructuredSummary(settings, conversation, messages);

  logger.info("service", "Summary generation result", {
    promptType: generated.promptType,
    promptVersion: generated.promptVersion,
    schemaVersion: generated.schemaVersion,
    mode: generated.mode,
    attempt: generated.attempt,
    validationErrors: generated.validationErrors,
    format: generated.format,
    status: generated.status,
    fallbackStage: generated.fallbackStage ?? "none",
    compactionUsed: generated.compactionUsed ?? false,
    compactionFailed: generated.compactionFailed ?? false,
    compactionCharsIn: generated.compactionCharsIn ?? 0,
    compactionCharsOut: generated.compactionCharsOut ?? 0,
    summaryPath: generated.summaryPath ?? "direct",
  });

  if (previous?.status === "fallback" && generated.status === "fallback") {
    logger.warn("service", "Summary hit consecutive fallback", {
      conversationId,
      promptVersion: generated.promptVersion,
      schemaVersion: generated.schemaVersion,
      validationErrors: generated.validationErrors,
    });
  }

  return saveSummary({
    conversationId: conversation.id,
    content: generated.content,
    structured: generated.structured,
    format: generated.format,
    status: generated.status,
    schemaVersion: generated.schemaVersion,
    modelId: getEffectiveModelId(settings),
    createdAt: Date.now(),
    sourceUpdatedAt: conversation.updated_at,
  });
}

export async function generateWeeklyReport(
  settings: LlmConfig,
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord> {
  const conversations = await listConversationsByRange(rangeStart, rangeEnd);
  const sourceHash = buildWeeklySourceHash(conversations, rangeStart, rangeEnd);
  const previous = await getWeeklyReport(rangeStart, rangeEnd);

  const generated = await generateStructuredWeekly(
    settings,
    conversations,
    rangeStart,
    rangeEnd
  );

  logger.info("service", "Weekly generation result", {
    promptType: generated.promptType,
    promptVersion: generated.promptVersion,
    schemaVersion: generated.schemaVersion,
    mode: generated.mode,
    attempt: generated.attempt,
    validationErrors: generated.validationErrors,
    format: generated.format,
    status: generated.status,
    fallbackStage: generated.fallbackStage ?? "none",
  });

  if (previous?.status === "fallback" && generated.status === "fallback") {
    logger.warn("service", "Weekly report hit consecutive fallback", {
      rangeStart,
      rangeEnd,
      promptVersion: generated.promptVersion,
      schemaVersion: generated.schemaVersion,
      validationErrors: generated.validationErrors,
    });
  }

  return saveWeeklyReport({
    rangeStart,
    rangeEnd,
    content: generated.content,
    structured: generated.structured,
    format: generated.format,
    status: generated.status,
    schemaVersion: generated.schemaVersion,
    modelId: getEffectiveModelId(settings),
    createdAt: Date.now(),
    sourceHash,
  });
}
