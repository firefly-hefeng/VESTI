# Vesti v1.3 Phase3 Manual Sampling Checklist (Kimi + YUANBAO)

Date: 2026-03-07  
Owner: QA + Engineering  
Scope: Phase3 only (Kimi, YUANBAO) + legacy regression sanity

---

## 1. Exit Criteria

- Minimum cases completed:
  - Kimi: 6
  - YUANBAO: 6
  - Legacy regression sanity: 6
  - Total minimum: 18
- Go threshold:
  - Blocker = 0
  - Major <= 2 (must include owner + workaround + retest)
- Identity contract:
  - no stable URL session ID => `held/missing_conversation_id`

---

## 2. Preflight

- [ ] Latest rc.6 build loaded
- [ ] `pnpm -C frontend exec tsc --noEmit` passes
- [ ] `pnpm -C frontend build` passes
- [ ] `pnpm -C frontend eval:prompts --mode=mock --strict` passes
- [ ] Capture mode config verified (`mirror/smart/manual`)
- [ ] Supported hosts available:
  - [ ] `https://www.kimi.com/*`
  - [ ] `https://kimi.com/*`
  - [ ] `https://kimi.moonshot.cn/*` (compatibility check)
  - [ ] `https://yuanbao.tencent.com/*`

Per-case metadata must include:
- Commit SHA
- Browser version
- Host URL
- Mode
- Local timestamp

---

## 3. Case Matrix (Phase3 Mandatory)

### 3.1 Kimi (6)

1. `V13P3-KIMI-MIRROR-01` mirror, standard U-A-U-A, expected committed (`mode_mirror`)
2. `V13P3-KIMI-MIRROR-02` mirror, streaming update, expected no duplicate amplification
3. `V13P3-KIMI-SMART-01` smart threshold crossing, expected held then committed
4. `V13P3-KIMI-SMART-02` smart keyword block, expected `smart_keyword_blocked`
5. `V13P3-KIMI-MANUAL-01` manual + force archive, expected `mode_manual_hold` then `force_archive`
6. `V13P3-KIMI-MANUAL-02` missing stable ID, expected force blocked (`missing_conversation_id`)

### 3.2 YUANBAO (6)

7. `V13P3-YUANBAO-MIRROR-01` mirror, standard U-A-U-A, expected committed (`mode_mirror`)
8. `V13P3-YUANBAO-MIRROR-02` mirror, streaming update, expected no duplicate amplification
9. `V13P3-YUANBAO-SMART-01` smart threshold crossing, expected held then committed
10. `V13P3-YUANBAO-SMART-02` smart keyword block, expected `smart_keyword_blocked`
11. `V13P3-YUANBAO-MANUAL-01` manual + force archive, expected hold then force commit
12. `V13P3-YUANBAO-MANUAL-02` missing stable ID, expected `missing_conversation_id`

---

## 4. Regression Sanity (Legacy 6)

13. `V13P3-CHATGPT-R01`
14. `V13P3-CLAUDE-R02`
15. `V13P3-GEMINI-R03`
16. `V13P3-DEEPSEEK-R04`
17. `V13P3-QWEN-R05`
18. `V13P3-DOUBAO-R06`

Expected: capture and platform badge/thread mapping remain unchanged.

---

## 5. Evidence DoD

Per case must attach:
- [ ] metadata + verdict
- [ ] parser stats snippet
- [ ] governance decision snippet
- [ ] before/after IndexedDB snapshot or equivalent data diff
- [ ] timestamp-visible screenshot

Missing evidence invalidates the case.

---

## 6. Severity Rules

- Blocker: data loss, wrong governance decision in core path, force archive chain broken
- Major: stable role misclassification in normal flow, repeated duplicate writes
- Minor: non-blocking UI copy/status mismatch

---

## 7. Result Template

```md
# v1.3 Phase3 Sampling Result

- Planned: 18
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