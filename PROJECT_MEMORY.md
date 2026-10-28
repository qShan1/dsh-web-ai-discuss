# PROJECT_MEMORY — dsh-web-ai-discuss

把**已登录的网页版 DeepSeek** 当外部讨论源接进 DSH：三个 Tool + 侧边栏/设置页 UI + `/web-ai-discuss/api/*`。

## 四条不可妥协

1. 零协议构造 —— 不求解 PoW、不拼 `x-hif-*`、不伪造 SSE，网页交互只走本机 `ego-browser` CLI 子进程。
2. 未登录返回结构化 `unauthorized`，主对话不出现「请登录」。
3. 三重护栏不可关闭（串行 + 最小间隔 + 窗口上限，`lib/config.js` 的 `FLOOR` 钳制）。
4. 工具返回唯一 canonical JSON，业务非理想结果不 `throw`。

## 状态（2026-10-28 夜）

`0.6.0`（`package.json` 与 `client.js` 的 `CLIENT_BUILD` 必须同步）；HEAD `2ea8a1d` + 未提交改动。
基线 client 73/73、cases 27/27、styles 10/10、`impeccable detect` → `[]`。
安装副本已同步 `client.js`/`lib/{script,guard,tools}.js`，但宿主模块已缓存 → **需重启宿主**。
用户侧 `settings.json` 已热改为 `placement=both`（走 API 改，才能触发 hotApply）。

## 已定型决策

- 可选服务探测只走 `ctx.get(name,false)` → `ctx.reflect.get` → `try { ctx[name] }`；**绝不写进 `inject`**。
- 窄栏走容器查询，锚点 `.wai-shell`；设置网格 `auto-fit minmax(300px)`，不写死断点。
- 正文/次要信息用 `--dsw-alias-label-secondary`；**警示色 token 只用于图形不用于文字**（`state-warn-primary` 白底仅 2.0:1）。
- 附件到位证据按类型分流：文档看正文文件名，图片看 `img[src^="blob:"]` 增量 / `alt` 命中。
- 单位换算只在界面层（`SETTINGS_FIELDS.scale`）：`频率窗口` 显示分钟、存储仍毫秒。
- 检索只回 `snippet` 不回全文（命中 20 条 × 12000 字会撑爆上下文），拿全文用 id 再读。

## 架构债（明确不做，不是漏了）

- **护栏是进程级单例**：宿主与本地脚本各持一份 Guard，可同时操作同一 ego 空间。真修要跨进程文件锁 + TTL，单宿主日常使用收益为零。
- **追问链**：no。窗口 6 次/小时是硬约束，链式 3 轮吃半配额；`followUp` 已支持，Agent 自己循环即可。

## 错误归因

- 「重启后插件消失」= 探测写在 `try` 外，`apply()` 抛异常 → 面板/设置页/工具卡全不注册。
- 「设置页没变化」= `minmax(340px)` 与宿主字段区 706px 差 2px，静默退回单列。
- 「图片永远 attachment_not_ready」= 图片是纯缩略图，正文无文件名；旧实现只查 `innerText`。
- 「生成中停顿分不清完成」= 网页无生成态信号可读；回答文本非单调（431→35→61→83→316），跳变会重置稳定计数，默认 2.7s 窗口实测未误判。真截断时调 `stableSamples`，别改判据。
- 改文件 anchor 找不到 = 行尾不符：`client.js` CRLF，`index.js`/`lib/*.js`/`test/*.mjs` LF。
- 测试桩 `collectByClass` 只能遍历一次树（二次遍历退化成 loading）；多类名必须一次收全。

## 下一轮

界面四条已由 DeepSeek 三轮验收通过。待决：拒绝数两位数时窄栏折行；`次`/`字` 单位在英文界面仍是中文。
