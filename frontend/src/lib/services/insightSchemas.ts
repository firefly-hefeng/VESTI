import { z } from "zod";
import type {
  ConversationSummaryV1,
  ConversationSummaryV2,
  ConversationSummaryV2Legacy,
  WeeklyLiteReportV1,
  WeeklyReportV1,
} from "../types";

const MAX_TITLE_LENGTH = 80;
const MAX_PERIOD_LENGTH = 120;
const MAX_LIST_ITEM_LENGTH = 280;
const MAX_LIST_ITEMS = 8;
const MAX_META_LENGTH = 180;
const MAX_ASSERTION_LENGTH = 520;
const MAX_ANCHOR_LENGTH = 320;
const MAX_TERM_LENGTH = 120;
const MAX_DEFINITION_LENGTH = 320;
const MAX_WEEKLY_CROSS_DOMAIN_ECHOES = 4;
const DEFAULT_WEEKLY_HIGHLIGHT = "本周形成了可复用的阶段性结论。";
const DEFAULT_WEEKLY_SUGGESTED_FOCUS = "下周优先推进一个高价值问题并记录验证结果。";

type WeeklyCrossDomainEcho = WeeklyLiteReportV1["cross_domain_echoes"][number];
type WeeklyNarrativeField =
  | "highlights"
  | "recurring_questions"
  | "unresolved_threads"
  | "suggested_focus";

export type WeeklySemanticIssueCode =
  | "LOW_SIGNAL_HIGHLIGHT"
  | "LOW_SIGNAL_RECURRING"
  | "LOW_SIGNAL_UNRESOLVED"
  | "LOW_SIGNAL_SUGGESTED_FOCUS"
  | "EMPTY_VALID_HIGHLIGHTS"
  | "RECURRING_NOT_QUESTIONLIKE"
  | "EMPTY_VALID_SUGGESTED_FOCUS";

export interface WeeklySemanticQuality {
  passed: boolean;
  issueCodes: WeeklySemanticIssueCode[];
  highlightsCount: number;
  recurringCount: number;
  unresolvedCount: number;
  suggestedCount: number;
}

const summarySchema = z.object({
  topic_title: z.string().min(1).max(MAX_TITLE_LENGTH),
  key_takeaways: z.array(z.string().min(1)).min(1),
  sentiment: z.enum(["neutral", "positive", "negative"]),
  action_items: z.array(z.string().min(1)).optional(),
  tech_stack_detected: z.array(z.string().min(1)),
});

const weeklySchema = z.object({
  period_title: z.string().min(1).max(MAX_PERIOD_LENGTH),
  main_themes: z.array(z.string().min(1)).min(1),
  key_takeaways: z.array(z.string().min(1)).min(1),
  action_items: z.array(z.string().min(1)).optional(),
  tech_stack_detected: z.array(z.string().min(1)),
});

const summaryV2SchemaNew = z.object({
  core_question: z.string().min(1).max(MAX_META_LENGTH),
  thinking_journey: z
    .array(
      z.object({
        step: z.number().int().min(1),
        speaker: z.enum(["User", "AI"]),
        assertion: z.string().min(1).max(MAX_ASSERTION_LENGTH),
        real_world_anchor: z.string().min(1).max(MAX_ANCHOR_LENGTH).nullable(),
      })
    )
    .min(1)
    .max(12),
  key_insights: z
    .array(
      z.object({
        term: z.string().min(1).max(MAX_TERM_LENGTH),
        definition: z.string().min(1).max(MAX_DEFINITION_LENGTH),
      })
    )
    .max(8),
  unresolved_threads: z.array(z.string().min(1)).max(8),
  meta_observations: z.object({
    thinking_style: z.string().min(1).max(MAX_META_LENGTH),
    emotional_tone: z.string().min(1).max(MAX_META_LENGTH),
    depth_level: z.enum(["superficial", "moderate", "deep"]),
  }),
  actionable_next_steps: z.array(z.string().min(1)).max(8),
});

const summaryV2SchemaLegacy = z.object({
  core_question: z.string().min(1).max(MAX_META_LENGTH),
  thinking_journey: z.object({
    initial_state: z.string().min(1).max(MAX_LIST_ITEM_LENGTH),
    key_turns: z.array(z.string().min(1)).min(1).max(8),
    final_understanding: z.string().min(1).max(MAX_LIST_ITEM_LENGTH),
  }),
  key_insights: z.array(z.string().min(1)).min(1).max(8),
  unresolved_threads: z.array(z.string().min(1)).max(8),
  meta_observations: z.object({
    thinking_style: z.string().min(1).max(MAX_META_LENGTH),
    emotional_tone: z.string().min(1).max(MAX_META_LENGTH),
    depth_level: z.enum(["superficial", "moderate", "deep"]),
  }),
  actionable_next_steps: z.array(z.string().min(1)).max(8),
});

const weeklyLiteSchema = z.object({
  time_range: z.object({
    start: z.string().min(1),
    end: z.string().min(1),
    total_conversations: z.number().int().min(0),
  }),
  highlights: z.array(z.string().min(1)).min(1).max(8),
  recurring_questions: z.array(z.string().min(1)).max(8),
  cross_domain_echoes: z
    .array(
      z.object({
        domain_a: z.string().min(1),
        domain_b: z.string().min(1),
        shared_logic: z.string().min(1),
        evidence_ids: z.array(z.number().int().min(0)).max(8),
      })
    )
    .max(MAX_WEEKLY_CROSS_DOMAIN_ECHOES),
  unresolved_threads: z.array(z.string().min(1)).max(8),
  suggested_focus: z.array(z.string().min(1)).max(8),
  evidence: z.array(
    z.object({
      conversation_id: z.number().int().min(0),
      note: z.string().min(1),
    })
  ).max(10),
  insufficient_data: z.boolean(),
});

function cleanItem(value: string, maxLength = MAX_LIST_ITEM_LENGTH): string {
  return value
    .replace(/^\s*[-*+•]+\s*/g, "")
    .replace(/^\s*\d+[.)]\s*/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanMeta(value: string): string {
  return cleanItem(value).slice(0, MAX_META_LENGTH);
}

function countCjkChars(value: string): number {
  const matches = value.match(/[\u3400-\u9FFF]/g);
  return matches ? matches.length : 0;
}

function countAsciiWords(value: string): number {
  const matches = value.match(/[A-Za-z0-9][A-Za-z0-9+/_\-.]*/g);
  return matches ? matches.length : 0;
}

export function isLowSignalNarrativeItem(value: string): boolean {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return true;
  if (/^[^A-Za-z0-9\u3400-\u9FFF]+$/.test(compact)) return true;
  if (/^\d+\s*(\/|\\|-)\s*\d+$/.test(compact)) return true;
  if (/^(n\/a|na|none|null|todo)$/i.test(compact)) return true;
  if (
    /^(获取|确认|查看|梳理|推进|优化|完善|明确|对齐|收集|验证|补充|建立|形成|评估|制定|修复|排查)[A-Za-z0-9\u3400-\u9FFF]{0,4}$/.test(
      compact
    )
  ) {
    return true;
  }
  if (/^(get|check|verify|confirm|fix|review|update|build)\s+\w{1,6}$/i.test(compact)) {
    return true;
  }

  const cjkCount = countCjkChars(compact);
  const asciiWordCount = countAsciiWords(compact);
  const compactLen = compact.replace(/\s+/g, "").length;

  if (cjkCount > 0) {
    return cjkCount < 6;
  }

  if (asciiWordCount >= 3) return false;
  if (asciiWordCount >= 2 && compactLen >= 8) return false;

  return compactLen < 12;
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
}

function normalizeList(values: string[] | undefined, limit = MAX_LIST_ITEMS): string[] {
  if (!values) return [];
  const cleaned = values
    .map(cleanItem)
    .filter((item) => item.length > 0)
    .slice(0, limit);
  return dedupePreserveOrder(cleaned).slice(0, limit);
}

function normalizeNarrativeList(values: string[] | undefined, limit = MAX_LIST_ITEMS): string[] {
  return normalizeList(values, limit)
    .filter((item) => !isLowSignalNarrativeItem(item))
    .slice(0, limit);
}

function isQuestionLike(value: string): boolean {
  if (/[?？]$/.test(value)) return true;
  return /^(为什么|为何|如何|怎么|是否|能否|可否|what|why|how|should|can|is|are)\b/i.test(
    value
  );
}

export function normalizeWeeklyNarrativeList(
  field: WeeklyNarrativeField,
  values: string[] | undefined,
  limit = MAX_LIST_ITEMS
): string[] {
  const normalized = normalizeList(values, limit).filter(
    (item) => !isLowSignalNarrativeItem(item)
  );

  if (field === "recurring_questions") {
    const questionLike = normalized.filter(isQuestionLike);
    return questionLike.slice(0, limit);
  }

  return normalized.slice(0, limit);
}

function normalizeCrossDomainEchoes(
  values: WeeklyCrossDomainEcho[] | undefined
): WeeklyCrossDomainEcho[] {
  if (!Array.isArray(values)) return [];

  const normalized: WeeklyCrossDomainEcho[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const domainA = cleanItem(value?.domain_a || "", 120);
    const domainB = cleanItem(value?.domain_b || "", 120);
    const sharedLogic = cleanItem(value?.shared_logic || "", MAX_LIST_ITEM_LENGTH);
    if (!domainA || !domainB || !sharedLogic) continue;

    const key = `${domainA.toLowerCase()}::${domainB.toLowerCase()}::${sharedLogic.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const evidenceIds = Array.isArray(value?.evidence_ids)
      ? value.evidence_ids
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id >= 0)
          .slice(0, 8)
      : [];

    normalized.push({
      domain_a: domainA,
      domain_b: domainB,
      shared_logic: sharedLogic,
      evidence_ids: evidenceIds,
    });

    if (normalized.length >= MAX_WEEKLY_CROSS_DOMAIN_ECHOES) {
      break;
    }
  }

  return normalized;
}

export function normalizeConversationSummary(input: {
  topic_title: string;
  key_takeaways: string[];
  sentiment: "neutral" | "positive" | "negative";
  action_items?: string[];
  tech_stack_detected: string[];
}): ConversationSummaryV1 {
  const topicTitle = cleanItem(input.topic_title).slice(0, MAX_TITLE_LENGTH) || "Conversation Summary";
  const takeaways = normalizeList(input.key_takeaways, 6);
  const techStack = normalizeList(input.tech_stack_detected, 10);
  const actionItems = normalizeList(input.action_items, 6);

  const summary: ConversationSummaryV1 = {
    topic_title: topicTitle,
    key_takeaways: takeaways.length > 0 ? takeaways : ["Summary generated, but key takeaways were sparse."],
    sentiment: input.sentiment,
    tech_stack_detected: techStack,
  };

  if (actionItems.length > 0) {
    summary.action_items = actionItems;
  }

  return summary;
}

export function normalizeWeeklyReport(input: {
  period_title: string;
  main_themes: string[];
  key_takeaways: string[];
  action_items?: string[];
  tech_stack_detected: string[];
}): WeeklyReportV1 {
  const periodTitle = cleanItem(input.period_title).slice(0, MAX_PERIOD_LENGTH) || "Weekly Report";
  const themes = normalizeList(input.main_themes, 6);
  const takeaways = normalizeList(input.key_takeaways, 8);
  const actionItems = normalizeList(input.action_items, 8);
  const techStack = normalizeList(input.tech_stack_detected, 12);

  const weekly: WeeklyReportV1 = {
    period_title: periodTitle,
    main_themes: themes.length > 0 ? themes : ["No dominant theme detected."],
    key_takeaways: takeaways.length > 0 ? takeaways : ["No concrete weekly takeaways detected."],
    tech_stack_detected: techStack,
  };

  if (actionItems.length > 0) {
    weekly.action_items = actionItems;
  }

  return weekly;
}

type ConversationSummaryStep = ConversationSummaryV2["thinking_journey"][number];
type ConversationSummaryInsight = ConversationSummaryV2["key_insights"][number];

function normalizeSpeaker(value: string): "User" | "AI" {
  return value === "AI" ? "AI" : "User";
}

function dedupeJourneySteps(steps: ConversationSummaryStep[]): ConversationSummaryStep[] {
  const seen = new Set<string>();
  const output: ConversationSummaryStep[] = [];

  for (const step of steps) {
    const key = `${step.speaker}:${step.assertion.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(step);
  }

  return output;
}

function dedupeInsightItems(items: ConversationSummaryInsight[]): ConversationSummaryInsight[] {
  const seen = new Set<string>();
  const output: ConversationSummaryInsight[] = [];

  for (const item of items) {
    const key = `${item.term.toLowerCase()}::${item.definition.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function toInsightItemFromLine(line: string, index: number): ConversationSummaryInsight {
  const cleaned = cleanItem(line, MAX_DEFINITION_LENGTH);
  const split = cleaned.match(/^(.*?)\s*[:：]\s*(.+)$/);

  if (split) {
    const term = cleanItem(split[1], MAX_TERM_LENGTH);
    const definition = cleanItem(split[2], MAX_DEFINITION_LENGTH);
    if (term && definition) {
      return { term, definition };
    }
  }

  return {
    term: `洞察${index + 1}`,
    definition: cleaned,
  };
}

export function normalizeConversationSummaryV2Legacy(
  input: ConversationSummaryV2Legacy
): ConversationSummaryV2 {
  const unresolvedThreads = normalizeNarrativeList(input.unresolved_threads, 6);
  const nextSteps = normalizeNarrativeList(input.actionable_next_steps, 6);

  const steps: ConversationSummaryStep[] = [];
  const initialState = cleanItem(input.thinking_journey.initial_state, MAX_ASSERTION_LENGTH);
  if (initialState) {
    steps.push({
      step: 1,
      speaker: "User",
      assertion: initialState,
      real_world_anchor: null,
    });
  }

  const keyTurns = normalizeList(input.thinking_journey.key_turns, 6);
  keyTurns.forEach((turn, index) => {
    steps.push({
      step: steps.length + 1,
      speaker: index % 2 === 0 ? "AI" : "User",
      assertion: cleanItem(turn, MAX_ASSERTION_LENGTH),
      real_world_anchor: null,
    });
  });

  const finalUnderstanding = cleanItem(
    input.thinking_journey.final_understanding,
    MAX_ASSERTION_LENGTH
  );
  if (finalUnderstanding) {
    steps.push({
      step: steps.length + 1,
      speaker: "AI",
      assertion: finalUnderstanding,
      real_world_anchor: null,
    });
  }

  const normalizedSteps = dedupeJourneySteps(steps)
    .slice(0, 10)
    .map((step, index) => ({
      ...step,
      step: index + 1,
    }));

  const keyInsights = normalizeList(input.key_insights, 8)
    .map((line, index) => toInsightItemFromLine(line, index))
    .map((item) => ({
      term: cleanItem(item.term, MAX_TERM_LENGTH),
      definition: cleanItem(item.definition, MAX_DEFINITION_LENGTH),
    }))
    .filter((item) => item.term.length > 0 && item.definition.length > 0);

  return {
    core_question:
      cleanMeta(input.core_question) || "What is the core question you are trying to answer?",
    thinking_journey:
      normalizedSteps.length > 0
        ? normalizedSteps
        : [
            {
              step: 1,
              speaker: "User",
              assertion: "You raise a central question that needs deeper clarification.",
              real_world_anchor: null,
            },
          ],
    key_insights: dedupeInsightItems(keyInsights).slice(0, 8),
    unresolved_threads: unresolvedThreads,
    meta_observations: {
      thinking_style:
        cleanMeta(input.meta_observations.thinking_style) ||
        "You narrow the scope step by step.",
      emotional_tone:
        cleanMeta(input.meta_observations.emotional_tone) ||
        "The tone stays cautious and curious.",
      depth_level: input.meta_observations.depth_level,
    },
    actionable_next_steps: nextSteps,
  };
}

export function normalizeConversationSummaryV2(input: {
  core_question: string;
  thinking_journey: Array<{
    step: number;
    speaker: "User" | "AI";
    assertion: string;
    real_world_anchor?: string | null;
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
}): ConversationSummaryV2 {
  const unresolvedThreads = normalizeNarrativeList(input.unresolved_threads, 6);
  const nextSteps = normalizeNarrativeList(input.actionable_next_steps, 6);

  const normalizedJourney = dedupeJourneySteps(
    (input.thinking_journey || [])
      .map((item, index) => ({
        step: Number.isFinite(item.step) ? Math.max(1, Math.floor(item.step)) : index + 1,
        speaker: normalizeSpeaker(item.speaker),
        assertion: cleanItem(item.assertion, MAX_ASSERTION_LENGTH),
        real_world_anchor: item.real_world_anchor
          ? cleanItem(item.real_world_anchor, MAX_ANCHOR_LENGTH)
          : null,
      }))
      .filter((item) => item.assertion.length > 0)
  )
    .slice(0, 10)
    .map((item, index) => ({
      ...item,
      step: index + 1,
      real_world_anchor:
        item.real_world_anchor && item.real_world_anchor.length > 0
          ? item.real_world_anchor
          : null,
    }));

  const normalizedInsights = dedupeInsightItems(
    (input.key_insights || [])
      .map((item) => ({
        term: cleanItem(item.term, MAX_TERM_LENGTH),
        definition: cleanItem(item.definition, MAX_DEFINITION_LENGTH),
      }))
      .filter((item) => item.term.length > 0 && item.definition.length > 0)
  ).slice(0, 8);

  return {
    core_question:
      cleanMeta(input.core_question) || "What is the core question you are trying to answer?",
    thinking_journey:
      normalizedJourney.length > 0
        ? normalizedJourney
        : [
            {
              step: 1,
              speaker: "User",
              assertion: "You raise a central question that needs deeper clarification.",
              real_world_anchor: null,
            },
          ],
    key_insights: normalizedInsights,
    unresolved_threads: unresolvedThreads,
    meta_observations: {
      thinking_style:
        cleanMeta(input.meta_observations.thinking_style) ||
        "You narrow the scope step by step.",
      emotional_tone:
        cleanMeta(input.meta_observations.emotional_tone) ||
        "The tone stays cautious and curious.",
      depth_level: input.meta_observations.depth_level,
    },
    actionable_next_steps: nextSteps,
  };
}


export function normalizeWeeklyLiteReport(input: {
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
}): WeeklyLiteReportV1 {
  const highlights = normalizeWeeklyNarrativeList("highlights", input.highlights, 6);
  const recurringQuestions = normalizeWeeklyNarrativeList(
    "recurring_questions",
    input.recurring_questions,
    4
  );
  const crossDomainEchoes = normalizeCrossDomainEchoes(input.cross_domain_echoes);
  const unresolvedThreads = normalizeWeeklyNarrativeList(
    "unresolved_threads",
    input.unresolved_threads,
    6
  );
  const suggestedFocus = normalizeWeeklyNarrativeList(
    "suggested_focus",
    input.suggested_focus,
    6
  );
  const evidence = (input.evidence || [])
    .slice(0, 8)
    .map((item) => ({
      conversation_id: item.conversation_id,
      note: cleanItem(item.note),
    }))
    .filter((item) => item.note.length > 0);

  const totalConversations = Math.max(0, Math.floor(input.time_range.total_conversations));
  const insufficientData = input.insufficient_data || totalConversations < 3;

  if (insufficientData) {
    const sparseHighlight =
      highlights[0] ??
      (totalConversations > 0
        ? `本周仅有 ${totalConversations} 个有效结构化会话，暂不进行跨主题聚合。`
        : "本周没有可用于周报聚合的有效结构化会话。");

    return {
      time_range: {
        start: input.time_range.start.trim(),
        end: input.time_range.end.trim(),
        total_conversations: totalConversations,
      },
      highlights: [sparseHighlight],
      recurring_questions: [],
      cross_domain_echoes: [],
      unresolved_threads: [],
      suggested_focus: [],
      evidence: [],
      insufficient_data: true,
    };
  }

  return {
    time_range: {
      start: input.time_range.start.trim(),
      end: input.time_range.end.trim(),
      total_conversations: totalConversations,
    },
    highlights: highlights.length > 0 ? highlights : [DEFAULT_WEEKLY_HIGHLIGHT],
    recurring_questions: recurringQuestions,
    cross_domain_echoes: crossDomainEchoes,
    unresolved_threads: unresolvedThreads,
    suggested_focus:
      suggestedFocus.length > 0
        ? suggestedFocus
        : [DEFAULT_WEEKLY_SUGGESTED_FOCUS],
    evidence,
    insufficient_data: insufficientData,
  };
}

export function validateWeeklySemanticQuality(
  report: WeeklyLiteReportV1
): WeeklySemanticQuality {
  if (report.insufficient_data) {
    return {
      passed: true,
      issueCodes: [],
      highlightsCount: report.highlights.length,
      recurringCount: report.recurring_questions.length,
      unresolvedCount: report.unresolved_threads.length,
      suggestedCount: report.suggested_focus.length,
    };
  }

  const issueCodes = new Set<WeeklySemanticIssueCode>();
  const highlights = normalizeList(report.highlights, 6);
  const recurring = normalizeList(report.recurring_questions, 4);
  const unresolved = normalizeList(report.unresolved_threads, 6);
  const suggested = normalizeList(report.suggested_focus, 6);

  if (
    highlights.length === 0 ||
    (highlights.length === 1 && highlights[0] === DEFAULT_WEEKLY_HIGHLIGHT)
  ) {
    issueCodes.add("EMPTY_VALID_HIGHLIGHTS");
  }
  if (highlights.some((item) => isLowSignalNarrativeItem(item))) {
    issueCodes.add("LOW_SIGNAL_HIGHLIGHT");
  }

  if (recurring.some((item) => isLowSignalNarrativeItem(item))) {
    issueCodes.add("LOW_SIGNAL_RECURRING");
  }
  if (recurring.some((item) => !isQuestionLike(item))) {
    issueCodes.add("RECURRING_NOT_QUESTIONLIKE");
  }

  if (unresolved.some((item) => isLowSignalNarrativeItem(item))) {
    issueCodes.add("LOW_SIGNAL_UNRESOLVED");
  }

  if (suggested.some((item) => isLowSignalNarrativeItem(item))) {
    issueCodes.add("LOW_SIGNAL_SUGGESTED_FOCUS");
  }
  if (
    suggested.length === 0 ||
    (suggested.length === 1 && suggested[0] === DEFAULT_WEEKLY_SUGGESTED_FOCUS)
  ) {
    issueCodes.add("EMPTY_VALID_SUGGESTED_FOCUS");
  }

  return {
    passed: issueCodes.size === 0,
    issueCodes: [...issueCodes],
    highlightsCount: highlights.length,
    recurringCount: recurring.length,
    unresolvedCount: unresolved.length,
    suggestedCount: suggested.length,
  };
}

export function parseConversationSummaryObject(value: unknown): {
  success: true;
  data: ConversationSummaryV1;
} | {
  success: false;
  errors: string[];
} {
  const parsed = summarySchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    };
  }

  return {
    success: true,
    data: normalizeConversationSummary(parsed.data),
  };
}

export function parseConversationSummaryV2Object(value: unknown): {
  success: true;
  data: ConversationSummaryV2;
} | {
  success: false;
  errors: string[];
} {
  const parsedNew = summaryV2SchemaNew.safeParse(value);
  if (parsedNew.success) {
    return {
      success: true,
      data: normalizeConversationSummaryV2(parsedNew.data),
    };
  }

  const parsedLegacy = summaryV2SchemaLegacy.safeParse(value);
  if (parsedLegacy.success) {
    return {
      success: true,
      data: normalizeConversationSummaryV2Legacy(parsedLegacy.data),
    };
  }

  return {
    success: false,
    errors: [
      ...parsedNew.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
      ),
      ...parsedLegacy.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
      ),
    ],
  };
}

export function parseWeeklyReportObject(value: unknown): {
  success: true;
  data: WeeklyReportV1;
} | {
  success: false;
  errors: string[];
} {
  const parsed = weeklySchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    };
  }

  return {
    success: true,
    data: normalizeWeeklyReport(parsed.data),
  };
}

export function parseWeeklyLiteReportObject(value: unknown): {
  success: true;
  data: WeeklyLiteReportV1;
} | {
  success: false;
  errors: string[];
} {
  const parsed = weeklyLiteSchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
      ),
    };
  }

  return {
    success: true,
    data: normalizeWeeklyLiteReport(parsed.data),
  };
}

function removeTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      output += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      output += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) {
        j += 1;
      }
      const next = input[j];
      if (next === "}" || next === "]") {
        continue;
      }
    }

    output += ch;
  }

  return output;
}

function extractFencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    if (m[1]) {
      blocks.push(m[1].trim());
    }
  }

  return blocks;
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}

function tryParseJsonCandidate(candidate: string): unknown | null {
  const trimmed = candidate.trim().replace(/^\uFEFF/, "");
  const attempts = [trimmed, removeTrailingCommas(trimmed)];

  for (const attempt of attempts) {
    if (!attempt) continue;

    try {
      let value: unknown = JSON.parse(attempt);

      // Handle double-encoded JSON (a JSON string containing JSON).
      for (let i = 0; i < 2; i += 1) {
        if (typeof value !== "string") break;
        const inner = value.trim();
        if (!inner) break;
        if (
          (inner.startsWith("{") && inner.endsWith("}")) ||
          (inner.startsWith("[") && inner.endsWith("]"))
        ) {
          try {
            value = JSON.parse(inner);
            continue;
          } catch {
            break;
          }
        }
        break;
      }

      return value;
    } catch {
      // Keep trying.
    }
  }

  return null;
}

export function parseJsonObjectFromText(text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [];

  if (trimmed) {
    candidates.push(trimmed);
  }

  for (const block of extractFencedBlocks(trimmed)) {
    if (block) {
      candidates.push(block);
    }
  }

  const balanced = extractBalancedJsonObject(trimmed);
  if (balanced) {
    candidates.push(balanced);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed === null) continue;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  }

  throw new Error("INVALID_JSON_PAYLOAD");
}


export const insightSchemaHints = {
  summary: {
    topic_title: "string (<= 5 words)",
    key_takeaways: ["string"],
    sentiment: "neutral | positive | negative",
    action_items: ["string (optional)"],
    tech_stack_detected: ["string"],
  },
  weekly: {
    period_title: "string",
    main_themes: ["string"],
    key_takeaways: ["string"],
    action_items: ["string (optional)"],
    tech_stack_detected: ["string"],
  },
  summary_v2: {
    core_question: "string",
    thinking_journey: [
      {
        step: "number",
        speaker: "User | AI",
        assertion: "string (2-3 sentences, includes why-now + what-it-opens-next)",
        real_world_anchor: "string | null (plain-language real-world anchor)",
      },
    ],
    key_insights: [
      {
        term: "string",
        definition: "string",
      },
    ],
    unresolved_threads: ["string"],
    meta_observations: {
      thinking_style: "string (natural user-facing phrase)",
      emotional_tone: "string (natural user-facing phrase)",
      depth_level: "superficial | moderate | deep",
    },
    actionable_next_steps: ["string"],
  },
  weekly_lite: {
    time_range: {
      start: "YYYY-MM-DD",
      end: "YYYY-MM-DD",
      total_conversations: "number",
    },
    highlights: ["string"],
    recurring_questions: ["string"],
    cross_domain_echoes: [
      {
        domain_a: "string",
        domain_b: "string",
        shared_logic: "string",
        evidence_ids: ["number"],
      },
    ],
    unresolved_threads: ["string"],
    suggested_focus: ["string"],
    evidence: [{ conversation_id: "number", note: "string" }],
    insufficient_data: "boolean",
  },
};
