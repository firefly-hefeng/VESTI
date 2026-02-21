# Vesti 综合架构总结（v1.3 终版）

Version: v1.3-final  
Status: Baseline for cross-functional review  
Audience: Frontend Engineer, UI Designer, QA

---

## 1. 文档目的

本文件给出当前 `Vesti` 的工程架构全景（代码现实，而非理想态），用于：

1. 前端工程评估：模块边界、可维护性、扩展成本。  
2. UI 设计评估：信息架构、视觉系统、交互入口一致性。  
3. 下阶段规划输入：v1.4 UI 重构 + v1.5 悬浮胶囊升级。

结论前置：
- v1.3 已完成六平台采集与治理联动（ChatGPT/Claude/Gemini/DeepSeek/Qwen/Doubao）。
- 捕获治理核心与手动归档链路已稳定。
- 下一阶段按版本拆分：v1.4 先做全局 UI 重构，v1.5 再做悬浮胶囊能力升级。

---

## 2. 当前系统边界（What the system is now）

### 2.1 运行时形态

该扩展由四个运行面构成：

1. **Content Scripts（每个平台）**  
   负责 DOM 解析、观察、捕获发送、页面内 transient 快照。
2. **Background**  
   负责 tab 级路由、active capture 状态聚合、手动归档转发、sidepanel 打开。
3. **Offscreen**  
   负责数据写入与查询、导出、LLM 摘要/周报调用。
4. **Sidepanel (React)**  
   负责四个主分区（timeline/insights/data/settings）与 Reader 子视图。

### 2.2 平台覆盖

Host permissions（`frontend/package.json`）：
- `chatgpt.com`
- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`
- `chat.deepseek.com`
- `www.doubao.com`
- `chat.qwen.ai`

---

## 3. 目录与模块地图（Code map）

### 3.1 顶层关键目录

- `frontend/src/background/`：后台消息与路由。
- `frontend/src/offscreen/`：持久层与 AI 服务调用入口。
- `frontend/src/contents/`：平台内容脚本 + 浮动入口。
- `frontend/src/lib/`：核心库（parser/capture/db/messaging/services/types）。
- `frontend/src/sidepanel/`：侧边栏 UI。
- `documents/capture_engine/`：v1.2/v1.3 捕获治理与平台扩展文档。
- `documents/ui_refactor/`：v1.4 UI 重构规格包。
- `documents/floating_capsule/`：v1.5 悬浮胶囊规格包。

### 3.2 平台 Parser 模块

`frontend/src/lib/core/parser/` 下已包含：
- `chatgpt/`
- `claude/`
- `gemini/`
- `deepseek/`
- `qwen/`
- `doubao/`
- `shared/`（选择器工具）

统一接口：`IParser`（`detect/getConversationTitle/getMessages/isGenerating/getSessionUUID/getSourceCreatedAt`）。

---

## 4. 核心数据与语义模型

### 4.1 关键类型

在 `frontend/src/lib/types/index.ts`：

- `Platform`: 六平台联合类型。
- `CaptureMode`: `mirror | smart | manual`。
- `CaptureDecisionMeta`: 捕获判定元数据（reason/messageCount/turnCount/...）。
- `ActiveCaptureStatus`: sidepanel 与 capsule 消费的活跃线程状态。
- `Conversation.turn_count`: 明确定义为 **AI replies**（非 message_count/2）。

### 4.2 本地设置（chrome.storage.local）

- `vesti_capture_settings`：捕获治理设置（mode + smartConfig）。
- （v1.5 预留）`vesti_capsule_settings`：胶囊 UI 设置。

### 4.3 IndexedDB（Dexie）

数据库：`MemoryHubDB`（`frontend/src/lib/db/schema.ts`）

当前 schema 版本：`v4`，主要表：
- `conversations`
- `messages`
- `summaries`
- `weekly_reports`

关键索引与语义：
- 会话唯一性语义：`[platform+uuid]`。
- `source_created_at`：源会话创建时间（best-effort，可为空）。
- `turn_count`：AI 回复数；v4 migration 会对历史数据回填。

---

## 5. 捕获引擎架构（v1.2+）

### 5.1 数据流

`Content Parser -> ConversationObserver -> CapturePipeline -> CAPTURE_CONVERSATION -> Storage Interceptor -> deduplicateAndSave -> Dexie`

### 5.2 观测与节流

- DOM 监听：`MutationObserver`。
- 默认防抖：`1000ms`（`ConversationObserver`）。

### 5.3 Gatekeeper（写库前拦截）

在 `frontend/src/lib/capture/storage-interceptor.ts`：

1. 空 payload -> `rejected/empty_payload`。
2. 缺会话 ID -> `held/missing_conversation_id`（strict-id 基线）。
3. `forceFlag=true` -> `committed/force_archive`（但不绕过 missing-id）。
4. mirror -> 直接 commit。
5. manual -> 全部 held。
6. smart -> AI turn 阈值 + blacklist 双条件。

### 5.4 事件规则（重要）

- 仅在 `saved=true` 时发送 `VESTI_DATA_UPDATED`。
- held/rejected 不触发数据刷新事件。

---

## 6. 手动归档链路（Step4 已落地）

### 6.1 transient 内存

每个 content script 保持最新 `payload + decision`（RAM only）：
- 页面刷新/关闭后丢失（设计接受）。

### 6.2 Sidepanel 操作链

`SettingsPage -> background(FORCE_ARCHIVE_TRANSIENT) -> active tab content script -> CAPTURE_CONVERSATION(forceFlag=true) -> gatekeeper`

错误码与文案映射已落地（如 `TRANSIENT_NOT_FOUND`、`ACTIVE_TAB_UNSUPPORTED`、`missing_conversation_id`）。

---

## 7. 平台解析层现状（v1.3）

### 7.1 通用策略

六平台 parser 均采用：
1. selector 主策略
2. anchor fallback
3. 噪声清理
4. 近邻重复抑制
5. parse stats 日志

### 7.2 已固化的平台差异处理

- **Gemini**：无独立标题字段，标题优先首条 user 语义；防泛标题。  
- **Qwen**：收敛到会话 root，避免历史列表污染；标题使用首条 user 消息。  
- **DeepSeek**：适配 `.ds-message` 与无 `<main>` 结构；显式支持 `/a/chat/s/<id>`。  
- **Claude/DeepSeek**：标题后缀 `- Claude / - DeepSeek` 清理已纳入热修。  

### 7.3 会话身份策略（统一）

- ID 必须来自稳定 URL（path/query 解析）。
- 不再生成伪 ID。
- 无 ID 时 hold，等待后续 URL 稳定后补写。

---

## 8. Sidepanel 信息架构

入口组件：`frontend/src/sidepanel/VestiSidepanel.tsx`

当前运行时（v1.3）：
- `timeline`：会话流 + 搜索 + 卡片动作（并在选中时打开 Reader 子视图）。
- `insights`：摘要/周报展示与生成。
- `settings`：模型配置 + capture engine + 手动归档。
- `data`：存储、导出、清理。
- Dock：右侧导航 rail 在 v1.4 UI 基线中校准为 `52px`（约原 64px 的 0.8 倍）。

Threads 搜索语义（v1.4 UI 基线）：
- 搜索范围：`title + snippet + messages.content_text`（user + ai）。
- 触发门槛：正文搜索在 query 长度 `>=2` 时触发；单字符仅标题/摘要匹配。
- 排序：保持 `updated_at` 最近优先，不切换为相关性排序。
- 命中反馈：仅正文命中时显示轻量提示 `Matched in messages`。

v1.4 命名契约（文档冻结）：
- UI 标签：`Threads / Insights / Data / Settings`
- 内部 route id 兼容：`timeline / insights / data / settings`
- `ReaderView`：仅作为 Threads 内下钻，不作为平级导航项。

刷新机制：
- 监听 runtime 消息 `VESTI_DATA_UPDATED`，更新 `refreshToken`。

---

## 9. 视觉系统与设计 Token

### 9.1 设计 token

在 `frontend/src/style.css` + `frontend/tailwind.config.ts`：

- 全局语义色、边框、阴影、字体 token。
- 六平台徽标色 token（Metro 方案已统一）：
  - ChatGPT `#10A37F`
  - Claude `#CC785C`
  - Gemini `#AD89EB`
  - DeepSeek `#0D28F3`
  - Qwen `#615CED`
  - Doubao `#1E6FFF`

### 9.2 设计评估关注点

1. 信息层级是否统一（Timeline/Reader/Insights 统计口径）。
2. 胶囊与 sidepanel 视觉语言是否一致。
3. 状态色与文案是否可一眼区分（mirroring/holding/ready/saved/error）。

---

## 10. 下一阶段规格包（v1.4 / v1.5）

### 10.1 当前实现

`frontend/src/contents/capsule-ui.tsx` 现状是：
- 静态圆形按钮
- 点击仅打开 sidepanel
- 无状态显示、无手动归档、无拖拽与持久化

### 10.2 v1.4 目标（UI 重构，已建规格）

文档目录：`documents/ui_refactor/`

包含：
- `v1_4_information_architecture_contract.md`
- `v1_4_ui_refactor_engineering_spec.md`
- `v1_4_ui_refactor_component_system_spec.md`
- `ui_refactor_debugging_playbook.md`
- `ui_refactor_manual_sampling_and_acceptance.md`

关键冻结点：
- 四分区命名：Threads / Insights / Data / Settings
- Reader 并入 Threads 子流（非平级 Tab）
- Center Logo 单动作：手动归档当前会话
- 知识库入口：Insights Header

### 10.3 v1.5 目标（悬浮胶囊，已建规格）

文档目录：`documents/floating_capsule/`

包含：
- `v1_5_floating_capsule_engineering_spec.md`
- `v1_5_floating_capsule_state_machine_spec.md`
- `floating_capsule_debugging_playbook.md`
- `floating_capsule_manual_sampling_and_acceptance.md`

---

## 11. 工程质量与可观测性现状

### 11.1 已有优势

- 判定日志可追踪（mode/decision/reason/messageCount/turnCount）。
- parser stats 完整（candidate/kept/roleDistribution/dropped）。
- 关键链路（force archive）错误码已标准化。

### 11.2 当前技术债（建议）

1. background 与 offscreen 请求处理存在一定重复逻辑（可后续抽象路由层）。
2. content script 模板化程度可再提升（六平台入口结构高度相似）。
3. UI 状态来源分散（sidepanel 与未来 capsule 建议共享状态适配器）。

---

## 12. 前端工程师评估清单（建议）

1. **架构边界**：parser/capture/ui/service 依赖方向是否清晰。  
2. **扩展成本**：新增平台是否只需新增 parser + content entry。  
3. **状态一致性**：sidepanel 与 capture 实际状态是否单一真源。  
4. **错误恢复**：路由失败、host 不支持、transient 丢失时降级是否充分。  
5. **性能**：observer 触发频率、parser 成本、sidepanel 刷新范围。

---

## 13. UI 设计师评估清单（建议）

1. **跨页面一致性**：Timeline/Reader/Insights/Settings 的组件语言一致性。  
2. **状态可理解性**：capture 状态文案、颜色、动作可发现性。  
3. **主次交互**：手动归档入口层级是否合理（sidepanel vs capsule）。  
4. **信息密度**：`messages · turns`、平台标签、时间字段可读性。  
5. **版本分层**：v1.4 聚焦 sidepanel UI 重构，v1.5 聚焦胶囊形态（展开/收起、动效、拖拽、避障）。

---

## 14. 版本结论与下一步

### v1.3 结论

- 平台扩展与捕获治理已形成可运行闭环。
- 手动归档链路稳定。
- 标题、turn 语义、strict-id 等关键质量问题已完成热修。

### v1.4 建议起点（UI 重构）

以 `documents/ui_refactor/` 规格为基线，先完成侧边栏信息架构与组件系统收敛：
1. 先落地 `v1_4_information_architecture_contract.md` 里的边界与命名。  
2. 再统一组件状态与反馈样式。  
3. 最后做跨页面交互一致性收敛。  

### v1.5 建议起点（悬浮胶囊）

以 `documents/floating_capsule/` 规格为基线，从最小可运行胶囊状态版开始：
1. 先做状态可视化与动作可达。  
2. 再做拖拽与偏好持久化。  
3. 最后做动效与细节收敛。

---

## 15. 关联文档

- `documents/capture_engine/v1_2_capture_governance_spec.md`
- `documents/capture_engine/v1_3_platform_expansion_spec.md`
- `documents/capture_engine/v1_3_phase1_execution_log.md`
- `documents/capture_engine/v1_3_phase2_execution_log.md`
- `documents/capture_engine/capture_debugging_playbook.md`
- `documents/ui_refactor/v1_4_information_architecture_contract.md`
- `documents/ui_refactor/v1_4_ui_refactor_engineering_spec.md`
- `documents/ui_refactor/v1_4_ui_refactor_component_system_spec.md`
- `documents/floating_capsule/v1_5_floating_capsule_engineering_spec.md`
- `documents/floating_capsule/v1_5_floating_capsule_state_machine_spec.md`
