'use strict'

const assert = require('assert')
const { monthWindow, enemyUrl, validateResponse } = require('./scripts/cache-kcnav-enemies')
const { summarizeEntries, thresholds } = require('./enemies')
const { airStateRange } = require('./air-status')

const airRows = { status: 'ready', rows: [{ count: 1, thresholds: { disadvantage: 10, parity: 20, superiority: 45, supremacy: 90 } }] }
for (const [value, label] of [[0, 'AL'], [9, 'AL'], [10, 'AD'], [20, 'AP'], [45, 'AS'], [90, 'AS+']]) {
  assert.deepStrictEqual(airStateRange({ min: value, max: value }, airRows).states.map(s => s.label), [label])
}
assert.deepStrictEqual(airStateRange({ min: 44, max: 90 }, airRows).states.map(s => s.label), ['AP', 'AS+'])
const noEnemyAir = { status: 'ready', rows: [{ count: 1, thresholds: { disadvantage: 0, parity: 0, superiority: 0, supremacy: 0 } }] }
assert.strictEqual(airStateRange({ min: 0, max: 0 }, noEnemyAir), null)
assert.strictEqual(airStateRange({ min: 1, max: 1 }, noEnemyAir).states[0].label, 'AS+')
assert.strictEqual(airStateRange(null, airRows), null)
assert.strictEqual(airStateRange({ min: 20, max: 20 }, { status: 'missing' }), null)
const variants = { status: 'ready', rows: [...airRows.rows, ...noEnemyAir.rows, { count: 1, thresholds: null }] }
assert.deepStrictEqual(airStateRange({ min: 20, max: 20 }, variants).states.map(s => s.label), ['AP', 'AS+'])
assert.strictEqual(airStateRange({ min: 20, max: 20 }, variants).uncertain, true)

assert.deepStrictEqual(monthWindow(new Date('2026-09-11T09:00:00Z')), { start: '2026-08-11', end: '2026-09-11' })
assert.deepStrictEqual(monthWindow(new Date('2026-03-31T09:00:00Z')), { start: '2026-02-28', end: '2026-03-31' })
assert.deepStrictEqual(monthWindow(new Date('2024-03-31T09:00:00Z')), { start: '2024-02-29', end: '2024-03-31' })
const url = new URL(enemyUrl('7-5', 'Q', { start: '2026-08-11', end: '2026-09-11' }))
assert.deepStrictEqual([...url.searchParams], [['start', '2026-08-11'], ['end', '2026-09-11']])
assert.strictEqual(url.pathname, '/api/routing/maps/7-5/nodes/Q/enemycomps')

const entry = { mainFleet: [{ id: 1529, equips: [1509] }], escortFleet: [], formation: 1, count: 3, airpower: [10, 19, 42, 84], lbasAirpower: [2, 4, 11, 21], uncertainAirpowerItems: [] }
const summary = summarizeEntries([entry, { ...entry, formation: 2, count: 1, airpower: [0, 0, 0, 0], uncertainAirpowerItems: [1509] }])
assert.strictEqual(summary.rows.length, 2) // Different formations must not be merged.
assert.deepStrictEqual(summary.rows.map((row) => row.share), [0.75, 0.25])
assert.deepStrictEqual(summary.superiority, [0, 42])
assert.deepStrictEqual(summary.supremacy, [0, 84])
assert.strictEqual(summary.uncertain, true)
assert.deepStrictEqual(summary.rows[0].thresholds, { disadvantage: 10, parity: 19, superiority: 42, supremacy: 84 })
assert.strictEqual(summary.rows[0].lbasThresholds.superiority, 11)
assert.strictEqual(thresholds(null), null)
assert.strictEqual(thresholds([0, 0, null, 0]), null)
assert.strictEqual(summarizeEntries([{ ...entry, airpower: null }]).superiority, null)
assert.strictEqual(summarizeEntries([{ ...entry, count: 0 }]).rows[0].share, null)
assert.strictEqual(summarizeEntries([]).total, 0)
assert.strictEqual(summarizeEntries([]).superiority, null)
assert.throws(() => validateResponse({ result: { entryCount: 2, entries: [entry] } }))
assert.deepStrictEqual(validateResponse({ result: { entries: [] } }).entries, [])
assert.throws(() => validateResponse({ result: { entryCount: 1, entries: [{ ...entry, mainFleet: [{ name: 'missing master ID' }] }] } }))
assert.strictEqual(validateResponse({ result: { entryCount: 1, entries: [entry] } }).entries[0].mainFleet[0].id, 1529)
console.log('enemy cache and presentation tests passed')
