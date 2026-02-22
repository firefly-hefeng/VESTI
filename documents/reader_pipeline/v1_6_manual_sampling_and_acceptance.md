# Vesti v1.6 Manual Sampling and Acceptance

Version: v1.6.0-rc.x  
Status: QA Gate Spec  
Audience: QA, parser engineer, release owner

---

## 1. Sampling Scope

This checklist validates data-pipeline behavior only.

In scope:

1. dual-track capture correctness
2. defensive degradation behavior
3. schema v5 migration compatibility
4. performance fallback mode switch

Out of scope:

1. multi-agent orchestration UI or backend behavior (v1.7)
2. Reader/Insights visual redesign (v1.8)

---

## 2. Mandatory Coverage Matrix

## 2.1 Platform coverage

- Six platforms P0 baseline:
  - ChatGPT, Claude, Gemini, DeepSeek, Qwen, Doubao
- Three-platform P1 probe:
  - ChatGPT, Claude, Gemini

## 2.2 Scenario minimum

Minimum required sample count:

1. P0 baseline: `6 platforms x 3 scenarios = 18`
2. P1 probe: `3 platforms x 3 scenarios = 9`
3. Migration and perf fallback cross-cutting: `8`

Total minimum: `35` cases

Scenario types:

1. standard capture
2. malformed/edge node degradation
3. long-thread performance behavior

---

## 3. Test Cases

## A. Dual-track correctness

1. New capture writes both `content_text` and `content_ast`.
2. `content_text` strips render noise and keeps logic readability.
3. `content_ast_version` is `ast_v1` when AST exists.

## B. Defensive degradation

1. malformed table/formula node does not fail whole message capture.
2. `degraded_nodes_count` increases when fallback occurs.
3. unknown custom tag still yields text salvage.

## C. Performance fallback

1. stress payload can trigger automatic `p0_fallback`.
2. in `p0_fallback`, capture continues and remains stable.
3. mode recovery to `full` follows documented threshold rule.

## D. Migration compatibility

1. v4 data upgrades to v5 with no fatal startup error.
2. legacy rows (`content_ast = null`) are readable/searchable/exportable.
3. no runtime crash from missing AST on historical messages.

## E. Platform-specific P1 probes

1. ChatGPT math probe:
   - prefer `annotation[encoding="application/x-tex"]`
2. Claude math probe:
   - prefer `.katex-mathml annotation`, regex only fallback
3. Gemini math probe:
   - prefer `[data-formula]` and `script[type="math/tex"]`

Code block check for all three:

- source must be `textContent` from `pre/code`
- syntax-highlight fragments are not persisted as AST content nodes

---

## 4. Evidence Requirements (DoD)

For each case include:

1. case id / platform / scenario type
2. expected / actual / verdict
3. timestamp
4. parser telemetry snapshot:
   - `parse_duration_ms`
   - `perf_mode`
   - `degraded_nodes_count`
5. storage proof (before/after message row sample)
6. screenshot or console capture

For migration cases include:

1. pre-upgrade DB snapshot summary
2. post-upgrade DB snapshot summary

---

## 5. Severity and Gate

Severity:

- Blocker:
  - message capture lost due to local AST parse failure
  - migration corrupts readable records
  - parser crash on supported platform
- Major:
  - degraded counter incorrect
  - performance fallback mode not switching as specified
  - P0 extraction inconsistent across platforms
- Minor:
  - non-critical selector fallback quality issue

Go/No-Go threshold:

- `Blocker = 0`
- `Major <= 2` with owner + workaround + retest plan

---

## 6. Build Gate

Required commands:

- `pnpm -C frontend build`
- `pnpm -C frontend package`

---

## 7. Result Template

```md
# v1.6 Data Pipeline Sampling Result

- Planned: 35
- Executed: <n>
- Passed: <n>
- Failed: <n>

## Severity
- Blocker: <n>
- Major: <n>
- Minor: <n>

## Go/No-Go
- Decision: Go | No-Go
- Reason:
- Remaining risks:
- Sign-off:
```
