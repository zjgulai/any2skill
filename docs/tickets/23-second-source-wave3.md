# 23：第二源第三波——集合 / 泛型 trait 生命周期 / 闭包迭代器（ch08/ch10/ch13）

**要构建什么（目标）：**第三波 8 文件补抽 → 走与卡 21/22 相同的全链（环 3 重跑 →
合并重放 → 门禁一 → 门禁二 → 发布 → 门禁三 → 冻结），扩大 rust 发布面。

- `ch08-01-vectors` / `ch08-02-strings` / `ch08-03-hash-maps`（集合）
- `ch10-01-syntax` / `ch10-02-traits` / `ch10-03-lifetime-syntax`（泛型 / trait / 生命周期）
- `ch13-01-closures` / `ch13-02-iterators`（闭包 / 迭代器）

**规模**：≈151KB / 8 文件（波 2 为 93KB）——预估 ~90–110 对象、~200 次环 2 调用。

**本波与前两波的机制差异**：跨章合成池（卡 22）**已在位**——新章的陷阱段可直接由
合成池供来源（主题 T03/T05/T09 已就绪），门禁一的「陷阱门槛」不应再成批挡人。
验证点：本波门禁一通过率是否显著高于波 2（波 2 是 5/11，卡 22 报告 §4 规律 1 的预测）。

**状态：**进行中（2026-10-14）。

## 步骤

1. [ ] 环 2 抽取（8 文件，逐文件独立账本）
2. [ ] 环 3 重跑（旧 16 章复用；新 8 章付费）→ 新候选
3. [ ] 合并计划重放（`apply-resplit` 幂等，3 对已有 + 可能新对按规则录取）
4. [ ] 门禁一干跑全体；对比波 2 通过率（验证「合成池供给陷阱」的预测）
5. [ ] 门禁二（新候选；目录变化 → 全量重答，如实计成本）→ 稳定对 → 若录取按规则
6. [ ] 发布通过者 + 门禁三（rust 全量，旧物按内容复用）
7. [ ] 冻结 + 卡 22 报告增补（第三波实测）+ 提交

## 验收

- [ ] 8 文件全绿（对象/回执/账本非零）
- [ ] 门禁一通过率对比入档（波 3 vs 波 2；预测错了也如实记）
- [ ] 合并按既定规则（strict≥2 稳定边、不相交），幂等重放不重复写盘
- [ ] 发布物字节一致；门禁三判决如实（准入≠效用不美化）
- [ ] 第一源零接触（45 基线仍逐一致）；账本复核；冻结核验
- [ ] `docs/specs/03-second-source-report.md` 增补第三波实测段 + 提交

## 核实方式

```bash
for f in ch08-01-vectors ch08-02-strings ch08-03-hash-maps ch10-01-syntax ch10-02-traits \
         ch10-03-lifetime-syntax ch13-01-closures ch13-02-iterators; do
  node -e 'const d=JSON.parse(require("fs").readFileSync("pipeline/knowledge/'"$f"'.objects.json","utf8"));console.log("'"$f"'",(Array.isArray(d)?d:d.objects).length)'
done
node pipeline/propose-clusters.mjs --source-key rust-book-cn --dry-run | tail -3
node pipeline/freeze-outputs.mjs --verify pipeline/registry/freeze-2026-10-13T16-14-59.json
```