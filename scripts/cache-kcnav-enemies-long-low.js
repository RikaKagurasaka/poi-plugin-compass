'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const nodeTypes = require('../data/kcnav-node-types-by-map.json')
const styles = require('../data/kcnav-node-types.json')
const { enemyUrl, validateResponse } = require('./cache-kcnav-enemies')

const root = path.join(__dirname, '../data/sources/kcnav/enemies')
const manifestPath = path.join(root, 'manifest.json')
const LOW_SAMPLE_THRESHOLD = 100
const INTERVAL_MS = 15000

function oneYearWindow(now = new Date()) {
  const end = now.toISOString().slice(0, 10)
  const startDate = new Date(`${end}T00:00:00Z`)
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1)
  return { start: startDate.toISOString().slice(0, 10), end }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function sampleCount(payload) {
  return (payload?.result?.entries || []).reduce((sum, entry) => sum + entry.count, 0)
}

function writeJson(file, value, compact = false) {
  const content = `${JSON.stringify(value, null, compact ? 0 : 2)}\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, content)
  fs.renameSync(`${file}.tmp`, file)
  return crypto.createHash('sha256').update(content).digest('hex')
}

function combatTargets() {
  return Object.entries(nodeTypes).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .flatMap(([mapId, nodes]) => Object.entries(nodes)
      .filter(([, type]) => styles[type]?.hasEnemies)
      .map(([node]) => ({ mapId, node })))
}

function currentSamples(manifest, target) {
  const source = manifest.nodes[`${target.mapId}/${target.node}`]
  if (!source) return 0
  try {
    return sampleCount(readJson(path.join(root, source.file)))
  } catch (error) {
    return 0
  }
}

async function main() {
  const manifest = readJson(manifestPath)
  const window = oneYearWindow()
  const targets = combatTargets().filter((target) => currentSamples(manifest, target) < LOW_SAMPLE_THRESHOLD)
  const previousRun = manifest.longWindow
  manifest.longWindow = {
    start: window.start,
    end: window.end,
    threshold: LOW_SAMPLE_THRESHOLD,
    intervalMs: INTERVAL_MS,
    targetCount: targets.length,
    complete: false,
    lastRequestAt: previousRun?.start === window.start && previousRun?.end === window.end
      ? previousRun.lastRequestAt : null,
  }
  writeJson(manifestPath, manifest)

  for (const [index, target] of targets.entries()) {
    const key = `${target.mapId}/${target.node}`
    const existing = manifest.nodes[key]
    const expectedFile = `${window.start}_${window.end}/${target.mapId}/${target.node}.json`
    const existingFile = existing?.file === expectedFile ? path.join(root, existing.file) : null
    if (existingFile && fs.existsSync(existingFile)) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(existingFile)).digest('hex')
      if (hash === existing.sha256) continue
    }

    const elapsed = Date.now() - Date.parse(manifest.longWindow.lastRequestAt || '1970-01-01')
    const wait = Math.max(0, INTERVAL_MS - elapsed)
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    manifest.longWindow.lastRequestAt = new Date().toISOString()
    writeJson(manifestPath, manifest)

    const url = enemyUrl(target.mapId, target.node, window)
    console.log(`${index + 1}/${targets.length} ${key} ${window.start}..${window.end}`)
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`${key}: HTTP ${response.status}; cache retained, rerun to resume`)
    const payload = await response.json()
    const result = validateResponse(payload)
    const file = expectedFile
    const sha256 = writeJson(path.join(root, file), payload, true)
    manifest.nodes[key] = {
      file,
      url,
      sha256,
      fetchedAt: new Date().toISOString(),
      window,
      entries: result.entries.length,
      samples: sampleCount(payload),
    }
    writeJson(manifestPath, manifest)
  }

  manifest.longWindow.complete = true
  manifest.longWindow.finishedAt = new Date().toISOString()
  writeJson(manifestPath, manifest)
  console.log(`Cached ${targets.length} low-sample enemy nodes for one year`)
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
module.exports = { oneYearWindow, sampleCount, combatTargets }
