import type { Platform } from "../../../types";

const PRIMARY_SELECTOR_BY_PLATFORM: Record<"ChatGPT" | "Claude" | "Gemini", string[]> = {
  ChatGPT: [
    "annotation[encoding='application/x-tex']",
    "script[type='math/tex']",
    "[data-tex]",
  ],
  Claude: [
    ".katex-mathml annotation",
    "annotation[encoding='application/x-tex']",
    "script[type='math/tex']",
  ],
  Gemini: [
    "[data-formula]",
    "script[type='math/tex']",
    "annotation[encoding='application/x-tex']",
  ],
};

const FALLBACK_INLINE_PATTERNS = [
  /\$\$([\s\S]+?)\$\$/,
  /\\\[([\s\S]+?)\\\]/,
  /\\\(([\s\S]+?)\\\)/,
];

export interface MathProbeResult {
  tex: string;
  display: boolean;
  source:
    | "annotation"
    | "script"
    | "data-formula"
    | "data-tex"
    | "regex-fallback";
}

function normalizeTex(raw: string): string {
  let tex = raw.replace(/\u00a0/g, " ").trim();
  if (!tex) return "";

  if (tex.startsWith("$$") && tex.endsWith("$$")) {
    tex = tex.slice(2, -2).trim();
  } else if (tex.startsWith("\\[") && tex.endsWith("\\]")) {
    tex = tex.slice(2, -2).trim();
  } else if (tex.startsWith("\\(") && tex.endsWith("\\)")) {
    tex = tex.slice(2, -2).trim();
  }

  return tex;
}

function inferDisplayMode(element: Element, raw: string): boolean {
  const rawTrimmed = raw.trim();
  if (
    (rawTrimmed.startsWith("$$") && rawTrimmed.endsWith("$$")) ||
    (rawTrimmed.startsWith("\\[") && rawTrimmed.endsWith("\\]"))
  ) {
    return true;
  }

  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const cls = element.className?.toString().toLowerCase() ?? "";
  if (cls.includes("katex-display") || cls.includes("math-display") || cls.includes("display")) {
    return true;
  }

  const displayAttr =
    element.getAttribute("data-display") ?? element.getAttribute("display") ?? "";
  if (/^(block|display|true|1)$/i.test(displayAttr)) {
    return true;
  }

  const tag = element.tagName.toLowerCase();
  return tag === "div" || tag === "section" || tag === "figure";
}

function querySelfOrDescendant(root: Element, selector: string): Element | null {
  if (root.matches(selector)) return root;
  return root.querySelector(selector);
}

function readAttrFromSelfOrDescendant(
  root: Element,
  selector: string,
  attributeName: string,
): string | null {
  const node = querySelfOrDescendant(root, selector);
  if (!node) return null;
  const value = node.getAttribute(attributeName);
  return value && value.trim().length > 0 ? value : null;
}

function readTextFromSelfOrDescendant(root: Element, selector: string): string | null {
  const node = querySelfOrDescendant(root, selector);
  if (!node) return null;
  const value = node.textContent ?? "";
  return value.trim().length > 0 ? value : null;
}

function extractRegexTex(rawText: string): string | null {
  for (const pattern of FALLBACK_INLINE_PATTERNS) {
    const match = rawText.match(pattern);
    if (match?.[0]) {
      return match[0];
    }
  }
  return null;
}

function matchesAnyMathMarker(element: Element, selectors: string[]): boolean {
  return selectors.some(
    (selector) =>
      element.matches(selector) || element.querySelector(selector) !== null,
  );
}

export function isLikelyMathElement(element: Element, platform: Platform): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "pre" || tag === "code" || tag === "style") {
    return false;
  }

  if (tag === "script") {
    return element.getAttribute("type") === "math/tex";
  }

  if (
    platform === "ChatGPT" ||
    platform === "Claude" ||
    platform === "Gemini"
  ) {
    const selectors = PRIMARY_SELECTOR_BY_PLATFORM[platform];
    if (matchesAnyMathMarker(element, selectors)) {
      return true;
    }
  }

  const classHint = element.className?.toString().toLowerCase() ?? "";
  if (
    classHint.includes("katex") ||
    classHint.includes("mathjax") ||
    classHint.includes("mjx") ||
    classHint.includes("math")
  ) {
    return true;
  }

  if (element.getAttribute("data-formula") || element.getAttribute("data-tex")) {
    return true;
  }

  return false;
}

function fromRaw(raw: string, element: Element, source: MathProbeResult["source"]): MathProbeResult | null {
  const tex = normalizeTex(raw);
  if (!tex) return null;

  return {
    tex,
    display: inferDisplayMode(element, raw),
    source,
  };
}

function probeChatGptMath(root: Element): MathProbeResult | null {
  const annotation = readTextFromSelfOrDescendant(
    root,
    "annotation[encoding='application/x-tex']",
  );
  if (annotation) {
    return fromRaw(annotation, root, "annotation");
  }

  const scriptTex = readTextFromSelfOrDescendant(root, "script[type='math/tex']");
  if (scriptTex) {
    return fromRaw(scriptTex, root, "script");
  }

  const dataTex = readAttrFromSelfOrDescendant(root, "[data-tex]", "data-tex");
  if (dataTex) {
    return fromRaw(dataTex, root, "data-tex");
  }

  return null;
}

function probeClaudeMath(root: Element): MathProbeResult | null {
  const katexAnnotation = readTextFromSelfOrDescendant(root, ".katex-mathml annotation");
  if (katexAnnotation) {
    return fromRaw(katexAnnotation, root, "annotation");
  }

  const annotation = readTextFromSelfOrDescendant(
    root,
    "annotation[encoding='application/x-tex']",
  );
  if (annotation) {
    return fromRaw(annotation, root, "annotation");
  }

  const scriptTex = readTextFromSelfOrDescendant(root, "script[type='math/tex']");
  if (scriptTex) {
    return fromRaw(scriptTex, root, "script");
  }

  const regexTex = extractRegexTex(root.textContent ?? "");
  if (regexTex) {
    return fromRaw(regexTex, root, "regex-fallback");
  }

  return null;
}

function probeGeminiMath(root: Element): MathProbeResult | null {
  const dataFormula = readAttrFromSelfOrDescendant(root, "[data-formula]", "data-formula");
  if (dataFormula) {
    return fromRaw(dataFormula, root, "data-formula");
  }

  const scriptTex = readTextFromSelfOrDescendant(root, "script[type='math/tex']");
  if (scriptTex) {
    return fromRaw(scriptTex, root, "script");
  }

  const annotation = readTextFromSelfOrDescendant(
    root,
    "annotation[encoding='application/x-tex']",
  );
  if (annotation) {
    return fromRaw(annotation, root, "annotation");
  }

  const regexTex = extractRegexTex(root.textContent ?? "");
  if (regexTex) {
    return fromRaw(regexTex, root, "regex-fallback");
  }

  return null;
}

export function probeMathTex(element: Element, platform: Platform): MathProbeResult | null {
  if (platform === "ChatGPT") {
    return probeChatGptMath(element);
  }
  if (platform === "Claude") {
    return probeClaudeMath(element);
  }
  if (platform === "Gemini") {
    return probeGeminiMath(element);
  }
  return null;
}
