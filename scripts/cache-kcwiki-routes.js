'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const areaNames = {
  1: '镇守府海域',
  2: '南西群岛海域',
  3: '北方海域',
  4: '西方海域',
  5: '南方海域',
  6: '中部海域',
  7: '南西海域',
}

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'data', 'sources', 'kcwiki', 'routes')
const catalogs = [
  require(path.join(root, 'data', 'maps.json')),
  require(path.join(root, 'data', 'normal-maps.json')),
]
const mapIds = Array.from(new Set(catalogs.flatMap((catalog) => Object.keys(catalog.maps))))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))

function apiUrl(title) {
  const url = new URL('https://zh.kcwiki.cn/api.php')
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'revisions',
    rvprop: 'content|ids|timestamp',
    titles: title,
  }).toString()
  return url
}

function pageTitleForMap(mapId) {
  const [area] = mapId.split('-').map(Number)
  return mapId === '5-6'
    ? `${areaNames[area]}/${mapId}`
    : `${areaNames[area]}/${mapId}/带路条件`
}

async function fetchPage(title) {
  const response = await fetch(apiUrl(title), {
    headers: { 'user-agent': 'poi-plugin-compass-kcwiki-cache/0.1' },
  })
  if (!response.ok) throw new Error(`KCWiki API ${response.status} for ${title}`)
  const payload = await response.json()
  const page = payload?.query?.pages?.[0]
  if (!page || page.missing || !page.revisions?.[0]) throw new Error(`KCWiki page missing: ${title}`)
  const revision = page.revisions[0]
  const content = revision.content ?? revision.slots?.main?.content
  if (typeof content !== 'string') throw new Error(`KCWiki content missing: ${title}`)
  return { page, revision, content }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  const fetchedAt = new Date().toISOString()
  const manifest = []

  for (const mapId of mapIds) {
    const title = pageTitleForMap(mapId)
    const { page, revision, content } = await fetchPage(title)
    const contentFile = `${mapId}.wiki`
    fs.writeFileSync(path.join(outputDir, contentFile), content, 'utf8')
    manifest.push({
      mapId,
      title,
      pageId: page.pageid,
      revisionId: revision.revid,
      revisionTimestamp: revision.timestamp,
      pageUrl: `https://zh.kcwiki.cn/wiki/${encodeURIComponent(title)}`,
      apiUrl: apiUrl(title).toString(),
      contentFile,
      sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      fetchedAt,
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify({ source: 'zh.kcwiki.cn', fetchedAt, maps: manifest }, null, 2)}\n`,
    'utf8',
  )
  console.log(`cached ${manifest.length} KCWiki route pages in ${outputDir}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
