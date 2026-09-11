'use strict'

const assert = require('assert')
const Module = require('module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const originalLoad = Module._load
const enemies = require('./enemies')
let imagePath = 'file:///tmp/compass-test-portrait.png'
let imageParams
let rootState = {}
const subscribers = new Set()
const fakeStore = { getState: () => rootState, subscribe: callback => { subscribers.add(callback); return () => subscribers.delete(callback) } }
Module._load = function(request, ...args) {
  if (request === 'views/create-store') return { store: fakeStore }
  if (request === 'views/components/etc/icon') return { SlotitemIcon: props => React.createElement('img', { 'data-slotitem-id': props.slotitemId }) }
  if (request === './enemies') return { ...enemies, loadEnemies: () => ({ status: 'ready', superiority: [42, 42], supremacy: [84, 84], rows: [{
    masterId: 999, formation: 1, share: 1, count: 12345, thresholds: { superiority: 42, supremacy: 84 },
    mainFleet: [{ id: 1501, name: '敌舰测试', lvl: 99, hp: 20, fp: 10, torp: 15, aa: 5, armor: 8, equips: [] }], escortFleet: [],
  }] }) }
  if (request === 'views/utils/ship-img') return { getShipImgPath: (...params) => {
    imageParams = params
    return imagePath
  } }
  return originalLoad.call(this, request, ...args)
}
try {
  const Compass = require('./index').reactClass
  const view = new Compass({})
  view.state.selectedNode = 'A'
  const realMap = view.renderMap
  const enemyPanel = view.renderEnemyPanel
  view.setState = (patch) => Object.assign(view.state, patch)
  const definition = require('./data/maps.json').maps['1-1']
  const geometry = require('../../assets/data/fcd/map.json').data['1-1']
  const evaluation = require('./logic').evaluateMap(definition, { shipCount: 1, complete: true })
  const mapElement = realMap.call(view, definition, geometry, evaluation, 'A', null, [], '1-1')
  mapElement.props.onClick({ target: { closest: () => ({}) } })
  assert.strictEqual(view.state.selectedNode, 'A')
  mapElement.props.onClick({ target: { closest: () => null } })
  assert.strictEqual(view.state.selectedNode, null)
  view.state.selectedNode = 'A'
  view.renderMap = () => React.createElement('div', null, 'MAP_MARKER')
  view.renderRulePanel = () => React.createElement('div', null, 'RULE_MARKER')
  view.renderOverview = () => React.createElement('div', null, 'OVERVIEW_MARKER')
  view.renderEnemyPanel = () => React.createElement('div', null, 'ENEMY_MARKER')
  const realExport = view.renderExportPanel
  view.renderExportPanel = () => React.createElement('div', null, 'EXPORT_MARKER')
  let html = renderToStaticMarkup(view.render())
  assert(html.includes('RULE_MARKER'))
  assert(!html.includes('EXPORT_MARKER'))
  assert(html.indexOf('ENEMY_MARKER') > html.indexOf('</main>'))
  view.state.exportOpen = true
  html = renderToStaticMarkup(view.render())
  assert(!html.includes('RULE_MARKER'))
  assert(html.includes('EXPORT_MARKER'))
  assert(html.indexOf('ENEMY_MARKER') > html.indexOf('</main>'))
  const panel = realExport.call(view, {}, {}, { dataAvailable: false }, {})
  const heading = React.Children.toArray(panel.props.children)[0]
  const close = React.Children.toArray(heading.props.children).find(child => child.type === 'button')
  close.props.onClick()
  assert.strictEqual(view.state.exportOpen, false)
  view.selectNode(null)
  html = renderToStaticMarkup(view.render())
  assert(html.includes('OVERVIEW_MARKER'))
  assert(!html.includes('RULE_MARKER'))
  html = renderToStaticMarkup(view.renderShipPortrait(1501, '敌舰', {}))
  assert(html.includes('file:///tmp/compass-test-portrait.png'))
  assert(html.includes('compass-portrait'))
  for (const unavailable of ['/kcs2/resources/ship/banner/1501.png']) {
    imagePath = unavailable
    html = renderToStaticMarkup(view.renderShipPortrait(1501, '敌舰', {}))
    assert(!html.includes('<img'))
    assert(html.includes('#1501'))
  }
  imagePath = 'https://203.104.209.71/kcs2/resources/ship/banner/1501.png?version=3'
  html = renderToStaticMarkup(view.renderShipPortrait(1501, '敌舰', {
    info: { server: { ip: '203.104.209.71' } },
    const: { $shipgraph: [{ api_id: 1501, api_version: [3] }] },
  }))
  assert(html.includes(imagePath))
  assert.deepStrictEqual(imageParams, [1501, 'banner', false, '203.104.209.71', 3])
  const portrait = view.renderShipPortrait(1501, '敌舰', {})
  assert.strictEqual(React.Children.toArray(portrait.props.children)[0].props.style.marginLeft, -60)
  html = renderToStaticMarkup(enemyPanel.call(view, '1-1', 'A'))
  const visible = html.replace(/<[^>]*>/g, '')
  for (const removed of ['样本', '抓取', 'Lv.', '敌舰测试', '编成 #999']) assert(!visible.includes(removed))
  for (const label of ['空优 42 / 空确 84', 'HP', '火力', '雷装', '对空', '装甲']) assert(visible.includes(label))
  assert(html.includes('compass-enemy-stat-row'))
  view.state.overrides = { A: 'B' }
  view.state.exportRoute = '1>A>B'
  view.selectFleet(2)
  assert.strictEqual(view.state.deckId, 2)
  assert.deepStrictEqual(view.state.overrides, {})
  assert.strictEqual(view.state.exportRoute, null)
  html = renderToStaticMarkup(view.renderLosIcons([11, 22, 33, null]))
  assert.strictEqual((html.match(/data-slotitem-id="11"/g) || []).length, 4)
  for (const label of ['系数 1：11', '系数 2：22', '系数 3：33', '系数 4：']) assert(html.includes(label))
  assert.strictEqual((html.match(/class="compass-los-value"/g) || []).length, 4)
  assert(!html.includes('compass-los-tooltip'))
  assert(html.replace(/<[^>]*>/g, '').includes('11'))
  assert.strictEqual(view.renderFleetAir({ min: 0, max: 0 }), null)
  assert.strictEqual(view.renderFleetAir(null), null)
  assert(renderToStaticMarkup(view.renderFleetAir({ min: 80, max: 84 })).includes('制空 80～84'))
  assert(renderToStaticMarkup(view.renderFleetAir({ min: 80, max: 80 })).includes('制空 80<'))
  let refreshes = 0
  view.refresh = () => { refreshes++ }
  view.componentDidMount()
  assert.strictEqual(subscribers.size, 1)
  const initialRefreshes = refreshes
  rootState = { info: { fleets: [{ api_ship: [10, 20] }] } }
  subscribers.forEach(callback => callback())
  assert.strictEqual(refreshes, initialRefreshes + 1)
  // Redux's remove-all-but-flagship result, as produced by hensei/change -2.
  rootState = { info: { fleets: [{ api_ship: [10, -1, -1, -1, -1, -1] }] } }
  subscribers.forEach(callback => callback())
  assert.strictEqual(refreshes, initialRefreshes + 2)
  rootState = { ...rootState, info: { ...rootState.info, equips: {} } }
  subscribers.forEach(callback => callback())
  assert.strictEqual(refreshes, initialRefreshes + 3)
  subscribers.forEach(callback => callback())
  assert.strictEqual(refreshes, initialRefreshes + 3)
  const plugin = require('./index').__test
  plugin.pluginState.currentNode = 'A'
  plugin.pluginState.passedNodes = ['1', 'A']
  plugin.handleGameResponse({ detail: { path: '/kcsapi/api_port/port' } })
  assert.strictEqual(plugin.pluginState.currentNode, null)
  assert.deepStrictEqual(plugin.pluginState.passedNodes, [])
  queueMicrotask(() => {
    assert.strictEqual(refreshes, initialRefreshes + 4)
    view.componentWillUnmount()
    assert.strictEqual(subscribers.size, 0)
  })
} finally {
  Module._load = originalLoad
}
console.log('Layout, export close and cached/server portrait tests passed')
