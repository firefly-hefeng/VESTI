import type { IParser, ParsedMessage } from "../IParser";
import type { Platform } from "../../../types";
import type { AstNode, AstRoot } from "../../../types/ast";
import {
  extractEarliestTimeFromSelectors,
  normalizeCandidateNodes,
  queryAllUnique,
  queryAllWithinUnique,
  queryFirst,
  queryFirstWithin,
  safeTextContent,
  uniqueNodesInDocumentOrder,
} from "../shared/selectorUtils";
import { extractAstFromElement } from "../shared/astExtractor";
import { astPerfModeController, type AstPerfMode } from "../shared/astPerfMode";
import { logger } from "../../../utils/logger";

const SELECTORS = {
  roleAnchors: [
    "[data-message-author-role='user']",
    "[data-message-author-role='assistant']",
    "[data-message-author-role='model']",
    "[data-role='user']",
    "[data-role='assistant']",
    "[data-role='model']",
    "[data-testid*='user']",
    "[data-testid*='model']",
    "[data-testid*='assistant']",
    "[class*='user-query']",
    "[class*='model-response']",
    "[class*='message-user']",
    "[class*='message-model']",
  ],
  turnBlocks: [
    "main [data-message-id]",
    "main [data-testid*='message']",
    "main [role='listitem']",
    "main article",
    "main [class*='message']",
    "main [class*='response']",
  ],
  messageContent: [
    "[data-testid*='message-content']",
    "[data-testid*='response-content']",
    ".markdown",
    ".prose",
    "div[class*='markdown']",
    "div[class*='message-content']",
    "div[class*='response-content']",
  ],
  title: ["[role='heading']", "main h1", "header h1", "title"],
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='streaming']",
    "[data-testid*='typing']",
    ".typing",
    ".result-streaming",
  ],
  noiseContainers: [
    "form",
    "footer",
    "nav",
    "[role='navigation']",
    "[data-testid*='composer']",
    "[contenteditable='true']",
  ],
  noiseTextPatterns: [
    /^new chat$/i,
    /^help$/i,
    /^retry$/i,
    /^edit$/i,
    /^copy$/i,
    /^gemini can make mistakes\.?/i,
  ],
  sourceTimes: ["main time[datetime]", "article time[datetime]"],
};

const SESSION_ID_QUERY_KEYS = [
  "conversation",
  "conversation_id",
  "chat",
  "chat_id",
  "id",
  "cid",
];

const SESSION_ID_PATTERNS = [
  /\/app\/([a-zA-Z0-9_-]{8,})/i,
  /\/chat\/([a-zA-Z0-9_-]{8,})/i,
  /\/c\/([a-zA-Z0-9_-]{8,})/i,
];

const INVALID_SESSION_IDS = new Set(["app", "new", "chat", "conversation"]);
const INVALID_GENERIC_TITLES = new Set(["chats", "gemini", "google gemini"]);
const MAX_FALLBACK_TITLE_LENGTH = 120;
const GEMINI_USER_PREFIX_PATTERN = /^[\s\u200B\uFEFF]*you said(?:\s*[:\-])?\s*/i;
const TITLE_BOUNDARY_CHARS = ["\n", "。", "？", "!", "！", "?"];

type MessageRole = "user" | "ai";
type ExtractionSource = "selector" | "anchor";

interface ParserStats {
  source: ExtractionSource;
  totalCandidates: number;
  keptMessages: number;
  roleDistribution: Record<MessageRole, number>;
  droppedNoise: number;
  droppedUnknownRole: number;
  parse_duration_ms: number;
  perf_mode: AstPerfMode;
  next_perf_mode: AstPerfMode;
  degraded_nodes_count: number;
  ast_node_count: number;
  message_count: number;
  platform: Platform;
}

interface ExtractionResult {
  source: ExtractionSource;
  totalCandidates: number;
  droppedNoise: number;
  droppedUnknownRole: number;
  messages: ParsedMessage[];
  degradedNodesCount: number;
  astNodeCount: number;
}

interface ParsedNodeResult {
  message: ParsedMessage;
  degradedNodesCount: number;
  astNodeCount: number;
}

export class GeminiParser implements IParser {
  private latestMessages: ParsedMessage[] = [];

  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("gemini.google.com")) {
      return "Gemini";
    }
    return null;
  }

  getConversationTitle(): string {
    const headingTitle = this.readTitleFromSelectors([SELECTORS.title[0]]);
    if (headingTitle) return headingTitle;

    const userDerivedTitle = this.buildTitleFromFirstUserMessage();
    if (userDerivedTitle) return userDerivedTitle;

    const fallbackTitle = this.readTitleFromSelectors(SELECTORS.title.slice(1));
    if (fallbackTitle) return fallbackTitle;

    const normalizedDocumentTitle = this.normalizeTitleCandidate(document.title);
    if (this.isUsableTitle(normalizedDocumentTitle)) {
      return normalizedDocumentTitle;
    }

    return "Untitled Conversation";
  }

  getMessages(): ParsedMessage[] {
    const startedAt = performance.now();
    const perfMode = astPerfModeController.getMode("Gemini");
    const selectorResult = this.extractUsingSelectorStrategy(perfMode);
    const anchorResult = this.extractUsingAnchorStrategy(perfMode);
    const chosen = this.chooseBestExtraction(selectorResult, anchorResult);
    const deduped = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("Gemini", parseDurationMs);

    const stats: ParserStats = {
      source: chosen.source,
      totalCandidates: chosen.totalCandidates,
      keptMessages: deduped.length,
      roleDistribution: { user: 0, ai: 0 },
      droppedNoise: chosen.droppedNoise + (chosen.messages.length - deduped.length),
      droppedUnknownRole: chosen.droppedUnknownRole,
      parse_duration_ms: parseDurationMs,
      perf_mode: perfMode,
      next_perf_mode: modeUpdate.mode,
      degraded_nodes_count: chosen.degradedNodesCount,
      ast_node_count: chosen.astNodeCount,
      message_count: deduped.length,
      platform: "Gemini",
    };

    if (modeUpdate.switched) {
      logger.warn("parser", "Gemini AST perf mode switched", {
        platform: "Gemini",
        from: modeUpdate.previousMode,
        to: modeUpdate.mode,
        parse_duration_ms: parseDurationMs,
        message_count: deduped.length,
      });
    }

    for (const message of deduped) {
      stats.roleDistribution[message.role] += 1;
    }

    this.latestMessages = deduped;
    this.logStats(stats, deduped);
    return deduped;
  }

  isGenerating(): boolean {
    return queryFirst(SELECTORS.generating) !== null;
  }

  getSessionUUID(): string | null {
    try {
      const url = new URL(window.location.href);

      for (const key of SESSION_ID_QUERY_KEYS) {
        const value = url.searchParams.get(key);
        const normalized = this.normalizeSessionId(value);
        if (normalized) return normalized;
      }

      for (const pattern of SESSION_ID_PATTERNS) {
        const match = url.pathname.match(pattern);
        const normalized = this.normalizeSessionId(match?.[1] ?? null);
        if (normalized) return normalized;
      }
    } catch {
      return null;
    }

    return null;
  }

  getSourceCreatedAt(): number | null {
    return extractEarliestTimeFromSelectors(SELECTORS.sourceTimes);
  }

  private extractUsingSelectorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const rawCandidates = this.collectMessageCandidates();
    const normalized = normalizeCandidateNodes(rawCandidates, {
      minTextLength: 2,
      noiseContainerSelectors: SELECTORS.noiseContainers,
      noiseTextPatterns: SELECTORS.noiseTextPatterns,
    });

    const messages: ParsedMessage[] = [];
    let droppedUnknownRole = 0;
    let droppedNoise = normalized.droppedNoise;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const node of normalized.nodes) {
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }
      if (!parsed.message.textContent.trim()) {
        droppedNoise += 1;
        continue;
      }

      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "selector",
      totalCandidates: rawCandidates.length,
      droppedNoise,
      droppedUnknownRole,
      messages,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private extractUsingAnchorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const anchors = queryAllUnique(SELECTORS.roleAnchors);
    if (anchors.length === 0) {
      return {
        source: "anchor",
        totalCandidates: 0,
        droppedNoise: 0,
        droppedUnknownRole: 0,
        messages: [],
        degradedNodesCount: 0,
        astNodeCount: 0,
      };
    }

    const resolved = uniqueNodesInDocumentOrder(
      anchors.map((anchor) => this.resolveAnchorNode(anchor)).filter(Boolean) as Element[]
    );

    const messages: ParsedMessage[] = [];
    let droppedNoise = 0;
    let droppedUnknownRole = 0;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const node of resolved) {
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }
      if (!parsed.message.textContent.trim()) {
        droppedNoise += 1;
        continue;
      }
      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "anchor",
      totalCandidates: resolved.length,
      droppedNoise,
      droppedUnknownRole,
      messages,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private resolveAnchorNode(anchor: Element): Element | null {
    let current: Element | null = anchor;
    while (current) {
      if (SELECTORS.turnBlocks.some((selector) => current?.matches(selector))) {
        return current;
      }
      current = current.parentElement;
    }
    return anchor;
  }

  private collectMessageCandidates(): Element[] {
    const combinedCandidates: Element[] = [...queryAllUnique(SELECTORS.roleAnchors)];

    for (const turnNode of queryAllUnique(SELECTORS.turnBlocks)) {
      const splitNodes = queryAllWithinUnique(turnNode, SELECTORS.roleAnchors);
      if (splitNodes.length > 0) {
        combinedCandidates.push(...splitNodes);
        continue;
      }
      combinedCandidates.push(turnNode);
    }

    return uniqueNodesInDocumentOrder(combinedCandidates);
  }

  private parseMessageNode(node: Element, perfMode: AstPerfMode): ParsedNodeResult | null {
    const role = this.inferRole(node);
    if (!role) return null;

    const contentEl = queryFirstWithin(node, SELECTORS.messageContent);
    const rawText = this.cleanExtractedText(safeTextContent(contentEl ?? node));
    const textContent =
      role === "user" ? this.stripUserLabelPrefix(rawText) : rawText;
    const astResult = extractAstFromElement(contentEl ?? node, {
      platform: "Gemini",
      perfMode,
    });
    const contentAst = this.sanitizeUserAstPrefix(astResult.root, role);

    return {
      message: {
        role,
        textContent,
        contentAst,
        contentAstVersion: contentAst ? "ast_v1" : null,
        degradedNodesCount: astResult.degradedNodesCount,
        htmlContent: contentEl ? contentEl.innerHTML : undefined,
      },
      degradedNodesCount: astResult.degradedNodesCount,
      astNodeCount: astResult.astNodeCount,
    };
  }

  private inferRole(node: Element): MessageRole | null {
    const attrRole =
      this.roleFromAttribute(node.getAttribute("data-message-author-role")) ??
      this.roleFromAttribute(node.getAttribute("data-role"));
    if (attrRole) return attrRole;

    const testIdRole = this.roleFromHint(node.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    const classRole = this.roleFromHint(node.className?.toString() ?? "");
    if (classRole) return classRole;

    const ancestor = node.parentElement?.closest("[data-role], [data-testid], [class]");
    if (ancestor) {
      const ancestorRole =
        this.roleFromAttribute(ancestor.getAttribute("data-message-author-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-role")) ??
        this.roleFromHint(ancestor.getAttribute("data-testid")) ??
        this.roleFromHint(ancestor.className?.toString() ?? "");
      if (ancestorRole) return ancestorRole;
    }

    return null;
  }

  private roleFromAttribute(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "user" || normalized === "human") return "user";
    if (
      normalized === "assistant" ||
      normalized === "model" ||
      normalized === "ai" ||
      normalized === "gemini"
    ) {
      return "ai";
    }
    return null;
  }

  private roleFromHint(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (
      normalized.includes("user") ||
      normalized.includes("human") ||
      normalized.includes("prompt") ||
      normalized.includes("query")
    ) {
      return "user";
    }
    if (
      normalized.includes("assistant") ||
      normalized.includes("model") ||
      normalized.includes("gemini") ||
      normalized.includes("response")
    ) {
      return "ai";
    }
    return null;
  }

  private cleanExtractedText(rawText: string): string {
    return rawText
      .replace(/\s+/g, " ")
      .replace(/^(copy|edit|retry)\s+/i, "")
      .trim();
  }

  private stripUserLabelPrefix(rawText: string): string {
    return rawText.replace(GEMINI_USER_PREFIX_PATTERN, "").trim();
  }

  private sanitizeUserAstPrefix(root: AstRoot | null, role: MessageRole): AstRoot | null {
    if (!root || role !== "user") {
      return root;
    }

    this.stripLeadingYouSaid(root.children);
    return root.children.length > 0 ? root : null;
  }

  private stripLeadingYouSaid(nodes: AstNode[]): boolean {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!node) continue;

      if (node.type === "text") {
        const stripped = node.text.replace(GEMINI_USER_PREFIX_PATTERN, "");
        if (stripped !== node.text) {
          if (stripped.trim().length === 0) {
            nodes.splice(index, 1);
          } else {
            node.text = stripped;
          }
          return true;
        }

        if (node.text.trim().length === 0) {
          nodes.splice(index, 1);
          index -= 1;
          continue;
        }
        return false;
      }

      if (node.type === "br") {
        continue;
      }

      if (
        node.type === "fragment" ||
        node.type === "p" ||
        node.type === "h1" ||
        node.type === "h2" ||
        node.type === "h3" ||
        node.type === "ul" ||
        node.type === "ol" ||
        node.type === "li" ||
        node.type === "strong" ||
        node.type === "em" ||
        node.type === "blockquote"
      ) {
        const changed = this.stripLeadingYouSaid(node.children);
        if (node.children.length === 0) {
          nodes.splice(index, 1);
          index -= 1;
          continue;
        }
        return changed;
      }

      return false;
    }

    return false;
  }

  private normalizeTitleCandidate(rawTitle: string): string {
    const compact = rawTitle.replace(/\s+/g, " ").trim();
    return this.stripUserLabelPrefix(compact);
  }

  private toConciseTitle(rawTitle: string): string {
    const normalized = this.normalizeTitleCandidate(rawTitle);
    if (!normalized) return "";

    let boundaryIndex = -1;
    for (const token of TITLE_BOUNDARY_CHARS) {
      const index = normalized.indexOf(token);
      if (index === -1) continue;
      if (boundaryIndex === -1 || index < boundaryIndex) {
        boundaryIndex = index;
      }
    }

    const bounded =
      boundaryIndex >= 0 ? normalized.slice(0, boundaryIndex + 1) : normalized;
    return bounded.slice(0, MAX_FALLBACK_TITLE_LENGTH).trim();
  }

  private isUsableTitle(title: string): boolean {
    if (!title) return false;
    return !INVALID_GENERIC_TITLES.has(title.toLowerCase());
  }

  private readTitleFromSelectors(selectors: string[]): string | null {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const normalized = this.toConciseTitle(safeTextContent(node));
      if (this.isUsableTitle(normalized)) {
        return normalized;
      }
    }
    return null;
  }

  private readFirstUserMessageFromDom(): string | null {
    const userNodes = queryAllUnique([
      "main [data-message-author-role='user']",
      "main [data-role='user']",
      "main [data-testid*='user']",
      "main [class*='user-query']",
      "main [class*='message-user']",
    ]);

    for (const node of userNodes) {
      const contentNode = queryFirstWithin(node, SELECTORS.messageContent);
      const candidate = this.toConciseTitle(safeTextContent(contentNode ?? node));
      if (this.isUsableTitle(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private buildTitleFromFirstUserMessage(): string | null {
    const domCandidate = this.readFirstUserMessageFromDom();
    if (domCandidate) return domCandidate;

    const messages = this.latestMessages.length > 0 ? this.latestMessages : this.getMessages();
    const firstUserMessage = messages.find(
      (message) => message.role === "user" && message.textContent.trim().length > 0
    );
    if (!firstUserMessage) return null;

    const normalized = this.toConciseTitle(firstUserMessage.textContent);
    if (!this.isUsableTitle(normalized)) return null;
    return normalized;
  }

  private dedupeNearDuplicates(messages: ParsedMessage[]): ParsedMessage[] {
    const deduped: ParsedMessage[] = [];

    for (const message of messages) {
      const signature = `${message.role}|${message.textContent.replace(/\s+/g, " ").trim()}`;
      const isDuplicate = deduped
        .slice(Math.max(0, deduped.length - 2))
        .some((existing) => {
          const existingSignature = `${existing.role}|${existing.textContent
            .replace(/\s+/g, " ")
            .trim()}`;
          return existingSignature === signature;
        });

      if (!isDuplicate) {
        deduped.push(message);
      }
    }

    return deduped;
  }

  private chooseBestExtraction(
    selectorResult: ExtractionResult,
    anchorResult: ExtractionResult
  ): ExtractionResult {
    const selectorScore = this.scoreExtraction(selectorResult);
    const anchorScore = this.scoreExtraction(anchorResult);

    if (selectorScore > anchorScore) return selectorResult;
    if (anchorScore > selectorScore) return anchorResult;
    return selectorResult.messages.length >= anchorResult.messages.length
      ? selectorResult
      : anchorResult;
  }

  private scoreExtraction(result: ExtractionResult): number {
    if (result.messages.length === 0) return 0;

    const userCount = result.messages.filter((message) => message.role === "user").length;
    const aiCount = result.messages.length - userCount;
    const balancedPairs = Math.min(userCount, aiCount);

    return balancedPairs * 8 + aiCount * 4 + userCount * 2 + result.messages.length;
  }

  private normalizeSessionId(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.trim();
    if (normalized.length < 8) return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) return null;
    if (INVALID_SESSION_IDS.has(normalized.toLowerCase())) return null;
    return normalized;
  }

  private logStats(stats: ParserStats, messages: ParsedMessage[]): void {
    logger.info("parser", "Gemini parse stats", stats);

    if (messages.length === 0) return;

    const hasSingleRole = stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;
    if (hasSingleRole) {
      logger.warn("parser", "Gemini parser captured only one role", {
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}
