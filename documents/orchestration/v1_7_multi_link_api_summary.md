# Vesti v1.7 Multi-Link API Summary (RPC / Event / Persistence)

Date: 2026-02-23  
Scope: extension runtime contracts in current branch (`feature/ui-minimalist-sidebar-compare`)  
Audience: frontend/offscreen/proxy engineers

---

## 1) One-page topology

1. Sidepanel uses typed runtime RPC (`sendRequest`) to call Offscreen/Background.
2. Offscreen handles data, summary/weekly generation, and persistence.
3. Background handles sidepanel open flow + active-tab capture status/archive bridge.
4. LLM route is selected by mode:
   - `demo_proxy` -> `${proxyBaseUrl}/chat`
   - `custom_byok` -> `https://api-inference.modelscope.cn/v1/chat/completions`
5. Embedding route already prewired (direct + proxy), but not yet bound to active UI feature flow.

---

## 2) RPC contract (current implementation)

Source of truth: `frontend/src/lib/messaging/protocol.ts`

### 2.1 Request envelope

- Typed union `RequestMessage`
- Target split:
  - `target: "offscreen"` for data/LLM/insight requests
  - `target: "background"` for active capture status + force archive

### 2.2 High-value RPCs for v1.7 chain

1. Insight generation
   - `GENERATE_CONVERSATION_SUMMARY` -> `SummaryRecord`
   - `GENERATE_WEEKLY_REPORT` -> `WeeklyReportRecord`
2. Insight readback
   - `GET_CONVERSATION_SUMMARY`
   - `GET_WEEKLY_REPORT`
3. LLM settings + connectivity
   - `GET_LLM_SETTINGS`
   - `SET_LLM_SETTINGS`
   - `TEST_LLM_CONNECTION`
4. Capture/status bridge
   - `GET_ACTIVE_CAPTURE_STATUS` (background)
   - `FORCE_ARCHIVE_TRANSIENT` (background)

### 2.3 Runtime timeout policy (client)

Source: `frontend/src/lib/services/storageService.ts`

- Long running insight generation: `120000ms`
- LLM test: `30000ms`
- Full-text search: `15000ms`

---

## 3) Event contract (current vs target)

### 3.1 Currently implemented event

- `VESTI_DATA_UPDATED` (coarse refresh signal)
- Emitted after data mutation paths; consumed by sidepanel for refresh token bump.

### 3.2 v1.7 target event contract (docs)

- `INSIGHT_PIPELINE_PROGRESS` is documented in:
  - `documents/orchestration/v1_7_runtime_event_contract.md`
- As of 2026-02-23, this event type is not yet wired in runtime code paths.

Implication:

- Current UX is pull/refresh driven for insights completion state.
- v1.7 progress visualization remains a contract-first item pending implementation.

---

## 4) Persistence contract (Dexie)

Source of truth: `frontend/src/lib/db/schema.ts`, `frontend/src/lib/db/repository.ts`

### 4.1 DB version

- Current Dexie schema version: `5`

### 4.2 Tables

1. `conversations`
2. `messages`
3. `summaries`
4. `weekly_reports`

### 4.3 Insight write semantics

1. `saveSummary` upserts by `conversationId`
2. `saveWeeklyReport` upserts by `(rangeStart, rangeEnd)`
3. Stored fields include:
   - `content`, `structured`, `format`, `status`, `schemaVersion`, `modelId`

### 4.4 Current schema-version reality in code

- Summary: `conversation_summary.v1 | conversation_summary.v2`
- Weekly: `weekly_report.v1 | weekly_lite.v1`

Note: this differs from some v1.7 planning docs that discuss newer schema targets; do not assume migration is already merged.

---

## 5) Multi-link LLM + embeddings prewire status

### 5.1 Chat route selection

Source: `frontend/src/lib/services/llmService.ts`, `frontend/src/lib/services/llmConfig.ts`

- `resolveLlmRoute`:
  - `demo_proxy` -> proxy route (`/chat`)
  - `custom_byok` -> direct ModelScope route
- Service token forwarding (`x-vesti-service-token`) is active on proxy chat calls.
- Think-stripping policy is client-side (`thinkHandlingPolicy`, default `strip`).

### 5.2 Embeddings route prewire

Source: `frontend/src/lib/services/embeddingService.ts`

- Implemented routes:
  - direct DashScope-compatible endpoint
  - proxy `${proxyBaseUrl}/embeddings`
- Fallback: direct `401/403` can fall back to proxy.
- Current state: `requestEmbeddings` exists but has no active call site in app flow yet.

### 5.3 BYOK whitelist lockdown (this update)

- BYOK model input is now whitelist-only in Settings UI.
- Config normalization enforces whitelist and auto-fallback to stable model when invalid.
- Whitelist currently includes:
  - `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B`
  - `Qwen/Qwen3-14B`
  - `deepseek-ai/DeepSeek-V3`
  - `deepseek-ai/DeepSeek-R1`
  - `Qwen/Qwen3-8B`
  - `Qwen/Qwen3-32B`
  - `deepseek-ai/DeepSeek-V3.2`

---

## 6) Conflict check (API pre-embed + future v1.7)

No hard runtime conflict found today between:

1. chat proxy/BYOK dual route
2. embedding proxy route contract
3. current persistence schema

Main integration risks are contract drift, not endpoint collision:

1. docs schema target vs code schema target mismatch
2. progress-event contract documented but not yet emitted
3. embedding capability prewired but not yet connected to orchestration features

---

## 7) Engineering rules to avoid future conflicts

1. Route derivation single source of truth:
   - always use `getProxyRouteUrl(config, "chat" | "embeddings")`
2. Settings normalization is mandatory before persist/use:
   - always pass through `normalizeLlmSettings`
3. Keep BYOK model safety gate centralized:
   - never bypass `sanitizeByokModelId`
4. Keep event contracts typed before UI usage:
   - add protocol type + runtime emitter + consumer dedupe together
5. Keep schema version changes explicit:
   - update `types/index.ts` + parsers + repository + docs in one PR
6. No key leakage:
   - API keys only in `chrome.storage.local` via settings service; never in Dexie records

---

## 8) Deployment note (GitHub + Vercel)

Current default proxy points to Vercel-hosted endpoint:

- `https://vesti-proxy.vercel.app/api`

As of 2026-02-23 in this repo:

1. no checked-in `vercel.json` deployment-as-code baseline
2. env contract is documented, but runtime deployment policy is still mostly external/manual

Recommendation for v1.7 stabilization:

1. add deployment-as-code (`vercel.json` + env checklist)
2. pin proxy contract version in CI smoke checks (`/chat` + `/embeddings`)
3. gate release on contract-level health checks, not UI-only validation

---

## 9) Update 2026-02-24 (Hackathon MVP patch)

1. Proxy soft guardrails are now implemented in `vesti-proxy` `/api/chat`:
   - high-threshold rate limit (`300/10min` + burst `120/60s`)
   - concurrency guard (`global 200`, per-ip `40`)
   - circuit breaker (`60s` window, min samples `80`, open `15s`, half-open probes `12`)
   - new operational error codes:
     - `RATE_LIMITED` (429)
     - `PROXY_OVERLOADED` (503)
     - `CIRCUIT_OPEN` (503)
   - `retry-after` and `x-rate-limit-*` headers are emitted on protected paths.

2. Summary chain now includes Agent A compaction pre-step (schema unchanged):
   - Runtime path: `compaction -> conversationSummary(v2) -> repair -> fallback`
   - If compaction fails, summary automatically falls back to direct transcript path.
   - Added observability fields in summary logs:
     - `compactionUsed`
     - `compactionFailed`
     - `compactionCharsIn`
     - `compactionCharsOut`
     - `summaryPath` (`compacted | direct`)

3. Weekly input now prioritizes structured summary evidence:
   - ranking prefers `summary.structured` before plain summary text.
   - weekly input logs include `summaryEvidenceCount` and `structuredEvidenceCount`.

4. Build and gate status for this patch:
   - `pnpm -C frontend build` -> pass
   - `pnpm -C frontend eval:prompts --mode=mock --strict` -> pass

## 10) Update 2026-02-24 (Weekly Digest strict alignment patch)

1. Agent C input mode is now `summary_v2_only`:
   - weekly aggregation consumes structured `conversation_summary.v2` entries as primary evidence.
   - `conversation_summary.v1` is excluded from structured weekly aggregation input.

2. Runtime Sub-3 breaker is enforced before inference:
   - if substantive structured sample count `< 3`, weekly short-circuits with `insufficient_data=true`.
   - strict sparse output shape:
     - `highlights`: exactly 1 factual sentence
     - `recurring_questions`: `[]`
     - `cross_domain_echoes`: `[]`
     - `unresolved_threads`: `[]`
     - `suggested_focus`: `[]`
     - `evidence`: `[]`

3. `weekly_lite.v1` in-place compatible extension:
   - added `cross_domain_echoes` field to output contract (empty array allowed).
   - no schema version bump to `weekly_lite.v2`.
   - adapter read path remains backward-compatible for historical records missing this field.

4. Weekly observability fields added:
   - `weekly_sub3_triggered`
   - `weekly_substantive_count`
   - `weekly_structured_count`
   - `weekly_input_mode` (`summary_v2_only`)
