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
| `preset` | string | 可选的**预设提示词** id，可带档位：`review` 或 `review:strict`（见下节）；把你的提问套进固定回答结构；原始提问原样保留 |
| `presetLevel` | string | 单独的档位参数（`light` / `normal` / `strict`），优先于 `preset` 里写的档位；与 `preset` 内档位冲突 → `preset_level_conflict` |
| `topic` | string | 索引用短标题，省略取 prompt 前 48 字 |
| `context` | string | 附在提问后的补充上下文 |
| `newChat` | boolean | 默认 `true`（推荐）：先回新会话，气泡从零开始，发送/完成判定最可靠；显式 `false` 沿用当前网页会话 |
| `followUp` | string | 历史讨论 id（`d-YYYYMMDD-...`），自动把那条问答折进 context——默认新会话下携带上文的主通道 |
| `attachments` | string[] | 要一并上传给网页版的附件**绝对路径**（最多 5 个） |
| `timeoutMs` | integer | 30000–600000，默认取配置 |

返回字段：`tool` `code` `reason` `message` `at` `sessionKey`，以及按分支出现的 `answer` `answerChars` `discussionId` `polls` `elapsedMs` `bubblesBefore` `bubblesAfter` `guardrails` `handoff` `retryAfterMs` `partial` `attachments` `preset` `presetLevel`。

### 预设提示词与档位

`preset` 给网页版 DeepSeek 一个**提问框架**：它只加回答结构，不改写你的提问——原始提问始终原样附在
「待评审内容 / 待对比内容 / …」之后。8 条预设：

| id | 作用 | 回答结构 |
|---|---|---|
| `review` | 方案评审 | 致命问题 / 重要问题 / 可商榷 / 只改一处改哪里 |
| `compare` | 方案对比 | 对比维度 → 表格 → 推荐项及成立条件 |
| `counterexample` | 找反例 | 反例清单 → 最致命的一个 → 结论需要的限定条件 |
| `oppose` | 唱反调 | 最强反对论据 ×3 → 依赖假设 → 成立条件 |
| `simplify` | 做减法 | 可整段删掉的 → 最小版本 → 牺牲什么 |
| `plan` | 落地拆解 | 有序步骤与完成判据 → 依赖 → 最易崩的 2–3 步与兜底 |
| `diagnose` | 排障思路 | 候选原因与可能性 → 每因验证方法 → 排查顺序与最可能根因 |
| `expand` | 拓展可能 | 非常规方向 → 最值得试的一条 → 共享的隐含前提 |

每条预设都有**三档强度**，同一套框架、不同狠度：

| 档位 | 强度 | 模板长度 | 用途 |
|---|---|---|---|
| `light` | 轻 | 1–2 句（≤200 字符） | 只想要一个结论，别长篇大论 |
| `normal` | 标准（默认） | 3–4 行 | 常规的评审 / 对比 / 拆解 |
| `strict` | 严 | 4–5 行 | 要它专找会推翻结论的问题 |

- 两种写法：`preset="review:strict"`（id 与档位写一起）或 `preset="review"` + `presetLevel="strict"`；
  两者同时给且档位不一致 → `code=invalid`，`reason=preset_level_conflict`
- 档位不认识 → `code=invalid`，`reason=unknown_preset_level`，返回 `available`
- 预设 id 不认识 → `code=invalid`，`reason=unknown_preset`，返回 `available`；**两种校验都在护栏取票之前，不消耗讨论配额**
- 模板长度是**硬约束**：轻档模板必须 ≤200 字符（`test/cases.mjs` 断言），避免把长指令塞进 token
- 落盘记录里 `prompt` 存的是**原始提问**、`preset` 存预设 id、`presetLevel` 存档位——检索与复盘看到的是你真正问的东西
- 预设集是插件常量（`lib/presets.js`），不落盘、不进设置项；面板「预设」分区可切换档位、一键复制模板或复制调用语句

### 附件上传

`attachments` 里的文件会通过网页端的上传控件交给 DeepSeek 自己读——插件不读文件内容，
只是把它塞进网页的 `input[type=file]`，等附件 chip 出现（文件名出现在输入框上方）才算上传完成。

- 必须是**绝对路径**的普通文件；相对路径、文件不存在、目录、超过 20MB 一律 `code=invalid`
- 路径校验发生在**护栏取票之前**——写错路径不会白白消耗一次讨论配额
- 上传没成功（网页端没有文件控件、chip 没出现）→ `code=failed`，`reason` 为
  `attachment_upload_failed` / `attachment_not_ready`
- 成功时返回 `attachments`（路径数组）与 `attachmentInfo`（`uploaded` / `chipsVisible` / `hasFileInput`）

### `web_ai_read_discussion`

`id`（读指定讨论）、`limit`（1–20，默认 3）、`live`（`true` 时现读 ego 空间当前页面的回答气泡）。**纯读，不产生任何网页写操作。**

### `web_ai_status`

`probe`（`true` 时执行只读页面探针，耗时数秒）。返回 ego 定位结果、空间名、存储目录、护栏参数与用量、最近讨论索引，以及 `presets`（可用预设清单）。

### 返回码

`ok` `invalid` `busy` `rate_limited` `unauthorized` `unavailable` `timeout` `failed` `not_found`

- `busy` —— 已有讨论在跑（并发立刻返回，不排队）
- `rate_limited` —— 窗口配额用尽，带 `retryAfterMs`
- `unauthorized` —— 网页端要人接管，浏览器已交出去，`handoff.started=true`
- `timeout` —— 等到超时仍没等到稳定回答，`partial` 给已抓到的片段
- `unavailable` —— 本机找不到 ego-browser
- `not_found` —— 讨论 id 不存在**或不合法**（id 必须匹配 `d-YYYYMMDD-HHMMSS-xxxx`，防止路径穿越）
- `invalid` + `reason=unknown_preset` —— `preset` 传了不认识的 id
- `invalid` + `reason=unknown_preset_level` —— 档位不认识
- `invalid` + `reason=preset_level_conflict` —— `preset` 里写的档位与 `presetLevel` 打架

### 布尔参数容错

`newChat` / `live` / `probe` 同时接受真正的布尔和字符串 `"true"`——模型常把布尔当字符串传，
直接用 `=== true` 判断会静默退回旧行为（基线不干净、探测不执行）。字符串 `"false"` 视为 false。

### ego 空间互斥

`discuss`、`web_ai_read_discussion(live=true)`、`web_ai_status(probe=true)` 都要操作**同一个 ego 任务空间
里的同一个页面**。插件进程内用一把互斥锁串起来：拿不到锁立刻返回 `busy`（`reason='ego_space_busy'`），
不会把正在讨论的页面导航走。

### 运行状态接口

`GET /web-ai-discuss/api/status` —— 护栏用量与空间锁是**运行时**状态（只在宿主进程里），所以现取：

```json
{
  "ok": true,
  "guardrails": { "busy": false, "windowUsed": 2, "windowLimit": 6, "totalCalls": 11,
                  "rejectedBusy": 1, "rejectedRate": 0 },
  "space": { "locked": false, "holder": null },
  "storeStats": { "discussions": 12 },
  "recent": [ { "id": "d-20261027-131502-9a6b", "title": "…", "createdAt": "…" } ],
  "presets": [ { "id": "review", "title": "方案评审", "defaultLevel": "normal",
                 "levels": [ { "id": "light", "title": "轻", "template": "…" },
                             { "id": "normal", "title": "标准", "template": "…" },
                             { "id": "strict", "title": "严", "template": "…" } ] } ],
  "effective": { "minGapMs": 7000, "placement": "sidebar", "…": "…" }
}
```

面板的「运行状态」块就是读它；也可用 `curl` 直接查。

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
| 中央面板 `main` | 标题 + 构建戳 `build x.y.z`、定位说明、**三个分区 Tab**：<br>· **概览**：运行状态块（窗口用量 / ego 空间 / 记录数 / 总调用）、调用模板（一键复制）、`用法与说明`（三重护栏 / 返回码 / 已知限制）<br>· **预设**：档位分段控件（轻 / 标准 / 严）+ 8 条预设（可「看模板」「复制调用」）<br>· **设置**：自定义设置表单 |
| 会话工具卡片 | 每次 `web_ai_discuss` 的结果卡片：返回码徽章、耗时、`discussionId`（可直接传给 `followUp`）、附件文件名、回答原文、一键复制回答；失败态显示 `reason` / `message` / 半成品 `partial` |
| 设置页分区 | `placement` 含 `settings` 时，在设置里占一页；此处**不分区**（表单铺开，设置项必须一眼可见） |
| 输入框下方 | `composerDock=true` 且 `placement` 含侧边栏时，输入框下方多一个快捷入口 |

**为什么侧边栏用 Tab 而不是一路铺开**：宿主侧边栏只有 ~340px 宽，铺开会让人为了看一眼
预设或设置一路往下翻（实测反馈）。改成三个分区后，首屏只留概览，窄栏里**每个分区都在一两屏内看完**。

设计约束（与宿主共存，不抢戏）：

- **只用宿主真实主题 token**：颜色全部来自 `--dsw-alias-label-*` / `--dsw-alias-bg-layer-*` / `--dsw-alias-border-l*` / `--dsw-alias-state-*-primary` / `--dsw-alias-interactive-bg-hover` / `--dsw-radius-*`；
  早期版本用的 `--dsw-alias-text-primary` / `bg-secondary` / `border-primary` / `accent` / `state-success` **在宿主里根本不存在**（`dsh-client-ui-theme` 只定义 `label-*` / `bg-layer-*` / `border-l*` / `state-*-primary`），导致面板完全不继承宿主主题；
- 亮/暗两套主题都做过实测，`impeccable detect` 对渲染产物 **0 告警**（正文对比度 ≥4.5:1，最小字号 11.5px 仅用于等宽 id / 数字）；
- **窄栏用容器查询而非媒体查询**：宿主面板按容器宽度布局（侧边栏 340px 也能用），`@container wai (max-width: 460px)` 负责单列化，媒体查询在宿主里不生效；
  窄栏下指标网格固定两列（避免 3+1 的孤儿列）、档位说明另起一行；
- **容器查询锚点必须在 `.wai-shell` 上，不能在 `.wai-root` 上**：`@container` 只匹配容器的**后代**，规则写在自己身上一条都不会命中。
  所以 `Panel` 渲染的是 `.wai-shell`（`container-type: inline-size` / `container-name: wai`）包一层 `.wai-root`（纯滚动容器）。
  早期把 `container-type` 直接放在 `.wai-root` 上，于是所有 `.wai-root { padding }` 之类的窄栏覆写全部静默失效 —— 这类 bug 不会报错，只会「看着没生效」；
- **宽度策略：结构块铺满，成段文字按 72ch 收口**。`.wai-wrap` 是 `max-width: 100%`（不再是 `68ch`），
  指标网格、预设行、设置字段这些结构块用满可用宽度；只有 `.wai-text` / `.wai-list > li` 这类整段说明文字按 `72ch` 封顶，
  避免宽栏下正文被拉成超长单行。宽栏（`@container wai (min-width: 620px)`）额外把设置项排成两列、`.wai-field-wide`（Webhook URL / 钩子模块）跨整行、
  Tab 条按内容收口、预设行合成单行（id/名称 → 说明 → 操作）、说明块 `72ch` 收口；
  运行状态那四个指标在宽栏下是「均分但整条 `max-width: 620px`」——纯均分会让 `2 / 6` 和 `11` 隔屏相望，纯按内容取宽又把它们挤到左半边；
- **保存条吸底**：`.wai-actions-sticky` 用 `bottom: calc(-1 * var(--wai-pad-b))` + 等值负 margin 把底边贴平滚动区，
  设置很长时不用滚回去点保存；`--wai-pad-b` 在窄栏覆写为 26px，两个方向同时跟着变，不会留一条横贯的白带；
- 交互状态（hover / focus-visible / active / disabled / 选中 / 滚动条 / 选区）由注入的命名空间 CSS `.wai-*` 承担，不覆盖宿主选择器；
- 首屏零额外网络：概览只读一次 `/status`，预设与设置分区**切过去才挂载并 fetch**；
- 输入框全部非受控，输入不触发 React 渲染；工具卡片 `React.memo` + `WeakMap` 缓存解析结果。

> 看到面板头部的 `build` 戳 = 浏览器跑的是这版代码；看不到 = client 模块没装载（宿主重启后需 `Ctrl+R` 刷新页面，或插件被禁用）。

### 副作用托管：为什么定时器和观察器必须挂 `pluginCtx.effect`

宿主替换客户端模块（HMR / 重装 / 改配置）时只销毁该 fiber 的 effect，**不会**替你清理裸
`setTimeout` / `setInterval` / `MutationObserver` / DOM 事件监听。

早期实现把自诊断定时器、挂载观察器、配置兜底轮询都裸跑在 `apply()` 里，于是每次换模块都留下一个
「僵尸实例」：旧实例的定时器继续跑、继续上报诊断、旧 JSX 继续赖在页面上。

> 实测症状：同一个页面里 20 条诊断上报中 **19 条来自旧版本实例**（`build 0.4.0`），只有 1 条来自新实例
> （`build 0.4.2`）；DOM 里能查到新 CSS（`.wai-tabs` 等规则已生效），但面板结构仍是旧版。
> 这不是缓存问题，而是旧 `apply()` 从未退场。

现在的 `apply()`（`client.js`）把所有活体资源放进**一个** `pluginCtx.effect(setupRuntime)`，返回的清理函数会：

1. 置位 `diagDone`（旧实例立刻停止上报）；
2. `clearTimeout` / `clearInterval`；
3. `observer.disconnect()`；
4. 撤掉 `mount()` 注册的入口（`disposers`）；
5. 仅当 `uiReload` 仍指向自己时才置空（新实例接管后不能被旧实例清掉）。

清理函数幂等，重复调用安全。极老宿主没有 `ctx.effect` 时退化为「只跑一次、不清理」，至少不抛异常。

回归测试在 `test/client.mjs` 末尾的「退场清理」用例：桩 `MutationObserver` 与 `clearTimeout/clearInterval`
计数，断言 `dispose()` 后观察器已断开、定时器已清除、重复销毁安全。把清理体注释掉，该用例会失败（2 条 FAIL）。

### 样式注入：为什么必须「刷新」而不是「存在就跳过」

宿主里的 `<style>` 是**常驻 DOM**，插件热重载（HMR）或重新装载时只更新 JSX，旧 `<style>` 仍在文档里。
早期实现是「`document.getElementById(STYLE_ID)` 存在就 `return`」，于是 **CSS 被冻结在首次安装时的那一版**：

> 实测症状：面板 JSX 已是 0.4.0（`build 0.4.0` 戳是新的），但宿主里挂着的 `<style>` 仍是 **0.1.0 时代的 CSS**
> （8410 字符 / 63 条规则，含早已删除的 `.wai-sub` / `.wai-chip-card`），而当前 CSS 是 14296 字符 / 105 条规则。
> 结果就是「文字层级和结构对，但所有边框、圆角、背景、网格布局全都没有」——看起来像 CSS 没加载，其实是**加载了旧版**。

现在的 `ensureStyles()`（`client.js`）：

1. 没有 `<style>` → 新建并挂到 `document.head`；
2. 已有但内容不同 → **整段替换** `textContent`；
3. 内容相同 → 不动（避免无谓重排）。

同时给标签打上 `data-plugin` / `data-plugin-css`，让宿主按归属清理样式（与 `dsh-client-ui-schedule` 等宿主自带插件一致）。

回归测试在 `test/styles.mjs`：预置一个**过期**的 `<style>`，断言 `apply()` 之后它被替换成当前 CSS；
把实现改回旧的「存在就跳过」时该测试会失败（3/10 通过）。

### 宿主内自诊断

插件会把宿主里的真实 DOM/CSS 状态回报到宿主侧路由（`GET/POST /web-ai-discuss/api/diag`），
用于「样式到底生效没有」这类只能量、不能猜的问题：

- `styleTag`：本插件 `<style>` 是否存在、在不在 head、规则条数、`.wai-*` 规则数、归属标记；
- `styleTags`：文档里全部 `<style>` 的清单（自己的 + 别人的前若干个），便于对比宿主插件的注入范式；
- `place`：面板元素落在 `document` 还是 shadow root、父链、关键 `getComputedStyle` 值；
- `probe`：**临时注入一个带 `.wai-*` 类名的探针节点**，直接量规则是否生效
  （`.wai-stats` 的 `display:grid`、`.wai-build` 的 `border-radius:999px`、`.wai-list > li` 的 `list-style-type:none` 等）；
- `vars`：宿主主题变量在这张文档里解析成什么值。

上报时机：装载后 1.5s 一次；用 `MutationObserver` 等面板真正挂载后再补一次，之后收工（不长期空转）。

### 离线视觉验收

本机 GUI 需要进程内 launch token，宿主内截图通道不可用；但本机有 Chrome，可以对离线渲染产物做**真实光栅截图**：

```bash
node test/render.mjs     # 用真实组件函数渲染静态页到 out/panel*.html（亮/暗 × 概览/展开/预设/设置 六种）
node test/client.mjs     # 桩 React 加载真实 client.js：slot 注册、文案、渲染、Tab 切换、位置切换 58 条断言

# 真截图（headless Chrome）
chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --user-data-dir="$TEMP/wai-chrome" --window-size=1600,1500 \
  --screenshot="$TEMP/wai-panel.png" "file:///<abs>/out/panel-expanded.html"
```

> 截图必须带 `--no-sandbox` 与独立 `--user-data-dir`，否则 Chrome 在受限目录下写 png 会「拒绝访问」。

`test/render.mjs` 里的页面变量使用**宿主 `dsh-client-ui-theme` 的真实令牌值**（亮暗各一套），
截图因此与宿主真实观感一致，而不是"插件自己的一套假主题"。

已踩过的坑（都是真实缺陷，改 harness 而非绕过）：

- 序列化器保留 SVG 的 `viewBox` / `width` / `height`，否则图标按浏览器默认 300×150 撑开把布局撑坏；
- 序列化器**不能丢弃 `style`**，否则徽章状态色等内联样式在截图里全部丢失（一度让 `ok` 徽标显示成默认色）；
- `open` 属性要单独处理（`details` 折叠块），只改 React state 不会在静态页里展开——否则"展开态"截图其实一直是关着的；
- 页面容器要按内容高度渲染（不能写死 900px），否则展开态底部被裁掉、看不到预设区与设置表单；
- 渲染某个 Tab 分区要直接改 `Tabs` 组件实例的 `useState` 槽位（`inst.slots[0]`），
  只改 React state 的话静态页永远停在第一个分区。

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

1. 护栏取票（busy / 间隔 / 配额）；`followUp` 先折历史问答进 context；`preset` 校验（未知 id / 未知档位 / 档位冲突 → `invalid`，**在取票之前**）；附件路径校验（**也在取票之前**）
2. 定位 ego 可执行文件
3. 生成 ego 脚本：`taskSpace('dsh-web-ai-discuss')` → 取/建页面 → 必要时 `goto`，若 `newChat=true` 再显式点「开启新对话」（DeepSeek 会把首页重定向到上次会话，不点就还是旧会话）→ 等输入框
4. 读页面状态：输入框存在？被禁用？有登录弹窗？已有几个回答气泡？
5. 未登录 → `task.handOff()` → 返回 `unauthorized`
6. **上传附件**（可选）：`setInputFiles('input[type=file]', [...])` → 等附件 chip 出现（文件名进入正文）才算完成
7. **套预设框架**（可选）：按 `preset` + 档位取对应模板，模板里的 `{prompt}` 替换成你的原始提问（+ context），只加结构不改写提问
8. **滚动到底**（真正的聊天滚动容器是 `div[class*="ds-virtual-list--printable"]`，虚拟列表只有贴底才渲染新消息）→ 填入（`fill` → evaluate 原生 setter → `keyboard.paste` 三级兜底）
9. **发送强确认**：Enter 后按「用户消息数上涨」判定送达（输入框清空不代表送达，偶发被吞），1.8s 未确认→点发送按钮 / 重新填入，最多 3 次；仍未确认 → 快速返回 `failed/send_failed`（不白等超时）
10. 轮询：每次采样前恢复贴底（生成期重渲染会破坏贴底状态），判据 = 用户消息数 > baseline 且最后一条 `div[class*="assistant-message-main-content"]`（**排除** `ds-think-content` 思考块）文本连续 `stableSamples` 次相同
11. 清洗（去行尾空白、压缩空行、限长）、落盘、返回

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
node test/cases.mjs    # 宿主侧契约与护栏，24/24
node test/client.mjs   # 客户端注册与渲染（桩 React），58/58
node test/styles.mjs   # 样式注入回归（过期 <style> 必须被替换），10/10
node test/render.mjs   # 离线渲染 out/panel*.html（亮/暗 × 概览/展开/预设/设置）
node test/smoke.mjs status|probe|read|discuss "问题"   # 真实 ego 冒烟
node test/smoke.mjs preset review:strict "问题"        # 预设 + 档位的真实冒烟
```

`test/cases.mjs` 用「把 egoPath 换成 node.exe + 一个名为 `nodejs` 的替身文件」的办法，让真实 `registerTools` 拿到可控的 ego 返回值，从而覆盖 unavailable / unauthorized / busy / rate_limited / timeout / failed 全部分支。覆盖的边界还有：路径穿越 id、ego 空间互斥、布尔字符串容错、附件路径校验（且校验失败不消耗配额）、等待间隔期间被取消后护栏是否归位、preset 合法套用与非法 id 拦截（同样不消耗配额）、preset 档位（`id:level` / `presetLevel` 覆盖 / 非法档位 / 档位冲突）。

> 桩 React 按**组件实例**存状态（真实 React 的语义）。早期版本按全局 hook 序号存，导致折叠块展开后新挂载的组件串到别的组件的状态槽上——那是测试桩的保真度问题，不是插件缺陷。

`test/styles.mjs` 复现「宿主里挂着过期 `<style>`」这个真实缺陷：预置一个内容是 0.1.0 时代的样式标签，
断言 `apply()` 之后它被替换成当前 CSS（并带上 `data-plugin` 归属标记）；把实现改回旧的「存在就跳过」时它会失败。

## 已知限制

- **没有 ego MCP 工具可依赖**：本环境 ego 只有 CLI，插件以子进程方式调用它（脚本走 stdin，结果走文件 + stderr 哨兵行）
- 讨论空间常驻 ego，插件不调用 `finish`；需要清理时在 ego 侧手动处理
- 护栏作用域是**插件进程**，跨进程并发不在保护范围内
- 网页 DOM 改版会导致选择器失效，届时更新 `lib/script.js`（输入框 / 新对话按钮 / 滚动容器 / 回答气泡 / 文件控件等处）
- 附件走的是网页自己的上传控件，**文件先被传到 DeepSeek 服务器**再被模型读取——插件只负责把路径塞进控件并等 chip 出现，不解析内容；大文件的上传耗时取决于网页端与网络
- 附件上限是插件自己的约束（5 个 / 单个 20MB / 必须绝对路径），不是网页端的限制
- 侧边栏面板主要承载说明与运行状态；宿主与客户端之间没有通用数据通道，逐条讨论结果在会话里的工具卡片上
- 网页端「思考过程」是另一个 `ds-markdown` 节点，选择器已按 `assistant-message-main-content` 精确排除
- **长会话连发同一问题的可靠性依赖 `newChat=true` 默认值**：`newChat=false` 沿用旧会话时，虚拟列表 + 重渲染抖动可能导致完成判定超时（发送本身已有多重确认兜底）；确需追问请配 `followUp`
- `lib/hooks.js` 双出口（`webhookUrl` / `hooksFile`）是自定义扩展点：`discuss.ok` 事件推送 `{id,title,prompt,answer,elapsedMs,discussionId}`，钩子异常只进 `notify` 不影响返回码
- 预设提示词是**提问框架**，不是答案模板：框架给的是回答结构，结论仍由网页版模型给；预设集不可在设置页增删（避免配置面膨胀）
- 预设档位只改**框架的严格程度与模板长度**，不改变回答结构的语义；轻档模板刻意压到 ≤200 字符，长问题本身另算 token
- 侧边栏面板按**三个 Tab 分区**呈现；设置页分区不分区（铺开）。Tab 状态不落盘，刷新后回到「概览」
- 面板配色依赖宿主 `dsh-client-ui-theme` 提供的 `--dsw-alias-*` 令牌；宿主换主题体系时需要同步改 `client.js` 里的 CSS 变量名（CSS 里都写了 fallback 值，不会白屏，但会失去主题跟随）
- 宿主里的 `<style>` 常驻 DOM，样式必须**按内容比对后替换**而不是「存在就跳过」；否则插件升级后界面会停在旧版样式（已修 + `test/styles.mjs` 回归）
- 宿主内没有通用的「截图」通道；`/web-ai-discuss/api/diag` 的 `probe` 段用临时探针节点量「规则是否生效」，是当前唯一能在宿主里验证样式落地的方式

## 文件结构

```
dsh-web-ai-discuss/
  package.json          # bundle + client 声明、locale/icon 导出
  cordis.patch.yml      # 插件行与默认 config
  index.js              # apply：配置 → 护栏 → 系统提示片段 → 注册工具
  lib/config.js         # 常量、FLOOR、resolveConfig 钳制
  lib/ego.js            # ego 定位、子进程执行、结果读取
  lib/script.js         # 生成 ego 脚本文本（probe/read/discuss，含附件上传段）
  lib/guard.js          # 三重护栏
  lib/mutex.js          # ego 空间互斥锁（discuss / live 读 / probe 共用同一页面）
  lib/presets.js        # 预设提示词库（8 条提问框架 × 3 档强度，带 {prompt} 占位）
  lib/store.js          # 讨论落盘与索引（id 白名单，防路径穿越；记录 attachments / presetLevel）
  lib/tools.js          # 三个工具定义、返回码映射、附件路径校验、preset + 档位套用
  client.js             # 侧边栏图标 + 中央面板（Tab 分区）+ 运行状态块 + 预设块 + 工具卡片
  locale/{zh,en}.json   # Plugin Manager 展示元数据
  icon.svg              # 原创图标
  test/                 # cases / client / styles / render / smoke
```
