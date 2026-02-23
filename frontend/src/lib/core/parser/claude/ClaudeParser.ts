import type { IParser, ParsedMessage } from "../IParser";
import type { Platform } from "../../../types";
import {
  closestAnySelector,
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
  userPrimaryNodes: ["[data-testid='user-message']", "[data-testid*='user-message']"],
  roleAnchors: [
    "[data-author='user']",
    "[data-author='human']",
    "[data-author='assistant']",
    "[data-message-author-role='user']",
    "[data-message-author-role='assistant']",
    "[data-testid*='user-message']",
    "[data-testid*='human-message']",
    "[data-testid*='assistant-message']",
    "[data-testid*='assistant']",
    "[data-testid*='claude-message']",
    "[data-testid*='model-message']",
    "[data-testid*='response-message']",
    "[class*='user-message']",
    "[class*='font-user-message']",
    "[class*='claude-message']",
    "[class*='font-claude-message']",
  ],
  copyActionAnchors: ["[data-testid='action-bar-copy']"],
  messageContainers: [
    "main [data-testid*='message']",
    "main [data-testid*='conversation']",
    "main article",
    "main [role='listitem']",
    "main [class*='message']",
    "main [class*='claude-message']",
    "main [class*='font-user-message']",
  ],
  roleAncestorHints: ["[data-author]", "[data-message-author-role]", "[data-testid]"],
  messageContent: [
    "[data-testid*='message-content']",
    "[data-testid='user-message']",
    ".markdown",
    ".prose",
    "[class*='font-claude-response-body']",
    "div[class*='whitespace-pre-wrap']",
    "div[class*='font-claude-message']",
    "div[class*='font-user-message']",
  ],
  aiContentLeaves: [
    "[class*='font-claude-response-body']",
    "[data-testid*='assistant-message'] .markdown",
    "[data-testid*='assistant-message'] .prose",
  ],
  title: ["nav h1", "h1", "title"],
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='stream']",
    ".typing",
    ".cursor",
  ],
  noiseContainers: [
    "form",
    "footer",
    "nav",
    "[role='navigation']",
    "[data-testid*='composer']",
    "[data-testid*='chat-input']",
    "[data-testid='chat-input']",
    "[contenteditable='true']",
  ],
  noiseTextPatterns: [
    /^new chat$/i,
    /^search chats$/i,
    /^retry$/i,
    /^edit$/i,
    /^copy$/i,
    /^message copied$/i,
    /^thought for\s+\d+s/i,
    /^claude can make mistakes\.?/i,
  ],
  sourceTimes: ["main time[datetime]", "article time[datetime]"],
};

const TITLE_PLATFORM_SUFFIX_PATTERN =
  /\s*[-–—]\s*(ChatGPT|Claude|Gemini|DeepSeek|Qwen|Doubao)\s*$/i;

type MessageRole = "user" | "ai";

type ExtractionSource = "anchor" | "selector";

interface ParserStats {
  source: ExtractionSource;
  totalCandidates: number;
  keptMessages: number;
  roleDistribution: Record<MessageRole, number>;
  droppedUnknownRole: number;
  droppedNoise: number;
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
  messages: ParsedMessage[];
  totalCandidates: number;
  droppedUnknownRole: number;
  droppedNoise: number;
  degradedNodesCount: number;
  astNodeCount: number;
}

interface ParsedNodeResult {
  message: ParsedMessage;
  degradedNodesCount: number;
  astNodeCount: number;
}

export class ClaudeParser implements IParser {
  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("claude.ai")) {
      return "Claude";
    }
    return null;
  }

  getConversationTitle(): string {
    const titleEl = queryFirst(SELECTORS.title);
    const title = this.cleanTitle(safeTextContent(titleEl));
    if (title) return title;

    const fallbackTitle = this.cleanTitle(document.title || "");
    if (fallbackTitle) return fallbackTitle;

    return "Untitled Conversation";
  }

  getMessages(): ParsedMessage[] {
    const startedAt = performance.now();
    const perfMode = astPerfModeController.getMode("Claude");
    const anchorExtraction = this.extractUsingAnchorStrategy(perfMode);
    const selectorExtraction = this.extractUsingSelectorStrategy(perfMode);
    const chosen = this.chooseBestExtraction(anchorExtraction, selectorExtraction);

    const dedupedMessages = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("Claude", parseDurationMs);

    const stats: ParserStats = {
      source: chosen.source,
      totalCandidates: chosen.totalCandidates,
      keptMessages: dedupedMessages.length,
      roleDistribution: { user: 0, ai: 0 },
      droppedUnknownRole: chosen.droppedUnknownRole,
      droppedNoise: chosen.droppedNoise + (chosen.messages.length - dedupedMessages.length),
      parse_duration_ms: parseDurationMs,
      perf_mode: perfMode,
      next_perf_mode: modeUpdate.mode,
      degraded_nodes_count: chosen.degradedNodesCount,
      ast_node_count: chosen.astNodeCount,
      message_count: dedupedMessages.length,
      platform: "Claude",
    };

    if (modeUpdate.switched) {
      logger.warn("parser", "Claude AST perf mode switched", {
        platform: "Claude",
        from: modeUpdate.previousMode,
        to: modeUpdate.mode,
        parse_duration_ms: parseDurationMs,
        message_count: dedupedMessages.length,
      });
    }

    for (const message of dedupedMessages) {
      stats.roleDistribution[message.role] += 1;
    }

    this.logStats(stats, dedupedMessages);
    return dedupedMessages;
  }

  isGenerating(): boolean {
    return queryFirst(SELECTORS.generating) !== null;
  }

  getSessionUUID(): string | null {
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/);
    if (match && match[1]) return match[1];
    return null;
  }

  getSourceCreatedAt(): number | null {
    return extractEarliestTimeFromSelectors(SELECTORS.sourceTimes);
  }

  private extractUsingAnchorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const userNodes = queryAllUnique(SELECTORS.userPrimaryNodes);
    if (userNodes.length === 0) {
      return {
        source: "anchor",
        messages: [],
        totalCandidates: 0,
        droppedUnknownRole: 0,
        droppedNoise: 0,
        degradedNodesCount: 0,
        astNodeCount: 0,
      };
    }

    const container = this.findFlowContainer(userNodes);
    if (!container) {
      return {
        source: "anchor",
        messages: [],
        totalCandidates: userNodes.length,
        droppedUnknownRole: 0,
        droppedNoise: 0,
        degradedNodesCount: 0,
        astNodeCount: 0,
      };
    }

    const blocks = Array.from(container.children);
    const messages: ParsedMessage[] = [];
    let droppedNoise = 0;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const block of blocks) {
      if (!(block instanceof Element)) {
        droppedNoise += 1;
        continue;
      }

      if (!this.isMessageBlockCandidate(block)) {
        droppedNoise += 1;
        continue;
      }

      const role: MessageRole = this.hasUserMarker(block) ? "user" : "ai";
      const textContent = this.extractMessageText(block, role);
      if (!textContent) {
        droppedNoise += 1;
        continue;
      }

      const contentEl = this.resolveContentElement(block, role);

      const parsed = this.buildParsedNode(
        role,
        textContent,
        contentEl,
        block,
        perfMode,
      );

      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "anchor",
      messages,
      totalCandidates: blocks.length,
      droppedUnknownRole: 0,
      droppedNoise,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private findFlowContainer(userNodes: Element[]): Element | null {
    const firstUser = userNodes[0];
    if (!firstUser) return null;

    const main = document.querySelector("main");
    let current = firstUser.parentElement;
    let bestNode: Element | null = null;
    let bestScore = -1;

    while (current && current !== document.body) {
      if (main && !main.contains(current)) {
        current = current.parentElement;
        continue;
      }

      const children = Array.from(current.children);
      if (children.length < 2) {
        current = current.parentElement;
        continue;
      }

      const coveredUsers = userNodes.filter((node) => current!.contains(node)).length;
      if (coveredUsers === 0) {
        current = current.parentElement;
        continue;
      }

      const userChildren = children.filter((child) => this.hasUserMarker(child)).length;
      const messageLikeChildren = children.filter((child) => this.isMessageBlockCandidate(child)).length;
      const nonUserMessageChildren = children.filter(
        (child) => this.isMessageBlockCandidate(child) && !this.hasUserMarker(child),
      ).length;

      if (userChildren === 0 || messageLikeChildren < 2) {
        current = current.parentElement;
        continue;
      }

      const score =
        coveredUsers * 10 +
        userChildren * 6 +
        nonUserMessageChildren * 5 +
        messageLikeChildren -
        Math.abs(children.length - messageLikeChildren);

      if (score > bestScore) {
        bestScore = score;
        bestNode = current;
      }

      current = current.parentElement;
    }

    return bestNode;
  }

  private isMessageBlockCandidate(node: Element): boolean {
    if (SELECTORS.noiseContainers.some((selector) => node.matches(selector))) {
      return false;
    }

    const textContent = this.cleanExtractedText(safeTextContent(node));
    if (!textContent || textContent.length < 4) {
      return false;
    }

    if (SELECTORS.noiseTextPatterns.some((pattern) => pattern.test(textContent))) {
      return false;
    }

    if (node instanceof HTMLElement && node.offsetHeight < 5) {
      return false;
    }

    return true;
  }

  private hasUserMarker(node: Element): boolean {
    const userSelector = SELECTORS.userPrimaryNodes.join(", ");
    return node.matches(userSelector) || node.querySelector(userSelector) !== null;
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
      messages,
      totalCandidates: rawCandidates.length,
      droppedUnknownRole,
      droppedNoise,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private chooseBestExtraction(anchor: ExtractionResult, selector: ExtractionResult): ExtractionResult {
    const anchorScore = this.scoreExtraction(anchor);
    const selectorScore = this.scoreExtraction(selector);

    if (anchorScore === 0 && selectorScore === 0) {
      return anchor;
    }

    if (anchorScore > selectorScore) {
      return anchor;
    }

    if (selectorScore > anchorScore) {
      return selector;
    }

    return anchor.messages.length >= selector.messages.length ? anchor : selector;
  }

  private scoreExtraction(result: ExtractionResult): number {
    if (result.messages.length === 0) return 0;

    const userCount = result.messages.filter((message) => message.role === "user").length;
    const aiCount = result.messages.length - userCount;
    const balancedPairs = Math.min(userCount, aiCount);

    return balancedPairs * 8 + aiCount * 4 + userCount * 2 + result.messages.length;
  }

  private collectMessageCandidates(): Element[] {
    const combinedCandidates: Element[] = [...queryAllUnique(SELECTORS.roleAnchors)];

    combinedCandidates.push(...this.collectCopyActionCandidates());

    for (const containerNode of queryAllUnique(SELECTORS.messageContainers)) {
      const splitNodes = queryAllWithinUnique(containerNode, SELECTORS.roleAnchors);
      if (splitNodes.length > 0) {
        combinedCandidates.push(...splitNodes);
        continue;
      }
      combinedCandidates.push(containerNode);
    }

    return uniqueNodesInDocumentOrder(combinedCandidates);
  }

  private collectCopyActionCandidates(): Element[] {
    const actionAnchors = queryAllUnique(SELECTORS.copyActionAnchors);
    const resolvedNodes: Element[] = [];

    for (const anchor of actionAnchors) {
      const resolved = this.resolveActionAnchorMessageNode(anchor);
      if (resolved) {
        resolvedNodes.push(resolved);
      }
    }

    const nodesBySignature = new Map<string, Element>();
    for (const node of uniqueNodesInDocumentOrder(resolvedNodes)) {
      const text = this.extractMessageText(node, "ai");
      if (!text) {
        continue;
      }

      const signature = `${text.slice(0, 220)}::${text.length}`;
      if (!nodesBySignature.has(signature)) {
        nodesBySignature.set(signature, node);
      }
    }

    return uniqueNodesInDocumentOrder(nodesBySignature.values());
  }

  private resolveActionAnchorMessageNode(anchor: Element): Element | null {
    let current: Element | null = anchor.parentElement;

    while (current) {
      if (SELECTORS.noiseContainers.some((selector) => current?.matches(selector))) {
        return null;
      }

      const text = this.extractMessageText(current, "ai");
      if (text.length < 12 || text.length > 12000) {
        current = current.parentElement;
        continue;
      }

      const hasUserMarker = this.hasUserMarker(current);
      if (hasUserMarker) {
        current = current.parentElement;
        continue;
      }

      const hasCopyAction =
        current.querySelector("[data-testid='action-bar-copy']") !== null ||
        current.matches("[data-testid='action-bar-copy']");

      if (hasCopyAction) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  private parseMessageNode(node: Element, perfMode: AstPerfMode): ParsedNodeResult | null {
    const role = this.inferRole(node);
    if (!role) return null;

    const textContent = this.extractMessageText(node, role);
    if (!textContent) {
      return null;
    }

    const contentEl = this.resolveContentElement(node, role);

    return this.buildParsedNode(
      role,
      textContent,
      contentEl,
      node,
      perfMode,
    );
  }

  private buildParsedNode(
    role: MessageRole,
    textContent: string,
    contentEl: Element | null,
    node: Element,
    perfMode: AstPerfMode,
  ): ParsedNodeResult {
    const ast = extractAstFromElement(contentEl ?? node, {
      platform: "Claude",
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

  private resolveContentElement(node: Element, role: MessageRole): Element | null {
    if (role === "user") {
      return (
        queryFirstWithin(node, SELECTORS.userPrimaryNodes) ||
        queryFirstWithin(node, SELECTORS.messageContent)
      );
    }

    const aiLeafNodes = queryAllWithinUnique(node, SELECTORS.aiContentLeaves);
    if (aiLeafNodes.length > 1) {
      return this.findSharedContentContainer(aiLeafNodes, node) ?? node;
    }
    if (aiLeafNodes.length === 1) {
      return aiLeafNodes[0];
    }

    return queryFirstWithin(node, SELECTORS.messageContent);
  }

  private findSharedContentContainer(nodes: Element[], boundary: Element): Element | null {
    const first = nodes[0];
    if (!first) return null;

    let current: Element | null = first;
    while (current && boundary.contains(current)) {
      const containsAll = nodes.every((node) => current?.contains(node));
      if (containsAll) {
        if (!SELECTORS.noiseContainers.some((selector) => current?.matches(selector))) {
          return current;
        }
      }

      if (current === boundary) {
        break;
      }
      current = current.parentElement;
    }

    return boundary;
  }

  private extractMessageText(node: Element, role: MessageRole): string {
    const contentNode = this.resolveContentElement(node, role);

    const rawText = safeTextContent(contentNode ?? node);
    return this.cleanExtractedText(rawText);
  }

  private inferRole(node: Element): MessageRole | null {
    const directRole = this.roleFromNodeAttributes(node);
    if (directRole) return directRole;

    const classRole = this.roleFromClassName(node.className?.toString() || "");
    if (classRole) return classRole;

    const testIdRole = this.roleFromTestId(node.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    if (this.hasUserMarker(node)) return "user";

    const hasCopyAction = node.querySelector("[data-testid='action-bar-copy']") !== null;
    if (hasCopyAction) {
      return "ai";
    }

    const aiDescendant = node.querySelector(
      "[data-testid*='assistant-message'], [data-testid*='claude-message'], [class*='claude-message']",
    );
    if (aiDescendant) return "ai";

    const ancestor = node.parentElement
      ? closestAnySelector(node.parentElement, SELECTORS.roleAncestorHints)
      : null;
    if (ancestor) {
      const ancestorRole = this.roleFromNodeAttributes(ancestor);
      if (ancestorRole) return ancestorRole;

      const ancestorClassRole = this.roleFromClassName(ancestor.className?.toString() || "");
      if (ancestorClassRole) return ancestorClassRole;

      const ancestorTestIdRole = this.roleFromTestId(ancestor.getAttribute("data-testid"));
      if (ancestorTestIdRole) return ancestorTestIdRole;
    }

    return null;
  }

  private roleFromNodeAttributes(node: Element): MessageRole | null {
    const author = this.roleFromAttribute(node.getAttribute("data-author"));
    if (author) return author;

    return this.roleFromAttribute(node.getAttribute("data-message-author-role"));
  }

  private roleFromAttribute(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "user" || normalized === "human") return "user";
    if (normalized === "assistant" || normalized === "ai" || normalized === "claude") {
      return "ai";
    }
    return null;
  }

  private roleFromClassName(value: string): MessageRole | null {
    const normalized = value.toLowerCase();
    if (!normalized) return null;

    if (normalized.includes("user-message")) return "user";
    if (normalized.includes("claude-message") || normalized.includes("assistant-message")) {
      return "ai";
    }

    return null;
  }

  private roleFromTestId(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();

    if (/(^|[-_:])(user|human)([-_:]|$)/.test(normalized)) return "user";
    if (/(^|[-_:])(assistant|claude|model|ai|response)([-_:]|$)/.test(normalized)) {
      return "ai";
    }

    if (normalized.includes("user") || normalized.includes("human")) return "user";
    if (
      normalized.includes("assistant") ||
      normalized.includes("claude") ||
      normalized.includes("model") ||
      normalized.includes("response")
    ) {
      return "ai";
    }

    return null;
  }

  private cleanExtractedText(rawText: string): string {
    let text = rawText;

    text = text.replace(/^Thought for\s+\d+s[\s\S]*?Show more\s*Done\s*/i, "");
    text = text.replace(/^Thought for\s+\d+s\s*/i, "");
    text = text.replace(/^Show more\s*Done\s*/i, "");

    text = text
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^(Copy|Edit|Retry)\s+/i, "")
      .trim();

    return text;
  }

  private cleanTitle(rawTitle: string): string {
    return rawTitle
      .replace(/\s+/g, " ")
      .replace(TITLE_PLATFORM_SUFFIX_PATTERN, "")
      .trim();
  }

  private dedupeNearDuplicates(messages: ParsedMessage[]): ParsedMessage[] {
    const deduped: ParsedMessage[] = [];

    for (const message of messages) {
      const signature = `${message.role}|${message.textContent.replace(/\s+/g, " ").trim()}`;
      const isRecentDuplicate = deduped
        .slice(Math.max(0, deduped.length - 2))
        .some((existing) => {
          const existingSignature = `${existing.role}|${existing.textContent
            .replace(/\s+/g, " ")
            .trim()}`;
          return existingSignature === signature;
        });

      if (!isRecentDuplicate) {
        deduped.push(message);
      }
    }

    return deduped;
  }

  private logStats(stats: ParserStats, messages: ParsedMessage[]): void {
    logger.info("parser", "Claude parse stats", stats);

    if (messages.length === 0) return;

    const hasSingleRole =
      stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;

    if (hasSingleRole) {
      logger.warn("parser", "Claude parser captured only one role", {
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}
