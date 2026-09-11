'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const nodeTypes = require('../data/kcnav-node-types-by-map.json')
const styles = require('../data/kcnav-node-types.json')
const root = path.join(__dirname, '../data/sources/kcnav/enemies')

function monthWindow(now = new Date()) {
  const end = now.toISOString().slice(0, 10)
  const startDate = new Date(`${end}T00:00:00Z`)
  const day = startDate.getUTCDate()
  startDate.setUTCDate(1)
  startDate.setUTCMonth(startDate.getUTCMonth() - 1)
  const lastDay = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0)).getUTCDate()
  startDate.setUTCDate(Math.min(day, lastDay))
  return { start: startDate.toISOString().slice(0, 10), end }
}

function enemyUrl(mapId, node, window) {
  const url = new URL(`https://tsunkit.net/api/routing/maps/${mapId}/nodes/${encodeURIComponent(node)}/enemycomps`)
  url.searchParams.set('start', window.start)
  url.searchParams.set('end', window.end)
  return url.toString()
}

function validateResponse(payload) {
  const result = payload?.result
  if (!result || !Array.isArray(result.entries)
    || (result.entryCount != null && result.entryCount !== result.entries.length)) {
    throw new Error('Invalid or incomplete enemy response')
  }
  for (const entry of result.entries) {
    if (!Array.isArray(entry.mainFleet) || !Array.isArray(entry.escortFleet)
      || !Number.isFinite(entry.count) || entry.count < 0
      || [...entry.mainFleet, ...entry.escortFleet].some((ship) => !Number.isInteger(ship.id))) {
      throw new Error('Invalid enemy composition')
    }
  }
  return result
}

function writeJson(file, value, compact = false) {
  const content = `${JSON.stringify(value, null, compact ? 0 : 2)}\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, content)
  fs.renameSync(`${file}.tmp`, file)
  return crypto.createHash('sha256').update(content).digest('hex')
}

async function main() {
  const manifestPath = path.join(root, 'manifest.json')
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null
  // Resume the same window even across midnight; --refresh explicitly starts a new run.
  const window = previous && !previous.complete && !process.argv.includes('--refresh')
    ? previous.window : monthWindow()
  const sameWindow = previous && previous.window.start === window.start && previous.window.end === window.end
  const manifest = sameWindow && !process.argv.includes('--refresh') ? previous : {
    source: 'KCNav', window, intervalMs: 15000, complete: false, nodes: {},
  }
  const targets = Object.entries(nodeTypes).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .flatMap(([mapId, nodes]) => Object.entries(nodes)
      .filter(([, type]) => styles[type]?.hasEnemies)
      .map(([node]) => ({ mapId, node })))
  manifest.targetCount = targets.length
  writeJson(manifestPath, manifest)
  for (const [index, { mapId, node }] of targets.entries()) {
    const key = `${mapId}/${node}`
    const saved = manifest.nodes[key]
    if (saved && fs.existsSync(path.join(root, saved.file))) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, saved.file))).digest('hex')
      if (hash === saved.sha256) continue
    }
    const wait = Math.max(0, 15000 - (Date.now() - Date.parse(manifest.lastRequestAt || '1970-01-01')))
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    manifest.lastRequestAt = new Date().toISOString()
    manifest.complete = false
    writeJson(manifestPath, manifest)
    const url = enemyUrl(mapId, node, window)
    console.log(`${index + 1}/${targets.length} ${key} ${window.start}..${window.end}`)
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`${key}: HTTP ${response.status}; cache retained, rerun to resume`)
    const payload = await response.json()
    const result = validateResponse(payload)
    const file = `${window.start}_${window.end}/${mapId}/${node}.json`
    const sha256 = writeJson(path.join(root, file), payload, true)
    manifest.nodes[key] = {
      file,
      url,
      sha256,
      fetchedAt: new Date().toISOString(),
      window,
      entries: result.entries.length,
      samples: result.entries.reduce((sum, entry) => sum + entry.count, 0),
    }
    writeJson(manifestPath, manifest)
  }
  manifest.complete = true
  writeJson(manifestPath, manifest)
  console.log(`Cached ${targets.length} enemy nodes`)
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
module.exports = { monthWindow, enemyUrl, validateResponse }
