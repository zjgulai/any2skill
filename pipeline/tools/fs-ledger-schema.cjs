'use strict'

/**
 * 账本 schema 版本 · 单一真源。
 *
 * 写入侧（`fs-ledger.cjs`，CJS 预载）与读侧（`fs-ledger.mjs`，ESM 汇总）必须声明同一个版本，
 * 否则「读方按自己的版本解释写方的产物」——漂移不会有任何检查发现，直到某天字段含义变了。
 * CJS 是两边都能 require/import 的最小公共形态，故版本常量住在这里，两边都从这里取；
 * 读侧的 `loadLedger` 会**校验**它（不认识就抛，不按「没记录」放过）。
 */
module.exports = { LEDGER_SCHEMA_VERSION: 'fs-ledger/v1' }
