'use strict'

const assert = require('assert')
const { enumerateRoutes, battleNodes, playerFleet, kc3Save, noroDeck, compositionKey, kc3Url, noroUrl } = require('./exporters')

const rule = (node, outcomes, extra = {}) => ({ node, predicate: { kind: 'always' }, outcomes, ...extra })
const definition = { start: 'A', boss: 'D', rules: [rule('A', [{ to: 'B', probability: 0.8 }, { to: 'C', probability: 0.2 }, { to: 'E', probability: 0 }]), rule('B', [{ to: 'D', probability: 1 }]), rule('C', [{ to: 'D', probability: 1 }])] }
const geometry = { route: { 1: ['A', 'B'], 2: ['A', 'C'], 3: ['B', 'D'], 4: ['C', 'D'], 5: ['A', 'E'] } }
const routes = enumerateRoutes(definition, geometry, {}).routes
assert.deepStrictEqual(routes.map((r) => r.key), ['A>B>D', 'A>C>D'])
assert.deepStrictEqual(routes.map((r) => r.probability), [0.8, 0.2])
const manual = { ...definition, manualNodes: ['A'] }
assert(enumerateRoutes(manual, geometry, {}).routes.every((r) => r.probability === null))
assert.deepStrictEqual(enumerateRoutes(manual, geometry, {}, { A: 'C' }).routes.map((r) => r.key), ['A>C>D'])
const phased = { ...manual, rules: [rule('A', [{ to: 'B', probability: 1 }], { predicate: { kind: 'phase', value: 'P1' } }), ...definition.rules.slice(1)] }
assert.deepStrictEqual(enumerateRoutes(phased, geometry, { phase: 'P1' }).routes.map((r) => [r.key, r.probability]), [['A>B>D', 1]])

const state = { info: { basic: { api_level: 120 }, fleets: [{ api_ship: [10, -1] }], ships: { 10: {
  api_ship_id: 1, api_lv: 50, api_slotnum: 2, api_slot: [100, -1], api_slot_ex: 101,
  api_onslot: [0, 0], api_kyouka: [1, 2, 3, 4, 0, 0, 1], api_lucky: [15], api_taisen: [40], api_kaihi: [29, 30], api_sakuteki: [25, 30],
  api_maxhp: 20, api_nowhp: 18, api_cond: 49, api_fuel: 10, api_bull: 15,
} }, equips: { 100: { api_slotitem_id: 1, api_level: 6, api_alv: 2 }, 101: { api_slotitem_id: 2, api_level: 0 } } },
const: { $ships: { 1: { api_id: 1, api_houg: [10, 20], api_raig: [10, 20], api_tyku: [10, 20], api_souk: [10, 20], api_fuel_max: 20, api_bull_max: 20 } }, $equips: { 1: {}, 2: {} } } }
const enemy = { id: 1501, lvl: 1, hp: 20, fp: 5, torp: 10, aa: 0, armor: 5, equips: [1501, -1], exslot: -1 }
const rows = [ { masterId: 1, count: 9, formation: 1, mainFleet: [enemy], escortFleet: [] }, { masterId: 2, count: 1, formation: 2, mainFleet: [{ ...enemy, id: 1502 }], escortFleet: [] } ]
const battles = [{ node: 'L', cell: 12, type: 5, formation: 1, subOnly: false, rows }]
assert.deepStrictEqual(playerFleet(state).ships[0].statsBase, { fp: 11, tp: 12, aa: 13, ar: 14, luk: 15 })
// No WCTF dependency; level-derived stats are omitted unless modernized.
const highLevel = structuredClone(state)
highLevel.info.ships[10].api_lv = 175
assert.strictEqual(kc3Save(highLevel, '1-4', battles).fleetFMain.ships[0].statsBase.asw, 57)
const equippedPanel = structuredClone(state)
equippedPanel.info.ships[10].api_kaihi[0] = 99
equippedPanel.info.ships[10].api_taisen[0] = 100
equippedPanel.info.ships[10].api_sakuteki[0] = 80
assert.deepStrictEqual(playerFleet(equippedPanel).ships[0].statsBase, playerFleet(state).ships[0].statsBase)
const unmodernized = structuredClone(state)
unmodernized.info.ships[10].api_kyouka[6] = 0
const inferred = kc3Save(unmodernized, '1-4', battles).fleetFMain.ships[0]
for (const field of ['asw', 'ev', 'los']) assert(!Object.hasOwn(inferred.statsBase, field))
assert.strictEqual(inferred.level, 50)
const kaya = structuredClone(state)
kaya.info.ships[10].api_ship_id = 736
kaya.const.$ships[736] = { ...kaya.const.$ships[1], api_id: 736 }
assert.strictEqual(kc3Save(kaya, '1-4', battles).fleetFMain.ships[0].statsBase.asw, 56)
assert.strictEqual(noroDeck(kaya, '1-4', battles).f1.s1.asw, 40)
const save = kc3Save(state, '1-4', battles)
const twoFleets = structuredClone(state)
twoFleets.info.fleets.push({ api_ship: [20, -1] })
twoFleets.info.ships[20] = { ...twoFleets.info.ships[10], api_lv: 88 }
assert.strictEqual(playerFleet(twoFleets, 2).ships[0].level, 88)
assert.strictEqual(kc3Save(twoFleets, '1-4', battles, {}, 2).fleetFMain.ships[0].level, 88)
const secondDeck = noroDeck(twoFleets, '1-4', battles, {}, {}, 2)
assert.strictEqual(secondDeck.f1.s1.lv, 88)
assert.strictEqual(secondDeck.f1.name, '舰队 2')
assert.throws(() => playerFleet(twoFleets, 3), /poi 数据不可用：舰队 3/)
assert.deepStrictEqual(save.fleetFMain.ships[0].equips, [{ mstId: 1, level: 6, rank: 2 }, null, { mstId: 2, level: 0, rank: 0 }])
assert.strictEqual(save.fleetFMain.ships[0].fuelInit, 50)
assert.deepStrictEqual(save.battles[0].enemyComps.map((c) => c.rate), [9, 1])
assert.strictEqual(save.battles[0].doNB, true)
for (const [type, expected] of [[4, 1], [7, 4], [10, 6], [11, 2]]) {
  assert.strictEqual(kc3Save(state, '1-4', [{ ...battles[0], type }]).battles[0].nodeType, expected)
}
const mapped = battleNodes('1-4', { nodes: ['1', 'A', 'D', 'G', 'J', 'L'] }, { route: { 1: ['1', 'A'], 4: ['A', 'D'], 7: ['D', 'G'], 10: ['G', 'J'], 12: ['J', 'L'] } }, () => ({ status: 'ready', rows }))
assert.deepStrictEqual(mapped.map((b) => [b.node, b.cell]), [['D', 4], ['J', 10], ['L', 12]])
const deck = noroDeck(state, '1-4', battles, { L: compositionKey(rows[1]) }, { L: 2 })
assert.strictEqual(deck.f1.t, 0) // noro6 interprets any truthy t as a combined fleet.
assert.strictEqual(deck.f1.s1.items.ix.id, 2)
assert.strictEqual(deck.f1.s1.items.i2, undefined)
assert.strictEqual(deck.s.c[0].f1.s[0].id, 1502)
assert.strictEqual(deck.s.c[0].pf, 2)
assert.strictEqual(deck.s.c[0].ef, 2)
assert.strictEqual(noroDeck(state, '1-4', battles).s.c[0].f1.s[0].id, 1501)
assert.throws(() => kc3Save(state, '1-4', [{ ...battles[0], rows: [] }]), /无敌编成样本/)
assert.throws(() => kc3Save(state, '1-4', [{ ...battles[0], rows: Array(13).fill(rows[0]) }]), /最多支持 12/)
assert.throws(() => playerFleet({}), /poi 数据不可用/)
assert.deepStrictEqual(JSON.parse(new URL(noroUrl(deck)).searchParams.get('predeck')), deck)

kc3Url(save).then((url) => new Promise((resolve, reject) => {
  const bytes = [...Buffer.from(url.split('#backup=')[1], 'base64')]
  require('lzma').decompress(bytes, (text, error) => {
    if (error) return reject(error)
    assert.deepStrictEqual(JSON.parse(text), save)
    resolve()
  })
})).then(() => console.log('Exporter tests passed')).catch((error) => { console.error(error); process.exitCode = 1 })
