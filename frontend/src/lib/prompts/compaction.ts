import type { Message } from "../types";
import type { CompactionPromptPayload, PromptVersion } from "./types";

const COMPACTION_SYSTEM = `You are Agent A: a structured context compaction engine.

Return a compact markdown skeleton that preserves reasoning flow and speaker ownership.

Output shape (headings required):
## Core Logic Chain
- [User] Initial tension
- [AI/User] Key reasoning steps (ordered)
- Empirical anchor

## Concept Matrix
- term: working definition + concrete mapping in this conversation

## Unresolved Tensions
- open questions that remain unsolved

Rules:
1) Keep only evidence-grounded points from input messages.
2) Preserve [User] and [AI] boundaries.
3) Keep output concise (about 8%-15% of natural-language input volume).
4) If input is sparse, return a minimal but valid skeleton with available evidence.
5) No code fences.`;

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toCompactTranscript(messages: Message[]): string {
  if (!messages.length) {
    return "[No messages available]";
  }

  return messages
    .map((message, index) => {
      const role = message.role === "user" ? "User" : "AI";
      return `${index + 1}. [${formatTime(message.created_at)}] [${role}] ${message.content_text}`;
    })
    .join("\n");
}

function buildCompactionPrompt(payload: CompactionPromptPayload): string {
  const conversationTitle = payload.conversationTitle || "(untitled)";
  const conversationPlatform = payload.conversationPlatform || "unknown";
  const conversationCreatedAt = payload.conversationCreatedAt
    ? new Date(payload.conversationCreatedAt).toLocaleString("en-US")
    : "unknown";

  return `Build Agent-A compaction markdown skeleton for the following conversation.

Metadata:
- Title: ${conversationTitle}
- Platform: ${conversationPlatform}
- CreatedAt: ${conversationCreatedAt}
- Locale: ${payload.locale || "zh"}
- MessageCount: ${payload.messages.length}

Conversation:
${toCompactTranscript(payload.messages)}

Remember:
- Keep speaker tags [User]/[AI].
- Prefer concrete empirical anchors over abstract slogans.
- Keep unresolved tensions only when truly unresolved in this input.
- Output markdown only (no JSON).`;
}

function buildCompactionFallbackPrompt(payload: CompactionPromptPayload): string {
  return `Write a concise plain-text compaction for this conversation in 5-8 lines.
Focus on: core tension, key reasoning transitions, concrete anchor, and unresolved points.

Conversation:
${toCompactTranscript(payload.messages)}`;
}

export const CURRENT_COMPACTION_PROMPT: PromptVersion<CompactionPromptPayload> = {
  version: "v0.1.0-hackathon-mvp",
  createdAt: "2026-02-24",
  description: "Agent A compaction prompt for hackathon MVP (schema-preserving rollout).",
  system: COMPACTION_SYSTEM,
  fallbackSystem: "You are a concise technical compaction assistant. Output plain text only.",
  userTemplate: buildCompactionPrompt,
  fallbackTemplate: buildCompactionFallbackPrompt,
};

export const EXPERIMENTAL_COMPACTION_PROMPT: PromptVersion<CompactionPromptPayload> = {
  version: "v0.1.0-hackathon-mvp-exp",
  createdAt: "2026-02-24",
  description: "Experimental variant for Agent A compaction quality diagnostics.",
  system: COMPACTION_SYSTEM,
  fallbackSystem: "You are a concise technical compaction assistant. Output plain text only.",
  userTemplate: buildCompactionPrompt,
  fallbackTemplate: buildCompactionFallbackPrompt,
};
