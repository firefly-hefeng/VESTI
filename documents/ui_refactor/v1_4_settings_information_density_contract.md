# Vesti v1.4 Settings Information Density Contract

Version: v1.0  
Status: Decision Complete (documentation freeze)  
Scope: Settings information architecture, copy density, and support interaction semantics

---

## 1. Summary

This contract freezes the v1.4 Settings structure so design, frontend, and QA share one implementation baseline.

Locked decisions:
1. Settings is split into three semantic groups: `Personalisation` / `System` / `Support`.
2. Support uses three flat rows (not accordion): `Docs & Help`, `Send Feedback`, `What's New`.
3. `Send Feedback` uses inline reveal (email + copy action + GitHub Issue link).
4. Accordion copy follows minimal density: keep only instruction/status/warning text in UI.
5. Long-form explanation content moves to README instead of in-panel gray paragraphs.

---

## 2. Information Architecture

### 2.1 Group model

Order is fixed:
1. `Personalisation`
2. `System`
3. `Support`

### 2.2 Group ownership

`Personalisation`
- `Appearance` (accordion)
- `Language` (disabled-soon row; non-expandable)

`System`
- `Model Access` (accordion)
- `Capture Engine` (accordion)
- `Data Management` (accordion or link-to-data CTA container)

`Support`
- `Docs & Help` (flat external row)
- `Send Feedback` (flat row with inline reveal)
- `What's New` (flat external row)

No extra fourth support row is included in v1.4.

---

## 3. Support Contract

### 3.1 Row semantics

Support rows are navigation/utility exits, not settings containers.

Therefore:
- No accordion chevron semantics.
- No nested settings controls.
- Rows keep consistent click target and right-arrow affordance.

### 3.2 Destination URLs (frozen)

- `Docs & Help` -> `https://github.com/abraxas914/VESTI#readme`
- `Send Feedback` inline reveal content includes:
  - Email: `suyc23@gmail.com`
  - GitHub issue entry: `https://github.com/abraxas914/VESTI/issues/new/choose`
- `What's New` -> `https://github.com/abraxas914/VESTI/releases`

### 3.3 Send Feedback inline reveal

Click behavior:
1. click row -> expand inline block
2. click same row again -> collapse inline block

Inline block content:
- one short helper sentence
- email value + copy button
- secondary GitHub issue link

This interaction is disclosure behavior, not on/off toggle behavior.

---

## 4. Copy Density Contract

### 4.1 Text classes allowed in accordion body

Only three text classes are allowed:
1. **How to act** (instruction)
2. **Current state** (status)
3. **Risk now** (immediate warning/boundary)

### 4.2 Text classes moved out of UI

The following must be moved to README:
- architecture rationale
- model strategy background
- long-form behavior explanation
- historical/context narrative

### 4.3 Prohibited pattern

Do not introduce second-level toggle/disclosure controls whose only purpose is revealing explanatory paragraphs.

Rationale:
- adds interaction noise
- increases cognitive burden
- duplicates README responsibility

---

## 5. Visual Contract (Settings-specific)

1. Group labels are explicit and always visible.
2. Support rows use flat list rhythm, visually distinct from accordion sections.
3. Icon style baseline:
   - linear icon system
   - `stroke-width: 1.5`
   - 32px rounded icon container
4. Open/active state uses subtle emphasis (icon luminance/contrast), not strong accent color.

---

## 6. QA Acceptance Hooks

1. Three group labels exist and follow fixed order.
2. Language row is `Soon`, non-expandable, and does not show misleading affordance.
3. Support has exactly three rows and destination semantics are correct.
4. Send Feedback inline reveal expands/collapses and supports copy action.
5. Settings accordion text density follows minimal contract and does not reintroduce long gray paragraphs.

---

## 7. Explicit Assumptions

1. This is a documentation-only freeze; no runtime behavior change in this phase.
2. External links are MVP-compatible and do not require a dedicated help site.
3. Future i18n/content tuning can update wording, but not structure/ownership in v1.4.
