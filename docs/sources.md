# 来源清单与访问记录

调研日期：2026-09-11（Asia/Shanghai）。URL 中的 `{mapId}` 表示类似 `1-1`、`2-5` 或活动图编号的海域标识；`{nodeLabel}` 表示字母节点。

## 用户指定来源

| 来源 | 用途 | 当前访问结果 | 计划角色 |
| --- | --- | --- | --- |
| [poi 内置 `assets/data/fcd/map.json`](https://github.com/poooi/poi/blob/master/assets/data/fcd/map.json) | 地图坐标、边、数字节点和字母节点 | 当前 checkout 已有本地快照 | 运行时地图几何主来源 |
| [中文 Wiki 海域页](https://zh.kcwiki.cn/wiki/1-1) | 中文海域名、带路表、敌编成说明、制空和攻略注释 | 可访问；页面将条件表和来源链接一起展示 | 建构时规则/说明来源，保留来源引用 |
| [日文 Wiki 出击总表](https://wikiwiki.jp/kancolle/%E5%87%BA%E6%92%83) | 海域列表及子页面入口 | 可访问；总表下含通常海域子页面入口 | 子页面发现入口，不直接作为唯一规则源 |
| [日文 Wiki 路线分歧](https://wikiwiki.jp/kancolle/%E3%83%AB%E3%83%BC%E3%83%88%E5%88%86%E5%B2%90) | 带路条件语义、优先级、索敌公式、舰种/航速/装备等条件 | 可访问；明确说明进击时状态、条件优先级和未知因素 | 规则 DSL 设计和人工核对参考 |
| [NGA 梦美帖第 2 页](https://bbs.nga.cn/read.php?tid=23451223&authorid=39227030&opt=262144&noBBCode&page=2) 至 [第 5 页](https://bbs.nga.cn/read.php?tid=23451223&authorid=39227030&opt=262144&noBBCode&page=5) | 常规海域带路和敌舰配置 | 直接 HTTP 仍返回 403；但在 Firefox 登录会话中已成功读取第 2～5 页 | 浏览器人工采集/复核来源；不得把网页访问器做成运行时高频依赖 |
| [NGA 关联回复帖](https://bbs.nga.cn/read.php?tid=16820397&authorid=39227030&opt=262144&noBBCode) | 被上述带路和敌舰配置引用的回复 | Firefox 登录会话可读取；主题为“地图配置2.0”，第 1 页可见按地图/节点拆分的敌编成表、master ID、装备和制空门槛 | 浏览器人工采集/复核来源；以 `tid/page/pid` 建立可追溯引用 |
| [TsunKit 地图 API](https://tsunkit.net/api/routing/maps/{mapId}/) | 路由、节点坐标、mapSet 素材元数据 | 当前调研用 `1-1`、`2-5` 请求成功；末尾 `/` 更稳定 | 建构时地图补充/校验，必要时缓存原始响应 |
| [TsunKit 敌编成 API](https://tsunkit.net/api/routing/maps/{mapId}/nodes/{nodeLabel}/enemycomps/) | 敌舰 master ID、装备 ID、编成出现次数、制空门槛 | 当前调研用 `2-5/O`、`2-5/C`、`2-5/I` 请求成功 | 建构时敌编成主来源，运行时读取规范缓存 |
| [TsunKit KCNav](https://tsunkit.net/nav/{mapId}) / [地图背景接口](https://tsunkit.net/api/assets/images/maps/{mapId}/background) | 地图和其他图像资源、人工交叉检查 | KCNav 前端实际使用背景接口；通常图背景源文件返回 `image/png`，约 1200×720 | 构建期下载后转换为质量 85 的 WebP，保存到插件本地 `assets/kcnav/`；运行时不请求远程 |
| [TsunKit 路线 API / 图标接口](https://tsunkit.net/api/routing/maps/{mapId}/) | 节点类型编号、KCNav 节点图标 | `result.route[cell][2]` 与 KCNav `getNodeTypes` 一致；图标接口返回 `image/png`；路线 API 连续请求时曾返回 `401 Unauthorized API automation detected` | 构建期来源；图标和已核对的节点类型快照保存到插件本地，运行时不请求远程 |

KCNav 地图路线响应由 `scripts/cache-kcnav-maps.js` 构建期获取，默认每次请求间隔 15 秒：

```text
data/sources/kcnav/maps/{mapId}.json
data/sources/kcnav/maps/manifest.json
data/kcnav-node-types-by-map.json
```

其中第一项保存完整的 `GET /api/routing/maps/{mapId}/` JSON 响应；节点类型表从 `result.route[*][2]` 提取，映射到本地 KCNav 节点类型 ID。刷新命令为 `npm run cache:kcnav-maps`，如需缩短本地测试间隔可显式传入 `--interval-ms`。

## 外部集成和实现参考

### 敌编成日期筛选（2026-09-11）

核对 `https://tsunkit.net/nav/scripts/routing.js`：`startDate`/`endDate` 分别使用参数 `start`/`end`，格式为 `YYYY-MM-DD`；`enemies` 面板将同一组筛选参数传给节点的 `enemycomps` 接口。本插件固定本轮起止日期，仅发送这两个参数，不发送司令部等级、血条、phase、舰队或路线限制。通常节点采用当天 UTC 日期向前一个日历月（月末截到上月末日）；月度样本总数小于 100 的战斗节点另使用前一年同日到当天的窗口，并按节点保存实际使用的日期窗口。

`https://tsunkit.net/lang/en/kcnav.json` 的 `panelEnemiesAirPowerHeader` 顺序为 `termAirAD / termAirAP / termAirAS / termAirASPlus`；与前端 `airpower[0..3]` 对应，分别为劣势、均势、优势、确保。`lbasAirpower` 使用相同顺序但单独显示。原始响应按日期窗口/海图/节点保存，manifest 记录请求 URL、SHA-256、每节点抓取时间和完成状态。遇到请求失败即停止，保留进度供重跑；运行时只读取本地缓存。低样本节点的一年窗口补采由 `npm run cache:kcnav-enemies:long-low` 执行，默认间隔 15 秒。

每个 API entry 原样保留舰船顺序、装备、阵型及编成 masterId；舰船实体用 `mainFleet[].id` / `escortFleet[].id`。界面按 `count` 降序显示，以本节点返回记录的 count 总和计算样本占比。零样本不生成百分比；四档制空缺失时显示未知；任何编成缺制空时，节点整体范围也显示未知。混合阶段和司令部等级的占比仅描述当前抓取样本。

| 来源 | 发现 |
| --- | --- |
| [HKGY/poi-plugin-sortie-checker](https://github.com/HKGY/poi-plugin-sortie-checker) | 已有 MIT 许可的 poi 插件，覆盖当前舰队组装、制空值、33 式索敌和静态分歧检查；可作为公式与 fixture 参考，但本插件的路线概率图和交互式路径仍需独立设计。 |
| [noro6/kc-web](https://github.com/noro6/kc-web) | 本插件采用 `?predeck=` 的 DeckBuilder v4 导入，包含出击节点和单套敌编成；通常舰队必须 `f1.t=0`。已用合成舰队浏览器验证；敌装备使用目标站默认值。 |
| [noro6/kc-web 当前版本/发布页](https://github.com/noro6/kc-web/releases) | 2026-09-11 调研时可见最新发布为 `2.53.5`；外部版本变动不能作为插件运行时契约。 |
| [KC3Kai simulator import help](https://kc3kai.github.io/kancolle-replay/simulator-import-help.html) | 原始 JSON fragment 会直接运行统计；本插件采用已部署 `js/simulator-ui/ui-main.js` 和 `convert.js` 的 v2 `#backup=` LZMA/Base64 编辑入口，保留全部敌编成权重。已浏览器验证两套编成 90%/10%；限制 9 战、每节点 12 编成。 |
| [KC3Kai replay index](https://github.com/KC3Kai/kancolle-replay/blob/master/index.html) | 目前支持 `?s=` 模拟器短数据和 `?r=` replay 数据；插件不应假设可以匿名写入短链服务。 |
| [poi 主仓库](https://github.com/poooi/poi) | 插件生态和主仓库参考；实际运行时以当前 checkout 的 poi API 和 sibling plugin 代码为准。 |

## 本地快照和可复现信息

### KCWiki 路线原文缓存

通常海域目录中的 37 张地图，其中文 Wiki `/{带路条件}` 子页以及 5-6 主页面的原始 wikitext 保存在：

```text
data/sources/kcwiki/routes/{mapId}.wiki
data/sources/kcwiki/routes/manifest.json
```

缓存脚本使用 KCWiki MediaWiki API 的 `revisions` 内容接口，保留页面标题、page ID、revision ID、修订时间、抓取时间、页面 URL、API URL 和 SHA-256。刷新命令为 `npm run cache:kcwiki`；它是建构/校对步骤，插件运行时不访问 Wiki。原文缓存与规范化规则分开保存，后者仍需人工审阅后才可进入 `data/maps.json` 或 `data/normal-maps.json`。

缓存内容可能受中文 Wiki 的 BY-NC-SA 条款约束，发布或分发前应继续保留来源和许可说明，并确认是否需要缩减为内部校对快照。

- `assets/data/fcd/map.json`：`meta.version = 2026/07/28/02`，当前 JSON 的海图键数量为 136。
- poi 现有 `custom-plugins/poi-plugin-data-uploader/index.js` 已验证 `fcd.map[mapKey].route[cell][1]` 可把出击 API 的数字节点映射为字母节点。
- NGA 主帖的第 2～5 页在浏览器会话中可读，内容是按海域组织的半结构化 BBCode：路线说明、分歧条件、敌舰配置、制空线、攻略注释、图片/回帖链接混在同一帖文中；第 2 页覆盖 1-1、1-2、1-3、1-4、2-4、2-5，第 3～5 页继续覆盖 3-1 至 7-5 的常规图内容。
- NGA 关联帖“地图配置2.0”第 1 页可见 `pid=330412919` 等按海域/节点拆分的回复；回复中直接带 `[table]`、`[dict]`、`[collapse]` 等 BBCode，并包含敌舰 master ID、装备、阵型和制空劣势/均势/优势/确保门槛。主帖链接到这些回复的 PID，因此导入时必须保存 `tid`、`page`、`pid`，而不是只保存一个主题 URL。
- NGA 浏览器读取依赖已有登录会话；本次没有提交表单或绕过验证。TsunKit 图片资源已在构建期下载到插件本地；未来若做采集器，应优先采用用户在浏览器中触发的人工导入/复制文本流程，并为每份规范数据记录 `fetchedAt`、来源 PID、原文 hash 和人工复核状态。
- TsunKit `GET /api/routing/maps/2-5/` 的结果顶层为 `result.route`、`result.spots`、`result.mapSet`；KCNav 前端的地图背景请求为 `GET /api/assets/images/maps/{mapId}/background`，当前 `5-3` 返回 1200×720 PNG。KCNav `flowchart.js` 的 `getNodeTypes` 使用 `result.route[cell][2]`，数值图标通过 `/api/assets/images/spritesheets/map_main/{icon}` 加载，`map_common/{icon}` 字符串则通过 `/api/assets/images/spritesheets/{icon}` 加载。
- TsunKit `GET /api/routing/maps/2-5/nodes/O/enemycomps/` 的结果顶层为 `result.entryCount`、`result.entries`；entry 当前观察到的字段为 `map`、`node`、`mainFleet`、`escortFleet`、`formation`、`count`、`airpower`、`lbasAirpower`、`uncertainAirpowerItems`、`masterId`。
- `airpower` 观察到类似 `[10, 19, 42, 84]` 的四档门槛数组；必须在实现时用已知 Wiki 数值写测试，确认数组顺序后再给用户显示“劣势/均衡/优势/确保”标签。

## 许可、署名和数据处理

- 中文 Wiki 条款要求遵守 BY-NC-SA 并尽量署名出处；若把其文字或结构化内容纳入仓库，必须保留来源、抓取时间、许可说明和修改记录，不能把这些内容包装成 MIT 数据。
- 日文 Wiki、NGA、TsunKit 的具体内容/图片许可不能从本次调研中推断。当前已将 TsunKit 的通常图背景和 KCNav 图标复制到插件 `assets/kcnav/` 以满足离线运行；后续发布前需要补充 TsunKit 图片资源的许可/署名确认，也不把未确认的网页内容作为已验证规则发布。
- 第三方响应原文只适合作为建构期审计材料；未来若提交仓库，需要先明确体积、许可、缓存期限和是否只保存摘要/规范化结果。

## 当前通常图规则录入

本轮通过中文 Wiki 的 MediaWiki API 读取各海域的 `/{带路条件}` 子页面，并把规则按地图拆入 `data/normal-maps.json`；来源页面同时保留对应 NGA 回复 PID。已录入并通过几何出边覆盖检查的地图为：

`1-1`～`1-6`、`2-1`～`2-5`、`3-1`～`3-5`、`4-1`～`4-5`、`5-1`～`5-6`、`6-1`～`6-5`、`7-1`～`7-5`。5-6 的路线分支直接记录在海域主页面 `南方海域/5-6`，因此缓存脚本对该图使用主页面标题，而其他通常图继续使用 `/{带路条件}` 子页。

其中带有“约”“随机但未给比例”“原文带问号”或依赖分歧点系数/司令部系数的条件，使用 `approximate` 或 `unknown`；这类记录仍提供可能出口，但不产生伪造的全局百分比。后续继续补录时，先以同一 API 子页取得规则原文，再用日文 Wiki 或浏览器中的 NGA 页面复核有冲突的条件。
