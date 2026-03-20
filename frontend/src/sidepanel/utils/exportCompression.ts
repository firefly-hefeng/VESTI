import { getPrompt } from "~lib/prompts";
import type { ExportCompressionPromptPayload } from "~lib/prompts";
import {
  CONDITIONAL_HANDOFF_OVERVIEW_HEADING,
  CONDITIONAL_HANDOFF_SECTION_WHITELIST,
  CONDITIONAL_HANDOFF_TYPES,
} from "~lib/prompts/export/compactComposer";
// Summary V2 import
import {
  compressSummaryDataset,
  type SummaryExportDatasetItem,
  type CompressedSummaryExport,
} from "./summaryCompression";
import {
  FUTURE_MODELSCOPE_EXPORT_MODEL_CANDIDATES,
  FUTURE_MOONSHOT_DIRECT_EXPORT_MODEL_CANDIDATES,
  getEffectiveModelId,
} from "~lib/services/llmConfig";
import {
  getLlmModelProfile,
  type ExportPromptProfile,
} from "~lib/services/llmModelProfile";
import {
  callInference,
  getLlmDiagnostic,
  type InferenceCallResult,
  type InferenceUsage,
  type LlmDiagnostic,
  sanitizeSummaryText,
  truncateForContext,
} from "~lib/services/llmService";
import { getLlmSettings } from "~lib/services/llmSettingsService";
import { getConversationOriginAt } from "~lib/conversations/timestamps";
import type { Conversation, LlmConfig, Message } from "~lib/types";
import { logger } from "~lib/utils/logger";
import type {
  ConversationExportCompactVariant,
  ConversationExportContentMode,
  ConversationExportNotice,
} from "../types/export";

export type ExportCompressionMode = Exclude<
  ConversationExportContentMode,
  "full"
>;
export type ExportCompressionRoute =
  | "current_llm_settings"
  | "moonshot_direct";
export type ExportCompressionSource = "llm" | "local_fallback";
export type ExportCompressionInvalidReasonCode =
  | "export_output_too_short"
  | "export_missing_required_headings"
  | "export_grounded_sections_insufficient"
  | "export_artifact_signal_missing"
  | "incomplete_output"; // From summary compression

export interface ConversationExportDatasetItem {
  conversation: Conversation;
  messages: Message[];
}

export interface CompressedConversationExport {
  conversation: Conversation;
  messages: Message[];
  body: string;
  mode: ExportCompressionMode;
  compactVariant?: ConversationExportCompactVariant;
  source: ExportCompressionSource;
  route?: ExportCompressionRoute;
  usedFallbackPrompt: boolean;
  fallbackReason?: string;
  diagnostic?: LlmDiagnostic;
  modelId?: string;
  exportPromptProfile?: ExportPromptProfile;
  primaryInvalidReason?: ExportCompressionInvalidReasonCode;
  fallbackInvalidReason?: ExportCompressionInvalidReasonCode;
  llmAttemptMetrics?: ExportCompressionLlmAttemptMetrics;
  deliveredArtifactMetrics?: ExportCompressionDeliveredArtifactMetrics;
  integrityWarnings?: string[];
  softCompressionWarning?: string;
  reviewReady?: boolean;
}

interface ExportCompressionAdapter {
  route: ExportCompressionRoute;
  compress: (
    item: ConversationExportDatasetItem,
    mode: ExportCompressionMode,
    options?: ExportCompressionOptions
  ) => Promise<CompressedConversationExport>;
}

interface ExportCompressionValidationResult {
  valid: boolean;
  issueCode?: ExportCompressionInvalidReasonCode;
  runtimeMetrics: Omit<
    ExportCompressionRuntimeMetrics,
    "rawOutputChars" | "serializedOutputChars"
  >;
  integrityWarnings: string[];
  softCompressionWarning?: string;
}

interface ExportCompressionFailureContext {
  route: ExportCompressionRoute;
  compactVariant?: ConversationExportCompactVariant;
  modelId?: string;
  exportPromptProfile?: ExportPromptProfile;
  primaryInvalidReason?: ExportCompressionInvalidReasonCode;
  fallbackInvalidReason?: ExportCompressionInvalidReasonCode;
  llmAttemptMetrics?: ExportCompressionLlmAttemptMetrics;
}

interface ExportCompressionOptions {
  compactVariant?: ConversationExportCompactVariant;
}

interface ExportCompressionRuntimeMetrics {
  transcriptChars: number;
  rawOutputChars: number;
  normalizedOutputChars: number;
  serializedOutputChars: number;
  absoluteMinChars: number;
  softMinChars: number | null;
}

interface ExportCompressionAttemptMetrics {
  promptChars: number;
  truncatedPromptChars: number;
  rawOutputChars: number;
  normalizedOutputChars: number;
  finishReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  requestedMaxTokens?: number | null;
  effectiveMaxTokens?: number | null;
  proxyMaxTokensLimit?: number | null;
  incompleteOutputRisk?: boolean;
  invalidReason?: ExportCompressionInvalidReasonCode;
  continuation?: ExportCompressionContinuationMetrics;
}

interface ExportCompressionContinuationMetrics {
  rawOutputChars: number;
  normalizedOutputChars: number;
  finishReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  requestedMaxTokens?: number | null;
  effectiveMaxTokens?: number | null;
  proxyMaxTokensLimit?: number | null;
}

interface ExportCompressionLlmAttemptMetrics {
  primary?: ExportCompressionAttemptMetrics;
  fallbackPrompt?: ExportCompressionAttemptMetrics;
}

type ExportCompressionDeliveredArtifactMetrics =
  ExportCompressionRuntimeMetrics;

class ExportCompressionValidationError extends Error {
  readonly context: ExportCompressionFailureContext;

  constructor(
    reason: string,
    context: ExportCompressionFailureContext
  ) {
    super(reason);
    this.name = "ExportCompressionValidationError";
    this.context = context;
  }
}

const ACTIVE_EXPORT_COMPRESSION_ROUTE: ExportCompressionRoute =
  "current_llm_settings";
const PROMPT_BUDGETS: Record<
  ExportPromptProfile,
  { primary: number; fallback: number }
> = {
  legacy_handoff_balanced: {
    primary: 14000,
    fallback: 11000,
  },
  kimi_handoff_rich: {
    primary: 18000,
    fallback: 14000,
  },
  step_flash_concise: {
    primary: 12000,
    fallback: 9000,
  },
};
const EXPERIMENTAL_COMPACT_PROMPT_BUDGET = {
  primary: 28000,
  fallback: 22000,
} as const;
const EXPERIMENTAL_COMPACT_MAX_TOKENS = {
  primary: 5000,
  fallback: 4200,
} as const;
const MIN_VALID_OUTPUT_LENGTH = 48;
const COMPACT_MIN_VALID_OUTPUT_LENGTH = 300;
const COMPACT_SOFT_MIN_RATIO = 0.08;
const EXPERIMENTAL_PACKING = {
  keepFirstMessages: 4,
  keepLastMessages: 12,
} as const;
const QUESTION_CUE =
  /(?:[?？]$|^(?:how|why|what|which|should|can|could|would|is|are|do|does|did|where|when|whether|how do|how should|what should|如何|为什么|为何|怎么|是否|能否|需不需要|应该|要不要))/i;
const CONSTRAINT_CUE =
  /(?:\b(?:must|should|need to|needs to|avoid|without|only|do not|don't|keep|preserve|require|strict|cannot|can't|leave room|whitelist)\b|必须|不要|不能|保持|保留|避免|仅|只|不改|不引入|继续|白名单|兼容|默认|要求)/i;
const DECISION_CUE =
  /(?:\b(?:use|keep|switch|prefer|decide|decided|choose|adopt|implement|fix|route|fallback|preserve|drop|align|lock|ship|merge|split|stage|replace|reuse|extend|support|move|toggle|prune)\b|保留|改为|改成|采用|决定|锁定|使用|对齐|修复|切换|收口|合并|提交|复用|扩展|支持|替换|接入)/i;
const UNRESOLVED_CUE =
  /(?:\b(?:todo|next|follow[- ]?up|remaining|still need|not yet|later|future|pending|verify|validate|check|smoke|manual|open question|unresolved|left to do|needs follow-up)\b|后续|下一步|仍需|尚未|待|未来|验证|检查|手测|未解决|继续推进|留到后续)/i;
const PATH_PATTERN =
  /(?:[A-Za-z]:\\[^\s`"')]+|(?:\.?\.?(?:\/|\\))?(?:[\w.-]+(?:\/|\\))+[\w./\\-]*[\w-]+(?:\.[A-Za-z0-9]+)?)/g;
const COMMAND_PATTERN =
  /(?:^|\s)(?:pnpm|npm|git|node|python|pytest|rg|gh|curl|yarn|tsx|ts-node)\b[^\n]*/gim;
const API_PATTERN = /\b[A-Za-z_][A-Za-z0-9_]*\([^()\n]{0,80}\)/g;
const BACKTICK_PATTERN = /`[^`\n]{2,120}`/g;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const EXPLANATION_TEACHING_CUE =
  /(?:\b(?:explain|explanation|help me understand|walk me through|teach me|what is|why does|how does)\b|解释|讲解|理解|原理|推导|概念|是什么意思|为什么)/i;
const DEBUGGING_CUE =
  /(?:\b(?:bug|debug|debugging|error|failed|failure|fix|broken|regression|stack trace|timeout|401|invalid|not working|fallback)\b|报错|失败|排查|修复|异常|不生效|fallback|子码)/i;
const ARCHITECTURE_TRADEOFF_CUE =
  /(?:\b(?:trade[- ]?off|architecture|architectural|constraint|constraints|option|options|compare|comparison|alternative|alternatives|pros and cons|rejected path)\b|架构|权衡|约束|方案|比较|备选|替代路径)/i;
const PROCESS_AGREEMENT_CUE =
  /(?:\b(?:scope|branch|workflow|working agreement|style|communication|reporting|do not reopen|maintenance-only|keep the work scoped|do not mix)\b|范围|分支|协作|工作方式|约定|不要重开|维护模式|只做|不要混入|明确失败模式)/i;
const GENERATION_CUE =
  /(?:\b(?:brainstorm|brainstorming|idea|ideas|draft|drafts|variant|variants|creative|concept|concepts|frame|frames|explore options|multiple options|candidate directions|generate|generated)\b|创作|生成|草案|框架构建|框架|变体|点子|脑暴|候选方向|并列方案)/i;
const RATIONALE_CUE =
  /(?:\b(?:because|why|reason|rationale|constraint|trade[- ]?off|so that|therefore|wins because)\b|因为|原因|理由|约束|权衡|所以|因此)/i;
const REJECTED_PATH_CUE =
  /(?:\b(?:reject|rejected|avoid|not use|do not use|don't use|instead of|would hide|would blur|not reopen|not mix)\b|拒绝|排除|不要|不做|不采用|会掩盖|不要重开|不要混入)/i;
const MATH_HEAVY_CUE =
  /(?:\\(?:boxed|lambda|frac|sum|int|alpha|beta|gamma|theta|cdot|times|left|right|begin|end)|\$\$|\\\(|\\\)|\\\[|\\\]|[_^][{(A-Za-z0-9])/i;
const SYMBOL_DENSE_LINE = /^[^A-Za-z0-9\u3400-\u9FFF]*[=+\-*/_^{}()[\]\\|<>.,:;]{3,}[^A-Za-z0-9\u3400-\u9FFF]*$/;
const META_CONTENT_LINE_PATTERNS = [
  /^\s*"?(?:messages|role|content|timestamp|required_facts|key_facts|reference|experimental_reference)"?\s*[:\[]/i,
  /^\s*[{[\]},]\s*$/,
  /^\s*"[^"]+"\s*:\s*(?:\[|{|"|[-\d])/,
  /(?:请你帮我评估|请你判断|是不是该|是否应该|should we|do you recommend|can you assess|help us judge)/i,
] as const;
const PLACEHOLDER_PATTERNS = [
  /no .*captured/i,
  /no .*available/i,
  /none grounded/i,
  /none available/i,
  /fallback-local/i,
  /local fallback/i,
  /not enabled/i,
  /unknown$/i,
  /未(?:明确|捕获|提供|出现|记录)/,
  /无(?:可用|明确|复用)/,
] as const;
const EXPECTED_HEADINGS: Record<ExportCompressionMode, string[]> = {
  compact: [
    "## Background",
    "## Key Questions",
    "## Decisions And Answers",
    "## Reusable Artifacts",
    "## Unresolved",
  ],
  summary: [
    "## TL;DR",
    "## Problem Frame",
    "## Important Moves",
    "## Reusable Snippets",
    "## Next Steps",
    "## Tags",
  ],
};
const CONDITIONAL_HANDOFF_TYPE_SET = new Set<string>(CONDITIONAL_HANDOFF_TYPES);
const CONDITIONAL_HANDOFF_ALLOWED_HEADINGS: string[] = [
  CONDITIONAL_HANDOFF_OVERVIEW_HEADING,
  ...CONDITIONAL_HANDOFF_SECTION_WHITELIST,
];
const CONDITIONAL_HANDOFF_SECTION_ORDER: string[] = [
  ...CONDITIONAL_HANDOFF_SECTION_WHITELIST,
];
const EXPERIMENTAL_EVIDENCE_WINDOW_LABELS = [
  "Architecture / Decision Rationale",
  "Rejected Path",
  "User Constraint / Working Agreement",
  "Unresolved Risk / Next Step",
  "Explanation / Generation",
] as const;

const ROUTE_STATUS: Record<
  ExportCompressionRoute,
  { enabled: boolean; note: string }
> = {
  current_llm_settings: {
    enabled: true,
    note: "Shipping baseline. Reuses current Settings/llmConfig/callInference path.",
  },
  moonshot_direct: {
    enabled: false,
    note: "Dormant seam reserved for future Moonshot official API validation.",
  },
};

type ConditionalHandoffParseResult = {
  startedAt: string;
  conversationTypes: string[];
  stateOverview: string;
  sections: Record<string, string>;
};

function resolveCompactVariant(
  mode: ExportCompressionMode,
  options?: ExportCompressionOptions
): ConversationExportCompactVariant | undefined {
  if (mode !== "compact") {
    return undefined;
  }
  return options?.compactVariant ?? "experimental";
}

function isExperimentalCompact(
  mode: ExportCompressionMode,
  options?: ExportCompressionOptions
): boolean {
  return resolveCompactVariant(mode, options) === "experimental";
}

function describeCompactLine(
  compactVariant: ConversationExportCompactVariant | undefined
): string {
  return compactVariant === "experimental"
    ? "Distilled handoff"
    : "Compact handoff";
}

function hasRegexMatch(value: string, pattern: RegExp): boolean {
  const flags = pattern.flags.replace(/g/g, "");
  return new RegExp(pattern.source, flags).test(value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shorten(value: string, maxChars = 180): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function getTranscriptChars(messages: Message[]): number {
  return messages.map((message) => message.content_text).join("\n").length;
}

function getAbsoluteMinChars(mode: ExportCompressionMode): number {
  return mode === "compact"
    ? COMPACT_MIN_VALID_OUTPUT_LENGTH
    : MIN_VALID_OUTPUT_LENGTH;
}

function getSoftMinChars(
  messages: Message[],
  mode: ExportCompressionMode,
  absoluteMinChars: number
): number | null {
  if (mode !== "compact") {
    return null;
  }
  return Math.max(
    absoluteMinChars,
    Math.floor(getTranscriptChars(messages) * COMPACT_SOFT_MIN_RATIO)
  );
}

function countCodeFenceMarkers(value: string): number {
  return (value.match(/```/g) || []).length;
}

function findDanglingCueLines(value: string): string[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const dangling: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      continue;
    }
    if (
      trimmed.startsWith("StartedAt:") ||
      trimmed.startsWith("Conversation Type:") ||
      trimmed.startsWith("## ")
    ) {
      continue;
    }
    if (!/[:：]$/.test(trimmed)) {
      continue;
    }

    let nextMeaningful: string | null = null;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextTrimmed = lines[cursor].trim();
      if (!nextTrimmed) {
        continue;
      }
      nextMeaningful = nextTrimmed;
      break;
    }

    if (
      nextMeaningful === null ||
      nextMeaningful.startsWith("## ")
    ) {
      dangling.push(trimmed);
    }
  }

  return unique(dangling).slice(0, 4);
}

function findIncompleteTerminalLine(value: string): string | null {
  const lines = value.replace(/\r\n/g, "\n").split("\n");

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      continue;
    }
    if (
      trimmed.startsWith("StartedAt:") ||
      trimmed.startsWith("Conversation Type:") ||
      trimmed.startsWith("## ")
    ) {
      return null;
    }

    const candidate = stripBulletPrefix(trimmed);
    if (!hasMeaningfulText(candidate)) {
      return null;
    }
    if (/[。！？.!?][)"'`]*$/.test(candidate)) {
      return null;
    }
    if (/[:：]$/.test(candidate)) {
      return trimmed;
    }

    const cjkCount = countCjkChars(candidate);
    const asciiWordCount = countAsciiWords(candidate);
    const compactLen = candidate.replace(/\s+/g, " ").trim().length;
    if (cjkCount >= 12 || asciiWordCount >= 6 || compactLen >= 45) {
      return trimmed;
    }

    return null;
  }

  return null;
}

function toOrderedMessages(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.created_at - b.created_at);
}

function detectLocale(): "zh" | "en" {
  if (typeof navigator === "undefined") {
    return "zh";
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function resolvePromptBudget(
  exportProfile: ExportPromptProfile,
  mode: ExportCompressionMode,
  options?: ExportCompressionOptions
): { primary: number; fallback: number } {
  if (isExperimentalCompact(mode, options)) {
    return EXPERIMENTAL_COMPACT_PROMPT_BUDGET;
  }
  return PROMPT_BUDGETS[exportProfile];
}

function withExperimentalMaxTokens(
  settings: LlmConfig,
  maxTokens: number
): LlmConfig {
  return {
    ...settings,
    maxTokens,
  };
}

function formatPackedTranscriptLine(
  message: Message,
  index: number,
  maxChars: number
): string {
  const role = message.role === "user" ? "User" : "AI";
  const time = new Date(message.created_at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${index + 1}. [${time}] [${role}] ${shorten(message.content_text, maxChars)}`;
}

function isMetaContentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (META_CONTENT_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  const withoutQuote = trimmed.replace(/^["'>\s]+/, "");
  return META_CONTENT_LINE_PATTERNS.some((pattern) => pattern.test(withoutQuote));
}

function sanitizeExperimentalMessageContent(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const filtered = lines.filter((line) => !isMetaContentLine(line));
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeMessagesForExperimentalProcessing(messages: Message[]): Message[] {
  return toOrderedMessages(messages)
    .map((message) => ({
      ...message,
      content_text: sanitizeExperimentalMessageContent(message.content_text),
    }))
    .filter((message) => normalizeWhitespace(message.content_text).length > 0);
}

type ExperimentalEvidenceWindow = {
  label: (typeof EXPERIMENTAL_EVIDENCE_WINDOW_LABELS)[number];
  startIndex: number;
  endIndex: number;
  turns: Message[];
};

function scoreWindowCandidate(
  message: Message,
  label: (typeof EXPERIMENTAL_EVIDENCE_WINDOW_LABELS)[number]
): number {
  const text = message.content_text;
  const lengthBonus = Math.min(4, Math.floor(normalizeWhitespace(text).length / 100));

  switch (label) {
    case "Architecture / Decision Rationale":
      return (
        (ARCHITECTURE_TRADEOFF_CUE.test(text) ? 6 : 0) +
        (DECISION_CUE.test(text) ? 5 : 0) +
        (RATIONALE_CUE.test(text) ? 4 : 0) +
        (message.role === "ai" ? 1 : 0) +
        lengthBonus
      );
    case "Rejected Path":
      return (
        (REJECTED_PATH_CUE.test(text) ? 7 : 0) +
        (DEBUGGING_CUE.test(text) ? 2 : 0) +
        (UNRESOLVED_CUE.test(text) ? 1 : 0) +
        lengthBonus
      );
    case "User Constraint / Working Agreement":
      return (
        (message.role === "user" ? 3 : 0) +
        (CONSTRAINT_CUE.test(text) ? 5 : 0) +
        (PROCESS_AGREEMENT_CUE.test(text) ? 4 : 0) +
        lengthBonus
      );
    case "Unresolved Risk / Next Step":
      return (
        (UNRESOLVED_CUE.test(text) ? 6 : 0) +
        (DECISION_CUE.test(text) ? 1 : 0) +
        lengthBonus
      );
    case "Explanation / Generation":
      return (
        (EXPLANATION_TEACHING_CUE.test(text) ? 4 : 0) +
        (GENERATION_CUE.test(text) ? 5 : 0) +
        (RATIONALE_CUE.test(text) ? 1 : 0) +
        lengthBonus
      );
    default:
      return 0;
  }
}

function selectEvidenceWindow(
  messages: Message[],
  startOffset: number,
  usedIndices: Set<number>,
  label: (typeof EXPERIMENTAL_EVIDENCE_WINDOW_LABELS)[number]
): ExperimentalEvidenceWindow | null {
  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < messages.length; index += 1) {
    if (usedIndices.has(index)) {
      continue;
    }
    const score = scoreWindowCandidate(messages[index], label);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestIndex < 0 || bestScore <= 0) {
    return null;
  }

  let endIndex = bestIndex;
  if (
    bestIndex + 1 < messages.length &&
    !usedIndices.has(bestIndex + 1) &&
    messages[bestIndex + 1].role !== messages[bestIndex].role
  ) {
    endIndex = bestIndex + 1;
  }

  for (let index = bestIndex; index <= endIndex; index += 1) {
    usedIndices.add(index);
  }

  return {
    label,
    startIndex: startOffset + bestIndex,
    endIndex: startOffset + endIndex,
    turns: messages.slice(bestIndex, endIndex + 1),
  };
}

function buildMiddleEvidenceWindowBlock(
  messages: Message[],
  startOffset: number
): string | undefined {
  if (messages.length === 0) {
    return undefined;
  }

  const usedIndices = new Set<number>();
  const windows = EXPERIMENTAL_EVIDENCE_WINDOW_LABELS.map((label) =>
    selectEvidenceWindow(messages, startOffset, usedIndices, label)
  ).filter((window): window is ExperimentalEvidenceWindow => Boolean(window));

  if (windows.length === 0) {
    return undefined;
  }

  return windows
    .slice(0, 5)
    .map((window, index) => {
      const turnRange =
        window.startIndex === window.endIndex
          ? `${window.startIndex + 1}`
          : `${window.startIndex + 1}-${window.endIndex + 1}`;
      return [
        `### Window ${index + 1}: ${window.label} (turns ${turnRange})`,
        ...window.turns.map((turn, turnOffset) =>
          formatPackedTranscriptLine(turn, window.startIndex + turnOffset, 420)
        ),
      ].join("\n");
    })
    .join("\n\n");
}

function buildExperimentalPackedTranscript(messages: Message[]): string {
  const sanitized = sanitizeMessagesForExperimentalProcessing(messages);
  if (sanitized.length === 0) {
    return "[No grounded transcript available after handoff filtering]";
  }

  const ordered = sanitized;
  if (
    ordered.length <=
    EXPERIMENTAL_PACKING.keepFirstMessages + EXPERIMENTAL_PACKING.keepLastMessages
  ) {
    return ordered
      .map((message, index) => formatPackedTranscriptLine(message, index, 900))
      .join("\n");
  }

  const head = ordered.slice(0, EXPERIMENTAL_PACKING.keepFirstMessages);
  const tailStart = Math.max(
    EXPERIMENTAL_PACKING.keepFirstMessages,
    ordered.length - EXPERIMENTAL_PACKING.keepLastMessages
  );
  const middle = ordered.slice(EXPERIMENTAL_PACKING.keepFirstMessages, tailStart);
  const tail = ordered.slice(tailStart);
  const middleEvidenceWindows = buildMiddleEvidenceWindowBlock(
    middle,
    head.length
  );

  const sections = [
    "[Opening Context]",
    ...head.map((message, index) => formatPackedTranscriptLine(message, index, 950)),
  ];

  if (middleEvidenceWindows) {
    sections.push(
      "",
      `[Middle Evidence Windows | grounded evidence excerpts from omitted ${middle.length} turns]`,
      middleEvidenceWindows
    );
  }

  sections.push(
    "",
    "[Latest Context]",
    ...tail.map((message, index) =>
      formatPackedTranscriptLine(message, tailStart + index, 850)
    )
  );

  return sections.join("\n");
}

function buildPromptPayload(
  item: ConversationExportDatasetItem,
  profile: ExportPromptProfile,
  mode: ExportCompressionMode,
  options?: ExportCompressionOptions
): ExportCompressionPromptPayload {
  return {
    conversationTitle: item.conversation.title,
    conversationPlatform: item.conversation.platform,
    conversationOriginAt: getConversationOriginAt(item.conversation),
    messages: item.messages,
    transcriptOverride: isExperimentalCompact(mode, options)
      ? buildExperimentalPackedTranscript(item.messages)
      : undefined,
    locale: detectLocale(),
    profile,
  };
}

function normalizeCompressionBody(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildFallbackTranscript(payload: ExportCompressionPromptPayload): string {
  return payload.messages
    .map((message, index) => {
      const role = message.role === "user" ? "User" : "AI";
      return `${index + 1}. [${role}] ${shorten(message.content_text, 900)}`;
    })
    .join("\n");
}

function getPayloadTranscript(payload: ExportCompressionPromptPayload): string {
  return payload.transcriptOverride || buildFallbackTranscript(payload);
}

function hasTruncationLikeFinishReason(finishReason: string | null | undefined): boolean {
  const normalized = (finishReason || "").toLowerCase();
  return (
    normalized.includes("length") ||
    normalized.includes("max_token") ||
    normalized.includes("max_tokens") ||
    normalized.includes("token_limit") ||
    normalized.includes("content_filter")
  );
}

function hasIncompleteOutputRisk(
  body: string,
  result: InferenceCallResult
): boolean {
  if (hasTruncationLikeFinishReason(result.finishReason)) {
    return true;
  }
  return findIncompleteTerminalLine(body) !== null;
}

function buildExperimentalContinuationPrompt(
  payload: ExportCompressionPromptPayload,
  partialBody: string
): string {
  const transcript = getPayloadTranscript(payload);
  return `The previous experimental handoff stopped before it fully completed.

Continue exactly from where the draft stops.

Rules:
1) Do not restart from StartedAt, Conversation Type, or repeat sections that are already complete.
2) If the draft stops mid-sentence, finish that sentence first.
3) Then finish the current section and add any remaining grounded whitelist sections that are still missing.
4) Keep the same locale and contract as the original handoff.
5) Return only the continuation text, not the full handoff again.

Current draft:
${partialBody}

Grounded transcript:
${transcript}`;
}

function stitchContinuation(base: string, continuation: string): string {
  const cleaned = normalizeCompressionBody(continuation);
  if (!cleaned) {
    return base;
  }

  const joinDirectly =
    /[\p{L}\p{N}\u3400-\u9FFF]$/u.test(base.trimEnd()) &&
    /^[\p{L}\p{N}\u3400-\u9FFF(（]/u.test(cleaned);

  if (joinDirectly) {
    return `${base}${cleaned}`;
  }

  if (base.endsWith("\n")) {
    return `${base}${cleaned}`;
  }

  return `${base}\n${cleaned}`;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function stripBulletPrefix(value: string): string {
  return value.replace(/^[-*]\s+/, "").trim();
}

function countCjkChars(value: string): number {
  return (value.match(/[\u3400-\u9FFF]/g) || []).length;
}

function countAsciiWords(value: string): number {
  return (
    value.match(/[A-Za-z0-9][A-Za-z0-9+/_\-.]*/g) || []
  ).length;
}

function isBulletLikeLine(value: string): boolean {
  const trimmed = value.trim();
  return /^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed);
}

function isSentenceLike(value: string): boolean {
  const text = normalizeWhitespace(stripBulletPrefix(value));
  if (!text) {
    return false;
  }
  if (/[。！？.!?]$/.test(text)) {
    return true;
  }
  if (countCjkChars(text) >= 10) {
    return true;
  }
  return countAsciiWords(text) >= 5;
}

function hasMeaningfulText(value: string): boolean {
  const compact = normalizeWhitespace(
    value.replace(/[`#>*_]/g, " ").replace(/&middot;/g, " ")
  );
  if (!compact) {
    return false;
  }

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(compact))) {
    return false;
  }

  return (
    countCjkChars(compact) >= 4 ||
    countAsciiWords(compact) >= 3 ||
    compact.length >= 18
  );
}

function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?])\s*|(?<=[.!?])\s+/))
    .map((line) => stripBulletPrefix(line.trim()))
    .filter((line) => line && !line.startsWith("```"));
}

function isProseLikeOverview(value: string): boolean {
  const lines = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("```"));

  if (lines.length === 0) {
    return false;
  }

  const proseLines = lines.filter((line) => !isBulletLikeLine(line));
  if (proseLines.length === 0) {
    return false;
  }

  const proseText = proseLines.join(" ");
  const sentenceCount = splitIntoSentences(proseText).filter(isSentenceLike).length;
  if (sentenceCount >= 2) {
    return true;
  }

  return proseLines.length >= 2 && proseText.length >= 140;
}

function scoreCandidate(value: string): number {
  let score = 0;
  if (QUESTION_CUE.test(value)) score += 3;
  if (CONSTRAINT_CUE.test(value)) score += 3;
  if (DECISION_CUE.test(value)) score += 4;
  if (UNRESOLVED_CUE.test(value)) score += 3;
  if (hasRegexMatch(value, PATH_PATTERN)) score += 4;
  if (hasRegexMatch(value, COMMAND_PATTERN)) score += 4;
  if (hasRegexMatch(value, API_PATTERN) || hasRegexMatch(value, BACKTICK_PATTERN)) score += 3;
  score += Math.min(4, Math.floor(normalizeWhitespace(value).length / 32));
  return score;
}

function dedupeAndRank(values: string[], maxItems: number): string[] {
  return unique(values)
    .map((value, index) => ({
      value,
      index,
      score: scoreCandidate(value),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxItems)
    .map((entry) => entry.value);
}

function collectRoleAwareTurns(
  messages: Message[],
  maxItems = 4
): string[] {
  const ordered = toOrderedMessages(messages);
  const firstUser = ordered.find((message) => message.role === "user");
  const firstAi = ordered.find((message) => message.role === "ai");
  const latestAi = [...ordered].reverse().find((message) => message.role === "ai");
  const latestUser = [...ordered]
    .reverse()
    .find((message) => message.role === "user");

  return unique(
    [firstUser, firstAi, latestAi, latestUser]
      .filter((value): value is Message => Boolean(value))
      .map((message) => shorten(message.content_text, 220))
  ).slice(0, maxItems);
}

function collectQuestionCandidates(messages: Message[], maxItems = 3): string[] {
  const candidates = toOrderedMessages(messages)
    .filter((message) => message.role === "user")
    .flatMap((message) => splitIntoSentences(message.content_text))
    .filter((sentence) => QUESTION_CUE.test(sentence))
    .map((sentence) => shorten(sentence, 180));

  if (candidates.length === 0) {
    const firstUser = toOrderedMessages(messages).find(
      (message) => message.role === "user"
    );
    if (firstUser) {
      candidates.push(shorten(firstUser.content_text, 180));
    }
  }

  return dedupeAndRank(candidates, maxItems);
}

function collectConstraintLines(messages: Message[], maxItems = 3): string[] {
  const candidates = toOrderedMessages(messages)
    .filter((message) => message.role === "user")
    .flatMap((message) => splitIntoSentences(message.content_text))
    .filter((sentence) => CONSTRAINT_CUE.test(sentence))
    .map((sentence) => shorten(sentence, 180));

  return dedupeAndRank(candidates, maxItems);
}

function collectDecisionLines(messages: Message[], maxItems = 4): string[] {
  const ordered = toOrderedMessages(messages);
  const aiCandidates = ordered
    .filter((message) => message.role === "ai")
    .flatMap((message) => splitIntoSentences(message.content_text))
    .filter((sentence) => DECISION_CUE.test(sentence))
    .map((sentence) => shorten(sentence, 220));
  const userCandidates = ordered
    .filter((message) => message.role === "user")
    .flatMap((message) => splitIntoSentences(message.content_text))
    .filter((sentence) => DECISION_CUE.test(sentence))
    .map((sentence) => shorten(sentence, 220));

  const combined = [...aiCandidates, ...userCandidates];
  if (combined.length === 0) {
    return dedupeAndRank(
      ordered
        .filter((message) => message.role === "ai")
        .slice(-3)
        .map((message) => shorten(message.content_text, 220)),
      maxItems
    );
  }

  return dedupeAndRank(combined, maxItems);
}

function collectUnresolvedLines(messages: Message[], maxItems = 3): string[] {
  const ordered = toOrderedMessages(messages);
  const candidates = [...ordered]
    .reverse()
    .flatMap((message) => splitIntoSentences(message.content_text))
    .filter((sentence) => UNRESOLVED_CUE.test(sentence))
    .map((sentence) => shorten(sentence, 220));

  if (candidates.length === 0) {
    const lastUser = [...ordered].reverse().find((message) => message.role === "user");
    if (lastUser) {
      candidates.push(shorten(lastUser.content_text, 220));
    }
  }

  return dedupeAndRank(candidates, maxItems);
}

function collectCodeBlocks(messages: Message[], maxItems = 2): string[] {
  const snippets: string[] = [];
  for (const message of messages) {
    const matches = message.content_text.match(CODE_BLOCK_PATTERN) || [];
    for (const block of matches) {
      const inner = block
        .replace(/```[a-zA-Z0-9_-]*\s*/, "")
        .replace(/```$/, "")
        .trim();
      if (!inner) continue;
      const firstLines = inner
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(" | ");
      if (firstLines) {
        snippets.push(`Code: \`${shorten(firstLines, 140)}\``);
      }
    }
  }

  return dedupeAndRank(snippets, maxItems);
}

function detectFallbackCompressionContext(messages: Message[]): {
  mathHeavy: boolean;
  explanationTeaching: boolean;
} {
  const transcript = messages.map((message) => message.content_text).join("\n");
  const questionHeavyUserText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content_text)
    .join("\n");
  const mathHeavy =
    MATH_HEAVY_CUE.test(transcript) ||
    transcript
      .split(/\r?\n/)
      .some((line) => SYMBOL_DENSE_LINE.test(line.trim()));
  const explanationTeaching =
    EXPLANATION_TEACHING_CUE.test(questionHeavyUserText) &&
    collectDecisionLines(messages, 2).length === 0;

  return {
    mathHeavy,
    explanationTeaching,
  };
}

function isLatexNoise(value: string): boolean {
  const compact = normalizeWhitespace(value);
  return (
    !compact ||
    MATH_HEAVY_CUE.test(compact) ||
    /^\.?[\\/](?:[A-Za-z]+|[A-Za-z]+[{}()[\]])$/.test(compact) ||
    /^[A-Za-z]\/[A-Za-z]$/.test(compact) ||
    /^[0-9A-Za-z]+[-+*/][0-9A-Za-z]+$/.test(compact)
  );
}

function isExplicitPathCandidate(value: string): boolean {
  const compact = normalizeWhitespace(value);
  if (!compact || isLatexNoise(compact)) {
    return false;
  }

  if (
    /[{}[\]"]/.test(compact) ||
    /^(?:[PE]\d(?:\/|\\))+[PE]?\d$/i.test(compact)
  ) {
    return false;
  }

  if (/^[A-Za-z]:\\/.test(compact)) {
    return true;
  }

  if (!/[\\/]/.test(compact)) {
    return false;
  }

  const stripped = compact.replace(/^\.{0,2}[\\/]/, "");
  const segments = stripped.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  if (
    segments.every(
      (segment) => segment.length <= 2 && /^[A-Za-z0-9]+$/.test(segment)
    )
  ) {
    return false;
  }

  if (
    segments.length === 1 &&
    !/\.[A-Za-z0-9]+$/.test(segments[0]) &&
    segments[0].length < 6
  ) {
    return false;
  }

  const meaningfulSegments = segments.filter(
    (segment) =>
      /[A-Za-z]/.test(segment) &&
      segment.replace(/\.[A-Za-z0-9]+$/, "").length >= 2 &&
      !/^\\?[A-Za-z]+$/.test(segment)
  );

  return meaningfulSegments.length > 0;
}

function isLikelyDocumentationPath(value: string): boolean {
  const compact = normalizeWhitespace(value);
  return (
    /\.mdx?$/i.test(compact) ||
    /\.txt$/i.test(compact) ||
    /(^|[\\/])README(?:\.[A-Za-z0-9]+)?$/i.test(compact) ||
    /(^|[\\/])documents?[\\/]/i.test(compact)
  );
}

function collectFilePathLines(
  messages: Message[],
  maxItems = 4,
  options?: {
    includeDocs?: boolean;
    docsOnly?: boolean;
  }
): string[] {
  const matches: string[] = [];
  for (const message of messages) {
    for (const found of message.content_text.match(PATH_PATTERN) || []) {
      if (!isExplicitPathCandidate(found)) continue;
      const normalized = shorten(found, 140);
      const isDocPath = isLikelyDocumentationPath(normalized);
      if (options?.docsOnly && !isDocPath) {
        continue;
      }
      if (options?.includeDocs !== true && isDocPath) {
        continue;
      }
      matches.push(`Path: ${normalized}`);
    }
  }

  return dedupeAndRank(matches, maxItems);
}

function collectCommandLines(messages: Message[], maxItems = 4): string[] {
  const matches: string[] = [];
  for (const message of messages) {
    for (const found of message.content_text.match(COMMAND_PATTERN) || []) {
      const normalized = shorten(found.trim(), 160);
      if (normalized) {
        matches.push(`Command: ${normalized}`);
      }
    }
  }

  return dedupeAndRank(matches, maxItems);
}

function collectApiHints(
  messages: Message[],
  maxItems = 4,
  options?: { strict?: boolean }
): string[] {
  const matches: string[] = [];
  for (const message of messages) {
    for (const found of message.content_text.match(API_PATTERN) || []) {
      matches.push(`API/Function: ${shorten(found, 120)}`);
    }
    if (!options?.strict) {
      for (const found of message.content_text.match(BACKTICK_PATTERN) || []) {
        matches.push(`Reference: ${shorten(found, 120)}`);
      }
    }
  }

  return dedupeAndRank(matches, maxItems);
}

function collectArtifactLines(messages: Message[], maxItems = 5): string[] {
  const context = detectFallbackCompressionContext(messages);
  const strictArtifacts = context.mathHeavy || context.explanationTeaching;

  return unique([
    ...collectFilePathLines(messages, maxItems),
    ...collectCommandLines(messages, maxItems),
    ...collectApiHints(messages, maxItems, { strict: strictArtifacts }),
    ...(strictArtifacts ? [] : collectCodeBlocks(messages, maxItems)),
  ]).slice(0, maxItems);
}

function collectPotentialTags(
  conversation: Conversation,
  messages: Message[],
  maxItems = 5
): string[] {
  const titleWords = conversation.title
    .split(/[^A-Za-z0-9_.-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
  const platform = conversation.platform;
  const fileHints = collectArtifactLines(messages, 6)
    .map((value) => value.split(/[\\/]/).pop() || value)
    .map((value) => value.replace(/^.*?:\s*/, ""))
    .map((value) => value.replace(/\.[A-Za-z0-9]+$/, ""));

  return unique([platform, ...conversation.tags, ...titleWords, ...fileHints]).slice(
    0,
    maxItems
  );
}

function pickContextLine(
  conversation: Conversation,
  messages: Message[]
): string {
  const firstUser = messages.find((message) => message.role === "user");
  return shorten(
    conversation.snippet ||
      firstUser?.content_text ||
      conversation.title ||
      "No context captured.",
    220
  );
}

function collectRejectedPathLines(messages: Message[], maxItems = 3): string[] {
  const candidates = toOrderedMessages(messages)
    .flatMap((message) => splitIntoSentences(message.content_text))
    .filter(
      (sentence) =>
        /(?:\b(?:reject|rejected|avoid|failed because|didn't work|did not work|not the issue|ruled out|not the blocker|do not reopen)\b|排除|否掉|不走这条路|不是主因|不要重开|失败因为)/i.test(
          sentence
        )
    )
    .map((sentence) => shorten(sentence, 220));

  return dedupeAndRank(candidates, maxItems);
}

function collectKeyUnderstandingLines(messages: Message[], maxItems = 3): string[] {
  const ordered = toOrderedMessages(messages);
  const candidates = [
    ...ordered
      .filter((message) => message.role === "ai")
      .flatMap((message) => splitIntoSentences(message.content_text))
      .filter(
        (sentence) =>
          EXPLANATION_TEACHING_CUE.test(sentence) ||
          MATH_HEAVY_CUE.test(sentence) ||
          /\b(?:means|therefore|because|intuition|understanding|core idea|bridge)\b/i.test(
            sentence
          )
      )
      .map((sentence) => shorten(sentence, 220)),
    ...ordered
      .filter((message) => message.role === "user")
      .flatMap((message) => splitIntoSentences(message.content_text))
      .filter((sentence) => EXPLANATION_TEACHING_CUE.test(sentence))
      .map((sentence) => shorten(sentence, 220)),
  ];

  if (candidates.length === 0) {
    const latestAi = [...ordered].reverse().find((message) => message.role === "ai");
    if (latestAi) {
      candidates.push(shorten(latestAi.content_text, 220));
    }
  }

  return dedupeAndRank(candidates, maxItems);
}

function collectGenerationDirectionLines(
  messages: Message[],
  maxItems = 4
): string[] {
  const candidates = toOrderedMessages(messages)
    .flatMap((message) => splitIntoSentences(message.content_text))
    .filter(
      (sentence) =>
        GENERATION_CUE.test(sentence) ||
        /\b(?:candidate|option|direction|variant|frame|draft|concept)\b/i.test(
          sentence
        )
    )
    .map((sentence) => shorten(sentence, 220));

  return dedupeAndRank(candidates, maxItems);
}

function collectSelectionCriteriaLines(
  messages: Message[],
  maxItems = 3
): string[] {
  const candidates = toOrderedMessages(messages)
    .flatMap((message) => splitIntoSentences(message.content_text))
    .filter(
      (sentence) =>
        /\b(?:criteria|criterion|select|selection|screen|evaluate|judge|trade[- ]?off|constraint)\b/i.test(
          sentence
        ) ||
        /(?:标准|筛选|判断依据|约束条件|取舍依据|评估标准)/.test(sentence)
    )
    .map((sentence) => shorten(sentence, 220));

  return dedupeAndRank(candidates, maxItems);
}

function collectUserContextLines(messages: Message[], maxItems = 4): string[] {
  const candidates = toOrderedMessages(messages)
    .filter((message) => message.role === "user")
    .flatMap((message) => splitIntoSentences(message.content_text))
    .filter(
      (sentence) =>
        CONSTRAINT_CUE.test(sentence) ||
        PROCESS_AGREEMENT_CUE.test(sentence) ||
        /\b(?:do not|don't|keep|preserve|avoid|only|maintenance-only|exact failure mode)\b/i.test(
          sentence
        )
    )
    .map((sentence) => shorten(sentence, 220));

  return dedupeAndRank(candidates, maxItems);
}

function classifyConditionalConversation(
  item: ConversationExportDatasetItem
): string[] {
  const messages = item.messages;
  const transcript = messages.map((message) => message.content_text).join("\n");
  const context = detectFallbackCompressionContext(messages);
  const decisions = collectDecisionLines(messages, 4);
  const unresolved = collectUnresolvedLines(messages, 3);
  const rejected = collectRejectedPathLines(messages, 3);
  const userContext = collectUserContextLines(messages, 4);
  const keyUnderstanding = collectKeyUnderstandingLines(messages, 3);
  const generationDirections = collectGenerationDirectionLines(messages, 4);
  const selectionCriteria = collectSelectionCriteriaLines(messages, 3);

  const scores: Record<string, number> = {
    decision: 0,
    debugging: 0,
    architecture_tradeoff: 0,
    explanation_teaching: 0,
    process_agreement: 0,
    generation: 0,
  };

  scores.decision += decisions.length * 3 + unresolved.length;
  scores.debugging += rejected.length * 3;
  scores.architecture_tradeoff += rejected.length * 2 + userContext.length;
  scores.explanation_teaching += keyUnderstanding.length * 2;
  scores.process_agreement += userContext.length * 3;
  scores.generation += generationDirections.length * 3 + selectionCriteria.length * 2;

  if (DEBUGGING_CUE.test(transcript)) scores.debugging += 4;
  if (ARCHITECTURE_TRADEOFF_CUE.test(transcript)) scores.architecture_tradeoff += 4;
  if (PROCESS_AGREEMENT_CUE.test(transcript)) scores.process_agreement += 5;
  if (EXPLANATION_TEACHING_CUE.test(transcript)) scores.explanation_teaching += 4;
  if (GENERATION_CUE.test(transcript)) scores.generation += 5;
  if (context.mathHeavy) scores.explanation_teaching += 5;
  if (context.explanationTeaching) scores.explanation_teaching += 4;
  if (decisions.length === 0 && userContext.length > 0) scores.process_agreement += 2;
  if (decisions.length > 0 && rejected.length > 0) scores.debugging += 2;
  if (decisions.length > 0 && userContext.length > 0) scores.decision += 1;
  if (generationDirections.length > 1 && decisions.length <= 1) scores.generation += 2;
  if (
    GENERATION_CUE.test(transcript) &&
    ARCHITECTURE_TRADEOFF_CUE.test(transcript)
  ) {
    scores.generation += 1;
    scores.architecture_tradeoff += 1;
  }

  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .filter((entry) => entry[1] > 0)
    .map((entry) => entry[0]);

  if (ranked.length === 0) {
    return ["decision"];
  }

  const [first, second] = ranked;
  if (
    second &&
    scores[second] >= 4 &&
    scores[first] - scores[second] <= 2 &&
    first !== second
  ) {
    return [first, second];
  }

  return [first];
}

function buildConditionalSections(
  item: ConversationExportDatasetItem
): Array<{ heading: string; lines: string[] }> {
  const messages = item.messages;
  const conversationTypes = classifyConditionalConversation(item);
  const context = detectFallbackCompressionContext(messages);
  const decisions = collectDecisionLines(messages, 4);
  const rejected = collectRejectedPathLines(messages, 3);
  const userContext = collectUserContextLines(messages, 4);
  const generationDirections = collectGenerationDirectionLines(messages, 4);
  const selectionCriteria = collectSelectionCriteriaLines(messages, 3);
  const docAnchors = collectFilePathLines(messages, 4, {
    includeDocs: true,
    docsOnly: true,
  });
  const technicalAnchors = unique([
    ...collectFilePathLines(messages, 4),
    ...collectCommandLines(messages, 3),
    ...collectApiHints(messages, 3, { strict: true }),
  ]).slice(0, 4);
  const anchors =
    context.mathHeavy || conversationTypes.includes("explanation_teaching")
      ? unique([...docAnchors, ...technicalAnchors]).slice(0, 4)
      : conversationTypes.includes("architecture_tradeoff") ||
          (conversationTypes.includes("decision") &&
            !conversationTypes.includes("debugging"))
        ? unique([
            ...docAnchors,
            ...collectCommandLines(messages, 2),
            ...collectApiHints(messages, 2, { strict: true }),
            ...collectFilePathLines(messages, 2),
          ]).slice(0, 4)
        : collectArtifactLines(messages, 5);
  const understanding = collectKeyUnderstandingLines(messages, 3);
  const unresolved = collectUnresolvedLines(messages, 3);
  const generationUnderstanding = unique([
    ...generationDirections,
    ...selectionCriteria,
    ...understanding,
  ]).slice(0, 4);

  const sections: Array<{ heading: string; lines: string[] }> = [];

  const shouldEmitDecisionSection =
    decisions.length > 0 &&
    (!conversationTypes.includes("generation") || rejected.length > 0 || selectionCriteria.length > 0);

  if (shouldEmitDecisionSection) {
    sections.push({
      heading: "## Decisions And Reasoning",
      lines: decisions.map((line) => `- ${line}`),
    });
  }

  if (rejected.length > 0) {
    sections.push({
      heading: "## Failed Or Rejected Paths",
      lines: rejected.map((line) => `- ${line}`),
    });
  }

  if (userContext.length > 0) {
    sections.push({
      heading: "## User Context And Corrections",
      lines: userContext.map((line) => `- ${line}`),
    });
  }

  if (anchors.length > 0) {
    sections.push({
      heading: "## Descriptive Anchors",
      lines: anchors.map((line) => `- ${line.replace(/^[-*]\s+/, "")}`),
    });
  }

  if (generationUnderstanding.length > 0) {
    sections.push({
      heading: "## Key Understanding",
      lines: generationUnderstanding.map((line) => `- ${line}`),
    });
  }

  if (unresolved.length > 0) {
    sections.push({
      heading: "## Open Risks And Next Actions",
      lines: unresolved.map((line) => `- ${line}`),
    });
  }

  return CONDITIONAL_HANDOFF_SECTION_ORDER.map((heading) =>
    sections.find((section) => section.heading === heading)
  ).filter((section): section is { heading: string; lines: string[] } => Boolean(section));
}

function buildExperimentalStateOverview(
  item: ConversationExportDatasetItem,
  conversationTypes: string[]
): string {
  const messages = item.messages;
  const threadLabel = shorten(
    item.conversation.title ||
      collectQuestionCandidates(messages, 1)[0] ||
      item.conversation.snippet ||
      "this thread",
    120
  ).replace(/[.。]$/, "");
  const primaryQuestion = stripBulletPrefix(
    collectQuestionCandidates(messages, 1)[0] || ""
  ).replace(/[?？]$/, "");
  const leadingDecision = stripBulletPrefix(
    collectDecisionLines(messages, 1)[0] || ""
  ).replace(/[.。]$/, "");
  const leadingRejected = stripBulletPrefix(
    collectRejectedPathLines(messages, 1)[0] || ""
  ).replace(/[.。]$/, "");
  const leadingConstraint = stripBulletPrefix(
    collectUserContextLines(messages, 1)[0] || ""
  ).replace(/[.。]$/, "");
  const leadingUnderstanding = stripBulletPrefix(
    collectKeyUnderstandingLines(messages, 1)[0] || ""
  ).replace(/[.。]$/, "");
  const leadingGeneration = stripBulletPrefix(
    collectGenerationDirectionLines(messages, 1)[0] || ""
  ).replace(/[.。]$/, "");
  const nextState = stripBulletPrefix(
    collectUnresolvedLines(messages, 1)[0] ||
      collectSelectionCriteriaLines(messages, 1)[0] ||
      ""
  ).replace(/[.。]$/, "");

  const typeSummary = conversationTypes.join(" + ");
  const problemClause = conversationTypes.includes("architecture_tradeoff")
    ? primaryQuestion ||
      "evaluate a constrained design space and carry forward the chosen workflow shape"
    : conversationTypes.includes("debugging")
      ? primaryQuestion ||
        "preserve the causal chain behind the failure and the chosen repair direction"
      : conversationTypes.includes("process_agreement")
        ? leadingConstraint ||
          "lock the working agreement that should constrain the next iteration"
        : conversationTypes.includes("generation")
          ? leadingGeneration ||
            "keep multiple candidate frames available instead of forcing false convergence"
          : conversationTypes.includes("explanation_teaching")
            ? leadingUnderstanding ||
              "clarify the core model or explanation the next agent should inherit"
            : primaryQuestion || "carry forward the essential execution state";
  const stateClause =
    leadingDecision ||
    leadingUnderstanding ||
    leadingConstraint ||
    leadingGeneration ||
    leadingRejected ||
    "the thread already converged on several grounded constraints that the next agent should not rediscover";
  const continuationClause =
    nextState ||
    leadingRejected ||
    "the next agent should continue from this state without re-opening already settled paths";

  return [
    `This ${typeSummary} thread is about ${threadLabel} and exists to ${problemClause}.`,
    `The current state is that ${stateClause}.`,
    `The next agent inherits ${continuationClause}.`,
  ].join(" ");
}

function buildExperimentalCompactFallback(
  item: ConversationExportDatasetItem,
  reason: string
): string {
  const filteredItem: ConversationExportDatasetItem = {
    ...item,
    messages: sanitizeMessagesForExperimentalProcessing(item.messages),
  };
  const startedAt = item.conversation
    ? new Date(getConversationOriginAt(item.conversation)).toISOString()
    : "unknown";
  const conversationTypes = classifyConditionalConversation(filteredItem);
  const sections = buildConditionalSections(filteredItem);
  const stateOverview = buildExperimentalStateOverview(
    filteredItem,
    conversationTypes
  );

  const lines = [
    `StartedAt: ${startedAt || "unknown"}`,
    `Conversation Type: ${conversationTypes.join(" + ")}`,
    "",
    CONDITIONAL_HANDOFF_OVERVIEW_HEADING,
    stateOverview,
  ];

  if (sections.length === 0) {
    lines.push(
      "",
      "## Open Risks And Next Actions",
      `- Local handoff fallback could not derive a richer handoff. Reason: ${reason}.`
    );
    return lines.join("\n");
  }

  lines.push("");
  for (const section of sections) {
    lines.push(section.heading);
    lines.push(...section.lines);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function toBulletLines(values: string[], emptyLine: string): string[] {
  if (values.length === 0) {
    return [emptyLine];
  }
  return values.map((value) => `- ${value}`);
}

function buildSummaryTldr(
  item: ConversationExportDatasetItem,
  questions: string[],
  decisions: string[],
  unresolved: string[]
): string {
  const question = questions[0];
  const decision = decisions[0];
  const unresolvedLine = unresolved[0];

  if (question && decision) {
    return shorten(
      `The thread focused on ${question.replace(/[?？]$/, "")} and converged on ${decision.replace(/^[-*]\s*/, "")}${
        unresolvedLine ? ` while leaving ${unresolvedLine.replace(/^[-*]\s*/, "").replace(/[.。]$/, "")} open.` : "."
      }`,
      220
    );
  }

  if (decision) {
    return shorten(decision, 220);
  }

  return shorten(
    item.conversation.snippet ||
      item.conversation.title ||
      "This thread captured a focused discussion without enough signal for a richer TL;DR.",
    220
  );
}

function buildCompactFallback(
  item: ConversationExportDatasetItem,
  reason: string
): string {
  const messages = item.messages;
  const questions = collectQuestionCandidates(messages, 3);
  const constraints = collectConstraintLines(messages, 2);
  const decisions = collectDecisionLines(messages, 4);
  const artifacts = collectArtifactLines(messages, 5);
  const unresolved = collectUnresolvedLines(messages, 3);

  const background = [
    `- Title: ${item.conversation.title || "(untitled)"}`,
    `- Platform: ${item.conversation.platform}`,
    `- Context: ${pickContextLine(item.conversation, messages)}`,
    ...constraints.map((constraint) => `- Constraint: ${constraint}`),
    `- Fallback reason: ${reason}`,
  ];

  return [
    "## Background",
    ...background,
    "",
    "## Key Questions",
    ...toBulletLines(questions, "- No explicit user question was captured."),
    "",
    "## Decisions And Answers",
    ...toBulletLines(decisions, "- No grounded decision or answer was captured."),
    "",
    "## Reusable Artifacts",
    ...toBulletLines(artifacts, "- None grounded in this thread."),
    "",
    "## Unresolved",
    ...toBulletLines(unresolved, "- No unresolved follow-up was explicit in this thread."),
  ].join("\n");
}

function buildSummaryFallback(
  item: ConversationExportDatasetItem,
  reason: string
): string {
  const messages = item.messages;
  const questions = collectQuestionCandidates(messages, 2);
  const constraints = collectConstraintLines(messages, 2);
  const decisions = collectDecisionLines(messages, 3);
  const artifacts = collectArtifactLines(messages, 5);
  const unresolved = collectUnresolvedLines(messages, 3);
  const roleAwareMoves = collectRoleAwareTurns(messages, 4);
  const tags = collectPotentialTags(item.conversation, messages, 5);

  const problemFrame = [
    item.conversation.title || "Untitled conversation",
    pickContextLine(item.conversation, messages),
    ...questions,
    ...constraints,
  ];
  const importantMoves = decisions.length > 0 ? decisions : roleAwareMoves;

  return [
    "## TL;DR",
    `- ${buildSummaryTldr(item, questions, decisions, unresolved)}`,
    "",
    "## Problem Frame",
    ...toBulletLines(problemFrame, "- No problem framing captured."),
    "",
    "## Important Moves",
    ...toBulletLines(importantMoves, "- No grounded key move was captured."),
    "",
    "## Reusable Snippets",
    ...toBulletLines(artifacts, "- None grounded in this thread."),
    "",
    "## Next Steps",
    ...toBulletLines(unresolved, "- No grounded next step was explicit in this thread."),
    "",
    "## Tags",
    `- ${tags.length > 0 ? tags.join(", ") : `fallback-local, ${reason}`}`,
  ].join("\n");
}

function buildLocalFallback(
  item: ConversationExportDatasetItem,
  mode: ExportCompressionMode,
  options: ExportCompressionOptions | undefined,
  reason: string,
  diagnostic?: LlmDiagnostic | null,
  failureContext?: ExportCompressionFailureContext | null
): CompressedConversationExport {
  const compactVariant =
    failureContext?.compactVariant ?? resolveCompactVariant(mode, options);
  const body =
    mode === "compact"
      ? compactVariant === "experimental"
        ? buildExperimentalCompactFallback(item, reason)
        : buildCompactFallback(item, reason)
      : buildSummaryFallback(item, reason);
  const validation = validateCompressionOutput(body, item, mode, options);

  return {
    conversation: item.conversation,
    messages: item.messages,
    body,
    mode,
    compactVariant,
    source: "local_fallback",
    route: failureContext?.route,
    usedFallbackPrompt: false,
    fallbackReason: diagnostic?.code || reason,
    diagnostic: diagnostic || undefined,
    modelId: failureContext?.modelId,
    exportPromptProfile: failureContext?.exportPromptProfile,
    primaryInvalidReason: failureContext?.primaryInvalidReason,
    fallbackInvalidReason: failureContext?.fallbackInvalidReason,
    llmAttemptMetrics: failureContext?.llmAttemptMetrics,
    deliveredArtifactMetrics: buildDeliveredArtifactMetrics(
      validation.runtimeMetrics,
      body
    ),
    integrityWarnings: validation.integrityWarnings,
    softCompressionWarning: validation.softCompressionWarning,
    reviewReady: !(
      mode === "compact" && compactVariant === "experimental"
    ),
  };
}

function getExportLabel(
  mode: ExportCompressionMode,
  compactVariant?: ConversationExportCompactVariant
): string {
  if (mode === "compact") {
    return compactVariant === "experimental"
      ? "Distilled handoff"
      : "Compact";
  }
  return "Summary";
}

function getExportValidationFeedback(
  reason: string | undefined,
  mode: ExportCompressionMode,
  compactVariant?: ConversationExportCompactVariant
):
  | { detail: string; hint: string }
  | null {
  switch (reason) {
    case "export_output_too_short":
      return {
        detail:
          "LLM returned text, but it was too short to satisfy the export compression baseline. Validation: export_output_too_short.",
        hint:
          compactVariant === "experimental"
            ? "Try the other model path later or use Full export while we tune this handoff line."
            : "Try the other model path later or use Full export while we tune this profile.",
      };
    case "export_missing_required_headings":
      return {
        detail:
          compactVariant === "experimental"
            ? "LLM returned text, but the distilled handoff markers were missing or malformed. Validation: export_missing_required_headings."
            : "LLM returned text, but the required markdown sections were missing. Validation: export_missing_required_headings.",
        hint:
          compactVariant === "experimental"
            ? "This handoff expects StartedAt, Conversation Type, and one or more grounded whitelist sections."
            : "We expect the shipping export headings exactly; this is usually a prompt/profile compliance issue rather than an auth or routing failure.",
      };
    case "export_grounded_sections_insufficient":
      return {
        detail:
          "LLM returned the right shape, but too many sections were generic or not grounded in the thread. Validation: export_grounded_sections_insufficient.",
        hint: "This usually means the model answered loosely instead of preserving the thread's actual moves and constraints.",
      };
    case "export_artifact_signal_missing":
      return {
        detail:
          "LLM returned structured text, but dropped code, command, or file-path evidence that the thread contained. Validation: export_artifact_signal_missing.",
        hint: "Use Full export for now if artifact fidelity is critical, then retry after we tune the compression profile.",
      };
    default:
      return null;
  }
}

function describeCompressionRoute(
  route: ExportCompressionRoute | undefined
): string {
  switch (route) {
    case "current_llm_settings":
      return "Current LLM settings";
    case "moonshot_direct":
      return "Moonshot direct";
    default:
      return "Unknown";
  }
}

function formatAttemptMetricsSummary(
  label: string,
  metrics: ExportCompressionAttemptMetrics
): string {
  const parts = [
    `${label} prompt/raw/normalized: ${metrics.promptChars}/${metrics.rawOutputChars}/${metrics.normalizedOutputChars}`,
    `truncated prompt: ${metrics.truncatedPromptChars}`,
  ];

  if (metrics.finishReason) {
    parts.push(`finish=${metrics.finishReason}`);
  }
  if (
    metrics.promptTokens !== null &&
    metrics.promptTokens !== undefined &&
    metrics.completionTokens !== null &&
    metrics.completionTokens !== undefined
  ) {
    parts.push(
      `usage=${metrics.promptTokens}/${metrics.completionTokens}/${metrics.totalTokens ?? "?"}`
    );
  }
  if (
    metrics.requestedMaxTokens !== null &&
    metrics.requestedMaxTokens !== undefined &&
    metrics.effectiveMaxTokens !== null &&
    metrics.effectiveMaxTokens !== undefined
  ) {
    parts.push(
      `proxy_max_tokens=${metrics.requestedMaxTokens}/${metrics.effectiveMaxTokens}/${metrics.proxyMaxTokensLimit ?? "?"}`
    );
  }
  if (metrics.invalidReason) {
    parts.push(metrics.invalidReason);
  }
  if (metrics.incompleteOutputRisk) {
    parts.push("incomplete_output_risk");
  }
  if (metrics.continuation) {
    parts.push(
      `continuation raw/normalized=${metrics.continuation.rawOutputChars}/${metrics.continuation.normalizedOutputChars}`
    );
    if (metrics.continuation.finishReason) {
      parts.push(`continuation_finish=${metrics.continuation.finishReason}`);
    }
    if (
      metrics.continuation.promptTokens !== null &&
      metrics.continuation.promptTokens !== undefined &&
      metrics.continuation.completionTokens !== null &&
      metrics.continuation.completionTokens !== undefined
    ) {
      parts.push(
        `continuation_usage=${metrics.continuation.promptTokens}/${metrics.continuation.completionTokens}/${metrics.continuation.totalTokens ?? "?"}`
      );
    }
    if (
      metrics.continuation.requestedMaxTokens !== null &&
      metrics.continuation.requestedMaxTokens !== undefined &&
      metrics.continuation.effectiveMaxTokens !== null &&
      metrics.continuation.effectiveMaxTokens !== undefined
    ) {
      parts.push(
        `continuation_proxy_max_tokens=${metrics.continuation.requestedMaxTokens}/${metrics.continuation.effectiveMaxTokens}/${metrics.continuation.proxyMaxTokensLimit ?? "?"}`
      );
    }
  }

  return parts.join(" ");
}

function buildCompressionTechnicalSummary(
  result: CompressedConversationExport
): string | undefined {
  const parts: string[] = [];

  if (result.diagnostic?.technicalSummary) {
    parts.push(result.diagnostic.technicalSummary);
  }

  if (result.route) {
    parts.push(`Compression route: ${describeCompressionRoute(result.route)}`);
  }

  if (result.mode === "compact") {
    parts.push(`Compact line: ${describeCompactLine(result.compactVariant)}`);
  }

  if (result.modelId) {
    parts.push(`Model: ${result.modelId}`);
  }

  if (result.exportPromptProfile) {
    parts.push(`Profile: ${result.exportPromptProfile}`);
  }

  if (result.source === "local_fallback") {
    if (result.primaryInvalidReason) {
      parts.push(`Primary: ${result.primaryInvalidReason}`);
    }
    if (result.fallbackInvalidReason) {
      parts.push(`Fallback: ${result.fallbackInvalidReason}`);
    }
    if (result.llmAttemptMetrics?.primary) {
      parts.push(
        formatAttemptMetricsSummary(
          "LLM primary",
          result.llmAttemptMetrics.primary
        )
      );
    }
    if (result.llmAttemptMetrics?.fallbackPrompt) {
      parts.push(
        formatAttemptMetricsSummary(
          "LLM fallback",
          result.llmAttemptMetrics.fallbackPrompt
        )
      );
    }
    if (
      result.mode === "compact" &&
      result.compactVariant === "experimental" &&
      result.reviewReady === false
    ) {
      parts.push("Deterministic experimental fallback is diagnostic only, not ideal for expert review.");
    }
  }

  if (result.source === "llm") {
    if (result.llmAttemptMetrics?.primary) {
      parts.push(
        formatAttemptMetricsSummary(
          "LLM primary",
          result.llmAttemptMetrics.primary
        )
      );
    }
    if (result.usedFallbackPrompt && result.llmAttemptMetrics?.fallbackPrompt) {
      parts.push(
        formatAttemptMetricsSummary(
          "LLM fallback",
          result.llmAttemptMetrics.fallbackPrompt
        )
      );
    }
  }

  if (result.deliveredArtifactMetrics) {
    parts.push(
      `${result.source === "local_fallback" ? "Delivered fallback" : "Delivered artifact"} raw/normalized/serialized: ${result.deliveredArtifactMetrics.rawOutputChars}/${result.deliveredArtifactMetrics.normalizedOutputChars}/${result.deliveredArtifactMetrics.serializedOutputChars}`
    );
    if (result.deliveredArtifactMetrics.softMinChars !== null) {
      parts.push(
        `Soft floor: ${result.deliveredArtifactMetrics.softMinChars} chars (transcript ${result.deliveredArtifactMetrics.transcriptChars})`
      );
    }
  }

  if (result.integrityWarnings && result.integrityWarnings.length > 0) {
    parts.push(`Integrity warnings: ${result.integrityWarnings.join(", ")}`);
  }

  if (result.softCompressionWarning) {
    parts.push(result.softCompressionWarning);
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function extractSections(
  value: string,
  mode: ExportCompressionMode
): Record<string, string> | null {
  const headings = EXPECTED_HEADINGS[mode];
  const sections: Record<string, string> = {};

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const start = value.indexOf(heading);
    if (start < 0) {
      return null;
    }

    const bodyStart = start + heading.length;
    const nextHeading = headings
      .slice(index + 1)
      .map((candidate) => ({
        candidate,
        position: value.indexOf(candidate, bodyStart),
      }))
      .filter((entry) => entry.position >= 0)
      .sort((a, b) => a.position - b.position)[0];

    const body = value
      .slice(bodyStart, nextHeading ? nextHeading.position : undefined)
      .trim();
    sections[heading] = body;
  }

  return sections;
}

function parseConditionalConversationType(value: string): string[] | null {
  const normalized = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (normalized.length < 1 || normalized.length > 2) {
    return null;
  }

  if (normalized.some((part) => !CONDITIONAL_HANDOFF_TYPE_SET.has(part))) {
    return null;
  }

  return normalized;
}

function extractConditionalHandoff(
  value: string
): ConditionalHandoffParseResult | null {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  const startedLine = nonEmptyLines[0] || "";
  const typeLine = nonEmptyLines[1] || "";

  if (!startedLine.startsWith("StartedAt:")) {
    return null;
  }
  if (!typeLine.startsWith("Conversation Type:")) {
    return null;
  }

  const startedAt = startedLine.replace(/^StartedAt:\s*/, "").trim();
  const conversationTypes = parseConditionalConversationType(
    typeLine.replace(/^Conversation Type:\s*/, "").trim()
  );
  if (!conversationTypes) {
    return null;
  }

  const rawSections: Record<string, string> = {};
  const sectionOrder: string[] = [];
  let currentHeading: string | null = null;

  for (const rawLine of lines.slice(2)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (currentHeading) {
        rawSections[currentHeading] = `${rawSections[currentHeading]}\n`;
      }
      continue;
    }

    if (trimmed.startsWith("## ")) {
      if (!CONDITIONAL_HANDOFF_ALLOWED_HEADINGS.includes(trimmed)) {
        return null;
      }
      if (rawSections[trimmed] !== undefined) {
        return null;
      }
      if (
        sectionOrder.length === 0 &&
        trimmed !== CONDITIONAL_HANDOFF_OVERVIEW_HEADING
      ) {
        return null;
      }
      if (
        sectionOrder.length > 0 &&
        trimmed === CONDITIONAL_HANDOFF_OVERVIEW_HEADING
      ) {
        return null;
      }
      rawSections[trimmed] = "";
      sectionOrder.push(trimmed);
      currentHeading = trimmed;
      continue;
    }

    if (!currentHeading) {
      return null;
    }

    rawSections[currentHeading] = rawSections[currentHeading]
      ? `${rawSections[currentHeading]}\n${rawLine}`
      : rawLine;
  }

  if (
    sectionOrder.length === 0 ||
    sectionOrder[0] !== CONDITIONAL_HANDOFF_OVERVIEW_HEADING
  ) {
    return null;
  }

  const stateOverview = (
    rawSections[CONDITIONAL_HANDOFF_OVERVIEW_HEADING] || ""
  ).trim();
  if (
    !stateOverview ||
    !hasMeaningfulText(stateOverview) ||
    !isProseLikeOverview(stateOverview)
  ) {
    return null;
  }

  const conditionalHeadings = sectionOrder.filter(
    (heading) => heading !== CONDITIONAL_HANDOFF_OVERVIEW_HEADING
  );
  if (conditionalHeadings.length === 0) {
    return null;
  }

  const observedOrder = conditionalHeadings.map((heading) =>
    CONDITIONAL_HANDOFF_SECTION_ORDER.indexOf(heading)
  );
  const sortedOrder = [...observedOrder].sort((a, b) => a - b);
  if (observedOrder.some((value, index) => value !== sortedOrder[index])) {
    return null;
  }

  const sections: Record<string, string> = {};
  for (const heading of conditionalHeadings) {
    const sectionBody = (rawSections[heading] || "").trim();
    if (!sectionBody || !hasMeaningfulText(sectionBody)) {
      return null;
    }
    sections[heading] = sectionBody;
  }

  return {
    startedAt,
    conversationTypes,
    stateOverview,
    sections,
  };
}

function buildRuntimeMetrics(
  item: ConversationExportDatasetItem,
  normalizedOutputChars: number,
  mode: ExportCompressionMode
): Omit<
  ExportCompressionRuntimeMetrics,
  "rawOutputChars" | "serializedOutputChars"
> {
  const transcriptChars = getTranscriptChars(item.messages);
  const absoluteMinChars = getAbsoluteMinChars(mode);
  const softMinChars = getSoftMinChars(
    item.messages,
    mode,
    absoluteMinChars
  );

  return {
    transcriptChars,
    normalizedOutputChars,
    absoluteMinChars,
    softMinChars,
  };
}

function buildContinuationMetrics(
  result: InferenceCallResult,
  normalizedOutput: string
): ExportCompressionContinuationMetrics {
  return {
    rawOutputChars: result.content.length,
    normalizedOutputChars: normalizedOutput.length,
    finishReason: result.finishReason ?? null,
    promptTokens: result.usage?.promptTokens ?? null,
    completionTokens: result.usage?.completionTokens ?? null,
    totalTokens: result.usage?.totalTokens ?? null,
    requestedMaxTokens: result.proxyTokenMetrics?.requestedMaxTokens ?? null,
    effectiveMaxTokens: result.proxyTokenMetrics?.effectiveMaxTokens ?? null,
    proxyMaxTokensLimit: result.proxyTokenMetrics?.proxyMaxTokensLimit ?? null,
  };
}

function buildAttemptMetrics(input: {
  promptChars: number;
  truncatedPromptChars: number;
  result: InferenceCallResult;
  normalizedOutput: string;
  invalidReason?: ExportCompressionInvalidReasonCode;
  incompleteOutputRisk?: boolean;
  continuation?: ExportCompressionContinuationMetrics;
}): ExportCompressionAttemptMetrics {
  return {
    promptChars: input.promptChars,
    truncatedPromptChars: input.truncatedPromptChars,
    rawOutputChars: input.result.content.length,
    normalizedOutputChars: input.normalizedOutput.length,
    finishReason: input.result.finishReason ?? null,
    promptTokens: input.result.usage?.promptTokens ?? null,
    completionTokens: input.result.usage?.completionTokens ?? null,
    totalTokens: input.result.usage?.totalTokens ?? null,
    requestedMaxTokens: input.result.proxyTokenMetrics?.requestedMaxTokens ?? null,
    effectiveMaxTokens: input.result.proxyTokenMetrics?.effectiveMaxTokens ?? null,
    proxyMaxTokensLimit: input.result.proxyTokenMetrics?.proxyMaxTokensLimit ?? null,
    incompleteOutputRisk: input.incompleteOutputRisk ?? false,
    invalidReason: input.invalidReason,
    continuation: input.continuation,
  };
}

function buildDeliveredArtifactMetrics(
  validationMetrics: Omit<
    ExportCompressionRuntimeMetrics,
    "rawOutputChars" | "serializedOutputChars"
  >,
  body: string
): ExportCompressionDeliveredArtifactMetrics {
  return {
    ...validationMetrics,
    rawOutputChars: body.length,
    serializedOutputChars: body.length,
  };
}

function buildSoftCompressionWarning(
  metrics: Omit<
    ExportCompressionRuntimeMetrics,
    "rawOutputChars" | "serializedOutputChars"
  >,
  label?: string
): string | undefined {
  if (
    metrics.softMinChars === null ||
    metrics.normalizedOutputChars >= metrics.softMinChars
  ) {
    return undefined;
  }

  return [
    label ? `${label}.` : null,
    label === "Potential over-compressed risk"
      ? "The handoff may not carry enough situational density for confident continuation."
      : null,
    label === "Potential over-compressed risk"
      ? "Review the downloaded handoff before sharing it externally."
      : "This handoff looks lighter than expected for a long thread. Review it before sharing it externally.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildIntegrityWarnings(value: string): string[] {
  const warnings: string[] = [];

  if (countCodeFenceMarkers(value) % 2 !== 0) {
    warnings.push("unclosed_code_block");
  }

  const danglingLines = findDanglingCueLines(value);
  if (danglingLines.length > 0) {
    warnings.push(`dangling_cue:${danglingLines.join(" | ")}`);
  }

  const incompleteTerminalLine = findIncompleteTerminalLine(value);
  if (incompleteTerminalLine) {
    warnings.push(`incomplete_terminal:${shorten(incompleteTerminalLine, 120)}`);
  }

  return warnings;
}

function countGroundedSections(sections: Record<string, string>): number {
  return Object.values(sections).filter((body) => {
    const lines = body
      .split(/\n+/)
      .map((line) => stripBulletPrefix(line))
      .filter(Boolean);
    return lines.some((line) => hasMeaningfulText(line));
  }).length;
}

function detectArtifactSignals(messages: Message[]): {
  hasCode: boolean;
  hasCommand: boolean;
  hasPath: boolean;
  hasApi: boolean;
} {
  const transcript = messages.map((message) => message.content_text).join("\n");
  const pathSignals = Array.from(transcript.matchAll(new RegExp(PATH_PATTERN.source, "g")))
    .map((match) => match[0])
    .filter((value) => isExplicitPathCandidate(value));
  return {
    hasCode: hasRegexMatch(transcript, CODE_BLOCK_PATTERN),
    hasCommand: hasRegexMatch(transcript, COMMAND_PATTERN),
    hasPath: pathSignals.length > 0,
    hasApi:
      hasRegexMatch(transcript, API_PATTERN) ||
      hasRegexMatch(transcript, BACKTICK_PATTERN),
  };
}

function preservesArtifactSignal(
  body: string,
  messages: Message[]
): boolean {
  const signals = detectArtifactSignals(messages);
  if (!signals.hasCode && !signals.hasCommand && !signals.hasPath && !signals.hasApi) {
    return true;
  }

  return (
    (signals.hasCode && /```|Code:\s*`/i.test(body)) ||
    (signals.hasCommand && hasRegexMatch(body, COMMAND_PATTERN)) ||
    (signals.hasPath &&
      Array.from(body.matchAll(new RegExp(PATH_PATTERN.source, "g"))).some((match) =>
        isExplicitPathCandidate(match[0])
      )) ||
    (signals.hasApi &&
      (hasRegexMatch(body, API_PATTERN) || hasRegexMatch(body, BACKTICK_PATTERN)))
  );
}

function validateCompressionOutput(
  value: string,
  item: ConversationExportDatasetItem,
  mode: ExportCompressionMode,
  options?: ExportCompressionOptions
): ExportCompressionValidationResult {
  const normalized = sanitizeSummaryText(value);
  const runtimeMetrics = buildRuntimeMetrics(item, normalized.length, mode);
  const integrityWarnings = isExperimentalCompact(mode, options)
    ? buildIntegrityWarnings(normalized)
    : [];

  if (normalized.length < runtimeMetrics.absoluteMinChars) {
    return {
      valid: false,
      issueCode: "export_output_too_short",
      runtimeMetrics,
      integrityWarnings,
      softCompressionWarning: undefined,
    };
  }

  if (isExperimentalCompact(mode, options)) {
    const parsed = extractConditionalHandoff(value);
    if (!parsed || integrityWarnings.length > 0) {
      return {
        valid: false,
        issueCode: "export_missing_required_headings",
        runtimeMetrics,
        integrityWarnings,
        softCompressionWarning: buildSoftCompressionWarning(
          runtimeMetrics
        ),
      };
    }

    const groundedSectionCount = countGroundedSections(parsed.sections);
    if (groundedSectionCount < 1) {
      return {
        valid: false,
        issueCode: "export_grounded_sections_insufficient",
        runtimeMetrics,
        integrityWarnings,
        softCompressionWarning: buildSoftCompressionWarning(
          runtimeMetrics
        ),
      };
    }

    const sectionCount = Object.keys(parsed.sections).length;
    const hasDecisionSection = Boolean(
      parsed.sections["## Decisions And Reasoning"]
    );
    const hasRejectedSection = Boolean(
      parsed.sections["## Failed Or Rejected Paths"]
    );
    const hasUserContextSection = Boolean(
      parsed.sections["## User Context And Corrections"]
    );
    const hasUnderstandingSection = Boolean(
      parsed.sections["## Key Understanding"]
    );
    const hasRiskSection = Boolean(
      parsed.sections["## Open Risks And Next Actions"]
    );

    const overCompressedRisk =
      runtimeMetrics.softMinChars !== null &&
      runtimeMetrics.normalizedOutputChars < runtimeMetrics.softMinChars &&
      (
        sectionCount <= 2 ||
        (parsed.conversationTypes.includes("debugging") &&
          (!hasRejectedSection || !hasRiskSection)) ||
        ((parsed.conversationTypes.includes("decision") ||
          parsed.conversationTypes.includes("architecture_tradeoff")) &&
          !hasDecisionSection) ||
        (parsed.conversationTypes.includes("process_agreement") &&
          !hasUserContextSection) ||
        (parsed.conversationTypes.includes("explanation_teaching") &&
          !hasUnderstandingSection)
      );

    const softCompressionWarning = buildSoftCompressionWarning(
      runtimeMetrics,
      overCompressedRisk ? "Potential over-compressed risk" : undefined
    );

    return {
      valid: true,
      runtimeMetrics,
      integrityWarnings,
      softCompressionWarning,
    };
  }

  const sections = extractSections(value, mode);
  if (!sections) {
    return {
      valid: false,
      issueCode: "export_missing_required_headings",
      runtimeMetrics,
      integrityWarnings,
      softCompressionWarning: buildSoftCompressionWarning(runtimeMetrics),
    };
  }

  const groundedSectionCount = countGroundedSections(sections);
  const minimumGroundedSections = mode === "compact" ? 3 : 4;
  if (groundedSectionCount < minimumGroundedSections) {
    return {
      valid: false,
      issueCode: "export_grounded_sections_insufficient",
      runtimeMetrics,
      integrityWarnings,
      softCompressionWarning: buildSoftCompressionWarning(runtimeMetrics),
    };
  }

  if (!preservesArtifactSignal(value, item.messages)) {
    return {
      valid: false,
      issueCode: "export_artifact_signal_missing",
      runtimeMetrics,
      integrityWarnings,
      softCompressionWarning: buildSoftCompressionWarning(runtimeMetrics),
    };
  }

  return {
    valid: true,
    runtimeMetrics,
    integrityWarnings,
    softCompressionWarning: buildSoftCompressionWarning(runtimeMetrics),
  };
}

async function continueExperimentalIfNeeded(input: {
  settings: LlmConfig;
  promptBudget: number;
  payload: ExportCompressionPromptPayload;
  systemPrompt: string;
  body: string;
  result: InferenceCallResult;
}): Promise<{
  body: string;
  incompleteOutputRisk: boolean;
  continuation?: ExportCompressionContinuationMetrics;
}> {
  const initialRisk = hasIncompleteOutputRisk(input.body, input.result);
  if (!initialRisk) {
    return {
      body: input.body,
      incompleteOutputRisk: false,
    };
  }

  logger.warn("llm", "Experimental handoff output looks incomplete; attempting bounded continuation", {
    finishReason: input.result.finishReason || null,
    rawOutputChars: input.result.content.length,
    normalizedOutputChars: input.body.length,
  });

  const continuationPromptRaw = buildExperimentalContinuationPrompt(
    input.payload,
    input.body
  );
  const continuationPrompt = truncateForContext(
    continuationPromptRaw,
    input.promptBudget
  );
  const continuationResult = await callInference(
    withExperimentalMaxTokens(
      input.settings,
      EXPERIMENTAL_COMPACT_MAX_TOKENS.fallback
    ),
    continuationPrompt,
    {
      systemPrompt: input.systemPrompt,
    }
  );
  const continuationBody = normalizeCompressionBody(continuationResult.content);
  const stitchedBody = continuationBody
    ? stitchContinuation(input.body, continuationBody)
    : input.body;

  return {
    body: stitchedBody,
    incompleteOutputRisk: hasIncompleteOutputRisk(stitchedBody, continuationResult),
    continuation: buildContinuationMetrics(
      continuationResult,
      continuationBody
    ),
  };
}

async function compressWithCurrentLlmSettings(
  item: ConversationExportDatasetItem,
  mode: ExportCompressionMode,
  options?: ExportCompressionOptions
): Promise<CompressedConversationExport> {
  const settings = await getLlmSettings();
  if (!settings) {
    throw new Error("LLM_SETTINGS_UNAVAILABLE");
  }

  const modelId = getEffectiveModelId(settings);
  const modelProfile = getLlmModelProfile(modelId);
  const exportProfile = modelProfile.exportPromptProfile;
  const promptBudget = resolvePromptBudget(exportProfile, mode, options);
  const compactVariant = resolveCompactVariant(mode, options);
  const prompt = getPrompt(mode === "compact" ? "exportCompact" : "exportSummary", {
    variant: isExperimentalCompact(mode, options) ? "experimental" : "current",
  });
  const payload = buildPromptPayload(item, exportProfile, mode, options);
  const primaryPromptRaw = prompt.userTemplate(payload);
  const primaryPrompt = truncateForContext(primaryPromptRaw, promptBudget.primary);

  const primarySettings = isExperimentalCompact(mode, options)
    ? withExperimentalMaxTokens(settings, EXPERIMENTAL_COMPACT_MAX_TOKENS.primary)
    : settings;
  const primary = await callInference(primarySettings, primaryPrompt, {
    systemPrompt: prompt.system,
  });
  let primaryBody = normalizeCompressionBody(primary.content);
  let primaryContinuation:
    | ExportCompressionContinuationMetrics
    | undefined;
  let primaryIncompleteRisk = false;
  if (isExperimentalCompact(mode, options)) {
    const continued = await continueExperimentalIfNeeded({
      settings,
      promptBudget: promptBudget.fallback,
      payload,
      systemPrompt: prompt.system,
      body: primaryBody,
      result: primary,
    });
    primaryBody = continued.body;
    primaryContinuation = continued.continuation;
    primaryIncompleteRisk = continued.incompleteOutputRisk;
  }
  const primaryValidation = validateCompressionOutput(primaryBody, item, mode, options);
  const primaryAttemptMetrics = buildAttemptMetrics({
    promptChars: primaryPromptRaw.length,
    truncatedPromptChars: primaryPrompt.length,
    result: primary,
    normalizedOutput: primaryBody,
    invalidReason: primaryValidation.valid ? undefined : primaryValidation.issueCode,
    incompleteOutputRisk: primaryIncompleteRisk,
    continuation: primaryContinuation,
  });
  if (primaryValidation.valid) {
    return {
      conversation: item.conversation,
      messages: item.messages,
      body: primaryBody,
      mode,
      compactVariant,
      source: "llm",
      route: "current_llm_settings",
      usedFallbackPrompt: false,
      llmAttemptMetrics: {
        primary: primaryAttemptMetrics,
      },
      deliveredArtifactMetrics: buildDeliveredArtifactMetrics(
        primaryValidation.runtimeMetrics,
        primaryBody
      ),
      integrityWarnings: primaryValidation.integrityWarnings,
      softCompressionWarning: primaryValidation.softCompressionWarning,
      reviewReady: true,
    };
  }

  logger.warn("llm", "Export compression primary output failed validation", {
    route: "current_llm_settings",
    mode,
    compactVariant,
    conversationId: item.conversation.id,
    modelId,
    exportPromptProfile: exportProfile,
    invalidReason: primaryValidation.issueCode,
    llmAttemptMetrics: {
      primary: primaryAttemptMetrics,
    },
    integrityWarnings: primaryValidation.integrityWarnings,
    softCompressionWarning: primaryValidation.softCompressionWarning,
  });

  const fallbackPromptRaw = prompt.fallbackTemplate(payload);
  const fallbackPrompt = truncateForContext(
    fallbackPromptRaw,
    promptBudget.fallback
  );
  const fallbackSettings = isExperimentalCompact(mode, options)
    ? withExperimentalMaxTokens(settings, EXPERIMENTAL_COMPACT_MAX_TOKENS.fallback)
    : settings;
  const fallback = await callInference(fallbackSettings, fallbackPrompt, {
    systemPrompt: prompt.fallbackSystem || prompt.system,
  });
  let fallbackBody = normalizeCompressionBody(fallback.content);
  let fallbackContinuation:
    | ExportCompressionContinuationMetrics
    | undefined;
  let fallbackIncompleteRisk = false;
  if (isExperimentalCompact(mode, options)) {
    const continued = await continueExperimentalIfNeeded({
      settings,
      promptBudget: promptBudget.fallback,
      payload,
      systemPrompt: prompt.fallbackSystem || prompt.system,
      body: fallbackBody,
      result: fallback,
    });
    fallbackBody = continued.body;
    fallbackContinuation = continued.continuation;
    fallbackIncompleteRisk = continued.incompleteOutputRisk;
  }
  const fallbackValidation = validateCompressionOutput(fallbackBody, item, mode, options);
  const fallbackAttemptMetrics = buildAttemptMetrics({
    promptChars: fallbackPromptRaw.length,
    truncatedPromptChars: fallbackPrompt.length,
    result: fallback,
    normalizedOutput: fallbackBody,
    invalidReason: fallbackValidation.valid ? undefined : fallbackValidation.issueCode,
    incompleteOutputRisk: fallbackIncompleteRisk,
    continuation: fallbackContinuation,
  });
  if (fallbackValidation.valid) {
    return {
      conversation: item.conversation,
      messages: item.messages,
      body: fallbackBody,
      mode,
      compactVariant,
      source: "llm",
      route: "current_llm_settings",
      usedFallbackPrompt: true,
      llmAttemptMetrics: {
        primary: primaryAttemptMetrics,
        fallbackPrompt: fallbackAttemptMetrics,
      },
      deliveredArtifactMetrics: buildDeliveredArtifactMetrics(
        fallbackValidation.runtimeMetrics,
        fallbackBody
      ),
      integrityWarnings: fallbackValidation.integrityWarnings,
      softCompressionWarning: fallbackValidation.softCompressionWarning,
      reviewReady: true,
    };
  }

  logger.warn("llm", "Export compression fallback prompt failed validation", {
    route: "current_llm_settings",
    mode,
    compactVariant,
    conversationId: item.conversation.id,
    modelId,
    exportPromptProfile: exportProfile,
    invalidReason: fallbackValidation.issueCode,
    primaryInvalidReason: primaryValidation.issueCode,
    llmAttemptMetrics: {
      primary: primaryAttemptMetrics,
      fallbackPrompt: fallbackAttemptMetrics,
    },
    integrityWarnings: fallbackValidation.integrityWarnings,
    softCompressionWarning: fallbackValidation.softCompressionWarning,
  });

  throw new ExportCompressionValidationError(
    fallbackValidation.issueCode ||
      primaryValidation.issueCode ||
      "export_output_too_short",
    {
      route: "current_llm_settings",
      compactVariant,
      modelId,
      exportPromptProfile: exportProfile,
      primaryInvalidReason: primaryValidation.issueCode,
      fallbackInvalidReason: fallbackValidation.issueCode,
      llmAttemptMetrics: {
        primary: primaryAttemptMetrics,
        fallbackPrompt: fallbackAttemptMetrics,
      },
    }
  );
}

const ADAPTERS: Record<ExportCompressionRoute, ExportCompressionAdapter> = {
  current_llm_settings: {
    route: "current_llm_settings",
    compress: compressWithCurrentLlmSettings,
  },
  moonshot_direct: {
    route: "moonshot_direct",
    async compress(item, mode, options) {
      return buildLocalFallback(
        item,
        mode,
        options,
        "moonshot_direct_not_enabled"
      );
    },
  },
};

function buildCompressionNotice(
  results: CompressedConversationExport[],
  mode: ExportCompressionMode,
  options?: ExportCompressionOptions
): ConversationExportNotice {
  const compactVariant = resolveCompactVariant(mode, options);
  const exportLabel = getExportLabel(mode, compactVariant);
  const fallbackCount = results.filter(
    (result) => result.source === "local_fallback"
  ).length;
  const llmCount = results.length - fallbackCount;
  const warningResult = results.find(
    (result) =>
      (result.integrityWarnings?.length ?? 0) > 0 ||
      Boolean(result.softCompressionWarning)
  );

  if (fallbackCount === 0 && !warningResult) {
    return {
      tone: "default",
      message: `${exportLabel} export used the current LLM path for all selected threads.`,
    };
  }

  if (fallbackCount === 0 && warningResult) {
    return {
      tone: "warning",
      message: `${exportLabel} export completed with quality warnings for ${results.length} selected thread${results.length === 1 ? "" : "s"}.`,
      title: "Export completed with quality warnings",
      detail:
        warningResult.softCompressionWarning ||
        "The export passed validation, but diagnostics found potential completeness issues.",
      technicalSummary: buildCompressionTechnicalSummary(warningResult),
      hint: "Review the downloaded handoff before sharing it externally.",
      diagnostic: null,
    };
  }

  const representativeFallback = results.find(
    (result) => result.source === "local_fallback" && result.diagnostic
  );
  const diagnostic = representativeFallback?.diagnostic;
  const validationFallback = results.find(
    (result) => result.source === "local_fallback" && result.fallbackReason
  );
  const validationFeedback = diagnostic
    ? null
    : getExportValidationFeedback(
        validationFallback?.fallbackReason,
        mode,
        validationFallback?.compactVariant ?? compactVariant
      );
  const technicalSummary = diagnostic
    ? representativeFallback
      ? buildCompressionTechnicalSummary(representativeFallback)
      : diagnostic.technicalSummary
    : validationFallback
      ? buildCompressionTechnicalSummary(validationFallback)
      : undefined;
  const detail = diagnostic
    ? diagnostic.userMessage
    : validationFeedback?.detail;
  const hint = diagnostic
    ? "Check Settings > Model Access."
    : validationFeedback?.hint;
  const expertHint =
    mode === "compact" && compactVariant === "experimental"
      ? "Deterministic handoff fallback is diagnostic only; use an LLM-generated handoff before sending samples to the expert."
      : undefined;
  const combinedHint = [hint, expertHint].filter(Boolean).join(" ") || undefined;

  if (llmCount === 0) {
    return {
      tone: "warning",
      message: `${exportLabel} export used structured local fallback for all selected threads.`,
      title: "Local fallback used for all selected threads",
      detail,
      technicalSummary,
      hint: combinedHint,
      diagnostic: diagnostic || null,
    };
  }

  return {
    tone: "warning",
    message: `${exportLabel} export used structured local fallback for ${fallbackCount} of ${results.length} selected threads.`,
    title: `Local fallback used for ${fallbackCount} of ${results.length} selected threads`,
    detail,
    technicalSummary,
    hint: combinedHint,
    diagnostic: diagnostic || null,
  };
}

export function isExportCompressionRouteEnabled(
  route: ExportCompressionRoute
): boolean {
  return ROUTE_STATUS[route].enabled;
}

export function resolveExportCompressionRoute(): ExportCompressionRoute {
  return ACTIVE_EXPORT_COMPRESSION_ROUTE;
}

export function getExportCompressionRouteInfo() {
  return {
    active: ACTIVE_EXPORT_COMPRESSION_ROUTE,
    status: ROUTE_STATUS,
    futureCandidates: {
      modelscope: [...FUTURE_MODELSCOPE_EXPORT_MODEL_CANDIDATES],
      moonshotDirect: [...FUTURE_MOONSHOT_DIRECT_EXPORT_MODEL_CANDIDATES],
    },
  };
}

export async function compressExportDataset(
  dataset: ConversationExportDatasetItem[],
  mode: ExportCompressionMode,
  options?: ExportCompressionOptions
): Promise<{
  items: CompressedConversationExport[];
  notice: ConversationExportNotice;
}> {
  // Use Summary V2 for summary mode
  if (mode === "summary") {
    const summaryResult = await compressSummaryDataset(
      dataset as SummaryExportDatasetItem[]
    );
    // Map Summary results to CompressedConversationExport format
    const items: CompressedConversationExport[] = summaryResult.items.map(
      (summaryItem): CompressedConversationExport => ({
        conversation: summaryItem.conversation,
        messages: summaryItem.messages,
        body: summaryItem.body,
        mode: "summary",
        source: summaryItem.source,
        usedFallbackPrompt: summaryItem.usedFallbackPrompt,
        fallbackReason: summaryItem.fallbackReason,
        diagnostic: summaryItem.diagnostic,
        modelId: summaryItem.modelId,
        exportPromptProfile: summaryItem.exportPromptProfile,
        primaryInvalidReason: summaryItem.primaryInvalidReason as ExportCompressionInvalidReasonCode | undefined,
        fallbackInvalidReason: summaryItem.fallbackInvalidReason as ExportCompressionInvalidReasonCode | undefined,
        llmAttemptMetrics: summaryItem.llmAttemptMetrics as ExportCompressionLlmAttemptMetrics | undefined,
        deliveredArtifactMetrics: summaryItem.deliveredMetrics as ExportCompressionDeliveredArtifactMetrics | undefined,
        integrityWarnings: summaryItem.integrityWarnings,
        softCompressionWarning: summaryItem.qualityWarning,
      })
    );
    return {
      items,
      notice: summaryResult.notice,
    };
  }

  // Original compact mode logic (unchanged)
  const route = resolveExportCompressionRoute();
  const adapter = ADAPTERS[route];
  const items: CompressedConversationExport[] = [];

  for (const rawItem of dataset) {
    const item: ConversationExportDatasetItem = {
      conversation: rawItem.conversation,
      messages: toOrderedMessages(rawItem.messages),
    };

    if (!isExportCompressionRouteEnabled(route)) {
      items.push(buildLocalFallback(item, mode, options, `${route}_disabled`));
      continue;
    }

    try {
      items.push(await adapter.compress(item, mode, options));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "compression_failed";
      const diagnostic = getLlmDiagnostic(error);
      const failureContext =
        error instanceof ExportCompressionValidationError
          ? error.context
          : null;
      logger.warn("llm", "Export compression fell back to local formatter", {
        route,
        mode,
        conversationId: item.conversation.id,
        reason,
        diagnosticCode: diagnostic?.code,
        diagnosticRequestId: diagnostic?.requestId,
        modelId: failureContext?.modelId,
        exportPromptProfile: failureContext?.exportPromptProfile,
        primaryInvalidReason: failureContext?.primaryInvalidReason,
        fallbackInvalidReason: failureContext?.fallbackInvalidReason,
        llmAttemptMetrics: failureContext?.llmAttemptMetrics,
      });
      items.push(
        buildLocalFallback(item, mode, options, reason, diagnostic, failureContext)
      );
    }
  }

  return {
    items,
    notice: buildCompressionNotice(items, mode, options),
  };
}
