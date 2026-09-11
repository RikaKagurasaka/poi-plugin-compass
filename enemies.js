'use strict'

const fs = require('fs')
const path = require('path')
const cacheRoot = path.join(__dirname, 'data/sources/kcnav/enemies')
const files = new Map()

function readLocalJson(file) {
  const stat = fs.statSync(file)
  const cached = files.get(file)
  if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) return cached.value
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  files.set(file, { mtime: stat.mtimeMs, size: stat.size, value })
  return value
}

function thresholds(values) {
  return Array.isArray(values) && values.length === 4
    && values.every((value) => Number.isFinite(value) && value >= 0)
    ? { disadvantage: values[0], parity: values[1], superiority: values[2], supremacy: values[3] }
    : null
}

function summarizeEntries(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)
  const rows = entries.map((entry) => ({
    ...entry,
    share: total > 0 ? entry.count / total : null,
    thresholds: thresholds(entry.airpower),
    lbasThresholds: thresholds(entry.lbasAirpower),
    uncertain: Boolean(entry.uncertainAirpowerItems?.length),
  })).sort((a, b) => b.count - a.count)
  function range(key) {
    if (!rows.length || rows.some((row) => !row.thresholds)) return null
    const values = rows.map((row) => row.thresholds[key])
    return [Math.min(...values), Math.max(...values)]
  }
  return { rows, total, superiority: range('superiority'), supremacy: range('supremacy'), uncertain: rows.some((row) => row.uncertain) }
}

function loadEnemies(mapId, node) {
  try {
    const manifest = readLocalJson(path.join(cacheRoot, 'manifest.json'))
    const source = manifest.nodes[`${mapId}/${node}`]
    if (!source) return { status: 'missing', window: manifest.window }
    const payload = readLocalJson(path.join(cacheRoot, source.file))
    return { status: 'ready', window: manifest.window, source, ...summarizeEntries(payload.result.entries) }
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'invalid' }
  }
}

const formations = { 1: '单纵', 2: '复纵', 3: '轮型', 4: '梯形', 5: '单横', 6: '警戒', 11: '第一警戒', 12: '第二警戒', 13: '第三警戒', 14: '第四警戒' }
function formationLabel(id) { return formations[id] || `阵型 ${id}` }

module.exports = { loadEnemies, summarizeEntries, thresholds, formationLabel }
