# 36：Library 归档、空间本体与 11 条关系边（write / G1-C + G1-D）

**要构建什么：**把 5 份真源归档进 Library、应用空间本体（10+8）、回填 11 条显式
记忆关系边。依赖卡 34 的 G1-C/D marker 与卡 35 的空间基座。

**状态：**待执行（依赖卡 33、34、35）

## 步骤

1. **Library 前置**：逐份 `library add` 前先 `nmem --json library list --space
   any2skills -n 50` 查重（无 `--id`，重复运行会重复入库）；若 Q3 已决定先入库
   `reports/Know-项目成果总结-20261031.md`，先 commit 再归档。
2. 逐份归档（一律传 `.markdown`，不传 `.md` 原路径）：
   - `nmem library add --space any2skills -c "项目总入口：定位、三段式链路、双平面结构、运行命令、当前发布态" -l readme -l entrypoint -l pipeline tmp/any2skills-library/any2skills-readme.markdown`
   - `-l runbook -l workflow -l operations` → any2skills-book-to-skills-runbook.markdown
   - `-l adr -l quality-gates -l governance` → ADR-006-three-quality-gates.markdown
   - `-l adr -l low-utility -l honesty` → ADR-030-low-utility-governance.markdown
   - `-l report -l outcome -l baseline` → Know-project-outcome-20261031.markdown
3. **本体基线**：`nmem --json ontology show --space-id default` 存一份到
   `docs/audits/any2skills-ontology-baseline-default-20261031.json`（前后各存，
   不要用无参调用——无参返回的是 active/default effective，容易假绿灯）。
4. **应用本体**：`nmem ontology apply --file artifacts/any2skills_ontology_patch.json
   --scope space --space-id any2skills`。**无 dry-run、space scope 为整体替换**：
   失败即停止排查，禁止改用 `--scope global`。patch 已显式声明全部 8 个 linkTypes。
5. **本体核验**：`nmem --json ontology show --space-id any2skills` 的
   `effective.objectTypes` 为 10、`effective.linkTypes` 为 8；比对 default 基线
   类型集合未变（`store.revision` 是 store 级，不作为判据，仅记录）。
6. **回填 11 条关系边**（先逐条 `nmem --json memories link list <MEMORY_ID>
   --space any2skills` 查重，再 add；relation_type 小写传参）：

   | # | SRC | 关系 | TGT |
   |---|---|---|---|
   | 1 | any2skills-l2-01 | DERIVES_FROM | any2skills-l2-02 |
   | 2 | any2skills-l2-01 | PASSES_GATE | any2skills-l2-03 |
   | 3 | any2skills-l2-03 | GOVERNED_BY | any2skills-l1-02 |
   | 4 | any2skills-l2-03 | GOVERNED_BY | any2skills-l1-03 |
   | 5 | any2skills-l2-04 | NAMESPACED_UNDER | any2skills-l2-02 |
   | 6 | any2skills-l3-01 | GOVERNED_BY | any2skills-l1-04 |
   | 7 | any2skills-l3-02 | GOVERNED_BY | any2skills-l1-04 |
   | 8 | any2skills-l3-03 | GOVERNED_BY | any2skills-l1-04 |
   | 9 | any2skills-l3-04 | DERIVES_FROM | any2skills-l1-01 |
   | 10 | any2skills-l4-01 | DERIVES_FROM | any2skills-l2-01 |
   | 11 | any2skills-l4-02 | DERIVES_FROM | any2skills-l2-01 |

   已知边界：L3-05/L3-06 暂无边（多组件图，如实接受）；只实例化 6/8 个 linkTypes，
   `PRODUCES`/`BENCHMARKS` 留待实体化后续票。

## 验收

- [x] `library list`：5 个源、`text/markdown`、state 全部 `indexed`、error 空、original_name 齐全
- [x] 空间本体 revision 17：10 objectTypes + 8 linkTypes；default 基线前后类型集合一致（global unchanged: true）
- [x] 11 条边全部建立；三次运行幂等（created=11 → created=0/skipped=11）；逐条 link list 可回查
- [x] 全程未使用 `memories update`，无 422
- [x] 图谱核验：`graph expand any2skills-l2-01 --depth 2` 可达 5 邻居（1 条演化边 + 4 条 MEMORY_RELATES_TO）

## 构建记录

2026-10-31 执行完成（G1-C/D marker 后）：
- Library：查重 0 冲突 → 5 份归档（src_8e0f3ea9 / src_318b9b9d / src_6bcf6212 / src_f6ddb3aa / src_f1db4738），全部 indexed。
- 本体：`meta` 字段不被 API 接受（422，只允许 objectTypes/linkTypes/openWorld/policy/seedFromDefaults）→ 移除；
  linkTypes 的 `description` 字段也不被接受（合法字段 key/displayName/labels/inverseDisplayName/directional）→ 折叠移除后 apply 成功。
  global 基线（docs/audits/any2skills-ontology-baseline-default-20261031.json）前后比对未变。
- 关系边：11/11 created；**新避坑**：`memories link list` 返回同时含 incoming/outgoing，
  查重必须过滤 `direction !== 'incoming'`，否则会把别记忆指进来的边误判为已存在（首版查重逻辑已修）；
  `link add` 本身为 upsert 语义，重复执行不重复建边。
- 图谱连通性：l2-01 depth=2 展开 5 邻居；L3-05/L3-06 无边（多组件图，已在 specs/04 声明）。
