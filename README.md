# dsh-web-ai-discuss

把**已登录的网页版 DeepSeek** 接进 DSH 工作流，作为「外部思路讨论来源」：Agent 用工具把问题递进去，拿回网页端的回答原文。

- 定位工具：`web_ai_discuss` / `web_ai_read_discussion` / `web_ai_status`
- 定位面板：侧边栏「DeepSeek 讨论」+ 中央面板（静态契约说明）

## 不可妥协的四条

| # | 原则 | 落地方式 |
|---|---|---|
| 1 | **零协议构造** | 不求解 PoW、不拼 `x-hif-*`、不伪造 SSE。所有页面交互都由本机 ego lite 引擎执行（`ego-browser nodejs` 子进程，stdin 送脚本、结果文件 + 哨兵行回传） |
| 2 | **登录不经过 Agent** | 未登录时返回 `code=unauthorized` 并调用 ego `task.handOff()` 把浏览器交给用户；工具返回文本里不含任何 Agent 生成的登录话术 |
| 3 | **写操作三重护栏** | 全局串行 + 随机最小间隔 + 窗口频率上限，三者**没有开关**，配置只能往上调 |
| 4 | **输出结构化** | 每次调用返回唯一 canonical JSON；`ok` 以外的结果都写在 `code`/`reason` 里，不抛异常 |

## 依赖

**ego-browser CLI**（ego lite，不是 MCP）。本机实测：

```
<ego 安装目录>/active_version_dir/ego-browser.exe   (0.6.0.22 / chromium 154)
ego-browser skill      # 读内置用法指南
```

插件按此顺序定位可执行文件：

1. 插件配置 `egoPath`
2. 环境变量 `EGO_BROWSER_PATH`
3. `%LOCALAPPDATA%\ego\`、`~/.local/share/ego/active_version_dir[/<version>]/ego-browser[.exe]`
4. `PATH` 中的 `ego-browser`

前两级**显式指定时不回落**——指错立刻返回 `unavailable{reason:'ego_browser_not_found', checked:[...]}`，不会悄悄换一个 ego。

ego 空间名：**`dsh-web-ai-discuss`**（固定）。空间刻意**不**调用 `task.finish()`，因此对话可持续追问；副作用是该空间由 ego 长期持有。

## 安装

克隆本仓库到本地任意目录（例如 `<你的工作区>/dsh-web-ai-discuss`），然后：

```js
plugin_manager({ action: 'install_bundle', target: '<绝对路径>/dsh-web-ai-discuss' })
```

- 本地目录安装是 **link**（改代码后 `set_bundle enabled:false → true` 即热重载）
- 替换已安装的同名包需要重启 dsh
- 不要手工编辑 profile 的 `package.json` 或 `cordis.patch.yml`

## 工具契约

### `web_ai_discuss`

| 参数 | 类型 | 说明 |
|---|---|---|
| `prompt` | string，必填 | 完整提问，写清目标与期望产出 |
| `topic` | string | 索引用短标题，省略取 prompt 前 48 字 |
| `context` | string | 附在提问后的补充上下文 |
| `newChat` | boolean | 默认 `true`（推荐）：先回新会话，气泡从零开始，发送/完成判定最可靠；显式 `false` 沿用当前网页会话 |
| `followUp` | string | 历史讨论 id（`d-YYYYMMDD-...`），自动把那条问答折进 context——默认新会话下携带上文的主通道 |
| `timeoutMs` | integer | 30000–600000，默认取配置 |

返回字段：`tool` `code` `reason` `message` `at` `sessionKey`，以及按分支出现的 `answer` `answerChars` `discussionId` `polls` `elapsedMs` `bubblesBefore` `bubblesAfter` `guardrails` `handoff` `retryAfterMs` `partial`。

### `web_ai_read_discussion`

`id`（读指定讨论）、`limit`（1–20，默认 3）、`live`（`true` 时现读 ego 空间当前页面的回答气泡）。**纯读，不产生任何网页写操作。**

### `web_ai_status`

`probe`（`true` 时执行只读页面探针，耗时数秒）。返回 ego 定位结果、空间名、存储目录、护栏参数与用量、最近讨论索引。

### 返回码

`ok` `invalid` `busy` `rate_limited` `unauthorized` `unavailable` `timeout` `failed` `not_found`

- `busy` —— 已有讨论在跑（并发立刻返回，不排队）
- `rate_limited` —— 窗口配额用尽，带 `retryAfterMs`
- `unauthorized` —— 网页端要人接管，浏览器已交出去，`handoff.started=true`
- `timeout` —— 等到超时仍没等到稳定回答，`partial` 给已抓到的片段
- `unavailable` —— 本机找不到 ego-browser

## 护栏参数

`cordis.patch.yml` 里的 `config`：

```yaml
minGapMs: 7000      # 两次讨论最小间隔（下限 5000）
jitterMs: 3000      # 叠加 0–3000ms 随机抖动（下限 1000）
windowMs: 3600000   # 频率窗口
windowLimit: 6      # 窗口内最多 6 次（上限 20）
pollMs: 900         # 轮询间隔（下限 500）
stableSamples: 3    # 连续几次相同判定完成（下限 2）
```

下限写死在 `lib/config.js` 的 `FLOOR`，`resolveConfig` 只会向上钳制——**没有任何配置能把护栏关掉**。

## 界面

三处入口，位置可配（见下节 `placement`）：

| 位置 | 内容 |
|---|---|
| 侧边栏格子 | 图标入口（气泡几何图形，选中态不降透明度），点了切到中央面板 |
| 中央面板 `main` | 标题 + 构建戳 `build x.y.z`、定位说明、调用模板（一键复制）、`用法与说明`（三重护栏 / 返回码 / 已知限制）、`自定义设置` |
| 会话工具卡片 | 每次 `web_ai_discuss` 的结果卡片：返回码徽章、耗时、`discussionId`（可直接传给 `followUp`）、回答原文、一键复制回答；失败态显示 `reason` / `message` / 半成品 `partial` |
| 设置页分区 | `placement` 含 `settings` 时，在设置里占一页，内容与中央面板一致 |
| 输入框下方 | `composerDock=true` 且 `placement` 含侧边栏时，输入框下方多一个快捷入口 |

设计约束（与宿主共存，不抢戏）：

- 只用 `--dsw-alias-*` 主题 token，亮暗两套都实测过对比度（正文 ≥4.5:1，最小字号 12px）；
- 交互状态（hover / focus-visible / active / disabled / 选中 / 滚动条）由注入的命名空间 CSS `.wai-*` 承担，不覆盖宿主选择器；
- 首屏零网络：两个折叠区都懒挂载，`自定义设置` 展开才 fetch 一次，`formCache` 之后秒开；
- 输入框全部非受控，输入不触发 React 渲染；工具卡片 `React.memo` + `WeakMap` 缓存解析结果。

> 看到面板头部的 `build` 戳 = 浏览器跑的是这版代码；看不到 = client 模块没装载（宿主重启后需 `Ctrl+R` 刷新页面，或插件被禁用）。

### 离线视觉验收

本机 GUI 需要进程内 launch token，截图通道不可用，因此提供两条不能骗人的验证路径：

```bash
node test/render.mjs     # 用真实组件函数渲染静态页到 out/panel*.html（含亮/暗、折叠/展开四种）
node test/client.mjs     # 桩 React 加载真实 client.js：slot 注册、文案、渲染、位置切换 39 条断言
```

`out/panel-expanded.html` 可直接用浏览器打开看完整表单；`test/render.mjs` 里的序列化器保留 SVG 的
`viewBox` / `width` / `height`，否则图标会按浏览器默认 300×150 撑开把布局撑坏（踩过）。

## 自定义设置（GUI 可编辑，保存即生效）

侧边栏「DeepSeek 讨论」面板的**自定义设置**区可以直接改，不必碰文件；保存写入
`<storeDir>/settings.json`，**叠加在 patch 默认值之上**，宿主进程内热生效（下一次
`web_ai_status` / `web_ai_discuss` 即读到新值，无需重启）。

| 字段 | 含义 | 约束 |
|---|---|---|
| `placement` | **插件显示位置**：`sidebar`（仅侧边栏图标）/ `settings`（仅设置页分区）/ `both` | 保存后几秒内自动挪动入口，或刷新页面立即生效；会话里的结果卡片不受影响 |
| `composerDock` | 主界面输入框下方显示 `◈ DeepSeek 讨论` 快捷入口 | 仅在 placement 含侧边栏时有效 |
| `minGapMs` / `jitterMs` / `windowMs` / `windowLimit` | 三重护栏的间隔 / 抖动 / 窗口 / 上限 | 护栏下限钳制，**关不掉** |
| `pollMs` / `stableSamples` | 轮询间隔 / 判完成的连续稳定采样数 | 下限 500ms / 2 次 |
| `sendTimeoutMs` | 单次等待回答的最长时长 | 30s–600s |
| `defaultNewChat` | 每次 discuss 默认是否开新会话 | 关掉后沿用当前网页会话 |
| `maxAnswerChars` / `followUpChars` | 答案长度 / followUp 历史答案折进 context 的截断 | 钳制 |
| `systemPromptSection` | 是否往系统提示注入使用引导片段 | 开关 |
| `webhookUrl` / `webhookTimeoutMs` | discuss 成功后 POST 事件 JSON | URL 为空=关 |
| `hooksFile` | 用户自写 ESM 钩子模块的绝对路径，导出 `onEvent(event,payload)` | 路径为空=关；改动即时生效（import 带 cache-bust） |

HTTP 契约（同源守卫，exact 路由 `/web-ai-discuss/api/settings`）：

- `GET` → `{editable, floor, settings, effective}`
- `POST {…字段}` → 校验白名单 → 合并落盘 → 热应用 → `{ok, settings, effective}`；
  未知字段忽略，非法值 `400 invalid_field_values`（列出 fields），跨源 `403`

`egoPath` / `storeDir` / `spaceName` / `url` 这类**定位字段不进白名单**（改了可能指错 ego），
仍只能在 `cordis.patch.yml` 里改。想重置一切：删掉 `settings.json`。

## 编排步骤（`web_ai_discuss`）

1. 护栏取票（busy / 间隔 / 配额）；`followUp` 先折历史问答进 context
2. 定位 ego 可执行文件
3. 生成 ego 脚本：`taskSpace('dsh-web-ai-discuss')` → 取/建页面 → 必要时 `goto`（默认 `newChat=true` 会先回新会话）→ 等输入框
4. 读页面状态：输入框存在？被禁用？有登录弹窗？已有几个回答气泡？
5. 未登录 → `task.handOff()` → 返回 `unauthorized`
6. **滚动到底**（真正的聊天滚动容器是 `div[class*="ds-virtual-list--printable"]`，虚拟列表只有贴底才渲染新消息）→ 填入（`fill` → evaluate 原生 setter → `keyboard.paste` 三级兜底）
7. **发送强确认**：Enter 后按「用户消息数上涨」判定送达（输入框清空不代表送达，偶发被吞），1.8s 未确认→点发送按钮 / 重新填入，最多 3 次；仍未确认 → 快速返回 `failed/send_failed`（不白等超时）
8. 轮询：每次采样前恢复贴底（生成期重渲染会破坏贴底状态），判据 = 用户消息数 > baseline 且最后一条 `div[class*="assistant-message-main-content"]`（**排除** `ds-think-content` 思考块）文本连续 `stableSamples` 次相同
9. 清洗（去行尾空白、压缩空行、限长）、落盘、返回

> 可靠性结论（多轮 e2e 实证）：assistant 气泡数与 ds-message 计数在重渲染时都会瞬时非单调，只有「贴底视口内的增量」可用；即便如此，长会话中生成期视口仍可能漂移，所以默认每次开新会话（`newChat=true`），跨轮上文用 `followUp` 承担——新会话气泡从零开始，判据天然可靠。

## 存储

```
<DSH_HOME>/storages/web-ai-discuss/
  index.json          最近 200 条索引
  <discussionId>.json 单条全文
  tmp/                ego 结果中转文件，按 mtime 1h 清理
```

`discussionId` 形如 `d-20261024-220234-da74`。

## 测试

```bash
node test/cases.mjs    # 宿主侧契约与护栏，10/10
node test/client.mjs   # 客户端注册与渲染（桩 React），30/30
node test/smoke.mjs status|probe|read|discuss "问题"   # 真实 ego 冒烟
```

`test/cases.mjs` 用「把 egoPath 换成 node.exe + 一个名为 `nodejs` 的替身文件」的办法，让真实 `registerTools` 拿到可控的 ego 返回值，从而覆盖 unavailable / unauthorized / busy / rate_limited / timeout / failed 全部分支。

## 已知限制

- **没有 ego MCP 工具可依赖**：本环境 ego 只有 CLI，插件以子进程方式调用它（脚本走 stdin，结果走文件 + stderr 哨兵行）
- 讨论空间常驻 ego，插件不调用 `finish`；需要清理时在 ego 侧手动处理
- 护栏作用域是**插件进程**，跨进程并发不在保护范围内
- 网页 DOM 改版会导致选择器失效，届时更新 `lib/script.js`（三处）
- 侧边栏面板只承载静态说明：宿主与客户端之间没有通用数据通道，真实结果在会话里的工具卡片上
- 网页端「思考过程」是另一个 `ds-markdown` 节点，选择器已按 `assistant-message-main-content` 精确排除
- **长会话连发同一问题的可靠性依赖 `newChat=true` 默认值**：`newChat=false` 沿用旧会话时，虚拟列表 + 重渲染抖动可能导致完成判定超时（发送本身已有多重确认兜底）；确需追问请配 `followUp`
- `lib/hooks.js` 双出口（`webhookUrl` / `hooksFile`）是自定义扩展点：`discuss.ok` 事件推送 `{id,title,prompt,answer,elapsedMs,discussionId}`，钩子异常只进 `notify` 不影响返回码

## 文件结构

```
dsh-web-ai-discuss/
  package.json          # bundle + client 声明、locale/icon 导出
  cordis.patch.yml      # 插件行与默认 config
  index.js              # apply：配置 → 护栏 → 系统提示片段 → 注册工具
  lib/config.js         # 常量、FLOOR、resolveConfig 钳制
  lib/ego.js            # ego 定位、子进程执行、结果读取
  lib/script.js         # 生成 ego 脚本文本（probe/read/discuss）
  lib/guard.js          # 三重护栏
  lib/store.js          # 讨论落盘与索引
  lib/tools.js          # 三个工具定义与返回码映射
  client.js             # 侧边栏图标 + 中央面板 + 工具卡片
  locale/{zh,en}.json   # Plugin Manager 展示元数据
  icon.svg              # 原创图标
  test/                 # cases / client / smoke
```
