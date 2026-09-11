'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '../data/sources/kcnav/enemies')
const manifestPath = path.join(root, 'manifest.json')

function compactJson(value) {
  return `${JSON.stringify(value)}\n`
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  let beforeBytes = 0
  let afterBytes = 0
  let count = 0
  for (const entry of Object.values(manifest.nodes || {})) {
    const file = path.join(root, entry.file)
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    const content = compactJson(value)
    const temporary = `${file}.${process.pid}.tmp`
    beforeBytes += fs.statSync(file).size
    fs.writeFileSync(temporary, content)
    fs.renameSync(temporary, file)
    afterBytes += content.length
    entry.sha256 = sha256(content)
    count += 1
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(JSON.stringify({
    files: count,
    beforeBytes,
    afterBytes,
    reductionPercent: Number(((1 - afterBytes / beforeBytes) * 100).toFixed(1)),
  }, null, 2))
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { compactJson, main }
