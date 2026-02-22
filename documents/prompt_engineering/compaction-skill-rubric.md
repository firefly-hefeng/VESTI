# Vesti Agent A Rubric: Compaction Skill 评分与验收准则

Version: v1.7.0-rc.x  
Scope: `documents/prompt_engineering/compaction-skill.md` 的工程验收  
Audience: Prompt engineering, QA, runtime owner

---

## 1. 适用范围
本准则用于评估单一切片（Chunk）经 Agent A 压缩后的 Markdown 骨架质量，不用于直接指导模型输出。

---

## 2. 评分公式
总分 = Σ(单项权重 × 单项得分 / 5)

单项得分区间：1-5 分。

---

## 3. 评分量表 (Scoring Matrix)

| 维度 | 权重 | 1 分（不可用） | 3 分（勉强可用） | 5 分（工业级） |
| --- | ---: | --- | --- | --- |
| 逻辑链与主体隔离 | 20 | 推演断裂，`[User]/[AI]` 混淆 | 主体大体可分，但关键步骤主语模糊 | 推演链完整，主体边界稳定可追溯 |
| 经验锚定能力 | 15 | 抽象复述，无现实落点 | 有映射但弱、泛化严重 | 抽象术语均有工作定义+具体表征 |
| 概念矩阵刚性 | 15 | 引入输入外概念，定义漂移 | 术语提取可用但定义松散 | 术语边界清晰，定义与语境强绑定 |
| 矛盾保留与启发性 | 15 | 被强行圆满化，张力消失 | 保留少量张力但启发弱 | 未决张力清晰，后续追问接口明确 |
| 体积节制与信息密度 | 15 | 严重超带或严重信息熵丢失 | 在边缘区间且冗余偏多 | 落在目标区间，语言紧凑且信息密度高 |
| 格式与结构契约 | 20 | 模板锚点缺失，解析失败 | 结构基本可读，局部不规范 | 模板完整、机器可解析、无模板外噪声 |

---

## 4. 一票否决项 (Veto Conditions)
命中任意一项，直接判定失败：

1. **Fabrication**：输出出现输入中不存在的新实体或新概念。  
2. **Parser Failure**：固定锚点缺失，导致下游解析失败。  
3. **Homogenization**：过程性推演被折叠为单句平面摘要。  
4. **Constraint Breach**：字符量超出当前压缩区间上限。  
5. **Anchor Failure**：抽象概念缺失 `Working Definition + Concrete Mapping` 配对。  

---

## 5. 体积区间判定规则

1. 默认区间：7%-13%，目标点 10%。  
2. 高稀疏区间：5%-8%，触发条件为平均每轮自然语言字数 `< 100`。  
3. 分母使用 `effective_chars`：剔除代码块与结构化数据黑盒内容。  

---

## 6. 验收建议阈值

建议通过线：
1. 总分 >= 85  
2. 否决项命中 = 0  
3. 格式与结构契约维度 >= 4 分  

---

## 7. 记录模板

```md
# Compaction QA Record

- Case ID:
- Chunk Size:
- Effective Chars:
- Ratio Band:
- Output Chars:
- Score:
- Veto Hit:
- Notes:
```
