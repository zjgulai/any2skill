#!/usr/bin/env node
/**
 * 主题提案 CLI（ticket 06）。
 *
 * 用法：
 *   node pipeline/propose-themes.mjs --dry-run          # 只建目录、报告输入规模，**不调用模型**
 *   node pipeline/propose-themes.mjs                     # 真实提案（一次模型调用）
 *   node pipeline/propose-themes.mjs --model <id> [--reasoning-effort low|high|max]
 *
 * ## 副作用清单（本文件写什么，跑之前先说清）
 *
 *   `--dry-run`  写 `pipeline/knowledge/anchor-catalog.json`（目录本身是确定性产物），
 *                **不发任何模型调用、不写 themes.json**。
 *   真实运行     在上面基础上，额外写 `pipeline/knowledge/themes.json`。
 *
 * 两条都由 `--json` 无关地如实打印实际写入的路径——不做「静默写盘」。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT } from './tools/anchor-index.mjs'
import { buildAnchorCatalog, writeAnchorCatalog, CATALOG_REL_PATH } from './tools/theme-catalog.mjs'
import {
  buildProposalSystemPrompt,
  buildProposalUserPrompt,
  proposeThemes,
  writeThemeManifest,
  THEMES_REL_PATH,
} from './tools/theme-proposer.mjs'
import { resolveLlmConfig, LlmConfigError, normalizeReasoningEffort } from './tools/llm-client.mjs'

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = {
    dryRun: false,
    json: false,
    repoRoot: DEFAULT_REPO_ROOT,
    model: null,
    baseUrl: null,
    provider: null,
    reasoningEffort: null,
    maxTokens: null,
  }
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    // `need()` 只取下一个值、**不前进游标**——前进由这里的 `(i += 1)` 负责。
    // run.mjs 的 parseArgs 用的是同一个写法；漏掉它会退化成「取值被当成位置参数」。
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--json') flags.json = true
    else if (a === '--model') (flags.model = need(i, a)), (i += 1)
    else if (a === '--base-url') (flags.baseUrl = need(i, a)), (i += 1)
    else if (a === '--provider') (flags.provider = need(i, a)), (i += 1)
    else if (a === '--reasoning-effort') (flags.reasoningEffort = need(i, a)), (i += 1)
    else if (a === '--max-tokens') (flags.maxTokens = Number(need(i, a))), (i += 1)
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
    return 2
  }

  const repoRoot = flags.repoRoot

  // ---- 第 1 步：建目录（确定性、零模型成本） ----
  const catalog = await buildAnchorCatalog({ repoRoot })
  const catalogAbs = await writeAnchorCatalog(catalog, { repoRoot })

  const system = buildProposalSystemPrompt()
  const user = buildProposalUserPrompt({ catalog })
  // 字符数是实测（对同一个字符串算出来的），token 数是**估算**——两者必须分开标注，
  // 否则一个概数会被读成实测值。
  const measured = {
    sourceFiles: catalog.files.length,
    anchors: catalog.anchors.length,
    systemChars: system.length,
    userChars: user.length,
    userBytes: Buffer.byteLength(user, 'utf8'),
  }

  if (flags.dryRun) {
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify({ dryRun: true, catalog: catalogAbs, catalogHash: catalog.catalogHash, measured }, null, 2)}\n`,
      )
    } else {
      process.stdout.write(
        `[dry-run] 未调用模型。\n` +
          `目录：${measured.sourceFiles} 个源文件 / ${measured.anchors} 个锚点\n` +
          `      → 已写入 ${path.relative(repoRoot, catalogAbs)}\n` +
          `      → catalogHash ${catalog.catalogHash}\n` +
          `提案输入：系统提示词 ${measured.systemChars} 字符，用户提示词 ${measured.userChars} 字符` +
          `（UTF-8 ${measured.userBytes} 字节）\n` +
          `（token 数为估算，未实测：按中文 1 字≈0.6–1 token 粗估，用户提示词约 ${Math.round(measured.userChars * 0.6)}–${measured.userChars} token）\n`,
      )
    }
    return 0
  }

  // ---- 第 2 步：解析路由（真实调用前先解析，配置错误不该等到付钱后才发现） ----
  let config
  try {
    config = await resolveLlmConfig({
      env: process.env,
      overrides: {
        ...(flags.model ? { modelId: flags.model } : {}),
        ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
        ...(flags.provider ? { provider: flags.provider } : {}),
        ...(flags.reasoningEffort
          ? { reasoningEffort: normalizeReasoningEffort(flags.reasoningEffort) }
          : {}),
      },
    })
  } catch (err) {
    if (err instanceof LlmConfigError) {
      process.stderr.write(`[LLM 配置] ${err.message}\n`)
      return 2
    }
    throw err
  }

  const { manifest } = await proposeThemes({
    config,
    catalog,
    createdAt: new Date().toISOString(),
    ...(Number.isFinite(flags.maxTokens) ? { maxTokens: flags.maxTokens } : {}),
  })
  const manifestAbs = await writeThemeManifest(manifest, { repoRoot })

  const multiChapter = manifest.themes.filter((t) => t.chapterKeys.length >= 2)
  const out = {
    catalog: path.relative(repoRoot, catalogAbs),
    catalogHash: catalog.catalogHash,
    themes: path.relative(repoRoot, manifestAbs),
    modelId: manifest.model.modelId,
    promptFingerprint: manifest.promptFingerprint,
    themeCount: manifest.themes.length,
    multiChapterThemes: multiChapter.length,
    unresolvedAnchors: manifest.unresolvedAnchors.length,
    emptyThemes: manifest.emptyThemes,
    usage: manifest.usage,
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
  } else {
    process.stdout.write(
      `主题提案完成：${manifest.themes.length} 个主题（其中 ${multiChapter.length} 个跨 ≥2 章）\n` +
        `主题清单：${path.relative(repoRoot, manifestAbs)}\n` +
        `模型：${manifest.model.modelId}  提示词指纹：${manifest.promptFingerprint}\n` +
        (manifest.unresolvedAnchors.length > 0
          ? `⚠ 模型引用了 ${manifest.unresolvedAnchors.length} 个目录里不存在的锚点（已逐条记录，未静默丢弃）\n`
          : '') +
        (manifest.emptyThemes.length > 0 ? `⚠ 有 ${manifest.emptyThemes.length} 个主题解析后没有任何锚点：${manifest.emptyThemes.join(', ')}\n` : ''),
    )
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
