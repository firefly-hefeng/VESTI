# Vesti v1.7 Prompt-as-Code Contract

Version: v1.7.0-rc.x  
Status: Docs Freeze  
Audience: Prompt engineer, Offscreen/runtime engineer, QA

---

## 0. Objective

Freeze a deterministic Prompt-as-Code lifecycle so prompt text and runtime schema validation remain synchronized.

---

## 1. Source of Truth

Canonical source is docs only:

- `documents/prompt_engineering/compaction-skill.md`
- `documents/prompt_engineering/compaction-skill-rubric.md` (engineering QA reference)
- `documents/prompt_engineering/thread-summary-skill.md`
- `documents/prompt_engineering/weekly-digest-skill.md`

Alias policy:

- `documents/prompt_engineering/synthesis_skill.md` is a one-cycle alias to `thread-summary-skill.md` and must not diverge.

Non-canonical locations (for example inlined TS strings) are transitional and must not be treated as prompt authority.

---

## 2. Artifact IDs and Schema Targets

| Artifact ID | Canonical file | Target schema |
| --- | --- | --- |
| `agent_a_compaction` | `compaction-skill.md` | markdown skeleton contract |
| `agent_b_thread_summary` | `thread-summary-skill.md` | `conversation_summary.v3` |
| `agent_c_weekly_digest` | `weekly-digest-skill.md` | `weekly_lite.v2` |

Artifact metadata must include:

- `id`
- `version`
- `schemaTarget`
- `hash`
- `updatedAt`

---

## 3. Runtime Loading Strategy

Runtime path is generated bundle only:

- `frontend/src/lib/prompts/generated/*`

Generation behavior:

1. build step reads canonical markdown files
2. embeds prompt strings and metadata into generated TS modules
3. runtime consumers import generated modules

Direct runtime markdown parsing in extension/offscreen contexts is disallowed.

---

## 4. Agent Contracts

### 4.1 Agent A

- distills noisy logic text into compact markdown skeleton
- follows strict volume rules with pre-computation and dual-threshold self-check
- enforces code black-box isolation (no line-by-line code explanation)
- uses `compaction-skill-rubric.md` as non-runtime QA reference (not output schema)

### 4.2 Agent B (strict mapper)

Hard constraints:

1. no second-pass reasoning beyond provided input skeleton
2. no new concept names not present in source
3. missing source fields map to empty/null-safe values
4. output must be valid `conversation_summary.v3` JSON only

### 4.3 Agent C

1. aggregate recent 7-day records only
2. if valid sample count < 3, enforce `insufficient_data=true`
3. output must be valid `weekly_lite.v2` JSON only

### 4.4 SchemaTarget consistency rule (mandatory)

1. Prompt file contract and `schemaTarget` metadata must match exactly.
2. If a skill schema shape changes, version must be bumped in the same docs update.
3. Mismatched schema labels are treated as drift-gate failures.

---

## 5. Alias Governance

`synthesis_skill.md` replacement policy:

1. current cycle: alias retained for compatibility
2. loader logs warning when alias is resolved
3. next cycle: alias removal can proceed only after references are removed and changelog entry is present

---

## 6. Compatibility and Migration Notes

1. existing inlined prompt modules remain as fallback until v1.7 runtime switch is complete
2. generated prompt bundle is gated behind v1.7 feature flags
3. schema parser and prompt artifact versions must be updated together
4. legacy coexistence is documented as one release cycle:
   - `conversation_summary.v2` as legacy after `v3` default
   - `weekly_lite.v1` as legacy after `v2` default

---

## 7. Acceptance Criteria

1. canonical prompt files are unique and unambiguous
2. generated artifact metadata is traceable to source changes
3. Agent B veto rules are documented and testable
4. alias behavior is explicit and time-bounded
5. runtime can run without direct docs file access
6. Agent A prompt and Agent A rubric are split (instruction vs evaluation), with clear references

---

## 8. Assumptions

1. v1.6 data contracts are available and stable.
2. v1.8 UI rendering work will consume outputs but is not part of this spec.
3. prompt/schema validation gates are enforced by local and CI workflows defined separately.
