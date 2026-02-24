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

## 11) Update (2026-02-24) - Insights truncation investigation log (summary + weekly)

Status: investigation completed, patch plan approved for immediate implementation.

### A) Symptom snapshot

1. In Insights cards, section headers show a trailing number on the far right (`2`, `3`, `5`, etc.) connected by a horizontal divider line.
2. Summary `unresolved_threads` and `actionable_next_steps` often render as fragmented short tokens.
3. Weekly Digest sections (`highlights`, `recurring_questions`, `unresolved_threads`, `suggested_focus`) can degrade into heavily truncated fragments.

### B) Root-cause split (UI vs pipeline)

1. Header trailing number is a UI rendering choice, not backend corruption.
   - Render source: `frontend/src/sidepanel/pages/InsightsPage.tsx` (`ins-thread-sec-count`, `ins-week-sec-count`).
2. Fragmented item texts are primarily data-pipeline quality issues, not CSS clipping.
   - Item rendering is direct `{item}` with no line clamp in the related classes.
   - Current schema normalization allows ultra-short strings (`min(1)` + `cleanItem(...)`), so low-signal fragments pass through.
3. Weekly prompt quality regression exists in current prompt file.
   - `frontend/src/lib/prompts/weeklyDigest.ts` contains mojibake/encoding-damaged prompt content and malformed interpolation text, which degrades structured output quality.

### C) Immediate patch plan

1. Prompt layer:
   - Rewrite `frontend/src/lib/prompts/weeklyDigest.ts` with clean UTF-8-safe content and strict weekly_lite JSON constraints.
   - Add explicit "no fragment items" guidance in prompt rules.
2. Schema normalization layer:
   - Add narrative-item quality filter in `frontend/src/lib/services/insightSchemas.ts`.
   - Drop low-signal fragments before persisting structured arrays for unresolved/next/highlights/focus fields.
3. Adapter display guard:
   - Add the same low-signal filtering in `frontend/src/lib/services/insightAdapter.ts` for previously stored records.
4. UI polish:
   - Hide right-edge section count chips in Insights section headers.
   - Add defensive text wrapping for unresolved/next/highlight item text classes.

### D) Acceptance focus for this patch

1. Header right-edge numeric artifacts no longer appear.
2. Newly generated summary/weekly records no longer contain 1-3 char fragment items in core list sections.
3. Existing stored records are displayed with adapter-level filtering to avoid visible fragment pollution.
4. `pnpm -C frontend build` passes after patch.

## 12) Update (2026-02-24) - Summary density gate patch (unresolved / next)

Status: implemented and validated locally (`build` + `eval:prompts` pass).

### A) Root-cause model

1. This is not an intentional product behavior.
2. Sparse `unresolved_threads` / `actionable_next_steps` is caused by combined effects of:
   - Agent A compaction reducing context granularity,
   - Agent B strict evidence-preserving output,
   - missing semantic density gate after JSON parse success.
3. Result: payload can be structurally valid but still semantically low-utility.

### B) Runtime changes

1. Prompt constraints strengthened in `frontend/src/lib/prompts/conversationSummary.ts`:
   - unresolved/next entries must be complete short phrases,
   - evidence-sufficient case targets `2-4` entries each,
   - evidence-sparse case allows `1` or `[]`,
   - no unsupported facts.
2. `frontend/src/lib/services/insightGenerationService.ts` now adds density gate after parse:
   - evidence scoring:
     - `thinking_journey >= 4` => +1
     - `key_insights >= 3` => +1
     - `messages >= 8` => +1
   - evidence-sufficient when score `>= 2`.
   - if sufficient but unresolved/next `< 2`, mark `INSUFFICIENT_LIST_DENSITY` and trigger semantic repair prompt.
3. Degraded keep strategy:
   - if repair still sparse but valid, keep better structured candidate (instead of immediate plain-text fallback),
   - mark degraded state for observability.
4. `frontend/src/lib/services/insightSchemas.ts` tightened low-signal filters for summary narrative items:
   - CJK `< 6` treated low-signal,
   - short action stubs (e.g. very short `获取XX/确认XX`) blocked.

### C) New observability fields

`generateConversationSummary` logs now include:
1. `density_gate_triggered`
2. `density_gate_passed`
3. `density_gate_degraded`
4. `unresolved_count`
5. `next_steps_count`
6. `evidence_score`

### D) Acceptance checks

1. High-evidence thread (`>=8` messages, multi-turn reasoning):
   - unresolved and next are each `2-4` complete items.
2. Low-evidence thread:
   - allows `1` or `[]`, but no short fragment stubs.
3. Gate path observable:
   - logs can show `density_gate_triggered=true` and degraded marker when applicable.
4. No schema migration:
   - still `conversation_summary.v2`.

## 13) Update (2026-02-24) - Weekly Digest strict alignment (Agent C)

Status: implemented locally (v1-compatible extension, no DB migration).

### A) Runtime alignment

1. Weekly aggregation is now `summary_v2_only`:
   - Agent C input uses structured `conversation_summary.v2` entries as primary evidence.
   - `conversation_summary.v1` is excluded from weekly aggregation input.
2. Added strict Sub-3 circuit breaker in runtime:
   - if substantive structured samples `< 3`, weekly generation short-circuits before inference.
   - output sets `insufficient_data=true`.
   - `highlights` keeps exactly one factual sentence.
   - `recurring_questions/cross_domain_echoes/unresolved_threads/suggested_focus/evidence` are forced to `[]`.
3. `time_range.total_conversations` now reflects substantive structured sample count.

### B) Schema & compatibility

1. `weekly_lite.v1` is extended in-place with `cross_domain_echoes`:
   - no schema version bump to v2.
2. New generations always include `cross_domain_echoes` (empty array allowed).
3. Historical records missing `cross_domain_echoes` are read with adapter fallback `[]`.
4. No Dexie schema migration, no historical backfill.

### C) Observability fields

Weekly logs now include:
1. `weekly_sub3_triggered`
2. `weekly_substantive_count`
3. `weekly_structured_count`
4. `weekly_input_mode` (`summary_v2_only`)

## 14) Update (2026-02-24) - Weekly Digest regression hotfix (quality gate)

Status: implemented locally as hotfix, pending final visual verification.

### A) Trigger symptom

1. Weekly `Next Week` displayed low-signal fragments such as `深` and `-> 深`.
2. Weekly section headers showed trailing numeric counters that looked like UI noise.
3. Regression surfaced after stacked changes in prompt language, normalization, and auto-summary fast path.

### B) Root-cause chain

1. `weeklyDigest` current prompt shifted to an English rule surface, while runtime/UI remained Chinese-first.
2. `suggested_focus` lost non-empty fallback when `insufficient_data=false`.
3. Weekly normalization accepted very short strings (`min(1)` + no narrative gate on weekly lists).
4. Weekly auto-summary path used `skipCompaction`, which increased low-quality summary risk.

### C) Hotfix actions

1. `frontend/src/lib/prompts/weeklyDigest.ts`
- Restored Chinese system/user/fallback prompts.
- Kept `weekly_lite.v1` structure, `summary_v2` evidence boundary, and strict sub-3 semantics.
- Added hard anti-fragment rule for `unresolved_threads` and `suggested_focus`.
- Bumped prompt version to `v1.3.1-hotfix1`.

2. `frontend/src/lib/services/insightSchemas.ts`
- Weekly normalization now applies narrative filtering to:
  - `unresolved_threads`
  - `suggested_focus`
- If `insufficient_data=false` and `suggested_focus` becomes empty after filtering, inject:
  - `下周优先推进一个高价值问题并记录验证结果。`
- `insufficient_data=true` strict empty-array behavior unchanged.

3. `frontend/src/lib/services/insightAdapter.ts`
- Display path now applies the same narrative filtering for weekly unresolved/focus fields.
- Added display-time fallback sentence for old records when:
  - `insufficient_data=false`
  - filtered `suggested_focus` is empty.

4. `frontend/src/lib/services/insightGenerationService.ts`
- Weekly auto-summary keeps concurrency/attempt guardrails, but disables `skipCompaction`.
- Added observability field:
  - `weekly_auto_summary_mode: "full_compaction"`
- Existing counters retained:
  - `weekly_auto_summary_attempted`
  - `weekly_auto_summary_generated`

5. `frontend/src/sidepanel/pages/InsightsPage.tsx`
- Removed right-side section count chips for weekly modules:
  - `Highlights`
  - `Recurring Questions`
  - `Unresolved`
  - `Next Week`

### D) Rollback point

1. Primary rollback unit: weekly narrative gate in `insightSchemas.ts` (if over-filtering occurs).
2. Keep prompt Chinese restoration and UI counter removal during rollback.
3. No schema migration involved, rollback cost remains low.

## 15) Update (2026-02-24) - Weekly Digest baseline hardening (long-term)

Status: implemented in `weekly_lite.v1` compatibility mode (no DB schema migration).

### A) Baseline objective

1. Move Weekly from “JSON parse success” to “semantic-usable quality pass”.
2. Eliminate low-signal fragments (`中`, `Gi`, `深`, arrow stubs) by runtime gate, not only by prompt wording.
3. Keep historical data strategy as read-time cleanup only (no bulk backfill).

### B) Runtime pipeline changes

1. `frontend/src/lib/prompts/weeklyDigest.ts`
   - Fully rewritten as Chinese strict baseline prompt.
   - Version bumped to `v1.4.0-baseline1`.
   - Hard constraints preserved for:
     - `weekly_lite.v1` JSON-only output
     - evidence-bound claims
     - strict sub-3 short-circuit
     - anti-fragment narrative requirement
2. `frontend/src/lib/services/insightSchemas.ts`
   - Added weekly narrative normalization for all key lists:
     - `highlights`
     - `recurring_questions`
     - `unresolved_threads`
     - `suggested_focus`
   - Added semantic quality validator:
     - `validateWeeklySemanticQuality(...)`
     - issue codes for low-signal, non-question recurring, and empty-valid fallbacks.
3. `frontend/src/lib/services/insightGenerationService.ts`
   - Weekly generation now enforces:
     - parse -> semantic gate -> semantic repair (max 2 rounds) -> degrade to `insufficient_data`.
   - No schema bump; final structure remains `weekly_lite.v1`.
   - Added guarded prompt builder to preserve constraint blocks under token/char budget.
   - Removed malformed mojibake fallback literals in weekly path.
4. `frontend/src/lib/services/insightAdapter.ts`
   - Read-path filtering now also applies to weekly `highlights` and `recurring_questions` (not only unresolved/focus).
   - Old records without stable narrative are cleaned at display time.
5. `frontend/src/sidepanel/pages/InsightsPage.tsx` + `frontend/src/style.css`
   - Added lightweight sparse-card note when report is `insufficient_data` and generated in degraded/fallback status.

### C) New weekly observability fields

Weekly generation logs now include:
1. `weekly_semantic_gate_passed`
2. `weekly_semantic_issue_codes`
3. `weekly_semantic_repair_attempt`
4. `weekly_degraded_to_insufficient`
5. `weekly_highlights_after_filter`
6. `weekly_recurring_after_filter`
7. `weekly_auto_summary_mode=full_compaction`
8. `weekly_input_mode=summary_v2_only`

### D) Eval/CI hard gate upgrade

1. `scripts/eval-prompts.ts` weekly parser migrated to `weekly_lite.v1` path.
2. Added weekly semantic metrics:
   - `weeklyLowSignalItemRate`
   - `weeklyMinCompleteSentenceRate`
   - `weeklyEvidenceConsistencyRate`
   - `weeklySemanticPassRate`
3. `--strict` now fails if weekly semantic thresholds are not met.
4. Added weekly gold cases:
   - `weekly-004-fragment-rejection`
   - `weekly-005-sub3-circuit-hardstop`
   - `weekly-006-evidence-consistency`
   - `weekly-007-chinese-output-stability`

### E) Rollback points

1. Level-1 rollback: disable weekly semantic gate and keep prompt baseline.
2. Level-2 rollback: revert weekly generation to pre-gate path.
3. No storage schema migration; rollback remains low-cost.

## 16) Update (2026-02-24) - Weekly semantic gate severity profile (Hackathon Lenient)

Status: implemented, schema unchanged (`weekly_lite.v1`).

### A) Why this update

1. User-visible issue: weekly could downgrade to sparse even when `substantive summaries >= 3`.
2. Root cause: weekly semantic gate treated any issue code as hard failure.
3. Effect: warning-grade issues (for example suggested-focus sparsity) could trigger full degrade.

### B) Runtime policy change

1. Semantic issues are now split into severity levels:
   - hard:
     - `LOW_SIGNAL_HIGHLIGHT`
   - warning:
     - `EMPTY_VALID_HIGHLIGHTS`
     - `LOW_SIGNAL_RECURRING`
     - `RECURRING_NOT_QUESTIONLIKE`
     - `LOW_SIGNAL_UNRESOLVED`
     - `LOW_SIGNAL_SUGGESTED_FOCUS`
     - `EMPTY_VALID_SUGGESTED_FOCUS`
2. `validateWeeklySemanticQuality(...)` passes when hard issue count is zero.
3. Warning-only outputs are allowed to pass and persist (no forced sparse degrade).
4. Repair loop is still used for hard failures or parse/schema errors.
5. Final degrade to `insufficient_data=true` now requires unresolved hard failures (or parse/schema failure).
6. `LOW_SIGNAL_HIGHLIGHT` now follows a stricter signal test:
   - fail only when there is no high-signal highlight item at all.
7. Weekly normalization now injects an evidence-backed highlight fallback when:
   - `insufficient_data=false`
   - `highlights` becomes empty after narrative filtering.

### C) Observability additions

Weekly logs now include:
1. `weekly_semantic_hard_issue_codes`
2. `weekly_semantic_warning_issue_codes`
3. Existing `weekly_semantic_issue_codes` remains as full set for compatibility.

### D) UI alignment

1. Sparse reason display is constrained to:
   - `sub3` (structured sample count `< 3`)
   - `semantic_degraded` (non-sub3 sparse result)
2. This avoids the previous misleading "not enough data" implication in warning-only quality cases.

## 17) Update (2026-02-24) - Agent A runtime baseline restore (no skill-doc edits)

Status: implemented at runtime prompt layer only.

### A) Scope boundary

1. Kept `documents/prompt_engineering/*.md` unchanged as canonical baselines.
2. Restored only runtime prompt behavior for Agent A and A->B mapping constraints.

### B) Runtime changes

1. `frontend/src/lib/prompts/compaction.ts`
   - Rewrote Agent A system prompt with fixed markdown anchors:
     - `## Core Logic Chain`
     - `## Concept Matrix`
     - `## Unresolved Tensions`
   - Added hard constraints for:
     - evidence-only extraction
     - explicit `[User]/[AI]` ownership
     - chronological reasoning preservation
     - no fabrication / no code fences
     - sparse-input minimal valid skeleton fallback
   - Prompt version bumped to `v1.0.0-agent-a-baseline1`.

2. `frontend/src/lib/services/insightGenerationService.ts`
   - `buildSummaryPromptFromCompaction(...)` now carries stricter `conversation_summary.v2` mapping rules:
     - 2-3 sentence assertion per journey step
     - plain-language `real_world_anchor`
     - complete short sentences for unresolved/next-step lists
     - evidence-only mapping with no unsupported fact injection.

## 18) Update (2026-02-24) - Weekly temporary freeze + v1.7 progress event rollout

Status: implemented in current branch, no schema migration.

### A) Weekly temporary freeze (UI only)

1. `frontend/src/sidepanel/pages/InsightsPage.tsx`:
   - Weekly Digest accordion is now shelved as `Soon` (`disabled + soonTag`).
   - Weekly generate/read effects are short-circuited under `WEEKLY_DIGEST_SOON=true`.
   - Weekly runtime/service code is retained for future re-enable; only UI entry is frozen.
2. No deletion of weekly persistence or generation functions.
3. Goal: remove unstable user-facing experience while preserving backend recovery path.

### B) Unresolved weekly blocker kept explicit

1. `buildWeeklySemanticRepairPrompt(...)` in
   `frontend/src/lib/services/insightGenerationService.ts` still contains mojibake text.
2. This is recorded as a known quality blocker for the next Weekly re-enable window.

### C) v1.7 progress event contract implemented in runtime

1. Added push message contract `INSIGHT_PIPELINE_PROGRESS` in
   `frontend/src/lib/messaging/protocol.ts`.
2. Summary/Weekly generation now emit stage events with monotonic `seq`:
   - `initiating_pipeline`
   - `distilling_core_logic` (summary)
   - `curating_summary` (summary)
   - `aggregating_weekly_digest` (weekly)
   - `persisting_result`
   - terminal `completed | degraded_fallback`
3. Sidepanel now listens and dedupes by `pipelineId + seq`.
4. Thread Summary generating UI prioritizes live pipeline events; elapsed-timer phase mapping remains as fallback.

## 12) Update (2026-02-24) - P0 Summary runtime hardening handoff

Detailed postmortem + reusable patterns:
- documents/engineering_handoffs/2026-02-24-p0-summary-runtime-hardening-handoff.md

