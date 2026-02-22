# Vesti Insights Engineering Spec (Prompt + UI/UX v2.0)

- Document version: v1.2-ui-pre.6
- Updated on: 2026-02-15
- Scope: Vesti Sidepanel (Insights first, linked with Settings/Timeline/Reader)
- Positioning: `v1.1 guardrail` (stable delivery) + `v1.2 target` (design convergence)
- Related doc: `documents/prompt_engineering/model_settings.md`

---

## 0. Revision Notes

1. Synced with `v1.7.0-rc.x` docs freeze: `conversation_summary.v3` and `weekly_lite.v2` as defaults, with one-cycle legacy coexistence.
2. Synced with Demo routing: Node proxy dual-model fallback (`DS14 -> Qwen3-14B`, one retry).
3. Synced with output resilience: empty `json_mode` content degrades to `prompt_json`, then `fallback_text`.
4. Warm Paper theme is mandatory: restore sepia-like paper palette, keep typography upgrades.
5. Settings toggle/input/button are refined to match warm shell semantics and interaction quality.
6. Data Management is promoted to an independent Dock entry (`Data`), while Settings keeps only an entry card.
7. Toggle geometry is corrected with Y-axis center-lock to remove thumb downward drift/jitter.
8. v2.0 proxy contract adds embeddings route (`POST /api/embeddings`) and `proxyBaseUrl` config.

---

## 1. Goals and Non-goals

### 1.1 Goals

1. Keep Insights as thinking-journey recap, not shallow compression.
2. Keep Weekly in Lite scope for MVP reliability.
3. Keep readable, breathable, and testable UI baseline.
4. Keep one shared contract across Prompt, Schema, Adapter, Proxy, and UI.

### 1.2 Non-goals

1. No new runtime message protocol names.
2. No forced stream/reasoning rollout in this phase.
3. No long-horizon weekly claims (monthly/quarterly trend language).

---

## 2. Design Formula

- `Shell = Neutral Sans + Utility Priority`
- `Artifact = Warm Serif + Reading Priority`
- `Breathability = Larger Type + Higher Line-height + Wider Spacing`

Interpretation:

1. `app_shell` surfaces (sidebar, settings, input, controls) stay calm, precise, and sans-first.
2. `artifact_content` surfaces (summary/weekly body) prioritize serif reading comfort.
3. Visual goal is "academic paper room" quality, not bright SaaS dashboard style.

---

## 3. Warm Paper Theme (Mandatory)

### 3.1 Palette contract

| Token | Value | Intent |
| --- | --- | --- |
| `bg-app` | `#FAF9F5` | app base paper tint |
| `bg-sidebar` | `#F7F6F2` | sidebar layer separation |
| `bg-surface` | `#F0EEE6` | card/article surface |
| `bg-surface-hover` | `#EAE8DF` | subtle warm hover |
| `text-primary` | `#1A1918` | ink-like primary text |
| `text-secondary` | `#5C5855` | pencil-like secondary text |
| `border-subtle` | `#E6E2D6` | warm subtle borders |
| `shadow-color` | `28, 20, 15` | warm shadow base |

### 3.2 Warm shadow and tag behavior

1. Card shadows must use warm brown rgba blend; avoid cold gray shadows.
2. Tags use embedded-paper style: white translucent fill + subtle warm border.
3. Keep artifact cards light and breathable under warm surface color.

---

## 4. Prompt and Stability Contract

### 4.1 Default prompt strategy (`current`)

1. Conversation Summary: thinking-journey template (v3 schema target).
2. Weekly Digest: Weekly Lite template (short context, MVP-safe).

### 4.2 Prompt version governance

1. `current`: production default.
2. `experimental`: rollback anchor and experiment branch.

### 4.3 Output and fallback rules

1. Structured chain: `json_mode -> prompt_json -> fallback_text`.
2. `json_mode` empty content triggers `prompt_json` retry automatically.
3. Handle `<think>...</think>` via `thinkHandlingPolicy` (default `strip`).

### 4.4 Weekly Lite boundary (hard rule)

1. Input window is recent 7 days only.
2. `total_conversations < 3` must set `insufficient_data=true`.
3. Weekly Lite is recap + next focus, not long-term behavior analysis.

---

## 5. Schema and Adapter Contract

### 5.1 Version coexistence (no forced migration)

- Conversation:
  - `conversation_summary.v1` (legacy)
  - `conversation_summary.v2` (legacy, one-cycle coexistence)
  - `conversation_summary.v3` (default)
- Weekly:
  - `weekly_report.v1` (legacy)
  - `weekly_lite.v1` (legacy, one-cycle coexistence)
  - `weekly_lite.v2` (default)

### 5.2 Adapter bridge responsibilities

1. Keep one presentation contract independent from backend schema variants.
2. Render legacy records without batch migration.
3. Fall back to readable plain text when structured parsing fails.

### 5.3 Presentation contract (current)

1. Summary (v3): `core_question + thinking_journey[] + key_insights[] + unresolved_threads + actionable_next_steps`
2. Weekly Lite (v2): `highlights + recurring_questions + cross_domain_echoes + unresolved_threads + suggested_focus + evidence + insufficient_data`

---

## 6. UI Semantic Contract

```ts
type UiSemanticLayer = "app_shell" | "artifact_content"
type TypographySemantic = "ui_sans" | "reading_serif"
type VisualDensityMode = "guardrail_v1_1" | "target_v1_2"
```

Assignment:

1. `app_shell -> ui_sans`
2. `artifact_content -> reading_serif`
3. Implementation priority: `Insights > Settings > Timeline/Reader`

---

## 7. Typography Contract (Dual Track)

### 7.1 Font stacks

- `ui_sans`: `Inter, -apple-system, PingFang SC, Microsoft YaHei, sans-serif`
- `reading_serif`: `Newsreader, Source Han Serif SC, Noto Serif SC, serif`

### 7.2 Scale requirements

| Level | v1.1 guardrail | v1.2 target | Semantic |
| --- | --- | --- | --- |
| H1/Hero | >=22px, lh<=1.35 | 26px, lh 1.3 | reading_serif |
| H3/Title | >=18px | 20px, medium | reading_serif |
| Body L | >=16px, lh>=1.6 | 18px, lh 1.65 | reading_serif |
| Body M | >=15px, lh>=1.55 | 16px, lh 1.6 | reading_serif |
| UI Base | >=14px | 15px, lh 1.5 | ui_sans |
| Caption | >=12px | 13px, lh 1.4 | ui_sans |

---

## 8. Component Specs (Insights first)

### 8.1 App Shell

1. Sidebar/settings/input/buttons stay `ui_sans`.
2. Keep hierarchy explicit and motion minimal.

### 8.2 Insight Card

1. Radius/padding: guardrail >=12/16, target 16/24.
2. Artifact body uses serif + reading rhythm + warm shadow.
3. Tags use embedded-paper style (not sticker style).

### 8.3 Weekly Lite block

1. Must expose Weekly Lite semantics.
2. Show boundary hint when `insufficient_data=true`.
3. Evidence list stays secondary in hierarchy.

### 8.4 Settings interaction contract

1. Toggle must be `44px x 24px` with no clipping/crescent artifacts.
2. Toggle color logic: off warm gray, on ink-dark; no default system blue.
3. Input/select fields: 40px height, white surface, warm subtle border.
4. Button hierarchy: `Test` ghost, `Save` solid dark primary.

---

## 9. Engineering Notes

### 9.1 Token mapping contract

| PRD Token | Current map | v1.1 guardrail | v1.2 target |
| --- | --- | --- | --- |
| `bg-app` | `--bg-tertiary` | map-first | keep warm paper value |
| `bg-surface` | `--surface-card` | map-first | keep warm paper value |
| `bg-surface-hover` | `--surface-card-hover` | map-first | keep warm paper value |
| `text-primary` | `--text-primary` | keep | keep |
| `text-secondary` | `--text-secondary` | keep | keep |
| `border-subtle` | `--border-subtle` | keep | keep |

### 9.2 Demo proxy linkage

1. Endpoint: `POST /api/chat` (Node runtime).
2. Embedding endpoint: `POST /api/embeddings` (DashScope OpenAI-compatible upstream).
3. Model path: `DS14 -> Qwen3-14B` with at most one retry.
4. Retry trigger only on network/timeout/429/5xx.
5. Diagnostics: `x-request-id`, `x-proxy-model-used`, `x-proxy-attempt`.

### 9.3 Frontend route constraints

1. Demo defaults to DS14; legacy demo model IDs lazily normalize.
2. Settings must show primary/backup route, `proxyBaseUrl`, and gateway lock (`modelscope.cn`).
3. BYOK remains direct-to-ModelScope.

---

## 10. QA Checklist (rc.4)

### A. Prompt / Schema

1. Conversation output hits `conversation_summary.v3` required fields.
2. Weekly output hits `weekly_lite.v2`; `<3` conversations set `insufficient_data=true`, with `cross_domain_echoes` present (can be empty).
3. Structured failure degrades to readable `fallback_text`.

### B. Warm theme

1. App base is warm paper (`#FAF9F5`), cards are warm surface (`#F0EEE6`).
2. Sidebar layer uses slightly deeper warm tint (`#F7F6F2`).
3. Shadows are warm; no cold-gray dirty look.

### C. Settings quality

1. Toggle is exactly 44x24 and aligned.
2. No blue accent in toggle/focus hierarchy.
3. Inputs are 40px, white, and clearly bounded.

### D. Typography

1. Settings is sans.
2. Insights artifact is serif with body 17-18 and line-height 1.65.
3. Timeline top brand text can use serif as approved brand accent.

### E. Stability

1. Demo Summary and Weekly generate successfully.
2. BYOK route behavior and key isolation stay unchanged.
3. Non-stream stable path remains default.

---

## 11. Roadmap

### P0 (implemented baseline)

1. Summary v3 + Weekly Lite v2 templates (legacy bridge retained for one-cycle coexistence)
2. Adapter bridge for legacy compatibility
3. Warm Paper UI + Settings interaction fixes
4. Node proxy + dual-model fallback

### P1.5 (next)

1. Stream-switch framework hardening
2. State-machine and rollback hook strengthening
3. Keep stable path untouched by research route

### P2 (later)

1. Capability detector improvements
2. Reasoning/stream integration tuning
3. Provider-catalog capability source integration

---

## 12. Document Acceptance

1. Path is `documents/prompt_engineering/insights_prompt_ui_engineering.md`.
2. Terms align with `documents/prompt_engineering/model_settings.md`.
3. Weekly Lite boundary and Warm Paper contract are explicit.
4. Demo dual-model failover and trigger scope are explicit.
5. Spec is directly implementable without reopening direction decisions.

---

## 13. UI Defect Learnings and Preventive Guardrails (v1.2.x)

### 13.1 Defects we must not repeat

1. **Typography utility collision**: size utilities (`text-vesti-*`) must not own `font-family`; they can silently override brand serif assignments.
2. **Non-geometric toggle positioning**: hardcoded thumb `top` offsets inside bordered tracks create vertical drift and switching jitter.
3. **IA coupling in Settings**: low-frequency/high-impact data governance mixed into Settings weakens progressive disclosure and discoverability.
4. **Theme drift by local overrides**: ad-hoc color tweaks outside semantic tokens break Warm Paper consistency.
5. **Asset contract gaps**: introducing branded typography without clear asset naming/preload/fallback causes unstable rendering.

### 13.2 Enforced design-engineering rules

1. **Font role separation**
   - `vesti-page-title`: page-level H1 only.
   - `vesti-brand-wordmark`: Timeline brand wordmark only.
   - `app_shell`: sans-first; `artifact_content`: reading serif.
   - Do not define `font-family` in generic size helpers.
2. **Toggle geometry contract**
   - Track: `44x24`; Thumb: `20x20`; X travel: `20px`.
   - Y alignment must use center-lock (`top: 50%` + `translateY(-50%)`).
   - Checked/unchecked state may change X only; Y must remain constant.
3. **Progressive disclosure contract**
   - Data governance is a dedicated `Data` tab in Dock.
   - Settings keeps concise entry guidance, not full duplicated operation blocks.
4. **Action safety ordering**
   - Conversation card actions remain `Copy -> Open Source -> Delete`.
   - Destructive action is always right-most and visually de-emphasized.
5. **Theme contract**
   - Warm Paper tokens are source-of-truth; no one-off cold-gray substitutions.
   - Shadows/tags must follow warm semantic tokens.
6. **Font asset contract**
   - Ship WOFF2 in-repo, preload at app bootstrap, warn once on missing files, degrade gracefully.

### 13.3 Release-gate checklist (UI)

1. Verify serif/sans role mapping on Timeline, Insights, Settings, and Data pages.
2. Verify toggle pixel centering in both states and during rapid toggling.
3. Verify Dock progressive disclosure path (`Data` direct + Settings entry card).
4. Verify destructive flows still require explicit confirmation and preserve configured LLM settings.
5. Verify packaged build behavior equals dev behavior (`pnpm -C frontend build` + `pnpm -C frontend package`).
