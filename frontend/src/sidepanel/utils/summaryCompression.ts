/**
 * Summary Compression Runtime
 * Parallel to exportCompression.ts but optimized for Summary (Knowledge Export) mode
 * 
 * Architecture: Mirrors compact compression with Summary-specific adaptations
 * - Content classification
 * - Smart transcript packing  
 * - LLM-based composition
 * - Multi-dimensional validation
 * - Structured fallback
 */

import { getPrompt } from "~lib/prompts";
import type { LlmDiagnostic } from "~lib/services/llmService";
import {
  callInference,
  sanitizeSummaryText,
  truncateForContext,
} from "~lib/services/llmService";
import { getLlmSettings } from "~lib/services/llmSettingsService";
import {
  getEffectiveModelId,
} from "~lib/services/llmConfig";
import type {
  ExportPromptProfile,
} from "~lib/services/llmModelProfile";
import { getConversationOriginAt } from "~lib/conversations/timestamps";
import type { Conversation, LlmConfig, Message } from "~lib/types";
import { logger } from "~lib/utils/logger";
import type { ConversationExportNotice } from "../types/export";
import SUMMARY_COMPOSER, {
  type SummaryClassification,
  type SummaryValidationResult,
  type SummaryInvalidReasonCode,
  type SummaryMetrics,
} from "~lib/prompts/export/summaryComposer";

// =============================================================================
// Types (mirroring exportCompression pattern)
// =============================================================================

export interface SummaryExportDatasetItem {
  conversation: Conversation;
  messages: Message[];
}

export interface CompressedSummaryExport {
  conversation: Conversation;
  messages: Message[];
  body: string;
  source: "llm" | "local_fallback";
  usedFallbackPrompt: boolean;
  fallbackReason?: string;
  diagnostic?: LlmDiagnostic;
  modelId?: string;
  exportPromptProfile?: ExportPromptProfile;
  primaryInvalidReason?: SummaryInvalidReasonCode;
  fallbackInvalidReason?: SummaryInvalidReasonCode;
  llmAttemptMetrics?: SummaryLlmAttemptMetrics;
  deliveredMetrics?: SummaryDeliveredMetrics;
  integrityWarnings?: string[];
  qualityWarning?: string;
  classification?: SummaryClassification;
}

interface SummaryLlmAttemptMetrics {
  primary?: SummaryAttemptMetrics;
  fallbackPrompt?: SummaryAttemptMetrics;
}

interface SummaryAttemptMetrics {
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
  invalidReason?: SummaryInvalidReasonCode;
}

type SummaryDeliveredMetrics = SummaryMetrics;

interface SummaryFailureContext {
  modelId?: string;
  exportPromptProfile?: ExportPromptProfile;
  primaryInvalidReason?: SummaryInvalidReasonCode;
  fallbackInvalidReason?: SummaryInvalidReasonCode;
  llmAttemptMetrics?: SummaryLlmAttemptMetrics;
  classification?: SummaryClassification;
}

class SummaryValidationError extends Error {
  readonly context: SummaryFailureContext;

  constructor(reason: string, context: SummaryFailureContext) {
    super(reason);
    this.name = "SummaryValidationError";
    this.context = context;
  }
}

// =============================================================================
// Configuration
// =============================================================================

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

const MAX_TOKENS = {
  primary: 4000,
  fallback: 3200,
} as const;

// =============================================================================
// Utility Functions
// =============================================================================

function toOrderedMessages(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.created_at - b.created_at);
}

function detectLocale(): "zh" | "en" {
  if (typeof navigator === "undefined") {
    return "zh";
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function buildPromptPayload(
  item: SummaryExportDatasetItem
): Parameters<typeof SUMMARY_COMPOSER.buildPrompt>[0] {
  const classification = SUMMARY_COMPOSER.classifyContent(item.messages);
  const knowledge = SUMMARY_COMPOSER.extractKnowledge(item.messages);

  return {
    conversation: item.conversation,
    messages: item.messages,
    classification,
    knowledge,
    locale: detectLocale(),
  };
}

function withMaxTokens(settings: LlmConfig, maxTokens: number): LlmConfig {
  return {
    ...settings,
    maxTokens,
  };
}

// =============================================================================
// LLM-based Compression (mirroring compressWithCurrentLlmSettings)
// =============================================================================

async function compressSummaryWithLlm(
  item: SummaryExportDatasetItem
): Promise<CompressedSummaryExport> {
  const settings = await getLlmSettings();
  if (!settings) {
    throw new Error("LLM_SETTINGS_UNAVAILABLE");
  }

  const modelId = getEffectiveModelId(settings);
  const exportPromptProfile = "kimi_handoff_rich"; // Default for summary
  const promptBudget = PROMPT_BUDGETS[exportPromptProfile];

  const payload = buildPromptPayload(item);
  const classification = payload.classification;

  // Primary attempt
  const primaryPromptRaw = SUMMARY_COMPOSER.buildPrompt(payload);
  const primaryPrompt = truncateForContext(
    primaryPromptRaw,
    promptBudget.primary
  );

  const primarySettings = withMaxTokens(settings, MAX_TOKENS.primary);
  const primary = await callInference(primarySettings, primaryPrompt, {
    systemPrompt: SUMMARY_COMPOSER.system,
  });

  const primaryBody = sanitizeSummaryText(primary.content)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const primaryValidation = SUMMARY_COMPOSER.validateOutput(
    primaryBody,
    item.messages.reduce((sum, m) => sum + m.content_text.length, 0)
  );

  const primaryAttemptMetrics: SummaryAttemptMetrics = {
    promptChars: primaryPromptRaw.length,
    truncatedPromptChars: primaryPrompt.length,
    rawOutputChars: primary.content.length,
    normalizedOutputChars: primaryBody.length,
    finishReason: primary.finishReason ?? null,
    promptTokens: primary.usage?.promptTokens ?? null,
    completionTokens: primary.usage?.completionTokens ?? null,
    totalTokens: primary.usage?.totalTokens ?? null,
    requestedMaxTokens: primary.proxyTokenMetrics?.requestedMaxTokens ?? null,
    effectiveMaxTokens: primary.proxyTokenMetrics?.effectiveMaxTokens ?? null,
    proxyMaxTokensLimit: primary.proxyTokenMetrics?.proxyMaxTokensLimit ?? null,
    invalidReason: primaryValidation.valid
      ? undefined
      : primaryValidation.issueCode,
  };

  if (primaryValidation.valid) {
    return {
      conversation: item.conversation,
      messages: item.messages,
      body: primaryBody,
      source: "llm",
      usedFallbackPrompt: false,
      llmAttemptMetrics: { primary: primaryAttemptMetrics },
      deliveredMetrics: primaryValidation.metrics,
      integrityWarnings: primaryValidation.integrityWarnings,
      qualityWarning: primaryValidation.qualityAssessment.warning,
      classification,
    };
  }

  logger.warn("llm", "Summary primary output failed validation", {
    conversationId: item.conversation.id,
    modelId,
    exportPromptProfile,
    invalidReason: primaryValidation.issueCode,
    llmAttemptMetrics: { primary: primaryAttemptMetrics },
    preview: primaryBody.slice(0, 500),
  });

  // Fallback prompt attempt
  const fallbackPromptRaw = SUMMARY_COMPOSER.buildFallbackPrompt(payload);
  const fallbackPrompt = truncateForContext(
    fallbackPromptRaw,
    promptBudget.fallback
  );

  const fallbackSettings = withMaxTokens(settings, MAX_TOKENS.fallback);
  const fallback = await callInference(fallbackSettings, fallbackPrompt, {
    systemPrompt: SUMMARY_COMPOSER.fallbackSystem,
  });

  const fallbackBody = sanitizeSummaryText(fallback.content)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const fallbackValidation = SUMMARY_COMPOSER.validateOutput(
    fallbackBody,
    item.messages.reduce((sum, m) => sum + m.content_text.length, 0)
  );

  const fallbackAttemptMetrics: SummaryAttemptMetrics = {
    promptChars: fallbackPromptRaw.length,
    truncatedPromptChars: fallbackPrompt.length,
    rawOutputChars: fallback.content.length,
    normalizedOutputChars: fallbackBody.length,
    finishReason: fallback.finishReason ?? null,
    promptTokens: fallback.usage?.promptTokens ?? null,
    completionTokens: fallback.usage?.completionTokens ?? null,
    totalTokens: fallback.usage?.totalTokens ?? null,
    requestedMaxTokens: fallback.proxyTokenMetrics?.requestedMaxTokens ?? null,
    effectiveMaxTokens: fallback.proxyTokenMetrics?.effectiveMaxTokens ?? null,
    proxyMaxTokensLimit: fallback.proxyTokenMetrics?.proxyMaxTokensLimit ?? null,
    invalidReason: fallbackValidation.valid
      ? undefined
      : fallbackValidation.issueCode,
  };

  if (fallbackValidation.valid) {
    return {
      conversation: item.conversation,
      messages: item.messages,
      body: fallbackBody,
      source: "llm",
      usedFallbackPrompt: true,
      llmAttemptMetrics: {
        primary: primaryAttemptMetrics,
        fallbackPrompt: fallbackAttemptMetrics,
      },
      deliveredMetrics: fallbackValidation.metrics,
      integrityWarnings: fallbackValidation.integrityWarnings,
      qualityWarning: fallbackValidation.qualityAssessment.warning,
      classification,
    };
  }

  logger.warn("llm", "Summary fallback output failed validation", {
    conversationId: item.conversation.id,
    modelId,
    exportPromptProfile,
    primaryInvalidReason: primaryValidation.issueCode,
    fallbackInvalidReason: fallbackValidation.issueCode,
    llmAttemptMetrics: {
      primary: primaryAttemptMetrics,
      fallbackPrompt: fallbackAttemptMetrics,
    },
  });

  throw new SummaryValidationError(
    fallbackValidation.issueCode ||
      primaryValidation.issueCode ||
      "summary_output_too_short",
    {
      modelId,
      exportPromptProfile,
      primaryInvalidReason: primaryValidation.issueCode,
      fallbackInvalidReason: fallbackValidation.issueCode,
      llmAttemptMetrics: {
        primary: primaryAttemptMetrics,
        fallbackPrompt: fallbackAttemptMetrics,
      },
      classification,
    }
  );
}

// =============================================================================
// Local Fallback (mirroring buildLocalFallback)
// =============================================================================

function buildSummaryLocalFallback(
  item: SummaryExportDatasetItem,
  reason: string,
  diagnostic?: LlmDiagnostic | null,
  failureContext?: SummaryFailureContext | null
): CompressedSummaryExport {
  const locale = detectLocale();
  const classification =
    failureContext?.classification ||
    SUMMARY_COMPOSER.classifyContent(item.messages);

  const body = SUMMARY_COMPOSER.buildLocalFallback(
    item.conversation,
    item.messages,
    reason,
    locale
  );

  const transcriptChars = item.messages.reduce(
    (sum, m) => sum + m.content_text.length,
    0
  );

  // Build basic metrics for fallback
  const normalizedOutputChars = body.length;
  const absoluteMinChars = 200;
  const softMinChars = Math.max(
    absoluteMinChars,
    Math.floor(transcriptChars * 0.05)
  );

  const metrics: SummaryMetrics = {
    transcriptChars,
    rawOutputChars: body.length,
    normalizedOutputChars,
    absoluteMinChars,
    softMinChars,
  };

  return {
    conversation: item.conversation,
    messages: item.messages,
    body,
    source: "local_fallback",
    usedFallbackPrompt: false,
    fallbackReason: diagnostic?.code || reason,
    diagnostic: diagnostic || undefined,
    modelId: failureContext?.modelId,
    exportPromptProfile: failureContext?.exportPromptProfile,
    primaryInvalidReason: failureContext?.primaryInvalidReason,
    fallbackInvalidReason: failureContext?.fallbackInvalidReason,
    llmAttemptMetrics: failureContext?.llmAttemptMetrics,
    deliveredMetrics: metrics,
    classification,
  };
}

// =============================================================================
// Notice Building (mirroring buildCompressionNotice)
// =============================================================================

function buildSummaryNotice(
  results: CompressedSummaryExport[]
): ConversationExportNotice {
  const fallbackCount = results.filter(
    (r) => r.source === "local_fallback"
  ).length;
  const llmCount = results.length - fallbackCount;

  const warningResult = results.find(
    (r) =>
      (r.integrityWarnings?.length ?? 0) > 0 || Boolean(r.qualityWarning)
  );

  if (fallbackCount === 0 && !warningResult) {
    return {
      tone: "default",
      message: `Summary export used current LLM settings for all ${results.length} thread${results.length === 1 ? "" : "s"}.`,
    };
  }

  if (fallbackCount === 0 && warningResult) {
    return {
      tone: "warning",
      message: `Summary export completed with quality notes for ${results.length} thread${results.length === 1 ? "" : "s"}.`,
      title: "Export completed with quality notes",
      detail:
        warningResult.qualityWarning ||
        "Some sections may need manual review for completeness.",
      hint: "Review the downloaded summary before archiving.",
    };
  }

  const representative = results.find(
    (r) => r.source === "local_fallback" && r.fallbackReason
  );

  if (llmCount === 0) {
    return {
      tone: "warning",
      message: `Summary export used local fallback for all ${results.length} thread${results.length === 1 ? "" : "s"}.`,
      title: "Local fallback used for all threads",
      detail: representative?.fallbackReason
        ? `Reason: ${representative.fallbackReason}`
        : "LLM unavailable or validation failed.",
      hint: "Check Settings > Model Access, or the conversation may be too long.",
    };
  }

  return {
    tone: "warning",
    message: `Summary export used local fallback for ${fallbackCount} of ${results.length} thread${results.length === 1 ? "" : "s"}.`,
    title: `Local fallback used for ${fallbackCount} of ${results.length} threads`,
    detail: representative?.fallbackReason
      ? `Reason: ${representative.fallbackReason}`
      : undefined,
    hint: "Some summaries may be less detailed. Consider re-exporting with LLM access.",
  };
}

// =============================================================================
// Main Export Function (mirroring compressExportDataset)
// =============================================================================

export async function compressSummaryDataset(
  dataset: SummaryExportDatasetItem[]
): Promise<{
  items: CompressedSummaryExport[];
  notice: ConversationExportNotice;
}> {
  const items: CompressedSummaryExport[] = [];

  for (const rawItem of dataset) {
    const item: SummaryExportDatasetItem = {
      conversation: rawItem.conversation,
      messages: toOrderedMessages(rawItem.messages),
    };

    try {
      items.push(await compressSummaryWithLlm(item));
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "summary_compression_failed";
      const diagnostic =
        error instanceof Error && "code" in error
          ? (error as unknown as LlmDiagnostic)
          : null;
      const failureContext =
        error instanceof SummaryValidationError ? error.context : null;

      logger.warn("llm", "Summary compression fell back to local", {
        conversationId: item.conversation.id,
        reason,
        diagnosticCode: diagnostic?.code,
      });

      items.push(
        buildSummaryLocalFallback(item, reason, diagnostic, failureContext)
      );
    }
  }

  return {
    items,
    notice: buildSummaryNotice(items),
  };
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { SUMMARY_COMPOSER };
export type {
  SummaryClassification,
  SummaryValidationResult,
  SummaryInvalidReasonCode,
  SummaryMetrics,
} from "~lib/prompts/export/summaryComposer";

export default compressSummaryDataset;
