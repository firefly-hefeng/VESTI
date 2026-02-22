# Vesti v1.7 Runtime Event Contract

Version: v1.7.0-rc.x  
Status: Docs Freeze  
Audience: Offscreen engineering, Sidepanel engineering, QA

---

## 0. Purpose

Define a typed push-event contract for orchestration progress reporting from Offscreen to Sidepanel.

This contract is internal and does not change external APIs.

---

## 1. Event Identity

Canonical event message type:

- `INSIGHT_PIPELINE_PROGRESS`

Direction:

- sender: Offscreen
- receiver: Sidepanel

Transport:

- chrome runtime push event (no polling canonical path)

---

## 2. Type Contract

```ts
export type InsightPipelineScope = "summary" | "weekly";

export type InsightPipelineStage =
  | "initiating_pipeline"
  | "distilling_core_logic"
  | "curating_summary"
  | "aggregating_weekly_digest"
  | "persisting_result"
  | "completed"
  | "degraded_fallback";

export type InsightPipelineStatus = "started" | "in_progress" | "succeeded" | "fallback" | "failed";

export interface InsightPipelineProgressEvent {
  type: "INSIGHT_PIPELINE_PROGRESS";
  pipelineId: string;
  scope: InsightPipelineScope;
  targetId: string;
  stage: InsightPipelineStage;
  status: InsightPipelineStatus;
  seq: number;
  attempt: number;
  startedAt: number;
  updatedAt: number;
  route: "proxy" | "modelscope";
  modelId: string;
  promptVersion: string;
  message?: string;
}
```

Required fields (must always be present):

- `pipelineId`, `scope`, `targetId`, `stage`, `status`, `seq`, `attempt`, `startedAt`, `updatedAt`, `route`, `modelId`, `promptVersion`

Optional fields:

- `message` for human-readable progress hints or fallback reason summary.

---

## 3. Sequencing and Ordering Rules

1. `seq` starts at 1 for each new `pipelineId`.
2. `seq` is strictly increasing per pipeline.
3. Late/out-of-order events must be ignored by consumers when `seq` <= last seen sequence.
4. Terminal stage is mandatory: `completed` or `degraded_fallback`.

---

## 4. Stage Emission Requirements

### 4.1 Summary

Expected progression:

1. `initiating_pipeline`
2. `distilling_core_logic`
3. `curating_summary`
4. `persisting_result`
5. `completed` or `degraded_fallback`

### 4.2 Weekly

Expected progression:

1. `initiating_pipeline`
2. `aggregating_weekly_digest`
3. `persisting_result`
4. `completed` or `degraded_fallback`

At least one event must be emitted when entering each stage.

---

## 5. Failure Semantics

1. Internal non-terminal errors should emit `status=fallback` on active stage and continue chain when possible.
2. Terminal unrecoverable outcome must emit `stage=degraded_fallback` before completion path returns.
3. Raw exception stack traces are not emitted in event payloads.

---

## 6. Sidepanel Consumer Contract

Sidepanel behavior:

1. Subscribe once and filter `type === INSIGHT_PIPELINE_PROGRESS`.
2. Deduplicate by `pipelineId + seq`.
3. Keep latest event snapshot per pipeline.
4. If terminal event is received, stop spinner/state text updates for that pipeline.

Recovery behavior:

- If Sidepanel remounts mid-run, it may miss older events; renderer must remain stable from latest received event and final persisted data readback.

---

## 7. Compatibility and Rollout

This event contract is guarded behind `enable_v17_progress_events`.

Defaults:

- off in production
- on for QA staging validation

When flag is off:

- generation must continue without progress events.

---

## 8. Acceptance Checks

1. Summary and weekly both emit stage-correct events.
2. `seq` monotonicity is preserved under retries.
3. Terminal event is always emitted exactly once per pipeline.
4. Sidepanel does not regress when progress events are disabled.
