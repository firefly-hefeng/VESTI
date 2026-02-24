import type { Conversation, ConversationSummaryV2, Message } from "../types";

export type PromptType = "compaction" | "conversationSummary" | "weeklyDigest";
export type PromptVariant = "current" | "experimental";

export interface CompactionPromptPayload {
  conversationTitle?: string;
  conversationPlatform?: string;
  conversationCreatedAt?: number;
  messages: Message[];
  locale?: "zh" | "en";
}

export interface ConversationSummaryPromptPayload {
  conversationTitle?: string;
  conversationPlatform?: string;
  conversationCreatedAt?: number;
  messages: Message[];
  locale?: "zh" | "en";
}

export interface WeeklyDigestPromptPayload {
  conversations: Conversation[];
  rangeStart: number;
  rangeEnd: number;
  summaryEntries?: Array<{
    conversationId: number;
    summary: ConversationSummaryV2;
  }>;
  selectedSummaries?: Array<{
    conversationId: number;
    summary: string;
  }>;
  maxConversations?: number;
  locale?: "zh" | "en";
}

export interface PromptVersion<TPayload> {
  version: string;
  createdAt: string;
  description: string;
  system: string;
  fallbackSystem?: string;
  userTemplate: (payload: TPayload) => string;
  fallbackTemplate: (payload: TPayload) => string;
}

export interface PromptPayloadMap {
  compaction: CompactionPromptPayload;
  conversationSummary: ConversationSummaryPromptPayload;
  weeklyDigest: WeeklyDigestPromptPayload;
}

export type PromptConfig = {
  [K in keyof PromptPayloadMap]: PromptVersion<PromptPayloadMap[K]>;
};
