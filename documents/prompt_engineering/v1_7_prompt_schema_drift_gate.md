# Vesti v1.7 Prompt-Schema Drift Gate

Version: v1.7.0-rc.x  
Status: Docs Freeze  
Audience: Prompt engineer, CI owner, QA

---

## 0. Objective

Prevent prompt text changes from silently diverging from TypeScript schema contracts and parsers.

---

## 1. Gate Layers

### 1.1 Local gate (mandatory)

Command:

- `pnpm -C frontend eval:prompts --mode=mock --strict`

Use before opening or updating PRs that touch prompt files, prompt loaders, schema parsers, or eval scripts.

### 1.2 PR gate (blocking)

Workflow: `prompt-schema-drift-pr.yml`

Trigger paths:

- `documents/prompt_engineering/**`
- `frontend/src/lib/prompts/**`
- `frontend/src/lib/services/insightSchemas.ts`
- `scripts/eval-prompts.ts`
- `eval/**`

Required behavior:

1. deterministic mock run
2. strict parse and schema checks
3. workflow fails on threshold breach or parser mismatch

### 1.3 Nightly live smoke (non-blocking for PR)

Workflow: `prompt-live-smoke-nightly.yml`

Purpose:

1. detect model-output drift under real route
2. track prompt version/hash behavior trend over time

Nightly job may skip when live secrets are absent.

---

## 2. Quality Threshold Binding

Threshold source:

- `eval/rubrics/thresholds.json`

Current required minimums:

- `formatComplianceRate >= 98`
- `informationCoverageRate >= 85`
- `hallucinationRate <= 8`
- `userSatisfaction >= 4.0`

Threshold updates require explicit changelog entry.

---

## 2.1 Version Targets (v1.7 docs default)

- `conversation_summary.v3` is default (`conversation_summary.v2` one-cycle legacy)
- `weekly_lite.v2` is default (`weekly_lite.v1` one-cycle legacy)

Any prompt contract claiming default output must use the versions above.

---

## 3. Agent-Specific Drift Checks

When `compaction-skill.md` changes, PR review and fixtures must additionally verify:

1. **Template anchor integrity**  
   - fixed anchors in `{Output_Template}` remain unchanged and parseable.
2. **No template spillover**  
   - output must not include template-external fields or prose wrappers.
3. **Volume rule integrity**  
   - default 7%-13%, sparse 5%-8%, and sparse trigger `<100 chars/turn` remain consistent.
4. **Subject isolation rule integrity**  
   - key reasoning steps keep explicit `[User]/[AI]` source labeling.
5. **Empirical anchoring rule integrity**  
   - abstract concepts require `Working Definition + Concrete Mapping` pairing.

`compaction-skill-rubric.md` is QA reference and must stay aligned with the above checks.

When `thread-summary-skill.md` changes, PR review and fixtures must additionally verify:

1. output schema target is `conversation_summary.v3`.
2. `thinking_journey` is an object array, and each item includes:
   - `step`, `speaker`, `assertion`, `real_world_anchor`
3. `key_insights` is an object array, each item includes:
   - `term`, `definition`
4. no fallback to legacy v2 field shape in default-path fixtures.

When `weekly-digest-skill.md` changes, PR review and fixtures must additionally verify:

1. output schema target is `weekly_lite.v2`.
2. `cross_domain_echoes` exists and passes structural validation.
3. `<3` sample branch sets `insufficient_data=true`, keeps one factual `highlights` line, and allows other arrays to be empty by contract.
4. no default-path fixture silently drops v2-only fields.

---

## 4. Required CI Artifacts

PR workflow artifacts:

1. strict mock report summary
2. latest eval JSON

Nightly workflow artifacts:

1. live smoke summary
2. raw per-case result snapshots
3. prompt version/hash metadata in report context

---

## 5. Failure Policy

PR gate failures are blocking.

Typical block reasons:

1. invalid JSON output rate increase
2. schema field mismatch after prompt edits
3. hallucination threshold breach

Nightly failures are warning-level unless manually escalated.

---

## 6. Ownership

Prompt engineer owns:

- prompt content updates and semantic intent

Engineering owner owns:

- parser/schema alignment and loader logic

Release owner owns:

- final gate pass confirmation before `1.7.0-rc.x` promotion

---

## 7. Acceptance Criteria

1. local strict command is documented and runnable
2. PR workflow path filters are scoped and active
3. nightly workflow is scheduled and report-producing
4. thresholds are centrally defined and traceable
5. gate outputs are sufficient for root-cause investigation
