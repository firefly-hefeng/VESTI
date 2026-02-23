import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Copy, Check, ChevronDown } from "lucide-react";
import type { Message, Platform } from "~lib/types";
import type { AstNode, AstRoot } from "~lib/types/ast";
import { AstMessageRenderer } from "./AstMessageRenderer";
import { PLATFORM_TONE } from "./platformTone";

const COLLAPSE_THRESHOLD_PX = 110;
const COLLAPSED_MAX_HEIGHT_PX = 86;
const COLLAPSE_FADE_HEIGHT_PX = 37;
const COPY_FEEDBACK_MS = 1400;
const FENCE_LANGUAGE_PATTERN = /^[a-z0-9+#.-]{1,24}$/i;
const FENCE_LANGUAGE_NOISE_TOKENS = new Set([
  "copy",
  "copied",
  "code",
  "plain",
  "plaintext",
  "text",
]);
const GEMINI_USER_PREFIX_PATTERN = /^[\s\u200B\uFEFF]*you said(?:\s*[:\-])?\s*/i;
const MIN_AST_COVERAGE_RATIO = 0.55;
const MIN_TEXT_LENGTH_FOR_AST_CHECK = 120;
const CLAUDE_RICH_AST_COVERAGE_FLOOR = 0.22;

interface MessageBubbleProps {
  message: Message;
  platform: Platform;
}

export function MessageBubble({ message, platform }: MessageBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const renderAst = useMemo(() => {
    if (!message.content_ast || message.content_ast.type !== "root") {
      return null;
    }
    return sanitizeAstForRender(message.content_ast, message.role, platform);
  }, [message.content_ast, message.role, platform]);

  const sourceTextLen = useMemo(
    () => normalizeForCoverage(message.content_text).length,
    [message.content_text],
  );
  const astTextLen = useMemo(
    () => (renderAst ? normalizeForCoverage(extractAstPlainText(renderAst)).length : 0),
    [renderAst],
  );
  const astStats = useMemo(
    () => (renderAst ? inspectAst(renderAst) : null),
    [renderAst],
  );
  const astCoverageRatio =
    sourceTextLen > 0 ? astTextLen / sourceTextLen : 1;

  const isAi = message.role === "ai";
  const hasRenderableAst =
    message.content_ast_version === "ast_v1" &&
    !!renderAst &&
    renderAst.type === "root" &&
    renderAst.children.length > 0;
  const shouldUseAst =
    hasRenderableAst &&
    (sourceTextLen < MIN_TEXT_LENGTH_FOR_AST_CHECK ||
      astCoverageRatio >= resolveCoverageFloor(platform, astStats));
  const shouldCollapse = canCollapse && !isExpanded;

  useLayoutEffect(() => {
    const bodyEl = bodyRef.current;
    if (!bodyEl) {
      setCanCollapse(false);
      return;
    }

    let frameId = 0;
    const measure = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        const nextCanCollapse = bodyEl.scrollHeight > COLLAPSE_THRESHOLD_PX;
        setCanCollapse((prev) => (prev === nextCanCollapse ? prev : nextCanCollapse));
      });
    };

    measure();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(bodyEl);
    }

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
    };
  }, [message.id, message.content_text, renderAst, shouldUseAst]);

  useEffect(() => {
    if (!canCollapse) {
      setIsExpanded(false);
    }
  }, [canCollapse]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content_text).catch(() => {});
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  return (
    <div className={`reader-turn ${isAi ? "reader-turn-ai" : "reader-turn-user"}`}>
      <div className="reader-turn-header">
        <span
          className={`reader-role-label ${
            isAi
              ? `reader-role-label-model ${PLATFORM_TONE[platform].text}`
              : "reader-role-label-user"
          }`}
        >
          {isAi ? platform : "You"}
        </span>

        <button
          type="button"
          aria-label="Copy message"
          onClick={handleCopy}
          className="reader-turn-copy-btn"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>

      <div
        className={`reader-turn-body-wrap ${shouldCollapse ? "is-collapsed" : ""} ${canCollapse ? "with-expand" : ""}`}
        style={shouldCollapse ? { maxHeight: `${COLLAPSED_MAX_HEIGHT_PX}px` } : undefined}
      >
        <div
          ref={bodyRef}
          className={`reader-turn-body ${isAi ? "reader-turn-body-model" : "reader-turn-body-user"}`}
        >
          {shouldUseAst ? (
            <AstMessageRenderer root={renderAst as AstRoot} />
          ) : (
            <div className="reader-fallback-content whitespace-pre-wrap">
              {renderContent(message.content_text)}
            </div>
          )}
        </div>
        {shouldCollapse ? (
          <div
            className="reader-turn-fade-mask"
            style={{ height: `${COLLAPSE_FADE_HEIGHT_PX}px` }}
          />
        ) : null}
      </div>

      <div className={`reader-expand-row ${canCollapse ? "has-btn" : ""}`}>
        {canCollapse ? (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className={`reader-expand-btn ${isExpanded ? "open" : ""}`}
          >
            {isExpanded ? "Collapse" : "Expand"}
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function normalizeForCoverage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface AstRenderStats {
  blockNodes: number;
  hasList: boolean;
  hasTable: boolean;
  hasCodeBlock: boolean;
  hasMath: boolean;
  hasBlockquote: boolean;
}

function inspectAst(root: AstRoot): AstRenderStats {
  const stats: AstRenderStats = {
    blockNodes: 0,
    hasList: false,
    hasTable: false,
    hasCodeBlock: false,
    hasMath: false,
    hasBlockquote: false,
  };

  const walk = (node: AstNode): void => {
    switch (node.type) {
      case "p":
      case "h1":
      case "h2":
      case "h3":
      case "blockquote":
      case "code_block":
      case "table":
      case "ul":
      case "ol":
      case "li":
        stats.blockNodes += 1;
        break;
      default:
        break;
    }

    if (node.type === "ul" || node.type === "ol") stats.hasList = true;
    if (node.type === "table") stats.hasTable = true;
    if (node.type === "code_block") stats.hasCodeBlock = true;
    if (node.type === "math") stats.hasMath = true;
    if (node.type === "blockquote") stats.hasBlockquote = true;

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
      node.children.forEach(walk);
    }
  };

  root.children.forEach(walk);
  return stats;
}

function resolveCoverageFloor(
  platform: Platform,
  stats: AstRenderStats | null,
): number {
  if (!stats) {
    return MIN_AST_COVERAGE_RATIO;
  }

  if (stats.hasBlockquote) {
    return CLAUDE_RICH_AST_COVERAGE_FLOOR;
  }

  const richClaudeAst =
    platform === "Claude" &&
    (
      stats.hasTable ||
      stats.hasList ||
      stats.hasCodeBlock ||
      (stats.hasMath && stats.blockNodes >= 2) ||
      stats.blockNodes >= 4
    );

  return richClaudeAst ? CLAUDE_RICH_AST_COVERAGE_FLOOR : MIN_AST_COVERAGE_RATIO;
}

function extractAstPlainText(root: AstRoot): string {
  return root.children.map(extractAstNodeText).join(" ");
}

function extractAstNodeText(node: AstNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "fragment":
    case "p":
    case "h1":
    case "h2":
    case "h3":
    case "ul":
    case "ol":
    case "li":
    case "strong":
    case "em":
    case "blockquote":
      return node.children.map(extractAstNodeText).join(" ");
    case "br":
      return "\n";
    case "code_inline":
      return node.text;
    case "code_block":
      return node.code;
    case "table": {
      const headerText = node.headers.join(" ");
      const rowText = node.rows.map((row) => row.join(" ")).join(" ");
      return `${headerText} ${rowText}`;
    }
    case "math":
      return node.tex;
    case "attachment":
      return node.name;
    default: {
      const exhaustiveGuard: never = node;
      return exhaustiveGuard;
    }
  }
}

function renderContent(text: string): React.ReactNode {
  const parts = text.split(/(```[\s\S]*?```|\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const { code, language } = parseFallbackFencedCode(part);
      return <FallbackCodeBlockView key={i} code={code} language={language} />;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

interface FallbackCodeBlockViewProps {
  code: string;
  language: string;
}

function FallbackCodeBlockView({ code, language }: FallbackCodeBlockViewProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  return (
    <div className="reader-ast-code-block">
      <div className="reader-ast-code-head">
        <span className="reader-ast-code-lang">{language}</span>
        <button
          type="button"
          className="reader-ast-code-copy"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3" strokeWidth={1.75} /> : <Copy className="h-3 w-3" strokeWidth={1.75} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="reader-ast-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function parseFallbackFencedCode(part: string): { code: string; language: string } {
  const raw = part.slice(3, -3).replace(/^\r?\n/, "");
  const normalized = raw.replace(/\r\n?/g, "\n").trimEnd();
  const firstNewline = normalized.indexOf("\n");

  if (firstNewline < 0) {
    return {
      code: normalized,
      language: "plain",
    };
  }

  const maybeLanguage = normalizeFenceLanguage(normalized.slice(0, firstNewline));
  if (!maybeLanguage) {
    return {
      code: normalized,
      language: "plain",
    };
  }

  return {
    code: normalized.slice(firstNewline + 1),
    language: maybeLanguage,
  };
}

function normalizeFenceLanguage(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const prefixed = normalized.match(/^(?:language|lang)[:_\-\s]*([a-z0-9+#.-]{1,24})$/i);
  const token = (prefixed?.[1] ?? normalized).toLowerCase();
  if (!FENCE_LANGUAGE_PATTERN.test(token) || FENCE_LANGUAGE_NOISE_TOKENS.has(token)) {
    return null;
  }
  return token;
}

function sanitizeAstForRender(
  root: AstRoot,
  role: Message["role"],
  platform: Platform,
): AstRoot {
  if (role !== "user" || platform !== "Gemini") {
    return root;
  }

  const cloned = JSON.parse(JSON.stringify(root)) as AstRoot;
  stripLeadingGeminiPrefix(cloned.children);
  return cloned;
}

function stripLeadingGeminiPrefix(nodes: AstNode[]): boolean {
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
      const changed = stripLeadingGeminiPrefix(node.children);
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
