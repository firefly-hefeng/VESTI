# Engineering Handoff - v1.5-lite Capsule Rollout and UI Closeout

Date: 2026-02-25
Owner Session: Codex (GPT-5)
Branch Baseline: `release/v1.2.0-rc.2`

## 1) Functional Implementation

### 1.1 v1.5-lite baseline shell

The capsule moved from a minimal floating entry point to a usable v1.5-lite shell:
1. Shadow DOM isolation is active via `#vesti-capsule-root`.
2. Dual views are active: `collapsed` and `expanded`.
3. Runtime status polling is active on a 3-second cadence.
4. Actions reuse existing runtime channels: `OPEN_SIDEPANEL`, `GET_ACTIVE_CAPTURE_STATUS`, and `FORCE_ARCHIVE_TRANSIENT`.
5. Non-primary hosts still use fallback behavior (`Open Dock` only).

Scope stayed local to `frontend/src/contents/capsule-ui.ts` with no protocol, DB, or parser contract changes.

### 1.2 Drag regression diagnosis and hotfix

Observed regression:
1. Users could drag the logo into composer inputs like payload drag/drop.
2. Users could not reposition the capsule in the viewport.

Root causes:
1. Collapsed drag path was blocked by modifier-key and settings-gate combinations.
2. Native image drag was not fully disabled on the logo element.

Hotfixes that were shipped:
1. Collapsed state is directly draggable (no Alt requirement).
2. Hotfix path ignores `settings.draggable` as a blocker.
3. `logo.draggable = false` plus `-webkit-user-drag: none; user-select: none`.
4. Existing anti-misfire protections are preserved: 5px threshold plus post-drag click suppression (`suppressCollapsedClick`).

Validated behavior:
1. Drag works again on ChatGPT, Claude, and Gemini.
2. Drag-to-composer native drop side effect no longer reproduces.

### 1.3 Primary rollout expanded to all supported model hosts

Primary rollout list now includes all supported model surfaces (product view: 6 models; host list: 7 domains):
1. `chatgpt.com`
2. `chat.openai.com`
3. `claude.ai`
4. `gemini.google.com`
5. `chat.deepseek.com`
6. `chat.qwen.ai`
7. `www.doubao.com`

Fallback remains enabled for non-primary hosts to keep rollback surface small.

### 1.4 Expanded card visual polish plus runtime theme sync

Expanded card styling now matches the approved prototype skin while preserving existing logic:
1. Card width and spacing rhythm aligned (`min(320px, calc(100vw - 16px))`).
2. Header/status/metrics/actions hierarchy aligned to the prototype.
3. Primary button width priority restored.
4. Live-status dot animation retained.
5. Demo-only controls were intentionally excluded from product code.

Theme behavior:
1. Expanded card theme follows `vesti_ui_settings.themeMode`.
2. Runtime theme switching is supported via `chrome.storage.onChanged`.
3. Listener cleanup is executed on destroy to avoid leaks.

### 1.5 Platform badge token alignment and font closeout

Platform badge colors now use sidepanel-equivalent triplets (`bg/text/border`) across light and dark modes:
1. ChatGPT
2. Claude
3. Gemini
4. DeepSeek
5. Qwen
6. Doubao
7. Neutral fallback for unknown platforms

Typography closeout for expanded card:
1. Sans stack aligned to sidepanel: `"Vesti Sans UI", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`.
2. Serif stack aligned to sidepanel `--font-vesti-serif` equivalent.
3. `Messages/Turns` large metric values switched to serif plus tabular numerics (`tabular-nums`, `"tnum" 1`).
4. Other UI labels and normal numeric text stay on UI sans.

### 1.6 Collapsed visual rollback decision

Per final product decision for this round:
1. Collapsed capsule no longer follows dark/light theming.
2. Collapsed capsule is fixed to light appearance.
3. Expanded card keeps dynamic theme behavior.

This removes visual mode churn in the small entry point while preserving full themed readability in the expanded card.

## 2) Version Plan

### 2.1 Release line and target

Current release line: `release/v1.2.0-rc.2`

Target flow:
1. Merge `release/v1.2.0-rc.2` into `main` through PR.
2. Keep `frontend/package.json` at `1.2.0-rc.2`.
3. Tag on `main` as annotated `v1.2.0-rc.2`.
4. Do not rewrite existing tags.

### 2.2 Commit slicing already established on this release line

Previously landed slices:
1. v1.5-lite shell baseline plus drag hotfix baseline.
2. Primary rollout expansion to all supported hosts.
3. rc.2 release metadata.
4. Card skin polish plus sidepanel token alignment.

This closeout slice adds:
1. Final font alignment to sidepanel stacks.
2. Collapsed light-only visual rollback.
3. Engineering handoff and changelog completion.

This preserves clear review causality across behavior, rollout, and UI.

### 2.3 PR gates and acceptance requirements

Required automated gates:
1. `pnpm -C frontend build`
2. `pnpm -C frontend eval:prompts --mode=mock --strict`
3. `pnpm -C frontend package`

Required manual checks:
1. Drag works in collapsed and expanded views.
2. Post-drag click misfire is still suppressed.
3. Expanded card actions keep existing gating behavior.
4. Expanded card theme and platform tokens are aligned.
5. Collapsed capsule stays light in all theme modes.

### 2.4 Rollback strategy

Preferred rollback order:
1. Single host blocker: remove that host from primary rollout.
2. Single feature blocker: revert only the corresponding `capsule-ui.ts` commit.
3. Multi-host blocker: roll back to previous RC baseline if isolation is not fast enough.

## 3) Technical Architecture

### 3.1 Module boundaries

Main modules:
1. `frontend/src/contents/capsule-ui.ts`
2. `frontend/src/lib/services/capsuleSettingsService.ts`

Responsibilities:
1. Content script handles lifecycle, state projection, drag interactions, and UI actions.
2. Settings service handles host-scoped persistence and normalization.
3. Background keeps existing message contracts with no new public protocol surface.

### 3.2 View and state layering

View layer:
1. `collapsed`: lightweight entry point and drag affordance.
2. `expanded`: status badge, metrics, reason message, and action row.

Runtime state layer (lite mapping):
1. `idle`
2. `mirroring`
3. `holding`
4. `ready_to_archive`
5. `archiving`
6. `saved`
7. `error`

Visual grouping stays separate from business semantics (held/live/ready/neutral/error colors without collapsing runtime states).

### 3.3 Interaction state machine and anti-misfire guardrails

Pointer flow:
1. `pointerdown` captures start coordinates and start offsets.
2. `pointermove` transitions into drag after 5px Euclidean threshold.
3. `pointerup`/`pointercancel` finalizes drag or click behavior based on drag state.

Guardrails:
1. Drag entry points are separated by view context.
2. `suppressCollapsedClick` prevents drag-end click misfires.
3. Native logo drag is disabled to block host editor drag/drop interception.

### 3.4 Positioning, snap, and persistence model

Positioning:
1. Uses fixed `right/bottom` offsets.
2. Applies viewport clamp during drag and after resize.
3. Applies side snap using center-point heuristic (`bottom_left` / `bottom_right`).

Persistence:
1. Stored under `chrome.storage.local["vesti_capsule_settings"]`.
2. Host-scoped fields include anchor, offsets, view defaults, auto-collapse timing, draggable flag, and hidden host list.
3. Normalization stays in settings service to keep content-script logic focused.

### 3.5 Theme and platform token injection strategy

Theme:
1. Capsule theming is isolated in Shadow DOM.
2. No host-page class mutation is required.
3. Expanded view uses runtime `data-theme`; collapsed view is intentionally fixed light.

Platform token injection:
1. Light and dark token maps mirror sidepanel values.
2. Badge uses runtime platform + theme combination.
3. Unknown platform uses neutral fallback colors.

### 3.6 Observability and resilience

Observability:
1. Content-scope logs cover status refresh and action execution paths.
2. Failures are logged with reason context for follow-up.

Resilience:
1. Runtime failures preserve `Open Dock` fallback.
2. Polling timers, drag listeners, resize listeners, and storage listeners are cleaned up on teardown.

## 4) Scope Boundaries Preserved

Intentionally unchanged:
1. `frontend/src/lib/messaging/protocol.ts`
2. DB schema
3. Parser contracts
4. Full Pause/Resume behavior and full-priority state machine alignment (still outside v1.5-lite scope)

