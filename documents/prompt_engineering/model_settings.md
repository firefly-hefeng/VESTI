# Vesti Model Access RFC (v1.2-rc.4)

- Document version: v1.2-rc.4
- Updated on: 2026-02-14
- Scope: Vesti Settings / Insights (Summary + Weekly Lite)
- Audience: Frontend / Extension / Backend / QA / DevOps
- Positioning: v1.1 stable delivery + v1.2 research baseline
- Canonical UI spec: `documents/prompt_engineering/insights_prompt_ui_engineering.md`

---

## Revision Notes (This Update)

1. v1.1 stable baseline model is fixed to `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B`.
2. Demo proxy route is fixed to Node runtime `POST /api/chat` with max-duration configuration.
3. Proxy fallback is single retry to `Qwen/Qwen3-14B`, only on network/timeout/429/5xx.
4. Diagnostic headers are standardized: `x-request-id`, `x-proxy-model-used`, `x-proxy-attempt`.
5. App fallback chain remains `json_mode -> prompt_json -> fallback_text`, and empty `json_mode` content degrades to `prompt_json`.
6. Weekly scope remains `Weekly Lite` (7-day recap only, no long-horizon claims).
7. Settings remains `app_shell` semantics and must stay sans-first even under Warm Paper theme.
8. Proxy contract adds `POST /api/embeddings` (DashScope OpenAI-compatible upstream).
9. Frontend proxy config upgrades to `proxyBaseUrl` with legacy `proxyUrl` auto-migration.

---

## 0. Context and Goals

### 0.1 Current context

- Demo route has passed pressure tests with fallback observed and no deterministic Edge timeout pattern.
- BYOK route remains direct to ModelScope and does not pass user keys through proxy.
- Release priority is stable generation and debuggable behavior, not maximum model novelty.

### 0.2 Goals

1. Keep v1.1 stable route predictable for demo delivery.
2. Keep Hybrid Access architecture and BYOK trust boundary intact.
3. Keep Weekly in Lite mode until data maturity supports broader claims.
4. Keep UI behavior aligned with the canonical Warm Paper + semantic-layer spec.

### 0.3 Non-goals

- No message protocol renaming.
- No mandatory streaming rollout in v1.1.
- No long-context weekly analytics requirement in v1.1.

---

## 1. Hybrid Architecture

### 1.1 Route by mode

- **Demo Mode (default):** `Extension -> Vercel Proxy -> ModelScope`
- **Custom Mode (BYOK):** `Extension -> ModelScope`

### 1.2 Security and trust boundary

1. Developer key is server-side only.
2. User BYOK key is not relayed through developer proxy.
3. Both routes are constrained to ModelScope gateway policy.

### 1.3 Endpoint standardization

- Standard proxy endpoint: `POST /api/chat`
- Embedding proxy endpoint: `POST /api/embeddings`
- Deprecated path `/api/vesti/chat` is out of RFC scope.

---

## 2. Stable Track Contract (v1.1)

### 2.1 Baseline model policy

- Primary model: `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B`
- Backup model: `Qwen/Qwen3-14B`
- Non-stream baseline: `enable_thinking=false`
- Stable fallback chain: `json_mode -> prompt_json -> fallback_text`

### 2.2 Weekly Lite boundary

- Window: recent 7 days only
- Goal: recap + actionable focus
- No long-horizon trend claims
- `insufficient_data=true` when total conversations < 3

### 2.3 v1.2 research track (off by default)

- Scope: capability detector + optional stream/reasoning
- Activation: feature-flag/policy controlled
- Default: off unless explicitly enabled

---

## 3. Proxy Runtime Contract (`/api/chat`)

### 3.1 Runtime and limits

1. Runtime: Node function on Vercel (no Edge dependency).
2. Function max duration is controlled via deployment config.
3. Upstream timeout is guarded by `AbortController` (current target: ~22s).

### 3.2 Request sanitization and payload policy

1. Allowed models are restricted to primary/backup set.
2. `max_tokens` is server-side clamped to `<= 800`.
3. `enable_thinking` is forced to `false` in proxy route.
4. Message role whitelist is `system | user | assistant`.
5. `response_format: { type: "json_object" }` is forwarded only when valid.

### 3.3 Fallback policy (single retry)

- Attempt 1: primary model
- Attempt 2: backup model (only if attempt 1 is retryable failure)

Retryable conditions:

1. Network fetch error
2. Upstream timeout
3. Upstream status `429`
4. Upstream status `5xx`

Non-retryable:

1. `4xx` except `429`
2. `200` with low-quality content (handled by app fallback chain, not proxy retry)

### 3.4 Response headers and CORS

1. CORS headers must exist on OPTIONS/200/4xx/5xx/catch branches.
2. Diagnostics:
   - `x-request-id`
   - `x-proxy-model-used`
   - `x-proxy-attempt`
3. Successful HTTP exchange returns upstream status/body transparently.

### 3.5 Embedding route contract (`/api/embeddings`)

1. Upstream endpoint: `https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings`.
2. Request format: OpenAI-compatible (`model`, `input`, optional `encoding_format`).
3. Validate input before upstream call:
   - empty input => 400
   - batch overflow => 413
   - single text too long => 422
4. Return structured error payload with `requestId` and `upstreamStatus` on upstream failure.
5. Apply the same CORS/security policy as `/api/chat` (origin allowlist + service token).

---

## 4. Frontend Binding Contract

### 4.1 Default settings

- `DEFAULT_STABLE_MODEL = deepseek-ai/DeepSeek-R1-Distill-Qwen-14B`
- `DEFAULT_BACKUP_MODEL = Qwen/Qwen3-14B`
- `DEFAULT_PROXY_BASE_URL = https://vesti-proxy.vercel.app/api`
- `chat route = ${proxyBaseUrl}/chat`
- `embeddings route = ${proxyBaseUrl}/embeddings`
- Legacy `proxyUrl` is read-only compatibility field and auto-migrates to `proxyBaseUrl`.

### 4.2 Demo normalize behavior

1. Demo mode lazily normalizes model selection to DS14.
2. Legacy demo model IDs auto-converge to DS14.
3. Gateway lock remains visible (`modelscope.cn`).

### 4.3 Settings UI expectations

1. Settings belongs to `app_shell` and uses sans typography.
2. Progressive disclosure hierarchy: `Save` primary, `Test` secondary.
3. Demo card must expose primary/backup routing policy.

---

## 5. Prompt/Schema Linkage (Insights)

1. Conversation default schema: `conversation_summary.v3`.
2. Weekly default schema: `weekly_lite.v2`.
3. Legacy coexistence remains required for one release cycle (`conversation_summary.v2` and `weekly_lite.v1` stay renderable).
4. Visual details are governed by `insights_prompt_ui_engineering.md`.

---

## 6. Observability and Alerts

### 6.1 Minimum logs

- `requestId`
- `attempt`
- `model`
- `upstreamStatus`
- `ttfbMs`
- `totalMs`
- `fallbackTriggered`

### 6.2 Alert conditions

1. Fallback rate spike above baseline
2. Timeout/latency surge
3. Upstream 429/5xx burst
4. Summary/Weekly empty-content rate increase

---

## 7. Acceptance and Rollback

### 7.1 Acceptance criteria (rc.4)

1. `/api/chat` passes OPTIONS + POST CORS checks.
2. Long payload pressure run meets success >= 95%, P95 < 20s.
3. Demo Summary and Weekly Lite generate without Edge-timeout failure pattern.
4. BYOK direct mode remains functional and key-isolated.

### 7.2 Rollback strategy

1. Keep Node runtime; tighten `max_tokens`/timeout if instability appears.
2. Emergency pin to primary-only model by disabling fallback branch.
3. Severe proxy instability: switch internal verification to BYOK route.

---

## Assumptions and Defaults

1. Platform path stays Vercel Node runtime in this release window.
2. Model lineup is fixed to DS14 primary + Qwen3-14B backup.
3. Automatic retry is capped at one fallback attempt.
4. Weekly stays `Weekly Lite` until data maturity.
5. UI semantics follow `insights_prompt_ui_engineering.md` as canonical source.
