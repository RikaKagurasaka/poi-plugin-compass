'use strict'

const assert = require('assert')
const Module = require('module')
const catalog = require('./data/maps.json')
const normalCatalog = require('./data/normal-maps.json')
const {
  evaluateMap,
  evaluatePredicate,
  fleetContextFromState,
  mapNodeLabel,
  normalizeMapId,
  routeDecision,
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

assert.strictEqual(evaluatePredicate({ kind: 'count', category: 'DD', op: '>=', value: 2 }, context(2, { DD: 2 })).status, 'true')
assert.strictEqual(evaluatePredicate({ kind: 'count', category: 'DD', op: '>=', value: 2 }, context(1, { DD: 1 })).status, 'false')
assert.strictEqual(evaluatePredicate({ kind: 'los', op: '>=', value: 34 }, context(6, {}, { losScore: null })).status, 'unknown')

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

const middleRoute = evaluateMap(catalog.maps['2-5'], context(6, { CV: 1, CVL: 1, CL: 1, DD: 3 }), {})
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

const oneThree = evaluateMap(normalCatalog.maps['1-3'], context(6, { AO: 1 }), {})
assert.deepStrictEqual(oneThree.decisions['1'].outcomes, [{ to: 'A', probability: 1 }])
assert.deepStrictEqual(oneThree.decisions.A.outcomes, [{ to: 'D', probability: 1 }])
assert.deepStrictEqual(oneThree.decisions.D.outcomes, [{ to: 'B', probability: 1 }])

const threeOne = evaluateMap(normalCatalog.maps['3-1'], context(6, { BB: 3 }), {})
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

const state = {
  info: {
    basic: { api_level: 120 },
    fleets: [{ api_ship: [1, 2] }],
    ships: {
      1: { api_ship_id: 101, api_slot: [1001] },
      2: { api_ship_id: 102, api_slot: [] },
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
assert.ok(Number.isFinite(fleet.losScore))

const poiFleet = fleetContextFromState(state, 1, {
  losCalculator: () => ({ ship: 12.34, item: 20.56, teitoku: 4, total: 28.9 }),
})
assert.strictEqual(poiFleet.losScore, 28.9)
assert.strictEqual(poiFleet.losApproximate, false)
assert.strictEqual(poiFleet.losSource, 'poi-33')
assert.deepStrictEqual(poiFleet.losDetails, { ship: 12.34, item: 20.56, teitoku: 4, total: 28.9 })

const originalLoad = Module._load
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
        assert.strictEqual(shipsData.length, 2)
        assert.strictEqual(equipsData.length, 2)
        assert.strictEqual(commanderLevel, 120)
        assert.strictEqual(mapModifier, 1)
        assert.strictEqual(slotCount, 2)
        return { ship: 1, item: 2, teitoku: 3, total: 4 }
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}
const plugin = require('./index')
Module._load = originalLoad
assert.strictEqual(plugin.reactClass != null, true)
assert.strictEqual(plugin.windowMode, true)
assert.strictEqual(plugin.__test.mapIdFromDetail({ postBody: { api_maparea_id: 2, api_mapinfo_no: 5 } }), '2-5')
assert.strictEqual(plugin.__test.mapIdFromDetail({ body: { api_map_id: '11' } }), '1-1')
assert.strictEqual(plugin.__test.mapIds.length, 37)
assert.strictEqual(plugin.__test.mapIds[0], '1-1')
assert.strictEqual(plugin.__test.mapIds.at(-1), '7-5')
assert.deepStrictEqual(plugin.__test.calculatePoiLos33(state), { ship: 1, item: 2, teitoku: 3, total: 4 })

console.log('poi-plugin-compass tests passed')
