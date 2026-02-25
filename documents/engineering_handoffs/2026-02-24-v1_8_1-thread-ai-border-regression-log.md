# Engineering Incident Log - v1.8.1 Thread AI Border Regression

Date: 2026-02-24  
Scope: `frontend` (Thread Summary UI only)

## 1) Incident summary

During the first rollout attempt of "AI card left accent border", the Thread Summary journey showed a severe visual regression: some AI cards rendered as near header-only (tiny height), while User cards remained normal.

This was initially misattributed to border CSS implementation.

## 2) Verified root cause

Root cause was **change contamination**, not border style itself:

1. Border styling changes were deployed together with `thinking_journey` text normalization/fallback adjustments.
2. Some AI journey assertions became near-empty after the data-path adjustments, but cards were still rendered.
3. The visual symptom looked like a layout collapse, masking the true data-path contribution.

## 3) Corrective action taken

1. Rolled back to the last known-good rendering baseline (where AI card content rendered correctly).
2. Reintroduced border enhancement as an isolated UI-only change:
   - theme class on ready shell only
   - platform token mapping to `--*-text`
   - `box-shadow: inset 2.5px 0 0 ...` on `.ins-thread-ready-shell .ins-thread-step-ai`
3. Explicitly avoided:
   - `::before` pseudo-element path for this round
   - any `position/overflow/padding` changes
   - any data/runtime/schema logic changes

## 4) Reusable engineering rules

1. **Separate concerns by commit boundary**  
   Do not ship data normalization and UI decoration in one commit when diagnosing visual regressions.

2. **Prefer layout-neutral accent primitives first**  
   For simple left accents, prefer `inset box-shadow` over pseudo-elements when stability is the priority.

3. **Diagnose visual anomalies with data-path checks first**  
   "Collapsed card" can be a content-shape issue; verify assertion payload quality before changing box model.

4. **Constrain CSS scope to target container**  
   Use `.ins-thread-ready-shell .ins-thread-step-ai` to avoid accidental effects on generating shell and other blocks.

## 5) Acceptance gates used

1. `pnpm -C frontend build`
2. `pnpm -C frontend eval:prompts --mode=mock --strict`
3. Manual visual check:
   - AI cards show accent border by platform
   - User cards unchanged
   - no key-insight/unresolved/next-step contamination

## 6) Future guardrail

For any future style-only micro-change in Thread Summary:
1. single-purpose commit,
2. explicit "no data-path change" checklist,
3. rollback point tagged before merge.

