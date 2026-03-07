# 2026-03-07 压缩功能落地状态备忘录（给并行优化贡献者）

## 0. 范围定义（先对齐）
本文“压缩功能”仅指 Prompt Engine 内 **Agent A Compaction**（对话先压缩，再进入 Thread Summary 结构化映射）的链路。  
不包含 Data 页面的“Compacted threads”统计口径。

---

## 1. 当前落地程度（结论先行）
整体判断：**已完成运行时接入（可用），未完成 Prompt-as-Code 最终收口（半落地）**。  
建议按工程成熟度评估为：**~70%**。

---

## 2. 已落地（可直接依赖）

### 2.1 运行时链路已接通（生产路径）
- `generateConversationSummary` 已调用 compaction 路径：
  - `frontend/src/lib/services/insightGenerationService.ts`
  - 核心入口：`runCompaction(...)`、`shouldSkipSummaryCompaction(...)`
- 路由策略：
  - 大对话先走 `compaction -> conversationSummary`
  - 小对话走 `direct`（跳过 compaction）
- 跳过阈值已落盘：
  - `SUMMARY_COMPACTION_SKIP_MAX_MESSAGES = 14`
  - `SUMMARY_COMPACTION_SKIP_MAX_CHARS = 3600`

### 2.2 降级与韧性已落地
- Compaction 失败不会中断 Summary：自动回退到 direct 路径。
- Summary 两轮修复失败后仍有本地合成兜底（`SUMMARY_LOCAL_SYNTHESIS_USED`）。
- 关键日志字段已具备：
  - `compactionUsed`
  - `compactionFailed`
  - `compactionCharsIn/Out`
  - `summaryPath`
  - `summaryCompactionSkipped`

### 2.3 门禁与 CI 已部分到位
- 本地严格命令可跑：`pnpm -C frontend eval:prompts --mode=mock --strict`
- PR 门禁 workflow 已存在：`.github/workflows/prompt-schema-drift-pr.yml`
- Nightly live smoke 已存在：`.github/workflows/prompt-live-smoke-nightly.yml`

---

## 3. 未落地 / 漂移点（并行优化重点）

### 3.1 Prompt-as-Code “文档真源 -> generated bundle”未完成
- 文档契约声明 canonical source 是 `documents/prompt_engineering/*`。
- 但运行时仍直接读取 TS 内联 prompt：
  - `frontend/src/lib/prompts/compaction.ts`
  - `frontend/src/lib/prompts/conversationSummary.ts`
  - `frontend/src/lib/prompts/weeklyDigest.ts`
- `frontend/src/lib/prompts/generated/*` 目录目前不存在。

### 3.2 版本目标存在文档-运行时漂移
- 文档多处写明默认目标：
  - `conversation_summary.v3`
  - `weekly_lite.v2`
- 运行时与类型系统当前仍是：
  - `conversation_summary.v2`
  - `weekly_lite.v1`
- 相关现状文件：
  - `frontend/src/lib/types/index.ts`
  - `frontend/src/lib/services/insightSchemas.ts`
  - `frontend/src/lib/prompts/conversationSummary.ts`
  - `frontend/src/lib/prompts/weeklyDigest.ts`

### 3.3 Eval 对 compaction 缺乏独立覆盖
- `scripts/eval-prompts.ts` 目前只评估：
  - `conversationSummary`
  - `weeklyDigest`
- 没有 compaction 专项用例集（`eval/gold/compaction` 不存在）。
- 结果：compaction 质量退化可能被“下游 summary 成功”掩盖。

### 3.4 观测面有日志，无产品化看板
- 目前 compaction 指标主要在 runtime logger；
- 未沉淀为可查询的稳定指标面板/报表（例如成功率、压缩比、跳过率趋势）。

---

## 4. 给并行贡献者的工作拆分（推荐）

### Track A（P0）：真源收口（文档驱动生成）
目标：把文档 prompt 编译到 `generated`，替换内联 prompt 作为运行时唯一来源。  
完成标准：
1. 新增生成脚本（build 前执行）
2. 生成产物带 metadata（`id/version/schemaTarget/hash/updatedAt`）
3. 运行时仅 import `generated/*`

### Track B（P0）：Compaction 专项评测
目标：补上 Agent A 的独立质量门禁。  
完成标准：
1. 新增 `eval/gold/compaction/*`
2. 在 `scripts/eval-prompts.ts` 增加 compaction 模式
3. 输出压缩比、模板锚点完整率、主体隔离命中率

### Track C（P1）：Schema 升级闭环（v2/v1 -> v3/v2）
目标：消除 docs 与 runtime 漂移。  
完成标准：
1. 类型、schema parser、prompt、UI 渲染同版本对齐
2. 明确 one-cycle legacy 兼容策略
3. 通过 mock + live smoke 双门禁

### Track D（P1）：可观测性产品化
目标：把 compaction 关键指标转为可追踪资产。  
完成标准：
1. 日志字段稳定化
2. 最小 dashboard 或导出报表
3. 支持按 prompt version 对比回归

---

## 5. 并行开发边界（防冲突）
1. 本轮 rc.6 正在做 capture/platform 扩展，**不要改 capture/parser 路径**。  
2. Prompt 优化优先聚焦：
   - `frontend/src/lib/prompts/*`
   - `frontend/src/lib/services/insightSchemas.ts`
   - `scripts/eval-prompts.ts`
   - `eval/*`
   - `documents/prompt_engineering/*`
3. 先把“真源 + 门禁”闭环，再做 prompt 文案微调。

---

## 6. 最小验收命令（并行分支必须过）
```powershell
pnpm -C frontend exec tsc --noEmit
pnpm -C frontend eval:prompts --mode=mock --strict
pnpm -C frontend build
```
若改到 web 共享类型，再加：
```powershell
pnpm -C vesti-web build
```

---

## 7. 备注
- `documents/prompt_engineering` 里部分中文内容在 Windows 控制台可能显示乱码，这不等于运行时一定损坏；请以文件实际编码与运行结果为准。