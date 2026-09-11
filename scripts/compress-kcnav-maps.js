'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const mapDir = path.join(__dirname, '../assets/kcnav/maps')

function commandAvailable(command) {
  try {
    execFileSync(command, ['-version'], { stdio: 'ignore' })
    return true
  } catch (error) {
    return false
  }
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback
}

function convert(input, output, quality, tool) {
  const temporary = `${output}.${process.pid}.tmp`
  try {
    if (tool === 'cwebp') {
      execFileSync('cwebp', [
        '-quiet', '-mt', '-m', '4', '-q', String(quality), '-metadata', 'none', input, '-o', temporary,
      ], { stdio: 'inherit' })
    } else {
      execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-i', input, '-map_metadata', '-1',
        '-c:v', 'libwebp', '-q:v', String(quality), '-compression_level', '4', temporary,
      ], { stdio: 'inherit' })
    }
    fs.renameSync(temporary, output)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function main() {
  const quality = optionValue('--quality', 85)
  const removePng = process.argv.includes('--remove-png')
  const tool = commandAvailable('cwebp') ? 'cwebp' : commandAvailable('ffmpeg') ? 'ffmpeg' : null
  if (!tool) throw new Error('需要 cwebp 或 ffmpeg 才能压缩 KCNav 地图')

  const pngFiles = fs.readdirSync(mapDir).filter((file) => file.endsWith('.png')).sort()
  if (!pngFiles.length) {
    const webpFiles = fs.readdirSync(mapDir).filter((file) => file.endsWith('.webp')).sort()
    console.log(`没有待转换的 PNG 地图；现有 WebP ${webpFiles.length} 张`)
    return
  }

  let sourceBytes = 0
  let outputBytes = 0
  for (const file of pngFiles) {
    const input = path.join(mapDir, file)
    const output = path.join(mapDir, file.replace(/\.png$/, '.webp'))
    convert(input, output, quality, tool)
    sourceBytes += fs.statSync(input).size
    outputBytes += fs.statSync(output).size
    if (removePng) fs.unlinkSync(input)
  }

  console.log(JSON.stringify({
    tool,
    quality,
    maps: pngFiles.length,
    sourceBytes,
    outputBytes,
    reductionPercent: Number(((1 - outputBytes / sourceBytes) * 100).toFixed(1)),
    removedPng: removePng,
    tempDirectory: os.tmpdir(),
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

module.exports = { main }
