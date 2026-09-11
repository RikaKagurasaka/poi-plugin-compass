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
| [TsunKit KCNav](https://tsunkit.net/nav/{mapId}) | 地图和其他图像资源、人工交叉检查 | 页面可访问性和 metadata 受前端/服务状态影响 | 先用 poi 几何；图像仅作为可选远程链接，不纳入 MVP 必需资源 |

## 外部集成和实现参考

| 来源 | 发现 |
| --- | --- |
| [HKGY/poi-plugin-sortie-checker](https://github.com/HKGY/poi-plugin-sortie-checker) | 已有 MIT 许可的 poi 插件，覆盖当前舰队组装、制空值、33 式索敌和静态分歧检查；可作为公式与 fixture 参考，但本插件的路线概率图和交互式路径仍需独立设计。 |
| [noro6/kc-web](https://github.com/noro6/kc-web) | 当前 poi 源码已有 `?data=` 的 LZString 压缩数据入口；noro6 源码的 URL 数据是压缩后的 manager JSON。未来可先做最小 POC，再决定是否能可靠生成带敌舰路线的完整 manager 数据。 |
| [noro6/kc-web 当前版本/发布页](https://github.com/noro6/kc-web/releases) | 2026-09-11 调研时可见最新发布为 `2.53.5`；外部版本变动不能作为插件运行时契约。 |
| [KC3Kai simulator import help](https://kc3kai.github.io/kancolle-replay/simulator-import-help.html) | 支持 URL fragment JSON；玩家舰队用 `fleetF`，各节点敌舰可用 `fleetE` 或按权重的 `fleetEComps`，舰船/装备以 master ID 表示。它是更适合第一版直接生成的外部链接目标。 |
| [KC3Kai replay index](https://github.com/KC3Kai/kancolle-replay/blob/master/index.html) | 目前支持 `?s=` 模拟器短数据和 `?r=` replay 数据；插件不应假设可以匿名写入短链服务。 |
| [poi 主仓库](https://github.com/poooi/poi) | 插件生态和主仓库参考；实际运行时以当前 checkout 的 poi API 和 sibling plugin 代码为准。 |

## 本地快照和可复现信息

- `assets/data/fcd/map.json`：`meta.version = 2026/07/28/02`，当前 JSON 的海图键数量为 136。
- poi 现有 `custom-plugins/poi-plugin-data-uploader/index.js` 已验证 `fcd.map[mapKey].route[cell][1]` 可把出击 API 的数字节点映射为字母节点。
- NGA 主帖的第 2～5 页在浏览器会话中可读，内容是按海域组织的半结构化 BBCode：路线说明、分歧条件、敌舰配置、制空线、攻略注释、图片/回帖链接混在同一帖文中；第 2 页覆盖 1-1、1-2、1-3、1-4、2-4、2-5，第 3～5 页继续覆盖 3-1 至 7-5 的常规图内容。
- NGA 关联帖“地图配置2.0”第 1 页可见 `pid=330412919` 等按海域/节点拆分的回复；回复中直接带 `[table]`、`[dict]`、`[collapse]` 等 BBCode，并包含敌舰 master ID、装备、阵型和制空劣势/均势/优势/确保门槛。主帖链接到这些回复的 PID，因此导入时必须保存 `tid`、`page`、`pid`，而不是只保存一个主题 URL。
- NGA 浏览器读取依赖已有登录会话；本次没有下载图片、提交表单或绕过验证。未来若做采集器，应优先采用用户在浏览器中触发的人工导入/复制文本流程，并为每份规范数据记录 `fetchedAt`、来源 PID、原文 hash 和人工复核状态。
- TsunKit `GET /api/routing/maps/2-5/` 的结果顶层为 `result.route`、`result.spots`、`result.mapSet`。
- TsunKit `GET /api/routing/maps/2-5/nodes/O/enemycomps/` 的结果顶层为 `result.entryCount`、`result.entries`；entry 当前观察到的字段为 `map`、`node`、`mainFleet`、`escortFleet`、`formation`、`count`、`airpower`、`lbasAirpower`、`uncertainAirpowerItems`、`masterId`。
- `airpower` 观察到类似 `[10, 19, 42, 84]` 的四档门槛数组；必须在实现时用已知 Wiki 数值写测试，确认数组顺序后再给用户显示“劣势/均衡/优势/确保”标签。

## 许可、署名和数据处理

- 中文 Wiki 条款要求遵守 BY-NC-SA 并尽量署名出处；若把其文字或结构化内容纳入仓库，必须保留来源、抓取时间、许可说明和修改记录，不能把这些内容包装成 MIT 数据。
- 日文 Wiki、NGA、TsunKit 的具体内容/图片许可不能从本次调研中推断。MVP 不复制第三方图片，不把未确认的网页内容作为已验证规则发布。
- 第三方响应原文只适合作为建构期审计材料；未来若提交仓库，需要先明确体积、许可、缓存期限和是否只保存摘要/规范化结果。
