# Vesti Development Guide - Coding Agent Standards

## Skills Index

- `skills/parser-debugging/SKILL.md` — Parser 故障排查与修复 SOP（Claude/ChatGPT）

- `skills/markdown-writing/SKILL.md` — Markdown/README 排版与编码 SOP（保留原文、结构化分段、徽章/表格规范、UTF-8 BOM）

> agent.md 仅保留核心原则，部门法/流程细则统一放在 skills/ 目录。
> Constitutional boundary: `agent.md` defines stable architecture/quality constraints, while `skills/` hosts fast-iterating task SOPs. If conflicts appear, `agent.md` takes precedence.

> This document serves as the development specification for the AI Coding Agent. Please strictly adhere to the following principles before generating any code.

## Understanding Project Essence

You are developing a **Local-First** browser extension, where the core values are privacy protection and user data sovereignty. This means every line of code must revolve around "Local First." Any feature requiring network requests (except for necessary web searches) should be questioned. The data flow is always: Host Page DOM → Content Script Parsing → Local IndexedDB, never passing through any remote server.

The project adopts a layered architecture with a clear separation of concerns. The bottom layer is the Core Engine (Observer + Parser + Middleware + Database), the middle is the Service and Messaging Coordination Layer, and the top is the UI Presentation Layer. Each layer must be independently testable and replaceable, with no direct cross-layer dependencies allowed. When writing a module, always ask yourself: Does this module only depend on the interfaces it is supposed to know?

## Release-Line Governance (v1.6+)

Use strict release-line boundaries to avoid scope bleed:

1. `v1.6.0-rc.x` — Data pipeline refactor and dual-track capture only (`content_text + content_ast`, schema/migration/parser contracts, defensive parsing, performance fallback).
2. `v1.7.0-rc.x` — Multi-agent orchestration and Prompt-as-Code backend runtime.
3. `v1.8.0-rc.x` — Reader and Insights UI rendering/interaction upgrades.

Boundary rules:

1. Do not mix v1.7 orchestration implementation into v1.6 commits.
2. Do not mix v1.8 UI redesign work into v1.6/v1.7 commits.
3. Interface placeholders are allowed cross-line; behavior rollout is not.
4. Release gating is serial: `v1.6 -> v1.7 -> v1.8`.
5. Each line uses independent RC tags (`1.6.0-rc.x`, `1.7.0-rc.x`, `1.8.0-rc.x`).

### v1.7 Prompt and Orchestration Governance

For `v1.7.0-rc.x`, enforce the following stable constraints:

1. Prompt source-of-truth is `documents/prompt_engineering/*.md` only.
2. Runtime prompt loading must consume generated artifacts, not direct markdown file reads.
3. Agent B contract is strict mapping with zero-inference veto.
4. Orchestration progress visibility uses push events with typed stage payloads.
5. v1.7 rollout is flag-gated in `chrome.storage.local` with default-off behavior.
6. Prompt/schema drift gates must include local strict eval plus PR/nightly workflow checks.

## Core Principles of Code Quality

### Type Safety is the Top Priority

TypeScript is not for writing "JavaScript with types," but for establishing compile-time contracts. All function signatures must explicitly annotate parameter types and return types; relying on type inference to "be lazy" is not allowed. When you see the `any` type, you should immediately consider: Is this a design issue? If handling an unknown type is truly necessary, use `unknown` combined with type guards for runtime checks.

Interface definitions must accurately reflect business semantics. For example, the `uuid` field in the `Conversation` interface is not just a plain string, but represents a "unique session identifier from a specific platform." If a function receives a `uuid`, the parameter name should be `conversationUuid: string` rather than a vague `id: string`, making the code self-explanatory.

For optional fields, use the `?` marker instead of `| undefined`, as the former is semantically clearer during object destructuring. For array operations, always consider the boundary case of empty arrays, using defensive checks like `messages.length > 0` rather than assuming data always exists.

### Error Handling: Proactive, Not Passive

The browser extension environment is more fragile than standard Web apps. The host page DOM may change at any time, IndexedDB operations may fail due to insufficient disk space, and Content Scripts may be interrupted by page refreshes. Therefore, all critical operations must be wrapped in try-catch blocks, and a clear distinction must be made between "recoverable errors" and "fatal errors."

Recoverable errors should be logged and handled with graceful degradation. For instance, if a selector fails to find an element, do not crash the entire Parser; instead, return an empty result or use a fallback selector. Fatal errors (such as database initialization failure) should display a friendly error prompt to the user, rather than failing silently.

Error logs must include sufficient context. Do not just write `console.error('Parse failed')`; instead, write `console.error('[ChatGPT Parser] Failed to extract messages from conversation', { conversationUrl: window.location.href, error: err.message })`. This way, when users report issues, you can quickly pinpoint which platform and which step caused the error.

Every asynchronous operation must have a clear error boundary. Use `Promise.catch()` instead of relying on global uncaught exception handlers. Be especially careful with asynchronous code inside event listeners, as their errors do not bubble up to outer try-catch blocks.

### Performance Optimization at Design Stage

MutationObserver triggers callbacks on every minute change in the DOM. During AI stream output, this may trigger hundreds of times per second. Therefore, debouncing is not an optional optimization but a mandatory design element. Use `1000ms` as the default baseline, then tune per platform based on measured stream behavior. Always keep a manual-save fallback path when auto-capture timing is uncertain.

Database queries must fully utilize indexes. When you execute `db.conversations.where('platform').equals('ChatGPT')`, Dexie uses an index for quick positioning (roughly `O(log n)` lookup behavior). However, if you use `db.conversations.filter(c => c.platform === 'ChatGPT')`, it performs an in-memory full table scan (`O(n)`), which will cause lag with large datasets. The compound index `[platform+created_at]` is already defined in the Schema; ensure your query statements hit this index.

DOM operations must be batched. Do not frequently call `querySelector` inside a loop. Instead, use `querySelectorAll` to get all nodes at once and process them in memory. Extracting a message list should follow: Get Container → Get All Child Nodes → Batch Parse → Batch Write to Database, rather than: Get Container → Loop (Get Single Node → Parse → Write).

For large conversations (ultra-long sessions with hundreds of turns), consider pagination. The Reader View should not render all messages to the DOM at once; use virtual scrolling or a "Load More" button. Although this is a "Could-have" feature, interfaces for it must be reserved during architectural design.

### Clear and Stable Module Boundaries

Each Parser should be a completely independent module; code changes in the ChatGPT Parser should not affect the Claude Parser. This is implemented via the "Selector Mapping Table" pattern: all platform-specific DOM queries are encapsulated within a private constant object inside the Parser, interacting externally only through the `IParser` interface.

Middleware must be pure functions or asynchronous functions with explicit side effects. The signature for a deduplication middleware should be `async function deduplicate(conversation: Conversation, messages: Message[]): Promise<{ conversation: Conversation, messages: Message[] } | null>`, returning the processed data or `null` (indicating it should be discarded). Middleware is not allowed to modify the passed object directly; it should return a new object or use an immutable update pattern.

Communication between UI components and the data layer must go through service interfaces and/or Chrome Runtime Message API. UI components are not allowed to import Dexie instances directly. The benefit of this is the ability to easily switch storage solutions in the future (e.g., migrating from IndexedDB to OPFS) without the UI layer being aware.

State Machine transitions must have clear type constraints. Use TypeScript's Discriminated Union to represent different states:

```typescript
type RecordingState = 
  | { status: 'STANDBY' }
  | { status: 'RECORDING'; startTime: number }
  | { status: 'PAUSED'; pausedAt: number }
  | { status: 'ARCHIVED'; archivedAt: number };

```

This way, when handling states, TypeScript forces you to check the `status` field, preventing access to non-existent properties.

## Special Constraints for Browser Extension Development

### Isolation of Content Script and Host Page

Content Scripts run in a "semi-isolated" environment: they can access the host page's DOM but cannot access the page's JavaScript variables. This means you cannot directly read React state or Redux store from the ChatGPT page; you can only infer state via the DOM.

When you need to inject UI components (such as a floating capsule bar) into the host page, you must use Shadow DOM for encapsulation. Otherwise, ChatGPT's global CSS (like Tailwind's reset rules) will pollute your component styles. Plasmo provides the `createShadowRootUi` API to simplify this process, but you still need to set `important: true` in the Tailwind configuration or use CSS variables to elevate priority.

Do not assume the DOM structure is stable. ChatGPT and Claude are both React applications, and their component structures may change with updates. Therefore, selectors should be designed with "multi-layer defense": Main Selector (most precise but may fail) + Backup Selector (more generic but maybe less precise) + Fallback Scheme (last resort). For example:

```typescript
private findMessageContainer(): Element | null {
  // Main selector: Based on data attribute
  let container = document.querySelector('[data-testid="conversation-turn"]');
  if (container) return container;
  
  // Backup selector: Based on class name patterns
  container = document.querySelector('.message-container, .chat-message');
  if (container) return container;
  
  // Fallback scheme: Based on structural characteristics
  container = document.querySelector('main > div > div[class*="message"]');
  return container;
}

```

Role parsing must follow a role-first strategy: locate role-anchored nodes first, then extract content. Never treat a mixed conversation turn container as one message if it contains both user and assistant subtrees. If role cannot be determined from node attributes, test IDs, or nearest role-bearing ancestor, drop the node and record it as `droppedUnknownRole` instead of defaulting blindly to `ai`.

### Manifest V3 Limitations and Solutions

In Manifest V3, the Background Script has become a Service Worker, which is event-driven and may be suspended by the browser at any time. Therefore, you cannot maintain long-term in-memory state in the Background; all state must be persisted to `chrome.storage` or IndexedDB.

Since Service Workers cannot directly access IndexedDB (in some browser implementations), database operations should be performed in the Content Script or an Offscreen Document. The Background's responsibility is message routing and coordination, not data processing.

Cross-context communication (Content Script ↔ Background ↔ UI) must use a type-safe message protocol. Define clear message types:

```typescript
type Message = 
  | { type: 'CONVERSATION_CAPTURED'; payload: Conversation }
  | { type: 'REQUEST_STATS'; payload: { platform?: Platform } }
  | { type: 'RESPONSE_STATS'; payload: StatsData };

```

When using `chrome.runtime.sendMessage`, always handle potential errors (e.g., receiver does not exist) and set reasonable timeout periods.

### Storage Quota and Data Cleanup Strategy

Although IndexedDB quotas are typically large (several GB), boundary conditions must still be considered. Use the `navigator.storage.estimate()` API in the settings page to display accurate usage data. When user chat records approach the quota limit, proactively prompt the user to clean up or export old data.

For ultra-long conversations (continuous sessions with thousands of turns), consider sharded storage. Do not store all messages in a massive `content_text` field; instead, split them into multiple `Message` records. This allows on-demand loading when rendering the Reader View, rather than querying several MBs of data at once.

Data migration must have clear version management. Dexie supports Schema version upgrades. When you need to add new fields or modify indexes, use `this.version(2).stores(...)` to define migration logic. Do not directly modify the Schema in the production environment, or it will corrupt user data.

## Implementation Guide for Specific Scenarios

### Robustness Design for DOM Parsing

When writing the `getMessages()` method, do not assume the number, order, or content format of message nodes is fixed. Handle the following boundary cases:

The page might still be loading, and some message nodes may not have rendered yet. Use `isGenerating()` to check if the AI is currently outputting; if so, delay parsing or mark the state as "incomplete."

Some messages may contain complex nested structures (code blocks, tables, LaTeX formulas); using `textContent` will lose formatting information. For the MVP phase, this compromise is acceptable, but reserve a `content_html` field in the interface for future upgrades.

Users may delete certain messages (some platforms support editing/deleting historical messages). Your parsing logic must be able to detect a reduction in message count. A simple approach is to only record increments (new messages) and not handle deletions or edits.

Some platforms' messages may lack explicit timestamps, requiring you to generate them. Use `Date.now()` as a fallback, but mark in the logs that this is an inferred time, not the real time.

### Capture Timing for Streaming Output

AI streaming output is a continuous process; you need to judge "when the AI has finished speaking." Different platforms have different judgment methods:

ChatGPT usually adds a loading icon with the class name `.result-streaming` at the end of the message; when this icon disappears, the output is complete.

Claude might use different mechanisms, such as adding a `data-is-streaming="true"` attribute to the message container, or inserting a cursor element after the last message node.

Gemini / DeepSeek / Doubao are future-platform targets and must not weaken current MVP reliability. Before enabling any new platform, capture real DOM samples first and define platform-specific completion rules. As a temporary generic fallback, treat output as complete only when the DOM stops changing for more than 2 seconds and keep manual-save available.

In the MutationObserver callback, do not directly execute time-consuming operations (like database writes). Set a flag and process in batches within the debounced `setTimeout` callback. This prevents blocking the UI thread.

### Consistency Guarantees for Incremental Updates

Conversation lookup and creation must follow a stable sequence: resolve by platform UUID first, then fallback to normalized URL, and only then create a new conversation after a transaction-level double-check. This avoids duplicate conversations when URL watchers and manual save run close together.

When a user continues chatting in the same conversation, your system will detect an increase in `message_count` and needs to perform an incremental update. Note the following details:

When comparing message counts, prevent concurrency issues. If the user has multiple tabs open for the same session, multiple updates might be triggered simultaneously. Use Dexie's transactions to ensure atomicity:

```typescript
await db.transaction('rw', db.conversations, db.messages, async () => {
  const current = await db.conversations.get(existingId);
  if (!current || messages.length <= current.message_count) {
    return; // Other tabs already updated, skip
  }
  // Execute update...
});

```

Extraction of new messages must be accurate. If the database has 10 messages and the current page parses 15, you should only write the last 5. However, note: if some old messages on the page were edited, the content might not match. A simple approach is to use index slicing `messages.slice(current.message_count)`, but a more robust method is to compare content hashes.

When updating the `updated_at` field, use `Date.now()` instead of server time (since there is no server). This timestamp is used for sorting and statistics; precision requirements are low, but it must be monotonically increasing.

### Implementation Strategy for Smart Noise Reduction

The core of the noise reduction middleware is a rule engine. Rules should be configurable, stored in `chrome.storage`, allowing users to adjust thresholds in the settings page. Default rules can refer to the definitions in the documentation, but design them in a "building-block" style, where each rule is an independent predicate function:

```typescript
type NoiseRule = (conversation: Conversation, messages: Message[]) => boolean;

const isShortConversation: NoiseRule = (conv, msgs) => msgs.length < 3;
const isTrivialTranslation: NoiseRule = (conv, msgs) => 
  /翻译|translate|polish|润色/i.test(conv.title);
const isLowInformation: NoiseRule = (conv, msgs) => {
  const totalChars = msgs.filter(m => m.role === 'ai')
    .reduce((sum, m) => sum + m.content_text.length, 0);
  return totalChars < 50;
};

const noiseRules: NoiseRule[] = [
  isShortConversation,
  isTrivialTranslation,
  isLowInformation,
];

function isNoise(conv: Conversation, msgs: Message[]): boolean {
  return noiseRules.some(rule => rule(conv, msgs));
}

```

Filtered conversations should not be deleted immediately but marked as `is_trash: true` and moved to a virtual "Recycle Bin." This allows users to recover mistakenly filtered content by selecting "Show filtered conversations" in settings.

Provide a "Re-evaluate" function allowing users to batch re-filter all conversations after adjusting rules. This requires a background task to traverse the database; ensure it doesn't block the UI by using `requestIdleCallback` to execute when the browser is idle.

## Testing and Debugging Guidelines

### Unit Testing Covering Key Logic

Although time is tight in a Hackathon, writing unit tests for core pure functions (like noise reduction rules, message parsing logic) is a worthy investment. Use Vitest as the testing framework (it integrates seamlessly with Vite) and create corresponding test files for each Parser.

Test cases must cover normal situations and boundary conditions. For the `parseMessageNode()` method, test at least: standard User-AI dialogue, user-only messages, AI-only messages, messages containing code blocks, and empty message nodes.

Use fixture files to save real DOM structures. Copy the `outerHTML` of a message node from the ChatGPT page, save it as `__fixtures__/chatgpt-message.html`, and load it in tests to create the test environment. This way, even if ChatGPT updates the DOM structure, you only need to update the fixture file without changing the test code.

For tests involving IndexedDB, use the `fake-indexeddb` library to mock the database environment. This allows tests to run in a Node.js environment without requiring a real browser.

### Debugging Tools and Logging Strategy

During the development phase, use console logs with colors and emojis to quickly pinpoint issues. Define a logger utility function:

```typescript
const logger = {
  capture: (msg: string, data?: any) => 
    console.log('🎯 [Capture]', msg, data),
  parse: (msg: string, data?: any) => 
    console.log('📝 [Parser]', msg, data),
  db: (msg: string, data?: any) => 
    console.log('💾 [Database]', msg, data),
  error: (msg: string, error: Error) => 
    console.error('❌ [Error]', msg, error),
};

```

For parser diagnostics, always emit a compact stats object at the end of each capture pass: `totalCandidates`, `keptMessages`, `roleDistribution`, `droppedUnknownRole`, and `droppedNoise`. If `roleDistribution` only has one side in a non-empty conversation, log a warning and include up to three sample snippets for inspection.

In the production environment, detailed logs should be disabled via a configuration switch, keeping only error logs. You can use the environment variable `process.env.NODE_ENV === 'development'` to judge.

For hard-to-reproduce issues (like parsing failures caused by specific conversation formats), add a "Snapshot" feature in the code: when an exception is detected, automatically serialize the current DOM structure, parsing results, and error information into JSON and store it in `chrome.storage.local` for later analysis.

Use the Performance panel in Chrome DevTools to analyze performance bottlenecks. Pay special attention to MutationObserver trigger frequency, database query duration, and UI rendering FPS. If an operation takes longer than 16ms (one frame at 60fps), it needs optimization.

### User Feedback and Error Reporting Mechanism

Although it is a Local-First architecture, you still need to know the plugin's status in real environments. Add an "Export Diagnostic Info" button on the settings page, generating a JSON file containing: plugin version, browser version, number of captured conversations, and recent error logs (desensitized, excluding conversation content).

When users report issues, guide them to export this diagnostic file and send it to you. This allows you to quickly understand their environment configuration without accessing their private conversation content.

For common errors (like "Selector Failure"), display friendly prompt messages in the UI instead of showing users a blank page. For example: "We detected that ChatGPT's page structure may have been updated, and some conversations may not be saved automatically. Please click here to report the issue."

## Code Review Self-Check List

Before submitting every Pull Request (or letting the Coding Agent generate code), check against this list:

**Type Safety Check**: Do all functions have explicit type annotations? Is there abuse of the `any` type? Are optional fields correctly using the `?` marker?

**Error Handling Check**: Do all asynchronous operations have `try-catch` or `.catch()`? Are database write failures handled? Does DOM querying check for `null` return values?

**Performance Check**: Are there unnecessary nested loops? Do database queries utilize indexes? Are DOM operations batched? Are there event listeners or timers that could cause memory leaks?

**Architecture Check**: Do dependencies between modules comply with layering principles? Do UI components access the database directly? Does the Parser contain platform-independent generic logic (if so, it should be extracted to a common module)?

**Maintainability Check**: Do variable names clearly express business meaning? Does complex logic have explanatory comments? Are timing thresholds (like debounce milliseconds) extracted as named constants?

**Testing Check**: Do critical pure functions have corresponding unit tests? Are boundary conditions covered by tests?

**Documentation Check**: Do exported interfaces have JSDoc comments? Do complex algorithms have explanations of their time and space complexity?
