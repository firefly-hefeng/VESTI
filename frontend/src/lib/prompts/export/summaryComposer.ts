/**
 * Summary Composer - Knowledge Export
 * Reference: Compact/Distill Architecture
 * Target: Knowledge Export for Human Recall
 * 
 * Architecture Pattern (mirroring compact):
 * 1. Content Type Classification (6 types)
 * 2. Smart Transcript Packing (Head + Evidence Windows + Tail)
 * 3. LLM-based Composition with type-aware prompts
 * 4. Multi-dimensional Validation
 * 5. Structured Local Fallback
 */

import type { PromptVersion } from "../types";
import type { Conversation, Message } from "~lib/types";
import { getConversationOriginAt } from "~lib/conversations/timestamps";

// =============================================================================
// Types
// =============================================================================

export type SummaryContentType =
  | "decision"
  | "debugging"
  | "architecture_tradeoff"
  | "explanation_teaching"
  | "process_agreement"
  | "generation";

export interface SummaryClassification {
  primary: SummaryContentType;
  secondary?: SummaryContentType;
  confidence: number;
}

export interface SummaryEvidenceWindow {
  label: 
    | "Core Insight Discovery"
    | "Key Decision Point"
    | "Problem-Solution Pivot"
    | "Knowledge Synthesis"
    | "Unresolved Exploration";
  startIndex: number;
  endIndex: number;
  turns: Message[];
  score: number;
}

export interface PackedTranscript {
  head: Message[];
  middleWindows: SummaryEvidenceWindow[];
  tail: Message[];
  omittedCount: number;
  totalCount: number;
}

export interface SummaryValidationResult {
  valid: boolean;
  issueCode?: SummaryInvalidReasonCode;
  metrics: SummaryMetrics;
  integrityWarnings: string[];
  qualityAssessment: QualityAssessment;
}

export type SummaryInvalidReasonCode =
  | "summary_output_too_short"
  | "summary_missing_required_headings"
  | "summary_grounded_sections_insufficient"
  | "summary_insights_too_generic"
  | "incomplete_output";

export interface SummaryMetrics {
  transcriptChars: number;
  rawOutputChars: number;
  normalizedOutputChars: number;
  absoluteMinChars: number;
  softMinChars: number | null;
}

export interface QualityAssessment {
  triggered: boolean;
  passed: boolean;
  hasTldr: boolean;
  hasProblemFrame: boolean;
  hasThinkingJourney: boolean;
  hasKeyInsights: boolean;
  insightQuality: "high" | "medium" | "low";
  warning?: string;
}

export interface ExtractedKnowledge {
  questions: string[];
  constraints: string[];
  decisions: string[];
  insights: string[];
  patterns: string[];
  unresolved: string[];
  codeBlocks: string[];
  filePaths: string[];
  commands: string[];
}

// =============================================================================
// Constants (mirroring compact pattern)
// =============================================================================

const SUMMARY_PROMPT_BUDGET = {
  primary: 16000,
  fallback: 12000,
} as const;

const SUMMARY_MAX_TOKENS = {
  primary: 4000,
  fallback: 3200,
} as const;

const MIN_VALID_OUTPUT_LENGTH = 200;
const SUMMARY_SOFT_MIN_RATIO = 0.05;

const SUMMARY_PACKING = {
  keepFirstMessages: 3,
  keepLastMessages: 8,
  maxMiddleWindows: 5,
} as const;

// Required headings for summary export (aligned with exportCompression.ts)
const SUMMARY_REQUIRED_HEADINGS = [
  "## TL;DR",
  "## Problem Frame",
  "## Important Moves",
  "## Reusable Snippets",
  "## Next Steps",
  "## Tags",
];

// Legacy headings preserved for backward compatibility (will be migrated)
const SUMMARY_LEGACY_HEADINGS = [
  "## Thinking Journey",
  "## Key Insights",
  "## Reusable Patterns",
  "## Follow-ups",
  "## Context",
];

// Content type scoring cues (adapted from compact)
const CONTENT_CUES = {
  question: /(?:[?？]$|^(?:how|why|what|which|should|can|could|would|is|are|do|does|did|where|when|whether|如何|为什么|为何|怎么|是否|能否|需不需要|应该|要不要))/i,
  constraint: /(?:\b(?:must|should|need to|avoid|without|only|do not|don't|keep|preserve|require|strict|cannot)\b|必须|不要|不能|保持|保留|避免|仅|只)/i,
  decision: /(?:\b(?:decide|decided|choose|adopt|implement|fix|prefer|recommend|conclude|确定|决定|选择|采用|结论)\b)/i,
  insight: /(?:\b(?:insight|realize|understand|discover|pattern|principle|关键在于|启发|发现|规律|原理|本质)\b)/i,
  unresolved: /(?:\b(?:todo|next|follow[- ]?up|pending|later|future|待|后续|下一步|尚未|未来)\b)/i,
  code: /```[\s\S]*?```/,
  path: /(?:[A-Za-z]:\\[^\s`"')]+|(?:\.?\.?(?:\/|\\))?(?:[\w.-]+(?:\/|\\))+[\w./\\-]*[\w-]+(?:\.[A-Za-z0-9]+)?)/g,
  command: /(?:^|\s)(?:pnpm|npm|git|node|python|pytest|rg|gh|curl|yarn)\b[^\n]*/gim,
} as const;

// =============================================================================
// Utility Functions (mirroring compact utilities)
// =============================================================================

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

function toOrderedMessages(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.created_at - b.created_at);
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

function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?])\s*|(?<=[.!?])\s+/))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line && !line.startsWith("```"));
}

function countCjkChars(value: string): number {
  return (value.match(/[\u3400-\u9FFF]/g) || []).length;
}

function countAsciiWords(value: string): number {
  return (value.match(/[A-Za-z0-9][A-Za-z0-9+/_\-.]*/g) || []).length;
}

function formatExportDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toExportTranscript(messages: Message[]): string {
  return messages
    .map((message, index) => {
      const role = message.role === "user" ? "User" : "AI";
      const time = new Date(message.created_at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${index + 1}. [${time}] [${role}] ${message.content_text}`;
    })
    .join("\n\n");
}

// =============================================================================
// Content Analysis (mirroring compact signal detection)
// =============================================================================

function extractKnowledge(messages: Message[]): ExtractedKnowledge {
  const ordered = toOrderedMessages(messages);
  
  // Extract questions
  const questions = ordered
    .filter((m) => m.role === "user")
    .flatMap((m) => splitIntoSentences(m.content_text))
    .filter((s) => CONTENT_CUES.question.test(s))
    .map((s) => shorten(s, 200));

  // Extract constraints
  const constraints = ordered
    .filter((m) => m.role === "user")
    .flatMap((m) => splitIntoSentences(m.content_text))
    .filter((s) => CONTENT_CUES.constraint.test(s))
    .map((s) => shorten(s, 180));

  // Extract decisions
  const decisions = ordered
    .filter((m) => m.role === "ai")
    .flatMap((m) => splitIntoSentences(m.content_text))
    .filter((s) => CONTENT_CUES.decision.test(s))
    .map((s) => shorten(s, 220));

  // Extract insights (AI responses containing key realizations)
  const insights = ordered
    .filter((m) => m.role === "ai")
    .flatMap((m) => splitIntoSentences(m.content_text))
    .filter((s) => CONTENT_CUES.insight.test(s) || /关键在于|本质|核心/.test(s))
    .map((s) => shorten(s, 240));

  // Extract unresolved items
  const unresolved = [...ordered]
    .reverse()
    .flatMap((m) => splitIntoSentences(m.content_text))
    .filter((s) => CONTENT_CUES.unresolved.test(s))
    .map((s) => shorten(s, 200));

  // Extract code blocks
  const codeBlocks: string[] = [];
  for (const message of ordered) {
    const matches = message.content_text.match(CONTENT_CUES.code) || [];
    for (const block of matches) {
      const inner = block
        .replace(/```[a-zA-Z0-9_-]*\s*/, "")
        .replace(/```$/, "")
        .trim();
      if (inner) {
        const firstLines = inner.split(/\r?\n/).slice(0, 3).join(" | ");
        codeBlocks.push(shorten(firstLines, 180));
      }
    }
  }

  // Extract file paths
  const filePaths: string[] = [];
  for (const message of ordered) {
    const matches = message.content_text.match(CONTENT_CUES.path) || [];
    for (const found of matches) {
      if (found.length > 5 && /[\/\\]/.test(found)) {
        filePaths.push(shorten(found, 140));
      }
    }
  }

  // Extract commands
  const commands: string[] = [];
  for (const message of ordered) {
    const matches = message.content_text.match(CONTENT_CUES.command) || [];
    for (const found of matches) {
      commands.push(shorten(found.trim(), 160));
    }
  }

  // Extract patterns (reusable knowledge)
  const patterns = ordered
    .filter((m) => m.role === "ai")
    .flatMap((m) => splitIntoSentences(m.content_text))
    .filter((s) => 
      /\b(?:pattern|approach|strategy|best practice|recommendation|建议|方案|策略)\b/i.test(s)
    )
    .map((s) => shorten(s, 220));

  return {
    questions: unique(questions).slice(0, 3),
    constraints: unique(constraints).slice(0, 3),
    decisions: unique(decisions).slice(0, 4),
    insights: unique(insights).slice(0, 5),
    patterns: unique(patterns).slice(0, 4),
    unresolved: unique(unresolved).slice(0, 4),
    codeBlocks: unique(codeBlocks).slice(0, 3),
    filePaths: unique(filePaths).slice(0, 4),
    commands: unique(commands).slice(0, 3),
  };
}

function classifySummaryContent(messages: Message[]): SummaryClassification {
  const knowledge = extractKnowledge(messages);
  const transcript = messages.map((m) => m.content_text).join("\n");

  const scores: Record<SummaryContentType, number> = {
    decision: 0,
    debugging: 0,
    architecture_tradeoff: 0,
    explanation_teaching: 0,
    process_agreement: 0,
    generation: 0,
  };

  // Score based on extracted knowledge
  scores.decision += knowledge.decisions.length * 3;
  scores.debugging += 
    (/\b(?:bug|error|fix|debug|issue|problem)\b/i.test(transcript) ? 4 : 0) +
    knowledge.unresolved.length;
  scores.architecture_tradeoff += 
    (/\b(?:architecture|design|trade.?off|compare|versus|vs)\b/i.test(transcript) ? 4 : 0) +
    knowledge.constraints.length;
  scores.explanation_teaching += 
    (/\b(?:explain|how does|why is|what is|原理|解释)\b/i.test(transcript) ? 4 : 0) +
    knowledge.insights.length * 2;
  scores.process_agreement += 
    (/\b(?:agreement|workflow|process|scope|约定|流程)\b/i.test(transcript) ? 3 : 0) +
    knowledge.constraints.length;
  scores.generation += 
    (/\b(?:generate|create|draft|brainstorm|design|创作|生成)\b/i.test(transcript) ? 3 : 0) +
    knowledge.patterns.length;

  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .filter((entry) => entry[1] > 0);

  if (ranked.length === 0) {
    return { primary: "decision", confidence: 0.3 };
  }

  const [first, second] = ranked;
  const confidence = Math.min(0.9, 0.4 + first[1] * 0.1);

  if (second && second[1] >= 3 && first[1] - second[1] <= 2) {
    return {
      primary: first[0] as SummaryContentType,
      secondary: second[0] as SummaryContentType,
      confidence,
    };
  }

  return { primary: first[0] as SummaryContentType, confidence };
}

// =============================================================================
// Smart Transcript Packing (mirroring compact experimental packing)
// =============================================================================

function scoreWindowCandidate(message: Message, label: SummaryEvidenceWindow["label"]): number {
  const text = message.content_text;
  let score = 0;

  switch (label) {
    case "Core Insight Discovery":
      score += CONTENT_CUES.insight.test(text) ? 6 : 0;
      score += CONTENT_CUES.decision.test(text) ? 3 : 0;
      score += message.role === "ai" ? 2 : 0;
      break;
    case "Key Decision Point":
      score += CONTENT_CUES.decision.test(text) ? 7 : 0;
      score += /\b(?:choose|select|go with|decide)\b/i.test(text) ? 4 : 0;
      score += message.role === "ai" ? 1 : 0;
      break;
    case "Problem-Solution Pivot":
      score += /\b(?:solve|solution|fix|resolve|解决|修复)\b/i.test(text) ? 6 : 0;
      score += CONTENT_CUES.insight.test(text) ? 3 : 0;
      break;
    case "Knowledge Synthesis":
      score += /\b(?:pattern|principle|总结|归纳|synthesize)\b/i.test(text) ? 5 : 0;
      score += CONTENT_CUES.insight.test(text) ? 3 : 0;
      break;
    case "Unresolved Exploration":
      score += CONTENT_CUES.unresolved.test(text) ? 6 : 0;
      score += /\b(?:explore|investigate|look into|研究|探索)\b/i.test(text) ? 3 : 0;
      break;
  }

  // Length bonus
  score += Math.min(3, Math.floor(normalizeWhitespace(text).length / 150));
  return score;
}

function selectEvidenceWindow(
  messages: Message[],
  startOffset: number,
  usedIndices: Set<number>,
  label: SummaryEvidenceWindow["label"]
): SummaryEvidenceWindow | null {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < messages.length; i++) {
    if (usedIndices.has(i)) continue;
    const score = scoreWindowCandidate(messages[i], label);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore <= 0) return null;

  // Include adjacent turn if it's the other role
  let endIndex = bestIndex;
  if (
    bestIndex + 1 < messages.length &&
    !usedIndices.has(bestIndex + 1) &&
    messages[bestIndex + 1].role !== messages[bestIndex].role
  ) {
    endIndex = bestIndex + 1;
  }

  for (let i = bestIndex; i <= endIndex; i++) {
    usedIndices.add(i);
  }

  return {
    label,
    startIndex: startOffset + bestIndex,
    endIndex: startOffset + endIndex,
    turns: messages.slice(bestIndex, endIndex + 1),
    score: bestScore,
  };
}

function buildMiddleEvidenceWindows(messages: Message[], startOffset: number): string | undefined {
  if (messages.length === 0) return undefined;

  const usedIndices = new Set<number>();
  const labels: SummaryEvidenceWindow["label"][] = [
    "Core Insight Discovery",
    "Key Decision Point",
    "Problem-Solution Pivot",
    "Knowledge Synthesis",
    "Unresolved Exploration",
  ];

  const windows = labels
    .map((label) => selectEvidenceWindow(messages, startOffset, usedIndices, label))
    .filter((w): w is SummaryEvidenceWindow => Boolean(w));

  if (windows.length === 0) return undefined;

  return windows
    .slice(0, SUMMARY_PACKING.maxMiddleWindows)
    .map((w, i) => {
      const range = w.startIndex === w.endIndex
        ? `${w.startIndex + 1}`
        : `${w.startIndex + 1}-${w.endIndex + 1}`;
      return [
        `### Window ${i + 1}: ${w.label} (turns ${range})`,
        ...w.turns.map((t, idx) => 
          `${w.startIndex + idx + 1}. [${t.role === "user" ? "User" : "AI"}] ${shorten(t.content_text, 400)}`
        ),
      ].join("\n");
    })
    .join("\n\n");
}

function buildPackedTranscript(messages: Message[]): PackedTranscript {
  const ordered = toOrderedMessages(messages);

  if (ordered.length <= SUMMARY_PACKING.keepFirstMessages + SUMMARY_PACKING.keepLastMessages) {
    return {
      head: ordered,
      middleWindows: [],
      tail: [],
      omittedCount: 0,
      totalCount: ordered.length,
    };
  }

  const head = ordered.slice(0, SUMMARY_PACKING.keepFirstMessages);
  const tailStart = Math.max(
    SUMMARY_PACKING.keepFirstMessages,
    ordered.length - SUMMARY_PACKING.keepLastMessages
  );
  const middle = ordered.slice(SUMMARY_PACKING.keepFirstMessages, tailStart);
  const tail = ordered.slice(tailStart);

  return {
    head,
    middleWindows: [], // Will be built separately for prompt insertion
    tail,
    omittedCount: middle.length,
    totalCount: ordered.length,
  };
}

// =============================================================================
// Prompt Templates (mirroring compact composer pattern)
// =============================================================================

interface SummaryPromptPayload {
  conversation: Conversation;
  messages: Message[];
  classification: SummaryClassification;
  knowledge: ExtractedKnowledge;
  locale: "zh" | "en";
}

const SUMMARY_SYSTEM = `You are Vesti's knowledge export assistant.

Your goal is to create a note-ready markdown summary optimized for future human recall. The reader may be the same person returning weeks later, or someone new who needs to quickly understand what was discussed and what knowledge was created.

Output must contain these exact headings:
## TL;DR
## Problem Frame
## Important Moves
## Reusable Snippets
## Next Steps
## Tags

Hard rules:
1) Use only evidence present in the provided transcript.
2) Focus on extracting reusable knowledge, not just recounting what happened.
3) Make the summary useful for someone asking "What did I learn from this conversation?"
4) Keep the thinking journey focused on intellectual progression, not mechanical turns.
5) Key insights should be standalone concepts that can be understood without the full context.
6) Reusable snippets should include both code snippets AND conceptual patterns.
7) Next steps should be actionable and specific.
8) Respect the requested locale.
9) Output markdown only. Do not wrap in code fences.
10) Never invent facts not supported by the evidence.`;

const SUMMARY_JOURNEY_EXEMPLAR = `Example important moves entry:
## Important Moves
1. **Initial Problem Recognition** [User]
   - Identified hydration mismatch as the core issue affecting SSR consistency
   - Realized the problem appears inconsistently across different timezones

2. **Root Cause Analysis** [AI]  
   - Traced the issue to useEffect execution timing rather than data inconsistency
   - Discovered that client-side date formatting runs before hydration completes`;

const SUMMARY_INSIGHT_EXEMPLAR = `Example key insight (include within ## Important Moves or ## Reusable Snippets as appropriate):
- **Hydration Timing Principle**: 80% of React hydration issues stem from useEffect execution timing, not data mismatch. Always verify effect scheduling before suspecting data layers.

- **Locale-Aware Testing**: Timezone-sensitive components need explicit hydration guards, not just server-side rendering fixes.`;

function buildSummaryPrompt(payload: SummaryPromptPayload): string {
  const { conversation, messages, classification, knowledge, locale } = payload;
  
  // Build smart packed transcript
  const packing = buildPackedTranscript(messages);
  const middleWindows = buildMiddleEvidenceWindows(
    messages.slice(SUMMARY_PACKING.keepFirstMessages, 
      Math.max(SUMMARY_PACKING.keepFirstMessages, messages.length - SUMMARY_PACKING.keepLastMessages)),
    SUMMARY_PACKING.keepFirstMessages
  );

  // Build transcript sections
  const headSection = packing.head
    .map((m, i) => `${i + 1}. [${m.role === "user" ? "User" : "AI"}] ${m.content_text}`)
    .join("\n");

  const tailSection = packing.tail
    .map((m, i) => {
      const idx = packing.totalCount - packing.tail.length + i + 1;
      return `${idx}. [${m.role === "user" ? "User" : "AI"}] ${m.content_text}`;
    })
    .join("\n");

  const transcriptParts = [
    "[Opening Context]",
    headSection,
  ];

  if (middleWindows && packing.omittedCount > 0) {
    transcriptParts.push(
      "",
      `[Middle Evidence Windows | key moments from ${packing.omittedCount} omitted turns]`,
      middleWindows
    );
  }

  if (packing.tail.length > 0) {
    transcriptParts.push(
      "",
      "[Latest Context]",
      tailSection
    );
  }

  const transcript = transcriptParts.join("\n");

  // Type-specific guidance
  const typeGuidance = {
    decision: "Focus on the decision rationale and alternatives considered.",
    debugging: "Emphasize the debugging process, false paths, and root cause.",
    architecture_tradeoff: "Highlight the tradeoff analysis and chosen architecture.",
    explanation_teaching: "Preserve the explanation structure and key analogies.",
    process_agreement: "Record the agreed workflow and constraints clearly.",
    generation: "Capture the creative directions and selection criteria.",
  }[classification.primary];

  return `Create a knowledge export summary for this conversation.

Metadata:
- Title: ${conversation.title || "(untitled)"}
- Platform: ${conversation.platform}
- Started: ${formatExportDateTime(getConversationOriginAt(conversation))}
- Messages: ${messages.length}
- Content Type: ${classification.primary}${classification.secondary ? ` + ${classification.secondary}` : ""}
- Locale: ${locale}

Transcript:
${transcript}

Type-Specific Focus:
${typeGuidance}

Output Requirements:
1) TL;DR: One crisp paragraph capturing the core outcome and key learning.
2) Problem Frame: What problem was being solved and what constraints existed.
3) Important Moves: 3-5 key moves showing intellectual progression, not just turn-by-turn.
4) Reusable Snippets: Both code snippets and conceptual patterns.
5) Next Steps: Concrete next steps or open questions.
6) Tags: Relevant keywords and metadata about the conversation.

Section Anchors:
${SUMMARY_JOURNEY_EXEMPLAR}

${SUMMARY_INSIGHT_EXEMPLAR}

Write in ${locale === "en" ? "natural English" : "natural Chinese"}.
Output markdown only.`;
}

function buildSummaryFallbackPrompt(payload: SummaryPromptPayload): string {
  const { conversation, messages, knowledge, locale } = payload;
  const transcript = toExportTranscript(messages);

  return `Write a conservative knowledge summary for this conversation.

Required headings:
## TL;DR
## Problem Frame
## Important Moves
## Reusable Snippets
## Next Steps
## Tags

Guidance:
- Keep structure compliant even if content is sparse.
- Use conservative placeholders rather than inventing details.
- Preserve concrete artifacts (paths, commands, code) when present.

Safe anchors:
## TL;DR
- Core topic: <grounded subject>
- Key outcome: <grounded result or status>

## Problem Frame
- Core question: <grounded problem>
- Constraints: <grounded constraints or "None explicitly stated">

## Important Moves
1. <first key turn>
2. <progression or insight>
3. <conclusion or current state>

## Reusable Snippets
- <snippet or code reference or "None identified">

## Next Steps
- <next step or open question>

## Tags
- <comma-separated keywords>

Transcript:
${transcript}

Use ${locale === "en" ? "English" : "Chinese"}.
Output markdown only.`;
}

// =============================================================================
// Validation (mirroring compact validation pattern)
// =============================================================================

function buildIntegrityWarnings(value: string): string[] {
  const warnings: string[] = [];

  // Check for unclosed code blocks
  const codeFenceCount = (value.match(/```/g) || []).length;
  if (codeFenceCount % 2 !== 0) {
    warnings.push("unclosed_code_block");
  }

  // Check for dangling list items
  const lines = value.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^[-*]\s+\S+.*:$/.test(line)) {
      // Check if next non-empty line continues the item
      let hasContinuation = false;
      for (let j = i + 1; j < lines.length && j < i + 5; j++) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        if (nextLine.startsWith("##") || /^[-*]\s+/.test(nextLine)) break;
        hasContinuation = true;
        break;
      }
      if (!hasContinuation) {
        warnings.push(`dangling_item:${shorten(line, 60)}`);
      }
    }
  }

  return warnings;
}

function extractSections(value: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = value.split("\n");
  let currentHeading: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      if (currentHeading) {
        sections.set(currentHeading, currentContent.join("\n").trim());
      }
      currentHeading = trimmed;
      currentContent = [];
    } else if (currentHeading) {
      currentContent.push(line);
    }
  }

  if (currentHeading) {
    sections.set(currentHeading, currentContent.join("\n").trim());
  }

  return sections;
}

function assessInsightQuality(insightsSection: string): QualityAssessment["insightQuality"] {
  const insights = insightsSection
    .split("\n")
    .filter((line) => /^[-*]\s+/.test(line.trim()));

  if (insights.length === 0) return "low";

  let highQualityCount = 0;
  for (const insight of insights) {
    const text = insight.replace(/^[-*]\s+/, "");
    // High quality insights are specific and standalone
    if (
      text.length > 50 &&
      (/\b(?:because|therefore|leads to|results in|意味着|导致|因此)\b/i.test(text) ||
       /\*\*[\w\s]+\*\*[:：]/.test(text)) // Has bolded term with definition
    ) {
      highQualityCount++;
    }
  }

  if (highQualityCount >= insights.length * 0.5 && insights.length >= 2) return "high";
  if (insights.length >= 2) return "medium";
  return "low";
}

function validateSummaryOutput(
  value: string,
  transcriptChars: number
): SummaryValidationResult {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const normalizedOutputChars = normalized.length;

  // Calculate metrics
  const absoluteMinChars = MIN_VALID_OUTPUT_LENGTH;
  const softMinChars = Math.max(
    absoluteMinChars,
    Math.floor(transcriptChars * SUMMARY_SOFT_MIN_RATIO)
  );

  const metrics: SummaryMetrics = {
    transcriptChars,
    rawOutputChars: value.length,
    normalizedOutputChars,
    absoluteMinChars,
    softMinChars,
  };

  const integrityWarnings = buildIntegrityWarnings(normalized);

  // Check minimum length
  if (normalizedOutputChars < absoluteMinChars) {
    return {
      valid: false,
      issueCode: "summary_output_too_short",
      metrics,
      integrityWarnings,
      qualityAssessment: {
        triggered: true,
        passed: false,
        hasTldr: false,
        hasProblemFrame: false,
        hasThinkingJourney: false,
        hasKeyInsights: false,
        insightQuality: "low",
        warning: "Output too short for meaningful summary",
      },
    };
  }

  // Extract and validate sections
  const sections = extractSections(normalized);
  
  // Core required sections (must have all 3) - aligned with exportCompression.ts
  const coreSections = ["## TL;DR", "## Problem Frame", "## Important Moves"];
  // Optional bonus sections
  const bonusSections = ["## Reusable Snippets", "## Next Steps", "## Tags"];
  const allSections = [...coreSections, ...bonusSections];
  
  // Legacy section support for backward compatibility during migration
  const legacySections = ["## Thinking Journey", "## Key Insights", "## Reusable Patterns", "## Follow-ups", "## Context"];
  
  const hasCore = coreSections.every((h) => sections.has(h));
  const hasLegacyCore = legacySections.some((h) => sections.has(h));
  const presentCount = allSections.filter((h) => sections.has(h)).length;
  const missingCore = coreSections.filter((h) => !sections.has(h));
  
  // Accept either new sections or legacy sections during transition
  if (!hasCore && !hasLegacyCore) {
    return {
      valid: false,
      issueCode: "summary_missing_required_headings",
      metrics,
      integrityWarnings,
      qualityAssessment: {
        triggered: true,
        passed: false,
        hasTldr: sections.has("## TL;DR"),
        hasProblemFrame: sections.has("## Problem Frame"),
        hasThinkingJourney: sections.has("## Important Moves") || sections.has("## Thinking Journey"),
        hasKeyInsights: sections.has("## Reusable Snippets") || sections.has("## Key Insights"),
        insightQuality: "low",
        warning: `Missing core sections: ${missingCore.join(", ")} (need TL;DR, Problem Frame, Important Moves)`,
      },
    };
  }

  // Assess grounded content
  let groundedSectionCount = 0;
  for (const [heading, content] of sections) {
    const hasContent = content
      .split("\n")
      .some((line) => {
        const trimmed = line.trim();
        return trimmed &&
          !trimmed.startsWith("##") &&
          !/^[-*]\s*(?:None|No\s|Unknown|未|无)/i.test(trimmed);
      });
    if (hasContent) groundedSectionCount++;
  }

  // Require at least 2 grounded sections (of the 3 core), or be lenient for short outputs
  const minGroundedSections = 2;
  if (groundedSectionCount < minGroundedSections && normalized.length > 800) {
    return {
      valid: false,
      issueCode: "summary_grounded_sections_insufficient",
      metrics,
      integrityWarnings,
      qualityAssessment: {
        triggered: true,
        passed: false,
        hasTldr: sections.has("## TL;DR"),
        hasProblemFrame: sections.has("## Problem Frame"),
        hasThinkingJourney: sections.has("## Important Moves") || sections.has("## Thinking Journey"),
        hasKeyInsights: sections.has("## Reusable Snippets") || sections.has("## Key Insights"),
        insightQuality: "low",
        warning: `Only ${groundedSectionCount} sections have grounded content (need at least ${minGroundedSections})`,
      },
    };
  }

  // Assess insight quality (only if Key Insights or Important Moves section exists)
  const insightsSection = sections.get("## Important Moves") || sections.get("## Key Insights") || "";
  const hasKeyInsights = sections.has("## Important Moves") || sections.has("## Key Insights");
  const insightQuality = hasKeyInsights ? assessInsightQuality(insightsSection) : "none";

  // Only reject for low quality if Important Moves exists and is substantial but generic
  if (insightQuality === "low" && hasKeyInsights && insightsSection.length > 200) {
    return {
      valid: false,
      issueCode: "summary_insights_too_generic",
      metrics,
      integrityWarnings,
      qualityAssessment: {
        triggered: true,
        passed: false,
        hasTldr: true,
        hasProblemFrame: true,
        hasThinkingJourney: true,
        hasKeyInsights: true,
        insightQuality,
        warning: "Important Moves section is too generic",
      },
    };
  }

  // All checks passed
  return {
    valid: true,
    metrics,
    integrityWarnings,
    qualityAssessment: {
      triggered: true,
      passed: true,
      hasTldr: true,
      hasProblemFrame: true,
      hasThinkingJourney: sections.has("## Important Moves") || sections.has("## Thinking Journey"),
      hasKeyInsights,
      insightQuality: insightQuality === "none" ? "medium" : insightQuality,
    },
  };
}

// =============================================================================
// Local Fallback (mirroring compact fallback pattern)
// =============================================================================

function buildSummaryLocalFallback(
  conversation: Conversation,
  messages: Message[],
  reason: string,
  locale: "zh" | "en"
): string {
  const knowledge = extractKnowledge(messages);
  const classification = classifySummaryContent(messages);

  // Build problem frame
  const problemFrameLines = [
    `**对话主题：** ${conversation.title || "(未命名)"}`,
    `**核心问题：** ${knowledge.questions[0] || "从对话中识别核心问题"}`,
  ];
  if (knowledge.constraints.length > 0) {
    problemFrameLines.push(`**关键约束：** ${knowledge.constraints.join("；")}`);
  }

  // Build thinking journey from message flow
  const journeySteps: string[] = [];
  const ordered = toOrderedMessages(messages);
  
  // Step 1: Opening
  const firstUser = ordered.find((m) => m.role === "user");
  if (firstUser) {
    journeySteps.push(
      `1. **问题提出** [User]\n   - ${shorten(firstUser.content_text, 150)}`
    );
  }

  // Step 2: Key middle insight
  const keyInsightIdx = ordered.findIndex((m) => 
    m.role === "ai" && CONTENT_CUES.insight.test(m.content_text)
  );
  if (keyInsightIdx > 0) {
    journeySteps.push(
      `2. **关键发现** [AI]\n   - ${shorten(ordered[keyInsightIdx].content_text, 150)}`
    );
  }

  // Step 3: Decision/Conclusion
  const lastAi = [...ordered].reverse().find((m) => m.role === "ai");
  if (lastAi && journeySteps.length > 0) {
    journeySteps.push(
      `${journeySteps.length + 1}. **当前状态** [AI]\n   - ${shorten(lastAi.content_text, 150)}`
    );
  }

  // Build important moves (combines journey + key insights)
  const importantMovesLines = journeySteps.length > 0
    ? journeySteps.map((step) => `- ${step.replace(/^\d+\.\s*/, "")}`)
    : ["- 未从对话中提取到关键步骤"];

  // Build reusable snippets
  const snippetsLines: string[] = [];
  if (knowledge.codeBlocks.length > 0) {
    snippetsLines.push(...knowledge.codeBlocks.map((c) => `- \`${c}\``));
  }
  if (knowledge.patterns.length > 0) {
    snippetsLines.push(...knowledge.patterns.map((p) => `- ${p}`));
  }
  if (knowledge.insights.length > 0) {
    snippetsLines.push(...knowledge.insights.map((i) => `- ${i}`));
  }
  if (snippetsLines.length === 0) {
    snippetsLines.push("- 未识别到可复用片段");
  }

  // Build next steps
  const nextStepsLines = knowledge.unresolved.length > 0
    ? knowledge.unresolved.map((u) => `- [ ] ${u}`)
    : ["- [ ] 回顾对话确定后续步骤"];

  // Build tags
  const tags = [
    conversation.platform,
    classification.primary,
    ...conversation.tags.slice(0, 3),
  ].filter(Boolean);

  return [
    "## TL;DR",
    knowledge.decisions[0] 
      ? `- ${shorten(knowledge.decisions[0], 200)}`
      : `- 关于${conversation.title || "技术话题"}的讨论`,
    "",
    "## Problem Frame",
    ...problemFrameLines,
    "",
    "## Important Moves",
    ...importantMovesLines,
    "",
    "## Reusable Snippets",
    ...snippetsLines,
    "",
    "## Next Steps",
    ...nextStepsLines,
    "",
    "## Tags",
    `- ${tags.join(", ")}${reason ? `, 回退原因: ${reason}` : ""}`,
  ].join("\n");
}

// =============================================================================
// Export
// =============================================================================

export interface SummaryComposerResult {
  body: string;
  classification: SummaryClassification;
  validation: SummaryValidationResult;
  source: "llm" | "local_fallback";
  usedFallbackPrompt: boolean;
  fallbackReason?: string;
}

export const SUMMARY_COMPOSER = {
  version: "v2.0.0-summary-knowledge-export",
  createdAt: "2026-03-20",
  description:
    "Knowledge export summary composer with content classification, smart packing, and structured validation. Mirrors compact/distill architecture for human recall.",
  system: SUMMARY_SYSTEM,
  fallbackSystem: `You are Vesti's knowledge export assistant. Output markdown only.

Required output format:
## TL;DR
## Problem Frame  
## Important Moves
## Reusable Snippets
## Next Steps
## Tags

Keep all 6 sections. Use grounded evidence only. Never invent facts.`,
  buildPrompt: buildSummaryPrompt,
  buildFallbackPrompt: buildSummaryFallbackPrompt,
  classifyContent: classifySummaryContent,
  extractKnowledge,
  buildPackedTranscript,
  validateOutput: validateSummaryOutput,
  buildLocalFallback: buildSummaryLocalFallback,
  // Constants
  PROMPT_BUDGET: SUMMARY_PROMPT_BUDGET,
  MAX_TOKENS: SUMMARY_MAX_TOKENS,
  REQUIRED_HEADINGS: SUMMARY_REQUIRED_HEADINGS,
} as const;

export default SUMMARY_COMPOSER;
// =============================================================================

import type { ExportCompressionPromptPayload } from "../types";

const LEGACY_SUMMARY_SYSTEM = `You are Vesti's export summary assistant.

Your first priority is future human recall: produce a note-ready markdown summary that helps a later reader who did not join the thread quickly recover what changed, why it mattered, and what can be reused.

Output must contain these exact headings:
## TL;DR
## Problem Frame
## Thinking Journey
## Key Insights
## Reusable Patterns
## Follow-ups
## Context

Hard rules:
1) Use only evidence present in the provided transcript.
2) Focus on extracting reusable knowledge, not just recounting what happened.
3) Make the summary useful for someone asking "What did I learn from this conversation?"
4) Keep the thinking journey focused on intellectual progression, not mechanical turns.
5) Key insights should be standalone concepts that can be understood without full context.
6) Reusable patterns should include both code snippets AND conceptual patterns.
7) Follow-ups should be actionable and specific.
8) Respect the requested locale.
9) Output markdown only. Do not wrap the whole answer in code fences.
10) Never invent facts not supported by the evidence.`;

function buildLegacySummaryPrompt(payload: ExportCompressionPromptPayload): string {
  const isStepProfile = payload.profile === "step_flash_concise";
  const profileInstruction = isStepProfile
    ? "Favor structural coverage and concise grounded bullets over essay-like phrasing."
    : "Favor richer problem framing and clearer reconstruction of the thread's actual progression.";

  return `Create a note-ready export summary for this conversation.

Metadata:
- Title: ${payload.conversationTitle || "(untitled)"}
- Platform: ${payload.conversationPlatform || "unknown"}
- StartedAt: ${
    payload.conversationOriginAt
      ? formatExportDateTime(payload.conversationOriginAt)
      : "unknown"
  }
- Locale: ${payload.locale || "zh"}
- MessageCount: ${payload.messages.length}

Transcript:
${toExportTranscript(payload.messages)}

Output requirements:
1) Use the exact headings listed in the system prompt.
2) TL;DR: One crisp paragraph capturing the core outcome and key learning.
3) Problem Frame: What problem was being solved and what constraints existed.
4) Thinking Journey: 3-5 steps showing intellectual progression, not just turn-by-turn.
5) Key Insights: 2-4 standalone insights that can be reused without full context.
6) Reusable Patterns: Both code patterns and conceptual patterns.
7) Follow-ups: Concrete next steps or open questions.
8) Context: Metadata about the conversation.
9) ${profileInstruction}
10) Keep bullets concise and grounded.
11) If evidence is sparse, keep the structure and use conservative placeholders.
12) Write the final output in ${payload.locale === "en" ? "natural English" : "natural Chinese"}.
13) Output markdown only.`;
}

function buildLegacySummaryFallbackPrompt(
  payload: ExportCompressionPromptPayload
): string {
  const fallbackGuidance =
    payload.profile === "step_flash_concise"
      ? "Prefer compact, contract-safe bullets that preserve concrete actions and artifacts."
      : "Prefer a conservative, contract-safe note that keeps problem framing and important moves explicit when evidence exists.";

  return `Write a markdown export summary for this conversation.

You must use these exact headings:
## TL;DR
## Problem Frame
## Thinking Journey
## Key Insights
## Reusable Patterns
## Follow-ups
## Context

Requirements:
1) Keep the structure compliant even if content is sparse.
2) Use grounded evidence only.
3) Preserve commands, files, APIs, and code references when they exist.
4) Even if the transcript is sparse, keep all headings and fill them conservatively.
5) Favor compliance and stability over elegance or compression.
6) In ## Thinking Journey, show 3-5 steps of intellectual progression.
7) In ## Key Insights, extract standalone reusable concepts.
8) ${fallbackGuidance}
9) Use ${payload.locale === "en" ? "English" : "Chinese"}.
10) Output markdown only.

Safe anchors:
## TL;DR
- Core takeaway: <grounded conclusion or conservative placeholder>

## Problem Frame
- Core question: <grounded problem statement>
- Constraint: <grounded key constraint or conservative placeholder>

## Thinking Journey
1. <first key turn>
2. <progression or insight>
3. <conclusion or current state>

## Key Insights
- <insight or "No distinct insights captured">

## Reusable Patterns
- <pattern or code reference or "None identified">

## Follow-ups
- [ ] <next step or open question>

## Context
- Platform: ${payload.conversationPlatform || "unknown"}
- Messages: ${payload.messages.length}

Transcript:
${toExportTranscript(payload.messages)}`;
}

export const CURRENT_EXPORT_SUMMARY_PROMPT: PromptVersion<ExportCompressionPromptPayload> = {
  version: "v2.0.0-summary-knowledge-export",
  createdAt: "2026-03-20",
  description:
    "Summary export prompt for human-readable notes with stronger recall framing, pattern-oriented snippet anchors, and contract-safe fallback behavior.",
  system: LEGACY_SUMMARY_SYSTEM,
  fallbackSystem: "You are a concise technical export assistant. Output markdown only.",
  userTemplate: buildLegacySummaryPrompt,
  fallbackTemplate: buildLegacySummaryFallbackPrompt,
};

export const EXPERIMENTAL_EXPORT_SUMMARY_PROMPT: PromptVersion<ExportCompressionPromptPayload> = {
  version: "v2.0.0-summary-knowledge-export-exp",
  createdAt: "2026-03-20",
  description: "Experimental summary export variant with content classification and smart packing.",
  system: LEGACY_SUMMARY_SYSTEM,
  fallbackSystem: "You are a concise technical export assistant. Output markdown only.",
  userTemplate: buildLegacySummaryPrompt,
  fallbackTemplate: buildLegacySummaryFallbackPrompt,
};
