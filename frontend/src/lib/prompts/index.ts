import {
  CURRENT_COMPACTION_PROMPT,
  EXPERIMENTAL_COMPACTION_PROMPT,
} from "./compaction";
import {
  CURRENT_CONVERSATION_SUMMARY_PROMPT,
  EXPERIMENTAL_CONVERSATION_SUMMARY_PROMPT,
} from "./conversationSummary";
import {
  CURRENT_WEEKLY_DIGEST_PROMPT,
  EXPERIMENTAL_WEEKLY_DIGEST_PROMPT,
} from "./weeklyDigest";
import type {
  PromptConfig,
  PromptType,
  PromptVariant,
} from "./types";

export type {
  CompactionPromptPayload,
  ConversationSummaryPromptPayload,
  PromptConfig,
  PromptPayloadMap,
  PromptType,
  PromptVariant,
  PromptVersion,
  WeeklyDigestPromptPayload,
} from "./types";

export const CURRENT_PROMPTS: PromptConfig = {
  compaction: CURRENT_COMPACTION_PROMPT,
  conversationSummary: CURRENT_CONVERSATION_SUMMARY_PROMPT,
  weeklyDigest: CURRENT_WEEKLY_DIGEST_PROMPT,
};

export const EXPERIMENTAL_PROMPTS: Partial<PromptConfig> = {
  compaction: EXPERIMENTAL_COMPACTION_PROMPT,
  conversationSummary: EXPERIMENTAL_CONVERSATION_SUMMARY_PROMPT,
  weeklyDigest: EXPERIMENTAL_WEEKLY_DIGEST_PROMPT,
};

export function getPrompt<T extends PromptType>(
  type: T,
  options?: { variant?: PromptVariant }
): PromptConfig[T] {
  const variant = options?.variant ?? "current";

  if (variant === "experimental") {
    const experimental = EXPERIMENTAL_PROMPTS[type];
    if (experimental) {
      return experimental as PromptConfig[T];
    }
  }

  return CURRENT_PROMPTS[type];
}
