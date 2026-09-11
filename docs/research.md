# 罗盘插件调研笔记

## 1. 目标与假设

目标是为指定舰队（默认第一舰队）回答四类问题：

1. 这张图每个节点可能往哪里走，当前舰队满足哪些带路条件。
2. 在当前分歧规则下，每条边的局部条件概率和从起点传播后的全局到达概率是多少。
3. 每个节点会遇到什么敌舰编成，敌方制空和当前舰队制空关系如何。
4. 能否把当前舰队、当前路径和节点敌编成导出到 noro6 / KC3Kai 等外部工具。

默认假设：插件是信息展示和计算工具，不自动替用户出击或点击路线；外部网站不可用时，已经缓存的数据仍然可以工作。

## 2. 关键结论

### 2.1 需要“规则引擎”，不是简单查表

路线分歧并不只有舰种数量。日文 Wiki 的路线分歧总页明确列出以下条件类别：

- 艦种、特定舰和史实舰；
- 艦队数量、旗舰类型；
- 索敌分数和分歧点系数；
- 航速、装备数量；
- 联合舰队类型；
- 已经过的节点、地图机关、札、血条、难度和出击舰队枠。

而且条件通常按页面顺序优先匹配；游戏是在按下进击按钮时依据当时状态给出路线。因此同一地图不能只保存“舰种组合 -> 目的地”，必须保存有优先级的规则序列，并在求值时保存“当前已经过的节点、当前舰队状态、地图阶段”等上下文。

### 2.2 概率必须分层表达

应同时保存三种不同含义的数字：

- `ruleProbability`：规则明确给出的固定/偏向/随机概率；例如 Wiki 写明 80%/20%。
- `observedProbability`：TsunDB/KCNav 等出击样本按条件筛选后的统计比例。
- `reachProbability`：从起点概率质量传播到该节点或该边的结果。

三者不能混成一个数字。规则缺失或条件未知时，UI 显示 `unknown`，不显示 0%，也不擅自采用统计结果替代规则结果。统计样本可以作为辅助提示，例如“规则未收录，近 N 次样本为……”，但必须显示样本量和过滤条件。

### 2.3 最小可行架构：离线规范数据 + poi 实时状态

推荐的运行边界：

```text
中文 Wiki / 日文 Wiki / NGA 人工复核 / TsunKit API
                 │  建构期抓取、人工审阅、保留 sourceRefs
                 ▼
       normalized maps / rules / enemy-comps
                 │  插件运行时只读
                 ├── poi fcd.map + poi const/info state
                 └── UI + probability engine + external exporters
```

不建议把网页 HTML 解析和运行时请求直接放进插件：NGA 当前直接访问就会返回 403，Wiki 页面格式也会变化，TsunKit API 也可能暂时不可用。将网络访问限制在显式的刷新脚本，并把源版本、抓取时间、响应 hash 和未解决项写入数据清单，更容易回归和人工复核。

## 3. poi 本地数据和事件路径

### 3.1 地图几何

当前 checkout 的 `assets/data/fcd/map.json` 是单行 JSON，已检查到：

- `meta.name = "map"`；
- `meta.version = "2026/07/28/02"`；
- `data` 有 136 个海图键；
- 以 `1-1` 为例：`route` 是数字 cell 编号到 `[from, to]` 的映射，`spots` 是节点到 `[x, y, kind]`；
- 以 `2-5` 为例，几何包含合流/分流的所有边，并保留每条边的数字编号。

现有 `custom-plugins/poi-plugin-data-uploader/index.js` 已使用同一结构：

```js
const mapKey = `${Math.floor(mapId / 10)}-${mapId % 10}`
const label = maps?.[mapKey]?.route?.[Number(cell)]?.[1]
```

因此第一版不需要重新下载地图坐标。插件应优先从 poi store 读取 `fcd.map`；当运行环境没有该结构时，再从版本化的本地适配数据降级。

### 3.2 当前舰队和 master ID

现有插件代码已经验证了下面这组运行时输入足以组装计算行：

- `info.fleets`：舰队槽位及 `api_ship` roster ID；
- `info.ships`：舰娘实例、`api_ship_id`、HP、装备实例、当前搭载量、改修/熟练度；
- `info.equips`：装备实例；
- `const.$ships` / `const.$equips`：舰娘和装备 master 数据；
- `const.$shipTypes`：舰种展示数据；
- `info.basic.api_level`：司令部等级；
- `sortie.combinedFlag`、`sortie.sortieMapId`、`sortie.currentNode`：当前出击上下文（字段的可用性需以当前 poi 版本实测为准）。

索敌值已在当前 poi 源码中确认：`views/utils/game-utils.ts` 的 `getSaku33` 返回 `{ ship, item, teitoku, total }`，分别对应舰船项、装备项、提督等级惩罚和总值。插件运行时优先组装与 poi `fleet-stat` 相同的 `[舰船实例, 舰船 master]` 和装备数据并调用该函数；只有 master/提督等级缺失时才使用降级估算并标记为近似。

所有规则求值都应基于 master ID、舰种 ID、装备 type2、速度值和当前实例数据；名称只用于显示和 source note。敌舰也用敌舰 master ID，不用翻译后的名字作为身份。

当前实现还把装备 type2=12/13（poi 的小型/大型电探）归入 `radar` 舰数，用于 3-2 等通常图。poi 的 `getFleetSpeed` 只返回基础速力，不能单独证明“高速+”或“最速”；规则引擎因此为这两个条件保留独立的未知状态，不把普通高速误当成高速+。

规则引擎另外支持 `containsName` / `nameCount`，用于长门、陆奥、秋津洲、如月以及 7-3 的史实舰组合。这里的名称只作为当前 poi master 数据的匹配键，实际舰队对象仍保留 master ID。地图阶段、出发点解锁、7-3 一期/二期等状态使用 `flag` 条件表达；当前插件没有足够可靠的 poi 状态字段自动填充时，结果保持未知。

出击路径会在插件状态中记录已经经过的节点，并通过 `visited` 条件支持 4-5 的“经过 E/F 点”规则。路径历史只用于当前出击过程，不写回游戏状态。

### 3.3 事件监听

现有 sibling plugin 使用 `window.addEventListener('game.response', ...)`，按 `event.detail.path` 分派：

- `/kcsapi/api_req_map/start`：出击开始，响应里有 `api_maparea_id`、`api_mapinfo_no`、`api_cell_data`；
- `/kcsapi/api_req_map/next`：前进到下一节点；
- `/kcsapi/api_req_sortie/battleresult` 和 combined battle 对应路径：战斗结果/血条信息；
- `game.response` 之后节流刷新 UI，避免每个 API 回包都触发完整渲染。

罗盘第一版至少要监听 `api_req_map/start` 和 `api_req_map/next`，才能把“当前节点”和“用户选择/实际路线”同步到图上；不应在出击前假设舰队状态一直不变。

## 4. 各数据源的具体研究

### 4.1 中文 Wiki

`https://zh.kcwiki.cn/wiki/1-1` 可直接读取，页面展示了：海域基本信息、路线分支表、舰种缩写定义、概率数值、索敌说明和原始 NGA 引用。

`2-5` 页面更能说明数据复杂度：同一分歧点同时存在潜艇/舰种/运输桶/航速/索敌条件，且有固定、随机和“约”三种语义。页面还给出路线示例、索敌阈值和制空线。这个页面适合作为第一批规则 fixture，但不能把攻略文案直接当作机器规则。

建议建构器只抽取明确的结构化候选，保留原文：

```json
{
  "node": "G",
  "priority": 30,
  "predicate": { "kind": "los33", "coefficient": 1, "min": 41 },
  "outcomes": [{ "to": "L", "probability": 1 }],
  "sourceRefs": [{ "url": "...", "quote": "...", "checkedAt": "..." }],
  "confidence": "verified"
}
```

无法确定“约 80%”是否为长期规则、样本估计还是攻略近似时，应使用 `approximate` 或 `unknown`，并把原文保留到审阅队列。

### 4.2 日文 Wiki

`出撃` 总页列出通常海域并通过子页面链接到各海域；`ルート分岐` 总页提供路线条件分类、索敌公式和“梦美的常规图带路 & 出击配置”等交叉来源入口。

它适合：

- 查找中文页面没有同步的条件；
- 统一日文舰种/装备术语；
- 复核条件优先级、索敌公式和特殊地图状态。

它不适合被当作单一真相：页面自己也建议多来源检查，而且有些条件只以攻略/讨论形式出现。解析器应保留 `raw` 和页面标题，而不是只保存最终中文文案。

### 4.3 NGA：浏览器会话是可行的采集边界

本次调研验证了用户的判断：直接 HTTP 请求仍返回 403，网页检索也不能稳定打开带查询串的页面；但在已经登录 NGA 的 Firefox 会话中，用户给出的主帖第 2～5 页和关联帖可以正常读取。因此“命令行抓取失败”不能作为“资料不可用”的结论，但也不适合把 NGA 变成插件运行时依赖。

浏览器读取到的内容特征：

- 主帖第 2 页包含 1-1、1-2、1-3、1-4、2-4、2-5 的路线说明、分歧条件、敌舰行、制空线和攻略注释；第 3～5 页继续覆盖 3-1 至 7-5。帖文是人工维护的半结构化 BBCode，不是稳定 JSON。
- 2-5 的示例同时出现舰种/数量、全高速、索敌阈值、装备类别和低速等条件，说明它可以提供很有价值的规则原文，但解析器不能只依赖一个固定表格列。
- 关联帖标题为“地图配置2.0”。第 1 页可见按海域/节点拆分的回复，例如 `pid=330412919` 的 1-1 敌方配置；回复中包含 `[table]`、`[dict]`、`[collapse]`，并给出敌舰 master ID、装备、阵型、经验值及制空劣势/均势/优势/确保门槛。主帖中的“敌方配置”链接会指向这些 PID。
- 页面会显示帖子修改时间；主帖较新的页面和关联帖早期回帖混在一起，因此同一规则可能需要以 `tid`、`page`、`pid` 和帖子时间区分版本。

建议的 NGA 工作流：

1. 用户在已登录浏览器中打开指定页面，插件或辅助工具接收用户明确复制的 BBCode/纯文本；不在出击运行时自动访问 NGA。
2. 预处理器先按 `[collapse]`、`[table]`、`[dict]`、`===地图/节点===` 分段，保留无法识别的原文。
3. 将路线候选、敌编成和制空门槛写入待审阅规范数据；每条记录保存 `sourceRef = { tid, page, pid, url, fetchedAt }`，并由人工确认后才成为 `verified`。
4. 若主帖只给出路线而敌舰细节来自关联帖，两个 PID 都写入同一条规范记录；不能只保留主帖 URL。

这种设计既利用浏览器会话可以读取 NGA 的事实，也把登录状态、页面布局变化和帖子修改造成的不确定性隔离在建构期。不要增加绕过验证、代理或高频访问逻辑。

### 4.4 TsunKit API

当前实际请求到的地图 API（`2-5`）形状如下：

```text
GET /api/routing/maps/2-5/
result.route: { cellNo: [from, to, ...] }
result.spots: { nodeLabel: [x, y, kind] }
result.mapSet: { map, frameSet, breakpoints }
```

敌编成 API（`2-5/O`）形状如下：

```text
GET /api/routing/maps/2-5/nodes/O/enemycomps/
result.entryCount
result.entries[]:
  map, node, mainFleet, escortFleet, formation,
  count, airpower, lbasAirpower,
  uncertainAirpowerItems, masterId
```

`mainFleet` 的每艘敌舰包含 `id`、名字、等级、HP/火力/对空/装甲和 `equips` master ID。`masterId` 是整套编成的标识，`count` 可用于统计权重。

调研中观察到 `airpower` 是四个制空门槛的数组，例如 `[10, 19, 42, 84]`；`lbasAirpower` 是另一组带陆航语义的门槛。实现时必须用已知敌编成手算值和 Wiki 表格建立映射测试，确认数组顺序后再显示中文档位。`uncertainAirpowerItems` 非空时，制空结论应降低置信度。

推荐数据策略：

1. TsunKit 的 `entries` 作为敌编成和敌方制空的优先来源；
2. 用 `mainFleet[].id` / `equips` 保存可重算依据；
3. Wiki 的敌编成/制空值用来交叉核对和补齐缺项；
4. 未知或冲突的值同时保留 `sourceValues`，不静默覆盖。

### 4.5 地图图像

poi `fcd.map` 已有可用的节点坐标和边信息，足以先用 SVG/Canvas 画图。TsunKit 的 `mapSet` 还有 sprite frame 和地图图集元数据，但远程图像地址/版本契约尚未在本次调研中固定；KCNav 页面本身还可能出现 metadata 加载失败。

MVP 只画节点、边、节点类型和当前路径，不复制第三方地图图像。之后再以可配置远程资源或用户本地 poi 缓存作为增强项，并在 UI 标出资源来源。

## 5. 规范数据模型建议

### 5.1 地图、边和节点

```ts
type MapId = string // "2-5"
type NodeLabel = string // "O"

interface CompassMap {
  mapId: MapId
  sourceSnapshot: SourceSnapshot
  nodes: Record<NodeLabel, {
    x: number
    y: number
    kind: 'start' | 'battle' | 'air' | 'resource' | 'boss' | 'unknown'
    sourceRefs: SourceRef[]
  }>
  edges: Array<{
    id: string
    cellNo: number
    from: NodeLabel | null
    to: NodeLabel
    sourceRefs: SourceRef[]
  }>
  rules: RouteRule[]
}
```

边的 `cellNo` 必须保留，因为 poi API 的数字节点和实际地图字母节点都需要互相定位。

### 5.2 带路规则

规则建议采用小型 AST，不把自然语言直接拼成 JavaScript：

```ts
interface RouteRule {
  node: NodeLabel
  priority: number
  predicate: Predicate
  outcomes: Array<{
    to: NodeLabel
    probability: number | 'unknown'
  }>
  appliesWhen?: { difficulty?: string; gauge?: number; phase?: number }
  sourceRefs: SourceRef[]
  confidence: 'exact' | 'verified' | 'parsed' | 'approximate' | 'unknown'
  raw?: string
  unresolved?: string[]
}
```

初始 predicate 集合只实现当前需求需要的部分：舰种/特定 master ID 计数、舰队数量、旗舰、速度、装备类别/数量、33 式索敌、联合舰队类型、已经过节点、地图阶段/难度/血条。没有匹配的表达式返回 `unknown`，不执行猜测。

### 5.3 敌编成

```ts
interface EnemyComposition {
  mapId: MapId
  node: NodeLabel
  masterId: number
  count: number
  formation: number
  mainFleet: Array<{ masterId: number; equipMasterIds: number[]; stats?: object }>
  escortFleet: Array<{ masterId: number; equipMasterIds: number[]; stats?: object }>
  airpower?: {
    source: 'tsunkit' | 'computed' | 'wiki' | 'unknown'
    thresholds?: [number, number, number, number]
    uncertainItems?: number[]
  }
  sourceRefs: SourceRef[]
}
```

名称、舰种翻译和图标均是 presentation 层派生值。`masterId`、装备 ID 和来源快照才是数据层身份。

## 6. 概率计算设计

### 6.1 规则求值

在节点 `N`：

1. 按 `priority` 排序；
2. 依次求值规则的 predicate；
3. 取第一个确定匹配的规则；
4. 若匹配规则产生多个出口，使用其明确权重；
5. 若没有规则或规则含未知状态，返回 `unknown` 并附上原因。

这里的“第一个”不是实现者猜测的优先级，而必须来自页面表格顺序或人工标注的 `priority`。

### 6.2 概率质量传播

从起点注入 `mass = 1`：

```text
reach(from) = incoming mass
edgeMass(from -> to) = reach(from) × localProbability(from -> to)
reach(to) += edgeMass(from -> to)
```

UI 同时显示：

- 当前节点的到达率 `reachProbability`；
- 当前边的局部概率 `localProbability`；
- 当前边承载的全局概率 `edgeMass`。

图中若有合流节点，应按路径状态合并“只读的可交换上下文”；若规则依赖曾经经过的节点或阶段，则保留路径上下文，不能只按节点字符串去重。对未知边不传播伪造数值，而是单独显示“概率质量未闭合”。

### 6.3 能动分歧

用户选择能动分歧后，对该节点加入临时 `manualOverride`：

- 选中的边：`localProbability = 1`；
- 其他边：`localProbability = 0`；
- 原始规则概率保留，UI 以“手动选择覆盖”标识；
- 下游所有 `reachProbability` 重新计算；
- 到达实际游戏节点后，应清除已经经过节点的旧 override，避免跨出击污染。

如果游戏里的分歧不是能动分歧，UI 只能展示规则，不应提供“选择路线”按钮。

## 7. 制空实现建议

### 7.1 当前舰队

现有 `poi-plugin-sortie-checker` 的纯计算模块已经给出可复用的验证方向：

- 按装备 type2 识别舰战、爆战、舰爆、舰攻、水战、水爆和喷式机；
- 单格制空大致为 `floor((对空 + 改修补正) * sqrt(当前搭载) + 熟练度加成)`；
- 舰战/水战/喷式战和水爆的熟练度加成不同；
- `api_onslot` 必须取当前搭载，不应使用 master 最大搭载；
- 扩张槽装备不贡献搭载制空，但应按游戏规则处理其对空效果。

在本插件中应把公式移到独立纯函数，并用已知编成测试；不要把 HKGY 插件的 UI 或静态 mapdata 当成运行时依赖。

### 7.2 敌方制空

优先顺序：

1. TsunKit 的 `airpower`/`lbasAirpower` 门槛数组；
2. 有完整敌舰装备和 slot 数据时，按 master 数据重新计算；
3. Wiki 明确列出的敌制空值；
4. 否则显示“未知”。

若多个来源冲突，显示来源对照和置信度，不直接取最大值掩盖冲突。`uncertainAirpowerItems` 出现时，制空档位可以显示，但必须带“装备不确定”提示。

## 8. 外部模拟器链接

### 8.1 KC3Kai：优先实现

KC3Kai 的 import help 明确支持：

- URL fragment 中直接放 JSON；
- `fleetF.ships[]` 使用玩家舰船 master ID、等级、状态和 `equips[]`；
- `nodes[]` 可放单个 `fleetE` 或带 `weight` 的 `fleetEComps`；
- 每个节点可以指定 formation、夜战、空袭等行为。

因此第一版 exporter 可以把“当前舰队 + 当前预测路径上的每个节点的一组敌编成”生成 JSON。TsunKit `count` 可转换为敌编成权重，但应标记为“样本权重”，不能表示官方概率。

风险是 URL 长度和 simulator 对新 master ID 的支持。如果 simulator 数据库没有某个 master ID，import help 要求同时提供 stats；插件应捕获这个情况并允许只导出舰队或复制 JSON。

### 8.2 noro6：先做最小 POC

noro6 源码显示其外部 URL 采用：

```text
?data=<LZString.compressToEncodedURIComponent(managerJson)>
```

poi 当前的 `ShareDialog` 也已有同一方向的实现，并另有 `pdz` deckbuilder 压缩链接。完整 manager JSON 不只是舰队，还包含内部保存数据、敌舰和战斗信息；所以“直接生成当前路线并让 noro6 还原”需要一个最小 fixture POC：

1. 生成只有玩家舰队的 manager JSON；
2. 打开 noro6 的 `?data=` 并确认能解码；
3. 增加一个敌节点和一条路线；
4. 再验证空袭/联合舰队/新舰装备的兼容性。

如果第三步无法稳定通过，MVP 只提供 noro6 海域页和当前舰队 deckbuilder/aircalc 链接，不承诺自动填充每个敌节点。

## 9. 分阶段实施计划

### P0：研究仓库和样本（已完成）

- 保存来源、访问结果、许可/署名注意事项；
- 固定 `1-1`、`2-5`、至少一张含索敌和随机分歧的 fixture；
- 定义 normalized schema、置信度和 unknown 语义。

当前实现已在独立 `poi-plugin-compass` 仓库中落地规则 AST、来源引用、置信度和未知结果语义；首批 fixture 为 1-1、1-2、1-3、1-4、2-1、2-5 与 3-1。

### P1：离线通常海域 MVP（进行中）

- 从 poi store 读取第一舰队和 master 数据；
- 使用 `fcd.map` 画节点/边；
- 手工审阅并录入少量路线 AST；
- 展示每个节点所有规则、当前匹配状态和路线质量传播；
- 支持能动分歧 override；
- 不接运行时网络，不复制第三方地图图片。

已完成：CommonJS poi 插件壳、全部通常海域地图目录与 SVG 几何、第一舰队状态读取、1-1/1-2/1-3/1-4/2-1/2-5/3-1 规则样本、局部/全局概率传播、手动覆盖引擎，以及直接复用 poi `getSaku33` 的 33 式索敌读取。
未完成：其余通常海域规则、敌编成/制空数据面板和联合舰队状态。

### P2：敌编成和制空

- 增加 TsunKit refresh 脚本、原始响应摘要、source hash 和 normalized cache；
- 将敌舰/装备统一到 master ID；
- 接入制空纯函数和 TsunKit 门槛数组；
- 显示 `unknown`、`uncertain` 和来源冲突。

### P3：活动图和人工来源

- 加入难度、血条、阶段、札和已开点状态；
- 为 NGA 文本提供人工导入审阅格式；
- 活动图规则默认只展示已验证项，未验证项不参与自动概率传播。

### P4：外部工具

- 先实现 KC3Kai JSON fragment exporter；
- 再做 noro6 manager JSON POC；
- 增加 URL 长度检查、复制 JSON 备用按钮和外部版本兼容提示。

## 10. 验收和测试边界

- 单元测试：predicate 求值、规则优先级、固定/加权出口、unknown、概率质量和 manual override；
- fixture 测试：1-1 的舰数随机分歧、2-5 的舰种/桶/速度/索敌组合；
- 敌编成测试：TsunKit `mainFleet` 的 master ID 保持不变，`count` 权重不被误当成官方概率；
- 制空测试：至少一组无空母、一组含舰载机、一组 `uncertainAirpowerItems`；
- exporter 测试：KC3Kai JSON 能被 import-help schema 接受，Noro6 `?data=` 在浏览器中能恢复最小 fixture；
- 运行时验证：poi 重载插件后切换编成、装备、联合舰队和实际推进节点，确认图和计算刷新；
- 不把完整 poi 根目录 sweep 作为验收门槛。未来有运行时代码时，遵循 `custom-plugins` sibling plugin 的最小测试边界。

## 11. 主要风险

1. **规则漂移**：Wiki、NGA 帖子、TsunDB 统计和游戏实装可能不同。必须保留 sourceRefs、时间和置信度。
2. **网络依赖**：NGA 已验证存在直接访问阻断；所有外部来源都应可脱网运行。
3. **统计误读**：TsunKit 的 `count` 是样本数，不能直接改成规则概率。
4. **门槛数组误读**：TsunKit 的 `airpower` 需要 fixture 验证四个元素的顺序；在确认前不应硬编码中文档位。
5. **资源许可**：中文 Wiki 条款要求 BY-NC-SA；NGA、日文 Wiki、TsunKit 图像许可未确认。MVP 不复制图片和大段原文。
6. **外部链接失效**：noro6/KC3Kai 的 URL 数据结构和 master 数据库会更新；导出器必须有版本/失败提示和复制原始 JSON 兜底。
7. **poi 状态时序**：分歧判定使用的是进击按钮时的状态；退避、编成变化和联合舰队状态可能改变上下文，不能只依赖出击开始快照。
