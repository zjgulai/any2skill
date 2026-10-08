# 这个目录里有一个**名字会骗人**的文件

`INVALID-producer-low.receipt.json` / `INVALID-producer-low.objects.json`
是**第一次「低档臂」的产物，而它根本没有跑在低档**。

原因：`--llm-reasoning-effort` 当时只接到了判定者那条链，
生产者自己的 `resolveLlmConfig` 调用点漏了——于是 20 次真实调用全部发的是
「不带 `reasoning_effort`」的请求，跑在服务端默认档。

它**看起来是正常的**：回执里 `judge.reasoningEffort = "low"` 赫然在目（判定者正确继承了），
而唯一能揭穿它的 `model.reasoningEffort` 当时**根本不在回执的 model 块里**。

它没有被删除，因为它是缺陷三的证物（见 `docs/adr/ADR-015-reasoning-tier-decision.md`）。
前缀 `INVALID-` 是刻意的：不要让后来的读者把它的 12% 当成档位效应——
那 12% 是**同档噪声**。

有效的臂：

| 文件 | 档位 | 说明 |
|---|---|---|
| `producer-default.receipt.json` | 默认 | 有效 |
| `producer-default-3.receipt.json` | 默认 | 有效 |
| `producer-low-v2.receipt.json` | 低档 | 有效（修复后的第一次） |
| `producer-low-2.receipt.json` | 低档 | 有效 |
| `judge-tier-probe.json` / `judge-noise-floor.json` | — | 判定者层对照 |
