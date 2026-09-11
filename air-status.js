'use strict'

const states = [
  { label: 'AL', color: '#ff8585' },
  { label: 'AD', color: '#ffbd79' },
  { label: 'AP', color: '#f4df8b' },
  { label: 'AS', color: '#8fd7a3' },
  { label: 'AS+', color: '#87d9ff' },
]

function airStateRange(air, data) {
  if (!air || !Number.isFinite(air.min) || !Number.isFinite(air.max) || data.status !== 'ready') return null
  const values = []
  let uncertain = false
  for (const row of data.rows.filter(row => row.count > 0)) {
    if (!row.thresholds) { uncertain = true; continue }
    uncertain ||= Boolean(row.uncertain)
    const t = row.thresholds
    for (const value of [air.min, air.max]) {
      if (value === 0 && t.supremacy === 0) continue
      values.push(value >= t.supremacy ? 4 : value >= t.superiority ? 3 : value >= t.parity ? 2 : value >= t.disadvantage ? 1 : 0)
    }
  }
  if (!values.length) return null
  return { states: [...new Set([Math.min(...values), Math.max(...values)])].map(index => states[index]), uncertain }
}

module.exports = { airStateRange }
