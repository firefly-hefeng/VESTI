# Vesti v1.7.0-rc.x Multi-Agent Orchestration Spec

Version: v1.7.0-rc.x  
Status: Docs Freeze (Decision Complete)  
Audience: Offscreen engineering, prompt engineering, QA, release owner  
Owner: Orchestration Track

---

## 0. Brief Summary

v1.7 is the orchestration and Prompt-as-Code backend release line.

- In scope: Offscreen multi-agent execution chain, prompt artifact loading contract, runtime progress events, drift gates, rollout flags.
- Out of scope: dual-track parser and schema v5 implementation (v1.6), Reader and Insights UI redesign (v1.8).

This spec assumes v1.6 dual-track data contracts are already stable and does not redefine parser internals.

---

## 1. Version Boundary Contract

Release lines are serial and non-overlapping:

1. v1.6.0-rc.x: data pipeline and capture contracts.
2. v1.7.0-rc.x: orchestration and Prompt-as-Code runtime.
3. v1.8.0-rc.x: Reader and Insights rendering upgrades.

Hard boundary rules:

1. v1.7 does not redesign Reader/Insights visual layer.
2. v1.7 does not change capture semantics or migration rules already frozen in v1.6.
3. Interface placeholders are allowed; cross-line behavior rollout is not.

---

## 1.1 Schema Version Matrix (v1.7 freeze)

Default targets in v1.7 planning docs:

- Summary: `conversation_summary.v3` (default), `conversation_summary.v2` (legacy)
- Weekly: `weekly_lite.v2` (default), `weekly_lite.v1` (legacy)

Compatibility policy:

1. Legacy schemas remain documented for one release cycle.
2. Runtime migration strategy is out of scope for this docs-only freeze.
3. Post-cycle retirement requires explicit changelog and contract update.

---

## 2. Architecture Topology

Core execution domain: Offscreen.

1. Sidepanel sends generation request.
2. Offscreen resolves settings, prompt artifacts, and state machine stage transitions.
3. Offscreen calls model route through existing inference service and proxy contracts.
4. Offscreen emits push progress events to Sidepanel.
5. Offscreen persists final structured or fallback result through repository layer.

Prompt files are canonical in docs and compiled to generated artifacts for runtime consumption.

---

## 3. Agent Responsibility Contract

Artifact IDs are frozen:

- agent_a_compaction
- agent_b_thread_summary
- agent_c_weekly_digest

### 3.1 Agent A (compaction)

- Input: LLM-facing `content_text` slices.
- Output: compact markdown skeleton.
- Constraints: compression ratio policy and code-heavy micro-template fallback must be preserved.

### 3.2 Agent B (thread summary)

- Role: strict structural mapper.
- Input: Agent A skeleton.
- Output: `conversation_summary.v3` JSON.
- Veto: no second-pass inference, no concept injection beyond input.

### 3.3 Agent C (weekly digest)

- Input: recent 7-day summary set.
- Output: `weekly_lite.v2` JSON.
- Rule: if valid conversations < 3, enforce `insufficient_data=true` and stop long-horizon claims.

---

## 4. Orchestration State Machine

Frozen stage enum:

- initiating_pipeline
- distilling_core_logic
- curating_summary
- aggregating_weekly_digest
- persisting_result
- completed
- degraded_fallback

### 4.1 Summary Chain

`initiating_pipeline -> distilling_core_logic (A) -> curating_summary (B) -> persisting_result -> completed | degraded_fallback`

### 4.2 Weekly Chain

`initiating_pipeline -> aggregating_weekly_digest (C) -> persisting_result -> completed | degraded_fallback`

### 4.3 Retry and Fallback Rule

1. Structured parse failure triggers repair pass.
2. Repair failure triggers fallback text generation.
3. If Agent A fails, orchestration builds a minimal degraded skeleton from source text, then continues Agent B.
4. Only when degraded skeleton path also fails does pipeline enter `degraded_fallback`.
5. Any non-recoverable upstream error still writes a user-safe artifact.
6. Internal exception detail is logged, not surfaced as raw stack to user UI.

---

## 5. Prompt Artifact Loading Contract

Prompt source of truth is docs only:

- `documents/prompt_engineering/*.md`

Runtime loading is generated bundle only:

- `frontend/src/lib/prompts/generated/*`

Required generated metadata fields per artifact:

- `id`
- `version`
- `schemaTarget`
- `hash`
- `updatedAt`

Runtime must not parse markdown files directly in extension contexts.

---

## 6. Runtime Progress Event Contract (Push)

Progress transport is push-only eventing from Offscreen to Sidepanel.

Event name:

- `INSIGHT_PIPELINE_PROGRESS`

Required fields:

- `pipelineId`
- `scope`
- `targetId`
- `stage`
- `status`
- `attempt`
- `startedAt`
- `updatedAt`
- `route`
- `modelId`
- `promptVersion`

Ordering rules:

1. Per `pipelineId`, `seq` is strictly monotonic.
2. Each stage transition emits at least one event.
3. Terminal event is mandatory: `completed` or `degraded_fallback`.

Consumer rule:

- Sidepanel deduplicates by `pipelineId + seq` and ignores stale sequence values.

---

## 7. Feature Flag Rollout Policy

Storage-backed flags in `chrome.storage.local` (default false):

- `enable_v17_multi_agent_pipeline`
- `enable_v17_progress_events`
- `enable_v17_weekly_agent_c`

Rollout rules:

1. Production default is all flags off.
2. QA can enable flags incrementally.
3. Any blocker allows immediate rollback by disabling top-level pipeline flag.
4. Rollback must not require schema/data migration reversal.

---

## 8. Prompt/Schema Drift Gates

Mandatory local gate:

- `pnpm -C frontend eval:prompts --mode=mock --strict`

PR gate (blocking):

- deterministic mock fixture run + schema validation

Nightly gate (non-blocking for PR):

- scheduled small live smoke run with version/hash tracking

Thresholds are bound to `eval/rubrics/thresholds.json`.

---

## 9. Observability and Safety

Minimum telemetry dimensions:

- `pipelineId`, `scope`, `stage`, `status`, `attempt`
- `route`, `modelId`, `promptVersion`
- latency and fallback markers

Safety goals:

1. Preserve user-visible continuity under transient failures.
2. Keep errors diagnosable via logs and eval reports.
3. Avoid exposing raw backend exceptions to user-facing UI copy.

---

## 10. Acceptance Gate for v1.7 Docs Freeze

A docs freeze is accepted only if:

1. Prompt source/loading contract is unambiguous.
2. Agent A/B/C boundaries and veto clauses are executable.
3. Runtime event schema and stage machine are aligned.
4. Drift gates are defined for local + PR + nightly layers.
5. Feature flags include defaults, rollout path, and rollback path.

---

## 11. Explicit Assumptions and Defaults

1. v1.6 contracts are treated as stable dependency.
2. v1.7 does not redesign Reader/Insights UI.
3. Prompt alias `synthesis_skill.md` is temporary and one-cycle only.
4. Push eventing is the primary transport; polling is not canonical.
5. All v1.7 behavior ships behind storage flags by default.
