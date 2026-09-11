'use strict'

const SHIP_CATEGORIES = {
  DE: new Set([1]),
  DD: new Set([2]),
  CL: new Set([3, 4, 21]),
  CLT: new Set([4]),
  CA: new Set([5]),
  CAV: new Set([6]),
  CVL: new Set([7]),
  BB: new Set([8, 9, 10]),
  CV: new Set([7, 11, 12, 18]),
  SS: new Set([13, 14]),
  AO: new Set([15]),
  AV: new Set([16]),
  LHA: new Set([17]),
  AR: new Set([19]),
  AS: new Set([20]),
  BBV: new Set([10]),
  CV_MAIN: new Set([11, 12, 18]),
}

const CATEGORY_LABELS = {
  DE: '海防',
  DD: '驱逐',
  CL: '轻巡',
  CLT: '雷巡',
  CA: '重巡',
  CAV: '航巡',
  CVL: '轻空母',
  BB: '战舰系',
  CV: '空母系',
  SS: '潜水系',
  AO: '补给',
  AV: '水母',
  LHA: '扬陆',
  AR: '工作舰',
  AS: '潜母',
  BBV: '航战',
  CV_MAIN: '正规/装甲空母',
}

const EQUIPMENT_CATEGORY_LABELS = {
  drum: '运输桶',
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function integer(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function normalizeMapId(value) {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)[-](\d+)$/)
    if (match) return `${number(match[1])}-${number(match[2])}`
    const compact = value.trim().match(/^(\d+)(\d)$/)
    if (compact) return `${number(compact[1])}-${number(compact[2])}`
  }
  const parsed = integer(value)
  if (parsed != null && parsed >= 11) return `${Math.floor(parsed / 10)}-${parsed % 10}`
  return null
}

function compare(left, operator, right) {
  switch (operator) {
    case '==':
      return left === right
    case '!=':
      return left !== right
    case '>':
      return left > right
    case '>=':
      return left >= right
    case '<':
      return left < right
    case '<=':
      return left <= right
    default:
      return false
  }
}

function statusResult(status, predicate, label) {
  return {
    status,
    predicate,
    label: label || predicate?.label || predicateLabel(predicate),
  }
}

function predicateLabel(predicate) {
  if (!predicate || typeof predicate !== 'object') return '未知条件'
  if (predicate.label) return predicate.label
  if (predicate.kind === 'always') return '始终适用'
  if (predicate.kind === 'count') {
    const category = Array.isArray(predicate.category)
      ? predicate.category.join('+')
      : predicate.category || '舰队'
    return `${category} ${predicate.op || '=='} ${predicate.value}`
  }
  if (predicate.kind === 'equipmentShips') {
    return `${EQUIPMENT_CATEGORY_LABELS[predicate.equipment] || predicate.equipment}舰数 ${predicate.op || '=='} ${predicate.value}`
  }
  if (predicate.kind === 'los') return `索敌 ${predicate.op || '=='} ${predicate.value}`
  if (predicate.kind === 'losRange') return `索敌 ${predicate.min}～${predicate.max}`
  if (predicate.kind === 'speed') return predicate.mode === 'hasLow' ? '含低速舰' : '全高速'
  if (predicate.kind === 'onlyCategories') {
    return `仅含 ${(predicate.categories || []).map((category) => CATEGORY_LABELS[category] || category).join('、')}`
  }
  if (predicate.kind === 'all') return (predicate.predicates || []).map(predicateLabel).join(' 且 ')
  if (predicate.kind === 'any') return (predicate.predicates || []).map(predicateLabel).join(' 或 ')
  return predicate.kind || '未知条件'
}

function categoryCount(context, category) {
  const categories = Array.isArray(category) ? category : [category]
  if (categories.includes('__all__')) return number(context.shipCount)
  return categories.reduce((total, value) => total + number(context.counts?.[value]), 0)
}

function evaluatePredicate(predicate, context = {}) {
  if (!predicate || typeof predicate !== 'object') return statusResult('unknown', predicate, '未知条件')

  switch (predicate.kind) {
    case 'always':
      return statusResult('true', predicate)
    case 'count': {
      const actual = predicate.field === 'ships'
        ? number(context.shipCount)
        : categoryCount(context, predicate.category)
      if (context.complete === false) return statusResult('unknown', predicate)
      return statusResult(compare(actual, predicate.op || '==', number(predicate.value)) ? 'true' : 'false', predicate)
    }
    case 'equipmentShips': {
      const actual = number(context.equipmentShips?.[predicate.equipment])
      if (context.complete === false) return statusResult('unknown', predicate)
      return statusResult(compare(actual, predicate.op || '==', number(predicate.value)) ? 'true' : 'false', predicate)
    }
    case 'speed': {
      if (!context.speedClass || context.speedClass === 'unknown') return statusResult('unknown', predicate)
      const matches = predicate.mode === 'hasLow'
        ? context.speedClass === 'low'
        : context.speedClass === 'high'
      return statusResult(matches ? 'true' : 'false', predicate)
    }
    case 'los': {
      if (context.losScore == null || !Number.isFinite(Number(context.losScore))) return statusResult('unknown', predicate)
      return statusResult(compare(Number(context.losScore), predicate.op || '==', number(predicate.value)) ? 'true' : 'false', predicate)
    }
    case 'losRange': {
      if (context.losScore == null || !Number.isFinite(Number(context.losScore))) return statusResult('unknown', predicate)
      const score = Number(context.losScore)
      const min = number(predicate.min)
      const max = number(predicate.max)
      return statusResult(score >= min && score < max ? 'true' : 'false', predicate)
    }
    case 'flagshipCategory': {
      if (!context.flagship || context.flagship.categoryIds == null) return statusResult('unknown', predicate)
      const matches = (Array.isArray(predicate.categories) ? predicate.categories : [predicate.category])
        .some((category) => context.flagship.categoryIds.includes(category))
      return statusResult(matches ? 'true' : 'false', predicate)
    }
    case 'onlyCategories': {
      const categories = Array.isArray(predicate.categories) ? predicate.categories : []
      if (context.complete === false || !context.ships?.length || !categories.length) {
        return statusResult('unknown', predicate)
      }
      const matches = context.ships.every((ship) =>
        categories.some((category) => ship.categoryIds?.includes(category)),
      )
      return statusResult(matches ? 'true' : 'false', predicate)
    }
    case 'all': {
      const results = (predicate.predicates || []).map((child) => evaluatePredicate(child, context))
      if (results.some((result) => result.status === 'false')) return statusResult('false', predicate)
      if (results.some((result) => result.status === 'unknown')) return statusResult('unknown', predicate)
      return statusResult('true', predicate)
    }
    case 'any': {
      const results = (predicate.predicates || []).map((child) => evaluatePredicate(child, context))
      if (results.some((result) => result.status === 'true')) return statusResult('true', predicate)
      if (results.some((result) => result.status === 'unknown')) return statusResult('unknown', predicate)
      return statusResult('false', predicate)
    }
    case 'not': {
      const result = evaluatePredicate(predicate.predicate, context)
      if (result.status === 'unknown') return statusResult('unknown', predicate)
      return statusResult(result.status === 'true' ? 'false' : 'true', predicate)
    }
    default:
      return statusResult('unknown', predicate)
  }
}

function rulesForNode(mapDefinition, node) {
  return (mapDefinition?.rules || [])
    .filter((rule) => rule.node === node)
    .sort((left, right) => number(left.priority) - number(right.priority))
}

function selectRouteRule(mapDefinition, node, context) {
  let firstUnknown = null
  for (const rule of rulesForNode(mapDefinition, node)) {
    const predicate = evaluatePredicate(rule.predicate, context)
    if (predicate.status === 'true') {
      return { status: rule.outcomes?.length ? 'matched' : 'unknown', rule, predicate }
    }
    if (predicate.status === 'unknown' && !firstUnknown) firstUnknown = { rule, predicate }
  }
  if (firstUnknown) return { status: 'unknown', ...firstUnknown }
  return { status: 'terminal', rule: null, predicate: null }
}

function normalizeOutcomes(outcomes) {
  return (Array.isArray(outcomes) ? outcomes : [])
    .filter((outcome) => outcome && typeof outcome.to === 'string')
    .map((outcome) => ({
      to: outcome.to,
      probability: Number.isFinite(Number(outcome.probability)) ? Number(outcome.probability) : null,
    }))
}

function routeDecision(mapDefinition, node, context, overrides = {}) {
  const selected = selectRouteRule(mapDefinition, node, context)
  const baseOutcomes = normalizeOutcomes(selected.rule?.outcomes)
  const override = overrides[node]
  const validOverride = selected.rule?.manual === true && baseOutcomes.some((outcome) => outcome.to === override)
  const outcomes = validOverride
    ? [{ to: override, probability: 1 }]
    : baseOutcomes
  return {
    node,
    status: selected.status,
    rule: selected.rule,
    predicate: selected.predicate,
    baseOutcomes,
    outcomes,
    manual: selected.rule?.manual === true,
    manualOverride: validOverride ? override : null,
  }
}

function edgeKey(from, to) {
  return `${from}->${to}`
}

function propagateProbability(start, decisions) {
  const reach = {}
  const edgeMass = {}
  const unknownNodes = new Set()
  const unknownEdges = new Set()

  function walk(node, mass, path) {
    if (!Number.isFinite(mass) || mass <= 0) return
    reach[node] = number(reach[node]) + mass
    if (path.has(node)) {
      unknownNodes.add(node)
      return
    }
    const decision = decisions[node]
    if (!decision || decision.status === 'unknown' || decision.status === 'terminal' && !decision.outcomes.length) {
      if (decision?.status === 'unknown' || decision?.rule) unknownNodes.add(node)
      return
    }
    const nextPath = new Set(path)
    nextPath.add(node)
    decision.outcomes.forEach((outcome) => {
      const key = edgeKey(node, outcome.to)
      if (outcome.probability == null) {
        unknownEdges.add(key)
        return
      }
      edgeMass[key] = number(edgeMass[key]) + mass * outcome.probability
      walk(outcome.to, mass * outcome.probability, nextPath)
    })
  }

  walk(start, 1, new Set())
  return {
    reach,
    edgeMass,
    unknownNodes: Array.from(unknownNodes),
    unknownEdges: Array.from(unknownEdges),
  }
}

function evaluateMap(mapDefinition, context = {}, overrides = {}) {
  const nodes = new Set([mapDefinition?.start || '1'])
  ;(mapDefinition?.rules || []).forEach((rule) => nodes.add(rule.node))
  const decisions = {}
  nodes.forEach((node) => {
    decisions[node] = routeDecision(mapDefinition, node, context, overrides)
    decisions[node].outcomes.forEach((outcome) => nodes.add(outcome.to))
  })
  // A rule outcome can introduce another node; resolve its decision once as well.
  Array.from(nodes).forEach((node) => {
    if (!decisions[node]) decisions[node] = routeDecision(mapDefinition, node, context, overrides)
  })
  const probability = propagateProbability(mapDefinition?.start || '1', decisions)
  return { decisions, probability }
}

function mapNodeLabel(mapId, cell, maps) {
  const normalized = normalizeMapId(mapId)
  const route = maps?.[normalized]?.route
  const entry = route?.[number(cell)]
  return Array.isArray(entry) && typeof entry[1] === 'string' ? entry[1] : ''
}

function shipCategoryIds(typeId) {
  return Object.entries(SHIP_CATEGORIES)
    .filter(([, ids]) => ids.has(number(typeId)))
    .map(([category]) => category)
}

function equipmentKind(master) {
  const name = String(master?.api_name || '')
  if (name.includes('ドラム缶') || name.includes('运输桶')) return 'drum'
  return null
}

function getFleet(state, deckId = 1) {
  const fleets = state?.info?.fleets
  if (Array.isArray(fleets)) return fleets[deckId - 1] || null
  return fleets?.[deckId - 1] || fleets?.[deckId] || null
}

function calculateLosScore(ships, commanderLevel) {
  if (!ships.length || ships.some((ship) => !Number.isFinite(ship.baseLos))) return null
  const shipLos = ships.reduce((total, ship) => total + Math.sqrt(Math.max(0, ship.baseLos)), 0)
  const equipmentLos = ships.reduce(
    (total, ship) => total + ship.equipments.reduce((subtotal, equipment) => subtotal + number(equipment.api_sakuteki), 0),
    0,
  )
  const commanderPenalty = Math.ceil(number(commanderLevel) * 0.4)
  const fleetSizeCorrection = 2 * Math.max(0, 6 - ships.length)
  return Math.floor(shipLos + equipmentLos - commanderPenalty + fleetSizeCorrection)
}

function fleetContextFromState(state, deckId = 1, options = {}) {
  const fleet = getFleet(state, deckId)
  const instanceShips = state?.info?.ships || {}
  const masterShips = state?.const?.$ships || {}
  const instanceEquips = state?.info?.equips || {}
  const masterEquips = state?.const?.$equips || {}
  const shipIds = Array.isArray(fleet?.api_ship) ? fleet.api_ship : []
  const complete = Boolean(fleet && Object.keys(masterShips).length)
  const ships = shipIds
    .filter((id) => number(id) > 0)
    .map((instanceId, index) => {
      const instance = instanceShips[instanceId]
      const master = masterShips[instance?.api_ship_id]
      if (!instance || !master) return null
      const equipmentIds = Array.isArray(instance.api_slot) ? instance.api_slot : []
      const equipments = equipmentIds
        .filter((id) => number(id) > 0)
        .map((id) => masterEquips[instanceEquips[id]?.api_slotitem_id])
        .filter(Boolean)
      const categoryIds = shipCategoryIds(master.api_stype)
      return {
        instanceId: number(instanceId),
        masterId: number(instance.api_ship_id),
        name: master.api_name || `#${instance.api_ship_id}`,
        categoryIds,
        typeId: number(master.api_stype),
        speed: number(master.api_soku),
        baseLos: Number.isFinite(Number(master.api_sakuteki)) ? Number(master.api_sakuteki) : null,
        equipments,
        equipmentKinds: equipments.map(equipmentKind).filter(Boolean),
        flagship: index === 0,
      }
    })
    .filter(Boolean)

  const counts = {}
  Object.keys(SHIP_CATEGORIES).forEach((category) => {
    counts[category] = ships.filter((ship) => ship.categoryIds.includes(category)).length
  })
  const speedKnown = ships.length > 0 && ships.every((ship) => ship.speed > 0)
  const speedClass = !speedKnown ? 'unknown' : ships.some((ship) => ship.speed < 10) ? 'low' : 'high'
  const equipmentShips = {
    drum: ships.filter((ship) => ship.equipmentKinds.includes('drum')).length,
  }
  const poiLos = typeof options.losCalculator === 'function'
    ? options.losCalculator(state, deckId)
    : null
  const poiLosScore = poiLos && typeof poiLos === 'object' ? poiLos.total : poiLos
  const hasPoiLos = Number.isFinite(Number(poiLosScore))
  return {
    complete,
    shipCount: ships.length,
    ships,
    flagship: ships[0] || null,
    counts,
    equipmentShips,
    speedClass,
    losScore: hasPoiLos ? Number(poiLosScore) : calculateLosScore(ships, state?.info?.basic?.api_level),
    losApproximate: !hasPoiLos,
    losSource: hasPoiLos ? 'poi-33' : 'fallback',
    losDetails: hasPoiLos && typeof poiLos === 'object' ? poiLos : null,
  }
}

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1).replace(/\.0$/, '')}%` : '未知'
}

module.exports = {
  CATEGORY_LABELS,
  SHIP_CATEGORIES,
  calculateLosScore,
  categoryCount,
  edgeKey,
  evaluateMap,
  evaluatePredicate,
  fleetContextFromState,
  formatPercent,
  mapNodeLabel,
  normalizeMapId,
  predicateLabel,
  propagateProbability,
  routeDecision,
  selectRouteRule,
  shipCategoryIds,
}
