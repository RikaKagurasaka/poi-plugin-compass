'use strict'

const path = require('path')
const React = require('react')
const { store } = require('views/create-store')
const primaryMapCatalog = require('./data/maps.json')
const normalMapCatalog = require('./data/normal-maps.json')
const mapCatalog = {
  ...normalMapCatalog,
  ...primaryMapCatalog,
  maps: { ...normalMapCatalog.maps, ...primaryMapCatalog.maps },
}
const mapIds = Object.keys(mapCatalog.maps).sort((left, right) =>
  left.localeCompare(right, undefined, { numeric: true }),
)
const {
  CATEGORY_LABELS,
  evaluateMap,
  evaluatePredicate,
  fleetContextFromState,
  formatPercent,
  mapNodeLabel,
  normalizeMapId,
  predicateLabel,
} = require('./logic')

let poiGetSaku33 = null
try {
  ;({ getSaku33: poiGetSaku33 } = require('views/utils/game-utils'))
} catch (_) {
  // The standalone test harness does not load poi's path aliases.
}

const h = React.createElement
const listeners = new Set()
const pluginState = {
  currentMapId: null,
  currentNode: null,
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

function calculatePoiLos33(state, deckId = 1) {
  if (typeof poiGetSaku33 !== 'function') return null
  const fleet = getFleet(state, deckId)
  const shipIds = Array.isArray(fleet?.api_ship)
    ? fleet.api_ship.filter((id) => number(id) > 0)
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

    const slotIds = Array.isArray(ship.api_slot) ? [...ship.api_slot] : []
    if (ship.api_slot_ex != null) slotIds.push(ship.api_slot_ex)
    equipsData.push(slotIds.map((equipId) => {
      if (number(equipId) <= 0) return undefined
      const equip = equips[equipId]
      const masterEquip = masterEquips[equip?.api_slotitem_id]
      return equip && masterEquip ? [equip, masterEquip] : undefined
    }))
  }

  const commanderLevel = state?.info?.basic?.api_level
  if (!Number.isFinite(Number(commanderLevel))) return null
  const slotCount = Array.isArray(fleet.api_ship) ? fleet.api_ship.length : 6
  return poiGetSaku33(shipsData, equipsData, Number(commanderLevel), 1.0, slotCount)
}

function notify() {
  listeners.forEach((listener) => listener())
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
  const cell = candidates.find((value) => number(value) > 0)
  return cell == null ? null : number(cell)
}

function updateSortieState(detail) {
  const mapId = mapIdFromDetail(detail) || pluginState.currentMapId
  if (!mapId) return
  const maps = getStore('fcd.map') || {}
  const cell = cellFromDetail(detail)
  const node = cell == null ? null : mapNodeLabel(mapId, cell, maps)
  pluginState.currentMapId = mapId
  if (node) pluginState.currentNode = node
  notify()
}

function handleGameResponse(event) {
  const detail = event?.detail || {}
  const pathName = detail.path || ''
  if (pathName === '/kcsapi/api_req_map/start') {
    pluginState.currentNode = null
    updateSortieState(detail)
  } else if (pathName === '/kcsapi/api_req_map/next') {
    updateSortieState(detail)
  }
}

function startPlugin() {
  pluginState.currentMapId = normalizeMapId(
    getStore('sortie.sortieMapId') || getStore('sortie.mapId') || getStore('info.sortieMapId'),
  )
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
  return Array.from(nodes)
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
  return `${outcome.to} ${formatPercent(outcome.probability)}`
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
    }))
}

function fleetSummary(context) {
  const entries = Object.entries(context.counts || {})
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${CATEGORY_LABELS[category] || category}${count}`)
  return entries.length ? entries.join(' / ') : '未读取到第一舰队'
}

function edgeProbability(evaluation, from, to) {
  const decision = evaluation.decisions[from]
  const outcome = decision?.outcomes?.find((entry) => entry.to === to)
  return {
    local: outcome?.probability,
    global: evaluation.probability.edgeMass[`${from}->${to}`],
  }
}

class Compass extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      mapId: pluginState.currentMapId && mapCatalog.maps[pluginState.currentMapId]
        ? pluginState.currentMapId
        : mapIds[0],
      selectedNode: pluginState.currentNode || null,
      overrides: {},
    }
    this.refresh = () => this.forceUpdate()
  }

  componentDidMount() {
    listeners.add(this.refresh)
  }

  componentWillUnmount() {
    listeners.delete(this.refresh)
  }

  selectMap(event) {
    this.setState({ mapId: event.target.value, selectedNode: null, overrides: {} })
  }

  selectNode(node) {
    this.setState({ selectedNode: node })
  }

  setManualOverride(node, to) {
    this.setState((state) => ({
      overrides: { ...state.overrides, [node]: to },
      selectedNode: node,
    }))
  }

  renderMap(mapDefinition, geometry, evaluation, selectedNode, currentNode) {
    const nodes = mapNodes(mapDefinition, geometry)
    const positions = positionsForNodes(nodes, geometry)
    const edges = routeEdges(geometry)
    const width = Math.max(1100, ...Object.values(positions).map((position) => position.x + 100))
    const height = Math.max(620, ...Object.values(positions).map((position) => position.y + 100))
    return h(
      'svg',
      { className: 'compass-map', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${mapDefinition.name} 路线图` },
      h('defs', null,
        h('marker', { id: 'compass-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto' },
          h('path', { d: 'M0,0 L0,6 L7,3 z', className: 'compass-arrow' }),
        ),
      ),
      ...edges.map((edge) => {
        const from = positions[edge.from]
        const to = positions[edge.to]
        if (!from || !to) return null
        const probability = edgeProbability(evaluation, edge.from, edge.to)
        return h('g', { key: `edge-${edge.cell}`, className: 'compass-edge' },
          h('line', {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            markerEnd: 'url(#compass-arrow)',
            className: probability.global != null ? 'is-reachable' : 'is-unresolved',
          }),
          h('text', {
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2 - 8,
            className: 'compass-edge-label',
          }, probability.global != null ? `全局 ${formatPercent(probability.global)}` : '未知'),
          h('title', null, `局部 ${formatPercent(probability.local)}，全局 ${formatPercent(probability.global)}`),
        )
      }),
      ...nodes.map((node) => {
        const position = positions[node]
        const reach = evaluation.probability.reach[node]
        const classNames = [
          'compass-node',
          node === selectedNode ? 'is-selected' : '',
          node === currentNode ? 'is-current' : '',
          node === mapDefinition.boss ? 'is-boss' : '',
        ].filter(Boolean).join(' ')
        return h('g', {
          key: `node-${node}`,
          className: classNames,
          role: 'button',
          tabIndex: 0,
          onClick: () => this.selectNode(node),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') this.selectNode(node)
          },
        },
        h('circle', { cx: position.x, cy: position.y, r: 28 }),
        h('text', { x: position.x, y: position.y + 6, className: 'compass-node-label' }, node),
        h('text', { x: position.x, y: position.y + 50, className: 'compass-node-probability' }, reach != null ? formatPercent(reach) : '未知'),
        )
      }),
    )
  }

  renderRulePanel(mapDefinition, node, context, evaluation) {
    if (!node) return h('div', { className: 'compass-empty-panel' }, '选择节点')
    const rows = ruleRows(mapDefinition, node, context)
    const decision = evaluation.decisions[node]
    return h('section', { className: 'compass-panel' },
      h('h4', null, `${node} 点`),
      rows.length
        ? h('div', { className: 'compass-conditions' }, ...rows.map(({ rule, result }) => {
          const active = decision?.rule?.id === rule.id
          const outcomes = rule.outcomes?.length ? rule.outcomes.map(outcomeText).join(' / ') : '—'
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
          h('strong', null, '手动选择出口'),
          ...decision.baseOutcomes.map((outcome) => h('button', {
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
    const rootState = getRootState()
    const context = fleetContextFromState(rootState, 1, { losCalculator: calculatePoiLos33 })
    const geometry = mapGeometry(this.state.mapId)
    const evaluation = evaluateMap(mapDefinition, context, this.state.overrides)
    const currentNode = pluginState.currentMapId === this.state.mapId ? pluginState.currentNode : null
    const nodes = mapNodes(mapDefinition, geometry)
    const selectedNode = nodes.includes(this.state.selectedNode)
      ? this.state.selectedNode
      : currentNode || mapDefinition.start
    const cssPath = path.join(__dirname, 'assets', 'compass.css')
    const warnings = [
      context.complete ? null : '舰队数据未完整',
      context.losApproximate && context.losScore != null ? `索敌≈${context.losScore}` : null,
      evaluation.probability.unknownNodes.length ? `未知路线 ${evaluation.probability.unknownNodes.join('、')}` : null,
    ].filter(Boolean)

    return h('div', { className: 'poi-compass' },
      h('link', { rel: 'stylesheet', href: cssPath }),
      h('header', { className: 'compass-titlebar' }, h('h3', null, '舰队罗盘')),
      h('div', { className: 'compass-toolbar' },
        h('label', { className: 'compass-map-select' },
          h('select', { value: this.state.mapId, onChange: (event) => this.selectMap(event) },
            mapIds.map((mapId) => h('option', { key: mapId, value: mapId }, `${mapId} ${mapCatalog.maps[mapId].name}`)),
          ),
        ),
        h('span', {
          className: 'compass-toolbar-fleet',
          title: `第一舰队：${fleetSummary(context)}`,
        }, `舰队 1 · ${fleetSummary(context)}`),
        currentNode ? h('span', { className: 'compass-toolbar-node' }, `当前 ${currentNode}`) : null,
        h('button', { type: 'button', className: 'compass-reset', onClick: () => this.setState({ overrides: {} }) }, '重置路线'),
      ),
      warnings.length ? h('div', { className: 'compass-warnings' }, ...warnings.map((warning) => h('div', { key: warning }, warning))) : null,
      h('main', { className: 'compass-layout' },
        h('section', { className: 'compass-map-panel' }, this.renderMap(mapDefinition, geometry, evaluation, selectedNode, currentNode)),
        h('aside', { className: 'compass-sidebar' },
          this.renderRulePanel(mapDefinition, selectedNode, context, evaluation),
        ),
      ),
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
  mapIdFromDetail,
  mapIds,
  mapNodes,
  pluginState,
  routeEdges,
}
