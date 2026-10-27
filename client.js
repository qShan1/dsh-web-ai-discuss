/**
 * dsh-web-ai-discuss — 客户端（浏览器侧）模块。v0.4.0（未发布开发版）
 *
 * 三块 UI：
 *   1. sidebar.panellist  侧边栏格子（图标）
 *   2. main               中央面板：紧凑层级，静态说明折叠，设置区展开才挂载/请求
 *   3. tool.call.toolview web_ai_discuss 的会话卡片（每会话首次挂载自动开面板一次）
 *
 * 样式约定：
 *   - 全部走宿主主题 token（--dsw-alias-*），只带安全 fallback；
 *   - 不做系统字体以外的字体替换：面板要融进宿主，不抢戏；
 *   - 交互状态（hover / focus-visible / active / disabled）由注入的命名空间 CSS 承担，
 *     内联样式只负责结构性尺寸。
 *
 * 性能约定：
 *   - 面板首屏零网络：设置表单只在折叠展开时挂载并 fetch 一次，结果模块级缓存；
 *   - 输入框全部非受控（defaultValue），输入不触发 React 渲染；
 *   - 静态文案 React.memo，重渲染时子树引用不变直接跳过；
 *   - fetch 带 AbortController，卸载即中止。
 */

window.__ModuleLoader__.load({
  id: 'dsh-web-ai-discuss',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'web-ai-discuss';
    const TOOL_DISCUSS = 'web_ai_discuss';
    const SETTINGS_API = '/web-ai-discuss/api/settings';
    // 构建戳：面板头部显示。看到它 = 浏览器在跑这版代码；看不到 = client 模块没装载。
    const CLIENT_BUILD = '0.4.0';

    const isZh = () => {
      try {
        return String(navigator.language || 'zh').toLowerCase().startsWith('zh');
      } catch (e) {
        return true;
      }
    };

    const T = isZh()
      ? {
        panel: 'DeepSeek 讨论',
        title: '外部讨论通道',
        lead: '把已登录的网页版 DeepSeek 当作外部思路来源。网页操作全部经本机 ego lite 完成，不构造协议、不接管登录。',
        when: '只在需要多角度讨论、评审、方案对比或找反例时调用；日常问答、事实查询、代码补全不要走这里。',
        store: '讨论记录落在 DSH 存储目录的 web-ai-discuss/ 下，用 web_ai_read_discussion 读回（id / search / live）。',
        usageTitle: '用法与说明',
        template: '用 web_ai_discuss 和 DeepSeek 讨论：',
        copy: '复制调用模板',
        copyAnswer: '复制',
        empty: '这次调用没有带回内容。',
        copied: '已复制',
        settingsTitle: '自定义设置',
        settingsHint: '写入 settings.json，叠加在 patch 默认值之上，保存即生效。护栏只能往上调；egoPath / storeDir / 空间名这类定位字段仍只走 cordis.patch.yml。',
        settingsLoading: '读取设置…',
        settingsLoadFail: '读取设置失败（宿主路由未挂载？）',
        settingsRetry: '重试',
        settingsSave: '保存修改',
        settingsSaving: '保存中…',
        settingsSaved: '已保存并生效',
        settingsFail: '保存失败',
        settingsFloor: '下限',
        settingsReload: '重新读取',
        settingsRestore: '恢复默认',
        groupUi: '显示位置',
        groupGuard: '护栏',
        groupJudge: '发送与判定',
        groupOutput: '输出与扩展',
        placementLabel: '入口位置',
        placementOpts: { sidebar: '侧边栏图标', settings: '设置页分区', both: '两处都显示' },
        dockLabel: '输入框下方快捷入口',
        placementNote: '保存后几秒内自动挪动入口，或刷新页面立即生效。会话里的结果卡片不受位置影响。',
        guardTitle: '三重护栏（不可关闭）',
        guards: [
          ['全局串行', '同一时刻只允许一次讨论，并发调用立刻返回 code=busy'],
          ['随机最小间隔', '两次讨论之间至少 7 秒，再加 0–3 秒随机抖动'],
          ['窗口频率上限', '每 60 分钟最多 6 次，超额返回 code=rate_limited'],
        ],
        codesTitle: '返回码',
        codes: [
          ['ok', '拿到回答，answer 为清洗后的原文'],
          ['unauthorized', '网页端需要人接管，浏览器已交给用户；不在对话里转述登录'],
          ['busy', '已有讨论在跑'],
          ['rate_limited', '窗口内次数用尽，带 retryAfterMs'],
          ['unavailable', '本机找不到 ego-browser'],
          ['timeout', '等到超时仍没等到可判定完成的回答'],
          ['send_failed', '三次发送确认都没送达，快速失败不空等'],
        ],
        limitsTitle: '已知限制',
        limits: [
          '依赖本机 ego-browser CLI（无 MCP 形态），插件以子进程方式调用它',
          '讨论空间在 ego 里保持存活以便追问，插件刻意不调用 finish',
          '护栏作用域是插件进程，跨进程并发不在保护范围内',
          '网页改版会影响 DOM 选择器，届时需更新 lib/script.js',
        ],
        liveTitle: '运行状态',
        liveRefresh: '刷新',
        liveLoading: '读取中…',
        liveFail: '读取运行状态失败（宿主路由未挂载？）',
        liveIdle: '空闲',
        liveBusy: '讨论进行中',
        liveQuota: '窗口用量',
        liveSpace: 'ego 空间',
        liveSpaceFree: '空闲',
        liveSpaceHeld: '被占用',
        liveDiscussions: '讨论记录',
        liveTotal: '总调用',
        liveBusyCount: '占用拒绝',
        liveRateCount: '限流拒绝',
        liveNever: '尚无记录',
        presetTitle: '预设提示词',
        presetHint: '把提问套进固定回答结构，原始提问原样保留。调用 web_ai_discuss 时传 preset=<id>。',
        presetCopy: '复制模板',
        presetCopied: '已复制',
        presetFail: '读取预设失败（宿主路由未挂载？）',
        presetEmpty: '暂无可用预设',
      }
      : {
        panel: 'DeepSeek talk',
        title: 'External discussion channel',
        lead: 'Pipes the logged-in DeepSeek web app in as an outside opinion. Every page interaction goes through the local ego lite engine: no protocol construction, no sign-in handling.',
        when: 'Call it only for multi-angle discussion, reviews, option comparisons, or counter-examples. Not for everyday questions, fact lookups, or code completion.',
        store: 'Records land in web-ai-discuss/ under the DSH storage directory; read them back with web_ai_read_discussion (id / search / live).',
        usageTitle: 'Usage & notes',
        template: 'Use web_ai_discuss to discuss with DeepSeek: ',
        copy: 'Copy call template',
        copyAnswer: 'Copy',
        empty: 'This call returned no content.',
        copied: 'Copied',
        settingsTitle: 'Settings',
        settingsHint: 'Saved to settings.json on top of patch defaults, applied live. Guardrails only move upward; egoPath / storeDir / space name stay patch-file only.',
        settingsLoading: 'Loading settings…',
        settingsLoadFail: 'Failed to load settings (host route not mounted?)',
        settingsRetry: 'Retry',
        settingsSave: 'Save changes',
        settingsSaving: 'Saving…',
        settingsSaved: 'Saved and applied',
        settingsFail: 'Save failed',
        settingsFloor: 'min',
        settingsReload: 'Reload',
        settingsRestore: 'Restore defaults',
        groupUi: 'Placement',
        groupGuard: 'Guardrails',
        groupJudge: 'Send & completion',
        groupOutput: 'Output & extensions',
        placementLabel: 'Entry placement',
        placementOpts: { sidebar: 'Sidebar icon', settings: 'Settings section', both: 'Both' },
        dockLabel: 'Composer chip',
        placementNote: 'Takes effect within seconds after saving, or right away after a page refresh. Result cards in the conversation are unaffected.',
        guardTitle: 'Three guardrails (not disableable)',
        guards: [
          ['Global serial', 'One discussion at a time; a concurrent call returns code=busy'],
          ['Random minimum gap', 'At least 7s plus 0-3s jitter between discussions'],
          ['Window quota', 'At most 6 discussions per 60 minutes; beyond that code=rate_limited'],
        ],
        codesTitle: 'Codes',
        codes: [
          ['ok', 'Answer captured and cleaned in answer'],
          ['unauthorized', 'The page needs a human; control was handed off, no sign-in text emitted'],
          ['busy', 'A discussion is already running'],
          ['rate_limited', 'Window quota exhausted, carries retryAfterMs'],
          ['unavailable', 'ego-browser not found on this machine'],
          ['timeout', 'No completable answer before the deadline'],
          ['send_failed', 'Three send confirmations failed; fast fail, no dead wait'],
        ],
        limitsTitle: 'Known limits',
        limits: [
          'Depends on the local ego-browser CLI (no MCP form); invoked as a child process',
          'The discussion space stays alive for follow-ups; the plugin never calls finish',
          'Guardrails are process-scoped; cross-process concurrency is out of scope',
          'Web redesigns can break the DOM selectors in lib/script.js',
        ],
        liveTitle: 'Runtime status',
        liveRefresh: 'Refresh',
        liveLoading: 'Loading…',
        liveFail: 'Failed to read runtime status (host route not mounted?)',
        liveIdle: 'idle',
        liveBusy: 'discussion in progress',
        liveQuota: 'window usage',
        liveSpace: 'ego space',
        liveSpaceFree: 'free',
        liveSpaceHeld: 'held',
        liveDiscussions: 'discussions',
        liveTotal: 'total calls',
        liveBusyCount: 'busy',
        liveRateCount: 'rate',
        liveNever: 'none yet',
        presetTitle: 'Preset prompts',
        presetHint: 'Wrap your question in a fixed answer structure; the original question is kept verbatim. Pass preset=<id> when calling web_ai_discuss.',
        presetCopy: 'Copy template',
        presetCopied: 'Copied',
        presetFail: 'Failed to load presets (host route not mounted?)',
        presetEmpty: 'No presets available',
      };

    /* @wai-css-start */
    const CSS = `
.wai-root {
  container-type: inline-size;
  container-name: wai;
  height: 100%;
  overflow-y: auto;
  padding: 22px 26px 36px;
  font: inherit;
  font-size: 13px;
  line-height: 1.65;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  -webkit-font-smoothing: antialiased;
  --wai-surface: var(--dsw-alias-bg-layer-1, transparent);
  --wai-surface-strong: color-mix(in srgb, var(--dsw-alias-label-primary, #1a1a1a) 8%, transparent);
}
.wai-root * { box-sizing: border-box; }
.wai-wrap { max-width: 68ch; }

/* ── 头部 ── */
.wai-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wai-h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-wrap: balance;
}
.wai-build {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 1px 8px;
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary, #61666b);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  font-variant-numeric: tabular-nums;
}
.wai-lead {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--dsw-alias-label-secondary, #61666b);
}

/* ── 何时调用（静默提示块）── */
.wai-note {
  margin: 16px 0 0;
  padding: 11px 14px;
  border-radius: var(--dsw-radius-md, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  background: var(--wai-surface);
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--dsw-alias-label-secondary, #61666b);
}

/* ── 折叠块 ── */
.wai-fold {
  margin: 22px 0 0;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
}
.wai-fold > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 9px 8px 9px 0;
  margin: 0 -8px 0 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  user-select: none;
  margin-bottom: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  transition: color 120ms ease, background-color 120ms ease;
}
.wai-fold > summary:hover { color: var(--dsw-alias-label-secondary, #61666b); }
.wai-fold > summary::-webkit-details-marker { display: none; }
.wai-fold > summary::marker { content: ''; }
.wai-fold > summary:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 2px;
}
.wai-caret {
  flex: none;
  color: var(--dsw-alias-label-secondary, #61666b);
  transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
}
.wai-fold[open] > summary .wai-caret { transform: rotate(90deg); }
.wai-fold-body { padding: 6px 0 12px; }

/* ── 小节标题 ── */
.wai-section-label {
  margin: 20px 0 4px;
  padding-top: 14px;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-section-label:first-child { margin-top: 6px; padding-top: 0; border-top: 0; }

/* ── 说明行（护栏 / 返回码）── */
.wai-row {
  display: grid;
  grid-template-columns: minmax(78px, max-content) minmax(0, 1fr);
  gap: 3px 16px;
  padding: 6px 0;
  align-items: baseline;
}
.wai-row-k {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-row-d {
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-row-d code, .wai-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  padding: 1px 5px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

/* ── 列表 ── */
.wai-list { margin: 0; padding: 0; list-style: none; }
.wai-list > li {
  position: relative;
  padding: 5px 0 5px 15px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-list > li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 12px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #81858c);
}

/* ── 按钮 ── */
.wai-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.wai-btn {
  font: inherit;
  font-size: 12.5px;
  line-height: 1.2;
  min-height: 30px;
  padding: 6px 12px;
  border-radius: var(--dsw-radius-sm, 8px);
  cursor: pointer;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.wai-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  border-color: var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));
}
.wai-btn:active { transform: translateY(0.5px); }
.wai-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 2px;
}
.wai-btn[disabled] { cursor: default; opacity: 0.5; }
.wai-btn-primary {
  border-color: transparent;
  color: var(--dsw-alias-label-deep-diving, #3261c4);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, transparent);
  font-weight: 600;
}
.wai-btn-primary:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 20%, transparent);
  border-color: transparent;
}
@supports not (background: color-mix(in srgb, red 10%, transparent)) {
  .wai-btn-primary {
    background: #3261c4;
    color: #fff;
  }
}

.wai-btn-ghost {
  border-color: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  min-height: 26px;
  padding: 4px 9px;
  font-size: 12px;
}
.wai-btn-ghost:hover { color: var(--dsw-alias-label-primary, #1a1a1a); }

/* ── 设置表单 ── */
.wai-field {
  display: grid;
  grid-template-columns: minmax(120px, max-content) minmax(0, 170px) minmax(0, max-content);
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  font-size: 12.5px;
}
.wai-field-label { color: var(--dsw-alias-label-primary, #1a1a1a); }
.wai-field-hint {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.wai-input {
  font: inherit;
  font-size: 12.5px;
  width: 100%;
  min-height: 30px;
  padding: 5px 9px;
  border-radius: var(--dsw-radius-sm, 8px);
  color: var(--dsw-alias-label-primary, #1a1a1a);
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
  transition: border-color 120ms ease, background-color 120ms ease;
}
.wai-input:hover { border-color: var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16)); }
.wai-input:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 1px;
}
.wai-input-wide { grid-column: 2 / -1; }
.wai-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  cursor: pointer;
}
.wai-check input { width: 15px; height: 15px; accent-color: var(--dsw-alias-state-business-primary, #4176e6); cursor: pointer; }
.wai-check input:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 2px;
}
.wai-status { margin-top: 10px; font-size: 12px; line-height: 1.5; }
.wai-status-ok { color: var(--dsw-alias-state-success-primary, #22c55e); }
.wai-status-error {
  color: var(--dsw-alias-state-error-primary, #ec1313);
  white-space: pre-wrap;
}

/* ── 运行状态卡 ── */
.wai-live {
  margin-top: 18px;
  padding: 13px 15px 14px;
  border-radius: var(--dsw-radius-lg, 16px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  background: var(--wai-surface);
}
.wai-live-head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.wai-live-title { font-size: 12.5px; font-weight: 600; }
.wai-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex: none;
  background: var(--dsw-alias-state-success-primary, #22c55e);
}
.wai-live-dot[data-busy="true"] { background: var(--dsw-alias-state-warn-primary, #f59e0b); }
.wai-live-dot[data-busy="error"] { background: var(--dsw-alias-state-error-primary, #ec1313); }
.wai-live-state {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-live-refresh { margin-left: auto; }

.wai-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
  gap: 12px 16px;
  margin-top: 13px;
}
.wai-stat { min-width: 0; }
.wai-stat-k {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #61666b);
  white-space: nowrap;
}
.wai-stat-v {
  margin-top: 1px;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.wai-live-meta {
  margin-top: 12px;
  padding-top: 10px;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-variant-numeric: tabular-nums;
}
.wai-live-list { margin: 8px 0 0; padding: 0; list-style: none; }
.wai-live-list li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 4px 0;
  font-size: 12.5px;
}
.wai-live-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #61666b);
  flex: none;
}
.wai-live-title-txt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, #61666b);
}

/* ── 预设提示词 ── */
.wai-preset {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: 14px;
  row-gap: 2px;
  align-items: start;
  padding: 11px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
}
.wai-preset:last-child { border-bottom: 0; }
.wai-preset-head {
  grid-column: 1;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.wai-preset-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #61666b);
  flex: none;
}
.wai-preset-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.wai-preset-hint {
  grid-column: 1;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-preset-action { grid-column: 2; grid-row: 1 / span 2; align-self: center; }

/* ── 结果卡片 ── */
.wai-card {
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-lg, 16px);
  padding: 12px 14px;
  background: var(--wai-surface);
}
.wai-card + .wai-card { margin-top: 10px; }
.wai-card-head { display: flex; flex-direction: column; gap: 6px; }
.wai-card-titlerow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wai-card-metarow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.wai-card-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.wai-card-copy { margin-left: auto; min-height: 24px; padding: 2px 8px; font-size: 12px; }
.wai-card-title { font-size: 12.5px; font-weight: 600; }
.wai-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.4;
  padding: 1px 8px 1px 6px;
  border-radius: 999px;
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--wai-surface-strong);
}
.wai-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex: none;
  background: currentColor;
}
.wai-card-body {
  margin-top: 9px;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  max-height: 320px;
  overflow-y: auto;
  overscroll-behavior: contain;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.wai-muted { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }
.wai-text {
  margin: 0 0 2px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-muted + .wai-muted { margin-top: 4px; }

/* ── 浏览器表面 ── */
.wai-root ::selection, .wai-card ::selection {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 22%, transparent);
}
.wai-root, .wai-card-body {
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, 0.3)) transparent;
}
.wai-root::-webkit-scrollbar, .wai-card-body::-webkit-scrollbar { width: 10px; height: 10px; }
.wai-root::-webkit-scrollbar-thumb, .wai-card-body::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(127, 127, 127, 0.3));
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.wai-root::-webkit-scrollbar-thumb:hover, .wai-card-body::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2, rgba(127, 127, 127, 0.5));
  border: 3px solid transparent;
  background-clip: content-box;
}

@container wai (max-width: 460px) {
  .wai-root { padding: 16px 16px 26px; }
  .wai-field { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .wai-input-wide { grid-column: 1 / -1; }
  .wai-row { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .wai-row-k { font-weight: 600; }
  .wai-preset { grid-template-columns: minmax(0, 1fr); }
  .wai-preset-action { grid-column: 1; grid-row: auto; justify-self: start; margin-top: 8px; }
  .wai-stats { grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 10px 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .wai-caret, .wai-btn, .wai-input, .wai-fold > summary { transition: none; }
}
`;
    /* @wai-css-end */

    const STYLE_ID = 'dsh-web-ai-discuss-styles';
    function ensureStyles() {
      try {
        if (typeof document === 'undefined') return;
        if (document.getElementById(STYLE_ID)) return;
        const el = document.createElement('style');
        el.id = STYLE_ID;
        el.textContent = CSS;
        document.head.appendChild(el);
      } catch (e) { /* 非浏览器环境忽略 */ }
    }

    /** 折叠块（纯 DOM 行为）。说明区也走懒挂载：首屏只渲染标题与摘要。 */
    function Fold(props) {
      const [open, setOpen] = React.useState(false);
      return h('details', {
        className: 'wai-fold',
        open: open || undefined,
        onToggle: (e) => setOpen(!!e.currentTarget.open),
      },
        h('summary', null,
          h(Caret, null),
          h('span', null, props.title)),
        open ? h('div', { className: 'wai-fold-body' }, props.children) : null);
    }

    function Caret() {
      return h('svg', {
        className: 'wai-caret',
        width: 10, height: 10, viewBox: '0 0 10 10',
        fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
      }, h('path', {
        d: 'M3 1.5 6.6 5 3 8.5',
        stroke: 'currentColor', strokeWidth: 1.4,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }));
    }

    const SETTINGS_FIELDS = [
      { key: 'placement', group: 'ui', zh: '入口位置', en: 'Placement', kind: 'select', optKeys: ['sidebar', 'settings', 'both'] },
      { key: 'composerDock', group: 'ui', zh: '输入框下方快捷入口', en: 'Composer chip', kind: 'bool' },
      { key: 'minGapMs', group: 'guard', zh: '最小间隔', en: 'Min gap', unit: 'ms', floorKey: 'minGapMs' },
      { key: 'jitterMs', group: 'guard', zh: '随机抖动', en: 'Jitter', unit: 'ms', floorKey: 'jitterMs' },
      { key: 'windowMs', group: 'guard', zh: '频率窗口', en: 'Window', unit: 'ms', floorKey: 'windowMs' },
      { key: 'windowLimit', group: 'guard', zh: '窗口上限', en: 'Window limit', unit: '次', floorKey: null },
      { key: 'pollMs', group: 'judge', zh: '轮询间隔', en: 'Poll', unit: 'ms', floorKey: 'pollMs' },
      { key: 'stableSamples', group: 'judge', zh: '稳定采样', en: 'Stable samples', unit: '次', floorKey: 'stableSamples' },
      { key: 'sendTimeoutMs', group: 'judge', zh: '回答超时', en: 'Answer timeout', unit: 'ms', floorKey: null },
      { key: 'defaultNewChat', group: 'judge', zh: '默认开新会话', en: 'Default new chat', kind: 'bool' },
      { key: 'maxAnswerChars', group: 'output', zh: '答案长度', en: 'Max answer chars', unit: '字', floorKey: null },
      { key: 'followUpChars', group: 'output', zh: '追问截断', en: 'Follow-up chars', unit: '字', floorKey: null },
      { key: 'systemPromptSection', group: 'output', zh: '注入提示片段', en: 'System prompt section', kind: 'bool' },
      { key: 'webhookUrl', group: 'output', zh: 'Webhook URL', en: 'Webhook URL', kind: 'text', placeholder: 'https://…（留空=关闭）' },
      { key: 'hooksFile', group: 'output', zh: '钩子模块', en: 'Hooks module', kind: 'text', placeholder: 'C:\\path\\hooks.mjs（留空=关闭）' },
    ];

    // 模块级缓存：折叠再展开不重新 fetch；保存/重置后失效。
    let formCache = null;

    function SettingsForm() {
      const [phase, setPhase] = React.useState(formCache ? 'ready' : 'loading');
      const [data, setData] = React.useState(formCache);
      const [error, setError] = React.useState(null);
      const [saveState, setSaveState] = React.useState({ phase: 'idle', message: null });
      const refs = React.useRef({});
      const seq = React.useRef(0);

      const load = React.useCallback((force) => {
        if (!force && formCache) {
          setData(formCache);
          setPhase('ready');
          return () => {};
        }
        const my = ++seq.current;
        const ac = new AbortController();
        setPhase('loading');
        fetch(SETTINGS_API, { cache: 'no-store', signal: ac.signal })
          .then((res) => res.json().then((body) => ({ res, body })))
          .then(({ res, body }) => {
            if (my !== seq.current) return;
            if (!res.ok) throw new Error('HTTP ' + res.status);
            formCache = body;
            setData(body);
            setPhase('ready');
            setError(null);
          })
          .catch((e) => {
            if (my !== seq.current || (e && e.name === 'AbortError')) return;
            setError(String((e && e.message) || e));
            setPhase('error');
          });
        return () => {
          ++seq.current;
          ac.abort();
        };
      }, []);
      React.useEffect(() => load(false), [load]);

      const effective = (data && data.effective) || {};
      const floor = (data && data.floor) || {};

      const collectChanges = () => {
        const out = {};
        for (const f of SETTINGS_FIELDS) {
          const node = refs.current[f.key];
          if (!node) continue;
          if (f.kind === 'bool') {
            if (node.checked !== effective[f.key]) out[f.key] = node.checked;
          } else if (f.kind === 'select') {
            if (node.value !== (effective[f.key] ?? '')) out[f.key] = node.value;
          } else if (f.kind === 'text') {
            const v = node.value.trim();
            if (v !== (effective[f.key] ?? '')) out[f.key] = v;
          } else {
            const n = Number(node.value);
            if (Number.isFinite(n) && Math.trunc(n) !== effective[f.key]) out[f.key] = Math.trunc(n);
          }
        }
        return out;
      };

      const submit = () => {
        const payload = collectChanges();
        if (Object.keys(payload).length === 0) return;
        setSaveState({ phase: 'saving', message: null });
        fetch(SETTINGS_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then((res) => res.json().then((body) => ({ res, body })))
          .then(({ res, body }) => {
            if (!res.ok || !body.ok) {
              const msg = (body && (body.error || body.message)) || 'HTTP ' + res.status;
              const fields = body && body.fields && body.fields.length ? '（' + body.fields.join(', ') + '）' : '';
              throw new Error(msg + fields);
            }
            formCache = null;
            setSaveState({ phase: 'ok', message: T.settingsSaved });
            load(true);
            if (payload.placement !== undefined || payload.composerDock !== undefined) {
              try { if (uiReload) uiReload(); } catch (e) { /* ignore */ }
            }
          })
          .catch((e) => setSaveState({ phase: 'error', message: String((e && e.message) || e) }));
      };

      const restore = () => {
        setSaveState({ phase: 'saving', message: null });
        fetch(SETTINGS_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ __reset: true }),
        })
          .then((res) => res.json().then((body) => ({ res, body })))
          .then(({ res, body }) => {
            if (!res.ok || !body.ok) throw new Error((body && body.error) || 'HTTP ' + res.status);
            formCache = null;
            setSaveState({ phase: 'idle', message: null });
            load(true);
            try { if (uiReload) uiReload(); } catch (e) { /* ignore */ }
          })
          .catch((e) => setSaveState({ phase: 'error', message: String((e && e.message) || e) }));
      };

      if (phase === 'loading') return h('div', { className: 'wai-muted' }, T.settingsLoading);

      if (phase === 'error') {
        return h('div', null,
          h('div', { className: 'wai-status wai-status-error' }, T.settingsLoadFail + '：' + String(error)),
          h('div', { className: 'wai-actions' },
            h('button', { className: 'wai-btn', onClick: () => load(true) }, T.settingsRetry)));
      }

      const groups = [['ui', T.groupUi], ['guard', T.groupGuard], ['judge', T.groupJudge], ['output', T.groupOutput]];
      const bindRef = (key) => (node) => { refs.current[key] = node; };
      const zh = isZh();

      return h('div', null,
        h('div', { className: 'wai-muted' }, T.settingsHint),
        groups.map(([gk, label]) => {
          const fields = SETTINGS_FIELDS.filter((f) => f.group === gk);
          if (fields.length === 0) return null;
          return h('div', { key: gk },
            h('div', { className: 'wai-section-label' }, label),
            gk === 'ui' ? h('div', { className: 'wai-muted', style: { marginBottom: 4 } }, T.placementNote) : null,
            fields.map((f) => {
              const v = effective[f.key];
              if (f.kind === 'bool') {
                return h('div', { className: 'wai-field', key: f.key },
                  h('span', { className: 'wai-field-label' }, zh ? f.zh : f.en),
                  h('label', { className: 'wai-check' },
                    h('input', { type: 'checkbox', defaultChecked: v === true, ref: bindRef(f.key) }),
                    h('span', { className: 'wai-field-hint' }, v === true ? 'on' : 'off')));
              }
              if (f.kind === 'select') {
                return h('div', { className: 'wai-field', key: f.key },
                  h('span', { className: 'wai-field-label' }, zh ? f.zh : f.en),
                  h('select', {
                    className: 'wai-input',
                    defaultValue: v ?? 'sidebar',
                    ref: bindRef(f.key),
                  }, f.optKeys.map((opt) => h('option', { key: opt, value: opt },
                    (T.placementOpts && T.placementOpts[opt]) || opt))),
                  h('span', null));
              }
              if (f.kind === 'text') {
                return h('div', { className: 'wai-field', key: f.key },
                  h('span', { className: 'wai-field-label' }, zh ? f.zh : f.en),
                  h('input', {
                    className: 'wai-input wai-input-wide',
                    type: 'text',
                    defaultValue: v ?? '',
                    placeholder: f.placeholder || '',
                    ref: bindRef(f.key),
                  }));
              }
              const floorHint = f.floorKey && floor[f.floorKey] !== undefined
                ? T.settingsFloor + ' ' + floor[f.floorKey] : '';
              return h('div', { className: 'wai-field', key: f.key },
                h('span', { className: 'wai-field-label' }, zh ? f.zh : f.en),
                h('input', {
                  className: 'wai-input',
                  type: 'number',
                  min: 0,
                  step: 1,
                  defaultValue: v ?? '',
                  ref: bindRef(f.key),
                }),
                h('span', { className: 'wai-field-hint' }, floorHint || f.unit || ''));
            }));
        }),
        h('div', { className: 'wai-actions' },
          h('button', {
            className: 'wai-btn wai-btn-primary',
            disabled: saveState.phase === 'saving',
            onClick: submit,
          }, saveState.phase === 'saving' ? T.settingsSaving : T.settingsSave),
          h('button', {
            className: 'wai-btn',
            onClick: () => load(true),
            disabled: saveState.phase === 'saving',
          }, T.settingsReload),
          h('button', {
            className: 'wai-btn',
            onClick: restore,
            disabled: saveState.phase === 'saving',
          }, T.settingsRestore)),
        saveState.phase === 'ok'
          ? h('div', { className: 'wai-status wai-status-ok' }, String(saveState.message))
          : null,
        saveState.phase === 'error'
          ? h('div', { className: 'wai-status wai-status-error' }, T.settingsFail + '：' + String(saveState.message))
          : null);
    }

    /** 侧边栏图标：两个对话气泡 + 引出连线（原创几何图形）。 */
    function SidebarIcon(props) {
      const size = (props && props.size) || 18;
      const active = !!(props && props.active);
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        style: { opacity: active ? 1 : 0.72, display: 'block' },
      },
        h('path', {
          d: 'M3.5 5.2h9.2a1.6 1.6 0 0 1 1.6 1.6v5a1.6 1.6 0 0 1-1.6 1.6H8.1L5 16v-2.6H3.5A1.6 1.6 0 0 1 1.9 11.8v-5A1.6 1.6 0 0 1 3.5 5.2Z',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M19.9 9.4h.6A1.6 1.6 0 0 1 22.1 11v4.3a1.6 1.6 0 0 1-1.6 1.6h-1.1V19l-2.6-2.1h-4.4a1.6 1.6 0 0 1-1.6-1.6v-1.4',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
        h('circle', { cx: 6.4, cy: 9.3, r: 0.95, fill: 'currentColor' }),
        h('circle', { cx: 9.9, cy: 9.3, r: 0.95, fill: 'currentColor' }));
    }

    /** 每会话只自动切一次面板；页面级 5 分钟冷却兜底。 */
    const autoOpened = new Set();
    let lastAutoOpenAt = 0;
    const AUTO_OPEN_COOLDOWN_MS = 5 * 60 * 1000;

    function pickSessionKey(input) {
      if (typeof input === 'string' && input) return input;
      if (input && typeof input === 'object') {
        const candidates = [input.sessionId, input.session, input.callId, input.id];
        for (const c of candidates) if (typeof c === 'string' && c) return c;
      }
      return 'default';
    }

    const codeTone = (code) => {
      switch (code) {
        case 'ok': return 'var(--dsw-alias-state-success-primary, #128a4a)';
        case 'busy':
        case 'rate_limited': return 'var(--dsw-alias-state-warn-label, #a35c00)';
        case 'unauthorized':
        case 'unavailable':
        case 'timeout':
        case 'failed': return 'var(--dsw-alias-state-error-primary, #c0392b)';
        default: return 'var(--dsw-alias-label-secondary, #61666b)';
      }
    };

    /**
     * 结果节点载荷来自 output.render 的 ContentBlock（投影不带原始 value），
     * 先从 content 反解，再退回直挂字段。
     * WeakMap 按 block 引用缓存：会话流频繁重渲染时，同一个结果节点只 parse 一次。
     */
    const valueCache = new WeakMap();
    function extractValue(block) {
      if (!block) return null;
      if (valueCache.has(block)) return valueCache.get(block);
      const parsed = extractValueUncached(block);
      valueCache.set(block, parsed);
      return parsed;
    }
    function extractValueUncached(block) {
      const direct = [block.value, block.result && block.result.value, block.result, block.output && block.output.value, block.output];
      for (const candidate of direct) {
        if (candidate && typeof candidate === 'object' && 'code' in candidate) return candidate;
      }
      const content = Array.isArray(block.content) ? block.content : [];
      const text = content
        .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('');
      if (!text) return null;
      try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === 'object' && 'code' in obj) return obj;
      } catch (e) { /* 非 JSON 内容不渲染 */ }
      return null;
    }

    // 宿主传入的 block/phase 均为稳定引用：memo 掉重复渲染，长会话流下每张卡片只渲染一次
    const ToolCard = React.memo(function ToolCard(props) {
      const phase = props && props.phase;
      const block = props && props.block;
      const value = extractValue(block);
      const code = (value && value.code) || (block && block.isError ? 'failed' : null);
      const answer = value && value.answer;
      const pending = phase === 'preparing' || phase === 'start';

      React.useEffect(() => {
        const valueKey = value && typeof value.sessionKey === 'string' ? value.sessionKey : null;
        const key = valueKey || pickSessionKey(props && (props.sessionId || props.sessionKey)) || 'default';
        if (autoOpened.has(key)) return;
        if (Date.now() - lastAutoOpenAt < AUTO_OPEN_COOLDOWN_MS) {
          autoOpened.add(key);
          return;
        }
        autoOpened.add(key);
        lastAutoOpenAt = Date.now();
        try {
          ctx.layout.selectPanel(PANEL_ID);
        } catch (e) { /* 面板未注册时静默 */ }
      }, []);

      const [copied, setCopied] = React.useState(false);
      const copyAnswer = () => {
        try {
          Promise.resolve(navigator.clipboard.writeText(String(answer)))
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
            .catch(() => {});
        } catch (e) { /* ignore */ }
      };

      const attachList = value && Array.isArray(value.attachments) ? value.attachments : null;

      // 两行头：标题+状态一行，元信息+操作一行（窄栏也不会挤乱）
      const head = h('div', { className: 'wai-card-head' },
        h('div', { className: 'wai-card-titlerow' },
          h('span', { className: 'wai-card-title' }, T.panel),
          code ? h('span', { className: 'wai-badge' },
            h('span', { className: 'wai-badge-dot', style: { color: codeTone(code) } }),
            h('span', null, code)) : null,
          pending ? h('span', { className: 'wai-muted' }, '进行中…') : null),
        h('div', { className: 'wai-card-metarow' },
          value && value.elapsedMs
            ? h('span', { className: 'wai-field-hint' }, (value.elapsedMs / 1000).toFixed(1) + 's')
            : null,
          value && value.discussionId
            ? h('span', {
              className: 'wai-field-hint wai-card-id',
              title: 'discussionId（可传给 followUp 追问）',
            }, String(value.discussionId))
            : null,
          answer
            ? h('button', {
              className: 'wai-btn wai-btn-ghost wai-card-copy',
              onClick: copyAnswer,
              title: '复制回答原文',
            }, copied ? T.copied : T.copyAnswer)
            : null));

      if (!answer) {
        const reason = (value && value.reason) || (block && block.error && block.error.code) || null;
        const message = (value && value.message) || (block && block.error && block.error.message) || null;
        const partial = value && value.partial ? String(value.partial) : null;
        return h('div', { className: 'wai-card' }, head,
          reason ? h('div', { className: 'wai-muted', style: { marginTop: 6 } }, 'reason: ' + reason) : null,
          message ? h('div', { className: 'wai-muted' }, String(message)) : null,
          partial ? h('div', { className: 'wai-card-body' }, partial) : null,
          !pending && !reason && !message && !partial
            ? h('div', { className: 'wai-muted', style: { marginTop: 6 } }, T.empty) : null);
      }
      return h('div', { className: 'wai-card' }, head,
        attachList
          ? h('div', { className: 'wai-muted', style: { marginTop: 6 } },
            '附件：' + attachList.map((p) => String(p).split(/[\\/]/).pop()).join('、'))
          : null,
        h('div', { className: 'wai-card-body' }, String(answer)));
    });

    /** 运行状态块：现读宿主 /web-ai-discuss/api/status（护栏与空间锁是运行时状态）。 */
    function LiveStatus() {
      const [state, setState] = React.useState({ loading: true, data: null, error: null });
      const load = React.useCallback(() => {
        setState((s) => ({ ...s, loading: true }));
        fetch('/web-ai-discuss/api/status', { headers: { accept: 'application/json' } })
          .then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then((d) => setState({ loading: false, data: d, error: null }))
          .catch((e) => setState({ loading: false, data: null, error: String(e && e.message ? e.message : e) }));
      }, []);
      React.useEffect(() => { load(); }, [load]);
      // 自动刷新：面板开着时每 5 秒读一次运行时状态；页面不可见时停掉，回来再读。
      React.useEffect(() => {
        let timer = null;
        const start = () => {
          if (timer !== null) return;
          timer = setInterval(() => {
            try { if (typeof document === 'undefined' || !document.hidden) load(); } catch (e) { /* ignore */ }
          }, 5000);
          // Node（离线测试）下 unref，避免没有清理时挂住进程；浏览器里没有 unref。
          try { if (timer && typeof timer.unref === 'function') timer.unref(); } catch (e) { /* ignore */ }
        };
        const stop = () => {
          if (timer !== null) { clearInterval(timer); timer = null; }
        };
        start();
        const onVisible = () => { if (typeof document === 'undefined' || !document.hidden) { load(); start(); } else { stop(); } };
        try {
          if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('visibilitychange', onVisible);
          }
        } catch (e) { /* ignore */ }
        return () => {
          stop();
          try {
            if (typeof document !== 'undefined' && document.removeEventListener) {
              document.removeEventListener('visibilitychange', onVisible);
            }
          } catch (e) { /* ignore */ }
        };
      }, [load]);

      if (state.error) {
        return h('div', { className: 'wai-live' },
          h('div', { className: 'wai-live-head' },
            h('span', { className: 'wai-live-dot', 'data-busy': 'error' }),
            h('span', { className: 'wai-live-title' }, T.liveTitle),
            h('button', { className: 'wai-btn wai-btn-ghost wai-live-refresh', onClick: load }, T.liveRefresh)),
          h('div', { className: 'wai-status-error' }, T.liveFail + ' (' + state.error + ')'));
      }
      if (state.loading && !state.data) {
        return h('div', { className: 'wai-live' },
          h('div', { className: 'wai-live-head' },
            h('span', { className: 'wai-live-dot', 'data-busy': 'true' }),
            h('span', { className: 'wai-live-title' }, T.liveTitle)),
          h('div', { className: 'wai-muted', style: { marginTop: 8 } }, T.liveLoading));
      }
      const d = state.data || {};
      const g = d.guardrails || {};
      const busy = g.busy === true;
      const spaceHeld = d.space && d.space.locked === true;
      const recent = Array.isArray(d.recent) ? d.recent : [];
      const quota = typeof g.windowUsed === 'number' && typeof g.windowLimit === 'number'
        ? g.windowUsed + ' / ' + g.windowLimit
        : '-';
      const stat = (k, v, title) => h('div', { className: 'wai-stat', title: title || null },
        h('div', { className: 'wai-stat-k' }, k),
        h('div', { className: 'wai-stat-v' }, v));
      return h('div', { className: 'wai-live' },
        h('div', { className: 'wai-live-head' },
          h('span', { className: 'wai-live-dot', 'data-busy': busy ? 'true' : 'false' }),
          h('span', { className: 'wai-live-title' }, T.liveTitle),
          h('span', { className: 'wai-live-state' }, busy ? T.liveBusy : T.liveIdle),
          h('button', { className: 'wai-btn wai-btn-ghost wai-live-refresh', onClick: load }, T.liveRefresh)),
        h('div', { className: 'wai-stats' },
          stat(T.liveQuota, quota),
          stat(T.liveSpace, spaceHeld ? T.liveSpaceHeld : T.liveSpaceFree),
          stat(T.liveDiscussions, String((d.storeStats && d.storeStats.discussions) || 0)),
          stat(T.liveTotal, String(typeof g.totalCalls === 'number' ? g.totalCalls : 0))),
        h('div', { className: 'wai-live-meta' },
          T.liveBusyCount + ' ' + (typeof g.rejectedBusy === 'number' ? g.rejectedBusy : 0)
          + ' · ' + T.liveRateCount + ' ' + (typeof g.rejectedRate === 'number' ? g.rejectedRate : 0)),
        recent.length
          ? h('ul', { className: 'wai-live-list' },
            recent.map((r) => h('li', { key: r.id },
              h('span', { className: 'wai-live-id' }, String(r.id || '')),
              h('span', { className: 'wai-live-title-txt', title: String(r.title || '') }, String(r.title || '')))))
          : h('div', { className: 'wai-muted', style: { marginTop: 8 } }, T.liveNever));
    }

    /** 预设提示词块：折叠展开时才挂载并读一次宿主路由（预设清单是插件常量，宿主侧提供）。 */
    function PresetBlock() {
      const [state, setState] = React.useState({ loading: true, items: [], error: null });
      const [copiedId, setCopiedId] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        fetch('/web-ai-discuss/api/status', { headers: { accept: 'application/json' } })
          .then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then((d) => {
            if (!alive) return;
            const items = Array.isArray(d.presets) ? d.presets : [];
            setState({ loading: false, items, error: null });
          })
          .catch((e) => {
            if (!alive) return;
            setState({ loading: false, items: [], error: String((e && e.message) || e) });
          });
        return () => { alive = false; };
      }, []);

      const copy = (item) => {
        try {
          Promise.resolve(navigator.clipboard.writeText(item.template))
            .then(() => {
              setCopiedId(item.id);
              setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1600);
            })
            .catch(() => {});
        } catch (e) { /* ignore */ }
      };

      if (state.error) return h('div', { className: 'wai-muted' }, T.presetFail + ' (' + state.error + ')');
      if (state.loading) return h('div', { className: 'wai-muted' }, T.liveLoading);
      if (!state.items.length) return h('div', { className: 'wai-muted' }, T.presetEmpty);
      return h('div', null,
        h('div', { className: 'wai-muted', style: { marginBottom: 4 } }, T.presetHint),
        h('div', null, state.items.map((item) => h('div', { className: 'wai-preset', key: item.id },
          h('div', { className: 'wai-preset-head' },
            h('code', { className: 'wai-preset-id' }, item.id),
            h('span', { className: 'wai-preset-name' }, item.title || item.id)),
          h('div', { className: 'wai-preset-hint' }, item.hint || ''),
          h('div', { className: 'wai-preset-action' },
            h('button', {
              className: 'wai-btn',
              onClick: () => copy(item),
            }, copiedId === item.id ? T.presetCopied : T.presetCopy))))));
    }

    /** 面板内容（不含外层滚动容器），设置页分区复用它。 */
    function PanelContent() {
      const [copied, setCopied] = React.useState(false);
      const copy = () => {
        try {
          Promise.resolve(navigator.clipboard.writeText(`${T.template}<你的问题>`))
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
            .catch(() => {});
        } catch (e) { /* ignore */ }
      };
      return h('div', { className: 'wai-wrap' },
        h('div', { className: 'wai-head' },
          h('h1', { className: 'wai-h1' }, T.title),
          h('span', { className: 'wai-build' }, `build ${CLIENT_BUILD}`)),
        h('p', { className: 'wai-lead' }, T.lead),
        h('div', { className: 'wai-note' }, T.when),
        h(LiveStatus, {}),
        h('div', { className: 'wai-actions' },
          h('button', { className: 'wai-btn', onClick: copy }, copied ? T.copied : T.copy)),
        h(Fold, { title: T.usageTitle },
          h('p', { className: 'wai-text' }, T.store),
          h('div', { className: 'wai-section-label' }, T.guardTitle),
          h('div', null, T.guards.map(([k, d]) => h('div', { className: 'wai-row', key: k },
            h('span', { className: 'wai-row-k' }, k),
            h('span', { className: 'wai-row-d' }, d)))),
          h('div', { className: 'wai-section-label' }, T.codesTitle),
          h('div', null, T.codes.map(([k, d]) => h('div', { className: 'wai-row', key: k },
            h('span', { className: 'wai-row-k' }, h('code', { className: 'wai-code' }, k)),
            h('span', { className: 'wai-row-d' }, d)))),
          h('div', { className: 'wai-section-label' }, T.limitsTitle),
          h('ul', { className: 'wai-list' }, T.limits.map((text, i) => h('li', { key: i }, text)))),
        h(Fold, { title: T.presetTitle }, h(PresetBlock, {})),
        h(Fold, { title: T.settingsTitle }, h(SettingsForm, {})));
    }

    function Panel() {
      return h('div', { className: 'wai-root' }, h(PanelContent, {}));
    }

    // ── 入口位置（placement / composerDock，可经设置表单修改）──
    const LS_KEY = 'dsh-web-ai-discuss:ui';
    function readCachedUi() {
      try {
        const raw = globalThis.localStorage && globalThis.localStorage.getItem(LS_KEY);
        const v = raw ? JSON.parse(raw) : null;
        if (v && (v.placement === 'sidebar' || v.placement === 'settings' || v.placement === 'both')) {
          return { placement: v.placement, composerDock: v.composerDock === true };
        }
      } catch (e) { /* 回落默认 */ }
      return { placement: 'sidebar', composerDock: false };
    }
    function writeCachedUi(v) {
      try {
        if (globalThis.localStorage) globalThis.localStorage.setItem(LS_KEY, JSON.stringify(v));
      } catch (e) { /* ignore */ }
    }

    /** 输入框下方的小快捷入口（composerDock=true 且侧边栏存在时）。 */
    function ComposerChip() {
      return h('button', {
        className: 'wai-btn',
        style: { minHeight: 26, padding: '3px 10px', fontSize: 12 },
        title: T.panel,
        onClick: () => {
          try { ctx.layout.selectPanel(PANEL_ID); } catch (e) { /* ignore */ }
        },
      }, T.panel);
    }

    // apply 闭包里需要 ctx（selectPanel）
    let ctx = null;
    // apply 里赋值的"重读显示位置并可能重挂入口"回调；SettingsForm 保存成功后调用
    let uiReload = null;

    function apply(pluginCtx) {
      ctx = pluginCtx;
      ensureStyles();
      let ui = readCachedUi();
      let disposers = [];

      const mount = () => {
        for (const d of disposers) { try { d(); } catch (e) { /* ignore */ } }
        disposers = [];
        const side = ui.placement === 'sidebar' || ui.placement === 'both';
        const inSettings = ui.placement === 'settings' || ui.placement === 'both';

        // 工具卡片入口与位置无关，始终注册（否则会话里结果没有专门展示）
        disposers.push(pluginCtx.slots.inject('tool.call.toolview', () => pluginCtx.slots.register({
          name: 'tool.call.toolview',
          key: TOOL_DISCUSS,
          inject: (input) => ({ sessionKey: pickSessionKey(input) }),
        }, ToolCard)));

        if (side) {
          disposers.push(pluginCtx.slots.inject('sidebar.panellist', () => pluginCtx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 40,
            label: () => T.panel,
          }, SidebarIcon)));
          disposers.push(pluginCtx.slots.inject('main', () => pluginCtx.slots.register({
            name: 'main',
            key: PANEL_ID,
          }, Panel)));
          if (ui.composerDock) {
            disposers.push(pluginCtx.slots.inject('conversation.composer.dock', () => pluginCtx.slots.register({
              name: 'conversation.composer.dock',
              id: PANEL_ID,
              order: 50,
            }, ComposerChip)));
          }
        }
        if (inSettings) {
          disposers.push(pluginCtx.slots.inject('settings.section', () => pluginCtx.slots.register({
            name: 'settings.section',
            id: PANEL_ID,
            order: 55,
            label: () => T.panel,
          }, () => h('div', { className: 'wai-root', style: { height: 'auto' } }, h(PanelContent, {})))));
        }
      };
      mount();

      // 拉生效配置，位置变了就重挂。
      // 为什么不只靠设置表单的 uiReload：设置也可以从命令行/API 直改（curl POST /api/settings），
      // 那条路不会触发表单回调。这里做**低频轮询**兜底，让入口位置最终与宿主配置一致。
      if (typeof globalThis.fetch === 'function') {
        const load = () => {
          fetch(SETTINGS_API, { cache: 'no-store' })
            .then((res) => (res.ok ? res.json() : null))
            .then((body) => {
              const eff = body && body.effective;
              if (!eff || typeof eff.placement !== 'string') return;
              const next = {
                placement: ['sidebar', 'settings', 'both'].includes(eff.placement) ? eff.placement : 'sidebar',
                composerDock: eff.composerDock === true,
              };
              if (next.placement !== ui.placement || next.composerDock !== ui.composerDock) {
                ui = next;
                writeCachedUi(ui);
                mount();
              } else {
                writeCachedUi(ui);
              }
            })
            .catch(() => { /* 拉不到就用缓存位置 */ });
        };
        uiReload = load;
        load();
        // 兜底轮询：10s 一次，页面不可见时不发请求。
        try {
          const timer = setInterval(() => {
            try { if (typeof document === 'undefined' || !document.hidden) load(); } catch (e) { /* ignore */ }
          }, 10000);
          if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
        } catch (e) { /* ignore */ }
      }
    }
    return {
      inject: ['slots', 'layout'],
      apply,
    };
  },
});
