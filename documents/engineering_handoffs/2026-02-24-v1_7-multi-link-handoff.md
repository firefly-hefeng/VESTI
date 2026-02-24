# Engineering Handoff - v1.7 Multi-Link API + BYOK Lockdown

Date: 2026-02-24
Owner Session: Codex (GPT-5)

## 1) Scope completed in this session

Primary scope delivered in `vesti` repo:
1. BYOK model selection changed from free text to whitelist-only UI.
2. BYOK model normalization hardened in config layer (invalid model auto-fallback).
3. v1.7 one-page multi-link API summary doc added (RPC/Event/Persistence).

No parser changes in this session.
No skill markdown files were modified.

## 2) Repos and branch snapshot

### A) Extension repo
- Repo: `D:\python_code\Hackathon\vesti`
- Branch: `feature/ui-minimalist-sidebar-compare`
- HEAD: `33069b0`
- Latest two commits:
  1. `33069b0` feat: lock BYOK models and add v1.7 multi-link API summary
  2. `408942b` fix(parser): harden doubao CoT segmentation and noise filtering
- Working tree: clean

### B) Proxy repo
- Repo: `E:\GT\DEV\vesti-proxy`
- Branch: `main`
- HEAD: `7abc686`
- Working tree: clean

## 3) Delivered file changes (extension)

1. `frontend/src/lib/services/llmConfig.ts`
- Added BYOK whitelist constant.
- Added `sanitizeByokModelId(...)`.
- Enforced whitelist in `normalizeLlmSettings(...)` for `custom_byok` mode.
- Guarded `getEffectiveModelId(...)` for `custom_byok` mode.

2. `frontend/src/sidepanel/pages/SettingsPage.tsx`
- Replaced BYOK model free input with static `<select>`.
- Source options now from whitelist only.
- Save/test path now resolves through sanitized BYOK model.

3. `documents/orchestration/v1_7_multi_link_api_summary.md`
- Added one-page status of runtime RPC/Event/Persistence contracts.
- Includes route topology, current code-vs-doc gaps, and engineering guardrails.

## 4) Validation executed

1. Build gate executed:
- Command: `pnpm -C frontend build`
- Result: pass (`plasmo build` success)

2. Commit + push executed:
- Commit: `33069b0`
- Remote: `origin/feature/ui-minimalist-sidebar-compare`
- Push status: successful (remote branch updated)

## 5) Important current architecture truth (for next window)

### A) Extension runtime truth
1. Insight pipeline progress event (`INSIGHT_PIPELINE_PROGRESS`) is documented, but not wired in code yet.
2. Current sidepanel refresh relies on coarse event `VESTI_DATA_UPDATED`.
3. Embedding service exists in code (`requestEmbeddings`) but currently has no active call site.

### B) Proxy runtime truth (`vesti-proxy`)
1. Only route currently implemented: `POST /api/chat` (`api/chat.js`).
2. No `/api/embeddings` route yet.
3. CORS is currently permissive (`Access-Control-Allow-Origin: *`) and does not include `x-vesti-service-token` in allowed headers.
4. No service-token auth check in current proxy handler.
5. Vercel config exists and sets `api/chat.js` maxDuration to 60s.

## 6) Known gaps and risks

1. BYOK direct route host permissions not yet added in extension manifest config.
- Current `frontend/package.json` host permissions list chat platforms only.
- Missing explicit ModelScope direct API host permission may cause runtime fetch/CORS issues depending on browser enforcement path.

2. Proxy and extension security contract are not fully aligned yet.
- Extension can send `x-vesti-service-token`, but proxy currently does not validate it.
- Proxy CORS allowed headers currently omit `x-vesti-service-token`.

3. Embeddings multi-link path is not end-to-end ready.
- Extension has embeddings route logic.
- Cloud proxy currently has no `/api/embeddings`.

4. Schema contract drift risk remains.
- Some v1.7 docs discuss newer schema targets, while runtime currently stores v1/v2 summary and v1/lite-v1 weekly.

## 7) Recommended next execution order (new window)

1. Proxy hardening first (`vesti-proxy`):
- Add `POST /api/embeddings` route.
- Add strict CORS allowlist policy (no wildcard for prod).
- Add service token validation (`x-vesti-service-token`) and include this header in preflight allowed headers.
- Keep request-id + structured error envelope parity across chat/embeddings.

2. Extension permission and mode alignment (`vesti`):
- Add host permission for `*://api-inference.modelscope.cn/*`.
- If direct embeddings path will be used, decide and add required host permission for DashScope-compatible endpoint too.

3. Event contract implementation (`vesti`):
- Add typed `INSIGHT_PIPELINE_PROGRESS` runtime emission + sidepanel consumer dedupe.
- Keep `VESTI_DATA_UPDATED` as coarse fallback.

4. Optional release hygiene:
- Add deployment-as-code conventions for cloud proxy env contract and versioned route checks.

## 8) Quick start commands for next Codex session

### Extension repo
1. `git -C D:\python_code\Hackathon\vesti status --short`
2. `git -C D:\python_code\Hackathon\vesti log -2 --oneline --decorate`
3. `pnpm -C D:\python_code\Hackathon\vesti\frontend build`

### Proxy repo
1. `git -C E:\GT\DEV\vesti-proxy status --short`
2. `git -C E:\GT\DEV\vesti-proxy log -1 --oneline --decorate`
3. `Get-ChildItem E:\GT\DEV\vesti-proxy\api`

## 9) Handoff references

1. Previous parser hotfix handoff:
- `documents/engineering_handoffs/2026-02-23-codex-handoff-claude-reader.md`

2. Doubao segmentation memo:
- `documents/engineering_handoffs/2026-02-23-doubao-cot-segmentation.md`

3. v1.7 API status summary (this phase):
- `documents/orchestration/v1_7_multi_link_api_summary.md`

## 10) Update (2026-02-24) - Hackathon MVP soft-guard + Agent A patch

Status: implemented, validated locally, pending commit hash annotation in this memo.

### A) vesti-proxy (`E:\\GT\\DEV\\vesti-proxy`)

1. `api/chat.js` now has high-threshold soft protection:
- rate limit: `300/10min` + burst `120/60s`
- concurrency: global `200`, per-ip `40`
- circuit breaker: 60s window, min `80` samples, open `15s`, half-open `12` probes
2. New runtime error codes:
- `RATE_LIMITED` (429)
- `PROXY_OVERLOADED` (503)
- `CIRCUIT_OPEN` (503)
3. New operational headers:
- `retry-after`
- `x-rate-limit-limit`
- `x-rate-limit-remaining`
- `x-rate-limit-reset`
4. CORS preflight now allows `x-vesti-service-token` header (still anonymous-access mode).

### B) vesti extension (`D:\\python_code\\Hackathon\\vesti`)

1. Prompt system extended with Agent A entry:
- new `PromptType`: `compaction`
- new prompt module: `frontend/src/lib/prompts/compaction.ts`
- prompt registry wired in `frontend/src/lib/prompts/index.ts`
2. Summary generation chain changed to:
- `compaction -> structured summary parse -> repair -> fallback text`
- compaction failure auto-falls back to direct summary path.
3. Added summary observability fields in logs:
- `compactionUsed`
- `compactionFailed`
- `compactionCharsIn`
- `compactionCharsOut`
- `summaryPath`
4. Weekly stabilization:
- weekly candidate ranking now prioritizes records with structured summary evidence.
- weekly input assembly logs include:
  - `summaryEvidenceCount`
  - `structuredEvidenceCount`

### C) Validation

1. `pnpm -C frontend build` -> pass
2. `pnpm -C frontend eval:prompts --mode=mock --strict` -> pass
3. `node --check E:\\GT\\DEV\\vesti-proxy\\api\\chat.js` -> pass
