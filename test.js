'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const Module = require('module')
const path = require('path')
const { fileURLToPath } = require('url')
const catalog = require('./data/maps.json')
const normalCatalog = require('./data/normal-maps.json')
const poiMapCatalog = require('../../assets/data/fcd/map.json')
const kcnavCache = require('./scripts/cache-kcnav-maps')
const {
  evaluateMap,
  evaluatePredicate,
  fleetContextFromState,
  mapNodeLabel,
  normalizeMapId,
  predicateLabel,
  routeDecision,
  shipCategoryIds,
} = require('./logic')

function context(shipCount, counts = {}, extra = {}) {
  return {
    complete: true,
    shipCount,
    counts: { ...counts },
    equipmentShips: { drum: 0 },
    speedClass: 'high',
    losScore: 50,
    ...extra,
  }
}

assert.strictEqual(normalizeMapId('2-5'), '2-5')
assert.strictEqual(normalizeMapId('25'), '2-5')
assert.strictEqual(normalizeMapId(11), '1-1')
assert.strictEqual(normalizeMapId('nope'), null)
assert.strictEqual(kcnavCache.apiUrl('5-6'), 'https://tsunkit.net/api/routing/maps/5-6/')
assert.deepStrictEqual(kcnavCache.nodeTypesFromResult({
  spots: { '1': [0, 0, 'start'], A: [1, 1, ''] },
  route: { 0: [null, '1'], 1: ['1', 'A', 4] },
}), { '1': 0, A: 4 })
assert.deepStrictEqual(shipCategoryIds(3), ['CL', 'CL_ALL'])
assert.deepStrictEqual(shipCategoryIds(4), ['CLT', 'CL_ALL'])
assert.deepStrictEqual(shipCategoryIds(7), ['CVL', 'CV_ALL'])
assert.deepStrictEqual(shipCategoryIds(10), ['BBV', 'BB_ALL'])
assert.strictEqual(predicateLabel({ kind: 'count', category: 'CV_ALL', op: '>=', value: 1 }), 'CV系 >= 1')
assert.strictEqual(predicateLabel({ kind: 'count', category: ['BB_ALL', 'CV_ALL'], op: '>=', value: 2 }), 'BB系+CV系 >= 2')
assert.strictEqual(predicateLabel({ kind: 'onlyCategories', categories: ['CL_ALL', 'DD'] }), '仅含 CL系、驱逐')

assert.strictEqual(evaluatePredicate({ kind: 'count', category: 'DD', op: '>=', value: 2 }, context(2, { DD: 2 })).status, 'true')
assert.strictEqual(evaluatePredicate({ kind: 'count', category: 'DD', op: '>=', value: 2 }, context(1, { DD: 1 })).status, 'false')
assert.strictEqual(evaluatePredicate({ kind: 'count', category: 'CV_ALL', op: '>=', value: 1 }, context(1, { CVL: 1, CV_ALL: 1 })).status, 'true')
assert.strictEqual(evaluatePredicate({ kind: 'count', category: 'CV_MAIN', op: '>=', value: 1 }, context(1, { CVL: 1, CV_ALL: 1 })).status, 'false')
assert.strictEqual(evaluatePredicate({ kind: 'count', category: 'CL_ALL', op: '>=', value: 1 }, context(1, { CT: 1, CL_ALL: 1 })).status, 'true')
assert.strictEqual(evaluatePredicate({ kind: 'count', category: 'BB_ALL', op: '>=', value: 1 }, context(1, { BBV: 1, BB_ALL: 1 })).status, 'true')
assert.strictEqual(evaluatePredicate({ kind: 'los', op: '>=', value: 34 }, context(6, {}, { losScore: null })).status, 'unknown')
assert.strictEqual(evaluatePredicate({ kind: 'speed', mode: 'highPlus' }, context(6)).status, 'unknown')
assert.strictEqual(evaluatePredicate({ kind: 'speed', mode: 'fastest' }, context(6, {}, { enhancedSpeedClass: 'fastest' })).status, 'true')
assert.strictEqual(evaluatePredicate({ kind: 'phase', phase: 'P2' }, context(6, {}, { phase: 'P2' })).status, 'true')
assert.strictEqual(evaluatePredicate({ kind: 'equipmentShips', equipment: 'radar', op: '>=', value: 4 }, context(6, {}, { equipmentShips: { drum: 0, radar: 4 } })).status, 'true')
assert.strictEqual(evaluatePredicate({ kind: 'containsName', names: ['秋津洲'] }, context(1, {}, { ships: [{ name: '秋津洲改', categoryIds: ['AV'] }] })).status, 'true')
assert.strictEqual(evaluatePredicate({ kind: 'nameCount', names: ['長門', '陸奥'], op: '<=', value: 1 }, context(2, {}, { ships: [{ name: '長門改二' }, { name: '金剛改二' }] })).status, 'true')

const oneShip = evaluateMap(catalog.maps['1-1'], context(1), {})
assert.strictEqual(oneShip.decisions['1'].outcomes[0].to, 'A')
assert.deepStrictEqual(oneShip.decisions.A.outcomes, [
  { to: 'B', probability: 0.2 },
  { to: 'C', probability: 0.8 },
])
assert.strictEqual(oneShip.probability.edgeMass['A->B'], 0.2)
assert.strictEqual(oneShip.probability.edgeMass['A->C'], 0.8)
assert.strictEqual(oneShip.probability.reach.C, 0.8)

const sixShips = evaluateMap(catalog.maps['1-1'], context(6), {})
assert.deepStrictEqual(sixShips.decisions.A.outcomes, [
  { to: 'B', probability: 0.45 },
  { to: 'C', probability: 0.55 },
])

const middleRoute = evaluateMap(catalog.maps['2-5'], context(6, { CV_MAIN: 1, CV_ALL: 1, CVL: 1, CL: 1, DD: 3 }), {})
assert.deepStrictEqual(middleRoute.decisions['1'].outcomes, [{ to: 'C', probability: 1 }])
assert.deepStrictEqual(middleRoute.decisions.C.outcomes, [{ to: 'E', probability: 1 }])
assert.deepStrictEqual(middleRoute.decisions.E.outcomes, [{ to: 'I', probability: 1 }])
assert.deepStrictEqual(middleRoute.decisions.I.outcomes, [{ to: 'O', probability: 1 }])
assert.strictEqual(middleRoute.probability.reach.O, 1)

const unknownG = routeDecision(catalog.maps['2-5'], 'G', context(6, { DD: 3 }, { losScore: null }), {})
assert.strictEqual(unknownG.status, 'unknown')

const manualMap = {
  start: 'A',
  rules: [{
    node: 'A',
    priority: 1,
    manual: true,
    predicate: { kind: 'always' },
    outcomes: [{ to: 'B', probability: 0.5 }, { to: 'C', probability: 0.5 }],
  }],
}
const manualDecision = routeDecision(manualMap, 'A', context(1), { A: 'C' })
assert.strictEqual(manualDecision.manualOverride, 'C')
assert.deepStrictEqual(manualDecision.outcomes, [{ to: 'C', probability: 1 }])

const geometry = { '2-5': { route: { 2: ['1', 'B'], 3: ['1', 'C'] } } }
assert.strictEqual(mapNodeLabel('2-5', 3, geometry), 'C')
assert.strictEqual(mapNodeLabel('2-5', 99, geometry), '')

const oneTwo = evaluateMap(normalCatalog.maps['1-2'], context(6, { DD: 6 }, { speedClass: 'high' }), {})
assert.deepStrictEqual(oneTwo.decisions['1'].outcomes, [
  { to: 'A', probability: 0.4 },
  { to: 'B', probability: 0.6 },
])
assert.deepStrictEqual(oneTwo.decisions.A.outcomes, [{ to: 'E', probability: 1 }])
assert.deepStrictEqual(oneTwo.decisions.B.outcomes, [{ to: 'C', probability: 1 }])

const sevenTwoP1 = evaluateMap(normalCatalog.maps['7-2'], context(6, {}, { phase: 'P1' }), {})
assert.deepStrictEqual(sevenTwoP1.decisions.C.outcomes, [{ to: 'E', probability: 1 }])
assert.deepStrictEqual(sevenTwoP1.decisions.E.outcomes, [{ to: 'G', probability: 1 }])
const sevenTwoP2 = evaluateMap(normalCatalog.maps['7-2'], context(6, {}, { phase: 'P2' }), {})
assert.deepStrictEqual(sevenTwoP2.decisions.C.outcomes, [{ to: 'D', probability: 1 }])

const sevenFiveP1 = evaluateMap(normalCatalog.maps['7-5'], context(6, {}, { phase: 'P1' }), {})
assert.deepStrictEqual(sevenFiveP1.decisions.F.baseOutcomes, [{ to: 'G', probability: 1 }])
assert.deepStrictEqual(sevenFiveP1.decisions.H.baseOutcomes, [{ to: 'K', probability: 1 }])
assert.deepStrictEqual(sevenFiveP1.decisions.O.baseOutcomes, [{ to: 'P', probability: 1 }])
assert.strictEqual(sevenFiveP1.decisions.F.phaseRuleMatched, true)
assert.strictEqual(sevenFiveP1.decisions.F.manualChoiceRequired, false)
assert.deepStrictEqual(sevenFiveP1.decisions.F.manualOutcomes.map((outcome) => outcome.to), ['G', 'J'])
const sevenFiveP2 = evaluateMap(normalCatalog.maps['7-5'], context(6, {}, { phase: 'P2' }), {})
assert.deepStrictEqual(sevenFiveP2.decisions.F.baseOutcomes, [{ to: 'J', probability: 1 }])
assert.deepStrictEqual(sevenFiveP2.decisions.H.baseOutcomes, [{ to: 'I', probability: 1 }])
assert.deepStrictEqual(sevenFiveP2.decisions.O.baseOutcomes, [{ to: 'Q', probability: 1 }])
const fiveSix = normalCatalog.maps['5-6']
const fiveSixP1 = evaluateMap(
  { ...fiveSix, start: '1', boss: 'G' },
  context(6, { DD: 4 }, { phase: 'P1', losScore: 60, flags: { qRoutes: false } }),
  {},
)
assert.deepStrictEqual(fiveSixP1.decisions['1'].outcomes, [{ to: 'A', probability: 1 }])
assert.deepStrictEqual(fiveSixP1.decisions.E.outcomes, [{ to: 'G', probability: 1 }])
const fiveSixP2 = evaluateMap(
  { ...fiveSix, start: '2', boss: 'N' },
  context(6, { BB_ALL: 2, CL: 1, DD: 2 }, { phase: 'P2', losScore: 80, flags: { qRoutes: false } }),
  {},
)
assert.deepStrictEqual(fiveSixP2.decisions.I.baseOutcomes, [{ to: 'J', probability: 1 }])
assert.deepStrictEqual(fiveSixP2.decisions.L.outcomes, [{ to: 'N', probability: 1 }])
const fiveSixP3 = evaluateMap(
  { ...fiveSix, start: '2', boss: 'Z' },
  context(6, { BB_ALL: 2, CL: 1, DD: 2 }, { phase: 'P3', enhancedSpeedClass: 'highPlus', losScore: 90, flags: { qRoutes: true } }),
  {},
)
assert.deepStrictEqual(fiveSixP3.decisions.I.baseOutcomes, [{ to: 'O', probability: 1 }])
assert.deepStrictEqual(fiveSixP3.decisions.Q.outcomes, [{ to: 'W', probability: 1 }])
assert.deepStrictEqual(fiveSixP3.decisions.X.outcomes, [{ to: 'Z', probability: 1 }])
const sevenFiveManualWithUnknownLos = evaluateMap(
  normalCatalog.maps['7-5'],
  context(6, {}, { phase: 'P3', losScore: null }),
  { F: 'G', H: 'I' },
)
assert.strictEqual(sevenFiveManualWithUnknownLos.decisions.I.status, 'unknown')
assert.strictEqual(sevenFiveManualWithUnknownLos.probability.edgeMass['P->T'], undefined)

const activeBranches = [
  ['4-5', 'A', ['B', 'D']],
  ['4-5', 'C', ['D', 'F']],
  ['4-5', 'I', ['G', 'J']],
  ['5-3', 'O', ['K', 'P']],
  ['5-5', 'F', ['D', 'J']],
  ['6-3', 'A', ['B', 'C']],
  ['7-4', 'F', ['H', 'J']],
  ['7-5', 'F', ['G', 'J']],
  ['7-5', 'H', ['I', 'K']],
  ['7-5', 'O', ['P', 'Q']],
]
for (const [mapId, node, destinations] of activeBranches) {
  const decision = routeDecision(normalCatalog.maps[mapId], node, context(6, {}, { phase: 'P1' }), {})
  assert.strictEqual(decision.manual, true, `${mapId} ${node} should be an active branch`)
  assert.deepStrictEqual((decision.manualOutcomes || decision.baseOutcomes).map((outcome) => outcome.to), destinations)
  if (mapId === '7-5') {
    const phaseDefaults = { F: 'G', H: 'K', O: 'P' }
    assert.deepStrictEqual(decision.baseOutcomes, [{ to: phaseDefaults[node], probability: 1 }])
    assert.strictEqual(decision.phaseRuleMatched, true)
    assert.strictEqual(decision.manualChoiceRequired, false)
  } else {
    assert.ok(decision.baseOutcomes.every((outcome) => outcome.probability == null))
    assert.strictEqual(decision.phaseRuleMatched, false)
    assert.strictEqual(decision.manualChoiceRequired, true)
  }
  const selected = routeDecision(normalCatalog.maps[mapId], node, context(6, {}, { phase: 'P1' }), { [node]: destinations[1] })
  assert.deepStrictEqual(selected.outcomes, [{ to: destinations[1], probability: 1 }])
}

const oneThree = evaluateMap(normalCatalog.maps['1-3'], context(6, { AO: 1 }), {})
assert.deepStrictEqual(oneThree.decisions['1'].outcomes, [{ to: 'A', probability: 1 }])
assert.deepStrictEqual(oneThree.decisions.A.outcomes, [{ to: 'D', probability: 1 }])
assert.deepStrictEqual(oneThree.decisions.D.outcomes, [{ to: 'B', probability: 1 }])

const threeOne = evaluateMap(normalCatalog.maps['3-1'], context(6, { BB_ALL: 3 }), {})
assert.deepStrictEqual(threeOne.decisions['1'].outcomes, [{ to: 'C', probability: 1 }])
assert.deepStrictEqual(threeOne.decisions.C.outcomes, [{ to: 'D', probability: 1 }])
assert.deepStrictEqual(threeOne.decisions.D.outcomes, [{ to: 'F', probability: 1 }])
assert.deepStrictEqual(threeOne.decisions.F.outcomes, [{ to: 'G', probability: 1 }])
assert.strictEqual(threeOne.probability.reach.G, 1)

const oneFour = evaluateMap(normalCatalog.maps['1-4'], context(6, { DD: 6 }), {})
assert.deepStrictEqual(oneFour.decisions.B.outcomes, [{ to: 'C', probability: 1 }])
assert.deepStrictEqual(oneFour.decisions.F.outcomes, [{ to: 'E', probability: 1 }])
assert.strictEqual(oneFour.probability.reach.L, 1)

const twoOne = evaluateMap(normalCatalog.maps['2-1'], context(6, { DD: 6 }), {})
assert.deepStrictEqual(twoOne.decisions['1'].outcomes, [{ to: 'C', probability: 1 }])
assert.deepStrictEqual(twoOne.decisions.E.outcomes, [{ to: 'H', probability: 1 }])
assert.strictEqual(twoOne.probability.reach.H, 1)

const twoTwo = evaluateMap(normalCatalog.maps['2-2'], context(6, { CV_ALL: 3 }), {})
assert.deepStrictEqual(twoTwo.decisions.C.outcomes, [{ to: 'B', probability: 1 }])
assert.deepStrictEqual(twoTwo.decisions.B.outcomes, [{ to: 'A', probability: 1 }])

const threeTwo = evaluateMap(normalCatalog.maps['3-2'], context(6, { DD: 6 }), {})
assert.deepStrictEqual(threeTwo.decisions['1'].outcomes, [{ to: 'C', probability: 1 }])
assert.deepStrictEqual(threeTwo.decisions.C.outcomes, [{ to: 'G', probability: 1 }])
assert.strictEqual(threeTwo.probability.reach.L, 1)

const threeFive = evaluateMap(normalCatalog.maps['3-5'], context(6, { DD: 6 }), {})
assert.deepStrictEqual(threeFive.decisions['1'].outcomes, [{ to: 'F', probability: 1 }])
assert.deepStrictEqual(threeFive.decisions.G.outcomes, [{ to: 'K', probability: 1 }])

const fourOne = evaluateMap(normalCatalog.maps['4-1'], context(6, { DD: 6 }), {})
assert.strictEqual(fourOne.probability.reach.J, 1)

const fourTwo = evaluateMap(normalCatalog.maps['4-2'], context(6, { DD: 6 }), {})
assert.strictEqual(fourTwo.probability.reach.L, 1)

const fourThree = evaluateMap(normalCatalog.maps['4-3'], context(6, { DD: 6 }), {})
assert.deepStrictEqual(fourThree.decisions.D.outcomes, [{ to: 'H', probability: 1 }])
assert.strictEqual(fourThree.probability.reach.N, 0.7)

const state = {
  info: {
    basic: { api_level: 120 },
    fleets: [{ api_ship: [1, 2] }],
    ships: {
      1: { api_ship_id: 101, api_slot: [1001, -1, -1, -1, -1], api_slotnum: 1, api_onslot: [0, 0, 0, 0, 0], api_slot_ex: -1, api_soku: 15, api_sakuteki: [20, 20] },
      2: { api_ship_id: 102, api_slot: [-1, -1, -1, -1, -1], api_slotnum: 0, api_onslot: [0, 0, 0, 0, 0], api_slot_ex: -1, api_soku: 20, api_sakuteki: [25, 25] },
    },
    equips: { 1001: { api_slotitem_id: 2001 } },
  },
  const: {
    $ships: {
      101: { api_stype: 2, api_soku: 10, api_sakuteki: 20 },
      102: { api_stype: 3, api_soku: 10, api_sakuteki: 25 },
    },
    $equips: {
      2001: { api_name: '运输桶', api_sakuteki: 0 },
    },
  },
}
const fleet = fleetContextFromState(state)
assert.strictEqual(fleet.shipCount, 2)
assert.strictEqual(fleet.counts.DD, 1)
assert.strictEqual(fleet.counts.CL, 1)
assert.strictEqual(fleet.equipmentShips.drum, 1)
assert.strictEqual(fleet.speedClass, 'high')
assert.strictEqual(fleet.fleetSpeed, 15)
assert.strictEqual(fleet.enhancedSpeedClass, 'highPlus')
assert.strictEqual(fleet.losScore, null)
assert.strictEqual(fleet.losSource, 'unavailable')
assert.strictEqual(fleet.dataAvailable, false)

const poiFleet = fleetContextFromState(state, 1, {
  losCalculator: () => ({ ship: 12.34, item: 20.56, teitoku: 4, total: 28.9 }),
})
assert.strictEqual(poiFleet.losScore, 28.9)
assert.strictEqual(poiFleet.losApproximate, false)
assert.strictEqual(poiFleet.losSource, 'poi-33')
assert.deepStrictEqual(poiFleet.losDetails, { ship: 12.34, item: 20.56, teitoku: 4, total: 28.9 })
assert.deepStrictEqual(poiFleet.losScores, [28.9, 28.9, 28.9, 28.9])
assert.strictEqual(poiFleet.dataAvailable, true)

const coefficientFleet = fleetContextFromState(state, 1, {
  losCalculator: (_, __, coefficient) => ({ total: coefficient }),
  losCoefficient: 3,
  admiralCoefficient: 0.35,
})
assert.deepStrictEqual(coefficientFleet.losScores, [1, 2, 3, 4])
assert.strictEqual(coefficientFleet.losScore, 3)
assert.strictEqual(coefficientFleet.losCoefficient, 3)
assert.strictEqual(coefficientFleet.admiralCoefficient, 0.35)

const equalProbability = evaluateMap({
  start: 'A',
  rules: [{
    node: 'A',
    confidence: 'unknown',
    predicate: { kind: 'always' },
    outcomes: [{ to: 'B', probability: null }, { to: 'C', probability: null }],
  }],
}, context(1), {})
assert.deepStrictEqual(equalProbability.decisions.A.outcomes, [
  { to: 'B', probability: 0.5, estimated: true },
  { to: 'C', probability: 0.5, estimated: true },
])
assert.deepStrictEqual(equalProbability.probability.estimatedEdges, ['A->B', 'A->C'])

const propagatedEstimate = evaluateMap({
  start: 'A',
  rules: [
    {
      node: 'A',
      confidence: 'unknown',
      predicate: { kind: 'always' },
      outcomes: [{ to: 'B', probability: null }, { to: 'C', probability: null }],
    },
    { node: 'B', predicate: { kind: 'always' }, outcomes: [{ to: 'D', probability: 1 }] },
  ],
}, context(1), {})
assert.ok(propagatedEstimate.probability.estimatedEdges.includes('B->D'))
assert.ok(propagatedEstimate.probability.estimatedNodes.includes('D'))

const unknownMustNotFallThrough = evaluateMap({
  start: 'A',
  rules: [
    {
      node: 'A',
      predicate: { kind: 'los', op: '>=', value: 50 },
      outcomes: [{ to: 'B', probability: 1 }],
    },
    {
      node: 'A',
      predicate: { kind: 'always', label: '其余编成' },
      outcomes: [{ to: 'C', probability: 1 }],
    },
  ],
}, context(1, {}, { losScore: null }), {})
assert.strictEqual(unknownMustNotFallThrough.decisions.A.status, 'unknown')
assert.deepStrictEqual(unknownMustNotFallThrough.decisions.A.outcomes, [])
assert.deepStrictEqual(unknownMustNotFallThrough.probability.edgeMass, {})

const originalLoad = Module._load
let expectedLosShips = 2
Module._load = function load(request, parent, isMain) {
  if (request === 'react') {
    return {
      Component: class Component {
        forceUpdate() {}
      },
      createElement() {
        return null
      },
    }
  }
  if (request === 'views/create-store') return { store: null }
  if (request === 'views/utils/game-utils') {
    return {
      getSaku33(shipsData, equipsData, commanderLevel, mapModifier, slotCount) {
        assert.strictEqual(shipsData.length, expectedLosShips)
        assert.strictEqual(equipsData.length, expectedLosShips)
        assert.strictEqual(equipsData[0].length, 2)
        assert.deepStrictEqual(equipsData[0][0], [state.info.equips[1001], state.const.$equips[2001], 0])
        if (expectedLosShips === 2) assert.strictEqual(equipsData[1].length, 1)
        assert.ok([1, 2, 3, 4].includes(mapModifier))
        assert.strictEqual(commanderLevel, 120)
        assert.strictEqual(slotCount, 2)
        return { ship: 1, item: 2, teitoku: 3, total: mapModifier + 3 }
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}
const plugin = require('./index')
Module._load = originalLoad
const kcwikiManifest = require('./data/sources/kcwiki/routes/manifest.json')
assert.strictEqual(plugin.reactClass != null, true)
assert.strictEqual(plugin.windowMode, true)
assert.strictEqual(plugin.__test.mapIdFromDetail({ postBody: { api_maparea_id: 2, api_mapinfo_no: 5 } }), '2-5')
assert.strictEqual(plugin.__test.mapIdFromDetail({ body: { api_map_id: '11' } }), '1-1')
assert.strictEqual(plugin.__test.cellFromDetail({ body: { api_no: 0 } }), 0)
assert.ok(plugin.__test.mapBackgroundUrl('5-3').endsWith('/assets/kcnav/maps/5-3.webp'))
assert.ok(plugin.__test.nodeIconUrl(48).endsWith('/assets/kcnav/icons/map_main/48.png'))
assert.ok(plugin.__test.nodeIconUrl(19).endsWith('/assets/kcnav/icons/map_common/19.png'))
assert.ok(plugin.__test.nodeIconUrl('map_common/136').endsWith('/assets/kcnav/icons/map_common/136.png'))
assert.strictEqual(plugin.__test.nodeVisualStyle({ simpleSize: 3, size: 2.5, fontSize: 18 }).rx, 25)
assert.strictEqual(plugin.__test.nodeVisualStyle({ simpleSize: 3, size: 2.5, fontSize: 18 }).ry, 25)
assert.strictEqual(plugin.__test.nodeVisualStyle({ width: 4.5, height: 2 }).rx, 32.5)
assert.strictEqual(plugin.__test.nodeVisualStyle({ width: 4.5, height: 2 }).ry, 32.5)
assert.strictEqual(plugin.__test.nodeVisualStyle({}).fontSize, 16)
assert.strictEqual(require('./data/kcnav-node-types.json')['0'].fontSize, 22)
assert.strictEqual(plugin.__test.nodeVisualStyle({ background: '#ff7979', border: '#ef1a1a' }).background, '#ff7979')
for (const mapId of plugin.__test.mapIds) {
  assert.ok(fs.statSync(fileURLToPath(plugin.__test.mapBackgroundUrl(mapId))).size > 0, mapId)
}
for (const icon of [48, 'map_common/136']) {
  assert.ok(fs.statSync(fileURLToPath(plugin.__test.nodeIconUrl(icon))).size > 0, String(icon))
}
assert.deepStrictEqual(plugin.__test.kcnavNodeTypesFromMap({
  spots: { '1': [0, 0, 'Start'], A: [1, 1, null], B: [2, 2, null] },
  route: { 0: [null, '1', 0], 1: ['1', 'A', 4], 2: ['A', 'B', 5] },
}), { '1': 0, A: 4, B: 5 })
assert.strictEqual(plugin.__test.localNodeTypesForMap('5-3', { start: '1', boss: 'Q' }).I, 11)
assert.strictEqual(plugin.__test.localNodeTypesForMap('5-3', { start: '1', boss: 'Q', manualNodes: ['O'] }).O, 91)
assert.strictEqual(plugin.__test.mapIds.length, 37)
assert.strictEqual(plugin.__test.mapIds[0], '1-1')
assert.strictEqual(plugin.__test.mapIds.at(-1), '7-5')
assert.strictEqual(kcwikiManifest.maps.length, plugin.__test.mapIds.length)
assert.deepStrictEqual(kcwikiManifest.maps.map((entry) => entry.mapId), plugin.__test.mapIds)
for (const entry of kcwikiManifest.maps) {
  const contentPath = path.join(__dirname, 'data/sources/kcwiki/routes', entry.contentFile)
  const content = fs.readFileSync(contentPath)
  assert.ok(content.length > 0, entry.mapId)
  assert.strictEqual(crypto.createHash('sha256').update(content).digest('hex'), entry.sha256, entry.mapId)
}
assert.strictEqual(Object.keys(plugin.__test.losConfig).length, 37)
assert.deepStrictEqual(plugin.__test.losConfig['4-5'], { branchingCoefficient: 2, admiralCoefficient: 0.35 })
assert.deepStrictEqual(plugin.__test.losConfig['6-5'], { branchingCoefficient: 3, admiralCoefficient: 0.4, confidence: 'approximate' })
assert.deepStrictEqual(plugin.__test.losConfig['5-6'], { branchingCoefficient: 4, admiralCoefficient: 0.4, confidence: 'approximate' })
assert.deepStrictEqual(plugin.__test.phaseOptionsForMap('7-2').map((phase) => phase.id), ['P1', 'P2'])
assert.deepStrictEqual(plugin.__test.phaseOptionsForMap('7-5').map((phase) => phase.id), ['P1', 'P2', 'P3'])
assert.deepStrictEqual(plugin.__test.phaseOptionsForMap('5-6').map((phase) => [phase.id, phase.start, phase.boss]), [
  ['P1', '1', 'G'],
  ['P2', '2', 'N'],
  ['P3', '2', 'Z'],
])
for (const [mapId, mapDefinition] of Object.entries({ ...normalCatalog.maps, ...catalog.maps })) {
assert.strictEqual(plugin.__test.mapGeometryAvailable(mapDefinition, poiMapCatalog.data[mapId]), true, mapId)
}
assert.deepStrictEqual(plugin.__test.calculatePoiLos33(state), { ship: 1, item: 2, teitoku: 3, total: 4 })
assert.strictEqual(plugin.__test.calculatePoiLos33(state, 1, 4).total, 7)
expectedLosShips = 1
assert.deepStrictEqual(plugin.__test.calculatePoiLos33({
  ...state,
  sortie: { sortieStatus: [true], escapedPos: [1] },
}), { ship: 1, item: 2, teitoku: 3, total: 4 })

// Offline KCNav topology catches spurious fixed edges and missing continuations.
const allMaps = { ...normalCatalog.maps, ...catalog.maps }
const startTransfers = new Set(['6-4-start-right-lha', '6-4-start-right-heavy', '6-5-start-right'])
for (const [mapId, definition] of Object.entries(allMaps)) {
  const snapshot = require(`./data/sources/kcnav/maps/${mapId}.json`).result
  const edges = Object.values(snapshot.route).filter((entry) => entry[0] && entry[1])
  const edgeKeys = new Set(edges.map(([from, to]) => `${from}->${to}`))
  const sourceNodes = new Set(edges.map(([from]) => from))
  const nodeTypes = plugin.__test.localNodeTypesForMap(mapId, definition)
  if (definition.boss) assert.strictEqual(nodeTypes[definition.boss], 5, `${mapId} boss`)
  for (const node of sourceNodes) {
    assert.ok(definition.rules.some((rule) => rule.node === node), `${mapId} ${node} missing rules`)
  }
  for (const rule of definition.rules) {
    if (rule.terminal === true) {
      assert.ok(!sourceNodes.has(rule.node), `${mapId} ${rule.node} false terminal`)
      const terminal = evaluateMap({ ...definition, start: rule.node }, context(6))
      assert.strictEqual(terminal.decisions[rule.node].status, 'terminal')
      assert.deepStrictEqual(terminal.probability.unknownNodes, [])
    }
    for (const outcome of rule.outcomes) {
      if (startTransfers.has(rule.id) && rule.node === '1' && outcome.to === '2') continue
      assert.ok(edgeKeys.has(`${rule.node}->${outcome.to}`), `${mapId} ${rule.id}: ${rule.node}->${outcome.to}`)
    }
  }
  for (const [from, outcomes] of Object.entries(definition.manualOutcomes || {})) {
    for (const { to } of outcomes) assert.ok(edgeKeys.has(`${from}->${to}`), `${mapId} manual ${from}->${to}`)
  }
}
assert.deepStrictEqual(routeDecision(allMaps['5-2'], '1', context(6, { CV_MAIN: 2, CV_ALL: 2, BB_ALL: 2, DD: 2 })).outcomes, [{ to: 'B', probability: 1 }])
assert.strictEqual(routeDecision(allMaps['5-2'], '1', context(6, { BB_ALL: 4 })).outcomes[0].estimated, true)
assert.strictEqual(routeDecision({ rules: [{ node: 'A', predicate: { kind: 'count', category: 'DD', op: '>=', value: 1 }, outcomes: [{ to: 'B', probability: 1 }] }] }, 'A', context(1)).status, 'unknown')
for (const [losScore, expected] of [[59, ['M', 'L']], [60, ['M', 'T', 'L']], [70, ['M', 'T']]]) {
  const decision = routeDecision(allMaps['4-5'], 'K', context(6, { SS: 1 }, { losScore, passedNodes: [] }))
  assert.deepStrictEqual(decision.outcomes.map(({ to }) => to), expected)
  assert.ok(decision.outcomes.every(({ estimated }) => estimated))
}
for (const mapId of ['6-1', '6-2', '7-1']) {
  assert.notStrictEqual(plugin.__test.localNodeTypesForMap(mapId, { boss: 'J' }).J, 5)
}
assert.strictEqual(plugin.__test.localNodeTypesForMap('7-4', allMaps['7-4']).J, 4)
const nodeStyles = require('./data/kcnav-node-types.json')
assert.strictEqual(plugin.__test.nodeVisualStyle(nodeStyles['7']).rx, plugin.__test.nodeVisualStyle(nodeStyles['10']).rx)
for (const style of Object.values(nodeStyles)) {
  const visual = plugin.__test.nodeVisualStyle(style)
  assert.strictEqual(visual.offsetX, 0)
  assert.strictEqual(visual.offsetY, 0)
  assert.strictEqual(visual.rx, visual.ry)
}

console.log('poi-plugin-compass tests passed')
