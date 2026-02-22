# Vesti v1.6 AST Probe Cheat Sheet

Version: v1.6.0-rc.x  
Status: Docs Freeze  
Scope: P1 probe guidance for `math` and `table/code` extraction  
Applies to: ChatGPT, Claude, Gemini

---

## 0. Intent

This guide defines stable-first probe strategy for high-value P1 nodes without copying platform-rendered visual fragments.

Core rule:

- Extract source semantics (raw TeX, plain code text), not CSS-dependent rendered shards.

---

## 1. Probe Order Contract

For every complex node (`math`, `table`, extended code wrapper), probe order is fixed:

1. Primary selector probe (platform-specific stable anchor)
2. Secondary selector probe (same semantics, weaker anchor)
3. Text fallback probe (regex or subtree text extraction)
4. Final degradation to `text` node

All probe functions must be node-level isolated in `try/catch`.

---

## 2. Platform Strategy Matrix

| Platform | Node Type | Primary Probe | Secondary Probe | Last Fallback |
| --- | --- | --- | --- | --- |
| ChatGPT | math | `annotation[encoding="application/x-tex"]` | `script[type="math/tex"]` | text fallback |
| ChatGPT | code | `pre code` subtree + `textContent` | `pre` + `textContent` | text fallback |
| Claude | math | `.katex-mathml annotation` | `annotation[encoding="application/x-tex"]` | regex on visible text (`$$...$$`, `\\(...\\)`) |
| Claude | code | `pre` + `textContent` | `pre code` + `textContent` | text fallback |
| Gemini | math | `[data-formula]` attribute | `script[type="math/tex"]` | regex on visible text (`$$...$$`, `\\(...\\)`) |
| Gemini | code | `code` + `textContent` | `pre` + `textContent` | text fallback |

---

## 3. AST Mapping Examples

## 3.1 Math

```ts
type AstMathNode = {
  type: "math";
  tex: string;
  display?: boolean;
};
```

Extraction constraints:

1. `tex` must be non-empty after trim.
2. If probe returns empty string, do not emit `math`; degrade to `text`.

## 3.2 Code Block

```ts
type AstCodeBlockNode = {
  type: "code_block";
  code: string;
  language?: string | null;
};
```

Extraction constraints:

1. Code source is always `textContent`.
2. Nested syntax highlight spans are intentionally ignored.

## 3.3 Table

```ts
type AstTableNode = {
  type: "table";
  headers: string[];
  rows: string[][];
};
```

Fallback rules:

1. If grid shape is broken, fallback to plain text of table subtree.
2. Do not throw parse error to caller.

---

## 4. Defensive Extractor Stub (Reference)

```ts
function safeExtractMath(node: Element, platform: "ChatGPT" | "Claude" | "Gemini"): AstNode | null {
  try {
    const tex = probeTex(node, platform);
    if (!tex || !tex.trim()) {
      return null;
    }
    return { type: "math", tex: tex.trim() };
  } catch {
    const text = node.textContent?.trim() ?? "";
    return text ? { type: "text", text } : null;
  }
}

function safeExtractCode(node: Element): AstNode | null {
  try {
    const code = (node.querySelector("pre code") ?? node.querySelector("pre") ?? node).textContent ?? "";
    const normalized = code.replace(/\r\n/g, "\n").trimEnd();
    if (!normalized) {
      return null;
    }
    return { type: "code_block", code: normalized };
  } catch {
    const text = node.textContent?.trim() ?? "";
    return text ? { type: "text", text } : null;
  }
}
```

---

## 5. Probe Hygiene Checklist

1. Never bind to brittle generated class hashes when semantic anchors exist.
2. Keep selector lists platform-local, not globally merged.
3. Log probe path used (`primary` / `secondary` / `fallback`) for diagnostics.
4. Preserve user-visible text on all failures.
5. Any selector addition must include one fixture sample in parser test fixtures.

---

## 6. Out-of-Scope Notes

This cheat sheet is not a UI renderer specification.

- Rendering details move to v1.8.
- Multi-agent prompt behavior moves to v1.7.
- Attachments and platform-specific widgets remain deferred (P2).
