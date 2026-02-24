import type {
  ConversationSummaryV1,
  ConversationSummaryV2,
  ConversationSummaryV2Legacy,
  SummaryRecord,
  WeeklyLiteReportV1,
  WeeklyReportRecord,
  WeeklyReportV1,
} from "../types";
import type {
  ChatSummaryData,
  WeeklySummaryData,
} from "../types/insightsPresentation";
import {
  isLowSignalNarrativeItem,
  normalizeConversationSummaryV2Legacy,
  normalizeWeeklyNarrativeList,
} from "./insightSchemas";

interface WeeklyCrossDomainEcho {
  domain_a: string;
  domain_b: string;
  shared_logic: string;
  evidence_ids: number[];
}

const TECH_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\breact\b/i, label: "React" },
  { pattern: /typescript|\bts\b/i, label: "TypeScript" },
  { pattern: /plasmo/i, label: "Plasmo" },
  { pattern: /tailwind/i, label: "Tailwind CSS" },
  { pattern: /dexie|indexeddb/i, label: "IndexedDB" },
  { pattern: /parser|selector/i, label: "Parser" },
  { pattern: /modelscope|qwen|deepseek/i, label: "Model Inference" },
  { pattern: /prompt|schema/i, label: "Prompt Engineering" },
];
const DEFAULT_WEEKLY_SUGGESTED_FOCUS = "下周优先推进一个高价值问题并记录验证结果。";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function dedupeNarrative(items: string[], limit: number): string[] {
  return dedupe(items)
    .filter((item) => !isLowSignalNarrativeItem(item))
    .slice(0, limit);
}

function dedupeJourney(
  steps: ChatSummaryData["thinking_journey"]
): ChatSummaryData["thinking_journey"] {
  const seen = new Set<string>();
  const output: ChatSummaryData["thinking_journey"] = [];

  for (const step of steps) {
    const key = `${step.speaker}:${step.assertion.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(step);
  }

  return output.map((step, index) => ({
    ...step,
    step: index + 1,
  }));
}

function dedupeInsights(
  items: ChatSummaryData["key_insights"]
): ChatSummaryData["key_insights"] {
  const seen = new Set<string>();
  const output: ChatSummaryData["key_insights"] = [];

  for (const item of items) {
    const term = normalizeText(item.term);
    const definition = normalizeText(item.definition);
    if (!term || !definition) continue;
    const key = `${term.toLowerCase()}::${definition.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ term, definition });
  }

  return output;
}

function inferTags(explicitTags: string[] | undefined, fallbackText: string): string[] {
  const fromExplicit = dedupe(explicitTags ?? []).slice(0, 6);
  if (fromExplicit.length > 0) {
    return fromExplicit;
  }

  const inferred: string[] = [];
  for (const item of TECH_KEYWORDS) {
    if (item.pattern.test(fallbackText)) {
      inferred.push(item.label);
    }
    if (inferred.length >= 3) {
      break;
    }
  }

  const deduped = dedupe(inferred);
  if (deduped.length > 0) {
    return deduped;
  }

  return ["General"];
}

function toLines(text: string): string[] {
  return dedupe(
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((line) => line.length > 0)
  );
}

function toIsoTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function toRangeLabel(rangeStart: number, rangeEnd: number): string {
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

function isConversationSummaryV2Current(value: unknown): value is ConversationSummaryV2 {
  if (!value || typeof value !== "object") return false;
  const row = value as { core_question?: unknown; thinking_journey?: unknown };
  return typeof row.core_question === "string" && Array.isArray(row.thinking_journey);
}

function isConversationSummaryV2Legacy(value: unknown): value is ConversationSummaryV2Legacy {
  if (!value || typeof value !== "object") return false;
  const row = value as {
    core_question?: unknown;
    thinking_journey?: unknown;
    key_insights?: unknown;
  };
  return (
    typeof row.core_question === "string" &&
    !Array.isArray(row.thinking_journey) &&
    !!row.thinking_journey &&
    Array.isArray(row.key_insights)
  );
}

function isConversationSummaryV1(value: unknown): value is ConversationSummaryV1 {
  if (!value || typeof value !== "object") return false;
  return "topic_title" in value && "key_takeaways" in value;
}

function isWeeklyLiteReportV1(value: unknown): value is WeeklyLiteReportV1 {
  if (!value || typeof value !== "object") return false;
  return "time_range" in value && "highlights" in value;
}

function isWeeklyReportV1(value: unknown): value is WeeklyReportV1 {
  if (!value || typeof value !== "object") return false;
  return "period_title" in value && "main_themes" in value;
}

function inferUnresolved(lines: string[]): string[] {
  return lines
    .filter((line) => /unresolved|open|pending|risk|unknown|todo|block/i.test(line))
    .slice(0, 4);
}

function normalizeCrossDomainEchoes(value: unknown): WeeklyCrossDomainEcho[] {
  if (!Array.isArray(value)) return [];

  const output: WeeklyCrossDomainEcho[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      domain_a?: unknown;
      domain_b?: unknown;
      shared_logic?: unknown;
      evidence_ids?: unknown;
    };

    const domainA = normalizeText(String(row.domain_a ?? ""));
    const domainB = normalizeText(String(row.domain_b ?? ""));
    const sharedLogic = normalizeText(String(row.shared_logic ?? ""));
    if (!domainA || !domainB || !sharedLogic) continue;

    const evidenceIds = Array.isArray(row.evidence_ids)
      ? row.evidence_ids
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0)
          .slice(0, 8)
      : [];

    output.push({
      domain_a: domainA,
      domain_b: domainB,
      shared_logic: sharedLogic,
      evidence_ids: evidenceIds,
    });
  }

  return output.slice(0, 4);
}

function toJourneyFromV2(
  steps: ConversationSummaryV2["thinking_journey"]
): ChatSummaryData["thinking_journey"] {
  const normalized = steps
    .map((step, index) => ({
      step: Number.isFinite(step.step) ? Math.max(1, Math.floor(step.step)) : index + 1,
      speaker: step.speaker === "AI" ? "AI" : "User",
      assertion: normalizeText(step.assertion),
      real_world_anchor: step.real_world_anchor ? normalizeText(step.real_world_anchor) : null,
    }))
    .filter((step) => step.assertion.length > 0)
    .sort((left, right) => left.step - right.step);

  return dedupeJourney(normalized).slice(0, 10);
}

function normalizeDepthLevel(value: unknown): "superficial" | "moderate" | "deep" {
  if (value === "deep" || value === "moderate" || value === "superficial") {
    return value;
  }
  return "moderate";
}

function toInsightObjects(
  insights: ConversationSummaryV2["key_insights"]
): ChatSummaryData["key_insights"] {
  return dedupeInsights(
    insights.map((item) => ({
      term: normalizeText(item.term),
      definition: normalizeText(item.definition),
    }))
  ).slice(0, 8);
}

function toChatSummaryDataFromV2(
  summary: SummaryRecord,
  structured: ConversationSummaryV2,
  options?: { conversationTitle?: string }
): ChatSummaryData {
  const safeJourney = Array.isArray(structured.thinking_journey)
    ? structured.thinking_journey
    : [];
  const safeInsights = Array.isArray(structured.key_insights)
    ? structured.key_insights
    : [];
  const safeUnresolved = Array.isArray(structured.unresolved_threads)
    ? structured.unresolved_threads
    : [];
  const safeNextSteps = Array.isArray(structured.actionable_next_steps)
    ? structured.actionable_next_steps
    : [];
  const safeMeta =
    structured.meta_observations && typeof structured.meta_observations === "object"
      ? structured.meta_observations
      : {
          thinking_style: "",
          emotional_tone: "",
          depth_level: "moderate" as const,
        };

  const insightText = safeInsights
    .map((item) => `${item.term}\n${item.definition}`)
    .join("\n");

  return {
    meta: {
      title: options?.conversationTitle ?? structured.core_question,
      generated_at: toIsoTime(summary.createdAt),
      tags: inferTags([], `${structured.core_question}\n${insightText}`),
      fallback: summary.status === "fallback",
    },
    core_question: normalizeText(structured.core_question),
    thinking_journey: toJourneyFromV2(safeJourney),
    key_insights: toInsightObjects(safeInsights),
    unresolved_threads: dedupeNarrative(safeUnresolved, 6),
    meta_observations: {
      thinking_style:
        normalizeText(String(safeMeta.thinking_style ?? "")) ||
        "逐步深挖，每一问都在收紧范围。",
      emotional_tone:
        normalizeText(String(safeMeta.emotional_tone ?? "")) ||
        "谨慎而带着好奇，持续验证关键假设。",
      depth_level: normalizeDepthLevel(safeMeta.depth_level),
    },
    actionable_next_steps: dedupeNarrative(safeNextSteps, 6),
    plain_text: summary.content,
  };
}

export function toChatSummaryData(
  summary: SummaryRecord,
  options?: { conversationTitle?: string }
): ChatSummaryData {
  const fallbackLines = toLines(summary.content);
  const structured = summary.structured;

  if (isConversationSummaryV2Current(structured)) {
    return toChatSummaryDataFromV2(summary, structured, options);
  }

  if (isConversationSummaryV2Legacy(structured)) {
    return toChatSummaryDataFromV2(
      summary,
      normalizeConversationSummaryV2Legacy(structured),
      options
    );
  }

  if (isConversationSummaryV1(structured)) {
    const keyInsights = dedupe(structured.key_takeaways).slice(0, 6);
    const actionItems = dedupe(structured.action_items ?? []).slice(0, 6);
    const linesSource = [...keyInsights, ...actionItems];

    const thinkingJourney = dedupeJourney([
      {
        step: 1,
        speaker: "User",
        assertion:
          "You open with a problem that needs to be clarified before deciding on direction.",
        real_world_anchor: null,
      },
      ...linesSource.slice(0, 5).map((line, index) => ({
        step: index + 2,
        speaker: index % 2 === 0 ? "AI" : "User",
        assertion: line,
        real_world_anchor: null,
      })),
    ]).slice(0, 8);

    return {
      meta: {
        title: options?.conversationTitle ?? structured.topic_title,
        generated_at: toIsoTime(summary.createdAt),
        tags: inferTags(
          structured.tech_stack_detected,
          `${structured.topic_title}\n${keyInsights.join("\n")}`
        ),
        fallback: summary.status === "fallback",
      },
      core_question: options?.conversationTitle ?? structured.topic_title,
      thinking_journey: thinkingJourney,
      key_insights: keyInsights.map((item, index) => ({
        term: `洞察${index + 1}`,
        definition: item,
      })),
      unresolved_threads: inferUnresolved(linesSource),
      meta_observations: {
        thinking_style: "You break problems down and tighten scope iteratively.",
        emotional_tone: "The tone is rational, careful, and continuously validating assumptions.",
        depth_level: "moderate",
      },
      actionable_next_steps: actionItems,
      plain_text: summary.content,
    };
  }

  const firstLine = fallbackLines[0] ?? options?.conversationTitle ?? "Conversation Summary";
  const secondLine = fallbackLines[1] ?? fallbackLines[0] ?? "No stable conclusion yet.";

  return {
    meta: {
      title: options?.conversationTitle ?? firstLine,
      generated_at: toIsoTime(summary.createdAt),
      tags: inferTags([], summary.content),
      fallback: true,
    },
    core_question: options?.conversationTitle
      ? `Core question in this conversation: ${options.conversationTitle}`
      : firstLine,
    thinking_journey: [
      {
        step: 1,
        speaker: "User",
        assertion: firstLine,
        real_world_anchor: null,
      },
      {
        step: 2,
        speaker: "AI",
        assertion: secondLine,
        real_world_anchor: null,
      },
    ],
    key_insights: fallbackLines.slice(0, 5).map((line, index) => ({
      term: `洞察${index + 1}`,
      definition: line,
    })),
    unresolved_threads: inferUnresolved(fallbackLines),
    meta_observations: {
      thinking_style: "Sample is sparse; stable thinking-style inference is unavailable.",
      emotional_tone: "Sample is sparse; tone is treated as neutral.",
      depth_level: "superficial",
    },
    actionable_next_steps: fallbackLines
      .filter((line) => /next|todo|action|follow-up/i.test(line))
      .slice(0, 4),
    plain_text: summary.content,
  };
}

export function toWeeklySummaryData(report: WeeklyReportRecord): WeeklySummaryData {
  const fallbackLines = toLines(report.content);
  const rangeLabel = toRangeLabel(report.rangeStart, report.rangeEnd);
  const structured = report.structured;

  if (isWeeklyLiteReportV1(structured)) {
    const crossDomainEchoes = normalizeCrossDomainEchoes(
      (structured as unknown as { cross_domain_echoes?: unknown }).cross_domain_echoes
    );
    const highlights = normalizeWeeklyNarrativeList(
      "highlights",
      structured.highlights,
      6
    );
    const recurring = normalizeWeeklyNarrativeList(
      "recurring_questions",
      structured.recurring_questions,
      4
    );
    const unresolved = normalizeWeeklyNarrativeList(
      "unresolved_threads",
      structured.unresolved_threads,
      6
    );
    const suggested = normalizeWeeklyNarrativeList(
      "suggested_focus",
      structured.suggested_focus,
      6
    );
    const suggestedFocus =
      !structured.insufficient_data && suggested.length === 0
        ? [DEFAULT_WEEKLY_SUGGESTED_FOCUS]
        : suggested;

    return {
      meta: {
        title: `Weekly Lite ${rangeLabel}`,
        generated_at: toIsoTime(report.createdAt),
        tags: inferTags([], `${structured.highlights.join("\n")}\n${structured.suggested_focus.join("\n")}`),
        fallback: report.status === "fallback",
        range_label: rangeLabel,
      },
      highlights:
        highlights.length > 0
          ? highlights
          : dedupe(structured.highlights).slice(0, 1),
      recurring_questions: recurring,
      cross_domain_echoes: crossDomainEchoes,
      unresolved_threads: unresolved,
      suggested_focus: suggestedFocus,
      evidence: (structured.evidence || []).slice(0, 8),
      insufficient_data: structured.insufficient_data,
      plain_text: report.content,
    };
  }

  if (isWeeklyReportV1(structured)) {
    const themes = dedupe(structured.main_themes).slice(0, 6);
    const keyInsights = dedupe(structured.key_takeaways).slice(0, 8);
    const highlights = normalizeWeeklyNarrativeList(
      "highlights",
      keyInsights.length ? keyInsights : themes,
      6
    );
    const actionItems = dedupeNarrative(structured.action_items ?? [], 6);
    const unresolved = dedupeNarrative(
      inferUnresolved([...themes, ...keyInsights]),
      6
    );
    const suggestedFocus =
      actionItems.length > 0 ? actionItems : [DEFAULT_WEEKLY_SUGGESTED_FOCUS];

    return {
      meta: {
        title: structured.period_title || `Weekly Summary ${rangeLabel}`,
        generated_at: toIsoTime(report.createdAt),
        tags: inferTags(
          structured.tech_stack_detected,
          `${structured.period_title}\n${themes.join("\n")}\n${keyInsights.join("\n")}`
        ),
        fallback: report.status === "fallback",
        range_label: rangeLabel,
      },
      highlights:
        highlights.length > 0
          ? highlights
          : [keyInsights[0] ?? themes[0] ?? "本周形成了可复用的阶段性结论。"],
      recurring_questions: [],
      cross_domain_echoes: [],
      unresolved_threads: unresolved,
      suggested_focus: suggestedFocus,
      evidence: [],
      insufficient_data: false,
      plain_text: report.content,
    };
  }

  const highlights = fallbackLines.slice(0, 5);
  const filteredFallbackHighlights = dedupeNarrative(highlights, 5);
  const fallbackRecurring = dedupeNarrative(
    fallbackLines.filter((line) => /repeat|recurr|question|why|how/i.test(line)).slice(0, 3),
    3
  );

  return {
    meta: {
      title: `Weekly Lite ${rangeLabel}`,
      generated_at: toIsoTime(report.createdAt),
      tags: inferTags([], report.content),
      fallback: true,
      range_label: rangeLabel,
    },
    highlights:
      filteredFallbackHighlights.length > 0
        ? filteredFallbackHighlights
        : highlights.slice(0, 1),
    recurring_questions: fallbackRecurring,
    cross_domain_echoes: [],
    unresolved_threads: dedupeNarrative(inferUnresolved(fallbackLines), 6),
    suggested_focus: [],
    evidence: [],
    insufficient_data: true,
    plain_text: report.content,
  };
}
