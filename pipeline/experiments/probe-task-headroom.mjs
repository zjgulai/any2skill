#!/usr/bin/env node
/**
 * 头差探针（卡 25 实验，**非正式链路**）
 *
 * 目的：区分 low-utility 的两个竞争解释——H1「源内容在训练数据里，常规任务无头差」
 * vs H2「任务生成器太温和，没把易错细节逼出来」。唯一变量 = 任务生成提示词换 v2。
 *
 * 用法：
 *   node pipeline/experiments/probe-task-headroom.mjs --skill <slug> --source-key rust-book-cn \
 *     --model <id> --base-url <url>
 *
 * 副作用：**不写任何正式产物**（与 run-gate3 的 --skill 单 skill 模式同口径）；
 * 逐任务结果打到 stdout；ledger 由 --require fs-ledger.cjs 惯例产出（调用方传 DSH_FS_LEDGER）。
 *
 * 纪律：v2 若转正须先立提示词版本并重测存量——本脚本只是探针，不改正式指纹。
 */

import path from 'node:path'
import { readFile } from 'node:fs/promises'

import { DEFAULT_REPO_ROOT, DEFAULT_SOURCE_KEY } from '../tools/anchor-index.mjs'
import { resolveLlmConfig, LlmConfigError } from '../tools/llm-client.mjs'
import { parseFrontmatter } from '../tools/verify-skill.mjs'
import { generateTasksForSkill, runTaskArm } from '../tools/gate3-utility-ab.mjs'

/**
 * v2 任务生成提示词（实验变量）。与 v1 的差异只有一处立意：
 * 任务必须含**易错细节**，检查单必须锚定**技能建议的具体做法**——
 * 让「按技能做」与「不按技能做」在检查单上产生可判定的差异。
 */
export function buildTaskGenSystemPromptV2({ k }) {
  return [
    '你是「效用测试任务设计器」。输入是一个 Agent 技能（名称、描述、正文全文）。',
    `你的任务：设计 ${k} 个**自包含、可验证、且能分辨「用了技能与否」**的任务。`,
    '任务必须能在一个**空目录**里完成，交付物是文件。',
    '',
    '硬性要求：',
    '1. 每个任务的 prompt 用用户口吻（一两句可执行请求），**不得出现技能短名**，',
    '   不得引用网络、外部服务或未提供的依赖；产物是纯文本/代码/JSON 等可写文件。',
    '2. 每个任务给 `fixtures`（可选，预置在工作目录里的文件）与 `checks`（声明式检查单）。',
    `   checks 的 type 只允许：file_exists / contains / not_contains / regex / json_field。`,
    '3. **任务必须包含容易犯错的细节**：场景里埋一个「不留意就会落入常见误区」的点',
    '   （用错构造、漏掉边界情形、命名/签名上的陷阱、看似等价但不符要求的写法）。',
    '4. **检查单必须锚定技能建议的具体做法**：先用 contains 断言「正确形态」必须出现',
    '   （具体到标识符/写法片段），必要时用 not_contains 断言「常见错误形态」不得出现',
    '   （同样要具体，不要泛泛的风格断言）。目标是让「按技能做」与「不按技能做」',
    '   产生**可判定的差异**。',
    '5. **禁止教科书式送分题**：如果一个没读过技能的人顺手就能做对，换一个场景。',
    '6. 任务之间彼此不同（覆盖该技能的不同使用角度）。',
    '7. 只输出一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：',
    '   {"tasks": [',
    '     {"prompt": "<用户口吻的任务>", "fixtures": {"<相对路径>": "<内容>"},',
    '      "checks": [{"type": "contains", "path": "out.md", "patterns": ["…"]}]}',
    '   ]}',
  ].join('\n')
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = { repoRoot: DEFAULT_REPO_ROOT, sourceKey: DEFAULT_SOURCE_KEY, skill: null, model: null, baseUrl: null, maxTokens: null }
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--skill') (flags.skill = need(i, a)), (i += 1)
    else if (a === '--source-key') (flags.sourceKey = need(i, a)), (i += 1)
    else if (a === '--model') (flags.model = need(i, a)), (i += 1)
    else if (a === '--base-url') (flags.baseUrl = need(i, a)), (i += 1)
    else if (a === '--repo-root') (flags.repoRoot = path.resolve(need(i, a))), (i += 1)
    else if (a === '--max-tokens') (flags.maxTokens = Number(need(i, a))), (i += 1)
    else throw new Error(`未知参数：${a}`)
  }
  if (!flags.skill) throw new Error('必须给 --skill <slug>')
  return flags
}

async function main(argv) {
  const flags = parseArgs(argv)
  const repoRoot = flags.repoRoot
  const skillMd = await readFile(path.join(repoRoot, 'skills', flags.skill, 'SKILL.md'), 'utf8')
  const contract = JSON.parse(await readFile(path.join(repoRoot, 'pipeline', 'registry', 'build', flags.skill, 'skill-contract.json'), 'utf8'))
  const fm = parseFrontmatter(skillMd)
  if (!fm.ok) throw new Error('SKILL.md frontmatter 不可解析')

  let config
  try {
    config = await resolveLlmConfig({
      env: process.env,
      overrides: {
        ...(flags.model ? { modelId: flags.model } : {}),
        ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
      },
    })
  } catch (err) {
    if (err instanceof LlmConfigError) {
      process.stderr.write(`[LLM 配置] ${err.message}\n`)
      return 2
    }
    throw err
  }

  // 任务生成本身按瞬态处理：解析失败重试一次（v2 提示词下响应更长，JSON 解析更易脆）。
  let gen = null
  let lastErr = null
  for (let attempt = 0; attempt < 2 && gen === null; attempt += 1) {
    try {
      gen = await generateTasksForSkill({
        config,
        skillName: flags.skill,
        skillDescription: fm.fields.description,
        skillMarkdown: skillMd,
        systemPrompt: buildTaskGenSystemPromptV2({ k: 6 }),
        ...(flags.maxTokens ? { maxTokens: flags.maxTokens } : {}),
      })
    } catch (err) {
      lastErr = err
      process.stdout.write(`任务生成第 ${attempt + 1} 次失败：${err?.message ?? err}\n`)
    }
  }
  if (gen === null) throw lastErr
  process.stdout.write(`生成任务 ${gen.tasks.length} 个（v2 提示词；problems=${gen.problems.length}）\n`)

  const results = []
  for (const task of gen.tasks) {
    const without = await runTaskArm({ config, arm: 'without', task, taskId: task.taskId ?? `t${results.length + 1}` })
    const withSkill = await runTaskArm({ config, arm: 'with', task, taskId: task.taskId ?? `t${results.length + 1}`, skillMarkdown: skillMd })
    const state = without.passed && withSkill.passed ? 'both-pass'
      : !without.passed && withSkill.passed ? 'improvement'
      : without.passed && !withSkill.passed ? 'degradation' : 'invalid'
    results.push({ prompt: task.prompt, state, without: without.passed, with: withSkill.passed, checks: { without: without.checks, with: withSkill.checks } })
    process.stdout.write(`  ${state.padEnd(11)} 无=${without.passed ? '过' : '败'} 有=${withSkill.passed ? '过' : '败'} | ${String(task.prompt).slice(0, 70)}\n`)
  }
  const tally = {}
  for (const r of results) tally[r.state] = (tally[r.state] ?? 0) + 1
  process.stdout.write(`探针合计：${JSON.stringify(tally)}\n`)
  if (tally.improvement > 0) process.stdout.write('→ H2 方向有证据（v2 下出现改进）\n')
  else process.stdout.write('→ 本样本下 v2 仍未推出改进（偏 H1 方向，需更多样本再定论）\n')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exitCode = await main(process.argv)
}
