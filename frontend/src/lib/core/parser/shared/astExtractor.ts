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

const LANGUAGE_TOKEN_PATTERN = /^[a-z0-9+#.-]{1,24}$/i;
const LANGUAGE_NOISE_TOKENS = new Set([
  "copy",
  "copied",
  "code",
  "plain",
  "plaintext",
  "text",
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

function normalizeLanguageToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const prefixed = normalized.match(/^(?:language|lang)[:_\-\s]*([a-z0-9+#.-]{1,24})$/i);
  if (prefixed?.[1]) {
    const token = prefixed[1].toLowerCase();
    return LANGUAGE_NOISE_TOKENS.has(token) ? null : token;
  }

  if (!LANGUAGE_TOKEN_PATTERN.test(normalized)) {
    return null;
  }

  if (LANGUAGE_NOISE_TOKENS.has(normalized)) {
    return null;
  }

  return normalized;
}

function collectLanguageHintFromElement(element: Element): string | null {
  const attrCandidates = [
    element.getAttribute("data-language"),
    element.getAttribute("data-lang"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
  ];

  for (const candidate of attrCandidates) {
    const token = normalizeLanguageToken(candidate);
    if (token) return token;
  }

  const className = element.className?.toString() ?? "";
  const classLanguage = parseLanguageFromClassName(className);
  if (classLanguage) {
    const token = normalizeLanguageToken(classLanguage);
    if (token) return token;
  }

  const textHint = normalizeInlineText(element.textContent ?? "").trim();
  if (
    element.children.length === 0 &&
    textHint.length > 0 &&
    textHint.length <= 24 &&
    !textHint.includes(" ")
  ) {
    const token = normalizeLanguageToken(textHint);
    if (token) return token;
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
    const token = normalizeLanguageToken(candidate);
    if (token) return token;
  }

  const classCandidates = [codeEl?.className?.toString() ?? "", preEl.className?.toString() ?? ""];
  for (const candidate of classCandidates) {
    const language = parseLanguageFromClassName(candidate);
    const token = normalizeLanguageToken(language);
    if (token) return token;
  }

  const nearby = new Set<Element>();
  const parent = preEl.parentElement;
  if (parent) {
    nearby.add(parent);
    if (parent.previousElementSibling) nearby.add(parent.previousElementSibling);
    if (parent.nextElementSibling) nearby.add(parent.nextElementSibling);
    for (const child of Array.from(parent.children)) {
      if (child !== preEl && child !== codeEl) {
        nearby.add(child);
      }
    }
  }

  const wrapper =
    preEl.closest("figure, [class*='code'], [class*='Code'], [data-language], [data-lang]") ??
    codeEl?.closest("figure, [class*='code'], [class*='Code'], [data-language], [data-lang]");
  if (wrapper) {
    nearby.add(wrapper);
    for (const child of Array.from(wrapper.children)) {
      if (child !== preEl && child !== codeEl) {
        nearby.add(child);
      }
    }
  }

  for (const element of nearby) {
    const token = collectLanguageHintFromElement(element);
    if (token) return token;
  }

  return null;
}

function getLanguageLeakToken(node: AstNode): string | null {
  if (node.type === "text") {
    return normalizeLanguageToken(node.text);
  }

  if (node.type !== "p") {
    return null;
  }

  const value = node.children
    .map((child) => {
      if (child.type === "text") return child.text;
      if (child.type === "br") return " ";
      if (child.type === "strong" || child.type === "em" || child.type === "fragment") {
        return child.children
          .map((nested) => (nested.type === "text" ? nested.text : ""))
          .join(" ");
      }
      return "";
    })
    .join(" ");

  return normalizeLanguageToken(normalizeInlineText(value).trim());
}

function sanitizeLanguageLeakageInNodes(nodes: AstNode[]): AstNode[] {
  const sanitized = nodes.map((node) => {
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
      return {
        ...node,
        children: sanitizeLanguageLeakageInNodes(node.children),
      };
    }
    return node;
  });

  const result: AstNode[] = [];
  for (let i = 0; i < sanitized.length; i += 1) {
    const current = sanitized[i];
    const next = sanitized[i + 1];

    if (next?.type === "code_block") {
      const codeLanguage = normalizeLanguageToken(next.language ?? null);
      const leakToken = current ? getLanguageLeakToken(current) : null;
      if (codeLanguage && leakToken && leakToken === codeLanguage) {
        continue;
      }
    }

    result.push(current);
  }

  return result;
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
    const cleaned = sanitizeLanguageLeakageInNodes(compacted);
    const root: AstRoot | null =
      cleaned.length > 0
        ? {
            type: "root",
            children: cleaned,
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
