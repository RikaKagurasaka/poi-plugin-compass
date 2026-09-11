'use strict'

const path = require('path')
const { pathToFileURL } = require('url')
const React = require('react')
const { store } = require('views/create-store')
const primaryMapCatalog = require('./data/maps.json')
const normalMapCatalog = require('./data/normal-maps.json')
const losCatalog = require('./data/los-config.json')
const kcnavNodeCatalog = require('./data/kcnav-node-types.json')
const localKcnavNodeTypes = require('./data/kcnav-node-types-by-map.json')
const { loadEnemies, formationLabel } = require('./enemies')
const { mapOverview } = require('./overview')
const { airStateRange } = require('./air-status')
const { enumerateRoutes, battleNodes, compositionKey, kc3Save, noroDeck, kc3Url, noroUrl } = require('./exporters')
const mapCatalog = {
  ...normalMapCatalog,
  ...primaryMapCatalog,
  maps: { ...normalMapCatalog.maps, ...primaryMapCatalog.maps },
}
const mapIds = Object.keys(mapCatalog.maps).sort((left, right) =>
  left.localeCompare(right, undefined, { numeric: true }),
)
const mapAreas = [
  ['1', '镇守府'], ['2', '南西群岛'], ['3', '北方'], ['7', '南西'],
  ['4', '西方'], ['5', '南方'], ['6', '中部'],
]
const LOCAL_KCNAV_ASSET_ROOT = path.join(__dirname, 'assets', 'kcnav')

const MAP_PHASES = {
  '5-6': [
    { id: 'P1', label: 'P1', start: '1', boss: 'G' },
    { id: 'P2', label: 'P2', start: '2', boss: 'N' },
    { id: 'P3', label: 'P3', start: '2', boss: 'Z' },
  ],
  '7-2': [
    { id: 'P1', label: 'P1', boss: 'G' },
    { id: 'P2', label: 'P2', boss: 'M' },
  ],
  '7-3': [
    { id: 'P1', label: 'P1', boss: 'E' },
    { id: 'P2', label: 'P2', boss: 'P' },
  ],
  '7-5': [
    { id: 'P1', label: 'P1', boss: 'K' },
    { id: 'P2', label: 'P2', boss: 'Q' },
    { id: 'P3', label: 'P3', boss: 'T' },
  ],
}

function phaseOptionsForMap(mapId) {
  return MAP_PHASES[mapId] || []
}

function phaseOptionForMap(mapId, phaseId) {
  return phaseOptionsForMap(mapId).find((phase) => phase.id === phaseId) || phaseOptionsForMap(mapId)[0] || null
}

function phaseFlags(mapId, phaseId) {
  const flags = {}
  if (mapId === '7-3') flags.phase1 = phaseId === 'P1'
  if (mapId === '5-6') flags.qRoutes = phaseId === 'P3'
  return flags
}

const {
  evaluateMap,
  evaluatePredicate,
  fleetContextFromState,
  formatPercent,
  mapNodeLabel,
  normalizeMapId,
  normalizeOutcomes,
  predicateLabel,
} = require('./logic')

let poiGetSaku33 = null
let poiGetTyku = null
try {
  ;({ getSaku33: poiGetSaku33, getTyku: poiGetTyku } = require('views/utils/game-utils'))
} catch (_) {
  // The standalone test harness does not load poi's path aliases.
}

const h = React.createElement
const listeners = new Set()
const pluginState = {
  currentMapId: null,
  currentNode: null,
  passedNodes: [],
}
function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const NODE_DEFAULTS = {
  color: 'black',
  strokeColor: '#eee9',
  fontSize: 16,
  stroke: 2,
  textOffsetX: 0,
  textOffsetY: 1.8,
  offsetX: 0,
  offsetY: 0,
  offsetX2: 0,
  offsetY2: 0,
  simpleSize: 1.5,
  width: 1.5,
  height: 1.5,
  opacity: 1,
  opacity2: 1,
  background: '#dddddd',
  border: '#999999',
}

function nodeVisualStyle(nodeInfo = {}) {
  const style = { ...NODE_DEFAULTS, ...nodeInfo }
  const size = Number.isFinite(Number(style.size)) ? Number(style.size) : Number(style.simpleSize)
  const width = Number.isFinite(Number(nodeInfo.width))
    ? Number(nodeInfo.width)
    : Number.isFinite(Number(nodeInfo.size)) ? size : Number(style.width)
  const height = Number.isFinite(Number(nodeInfo.height))
    ? Number(nodeInfo.height)
    : Number.isFinite(Number(nodeInfo.size)) ? size : Number(style.height)
  const diameter = ((width + height) / 2) * 10
  return {
    ...style,
    rx: diameter,
    ry: diameter,
    // KCNav offsets position sprites, not the circles rendered here.
    offsetX: 0,
    offsetY: 0,
    offsetX2: Number(style.offsetX2) || 0,
    offsetY2: Number(style.offsetY2) || 0,
    textOffsetX: Number(style.textOffsetX) || 0,
    textOffsetY: Number(style.textOffsetY) || 0,
  }
}

function getStore(pathName) {
  if (typeof window !== 'undefined' && typeof window.getStore === 'function') {
    return window.getStore(pathName)
  }
  const root = store && typeof store.getState === 'function' ? store.getState() : null
  if (!pathName) return root
  return String(pathName)
    .split('.')
    .reduce((value, key) => (value == null ? undefined : value[key]), root)
}

function getRootState() {
  if (typeof window !== 'undefined' && typeof window.getStore === 'function') {
    return window.getStore() || {}
  }
  return store && typeof store.getState === 'function' ? store.getState() : {}
}

function getFleet(state, deckId = 1) {
  const fleets = state?.info?.fleets
  if (Array.isArray(fleets)) return fleets[deckId - 1] || null
  return fleets?.[deckId - 1] || fleets?.[deckId] || null
}

function escapedShipIds(state) {
  const sortieStatus = state?.sortie?.sortieStatus
  const escapedPos = state?.sortie?.escapedPos
  const fleets = state?.info?.fleets
  if (!Array.isArray(sortieStatus) || !Array.isArray(escapedPos) || !Array.isArray(fleets)) return new Set()
  const sortieShipIds = []
  sortieStatus.forEach((active, index) => {
    if (!active || !Array.isArray(fleets[index]?.api_ship)) return
    sortieShipIds.push(...fleets[index].api_ship)
  })
  return new Set(
    escapedPos
      .map((position) => sortieShipIds[number(position)])
      .filter((shipId) => number(shipId) > 0)
      .map((shipId) => number(shipId)),
  )
}

function calculatePoiFleetStat(state, deckId = 1, mapModifier = 1, air = false) {
  if (typeof (air ? poiGetTyku : poiGetSaku33) !== 'function') return null
  const fleet = getFleet(state, deckId)
  const escaped = escapedShipIds(state)
  const shipIds = Array.isArray(fleet?.api_ship)
    ? fleet.api_ship.filter((id) => number(id) > 0 && !escaped.has(number(id)))
    : []
  if (!fleet || !shipIds.length) return null

  const ships = state?.info?.ships || {}
  const masterShips = state?.const?.$ships || {}
  const equips = state?.info?.equips || {}
  const masterEquips = state?.const?.$equips || {}
  const shipsData = []
  const equipsData = []

  for (const shipId of shipIds) {
    const ship = ships[shipId]
    const masterShip = masterShips[ship?.api_ship_id]
    if (!ship || !masterShip) return null
    shipsData.push([ship, masterShip])

    if (!Array.isArray(ship.api_slot) || !Array.isArray(ship.api_onslot)) return null
    if (!Number.isFinite(Number(ship.api_slotnum))) return null
    const slotIds = [...ship.api_slot, ship.api_slot_ex ?? -1].map((id) => number(id))
    const onslots = [...ship.api_onslot, 0]
    const shipEquips = []
    for (let index = 0; index < slotIds.length; index += 1) {
      const equipId = slotIds[index]
      if (equipId <= 0) {
        shipEquips.push(undefined)
        continue
      }
      const equip = equips[equipId]
      const masterEquip = masterEquips[equip?.api_slotitem_id]
      if (!equip || !masterEquip) return null
      shipEquips.push([equip, masterEquip, onslots[index]])
    }
    const slotCount = Number(ship.api_slotnum)
    equipsData.push(shipEquips.length > slotCount
      ? [...shipEquips.slice(0, slotCount), shipEquips[shipEquips.length - 1]]
      : shipEquips)
  }

  if (air) return poiGetTyku(equipsData)
  const commanderLevel = state?.info?.basic?.api_level
  if (!Number.isFinite(Number(commanderLevel))) return null
  const slotCount = Array.isArray(fleet.api_ship) ? fleet.api_ship.length : 6
  return poiGetSaku33(shipsData, equipsData, Number(commanderLevel), Number(mapModifier), slotCount)
}

function calculatePoiLos33(state, deckId = 1, mapModifier = 1) {
  return calculatePoiFleetStat(state, deckId, mapModifier)
}

function notify() {
  listeners.forEach((listener) => listener())
}

function kcnavNodeTypesFromMap(map) {
  const nodeValues = {}
  Object.keys(map?.spots || {}).forEach((node) => { nodeValues[node] = -1 })
  const route = map?.route || {}
  Object.keys(route).forEach((key) => {
    const entry = route[key] || []
    const startNode = entry[0]
    const endNode = entry[1]
    const nodeType = Number(entry[2])
    const hasNodeType = Number.isFinite(nodeType)
    const leading = Object.keys(route).filter((routeKey) => route[routeKey]?.[1] === endNode)
    if (
      (leading.length === 1 && startNode === null && map?.spots?.[endNode]?.[2] === 'Start')
      || (hasNodeType && nodeType !== -1 && nodeType !== 0)
    ) {
      nodeValues[endNode] = Number.isFinite(nodeType) ? nodeType : -1
    }
  })
  return nodeValues
}

function localKcnavAssetUrl(relativePath) {
  return pathToFileURL(path.join(LOCAL_KCNAV_ASSET_ROOT, relativePath)).toString()
}

function nodeIconUrl(icon) {
  if (icon == null) return null
  const value = String(icon)
  if (/^\d+$/.test(value)) {
    const directory = value === '19' ? 'map_common' : 'map_main'
    return localKcnavAssetUrl(`icons/${directory}/${value}.png`)
  }
  if (/^\w+\/\d+$/.test(value)) return localKcnavAssetUrl(`icons/${value}.png`)
  return null
}

function localNodeTypesForMap(mapId, mapDefinition) {
  const nodeTypes = { ...(localKcnavNodeTypes[mapId] || {}) }
  if (mapDefinition?.start) nodeTypes[mapDefinition.start] = 0
  if (mapDefinition?.boss && nodeTypes[mapDefinition.boss] == null) nodeTypes[mapDefinition.boss] = 5
  ;(mapDefinition?.manualNodes || []).forEach((node) => {
    if (nodeTypes[node] == null || nodeTypes[node] === -1) nodeTypes[node] = 91
  })
  return nodeTypes
}

function mapIdFromPair(area, mapNo) {
  const normalizedArea = number(area)
  const normalizedMapNo = number(mapNo)
  return normalizedArea > 0 && normalizedMapNo > 0 ? `${normalizedArea}-${normalizedMapNo}` : null
}

function mapIdFromDetail(detail) {
  const postBody = detail?.postBody || {}
  const body = detail?.body || {}
  return normalizeMapId(
    postBody.api_map_id || body.api_map_id || mapIdFromPair(postBody.api_maparea_id, postBody.api_mapinfo_no) || mapIdFromPair(body.api_maparea_id, body.api_mapinfo_no),
  )
}

function cellFromDetail(detail) {
  const body = detail?.body || {}
  const postBody = detail?.postBody || {}
  const candidates = [body.api_no, body.api_cell_id, body.api_map_next, body.api_next, postBody.api_no]
  const cell = candidates.find((value) => value != null && Number.isFinite(Number(value)) && Number(value) >= 0)
  return cell == null ? null : number(cell)
}

function updateSortieState(detail) {
  const mapId = mapIdFromDetail(detail) || pluginState.currentMapId
  if (!mapId) return
  if (pluginState.currentMapId !== mapId) pluginState.passedNodes = []
  const maps = getStore('fcd.map') || {}
  const cell = cellFromDetail(detail)
  const node = cell == null ? null : mapNodeLabel(mapId, cell, maps)
  pluginState.currentMapId = mapId
  if (node) {
    pluginState.currentNode = node
    if (pluginState.passedNodes.at(-1) !== node) pluginState.passedNodes.push(node)
  }
  notify()
}

function handleGameResponse(event) {
  const detail = event?.detail || {}
  const pathName = detail.path || ''
  if (pathName === '/kcsapi/api_req_map/start') {
    pluginState.currentNode = null
    pluginState.passedNodes = []
    updateSortieState(detail)
  } else if (pathName === '/kcsapi/api_req_map/next') {
    updateSortieState(detail)
  } else if (pathName === '/kcsapi/api_port/port') {
    pluginState.currentNode = null
    pluginState.passedNodes = []
    // Redux subscription also catches the committed port payload. Defer this
    // explicit refresh so a synchronous game.response handler cannot read old state.
    queueMicrotask(notify)
  }
}

function startPlugin() {
  pluginState.currentMapId = normalizeMapId(
    getStore('sortie.sortieMapId') || getStore('sortie.mapId') || getStore('info.sortieMapId'),
  )
  pluginState.passedNodes = []
  if (typeof window !== 'undefined') window.addEventListener('game.response', handleGameResponse)
}

function stopPlugin() {
  if (typeof window !== 'undefined') window.removeEventListener('game.response', handleGameResponse)
  listeners.clear()
}

function mapGeometry(mapId) {
  const maps = getStore('fcd.map') || {}
  return maps[mapId] || null
}

function mapNodes(mapDefinition, geometry) {
  const nodes = new Set([mapDefinition.start])
  Object.keys(geometry?.spots || {}).forEach((node) => nodes.add(node))
  ;(mapDefinition.rules || []).forEach((rule) => {
    nodes.add(rule.node)
    ;(rule.outcomes || []).forEach((outcome) => nodes.add(outcome.to))
  })
  ;(mapDefinition.manualNodes || []).forEach((node) => nodes.add(node))
  Object.values(mapDefinition.manualOutcomes || {}).forEach((outcomes) => {
    ;(outcomes || []).forEach((outcome) => nodes.add(outcome.to))
  })
  return Array.from(nodes)
}

function mapGeometryAvailable(mapDefinition, geometry) {
  const spots = geometry?.spots || {}
  const route = geometry?.route || {}
  if (!Object.keys(spots).length || !Object.keys(route).length) return false
  return mapNodes(mapDefinition, geometry).every((node) => {
    const spot = spots[node]
    return Array.isArray(spot) && Number.isFinite(Number(spot[0])) && Number.isFinite(Number(spot[1]))
  })
}

function positionsForNodes(nodes, geometry) {
  const spots = geometry?.spots || {}
  const position = {}
  nodes.forEach((node, index) => {
    const spot = spots[node]
    position[node] = Array.isArray(spot) && Number.isFinite(Number(spot[0]))
      ? { x: number(spot[0]), y: number(spot[1]) }
      : { x: 80 + (index % 5) * 170, y: 90 + Math.floor(index / 5) * 100 }
  })
  return position
}

function routeEdges(geometry) {
  return Object.entries(geometry?.route || {})
    .map(([cell, value]) => ({ cell: number(cell), from: value?.[0], to: value?.[1] }))
    .filter((edge) => edge.from && edge.to)
}

function outcomeText(outcome) {
  return `${outcome.to} ${formatPercent(outcome.probability, outcome.estimated)}`
}

function conditionIcon(status, active) {
  if (active) return '✓'
  if (status === 'true') return '•'
  if (status === 'false') return '×'
  return '?'
}

function conditionStatus(status) {
  return {
    true: '满足',
    false: '不满足',
    unknown: '无法判断',
  }[status] || status
}

function ruleRows(mapDefinition, node, context) {
  return (mapDefinition.rules || [])
    .filter((rule) => rule.node === node)
    .sort((left, right) => number(left.priority) - number(right.priority))
    .map((rule) => ({
      rule,
      result: evaluatePredicate(rule.predicate, context),
      outcomes: normalizeOutcomes(rule.outcomes, rule),
    }))
}

function fleetSummary(context) {
  const summaryCategories = ['BB', 'BBV', 'CV', 'CVL', 'CA', 'CAV', 'CL', 'CLT', 'CT', 'DD', 'DE', 'SS', 'AO', 'AV', 'LHA', 'AR', 'AS']
  const entries = summaryCategories
    .map((category) => [category, context.counts?.[category]])
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${count}${category}`)
  return entries.length ? entries.join(' ') : '—'
}

function formatLosScore(value) {
  if (!Number.isFinite(Number(value))) return '—'
  return Number(value).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function edgeProbability(evaluation, from, to) {
  const decision = evaluation.decisions[from]
  const outcome = decision?.outcomes?.find((entry) => entry.to === to)
  const baseOutcome = decision?.baseOutcomes?.find((entry) => entry.to === to)
    || decision?.manualOutcomes?.find((entry) => entry.to === to)
  const known = outcome || baseOutcome
  const edgeMass = evaluation.probability.edgeMass[`${from}->${to}`]
  return {
    local: outcome?.probability ?? (known ? 0 : undefined),
    global: Number.isFinite(Number(edgeMass)) ? Number(edgeMass) : known ? 0 : undefined,
    estimated: known?.estimated === true || evaluation.probability.estimatedEdges.includes(`${from}->${to}`),
  }
}

function probabilityTier(value) {
  if (!Number.isFinite(Number(value))) return ''
  if (Number(value) === 0) return 'is-probability-zero'
  if (Number(value) >= 0.75) return 'is-probability-high'
  if (Number(value) >= 0.4) return 'is-probability-medium'
  return 'is-probability-low'
}

function mapBackgroundUrl(mapId) {
  return localKcnavAssetUrl(`maps/${mapId}.webp`)
}

function passedEdgeKeys(passedNodes) {
  const keys = new Set()
  for (let index = 1; index < passedNodes.length; index += 1) {
    keys.add(`${passedNodes[index - 1]}->${passedNodes[index]}`)
  }
  return keys
}

function manualSourceForTarget(evaluation, target) {
  return Object.keys(evaluation.decisions).find((source) => {
    const decision = evaluation.decisions[source]
    const manualOutcomes = decision?.manualOutcomes || decision?.baseOutcomes || []
    return decision?.manual && manualOutcomes.some((outcome) => outcome.to === target)
  }) || null
}

class Compass extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      deckId: 1,
      mapId: pluginState.currentMapId && mapCatalog.maps[pluginState.currentMapId]
        ? pluginState.currentMapId
        : mapIds[0],
      phaseId: phaseOptionsForMap(mapIds[0])[0]?.id || null,
      selectedNode: pluginState.currentNode || null,
      overrides: {},
      exportOpen: false,
      exportRoute: null,
      exportEnemies: {},
      exportFormations: {},
      exportError: null,
      exportBusy: false,
    }
    this.refresh = () => this.forceUpdate()
  }

  componentDidMount() {
    listeners.add(this.refresh)
    const snapshot = () => {
      const root = getRootState()
      return [root.info?.fleets, root.info?.ships, root.info?.equips, root.info?.basic, root.info?.server, root.const, root.sortie, root.fcd]
    }
    let previous = snapshot()
    this.unsubscribeStore = store?.subscribe?.(() => {
      const next = snapshot()
      if (next.some((value, index) => value !== previous[index])) {
        previous = next
        this.refresh()
      }
    })
    this.refresh()
  }

  componentWillUnmount() {
    listeners.delete(this.refresh)
    this.unsubscribeStore?.()
    this.unsubscribeStore = null
  }

  selectMap(mapId) {
    this.setState({
      mapId,
      phaseId: phaseOptionsForMap(mapId)[0]?.id || null,
      selectedNode: null,
      overrides: {},
      exportRoute: null,
      exportEnemies: {},
      exportFormations: {},
      exportError: null,
    })
  }

  renderMapSelector() {
    return h('details', {
      className: 'compass-map-select',
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
      },
      onKeyDown: (event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false
          event.currentTarget.querySelector('summary').focus()
        }
      },
    },
    h('summary', { 'aria-label': '选择海域', title: mapCatalog.maps[this.state.mapId].name }, this.state.mapId),
    h('div', { className: 'compass-map-matrix', 'aria-label': '通常海域' },
      ...mapAreas.map(([area, name]) => h('div', {
        key: area, className: 'compass-map-matrix-row', role: 'group', 'aria-label': `${name}海域`,
      },
      h('span', { className: 'compass-map-area' }, name),
      ...mapIds.filter((id) => id.startsWith(`${area}-`)).map((id) => h('button', {
        key: id,
        type: 'button',
        style: { gridColumn: Number(id.split('-')[1]) + 1 },
        className: this.state.mapId === id ? 'is-active' : '',
        'aria-pressed': this.state.mapId === id,
        'aria-label': `${id} ${mapCatalog.maps[id].name}`,
        title: mapCatalog.maps[id].name,
        onClick: (event) => {
          this.selectMap(id)
          const picker = event.currentTarget.closest('details')
          picker.open = false
          picker.querySelector('summary').focus()
        },
      }, id)),
      )),
    ))
  }

  selectPhase(phaseId) {
    this.setState({ phaseId, selectedNode: null, overrides: {}, exportRoute: null, exportEnemies: {}, exportFormations: {}, exportError: null })
  }

  selectNode(node) {
    this.setState({ selectedNode: node })
  }

  selectFleet(deckId) {
    this.setState({ deckId, selectedNode: null, overrides: {}, exportRoute: null, exportEnemies: {}, exportFormations: {}, exportError: null })
  }

  renderLosIcons(scores) {
    const { SlotitemIcon } = require('views/components/etc/icon')
    return h('span', { className: 'compass-los-icons', 'aria-label': '33式索敌' },
      ...scores.map((score, index) => {
        const label = `33式索敌 · 系数 ${index + 1}：${formatLosScore(score)}`
        return h('span', { key: index, className: 'compass-los-item', title: label, 'aria-label': label },
          h('span', { className: 'compass-los-icon' }, h(SlotitemIcon, { slotitemId: 11 }),
            h('span', { className: 'compass-los-coefficient', 'aria-hidden': true }, index + 1)),
          h('span', { className: 'compass-los-value' }, formatLosScore(score)))
      }))
  }

  renderFleetAir(air) {
    if (!air || !Number.isFinite(air.min) || !Number.isFinite(air.max) || air.max <= 0) return null
    return h('span', { className: 'compass-fleet-air', title: 'poi 当前舰队制空（熟练度范围）' },
      `制空 ${air.min === air.max ? air.min : `${air.min}～${air.max}`}`)
  }

  setManualOverride(node, to) {
    this.setState((state) => ({
      overrides: { ...state.overrides, [node]: to },
      selectedNode: node,
      exportRoute: null,
      exportError: null,
    }))
  }

  renderMap(mapDefinition, geometry, evaluation, selectedNode, currentNode, passedNodes = [], mapId = null) {
    if (!mapGeometryAvailable(mapDefinition, geometry)) {
      return h('div', { className: 'compass-empty-panel' }, 'poi 地图数据不可用')
    }
    const nodes = mapNodes(mapDefinition, geometry)
    const positions = positionsForNodes(nodes, geometry)
    const edges = routeEdges(geometry)
    const passedEdges = passedEdgeKeys(passedNodes)
    const nodeTypes = localNodeTypesForMap(mapId, mapDefinition)
    const airPower = calculatePoiFleetStat(getRootState(), this.state.deckId, 1, true)
    const width = Math.max(1200, ...Object.values(positions).map((position) => position.x + 100))
    const height = Math.max(720, ...Object.values(positions).map((position) => position.y + 100))
    return h(
      'svg',
      { className: 'compass-map', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${mapDefinition.name} 路线图`,
        onClick: event => { if (!event.target.closest('.compass-node, .compass-edge')) this.selectNode(null) } },
      mapId
        ? h('image', {
          className: 'compass-map-background',
          href: mapBackgroundUrl(mapId),
          x: 0,
          y: 0,
          width: 1200,
          height: 720,
          preserveAspectRatio: 'none',
          'aria-hidden': 'true',
        })
        : null,
      ...edges.map((edge) => {
        const from = positions[edge.from]
        const to = positions[edge.to]
        if (!from || !to) return null
        const probability = edgeProbability(evaluation, edge.from, edge.to)
        const manualOutcomes = evaluation.decisions[edge.from]?.manualOutcomes
          || evaluation.decisions[edge.from]?.baseOutcomes
          || []
        const manualChoice = evaluation.decisions[edge.from]?.manual
          && manualOutcomes.some((outcome) => outcome.to === edge.to)
        const edgeClassNames = [
          'compass-edge',
          probability.global != null ? 'is-reachable' : '',
          probability.estimated ? 'is-estimated' : '',
          probabilityTier(probability.global),
          passedEdges.has(`${edge.from}->${edge.to}`) ? 'is-passed' : '',
          manualChoice ? 'is-manual-choice' : '',
        ].filter(Boolean).join(' ')
        const activateEdge = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            this.setManualOverride(edge.from, edge.to)
          }
        }
        return h('g', {
          key: `edge-${edge.cell}`,
          className: edgeClassNames,
          role: manualChoice ? 'button' : undefined,
          tabIndex: manualChoice ? 0 : undefined,
          onClick: manualChoice ? () => this.setManualOverride(edge.from, edge.to) : undefined,
          onKeyDown: manualChoice ? activateEdge : undefined,
        },
          h('line', {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
          }),
          probability.global != null && Number(probability.global) > 0
            ? h('text', {
              x: (from.x + to.x) / 2,
              y: (from.y + to.y) / 2,
              dominantBaseline: 'middle',
              className: 'compass-edge-label',
            }, formatPercent(probability.global, probability.estimated))
            : null,
          probability.global != null && Number(probability.global) > 0
            ? h('title', null, manualChoice
              ? `能动分歧：选择 ${edge.to}`
              : `局部 ${formatPercent(probability.local, probability.estimated)}`)
            : null,
        )
      }),
      ...nodes.map((node) => {
        const position = positions[node]
        const nodeType = nodeTypes[node]
        const nodeInfo = nodeType == null
          ? kcnavNodeCatalog['-1']
          : kcnavNodeCatalog[String(nodeType)] || kcnavNodeCatalog['-1']
        const visual = nodeVisualStyle(nodeInfo)
        const airState = evaluation.probability.reach[node] > 0 && [4, 5, 7, 10, 15].includes(nodeType)
          ? airStateRange(airPower, loadEnemies(mapId, node)) : null
        const centerX = position.x + visual.offsetX
        const centerY = position.y + visual.offsetY
        const manualSource = manualSourceForTarget(evaluation, node)
        const manualTarget = manualSource && manualSource !== node
        const classNames = [
          'compass-node',
          nodeInfo?.className || '',
          node === selectedNode ? 'is-selected' : '',
          node === currentNode ? 'is-current' : '',
          nodeType === 5 ? 'is-boss' : '',
          manualTarget ? 'is-manual-target' : '',
        ].filter(Boolean).join(' ')
        const activateNode = (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (manualTarget) this.setManualOverride(manualSource, node)
          else this.selectNode(node)
        }
        return h('g', {
          key: `node-${node}`,
          className: classNames,
          role: 'button',
          tabIndex: 0,
          onClick: () => manualTarget ? this.setManualOverride(manualSource, node) : this.selectNode(node),
          onKeyDown: activateNode,
        },
        h('title', null, nodeInfo?.label ? `${node} · ${nodeInfo.label}` : node),
        h('ellipse', {
          className: 'compass-node-shape',
          cx: centerX,
          cy: centerY,
          rx: visual.rx,
          ry: visual.ry,
          fill: visual.background,
          stroke: visual.border,
          strokeWidth: visual.stroke,
          opacity: visual.opacity,
        }),
        visual.simpleBorder
          ? h('ellipse', {
            className: 'compass-node-simple-border',
            cx: centerX,
            cy: centerY,
            rx: visual.rx + 2,
            ry: visual.ry + 2,
            stroke: visual.simpleBorder,
            strokeWidth: 2,
            opacity: visual.opacity,
          })
          : null,
        h('text', {
          x: centerX,
          y: centerY + visual.textOffsetY,
          dominantBaseline: 'middle',
          className: 'compass-node-label',
          style: {
            fill: '#ffffff',
            stroke: '#000000',
            strokeWidth: Math.min(4, Math.max(2, Number(visual.fontSize) / 5)),
            fontSize: visual.fontSize,
          },
        }, node),
        airState ? h('text', { x: centerX, y: centerY + visual.ry + 21, className: 'compass-node-air-state', textAnchor: 'middle' },
          h('title', null, `当前舰队制空 ${airPower.min}～${airPower.max}；未计沿途损耗、陆航和支援${airState.uncertain ? '；敌编成数据不完整或不确定' : ''}`),
          ...airState.states.flatMap((state, index) => [
            index ? h('tspan', { key: 'separator', fill: '#ffffff' }, '/') : null,
            h('tspan', { key: state.label, fill: state.color }, state.label),
          ]), airState.uncertain ? '？' : null) : null,
        )
      }),
    )
  }

  async openSimulator(target, rootState, battles) {
    this.setState({ exportBusy: true, exportError: null })
    try {
      const url = target === 'kc3'
        ? await kc3Url(kc3Save(rootState, this.state.mapId, battles, this.state.exportFormations, this.state.deckId))
        : noroUrl(noroDeck(rootState, this.state.mapId, battles, this.state.exportEnemies, this.state.exportFormations, this.state.deckId))
      await require('electron').shell.openExternal(url)
    } catch (error) {
      this.setState({ exportError: error.message || String(error) })
    } finally {
      this.setState({ exportBusy: false })
    }
  }

  renderShipPortrait(masterId, name, rootState, size = 34) {
    const { getShipImgPath } = require('views/utils/ship-img')
    const enemy = masterId >= 1500
    // poi prefers cached files, then uses the player's game server.
    const server = rootState?.info?.server?.ip
    const version = rootState?.const?.$shipgraph?.find(graph => graph.api_id === masterId)?.api_version?.[0]
    const url = getShipImgPath(masterId, enemy ? 'banner' : 'remodel', false, server, version)
    const available = /^(file:|https?:\/\/)/.test(url)
    const offset = enemy ? 1.5 : rootState?.fcd?.shipavatar?.marginMagics?.[masterId]?.normal ?? 0.555
    return h('span', { className: 'compass-portrait', title: `${name} #${masterId}`, role: 'img', 'aria-label': `${name} #${masterId}`,
      style: { width: size, height: size } },
    available ? h('img', { src: url, alt: '', style: { height: Math.round(size * 182 / 176), marginLeft: -Math.round((offset + 0.25) * size) } })
      : h('span', { className: 'compass-portrait-missing' }, `#${masterId}`))
  }

  renderExportPanel(definition, geometry, context, rootState) {
    if (!this.state.exportOpen) return null
    let choices, route, battles, error
    try {
      if (!context.dataAvailable || !mapGeometryAvailable(definition, geometry)) throw new Error('poi 数据不可用')
      choices = enumerateRoutes(definition, geometry, context, this.state.overrides)
      route = choices.routes.find((candidate) => candidate.key === this.state.exportRoute) || choices.routes[0]
      if (!route) throw new Error('暂无可导出的完整路线，请先确认带路条件')
      battles = battleNodes(this.state.mapId, route, geometry)
    } catch (caught) { error = caught.message }
    const ready = battles?.length && battles.every((battle) => battle.rows.length)
    return h('section', { className: 'compass-panel compass-export-panel' },
      h('div', { className: 'compass-panel-heading' }, h('h4', null, '导出模拟器'),
        h('button', { type: 'button', className: 'compass-reset', 'aria-label': '关闭导出', onClick: () => this.setState({ exportOpen: false }) }, '关闭')),
      error ? h('div', { className: 'compass-warnings' }, error) : null,
      route ? h('label', { className: 'compass-export-route' }, '路线',
        h('select', { value: route.key, 'aria-label': '导出路线', onChange: (event) => this.setState({ exportRoute: event.target.value, exportError: null }) },
          ...choices.routes.map((candidate) => h('option', { key: candidate.key, value: candidate.key },
            `${candidate.nodes.join('→')}${candidate.boss ? ' · Boss' : ''} · ${candidate.probability == null ? '含能动选路' : formatPercent(candidate.probability, candidate.estimated)}`))),
      ) : null,
      choices?.blocked.length ? h('div', { className: 'compass-warnings' }, `未知分歧：${choices.blocked.join('、')}`) : null,
      battles?.length ? h('div', { className: 'compass-export-battles' },
        h('div', { className: 'compass-export-battle compass-muted' }, h('span', null, '节点'), h('span', null, '我方阵型'), h('span', null, 'noro6 敌编成')),
        ...battles.map((battle) => h('div', { key: battle.node, className: 'compass-export-battle' },
          h('strong', null, battle.node),
          h('select', { 'aria-label': `${battle.node} 我方阵型`, value: this.state.exportFormations[battle.node] || battle.formation,
            onChange: (event) => this.setState({ exportFormations: { ...this.state.exportFormations, [battle.node]: Number(event.target.value) }, exportError: null }) },
          ...[1, 2, 3, 4, 5, 6].map((id) => h('option', { key: id, value: id }, formationLabel(id)))),
          battle.rows.length ? h('select', { 'aria-label': `${battle.node} noro6 敌编成`,
            value: battle.rows.some((entry) => compositionKey(entry) === this.state.exportEnemies[battle.node]) ? this.state.exportEnemies[battle.node] : compositionKey(battle.rows[0]),
            onChange: (event) => this.setState({ exportEnemies: { ...this.state.exportEnemies, [battle.node]: event.target.value }, exportError: null }) },
          ...battle.rows.map((entry) => h('option', { key: compositionKey(entry), value: compositionKey(entry) },
            `${(entry.share * 100).toFixed(1)}% · ${formationLabel(entry.formation)} · ${entry.mainFleet.map((ship) => `${ship.name} #${ship.id}`).join(' / ')}${entry.escortFleet.length ? ' + 护卫舰队' : ''}`)))
            : h('span', { className: 'compass-muted' }, '尚未缓存／本月无样本'),
        )),
      ) : null,
      h('div', { className: 'compass-export-actions' },
        h('button', { type: 'button', disabled: !ready || this.state.exportBusy, onClick: () => this.openSimulator('kc3', rootState, battles) }, 'KC3Kai'),
        h('button', { type: 'button', disabled: !ready || this.state.exportBusy, onClick: () => this.openSimulator('noro', rootState, battles) }, 'noro6'),
      ),
      route?.nodes.some((node) => localKcnavNodeTypes[this.state.mapId]?.[node] === 3)
        ? h('div', { className: 'compass-warnings' }, '漩涡损耗未设置') : null,
      this.state.exportError ? h('div', { className: 'compass-warnings', role: 'alert' }, this.state.exportError) : null,
    )
  }

  renderEnemyPanel(mapId, node) {
    if (!node) return null
    const type = localNodeTypesForMap(mapId, mapCatalog.maps[mapId])[node]
    if (!kcnavNodeCatalog[type]?.hasEnemies) return null
    const data = loadEnemies(mapId, node)
    const heading = h('h4', null, `${node} 点 · 敌舰编成`)
    if (data.status !== 'ready') return h('section', { className: 'compass-panel' }, heading,
      h('div', { className: 'compass-muted' }, data.status === 'invalid' ? '敌编成缓存不可用' : '敌编成尚未缓存'))
    const rangeText = (range) => !range ? '—' : range[0] === range[1] ? String(range[0]) : range.join('～')
    const airText = (air) => air ? `劣势 ${air.disadvantage} / 均势 ${air.parity} / 空优 ${air.superiority} / 空确 ${air.supremacy}` : '制空未知'
    const masters = getRootState()?.const || {}
    const shipName = (ship) => {
      const master = masters.$ships?.[ship.id]
      if (!master) return `${ship.name || '敌舰'} #${ship.id}`
      const rank = /^(elite|flagship)$/i.test(master.api_yomi) ? ` ${master.api_yomi}` : ''
      return `${master.api_name}${rank}`
    }
    const equipName = (id) => masters.$equips?.[id]?.api_name || `#${id}`
    return h('section', { className: 'compass-panel compass-enemies' }, heading,
      data.rows.length ? h('div', { className: 'compass-enemy-air-range' }, `空优 ${rangeText(data.superiority)} / 空确 ${rangeText(data.supremacy)}${data.uncertain ? '？' : ''}`) : null,
      !data.rows.length ? h('div', { className: 'compass-muted' }, '此期间无记录') : null,
      h('div', { className: 'compass-enemy-list' }, ...data.rows.map((entry, index) => {
        const fleet = [...entry.mainFleet, ...entry.escortFleet]
        const share = entry.share == null ? '—' : `${(entry.share * 100).toFixed(1)}%`
        return h('details', { className: 'compass-enemy-entry', key: `${entry.masterId}-${entry.formation}-${index}` },
          h('summary', { title: `${airText(entry.thresholds)}${entry.uncertain ? ' · 装备不确定' : ''}` },
            h('span', { className: 'compass-enemy-share' }, share),
            h('span', null, formationLabel(entry.formation)),
            h('span', { className: 'compass-enemy-fleet' }, ...fleet.map((ship, shipIndex) => h('span', {
              key: shipIndex, className: 'compass-enemy-ship',
              style: { gridColumn: shipIndex < entry.mainFleet.length ? shipIndex + 1 : shipIndex - entry.mainFleet.length + 1, gridRow: shipIndex < entry.mainFleet.length ? 1 : 2 },
              title: shipIndex >= entry.mainFleet.length ? '护卫舰队' : '主力舰队',
            }, this.renderShipPortrait(ship.id, shipName(ship), getRootState())))),
            h('span', { className: 'compass-enemy-air' }, `空优 ${entry.thresholds?.superiority ?? '—'} / 空确 ${entry.thresholds?.supremacy ?? '—'}${entry.uncertain ? '？' : ''}`),
          ),
          h('div', { className: 'compass-enemy-detail' },
            h('div', null, airText(entry.thresholds)),
            h('div', null, `陆航：${airText(entry.lbasThresholds)}`),
            entry.uncertain ? h('div', null, `装备不确定：${entry.uncertainAirpowerItems.join('、')}`) : null,
            h('div', { className: 'compass-enemy-stats' },
              h('div', { className: 'compass-enemy-stat-row compass-muted' }, ...['', 'HP', '火力', '雷装', '对空', '装甲', '装备'].map((label, i) => h('span', { key: i }, label))),
              ...fleet.map((ship, shipIndex) => h('div', { key: shipIndex, className: `compass-enemy-stat-row${shipIndex === entry.mainFleet.length ? ' is-escort-start' : ''}` },
                this.renderShipPortrait(ship.id, shipName(ship), getRootState()),
                ...['hp', 'fp', 'torp', 'aa', 'armor'].map(field => h('span', { key: field }, ship[field] ?? '—')),
                h('span', { className: 'compass-enemy-equips' }, (ship.equips || []).filter(id => id > 0).map(equipName).join(' / ') || '—'),
              )),
            ),
          ),
        )
      })),
    )
  }

  renderOverview(definition, context, geometryAvailable) {
    if (!context.dataAvailable || !geometryAvailable) return h('section', { className: 'compass-panel' }, 'poi 数据不可用')
    const summary = mapOverview(this.state.mapId, definition, context, this.state.overrides)
    const config = losCatalog.maps[this.state.mapId] || {}
    return h('section', { className: 'compass-panel compass-overview' },
      h('h4', null, `${this.state.mapId} · ${definition.name}`),
      h('dl', null,
        h('dt', null, '最高空优'), h('dd', { className: 'compass-overview-air' }, `${summary.superiority ?? '—'}${summary.missing.length ? '？' : ''}`),
        h('dt', null, '最高空确'), h('dd', { className: 'compass-overview-air' }, `${summary.supremacy ?? '—'}${summary.missing.length ? '？' : ''}`),
        h('dt', null, '最高索敌线'), h('dd', { className: 'compass-overview-los' }, summary.maxLos == null ? '无' : h(React.Fragment, null, summary.maxLos, h('small', null, ` · ${summary.losNodes.join(' / ')}`))),
        summary.maxLos != null ? h(React.Fragment, null,
          h('dt', null, '分歧点系数'), h('dd', null, config.branchingCoefficient ?? '—'),
          h('dt', null, '司令部系数'), h('dd', null, `${config.admiralCoefficient ?? '—'}${config.confidence === 'approximate' ? '？' : ''}`)) : null,
      ),
      summary.partial ? h('div', { className: 'compass-warnings' }, '路线未完整确定') : null,
      summary.missing.length ? h('div', { className: 'compass-warnings' }, `制空数据缺失／不确定：${summary.missing.join('、')}`) : null,
    )
  }

  renderRulePanel(mapDefinition, node, context, evaluation) {
    if (!node) return h('div', { className: 'compass-empty-panel' }, '选择节点')
    const rows = ruleRows(mapDefinition, node, context)
    const decision = evaluation.decisions[node]
    return h('section', { className: 'compass-panel' },
      h('h4', null, `${node} 点`),
      rows.length
        ? h('div', { className: 'compass-conditions' }, ...rows.map(({ rule, result, outcomes: ruleOutcomes }) => {
          const active = decision?.rule?.id === rule.id
          const displayedOutcomes = active ? decision.outcomes : ruleOutcomes
          const outcomes = displayedOutcomes.length ? displayedOutcomes.map(outcomeText).join(' / ') : '—'
          return h('div', {
          key: rule.id,
          className: `compass-condition is-${result.status}${active ? ' is-active' : ''}`,
          tabIndex: 0,
          'aria-label': `${conditionStatus(result.status)}：${predicateLabel(rule.predicate)}`,
        },
          h('span', { className: 'compass-condition-icon', 'aria-hidden': 'true' }, conditionIcon(result.status, active)),
          h('span', { className: 'compass-condition-label' }, predicateLabel(rule.predicate)),
          h('span', { className: 'compass-condition-outcomes' }, outcomes),
          h('div', { className: 'compass-condition-popover', role: 'tooltip' },
            h('div', null, `${conditionStatus(result.status)}${active ? ' · 当前出口规则' : ''}`),
            h('div', null, `出口：${outcomes}`),
            rule.confidence === 'approximate' ? h('div', null, '概率为资料中的近似值') : null,
          ),
        )
        }))
        : h('div', { className: 'compass-muted' }, '暂无规则'),
      decision?.manual
        ? h('div', { className: 'compass-manual' },
          h('strong', null, decision.manualChoiceRequired ? '请指定方向' : '手动覆盖出口'),
          ...((decision.manualOutcomes || decision.baseOutcomes || [])).map((outcome) => h('button', {
            key: outcome.to,
            type: 'button',
            className: decision.manualOverride === outcome.to ? 'is-active' : '',
            onClick: () => this.setManualOverride(node, outcome.to),
          }, outcome.to)),
        )
        : null,
    )
  }

  render() {
    const mapDefinition = mapCatalog.maps[this.state.mapId] || mapCatalog.maps[mapIds[0]]
    const mapLosConfig = losCatalog.maps?.[this.state.mapId] || {}
    const phase = phaseOptionForMap(this.state.mapId, this.state.phaseId)
    const rootState = getRootState()
    const context = fleetContextFromState(rootState, this.state.deckId, {
      losCalculator: calculatePoiLos33,
      losCoefficient: mapLosConfig.branchingCoefficient,
      admiralCoefficient: mapLosConfig.admiralCoefficient,
      passedNodes: pluginState.currentMapId === this.state.mapId ? pluginState.passedNodes : [],
      phase: phase?.id || null,
      flags: phaseFlags(this.state.mapId, phase?.id),
    })
    const geometry = mapGeometry(this.state.mapId)
    const displayMapDefinition = phase?.boss
      ? { ...mapDefinition, start: phase.start || mapDefinition.start, boss: phase.boss }
      : mapDefinition
    const geometryAvailable = mapGeometryAvailable(displayMapDefinition, geometry)
    const evaluation = evaluateMap(displayMapDefinition, context, this.state.overrides)
    const currentNode = pluginState.currentMapId === this.state.mapId ? pluginState.currentNode : null
    const passedNodes = pluginState.currentMapId === this.state.mapId ? pluginState.passedNodes : []
    const mapLosText = mapLosConfig.branchingCoefficient == null
      ? '本图无索敌分歧'
      : `本图分歧点系数 ${mapLosConfig.branchingCoefficient}；司令部系数 ${mapLosConfig.admiralCoefficient}${mapLosConfig.confidence === 'approximate' ? '?' : ''}`
    const nodes = mapNodes(displayMapDefinition, geometry)
    const selectedNode = nodes.includes(this.state.selectedNode)
      ? this.state.selectedNode
      : null
    const cssPath = path.join(__dirname, 'assets', 'compass.css')
    const warnings = [
      context.dataAvailable && geometryAvailable ? null : 'poi 数据不可用',
      !context.dataAvailable && context.dataIssues.length ? context.dataIssues.join('、') : null,
      !geometryAvailable ? '地图几何' : null,
      evaluation.probability.unknownNodes.length ? `未知路线 ${evaluation.probability.unknownNodes.join('、')}` : null,
    ].filter(Boolean)

    return h('div', { className: 'poi-compass' },
      h('link', { rel: 'stylesheet', href: cssPath }),
      h('header', { className: 'compass-titlebar' }, h('h3', null, '舰队罗盘')),
      h('div', { className: 'compass-toolbar' },
        this.renderMapSelector(),
        h('select', { className: 'compass-fleet-select', 'aria-label': '使用舰队', value: this.state.deckId,
          onChange: event => this.selectFleet(Number(event.target.value)) },
          ...[1, 2, 3, 4].map(id => h('option', { key: id, value: id }, `舰队 ${id}`))),
        phaseOptionsForMap(this.state.mapId).length > 1
          ? h('div', { className: 'compass-phase-group', role: 'group', 'aria-label': '地图阶段' },
            phaseOptionsForMap(this.state.mapId).map((option) => h('button', {
              key: option.id,
              type: 'button',
              className: phase?.id === option.id ? 'is-active' : '',
              onClick: () => this.selectPhase(option.id),
            }, option.label)),
          )
          : null,
        h('span', {
          className: 'compass-toolbar-fleet',
          title: `舰队 ${this.state.deckId}：${fleetSummary(context)}；${mapLosText}`,
        }, h('span', { className: 'compass-fleet-portraits' }, ...(getFleet(rootState, this.state.deckId)?.api_ship || []).filter(id => id > 0).map(id => {
          const ship = rootState.info.ships?.[id]
          if (!ship) return null
          const name = rootState.const?.$ships?.[ship.api_ship_id]?.api_name || '舰娘'
          return h('span', { key: id }, this.renderShipPortrait(ship.api_ship_id, name, rootState, 30))
        })), h('span', null, fleetSummary(context))),
        this.renderLosIcons(context.losScores),
        this.renderFleetAir(calculatePoiFleetStat(rootState, this.state.deckId, 1, true)),
        currentNode ? h('span', { className: 'compass-toolbar-node' }, `当前 ${currentNode}`) : null,
        h('button', { type: 'button', className: 'compass-reset', 'aria-expanded': this.state.exportOpen, onClick: () => this.setState({ exportOpen: !this.state.exportOpen }) }, '导出'),
        h('button', { type: 'button', className: 'compass-reset', onClick: () => this.setState({ overrides: {} }) }, '重置路线'),
      ),
      warnings.length ? h('div', { className: 'compass-warnings' }, ...warnings.map((warning) => h('div', { key: warning }, warning))) : null,
      h('main', { className: 'compass-layout' },
        h('section', { className: 'compass-map-panel' }, this.renderMap(displayMapDefinition, geometry, evaluation, selectedNode, currentNode, passedNodes, this.state.mapId)),
        h('aside', { className: 'compass-sidebar' },
          this.state.exportOpen
            ? this.renderExportPanel(displayMapDefinition, geometry, context, rootState)
            : selectedNode
              ? this.renderRulePanel(mapDefinition, selectedNode, context, evaluation)
              : this.renderOverview(displayMapDefinition, context, geometryAvailable),
        ),
      ),
      h('div', { className: 'compass-enemy-region' }, this.renderEnemyPanel(this.state.mapId, selectedNode)),
    )
  }
}

exports.reactClass = Compass
exports.windowMode = true
exports.pluginDidLoad = startPlugin
exports.pluginWillUnload = stopPlugin
exports.__test = {
  calculatePoiLos33,
  cellFromDetail,
  handleGameResponse,
  kcnavNodeTypesFromMap,
  localNodeTypesForMap,
  mapIdFromDetail,
  mapGeometryAvailable,
  mapBackgroundUrl,
  mapIds,
  mapNodes,
  nodeVisualStyle,
  nodeIconUrl,
  losConfig: losCatalog.maps,
  phaseOptionsForMap,
  pluginState,
  routeEdges,
}
