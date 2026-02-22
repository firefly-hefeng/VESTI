# Vesti v1.7 Feature Flag Rollout Spec

Version: v1.7.0-rc.x  
Status: Docs Freeze  
Audience: Offscreen engineering, QA, release owner

---

## 0. Purpose

Define safe rollout and rollback controls for v1.7 orchestration features while preserving v1.6 baseline behavior.

---

## 1. Storage and Default Policy

Flag store:

- `chrome.storage.local`

Default policy:

- all v1.7 flags are `false` unless explicitly enabled

Flags:

1. `enable_v17_multi_agent_pipeline`
2. `enable_v17_progress_events`
3. `enable_v17_weekly_agent_c`

---

## 2. Gating Matrix

| Feature | Flag | Default | Dependency |
| --- | --- | --- | --- |
| Offscreen multi-agent chain | `enable_v17_multi_agent_pipeline` | false | none |
| Runtime push progress events | `enable_v17_progress_events` | false | optional with or without multi-agent |
| Weekly Agent C chain | `enable_v17_weekly_agent_c` | false | requires multi-agent |

Interpretation:

1. If `enable_v17_multi_agent_pipeline=false`, summary/weekly run legacy path.
2. If only `enable_v17_progress_events=true`, events can publish from legacy progress hooks without changing model chain behavior.
3. `enable_v17_weekly_agent_c=true` is ignored unless `enable_v17_multi_agent_pipeline=true`.

---

## 3. Rollout Plan

Phase 1 (internal QA):

- enable all three flags in QA profiles only
- validate stage transitions, fallback behavior, and persistence consistency

Phase 2 (staged users):

- enable `enable_v17_progress_events` first
- enable `enable_v17_multi_agent_pipeline` for sampled users
- enable `enable_v17_weekly_agent_c` after summary chain stability is proven

Phase 3 (rc default reconsideration):

- evaluate nightly smoke and field telemetry
- decide per-flag default changes for next RC only

---

## 4. Rollback Rules

Immediate rollback trigger examples:

1. elevated fallback loops or repeated parse failures
2. wrong terminal status behavior
3. Sidepanel state inconsistency from event stream

Rollback steps:

1. set `enable_v17_multi_agent_pipeline=false`
2. optionally set `enable_v17_weekly_agent_c=false`
3. keep or disable `enable_v17_progress_events` depending on UI impact
4. no DB migration rollback required

---

## 5. Branch and Release Alignment

Branch strategy:

- docs freeze: `docs/v1_7_spec_pack`
- runtime implementation: `feature/v1.7-*`

Release gate:

- v1.7 implementation branch cannot merge before v1.6 gate is complete

Tag strategy:

- `1.7.0-rc.x` independent line

---

## 6. Observability Requirements

Per-flag telemetry dimensions:

- which flags are active
- stage transitions per pipeline
- fallback frequency and terminal status

Data hygiene:

- do not log raw prompt payloads
- log metadata only (pipelineId, stage, status, route, model, promptVersion)

---

## 7. Acceptance Criteria

1. With all flags off, behavior matches current stable path.
2. Enabling only progress events does not change result content semantics.
3. Enabling full v1.7 chain produces terminal state and persisted artifact.
4. Rollback to all-off works without restart-critical failures.
