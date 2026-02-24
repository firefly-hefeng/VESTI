# Engineering Handoff - P0 Summary Runtime Hardening

Date: 2026-02-24
Owner Session: Codex (GPT-5)
Repos: `vesti` + `vesti-proxy`

## 1) Why this patch exists

Observed production symptoms before this patch:
1. High `fallback_text` rate on thread summary generation.
2. Frequent 60s+ latency despite low token volume.
3. UI artifacts from fallback adapter path (multiple sections collapsing to near-identical text).

The critical root cause chain was:
1. Upstream JSON mode frequently returned `message.content=""` while valid JSON was present in `reasoning_content`.
2. Runtime ignored `reasoning_content`, so it triggered extra `prompt_json` round-trips.
3. Even when JSON was present, minor shape drift caused strict parse rejection.
4. Pipeline then escalated to text fallback, which amplified low-quality rendering.

## 2) Final design decisions (what changed)

### A. JSON recovery from `reasoning_content` (frontend runtime)
File: `frontend/src/lib/services/llmService.ts`
1. Added `contentSource` metadata to inference result (`content | reasoning_content`).
2. Added JSON recovery path for `json_object` and `prompt_json` branches:
   - if `content` is empty, try parse JSON from `reasoning_content`.
   - if recovered, return immediately without extra request.
3. Added explicit diagnostics for recovery success/failure.

### B. Schema tolerance and coercion before fail-closed parse
File: `frontend/src/lib/services/insightSchemas.ts`
1. Added `coerceConversationSummaryV2Candidate(...)` before final parse failure.
2. Coercion handles common drift patterns:
   - `meta_observations` array/object mismatch.
   - invalid `depth_level` -> `moderate`.
   - string/list mismatch for unresolved and next steps.
   - string/object mismatch for `key_insights`.
   - speaker synonyms normalized to `User|AI`.
3. Added structured parse error codes (not only raw parse strings).

### C. Summary runtime budget and call cap
File: `frontend/src/lib/services/insightGenerationService.ts`
1. Added pipeline budget `SUMMARY_PIPELINE_TIME_BUDGET_MS=45000`.
2. Capped remote structured generation to two rounds (primary + repair).
3. Added compaction skip heuristic for short/light sessions.
4. Removed default third remote fallback LLM call in summary chain.

### D. Local structured degraded synthesis (to avoid "same text" collapse)
File: `frontend/src/lib/services/insightGenerationService.ts`
1. Added `synthesizeDegradedSummaryV2FromRaw(...)`.
2. If remote structured rounds fail, runtime now synthesizes minimal legal `conversation_summary.v2` from available raw evidence.
3. `fallback_text` is now terminal-only when no usable evidence remains.

### E. Proxy-side defensive fix
File: `E:/GT/DEV/vesti-proxy/api/chat.js`
1. If request expects `response_format=json_object` and upstream `content` is empty:
   - parse JSON from `reasoning_content`.
   - inject into `message.content` before returning.
2. Added response header: `x-proxy-content-source=content|reasoning_content`.

### F. New observability fields
File: `frontend/src/lib/services/insightGenerationService.ts`
1. `summary_llm_call_count`
2. `summary_json_recovered_from_reasoning`
3. `summary_local_synthesis_used`
4. `summary_parse_error_codes`
5. `summary_compaction_skipped`
6. `summary_total_latency_ms`

## 3) Reusable engineering patterns extracted

### Pattern 1: "Reasoning-channel salvage" before retry
If an LLM provider can emit valid payload in non-primary channels, always salvage before issuing another network hop.

### Pattern 2: "Strict schema + tolerant coercion"
Keep strict target schema, but add a bounded coercion layer for known drift shapes. This reduces false negatives while preserving contract safety.

### Pattern 3: "Two-hop cap + time budget"
For user-facing generation, enforce both a max-attempt cap and a wall-clock budget. This prevents unbounded latency explosions.

### Pattern 4: "Structured degradation, not plain-text collapse"
When generation quality drops, degrade into minimal legal structured output instead of plain text. This keeps UI semantics stable.

### Pattern 5: "Single-purpose fallback hierarchy"
Use ordered fallback layers:
1. structural repair
2. local synthesis
3. terminal text fallback
Avoid skipping directly from parse failure to plain text.

### Pattern 6: "Telemetry as contract"
Record not only success/failure, but also path decisions (recovered source, parse codes, call count, budget breach). This is essential for fast post-release convergence.

### Pattern 7: "Split rollout for causality"
Ship frontend runtime fix first, then proxy fix. This isolates contribution of each layer and prevents ambiguous attribution.

### Pattern 8: "UI bug can be data-path bug"
When UI sections look duplicated, first verify upstream structure status before touching rendering. In this case, root cause was fallback content shape, not rendering mechanics.

## 4) What to monitor after release

Primary metrics:
1. `summary_fallback_rate`
2. `summary_consecutive_fallback_count`
3. `summary_p95_latency_ms`
4. `summary_llm_call_count` distribution
5. `summary_json_recovered_from_reasoning` hit ratio
6. `summary_local_synthesis_used` ratio
7. `summary_parse_error_codes` top-N
8. proxy `x-proxy-content-source` distribution

Success criteria:
1. Clear drop in `fallback_text` frequency.
2. P95 latency reduced versus pre-patch baseline.
3. Lower frequency of second-hop JSON retries.
4. No reappearance of "same-text multi-section" fallback artifact in thread summary UI.

## 5) Release slicing and branch checkpoints

### Repo A: `vesti`
Branch: `release/p0-summary-runtime-hardening`
Checkpoint commits:
1. `docs(p0): add summary runtime hardening handoff and reusable patterns`
2. `feat(runtime): recover json from reasoning_content + summary budgeted 2-hop pipeline`
3. `feat(schema): add conversation_summary.v2 coercion and parse error codes`

### Repo B: `vesti-proxy`
Branch: `release/p0-json-recovery-proxy`
Checkpoint commits:
1. `feat(proxy): recover json_object payload from reasoning_content and emit content-source header`

## 6) Rollback strategy

1. Frontend rollback: revert runtime hardening commit only.
2. Proxy rollback: revert `api/chat.js` normalization block only.
3. Keep telemetry fields if possible, even on rollback, to preserve diagnosis continuity.

## 7) Scope boundaries preserved

1. No public API signature changes.
2. No DB schema migration.
3. Weekly remains frozen by product policy (no unfreeze in this patch).
4. No changes to `documents/prompt_engineering/*.md`.
