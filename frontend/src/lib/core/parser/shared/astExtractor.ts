import type { Platform } from "../../../types";
import type {
  AstBlockquoteNode,
  AstEmphasisNode,
  AstHeadingNode,
  AstListItemNode,
  AstNode,
  AstParagraphNode,
  AstRoot,
  AstStrongNode,
  AstTextNode,
} from "../../../types/ast";
import type { AstPerfMode } from "./astPerfMode";
import { isLikelyMathElement, probeMathTex } from "./astMathProbes";
import { extractTableNode } from "./astTableExtractor";

const P1_SUPPORTED_PLATFORMS: ReadonlySet<Platform> = new Set([
  "ChatGPT",
  "Claude",
  "Gemini",
]);

const SKIP_TAGS = new Set([
  "style",
  "noscript",
  "template",
  "svg",
  "path",
  "canvas",
  "iframe",
]);

export interface AstExtractionOptions {
  platform: Platform;
  perfMode: AstPerfMode;
}

export interface AstExtractionResult {
  root: AstRoot | null;
  degradedNodesCount: number;
  astNodeCount: number;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
}

function normalizeFallbackText(value: string): string {
  return normalizeInlineText(value).trim();
}

function normalizeCodeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trimEnd();
}

function compactNodes(nodes: AstNode[]): AstNode[] {
  const compacted: AstNode[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      const normalized = node.text;
      if (normalized.trim().length === 0) {
        continue;
      }

      const previous = compacted[compacted.length - 1];
      if (previous && previous.type === "text") {
        previous.text += normalized;
      } else {
        compacted.push({ type: "text", text: normalized });
      }
      continue;
    }

    compacted.push(node);
  }

  const first = compacted[0];
  if (first?.type === "text") {
    first.text = first.text.trimStart();
    if (!first.text) {
      compacted.shift();
    }
  }

  const last = compacted[compacted.length - 1];
  if (last?.type === "text") {
    last.text = last.text.trimEnd();
    if (!last.text) {
      compacted.pop();
    }
  }

  return compacted;
}

function countAstNodes(nodes: AstNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
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
      count += countAstNodes(node.children);
    }
  }
  return count;
}

function parseLanguageFromClassName(value: string): string | null {
  const classTokens = value.split(/\s+/).filter(Boolean);
  for (const token of classTokens) {
    const normalized = token.toLowerCase();
    const languageMatch = normalized.match(/(?:^|[-_])(language|lang)[-_]?([a-z0-9+#.-]+)/i);
    if (languageMatch?.[2]) {
      return languageMatch[2];
    }
  }
  return null;
}

function inferCodeLanguage(preEl: Element, codeEl: Element | null): string | null {
  const attrCandidates = [
    codeEl?.getAttribute("data-language"),
    codeEl?.getAttribute("data-lang"),
    preEl.getAttribute("data-language"),
    preEl.getAttribute("data-lang"),
  ];

  for (const candidate of attrCandidates) {
    if (candidate && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const classCandidates = [codeEl?.className?.toString() ?? "", preEl.className?.toString() ?? ""];
  for (const candidate of classCandidates) {
    const language = parseLanguageFromClassName(candidate);
    if (language) return language;
  }

  return null;
}

class AstExtractor {
  private readonly p1Enabled: boolean;
  private degradedNodesCount = 0;

  constructor(
    private readonly rootElement: Element,
    private readonly options: AstExtractionOptions,
  ) {
    this.p1Enabled =
      options.perfMode === "full" && P1_SUPPORTED_PLATFORMS.has(options.platform);
  }

  run(): AstExtractionResult {
    let children = this.parseChildNodes(this.rootElement.childNodes);
    if (children.length === 0) {
      children = this.parseNode(this.rootElement);
    }

    const compacted = compactNodes(children);
    const root: AstRoot | null =
      compacted.length > 0
        ? {
            type: "root",
            children: compacted,
          }
        : null;

    return {
      root,
      degradedNodesCount: this.degradedNodesCount,
      astNodeCount: root ? countAstNodes(root.children) : 0,
    };
  }

  private parseChildNodes(nodes: NodeListOf<ChildNode> | ChildNode[]): AstNode[] {
    const parsed: AstNode[] = [];
    for (const node of Array.from(nodes)) {
      parsed.push(...this.parseNode(node));
    }
    return compactNodes(parsed);
  }

  private parseNode(node: Node): AstNode[] {
    if (node.nodeType === Node.TEXT_NODE) {
      return this.parseTextNode(node as Text);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }
    return this.parseElement(node as Element);
  }

  private parseTextNode(node: Text): AstTextNode[] {
    const raw = node.nodeValue ?? "";
    const normalized = normalizeInlineText(raw);
    if (normalized.trim().length === 0) {
      return [];
    }
    return [{ type: "text", text: normalized }];
  }

  private parseElement(element: Element): AstNode[] {
    const tag = element.tagName.toLowerCase();

    if (this.p1Enabled && !this.isInsideCode(element) && isLikelyMathElement(element, this.options.platform)) {
      return this.extractMathNode(element);
    }

    if (tag === "table") {
      if (this.p1Enabled) {
        return this.extractTable(element);
      }
      return this.fallbackToText(element, true);
    }

    if (!this.p1Enabled && !this.isInsideCode(element) && isLikelyMathElement(element, this.options.platform)) {
      return this.fallbackToText(element, true);
    }

    if (SKIP_TAGS.has(tag)) {
      return [];
    }

    if (
      tag === "script" &&
      element.getAttribute("type") !== "math/tex"
    ) {
      return [];
    }

    if (element.getAttribute("aria-hidden") === "true") {
      return [];
    }

    switch (tag) {
      case "br":
        return [{ type: "br" }];
      case "p":
        return this.wrapContainerNode<AstParagraphNode>("p", element);
      case "h1":
      case "h2":
      case "h3":
        return this.wrapContainerNode<AstHeadingNode>(tag, element);
      case "strong":
      case "b":
        return this.wrapContainerNode<AstStrongNode>("strong", element);
      case "em":
      case "i":
        return this.wrapContainerNode<AstEmphasisNode>("em", element);
      case "blockquote":
        return this.wrapContainerNode<AstBlockquoteNode>("blockquote", element);
      case "ul":
      case "ol":
        return this.extractList(element, tag);
      case "li":
        return this.extractListItem(element);
      case "pre":
        return this.extractCodeBlock(element);
      case "code":
        if (element.closest("pre")) {
          return [];
        }
        return this.extractInlineCode(element);
      default: {
        const transparentChildren = this.parseChildNodes(element.childNodes);
        if (transparentChildren.length > 0) {
          return transparentChildren;
        }
        return this.fallbackToText(element);
      }
    }
  }

  private wrapContainerNode<T extends AstNode & { children: AstNode[] }>(
    type: T["type"],
    element: Element,
  ): T[] {
    const children = this.parseChildNodes(element.childNodes);
    if (children.length > 0) {
      return [{ type, children } as T];
    }

    const textFallback = normalizeFallbackText(element.textContent ?? "");
    if (!textFallback) {
      return [];
    }

    return [
      {
        type,
        children: [{ type: "text", text: textFallback }],
      } as T,
    ];
  }

  private extractList(element: Element, tag: "ul" | "ol"): AstNode[] {
    const items: AstListItemNode[] = [];

    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === "li") {
        const itemNode = this.parseListItemNode(child as Element);
        if (itemNode) {
          items.push(itemNode);
        }
        continue;
      }

      const fallbackChildren = this.parseNode(child);
      if (fallbackChildren.length > 0) {
        items.push({
          type: "li",
          children: compactNodes(fallbackChildren),
        });
      }
    }

    if (items.length === 0) {
      return this.fallbackToText(element, true);
    }

    return [
      {
        type: tag,
        children: items,
      },
    ];
  }

  private extractListItem(element: Element): AstListItemNode[] {
    const item = this.parseListItemNode(element);
    return item ? [item] : [];
  }

  private parseListItemNode(element: Element): AstListItemNode | null {
    const children = this.parseChildNodes(element.childNodes);
    if (children.length > 0) {
      return {
        type: "li",
        children,
      };
    }

    const fallback = normalizeFallbackText(element.textContent ?? "");
    if (!fallback) {
      return null;
    }

    return {
      type: "li",
      children: [{ type: "text", text: fallback }],
    };
  }

  private extractInlineCode(element: Element): AstNode[] {
    const text = normalizeCodeText(element.textContent ?? "");
    if (!text.trim()) {
      return [];
    }
    return [{ type: "code_inline", text: text.trim() }];
  }

  private extractCodeBlock(element: Element): AstNode[] {
    try {
      const codeEl = element.querySelector("code");
      const source = codeEl ?? element;
      const code = normalizeCodeText(source.textContent ?? "");
      if (!code.trim()) {
        return [];
      }

      return [
        {
          type: "code_block",
          code,
          language: inferCodeLanguage(element, codeEl),
        },
      ];
    } catch {
      return this.fallbackToText(element, true);
    }
  }

  private extractTable(element: Element): AstNode[] {
    try {
      const tableNode = extractTableNode(element);
      if (!tableNode) {
        return this.fallbackToText(element, true);
      }
      return [tableNode];
    } catch {
      return this.fallbackToText(element, true);
    }
  }

  private extractMathNode(element: Element): AstNode[] {
    try {
      const math = probeMathTex(element, this.options.platform);
      if (!math || !math.tex.trim()) {
        return this.fallbackToText(element, true);
      }

      return [
        {
          type: "math",
          tex: math.tex,
          display: math.display || undefined,
        },
      ];
    } catch {
      return this.fallbackToText(element, true);
    }
  }

  private fallbackToText(element: Element, countAsDegraded = false): AstTextNode[] {
    const text = normalizeFallbackText(element.textContent ?? "");
    if (!text) {
      return [];
    }

    if (countAsDegraded) {
      this.degradedNodesCount += 1;
    }

    return [{ type: "text", text }];
  }

  private isInsideCode(element: Element): boolean {
    const parent = element.parentElement;
    return parent ? parent.closest("pre, code") !== null : false;
  }
}

export function extractAstFromElement(
  element: Element,
  options: AstExtractionOptions,
): AstExtractionResult {
  const extractor = new AstExtractor(element, options);
  return extractor.run();
}
