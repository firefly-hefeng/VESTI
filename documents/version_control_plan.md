# Vesti 版本控制与发布规范（v1.0.0+）

状态：Active  
生效范围：自 `v1.0.0` 之后的全部开发与发布  
最后更新：2026-02-28

---

## 1. 目标与原则

本规范用于将仓库从“单主分支 + 临时发布”升级为可持续的工程发布体系。

核心目标：
- 让每次改动有清晰来源（分支）
- 让每次发布可追踪、可回滚（annotated tag）
- 让版本号在 Git 与扩展包层面保持一致（tag <-> package version）

核心原则：
- `main` 只承载可发布代码
- 所有开发通过短生命周期分支 + PR 合并
- 已发布 tag 不可变
- 发布前必须完成 changelog 和版本号对齐

---

## 2. 基线定义

- 当前稳定基线：`v1.0.0`
- 基线说明：MVP 收官版本
- 从 `v1.0.0` 开始，禁止继续“直接在 main 开发 + 临时打包发布”

---

## 3. 分支模型（Trunk-Based Lite）

### 3.1 分支角色

- `main`：唯一发布主线（受保护，禁止直推）
- `feature/<topic>`：新功能开发
- `fix/<topic>`：普通缺陷修复
- `docs/<topic>`：文档类改动
- `chore/<topic>`：工程维护类改动
- `release/vX.Y.Z-rc.N`：发布候选分支（短生命周期）
- `hotfix/vX.Y.Z`：线上紧急修复分支（从 `main` 拉取）

### 3.2 合并策略

- 常规开发：`feature|fix|docs|chore` -> PR -> `main`
- 发布候选：从 `main` 切 `release/*` 做候选验证，通过后回合并 `main` 并打正式 tag
- 紧急修复：`hotfix/*` -> PR -> `main` -> 打 patch tag

### 3.3 仓库保护建议（GitHub Settings）

- 打开 branch protection（`main`）
- 禁止 force push
- 要求 PR review（至少 1 人）
- 要求通过基础检查（build/typecheck）

### 3.4 PR 治理与去混淆规则（强制）

- 单 PR 单主题：禁止将 `embeddings + CI + observability` 等多主题混装到同一个 PR。
- 同主题重复 PR 处理时限：新 PR 合并后 24 小时内关闭旧 PR，并在旧 PR 留言 `superseded by #<id>`。
- 合并前必须完成基线重整：PR 分支需先 `rebase main` 或 `merge main`，避免陈旧分支直接合并。
- 合并前范围核对：`git diff --name-only origin/main...HEAD` 必须与 PR 描述中的目标文件/范围一致。
- 冲突/脏状态 PR（DIRTY）禁止带风险直合：必须先拆分成最小 PR 回收有效改动。

---

## 4. 标签与版本策略（SemVer + pre-release）

### 4.1 版本格式

- 正式版：`vX.Y.Z`
- 预发布：`vX.Y.Z-rc.N` / `vX.Y.Z-beta.N`

### 4.2 版本递增规则

- Patch（`+0.0.1`）：缺陷修复、行为兼容
- Minor（`+0.1.0`）：新增功能、向后兼容
- Major（`+1.0.0`）：不兼容变更

### 4.3 标签要求

- 统一使用 annotated tag：`git tag -a`
- 已发布 tag 不可重写、不可复用
- 发现问题发布新版本（例如 `v1.0.1`），禁止覆盖旧 tag

---

## 5. 版本号强绑定（Git tag <-> package version）

发布前必须保证：
- `v1.0.1` -> `frontend/package.json` 的 `version = "1.0.1"`
- `v1.1.0-rc.1` -> `frontend/package.json` 的 `version = "1.1.0-rc.1"`

不满足时，禁止发布。

建议发布前执行校验：

```bash
# 查看当前扩展版本号
node -p "require('./frontend/package.json').version"

# 查看准备发布的 tag
git describe --tags --abbrev=0
```

---

## 6. 常规发布 SOP（功能发布）

1. 从 `main` 拉分支：`feature/*` 或 `fix/*`
2. 完成开发与验证（至少 build 通过）
3. 提交 PR 并合并到 `main`
4. 更新 `CHANGELOG.md`（将目标变更从 `Unreleased` 整理到版本块）
5. 更新 `frontend/package.json` 版本号
6. 可选：创建候选分支并打 RC 标签验证
   - `release/vX.Y.Z-rc.N`
   - `git tag -a vX.Y.Z-rc.N -m "..."`
7. 正式发布：
   - `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
   - `git push origin main`
   - `git push origin vX.Y.Z`
8. 归档交付物到 `release/`（命名建议：`Vesti_MVP_vX.Y.Z.zip`）

---

## 7. Hotfix SOP（线上紧急修复）

1. 从 `main` 切 `hotfix/vX.Y.Z`
2. 仅修复阻断问题，禁止混入新功能
3. 快速验证（build + 关键路径手测）
4. PR 合并 `main`
5. 更新 changelog 对应 patch 版本块
6. 更新 `frontend/package.json` 到 patch 版本
7. 打补丁 tag 并推送

---

## 8. 回滚与追溯策略

- 任意线上版本可通过 tag 回溯：

```bash
git checkout v1.0.0
```

- 回滚原则：
  - 优先“发布新修复版本”而非重写历史
  - 不删除或修改已发布 tag

---

## 9. 命令清单（可直接复制）

### 9.1 新功能分支

```bash
git checkout main
git pull origin main
git checkout -b feature/<topic>
```

### 9.2 修复分支

```bash
git checkout -b fix/<topic>
```

### 9.3 候选发布（可选）

```bash
git checkout -b release/v1.0.1-rc.1
git tag -a v1.0.1-rc.1 -m "Release candidate v1.0.1-rc.1"
git push origin release/v1.0.1-rc.1
git push origin v1.0.1-rc.1
```

### 9.4 正式发布

```bash
git checkout main
git pull origin main
git tag -a v1.0.1 -m "Release v1.0.1"
git push origin main
git push origin v1.0.1
```

---

## 10. 常见错误与禁止操作

禁止：
- 直接在 `main` 开发并直推
- 修改/覆盖已发布 tag
- 未更新 changelog 即发布
- `package.json` 版本与发布 tag 不一致
- 在 hotfix 分支混入无关功能
- 重复 PR 长期并存且不标注 superseded 关系
- 在一个 PR 中混入多条无关发布线改动（例如功能修复 + CI 治理 + 观测增强）
- 在未完成 `main` 重基线时直接请求合并
- 将自动生成文件漂移作为功能改动提交（见第 13 节）

---

## 11. 责任分工（默认）

- 开发者：分支开发、PR、自测、更新对应文档
- 发布负责人：核对 changelog、版本号、tag、release 包
- 评审者：确认改动范围、风险与发布说明一致

---

## 12. 发布前检查清单

- [ ] 目标分支已合并到 `main`
- [ ] `CHANGELOG.md` 已完成版本整理
- [ ] `frontend/package.json` 版本号与目标 tag 一致
- [ ] `pnpm build` 通过
- [ ] 发布 tag 为 annotated tag
- [ ] tag 已推送到远程
- [ ] `release/` 交付物命名符合版本号
- [ ] Open PR 清洁度检查通过（无重复/冲突/已 superseded 未关闭 PR）
- [ ] 工作区洁净检查通过（`git status -sb` 无 tracked 非计划改动）
- [ ] 范围核对通过（`git diff --name-only origin/main...HEAD` 与 PR 目标一致）

---

## 13. 自动生成文件治理（新增）

### 13.1 适用文件

- `vesti-web/next-env.d.ts`（Next.js 工具链生成、可能因 `build/dev` 在引用路径上漂移）

### 13.2 治理规则

- 默认视为“受工具生成影响的 tracked 文件”，不作为常规功能改动提交。
- 若仅出现以下路径切换差异，必须在功能/发布 PR 前回退：
  - `./.next/dev/types/routes.d.ts` <-> `./.next/types/routes.d.ts`
- 仅当升级 Next.js 或 typed-routes 机制时，允许提交该文件。
- 允许提交时，PR 描述必须包含：
  - 生成来源（哪个命令或版本变更触发）
  - 影响范围（仅类型引导或包含行为变更）
  - 回滚方式（如何恢复旧状态）

### 13.3 日常执行门禁

- 本地执行 `pnpm -C vesti-web build` 后，立即检查 `git status -sb`。
- 若仅 `next-env.d.ts` 漂移，先回退再继续其它提交流程。
- 根目录 `pnpm-lock.yaml` 可按项目策略继续保持未跟踪，不纳入本节违规项。

---

## 14. 2026-02-28 版本管理疏忽复盘（简版）

### 14.1 观察到的疏忽

- 疏忽 A：`#22/#23` 与主线已合并语义重叠后未第一时间关闭。
- 疏忽 B：重复 PR（`#24`）造成审计噪音和决策成本增加。
- 疏忽 C：混合 PR（功能 + CI + 可观测性）导致评审难度上升，回收成本高。
- 疏忽 D：`next-env.d.ts` 自动漂移未纳入合并前门禁，污染工作区。

### 14.2 对应改进动作（已纳入本文）

- 对 A/B：执行第 3.4 节“重复 PR 24 小时关闭 + superseded 留痕”规则。
- 对 C：执行第 3.4 节“单 PR 单主题 + DIRTY PR 拆分回收”规则。
- 对 D：执行第 13 节“自动生成文件治理 + 提交前回退”规则。
