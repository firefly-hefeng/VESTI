# Vesti v1.7 Manual Sampling and Acceptance

Version: v1.7.0-rc.x  
Status: QA Gate Spec  
Audience: QA, orchestration engineer, release owner

---

## 0. Scope

This checklist validates v1.7 orchestration and Prompt-as-Code behavior only.

In scope:

1. prompt artifact governance and alias behavior
2. Agent B zero-inference compliance
3. runtime push event ordering and terminal states
4. fallback continuity and silent tolerance
5. drift gate execution pathways
6. feature-flag rollout and rollback
7. schema-version contract alignment (`conversation_summary.v3` / `weekly_lite.v2`)

Out of scope:

1. parser dual-track extraction internals (v1.6)
2. Reader/Insights visual redesign (v1.8)

---

## 1. Required Coverage Matrix

Minimum case groups:

1. Prompt-as-Code and alias governance: 6
2. Agent B contract enforcement: 6
3. Event protocol and sequencing: 8
4. Silent fallback and resilience: 6
5. Drift gate checks (local + CI spec path): 6
6. Flag gating and rollback: 6

Minimum total: 38 cases

---

## 2. Test Cases

### A. Prompt-as-Code and alias

1. Update `thread-summary-skill.md` and verify generated artifact version/hash changes.
2. Verify `synthesis_skill.md` resolves to thread-summary canonical content path.
3. Confirm runtime uses generated bundle and does not require direct docs file read.

### B. Agent B zero-inference

1. Inject absent term in source and ensure output does not fabricate it.
2. Missing source section should map to empty array/null-safe value.
3. Schema parse failure follows repair then fallback chain, not hard crash.
4. `conversation_summary.v3` fields are complete and typed:
   - `thinking_journey[]` object items (`step`, `speaker`, `assertion`, `real_world_anchor`)
   - `key_insights[]` object items (`term`, `definition`)

### C. Orchestration push events

1. Summary pipeline emits stage sequence in expected order.
2. Weekly pipeline emits stage sequence in expected order.
3. `seq` strictly increases per `pipelineId`.
4. Terminal stage is always `completed` or `degraded_fallback`.

### D. Silent fallback and usability

1. Simulate Agent A timeout and verify degraded fallback output persists.
2. Verify `<think>` content is stripped before JSON parse.
3. Confirm user-facing UI receives coherent status, no raw exception text.
4. Verify Agent A failure path uses degraded skeleton and still attempts Agent B before terminal fallback.

### E. Drift gates

1. Local strict mock eval runs and produces pass/fail deterministically.
2. PR workflow path filter catches prompt/schema/eval script changes.
3. Nightly live smoke produces trend artifact with prompt version/hash metadata.
4. Weekly v2 checks validate `cross_domain_echoes` structure and `<3` sample branch behavior.

### F. Flag rollout and rollback

1. All flags off == baseline stable behavior.
2. Only progress flag on == visibility changes only.
3. Full chain on then off == rollback without migration breakage.

### G. Legacy coexistence policy

1. Docs explicitly mark `conversation_summary.v2` and `weekly_lite.v1` as one-cycle legacy.
2. No doc-level contradiction between default and legacy schema statements.

---

## 3. Evidence Requirements

For each case include:

1. case id and scope group
2. expected and actual result
3. pass/fail verdict
4. timestamp and environment
5. telemetry snapshot (`pipelineId`, `stage`, `status`, `seq`, `attempt`)
6. optional screenshot or log excerpt

For drift-gate cases also include:

- command output summary
- workflow run link or run-id

---

## 4. Severity Policy

Blocker:

1. pipeline cannot reach terminal state
2. fabricated output violates Agent B veto in validated cases
3. rollback fails to restore baseline path

Major:

1. event ordering violations (`seq` non-monotonic)
2. missing terminal event
3. drift gate cannot detect intentional schema mismatch fixture

Minor:

1. non-critical status text mismatch
2. log field formatting inconsistency

Go/No-Go threshold:

- Blocker = 0
- Major <= 2 with owner and retest plan

---

## 5. Build and Gate Commands

Local mandatory command:

- `pnpm -C frontend eval:prompts --mode=mock --strict`

Recommended sanity build command:

- `pnpm -C frontend build`

---

## 6. Result Template

```md
# v1.7 Orchestration Sampling Result

- Planned: 38
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
