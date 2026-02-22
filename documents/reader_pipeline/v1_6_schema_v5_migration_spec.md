# Vesti v1.6 Schema v5 Migration Spec

Version: v1.6.0-rc.x  
Status: Docs Freeze  
Scope: Dexie schema upgrade and backward compatibility

---

## 0. Summary

v1.6 extends `messages` records to support dual-track capture payload:

- `content_text` (LLM-facing logic text)
- `content_ast` (Reader-facing AST)
- migration-safe counters for degradation telemetry

Upgrade target: `MemoryHubDB` schema `v5`.

---

## 1. Change Surface

## 1.1 Affected files

- `frontend/src/lib/types/index.ts`
- `frontend/src/lib/core/parser/IParser.ts`
- `frontend/src/lib/messaging/protocol.ts`
- `frontend/src/lib/db/schema.ts`
- `frontend/src/lib/db/repository.ts`
- (optional) `frontend/src/lib/services/exportSerializers.ts` for AST optional export

## 1.2 Unchanged

- Existing table names
- Existing message indexes
- Existing capture decision model (`mirror/smart/manual`)

---

## 2. Type Contract (Target)

```ts
type AstVersion = "ast_v1";

type AstRoot = {
  type: "root";
  children: AstNode[];
};

interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "ai";
  content_text: string;
  content_ast?: AstRoot | null;
  content_ast_version?: AstVersion | null;
  degraded_nodes_count?: number;
  created_at: number;
}
```

All new fields are optional to preserve compatibility with historical records.

---

## 3. Dexie Schema Upgrade Plan

## 3.1 Version bump

- Add `this.version(5)` in `frontend/src/lib/db/schema.ts`.

## 3.2 Table declaration

Indexes remain unchanged:

```ts
messages: "++id, conversation_id, role, created_at, [conversation_id+created_at]"
```

Reason:

- AST is not queried by index in v1.6.
- Avoid unnecessary index rebuild risk.

## 3.3 Migration operation

For existing `messages` rows:

- `content_ast = null` when undefined
- `content_ast_version = null` when undefined
- `degraded_nodes_count = 0` when undefined or invalid

Migration must be idempotent and safe for partial upgrades.

---

## 4. Repository Mapping Rules

`toMessage()` must normalize legacy rows:

1. If AST fields are absent, return explicit defaults above.
2. Do not throw for missing AST in legacy records.
3. Keep `content_text` behavior unchanged for search/filter/export.

Write-path rules:

1. New captures may persist AST fields.
2. Legacy captures without AST remain valid.

---

## 5. Export Compatibility Policy

`vesti_export.v1` remains backward compatible in v1.6.

Policy:

1. AST-related fields are optional extension fields.
2. Consumers that do not understand AST can ignore them safely.
3. No mandatory schema version bump for export in this phase.

---

## 6. Rollback and Recovery

Because v5 adds nullable optional fields without index changes:

1. Rolling back parser code still leaves DB readable.
2. Existing features continue using `content_text`.
3. No destructive migration step is introduced.

If upgrade fails:

- fail closed with clear log in offscreen context
- no partial write should corrupt existing conversation/message records

---

## 7. Acceptance Criteria

1. App boots with existing v4 data and upgrades to v5 without fatal errors.
2. Existing records remain queryable in Timeline/Reader/Insights.
3. New records can store AST payload with no type/runtime error.
4. Search/export behavior remains compatible for legacy and new rows.
