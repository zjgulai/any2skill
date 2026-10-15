#!/usr/bin/env node
/**
 * 产出冻结（ticket 15 的前置，ADR-001：「基准比对只在全部产出冻结之后执行」）。
 *
 * 用法：
 *   node pipeline/freeze-outputs.mjs                 # 冻结：写 pipeline/registry/freeze-<stamp>.json
 *   node pipeline/freeze-outputs.mjs --verify <file> # 校验：重算哈希对冻结清单，有漂移即非零退出
 *
 * ## 为什么需要它
 *
 * ADR-001 说比对必须在「产出冻结之后」——但「冻结」若只是一句话，比对者无从证明
 * 自己比的是哪一版产出。本命令把冻结变成**可复算的事实**：逐文件 sha256 + 当时的
 * git commit，之后任何人（尤其是独立比对者）都能用 `--verify` 证明「产出没动过」。
 *
 * ## 冻结面（刻意显式列举，不用通配扫盘）
 *
 * 比对需要的是**产出面**：已发布 skill、划分与候选、门禁报告与回执依据。
 * 运行产物（registry 下海量 run-* 回执）不在冻结面内——它们是过程证据，不是被比对的产出。
 */

import path from 'node:path'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT } from './tools/anchor-index.mjs'

export const EXIT = Object.freeze({ PASS: 0, DRIFT: 3, RUN_FAILED: 4 })

/**
 * 冻结面：显式列举（含理由）。新增产出面时在注释里写清「比对为什么需要它」。
 * 以 `/**` 结尾的条目是**目录展开**（递归该目录下全部文件）——发布区在长大
 * （2 → 7），逐文件列举会漏；目录展开让「冻结 = 发布区全集」是结构事实而非纪律。
 */
export const FROZEN_PATHS = Object.freeze([
  // 已发布物（比对的主角：「产出 vs 原书 22 个」）。目录展开：新增/下架都会进/出冻结面。
  'skills/**',
  // 冻结态各自的构建契约（风险标记、provenance——比对时解释差异要用）
  'pipeline/registry/build/**/skill-contract.json',
  // 划分与候选（验收 4 的「数量/覆盖差异」要对着它们解释）
  'pipeline/knowledge/clusters.json',
  'pipeline/knowledge/gate2-scenarios.json',
  'pipeline/knowledge/gate3-tasks.json',
  'pipeline/registry/skill-candidates.json',
  'pipeline/registry/resplit-plan.json',
  // 第二源（卡 19/20）的产物按源命名空间，同入冻结面——第二源的结论也要可被 --verify 证明
  'pipeline/knowledge/clusters.rust-book-cn.json',
  'pipeline/registry/skill-candidates.rust-book-cn.json',
  'pipeline/registry/resplit-plan.rust-book-cn.json',
  'pipeline/knowledge/gate2-scenarios.rust-book-cn.json',
  'pipeline/registry/gate2-report.rust-book-cn.json',
  'pipeline/registry/gate2-report.strict.rust-book-cn.json',
  'pipeline/registry/gate2-stable.rust-book-cn.json',
  'pipeline/knowledge/gate3-tasks.rust-book-cn.json',
  'pipeline/registry/gate3-report.rust-book-cn.json',
  // 第二源跨章合成三件套（卡 22）：已发布 rust skill 的陷阱段来源要可被 --verify 证明。
  // 注：第一源的对应三件从未入冻结面（卡 14 的取舍）——此处只加本卡产物，不对称留在明处。
  'pipeline/knowledge/anchor-catalog.rust-book-cn.json',
  'pipeline/knowledge/themes.rust-book-cn.json',
  'pipeline/knowledge/antipatterns.rust-book-cn.objects.json',
  // 任务技能套件（卡 26/ADR-031）：清单、工作流、迁移记录与归档面——
  // 新发布面的每个字节都要能被 --verify 证明；旧 30 的归档字节同样在册。
  'pipeline/curation/**',
  'pipeline/registry/task-suite-lineage.v1.json',
  'pipeline/registry/task-suite-status.v1.json',
  'pipeline/registry/task-suite-assessment.v1.json',
  'pipeline/registry/legacy-published/**',
  // 三道门禁的最终报告（比对结论须引用它们的状态）
  'pipeline/registry/gate2-report.json',
  'pipeline/registry/gate2-report.strict.json',
  'pipeline/registry/gate2-stable.json',
  'pipeline/registry/gate3-report.json',
])

const sha256 = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`

/** 把含 `/**` 的条目展开为具体文件路径（递归；忽略空目录与非文件）。 */
function expandPaths(repoRoot, declared) {
  const out = []
  for (const entry of declared) {
    if (!entry.includes('/**')) {
      out.push(entry)
      continue
    }
    const base = entry.slice(0, entry.indexOf('/**'))
    const absBase = path.join(repoRoot, base)
    const walk = (absDir, relDir) => {
      let names
      try {
        names = statDir(absDir)
      } catch {
        return
      }
      for (const n of names.sort()) {
        const abs = path.join(absDir, n)
        const rel = path.join(relDir, n)
        if (isDir(abs)) walk(abs, rel)
        else out.push(rel)
      }
    }
    walk(absBase, base)
  }
  return [...new Set(out)]
}

const statDir = (d) => readdirSync(d)
const isDir = (p) => statSync(p).isDirectory()

async function readGitCommit(repoRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** 漂移判定（纯函数）：冻结清单 vs 当前哈希，返回不一致项。 */
export function computeDrift(frozenFiles, currentFiles) {
  const drift = []
  for (const f of frozenFiles) {
    const now = currentFiles.find((c) => c.path === f.path)
    if (!now || now.sha256 !== f.sha256) {
      drift.push({ path: f.path, frozen: f.sha256, now: now ? now.sha256 : '(缺失)' })
    }
  }
  return drift
}

async function hashAll(repoRoot, paths) {
  const files = []
  for (const rel of paths) {
    try {
      const buf = await readFile(path.join(repoRoot, rel))
      files.push({ path: rel, bytes: buf.length, sha256: sha256(buf) })
    } catch (err) {
      if (err.code === 'ENOENT') {
        files.push({ path: rel, bytes: null, sha256: null, missing: true })
        continue
      }
      throw err
    }
  }
  return files
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = { verify: null, repoRoot: DEFAULT_REPO_ROOT, json: false }
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--verify') (flags.verify = need(i, a)), (i += 1)
    else if (a === '--json') flags.json = true
    else if (a === '--repo-root') (flags.repoRoot = path.resolve(need(i, a))), (i += 1)
    else if (a.startsWith('--')) throw new Error(`未知参数：${a}`)
    else throw new Error(`未知位置参数：${a}（本命令不接受位置参数）`)
  }
  return flags
}

async function main(argv) {
  let flags
  try {
    flags = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    return EXIT.RUN_FAILED
  }
  const repoRoot = flags.repoRoot
  const rel = (p) => path.relative(repoRoot, p)

  try {
    if (flags.verify) {
      const doc = JSON.parse(await readFile(path.join(repoRoot, flags.verify), 'utf8'))
      const current = await hashAll(repoRoot, doc.files.map((f) => f.path))
      const drift = computeDrift(doc.files, current)
      if (drift.length > 0) {
        process.stderr.write(
          `产出已漂移（${drift.length} 个文件与冻结清单不一致）——比对不得在漂移状态上进行：\n` +
            drift.map((d) => `  · ${d.path}\n      冻结 ${d.frozen}\n      现在 ${d.now}`).join('\n') +
            '\n要么重新冻结并说明改了什么，要么先撤回改动。\n',
        )
        return EXIT.DRIFT
      }
      process.stdout.write(`冻结校验通过：${doc.files.length} 个文件与 ${flags.verify} 逐一致。\n`)
      return EXIT.PASS
    }

    const files = await hashAll(repoRoot, expandPaths(repoRoot, FROZEN_PATHS))
    const missing = files.filter((f) => f.missing)
    if (missing.length > 0) {
      throw new Error(`冻结面里有文件不存在：${missing.map((m) => m.path).join(', ')}——先修正冻结面再冻结。`)
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const doc = {
      schemaVersion: 'freeze/v1',
      createdAt: new Date().toISOString(),
      gitCommit: await readGitCommit(repoRoot),
      note:
        '产出冻结（ADR-001 的前置）：基准比对必须在逐文件哈希与这一刻一致的产出上进行。' +
        '校验：node pipeline/freeze-outputs.mjs --verify <本文件>。',
      files,
    }
    const outAbs = path.join(repoRoot, 'pipeline', 'registry', `freeze-${stamp}.json`)
    await mkdir(path.dirname(outAbs), { recursive: true })
    await writeFile(outAbs, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
    if (flags.json) process.stdout.write(`${JSON.stringify({ freeze: rel(outAbs), files: files.length, gitCommit: doc.gitCommit }, null, 2)}\n`)
    else {
      process.stdout.write(
        `产出已冻结：${files.length} 个文件 → ${rel(outAbs)}\n` +
          `git commit：${doc.gitCommit ?? '(不可得)'}\n` +
          `校验：node pipeline/freeze-outputs.mjs --verify ${rel(outAbs)}\n`,
      )
    }
    return EXIT.PASS
  } catch (err) {
    process.stderr.write(`冻结失败：${err?.message ?? err}\n`)
    return EXIT.RUN_FAILED
  }
}

export { parseArgs, hashAll }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
