# Vesti v1.4 UI Refactor Engineering Spec

Version: v1.4  
Status: Decision Complete (spec baseline)  
Scope: Sidepanel visual architecture and interaction refactor (without capture semantics change)

---

## 1. Summary

v1.4 performs a large-scale UI refactor for sidepanel surfaces to improve consistency, readability, and decision efficiency.

Primary goals:
1. Unify IA and component language across Threads / Insights / Data / Settings.
2. Treat Reader as Threads drill-down flow instead of top-level page semantics.
3. Improve density control and action discoverability without increasing cognitive load.
4. Keep behavior semantics stable: capture decisions, storage flow, and data model remain unchanged.

Locked constraints:
- No parser/platform scope change.
- No capture governance rule change.
- No DB schema migration in v1.4.

IA source of truth:
- `documents/ui_refactor/v1_4_information_architecture_contract.md`
- `documents/ui_refactor/v1_4_settings_information_density_contract.md`

---

## 2. Current Baseline (As-Is)

- UI entry: `frontend/src/sidepanel/VestiSidepanel.tsx`.
- Current route structure:
  - `timeline` (currently includes list and reader split behavior)
  - `insights`
  - `settings`
  - `data`
- Current user-facing naming still references Timeline in some surfaces.
- Design tokens: `frontend/src/style.css` + `frontend/tailwind.config.ts`.
- Refresh trigger: runtime `VESTI_DATA_UPDATED`.

Known pain points:
- IA naming and route semantics are not fully aligned.
- Cross-page layout rhythm is partially inconsistent.
- Action priority is mixed in some cards.
- Long-content scanning cost is high in Threads/Insights transitions.

---

## 3. In Scope / Out of Scope

### In scope
- Sidepanel global shell layout refactor.
- Threads / Insights / Data / Settings visual and interaction harmonization.
- Reader treatment as child drill-down flow under Threads.
- Center logo contract alignment: single manual archive action.
- Knowledge base entry placement at Insights header.
- Compaction split ownership UI: trigger in Threads, metrics/audit in Data.
- Component-level hierarchy and spacing system normalization.
- Status, button, empty/error/loading states standardization.
- Design token cleanup and component contract alignment.

### Out of scope
- capture protocol changes.
- parser updates.
- floating capsule implementation (moved to v1.5).
- export format/schema changes.
- route id migration from `timeline` to `threads` in code (kept for v1.4 compatibility).

---

## 4. UI Architecture Contract

## 4.1 Navigation model
- Four top-level regions:
  - Threads
  - Insights
  - Data
  - Settings
- Reader remains Threads-internal drill-down state.
- Internal route id compatibility remains `timeline | insights | data | settings`.
- Right-side navigation rail is width-calibrated to `52px` (~0.8x of original 64px baseline).

## 4.2 Center logo action
- Must be a single deterministic action: manual archive active thread.
- No hover hub / quick links fan-out in v1.4.
- Disabled reason feedback must map to capture state contract.

## 4.3 Knowledge base entry
- Structural entry is in Insights header.
- Not placed as global dock action in v1.4.

## 4.4 Surface hierarchy
- Level 0: app background
- Level 1: page surface
- Level 2: card/container surface
- Level 3: inline accent surface

Each level must map to explicit design tokens (background, border, shadow, text contrast).

## 4.5 Action hierarchy
- Primary action: one per major section.
- Secondary actions: grouped and visually subordinate.
- Destructive actions: isolated with explicit confirmation guard.

## 4.6 Settings density and grouping
- Settings is grouped into `Personalisation`, `System`, and `Support`.
- `Appearance` and system controls remain disclosure-based.
- `Language` is a disabled-soon non-expandable row (no chevron affordance).
- `Support` is a flat-row block (`Docs & Help`, `Send Feedback`, `What's New`) rather than accordion.
- `Send Feedback` uses inline reveal (email + copy + issue link), not toggle semantics.

---

## 5. Component Scope

Target components:
- `ConversationCard`
- `MessageBubble`
- `PlatformTag`
- `SearchInput`
- `StructuredSummaryCard`
- `StructuredWeeklyCard`
- `DataManagementPanel`
- shared button/field/state patterns in `SettingsPage`
- dock and center action affordance components

Requirements:
- keep existing business props stable where possible.
- if prop changes are required, update all call sites in same milestone.

---

## 6. UX Behavior Rules

1. All regions must have deterministic loading, empty, and error states.
2. Long text blocks must support controlled truncation + expansion where needed.
3. Keyboard interaction for primary controls must remain functional.
4. Threads card quick actions must remain one-click accessible.
5. Message/turn labels and platform tags must keep semantic consistency.
6. Center logo action states must be visually distinct and diagnosable.
7. Threads search contract:
   - Search scope = `title + snippet + messages.content_text` (user + ai).
   - Full-text body scan triggers only when query length is `>=2`.
   - Result ordering remains `updated_at` descending.
   - If matched only in message body, show subtle hint `Matched in messages`.
8. Settings copy density contract:
   - Keep only instruction/status/warning copy in accordion body.
   - Move long-form explanation text to README.
   - Do not add second-level explanation toggles.

---

## 7. Implementation Phases

### Phase 1 (P0): IA and shell alignment
- apply naming contract in UI copy (`Threads` label)
- unify page scaffold and spacing scale
- normalize typography hierarchy
- calibrate right navigation rail width to preserve usable main-content space

### Phase 2 (P0): Threads + Reader flow
- refactor card information hierarchy
- optimize Reader message layout and metadata row
- align per-thread actions (including compaction trigger location)
- integrate full-text search merge path (title/snippet + message body) with debounce/cache/race guard

### Phase 3 (P0): Insights + Data + Settings
- standardize Insights header (including KB entry)
- normalize Data dashboard composition and compaction audit surface
- align Settings structure (meta controls + external links section)
- freeze Settings grouping and support interaction semantics per settings density contract

### Phase 4 (P1): hardening and polish
- visual regression sweep
- accessibility sanity (focus ring, keyboard path)
- low-risk motion polish where beneficial

---

## 8. Acceptance Criteria

1. All four top-level regions follow a single visual grammar.
2. Reader is consistently implemented and documented as Threads child flow.
3. Center logo is single-action manual archive (no hub behavior).
4. No behavioral regression in capture, archive, export, summary generation flows.
5. Build/package pass.
6. Manual QA meets gate defined in `ui_refactor_manual_sampling_and_acceptance.md`.

---

## 9. Validation Commands

- `pnpm -C frontend build`
- `pnpm -C frontend package`

---

## 10. Explicit Assumptions

1. v1.4 is UI-only refactor release.
2. Existing data contracts and runtime messages remain source of truth.
3. UI redesign may include multi-candidate exploration branches before final merge.
4. v1.4 keeps internal route id `timeline`; UI label is `Threads`.
5. v1.5 floating capsule implementation will consume the stabilized v1.4 visual language.
