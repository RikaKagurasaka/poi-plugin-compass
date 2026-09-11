'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'data', 'sources', 'kcnav', 'maps')
const nodeTypesPath = path.join(root, 'data', 'kcnav-node-types-by-map.json')
const manifestPath = path.join(outputDir, 'manifest.json')
const catalogs = [
  require(path.join(root, 'data', 'maps.json')),
  require(path.join(root, 'data', 'normal-maps.json')),
]
const mapIds = Array.from(new Set(catalogs.flatMap((catalog) => Object.keys(catalog.maps))))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))

const DEFAULT_INTERVAL_MS = 15_000

function apiUrl(mapId) {
  return `https://tsunkit.net/api/routing/maps/${mapId}/`
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function intervalFromArgs() {
  const index = process.argv.indexOf('--interval-ms')
  if (index < 0) return DEFAULT_INTERVAL_MS
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_INTERVAL_MS
}

function nodeTypesFromResult(result) {
  const nodeValues = {}
  const spots = result?.spots || {}
  Object.keys(spots).forEach((node) => { nodeValues[node] = -1 })

  Object.values(spots).forEach((spot) => {
    if (!Array.isArray(spot) || typeof spot[2] !== 'string' || spot[2].toLowerCase() !== 'start') return
    const node = Object.keys(spots).find((key) => spots[key] === spot)
    if (node) nodeValues[node] = 0
  })

  Object.values(result?.route || {}).forEach((entry) => {
    if (!Array.isArray(entry) || typeof entry[1] !== 'string') return
    const nodeType = Number(entry[2])
    if (Number.isFinite(nodeType)) nodeValues[entry[1]] = nodeType
  })
  return nodeValues
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function fetchMap(mapId) {
  const url = apiUrl(mapId)
  const response = await fetch(url, {
    headers: { 'user-agent': 'poi-plugin-compass-kcnav-cache/0.1' },
  })
  if (!response.ok) throw new Error(`KCNav API ${response.status} for ${mapId}`)
  const payload = await response.json()
  if (!payload?.result || typeof payload.result !== 'object') {
    throw new Error(`KCNav response has no result for ${mapId}`)
  }
  return { url, payload }
}

async function main() {
  const intervalMs = intervalFromArgs()
  fs.mkdirSync(outputDir, { recursive: true })
  const fetchedAt = new Date().toISOString()
  const manifest = []
  const nodeTypesByMap = {}

  for (const [index, mapId] of mapIds.entries()) {
    if (index > 0) await sleep(intervalMs)
    process.stdout.write(`fetching ${mapId} (${index + 1}/${mapIds.length})\n`)
    const { url, payload } = await fetchMap(mapId)
    const content = `${JSON.stringify(payload, null, 2)}\n`
    const contentFile = `${mapId}.json`
    fs.writeFileSync(path.join(outputDir, contentFile), content, 'utf8')
    nodeTypesByMap[mapId] = nodeTypesFromResult(payload.result)
    manifest.push({
      mapId,
      apiUrl: url,
      contentFile,
      sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      nodeCount: Object.keys(payload.result.spots || {}).length,
      nodeTypeCount: Object.keys(nodeTypesByMap[mapId]).length,
      fetchedAt,
    })
    writeJson(manifestPath, { source: 'tsunkit.net', fetchedAt, intervalMs, maps: manifest })
    writeJson(nodeTypesPath, nodeTypesByMap)
  }

  console.log(`cached ${manifest.length} KCNav maps in ${outputDir}`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { apiUrl, nodeTypesFromResult, main }
