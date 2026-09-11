# KCWiki 路线原文缓存

每个 `{mapId}.wiki` 文件是中文 KCWiki 对应 `/{带路条件}` 子页的原始 wikitext，用于校对规范化规则；`manifest.json` 保存页面、修订和内容哈希。

需要主动更新快照时，在插件目录执行：

```sh
npm run cache:kcwiki
```

插件运行时不读取网络。缓存内容按中文 Wiki 的来源和许可要求处理。
