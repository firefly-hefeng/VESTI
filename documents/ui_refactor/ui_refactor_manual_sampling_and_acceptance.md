# Vesti UI Refactor Manual Sampling and Acceptance (v1.4)

Version: v1.1  
Status: QA Gate Spec  
Audience: QA, release owner, frontend, UI design

---

## 1. Sampling Coverage

Minimum mandatory set:
- 4 top-level regions x 3 scenario types = 12 base cases
- plus 4 Threads->Reader child-flow cases
- plus 12 cross-cutting interaction and boundary cases
- total minimum: 28 cases

Scenario types:
1. standard ready state
2. loading/empty/error state
3. primary action path

---

## 2. Region Matrix (Mandatory)

Regions:
- Threads
- Insights
- Data
- Settings

Per region must validate:
- information hierarchy readability
- primary action discoverability
- state rendering consistency

Threads child flow (mandatory):
- open Reader from thread card
- Reader back navigation to Threads list
- selected conversation context continuity
- refresh behavior after `VESTI_DATA_UPDATED`

---

## 3. Cross-Cutting Scenarios (Minimum 12)

1. Keyboard navigation end-to-end.
2. Focus-visible correctness for icon buttons.
3. Card action row click precision.
4. Long-title truncation behavior.
5. Mixed-language text rendering (EN + 中文).
6. Platform tag contrast and consistency.
7. Small viewport density check.
8. Center action availability in mirror/smart/manual modes.
9. Center action disabled reason copy correctness.
10. KB entry exists in Insights header and nowhere else as structural entry.
11. Compaction trigger in Threads + compaction stats in Data.
12. External links placed in Settings only.
13. Threads full-text search: query hits title, no `Matched in messages` hint.
14. Threads full-text search: query hits only message body, hint appears.
15. Query length 1 does not trigger body-scan behavior; result remains title/snippet-only.
16. Right navigation rail width remains `52px` and main content area expansion is visually preserved.

---

## 4. Required Evidence per Case (DoD)

Each case must include:
- Case ID, region, scenario
- expected/actual/verdict
- timestamp
- screenshot
- if action case: short interaction log

For regression-sensitive cases, include:
- pre-refactor screenshot reference
- post-refactor screenshot

For full-text search cases, include:
- search query string and expected hit source (title/snippet/body)
- screenshot proof of `Matched in messages` hint presence/absence

For navigation-rail calibration case, include:
- screenshot or DevTools evidence showing rail width is `52px` on sidepanel root

---

## 5. Severity and Release Gate

Severity:
- Blocker:
  - critical action unreachable
  - data-destructive action guard missing
  - page unusable due to layout break
  - IA boundary violation causing misplacement of core function
- Major:
  - wrong state rendering
  - accessibility path broken
  - repeated interaction misfire
- Minor:
  - visual inconsistency without functional impact

Go/No-Go threshold:
- `Blocker = 0`
- `Major <= 2` with owner + workaround + retest plan

---

## 6. Build Gate

Required:
- `pnpm -C frontend build`
- `pnpm -C frontend package`

---

## 7. Result Template

```md
# v1.4 UI Refactor Sampling Result

- Planned: 28
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
