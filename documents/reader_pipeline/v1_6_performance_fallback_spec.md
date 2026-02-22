# Vesti v1.6 Performance Fallback Spec

Version: v1.6.0-rc.x  
Status: Docs Freeze  
Scope: main-thread budget protection for dual-track parsing

---

## 0. Goal

Protect host-page interaction fluency while introducing dual-track AST extraction.

Hard requirement:

- parser single-pass budget target is `16ms` for capture-triggered work.

---

## 1. Runtime Modes

Two parse modes are defined:

1. `full`
   - P0 + eligible P1 probes enabled
2. `p0_fallback`
   - only P0 extraction enabled
   - P1 probes (`table`, `math`) skipped

Mode switch is automatic and telemetry-backed.

---

## 2. Budget Evaluation

Per capture pass:

1. Start timer before message-node parse loop.
2. End timer after AST/text assembly.
3. Emit `parse_duration_ms`.

Switch rule:

- If `parse_duration_ms > 16`, next pass enters `p0_fallback`.
- Remain in `p0_fallback` until recovery window condition is met.

Recovery window recommendation:

- if last 3 passes are `<= 12ms`, switch back to `full`.

---

## 3. Telemetry Contract

Mandatory metrics per pass:

- `parse_duration_ms`
- `perf_mode`
- `degraded_nodes_count`
- `ast_node_count`
- `message_count`
- `platform`

Warn-level logs required on:

1. `full -> p0_fallback`
2. `p0_fallback -> full`

---

## 4. Allowed Optimization Techniques

1. Node cache:
   - `WeakMap<Element, AstNode | null>`
   - `WeakSet<Element>` for unchanged subtree skip
2. Fast-path skip:
   - avoid P1 probes when known mode is `p0_fallback`
3. Controlled traversal:
   - parse only selected message containers, not full document tree

Disallowed in v1.6:

1. Heavy markdown conversion library in content scripts
2. Global regex-heavy full-document transformation
3. Changes that alter message ordering/persistence semantics

---

## 5. MutationObserver Interaction

Observer baseline remains:

- debounce `1000ms`

v1.6 must not change capture decision semantics.  
Performance guard only affects node extraction breadth (`full` vs `p0_fallback`), not capture gate rules.

---

## 6. Manual Profiling Protocol

Test payload:

- >= 40 turns
- multiple long code blocks
- includes list-heavy and formula-heavy responses

DevTools profiling checks:

1. Long task frequency around parser pass
2. UI scroll smoothness during generation
3. mode switch logs and telemetry consistency

Pass criteria:

1. fallback switch happens predictably when budget is exceeded
2. capture remains functional in fallback mode
3. no hard parser crash under stress

---

## 7. Acceptance Criteria

1. Over-budget passes trigger `p0_fallback` automatically.
2. `p0_fallback` captures valid `content_text` and P0 AST consistently.
3. Mode recovery to `full` follows deterministic window rule.
4. No regression in dedupe, storage, or capture gate decisions.
