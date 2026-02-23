import type { IParser, ParsedMessage } from "../IParser";
import type { Platform } from "../../../types";
import {
  extractEarliestTimeFromSelectors,
  normalizeCandidateNodes,
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
    ".questionItem",
    ".bubble-element",
    "[data-role='user']",
    "[data-role='assistant']",
    "[data-author='user']",
    "[data-author='assistant']",
    "[data-message-author-role='user']",
    "[data-message-author-role='assistant']",
    "[class*='user-message']",
    "[class*='assistant-message']",
    "[data-testid*='message']",
  ],
  turnBlocks: [
    "[data-msgid]",
    "[data-message-id]",
    ".chat-message-item",
    "[class*='message-item']",
    "[class*='message-row']",
    "[class*='message-block']",
    "article",
    "[role='listitem']",
  ],
  messageContent: [
    ".bubble-element",
    "[class*='bubble']",
    "[data-testid*='message-content']",
    "[data-testid*='response-content']",
    ".markdown",
    ".prose",
    "div[class*='markdown']",
    "div[class*='content']",
  ],
  title: [
    ".conversation-title",
    ".chat-title",
    ".session-title",
    ".header-title",
    "[role='heading']",
    "h1",
    "title",
  ],
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='stream']",
    "[data-testid*='typing']",
    "[class*='typing']",
    "[class*='stream']",
  ],
  noiseContainers: [
    "form",
    "footer",
    "nav",
    "aside",
    "[role='complementary']",
    "[role='navigation']",
    "[class*='history']",
    "[class*='sidebar']",
    "[class*='session-list']",
    "[id*='history']",
    "[id*='sidebar']",
    "[data-testid*='composer']",
    "[contenteditable='true']",
  ],
  noiseTextPatterns: [
    /^new chat$/i,
    /^retry$/i,
    /^edit$/i,
    /^copy$/i,
    /^qwen can make mistakes\.?/i,
  ],
  sourceTimes: ["time[datetime]", "article time[datetime]"],
};

const ROOT_SELECTORS = [
  "main",
  "[role='main']",
  "[class*='chat-window']",
  "[class*='thread']",
  "[class*='conversation-content']",
  "[class*='conversation']",
];

const ROOT_MESSAGE_HINTS = [
  ".questionItem",
  ".bubble-element",
  "[data-role='user']",
  "[data-role='assistant']",
  "[data-message-author-role='assistant']",
  "[data-testid*='message']",
];

const ROOT_HISTORY_KEYWORDS = [
  "history",
  "sidebar",
  "session-list",
  "conversation-list",
  "menu-list",
];

const TITLE_USER_SELECTORS = [
  ".questionItem",
  "[data-role='user']",
  "[data-author='user']",
  "[data-message-author-role='user']",
  "[class*='user-message']",
  "[class*='question']",
  "[data-testid*='user-message']",
  "[data-testid*='question']",
];

const SESSION_ID_QUERY_KEYS = [
  "conversation",
  "conversation_id",
  "chat",
  "chat_id",
  "session",
  "session_id",
  "id",
];

const SESSION_ID_PATTERNS = [
  /\/c\/([a-zA-Z0-9_-]{8,})/i,
  /\/chat\/([a-zA-Z0-9_-]{8,})/i,
  /\/conversation\/([a-zA-Z0-9_-]{8,})/i,
];

const INVALID_SESSION_IDS = new Set([
  "chat",
  "new",
  "conversation",
  "session",
  "search",
  "history",
]);
const INVALID_TITLES = new Set(["qwen chat", "qwen", "download app", "qwen3-max"]);
const MAX_TITLE_LENGTH = 120;
const TITLE_BOUNDARY_CHARS = ["\u3002", "\uff01", "\uff1f", "!", "?", "."];

type MessageRole = "user" | "ai";
type ExtractionSource = "selector" | "anchor";

interface ParserStats {
  source: ExtractionSource;
  totalCandidates: number;
  keptMessages: number;
  roleDistribution: Record<MessageRole, number>;
  droppedNoise: number;
  droppedUnknownRole: number;
  rootSelector: string;
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

export class QwenParser implements IParser {
  private latestMessages: ParsedMessage[] = [];

  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("chat.qwen.ai")) {
      return "Qwen";
    }
    return null;
  }

  getConversationTitle(): string {
    const messageTitle = this.buildTitleFromFirstUserMessage();
    if (messageTitle) return messageTitle;

    const documentTitle = this.toConciseTitle(document.title || "");
    if (this.isUsableDocumentTitle(documentTitle)) {
      return documentTitle;
    }

    const fallbackTitle = this.toConciseTitle(safeTextContent(queryFirst(SELECTORS.title)));
    if (this.isUsableDocumentTitle(fallbackTitle)) {
      return fallbackTitle;
    }

    return "Untitled Conversation";
  }

  getMessages(): ParsedMessage[] {
    const startedAt = performance.now();
    const perfMode = astPerfModeController.getMode("Qwen");
    const rootContext = this.resolveConversationRoot();
    const selectorResult = this.extractUsingSelectorStrategy(rootContext.root, perfMode);
    const anchorResult = this.extractUsingAnchorStrategy(rootContext.root, perfMode);
    const chosen = this.chooseBestExtraction(selectorResult, anchorResult);
    const deduped = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("Qwen", parseDurationMs);

    const stats: ParserStats = {
      source: chosen.source,
      totalCandidates: chosen.totalCandidates,
      keptMessages: deduped.length,
      roleDistribution: { user: 0, ai: 0 },
      droppedNoise: chosen.droppedNoise + (chosen.messages.length - deduped.length),
      droppedUnknownRole: chosen.droppedUnknownRole,
      rootSelector: rootContext.selector,
      parse_duration_ms: parseDurationMs,
      perf_mode: perfMode,
      next_perf_mode: modeUpdate.mode,
      degraded_nodes_count: chosen.degradedNodesCount,
      ast_node_count: chosen.astNodeCount,
      message_count: deduped.length,
      platform: "Qwen",
    };

    if (modeUpdate.switched) {
      logger.warn("parser", "Qwen AST perf mode switched", {
        platform: "Qwen",
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

  private extractUsingSelectorStrategy(root: Element, perfMode: AstPerfMode): ExtractionResult {
    const rawCandidates = this.collectMessageCandidates(root);
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

  private extractUsingAnchorStrategy(root: Element, perfMode: AstPerfMode): ExtractionResult {
    const anchors = this.queryAllUniqueWithin(root, SELECTORS.roleAnchors);
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
      anchors.map((anchor) => this.resolveAnchorNode(anchor)).filter(Boolean) as Element[],
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

  private collectMessageCandidates(root: Element): Element[] {
    const combinedCandidates: Element[] = [...this.queryAllUniqueWithin(root, SELECTORS.roleAnchors)];

    for (const turnNode of this.queryAllUniqueWithin(root, SELECTORS.turnBlocks)) {
      const splitNodes = queryAllWithinUnique(turnNode, SELECTORS.roleAnchors);
      if (splitNodes.length > 0) {
        combinedCandidates.push(...splitNodes);
        continue;
      }
      combinedCandidates.push(turnNode);
    }

    return uniqueNodesInDocumentOrder(combinedCandidates);
  }

  private queryAllUniqueWithin(root: Element, selectors: string[]): Element[] {
    const nodes: Element[] = [];
    for (const selector of selectors) {
      if (root.matches(selector)) {
        nodes.push(root);
      }
      root.querySelectorAll(selector).forEach((node) => nodes.push(node));
    }
    return uniqueNodesInDocumentOrder(nodes);
  }

  private resolveConversationRoot(): { root: Element; selector: string } {
    let best:
      | {
          root: Element;
          selector: string;
          score: number;
        }
      | undefined;

    for (const selector of ROOT_SELECTORS) {
      const candidates = Array.from(document.querySelectorAll(selector));
      for (const candidate of candidates) {
        const score = this.scoreConversationRoot(candidate, selector);
        if (!best || score > best.score) {
          best = { root: candidate, selector, score };
        }
      }
    }

    if (best && best.score > 0) {
      return { root: best.root, selector: best.selector };
    }

    if (document.body) {
      return { root: document.body, selector: "document.body" };
    }

    return { root: document.documentElement, selector: "document.documentElement" };
  }

  private scoreConversationRoot(root: Element, selector: string): number {
    let score = 0;

    if (selector === "main" || selector === "[role='main']") {
      score += 10;
    }

    for (const hintSelector of ROOT_MESSAGE_HINTS) {
      const matchCount = root.querySelectorAll(hintSelector).length;
      score += Math.min(matchCount, 8);
    }

    if (root.closest("aside, [role='complementary']")) {
      score -= 20;
    }

    if (this.isLikelyHistoryContainer(root)) {
      score -= 30;
    }

    return score;
  }

  private isLikelyHistoryContainer(root: Element): boolean {
    const marker = [
      root.id,
      root.className?.toString() ?? "",
      root.getAttribute("data-testid") ?? "",
      root.getAttribute("aria-label") ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return ROOT_HISTORY_KEYWORDS.some((keyword) => marker.includes(keyword));
  }

  private buildTitleFromFirstUserMessage(): string | null {
    const firstUserMessage = this.latestMessages.find(
      (message) => message.role === "user" && message.textContent.trim().length > 3,
    );
    if (firstUserMessage) {
      return this.toConciseTitle(firstUserMessage.textContent);
    }

    return this.getFirstUserMessageFromDOM();
  }

  private getFirstUserMessageFromDOM(): string | null {
    const rootContext = this.resolveConversationRoot();
    const userNodes = this.queryAllUniqueWithin(rootContext.root, TITLE_USER_SELECTORS);
    for (const node of userNodes) {
      const contentNode = queryFirstWithin(node, SELECTORS.messageContent);
      const candidate = this.toConciseTitle(safeTextContent(contentNode ?? node));
      if (candidate.length > 3) {
        return candidate;
      }
    }

    return null;
  }

  private toConciseTitle(rawTitle: string): string {
    const normalized = rawTitle.replace(/\s+/g, " ").trim();
    if (!normalized) return "";

    let boundaryIndex = -1;
    for (const boundary of TITLE_BOUNDARY_CHARS) {
      const index = normalized.indexOf(boundary);
      if (index <= 10) continue;
      if (boundaryIndex === -1 || index < boundaryIndex) {
        boundaryIndex = index;
      }
    }

    const concise = boundaryIndex >= 0 ? normalized.slice(0, boundaryIndex + 1) : normalized;
    return concise.slice(0, MAX_TITLE_LENGTH).trim();
  }

  private isUsableDocumentTitle(title: string): boolean {
    if (!title) return false;
    const normalized = title.toLowerCase();
    for (const invalidTitle of INVALID_TITLES) {
      if (normalized === invalidTitle || normalized.includes(invalidTitle)) {
        return false;
      }
    }
    return true;
  }

  private parseMessageNode(node: Element, perfMode: AstPerfMode): ParsedNodeResult | null {
    const role = this.inferRole(node);
    if (!role) return null;

    const contentEl = queryFirstWithin(node, SELECTORS.messageContent);
    const textContent = this.cleanExtractedText(safeTextContent(contentEl ?? node));
    const ast = extractAstFromElement(contentEl ?? node, {
      platform: "Qwen",
      perfMode,
    });

    return {
      message: {
        role,
        textContent,
        contentAst: ast.root,
        contentAstVersion: ast.root ? "ast_v1" : null,
        degradedNodesCount: ast.degradedNodesCount,
        htmlContent: contentEl ? contentEl.innerHTML : undefined,
      },
      degradedNodesCount: ast.degradedNodesCount,
      astNodeCount: ast.astNodeCount,
    };
  }

  private inferRole(node: Element): MessageRole | null {
    const attrRole =
      this.roleFromAttribute(node.getAttribute("data-role")) ??
      this.roleFromAttribute(node.getAttribute("data-author")) ??
      this.roleFromAttribute(node.getAttribute("data-message-author-role"));
    if (attrRole) return attrRole;

    const testIdRole = this.roleFromHint(node.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    const classRole = this.roleFromHint(node.className?.toString() ?? "");
    if (classRole) return classRole;

    const ancestor = node.parentElement?.closest("[data-role], [data-author], [data-testid], [class]");
    if (ancestor) {
      const ancestorRole =
        this.roleFromAttribute(ancestor.getAttribute("data-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-author")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-message-author-role")) ??
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
      normalized === "qwen"
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
      normalized.includes("query") ||
      normalized.includes("question")
    ) {
      return "user";
    }
    if (
      normalized.includes("assistant") ||
      normalized.includes("model") ||
      normalized.includes("qwen") ||
      normalized.includes("reply") ||
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

  private dedupeNearDuplicates(messages: ParsedMessage[]): ParsedMessage[] {
    const deduped: ParsedMessage[] = [];

    for (const message of messages) {
      const signature = `${message.role}|${message.textContent.replace(/\s+/g, " ").trim()}`;
      const isDuplicate = deduped.slice(Math.max(0, deduped.length - 2)).some((existing) => {
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
    anchorResult: ExtractionResult,
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
    logger.info("parser", "Qwen parse stats", stats);

    if (stats.totalCandidates > 200 || stats.keptMessages > 80) {
      logger.warn("parser", "Qwen parser candidate scope may be polluted", {
        rootSelector: stats.rootSelector,
        totalCandidates: stats.totalCandidates,
        keptMessages: stats.keptMessages,
        roleDistribution: stats.roleDistribution,
      });
    }

    if (messages.length === 0) {
      logger.warn("parser", "Qwen parser kept zero messages", {
        rootSelector: stats.rootSelector,
        source: stats.source,
        totalCandidates: stats.totalCandidates,
        droppedNoise: stats.droppedNoise,
        droppedUnknownRole: stats.droppedUnknownRole,
      });
      return;
    }

    const hasSingleRole = stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;
    if (hasSingleRole) {
      logger.warn("parser", "Qwen parser captured only one role", {
        rootSelector: stats.rootSelector,
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}
