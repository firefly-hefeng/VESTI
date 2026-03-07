# Vesti v1.3 Platform Expansion Spec

Version: v1.3  
Status: Decision Complete (Phase 1/2 done, Phase 3 locked)  
Scope: Capture Engine + Sidepanel/Capsule platform mapping expansion (no governance semantic change)

---

## 1. Summary

v1.3 expands capture coverage from the legacy 6-platform baseline to 8 platforms, while keeping v1.2 governance unchanged.

Locked phase roadmap:
1. Phase 1: Gemini + DeepSeek (done)
2. Phase 2: Doubao + Qwen (done)
3. Phase 3: Kimi + YUANBAO (this cycle)

Locked policy for all phases:
- no stable platform session ID => `held/missing_conversation_id`
- force archive does not bypass missing ID
- no API/protocol/schema expansion

---

## 2. Scope and Boundaries

### In scope
- Add new capture hosts/content scripts/parsers for Kimi + YUANBAO.
- Extend `Platform` type and platform color mapping to 8 platforms.
- Extend sidepanel + capsule badge/thread-tone mapping for new platforms.
- Keep Threads page visual structure unchanged (only platform mapping expansion).

### Out of scope
- Governance decision engine redesign.
- New archive entry surfaces.
- DB schema migrations.
- Non-capture page layout redesign.

---

## 3. Phase 3 Rollout (Locked)

### 3.1 Host scope (strict primary domains)
- `https://www.kimi.com/*` (primary)
- `https://kimi.com/*` (primary)
- `https://kimi.moonshot.cn/*` (temporary compatibility)
- `https://yuanbao.tencent.com/*`

### 3.2 Platform naming
- `Kimi`
- `YUANBAO` (uppercase, no Chinese alias in type/display contract)

### 3.3 Platform color contract (8 platforms)
- ChatGPT `#10A37F`
- Claude `#CC785C`
- Gemini `#AD89EB`
- DeepSeek `#0D28F3`
- Qwen `#615CED`
- Doubao `#1E6FFF`
- Kimi `#181C28`
- YUANBAO `#00C5A3`

---

## 4. Platform Onboarding Contract (Mandatory)

### 4.1 Parser strategy stack
1. selector strategy
2. anchor fallback
3. text/noise cleanup
4. near-duplicate suppression

### 4.2 Parse stats contract
Each parse cycle logs:

```ts
{
  platform: Platform
  source: "selector" | "anchor"
  totalCandidates: number
  keptMessages: number
  roleDistribution: { user: number; ai: number }
  droppedNoise: number
  droppedUnknownRole: number
  parse_duration_ms: number
}
```

### 4.3 Identity contract
- Session UUID must come from stable URL/query IDs.
- No fallback synthetic IDs.
- Missing stable ID remains blocked by governance with `missing_conversation_id`.

---

## 5. File and Module Mapping (Phase 3)

### 5.1 Content entrypoints
- `frontend/src/contents/kimi.ts`
- `frontend/src/contents/yuanbao.ts`

### 5.2 Parser modules
- `frontend/src/lib/core/parser/kimi/KimiParser.ts`
- `frontend/src/lib/core/parser/yuanbao/YuanbaoParser.ts`

### 5.3 Shared type/runtime updates
- `frontend/src/lib/types/index.ts`
- `packages/vesti-ui/src/types.ts`
- `frontend/src/background/index.ts`
- `frontend/src/contents/capsule-ui.ts`

### 5.4 UI token/mapping updates (no layout changes)
- `frontend/src/style.css`
- `frontend/tailwind.config.ts`
- `frontend/src/sidepanel/components/platformTone.ts`
- `frontend/src/sidepanel/pages/InsightsPage.tsx`
- `frontend/src/sidepanel/types/timelineFilters.ts`
- `frontend/src/sidepanel/pages/SettingsPage.tsx`

---

## 6. Regression Rules

Must not regress:
1. Legacy 6-platform capture behavior.
2. v1.2 mirror/smart/manual semantics.
3. FORCE_ARCHIVE_TRANSIENT pipeline and reason codes.
4. Threads page visual structure (header/spacing/density/radius policy unchanged).

---

## 7. Release Gates (Phase 3)

Required commands:
- `pnpm -C frontend exec tsc --noEmit`
- `pnpm -C frontend build`
- `pnpm -C frontend eval:prompts --mode=mock --strict`
- `pnpm -C vesti-web build` only if web side type contract changes

Manual QA artifacts:
- `documents/capture_engine/v1_3_phase3_manual_sampling_checklist.md`
- `documents/capture_engine/v1_3_phase3_execution_log.md`

Go/No-Go:
- Blocker = 0
- Major <= 2 with owner/workaround/retest plan

---

## 8. Assumptions

1. Host policy remains strict to phase-3 primary domains (`www.kimi.com`, `kimi.com`, `yuanbao.tencent.com`) with one-cycle compatibility for `kimi.moonshot.cn`.
2. Release target is `v1.2.0-rc.6`.
3. This cycle does not alter public APIs (`/api/chat`, `/api/embeddings`) or schema.