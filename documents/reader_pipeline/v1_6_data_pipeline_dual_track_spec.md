# Vesti v1.6.0-rc.x Data Pipeline & Dual-Track Capture Spec

Version: v1.6.0-rc.x  
Status: Docs Freeze (Decision Complete)  
Audience: Extension Engineering, Data Pipeline Engineering, QA  
Owner: Data Pipeline Track

---

## 0. Brief Summary

v1.6 is a data-foundation release. It fixes the capture-layer entropy loss by upgrading parser output from single-track text to dual-track payload:

- `content_text`: low-noise logic text for downstream LLM compression.
- `content_ast`: structured rendering tree for future Reader fidelity.

This version is intentionally scoped:

- In scope: parser contracts, AST extraction policy, defensive parsing, schema v5 migration, performance fallback guardrails.
- Out of scope: multi-agent orchestration and Prompt-as-Code runtime (v1.7), Reader/Insights UI redesign (v1.8).

---

## 1. Architectural Aporia and Diagnosis

Current capture stores plain text only. Structural signals (code hierarchy, list nesting, table grid, formula source) are dropped before persistence.  
This is an irreversible information-loss point. v1.6 removes this single-direction entropy sink at the parser stage.

Design principle:

1. Capture once, preserve semantics early.
2. Degrade locally, never fail globally.
3. Keep Local-First and main-thread safety.

---

## 2. Version-Line Boundary Contract

To prevent scope leakage, version lines are frozen as follows:

- `v1.6.0-rc.x`: data pipeline and dual-track capture only.
- `v1.7.0-rc.x`: offscreen multi-agent orchestration and Prompt-as-Code backend runtime.
- `v1.8.0-rc.x`: Reader + Insights UI rendering and interaction upgrade.

No cross-line implementation coupling is allowed in v1.6 except stable interface placeholders.

---

## 3. Public API and Internal Contract Impact

## 3.1 Public API / External Protocol

- No new external API.
- No breaking runtime message type rename.
- Existing `CAPTURE_CONVERSATION` remains valid.

## 3.2 Internal Contract Changes

`Message` and `ParsedMessage` are extended with optional fields:

- `content_ast?: AstRoot | null`
- `content_ast_version?: "ast_v1" | null`
- `degraded_nodes_count?: number`

Semantics:

- `content_text` is defined as LLM-facing denoised text.
- `content_ast` is defined as Reader-facing structural tree.
- `content_ast` storage shape is native JSON object (not stringified JSON).

---

## 4. IParser v2 Dual-Track Requirements

All six platform parsers must emit dual-track messages:

1. Logic track: `content_text`
2. Render track: `content_ast`

Hard constraints:

1. No heavy markdown conversion library in content scripts.
2. DOM walk complexity remains `O(N)` over selected message subtree.
3. Existing role-first parsing strategy remains unchanged.
4. Existing message ordering and dedupe semantics remain unchanged.

---

## 5. AST Extraction Priority Matrix

## 5.1 P0 (Mandatory in v1.6)

- `text`, `fragment`
- `p`, `h1`, `h2`, `h3`, `br`
- `ul`, `ol`, `li` (recursive nesting required)
- `pre`, `code` (must read `textContent`; strip syntax-highlight fragments)
- `strong`, `em`

## 5.2 P1 (In v1.6, limited platform set)

- `table`, `tr`, `td`, `th`
- `math` with raw TeX/LaTeX extraction (never persist rendered fragment HTML)
- Platform scope: `ChatGPT`, `Claude`, `Gemini` only

## 5.3 P2 (Deferred)

- Attachments semantics
- Platform-specific executable widgets (for example Claude Artifacts)

---

## 6. Defensive Parsing and Graceful Degradation Contract

Parser must implement "local collapse, global preservation":

1. Node-level `try/catch` isolation for complex extraction.
2. On node failure, immediate text fallback:
   - `{ type: "text", text: node.textContent ?? "" }`
3. Unknown tags are treated as transparent containers:
   - recurse children first
   - fallback to text when recursion cannot produce safe nodes
4. Message-level capture must not fail due to local node failure.
5. Parsing telemetry must include:
   - `degraded_nodes_count`
   - `ast_node_count`
   - `parse_duration_ms`
   - `perf_mode` (`full` or `p0_fallback`)

---

## 7. Performance Redline and Automatic Fallback

Main-thread target budget:

- Single parse pass budget: `16ms`

Execution policy:

1. If pass exceeds budget, parser enters `p0_fallback` mode.
2. In `p0_fallback` mode:
   - P1 probes (`table`, `math`) are skipped.
   - P0 extraction remains enabled.
3. Warn-level telemetry is mandatory on mode switch.
4. This is automatic fallback, not alert-only behavior.

Allowed optimizations:

- Node-cache using `WeakMap` / `WeakSet` for unchanged subtree avoidance.
- No change to final persisted message sequence semantics.

---

## 8. Persistence Upgrade: Schema v5 Contract

Database upgrade:

- Dexie schema bump from v4 to v5.
- `messages` table extends with AST-related optional fields.

Migration behavior:

- Existing records are not backfilled with reconstructed AST.
- Default legacy values:
  - `content_ast = null`
  - `content_ast_version = null`
  - `degraded_nodes_count = 0`

Compatibility requirement:

- Legacy records remain readable/searchable/exportable.
- Reader fallback to plain text remains valid until v1.8 UI renderer upgrades.

---

## 9. Platform Probe Scope in v1.6

P1 probe definitions in v1.6 must be production-ready only for:

- ChatGPT
- Claude
- Gemini

Other platforms (DeepSeek, Qwen, Doubao):

- P0 must work.
- P1 absence must degrade explicitly and safely.

---

## 10. v1.6 Release Gate

`v1.6.0-rc.x` passes only when all are true:

1. Type/protocol/schema docs are consistent and implementation-ready.
2. Migration path guarantees no historical data corruption.
3. Performance fallback (`p0_fallback`) is testable and observable.
4. Manual sampling covers:
   - six-platform P0 baseline
   - three-platform P1 probe validation

---

## 11. Non-Scope Handoff

## 11.1 Handoff to v1.7

- Offscreen multi-agent orchestration state machine
- Agent A/B/C runtime invocation chain
- Prompt-as-Code loading pipeline

## 11.2 Handoff to v1.8

- AST-first Reader renderer
- Insights UI state visibility redesign
- Typography/interaction convergence for structured render output

---

## 12. Explicit Assumptions and Defaults

1. v1.6 is a data-foundation release, not a UI release.
2. `content_ast` is stored as JSON object.
3. P1 probe support is limited to ChatGPT/Claude/Gemini in this version.
4. 16ms is a hard budget with automatic fallback.
5. Historical AST backfill is explicitly disabled.
6. Current capture governance (`mirror/smart/manual`) remains unchanged.
7. Export protocol can remain backward compatible with AST as optional fields.
