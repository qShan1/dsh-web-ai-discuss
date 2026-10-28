/**
 * dsh-web-ai-discuss — 客户端（浏览器侧）模块。v0.4.3（未发布开发版）
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
    const CLIENT_BUILD = '0.4.3';

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
        liveRecent: '最近讨论',
        liveRecentShow: '展开',
        tabOverview: '概览',
        tabPreset: '预设',
        tabSettings: '设置',
        levelTitle: '档位',
        levelHint: '同一套框架三档强度，按这次要多狠来调',
        presetTitle: '预设提示词',
        presetHint: '把提问套进固定回答结构，原始提问原样保留。调用时传 preset=<id>（可加 :<档位>）。',
        presetCopy: '复制模板',
        presetCopied: '已复制',
        presetCall: '复制调用',
        presetCallCopied: '已复制调用',
        presetShow: '看模板',
        presetHide: '收起',
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
        liveRecent: 'Recent discussions',
        liveRecentShow: 'Show',
        tabOverview: 'Overview',
        tabPreset: 'Presets',
        tabSettings: 'Settings',
        levelTitle: 'Level',
        levelHint: 'Three strengths for the same framework; pick how hard to push',
        presetTitle: 'Preset prompts',
        presetHint: 'Wrap your question in a fixed answer structure; the original question is kept verbatim. Pass preset=<id> when calling web_ai_discuss, optionally with :<level>.',
        presetCopy: 'Copy template',
        presetCopied: 'Copied',
        presetCall: 'Copy call',
        presetCallCopied: 'Call copied',
        presetShow: 'Template',
        presetHide: 'Hide',
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

/* ── 分区切换（Tab）── */
.wai-tabs {
  display: flex;
  gap: 2px;
  margin: 14px 0 0;
  padding: 3px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--wai-surface);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
}
.wai-tab {
  flex: 1 1 0;
  min-width: 0;
  min-height: 28px;
  padding: 5px 8px;
  font: inherit;
  font-size: 12.5px;
  line-height: 1.2;
  border: 0;
  border-radius: var(--dsw-radius-xs, 4px);
  cursor: pointer;
  color: var(--dsw-alias-label-secondary, #61666b);
  background: transparent;
  transition: background-color 120ms ease, color 120ms ease;
}
.wai-tab:hover { color: var(--dsw-alias-label-primary, #1a1a1a); }
.wai-tab[data-active="true"] {
  color: var(--dsw-alias-label-primary, #1a1a1a);
  background: var(--wai-surface-strong);
  font-weight: 600;
}
.wai-tab:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 1px;
}
.wai-pane { margin-top: 16px; }

/* ── 档位分段控件 ── */
.wai-seg {
  display: inline-flex;
  overflow: hidden;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
}
.wai-seg-item {
  min-height: 26px;
  padding: 4px 12px;
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  border: 0;
  border-right: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  cursor: pointer;
  color: var(--dsw-alias-label-secondary, #61666b);
  background: transparent;
  transition: background-color 120ms ease, color 120ms ease;
}
.wai-seg-item:last-child { border-right: 0; }
.wai-seg-item:hover { color: var(--dsw-alias-label-primary, #1a1a1a); }
.wai-seg-item[data-active="true"] {
  color: var(--dsw-alias-label-primary, #1a1a1a);
  background: var(--wai-surface-strong);
  font-weight: 600;
}
.wai-seg-item:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: -2px;
}

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
.wai-live-recent { margin-top: 10px; }
.wai-live-recent-toggle { min-height: 24px; padding: 2px 8px; font-size: 11.5px; }
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
.wai-level-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 4px;
}
.wai-level-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-level-hint {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-preset {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: 12px;
  row-gap: 2px;
  align-items: center;
  padding: 9px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
}
.wai-preset:last-child { border-bottom: 0; }
.wai-preset-head {
  grid-column: 1;
  display: flex;
  align-items: baseline;
  gap: 7px;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wai-preset-hint {
  grid-column: 1 / -1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.wai-preset-action {
  grid-column: 2;
  grid-row: 1;
  align-self: center;
  display: flex;
  align-items: center;
  gap: 6px;
}
.wai-preset-more {
  grid-column: 1 / -1;
  margin-top: 6px;
}
.wai-preset-tmpl {
  margin: 6px 0 0;
  padding: 9px 11px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--wai-surface);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary, #61666b);
  max-height: 240px;
  overflow-y: auto;
}

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
  .wai-preset-action { grid-column: 1; grid-row: auto; justify-self: start; margin-top: 6px; }
  .wai-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
  .wai-tabs { margin-top: 12px; }
  .wai-level-bar { gap: 8px; }
  .wai-level-hint { flex: 1 1 100%; margin-top: -2px; }
  .wai-seg-item { padding: 4px 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .wai-caret, .wai-btn, .wai-input, .wai-fold > summary { transition: none; }
}
`;
    /* @wai-css-end */

    const STYLE_ID = 'dsh-web-ai-discuss-styles';
    /** 宿主按 data-plugin 标记样式归属；带上它，重载时宿主能正确清理。 */
    const STYLE_PLUGIN = 'dsh-web-ai-discuss';
    /**
     * 注入/刷新本插件的样式表。
     *
     * 关键点：**不能只做「存在就跳过」**。
     * 宿主里 <style> 是常驻 DOM，插件热重载（HMR）或重新装载时 JSX 会更新，
     * 但旧 <style> 仍在文档里——于是出现「JS 是新版、样式还是旧版」的分裂。
     * （实测：宿主里挂着 0.1.0 时代的 CSS，而 JSX 已是 0.4.0。）
     * 所以这里每次都按内容比对后写入：内容相同则不动，不同则整段替换。
     */
    function ensureStyles() {
      try {
        if (typeof document === 'undefined') return;
        const el = document.getElementById(STYLE_ID);
        if (!el) {
          const tag = document.createElement('style');
          tag.id = STYLE_ID;
          tag.dataset.plugin = STYLE_PLUGIN;
          tag.dataset.pluginCss = STYLE_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return;
        }
        if (el.textContent === CSS) {
          if (el.getAttribute('data-plugin') !== STYLE_PLUGIN) {
            el.dataset.plugin = STYLE_PLUGIN;
            el.dataset.pluginCss = STYLE_ID;
          }
          return;
        }
        el.textContent = CSS;
        el.dataset.plugin = STYLE_PLUGIN;
        el.dataset.pluginCss = STYLE_ID;
      } catch (e) { /* 非浏览器环境忽略 */ }
    }

    /**
     * 一次性 DOM/CSS 诊断：把**宿主里的真实状态**回报到宿主侧路由。
     * 用途：样式是否落地、规则是否被解析、面板是否落在 shadow root 里——
     * 这些在浏览器外看不到，只能让在宿主里跑的代码自己量。
     * 不抛错，任何一步失败只记进结果。
     */
    function collectDiag() {
      const out = { at: new Date().toISOString(), build: CLIENT_BUILD };
      try { out.url = String((globalThis.location && globalThis.location.href) || ''); } catch (e) { out.url = null; }
      try { out.ua = String(navigator.userAgent || '').slice(0, 160); } catch (e) { out.ua = null; }

      // 1) 自己的 <style> 在不在、规则解析出多少条
      try {
        const tag = document.getElementById(STYLE_ID);
        const info = {
          present: !!tag,
          inHead: !!(tag && document.head && document.head.contains(tag)),
          parent: tag && tag.parentNode ? tag.parentNode.nodeName : null,
          attrPlugin: tag ? tag.getAttribute('data-plugin') : null,
          attrPluginCss: tag ? tag.getAttribute('data-plugin-css') : null,
          textLen: tag ? String(tag.textContent || '').length : 0,
          rules: null,
          ruleError: null,
          waiRules: null,
        };
        if (tag) {
          try {
            const sheet = tag.sheet;
            info.rules = sheet ? sheet.cssRules.length : -1;
            if (sheet) {
              let n = 0;
              const sample = [];
              for (const r of sheet.cssRules) {
                const sel = r.selectorText || '';
                if (sel.indexOf('.wai-') !== -1) { n += 1; if (sample.length < 8) sample.push(sel.slice(0, 80)); }
              }
              info.waiRules = n;
              info.waiRuleSample = sample;
            }
          } catch (e) { info.ruleError = String((e && e.name) || '') + ':' + String((e && e.message) || e); }
        }
        out.styleTag = info;
      } catch (e) { out.styleTagError = String((e && e.message) || e); }

      // 2) 宿主里一共有哪些 style 标签（别人的 vs 我们的）
      try {
        const tags = document.querySelectorAll('style');
        const mine = [];
        const others = [];
        for (let i = 0; i < tags.length; i += 1) {
          const t = tags[i];
          const rec = {
            id: t.id || null,
            plugin: t.getAttribute('data-plugin'),
            pluginCss: t.getAttribute('data-plugin-css'),
            len: String(t.textContent || '').length,
            rules: null,
          };
          try { rec.rules = t.sheet ? t.sheet.cssRules.length : -1; } catch (e) { rec.rules = 'err'; }
          if (t.id === STYLE_ID) mine.push(rec);
          else if (others.length < 12) others.push(rec);
        }
        out.styleTags = { total: tags.length, mine, others };
      } catch (e) { out.styleTagsError = String((e && e.message) || e); }

      // 3) 面板元素真实落在哪：document 还是 shadow root？规则是否命中？
      try {
        // 深搜：宿主可能把面板渲染在 shadow root 里，普通 querySelector 找不到。
        const deepFind = (selector) => {
          const direct = document.querySelector(selector);
          if (direct) return direct;
          const hosts = document.querySelectorAll('*');
          for (let i = 0; i < hosts.length; i += 1) {
            const sr = hosts[i].shadowRoot;
            if (!sr) continue;
            const hit = sr.querySelector(selector);
            if (hit) return hit;
          }
          return null;
        };
        const root = deepFind('.wai-root');
        const stats = deepFind('.wai-stats');
        const build = deepFind('.wai-build');
        const el = root || stats || build;
        const place = {
          foundRoot: !!root,
          foundStats: !!stats,
          foundBuild: !!build,
          inDocument: !!(el && el.ownerDocument === document),
          rootNodeType: el ? String(el.getRootNode && el.getRootNode() ? (el.getRootNode() === document ? 'document' : (el.getRootNode().nodeName || 'other')) : 'unknown') : null,
          inShadow: !!(el && el.getRootNode && el.getRootNode() && el.getRootNode() !== document && el.getRootNode().host),
          parentChain: null,
          computed: null,
        };
        try {
          const chain = [];
          let p = el;
          while (p && chain.length < 8) { chain.push(p.nodeName + (p.id ? '#' + p.id : '') + (p.className && typeof p.className === 'string' ? '.' + p.className.trim().split(/\s+/).join('.') : '')); p = p.parentNode; }
          place.parentChain = chain;
        } catch (e) { /* ignore */ }
        try {
          if (stats) {
            const cs = getComputedStyle(stats);
            place.computed = {
              statsDisplay: cs.display,
              statsColumns: cs.gridTemplateColumns,
              statsGap: cs.gap,
            };
          }
          if (build) {
            const cs = getComputedStyle(build);
            place.computed = Object.assign(place.computed || {}, {
              buildDisplay: cs.display,
              buildRadius: cs.borderRadius,
              buildBg: cs.backgroundColor,
            });
          }
        } catch (e) { place.computedError = String((e && e.message) || e); }
        out.place = place;
      } catch (e) { out.placeError = String((e && e.message) || e); }

      // 3a) 页面里**实际渲染出来的 DOM** 是哪一版？
      // 关键区分：服务器给的 bundle 可能是新版，但页面里跑的 React 模块实例可能是旧的
      // （旧实例的 apply() 没被销毁 → 它上报的 build 仍是旧值）。
      // 所以这里直接量 DOM：新结构有 .wai-tabs / .wai-level-bar / .wai-seg，旧结构没有。
      try {
        const dom = {
          tabs: document.querySelectorAll('.wai-tabs').length,
          tabButtons: document.querySelectorAll('.wai-tab').length,
          levelBar: document.querySelectorAll('.wai-level-bar').length,
          seg: document.querySelectorAll('.wai-seg').length,
          segItems: document.querySelectorAll('.wai-seg-item').length,
          presetBlocks: document.querySelectorAll('.wai-preset').length,
          stats: document.querySelectorAll('.wai-stats').length,
          buildStamp: null,
          buildStamps: [],
        };
        const stamps = document.querySelectorAll('.wai-build');
        for (let i = 0; i < stamps.length && dom.buildStamps.length < 8; i += 1) {
          dom.buildStamps.push(String(stamps[i].textContent || '').trim());
        }
        dom.buildStamp = dom.buildStamps[0] || null;
        out.dom = dom;
      } catch (e) { out.domError = String((e && e.message) || e); }

      // 3b) 探针：面板是「点开才渲染」的，首帧往往不存在，
      // 所以自己造一个带插件类名的临时节点，量「样式规则到底生效没有」。
      // 这比等面板打开更可靠，也不打扰用户。
      try {
        const probe = document.createElement('div');
        probe.setAttribute('data-wai-probe', '1');
        probe.style.position = 'fixed';
        probe.style.left = '-9999px';
        probe.style.top = '0';
        probe.style.width = '360px';
        probe.innerHTML = '<div class="wai-root"><div class="wai-head"><span class="wai-build">build 0.0.0</span></div>'
          + '<div class="wai-stats"><div class="wai-stat"><div class="wai-stat-k">k</div><div class="wai-stat-v">v</div></div></div>'
          + '<div class="wai-note">n</div><button class="wai-btn">b</button><ul class="wai-list"><li>i</li></ul></div>';
        document.body.appendChild(probe);
        const pStats = probe.querySelector('.wai-stats');
        const pBuild = probe.querySelector('.wai-build');
        const pNote = probe.querySelector('.wai-note');
        const pBtn = probe.querySelector('.wai-btn');
        const pLi = probe.querySelector('.wai-list > li');
        const px = (el, keys) => {
          if (!el) return null;
          const cs = getComputedStyle(el);
          const o = {};
          for (const k of keys) o[k] = cs.getPropertyValue(k);
          return o;
        };
        out.probe = {
          applied: px(pStats, ['display', 'grid-template-columns', 'gap']),
          build: px(pBuild, ['display', 'border-radius', 'background-color', 'padding-left']),
          note: px(pNote, ['border-top-width', 'border-radius', 'background-color', 'padding-left']),
          btn: px(pBtn, ['border-radius', 'padding-left', 'background-color', 'color']),
          li: px(pLi, ['list-style-type', 'padding-left']),
        };
        probe.remove();
      } catch (e) { out.probeError = String((e && e.message) || e); }

      // 4) 宿主主题变量在这张文档里解析成什么
      try {
        const cs = getComputedStyle(document.documentElement);
        const vars = {};
        for (const name of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-bg-layer-1', '--dsw-alias-border-l1', '--dsw-alias-state-business-primary', '--dsw-radius-lg', '--dsw-focus-ring-color']) {
          vars[name] = String(cs.getPropertyValue(name) || '').trim();
        }
        out.vars = vars;
        out.bodyAttrs = document.body ? Array.from(document.body.attributes).map((a) => a.name + '=' + a.value).slice(0, 12) : [];
      } catch (e) { out.varsError = String((e && e.message) || e); }

      return out;
    }

    /** 把诊断结果 POST 回宿主侧（宿主进程内存里存一份，供外部读取）。 */
    function reportDiag() {
      let payload = null;
      try {
        payload = collectDiag();
        fetch('/web-ai-discuss/api/diag', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {});
      } catch (e) { /* ignore */ }
      return payload;
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
      const [showRecent, setShowRecent] = React.useState(false);
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
          ? h('div', { className: 'wai-live-recent' },
            h('button', {
              className: 'wai-btn wai-btn-ghost wai-live-recent-toggle',
              onClick: () => setShowRecent((v) => !v),
            }, T.liveRecent + ' (' + recent.length + ') ' + (showRecent ? '−' : '+')),
            showRecent
              ? h('ul', { className: 'wai-live-list' },
                recent.map((r) => h('li', { key: r.id },
                  h('span', { className: 'wai-live-id' }, String(r.id || '')),
                  h('span', { className: 'wai-live-title-txt', title: String(r.title || '') }, String(r.title || '')))))
              : null)
          : h('div', { className: 'wai-muted', style: { marginTop: 8 } }, T.liveNever));
    }

    /**
     * 预设提示词块：折叠展开时才挂载并读一次宿主路由（预设清单是插件常量，宿主侧提供）。
     *
     * 档位是全局的（一次只调一个强度），所以放在区块顶部做分段控件，
     * 下面每条预设只显示当前档位的模板 —— 侧边栏里不用为每条预设再展开一次。
     */
    function PresetBlock() {
      const [state, setState] = React.useState({ loading: true, items: [], error: null });
      const [level, setLevel] = React.useState('normal');
      const [copiedId, setCopiedId] = React.useState(null);
      const [openId, setOpenId] = React.useState(null);
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

      const copy = (item, text, label, setCopied) => {
        try {
          Promise.resolve(navigator.clipboard.writeText(text))
            .then(() => {
              setCopied(item.id);
              setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 1600);
            })
            .catch(() => {});
        } catch (e) { /* ignore */ }
      };

      if (state.error) return h('div', { className: 'wai-muted' }, T.presetFail + ' (' + state.error + ')');
      if (state.loading) return h('div', { className: 'wai-muted' }, T.liveLoading);
      if (!state.items.length) return h('div', { className: 'wai-muted' }, T.presetEmpty);

      // 档位清单取自第一条预设的 levels（宿主侧统一提供），缺省退回三档内置。
      const levels = (state.items[0] && Array.isArray(state.items[0].levels) && state.items[0].levels.length)
        ? state.items[0].levels
        : [{ id: 'light', title: '轻' }, { id: 'normal', title: '标准' }, { id: 'strict', title: '严' }];
      const levelOf = (item) => (Array.isArray(item.levels) ? item.levels : [])
        .find((l) => l.id === level) || null;

      return h('div', null,
        h('div', { className: 'wai-level-bar' },
          h('span', { className: 'wai-level-label' }, T.levelTitle),
          h('div', { className: 'wai-seg', role: 'group', 'aria-label': T.levelTitle },
            levels.map((l) => h('button', {
              key: l.id,
              className: 'wai-seg-item',
              'data-active': l.id === level ? 'true' : 'false',
              title: l.hint || '',
              onClick: () => setLevel(l.id),
            }, l.title))),
          h('span', { className: 'wai-level-hint' }, T.levelHint)),
        h('div', { className: 'wai-muted', style: { marginBottom: 4 } }, T.presetHint),
        h('div', null, state.items.map((item) => {
          const lv = levelOf(item);
          const open = openId === item.id;
          const callText = `web_ai_discuss(prompt="<你的问题>", preset="${item.id}:${level}")`;
          return h('div', { className: 'wai-preset', key: item.id },
            h('div', { className: 'wai-preset-head' },
              h('code', { className: 'wai-preset-id' }, item.id),
              h('span', { className: 'wai-preset-name' }, item.title || item.id),
              lv ? h('span', { className: 'wai-preset-id' }, ':' + lv.id) : null),
            h('div', { className: 'wai-preset-hint' }, item.hint || ''),
            h('div', { className: 'wai-preset-action' },
              h('button', {
                className: 'wai-btn wai-btn-ghost',
                onClick: () => setOpenId(open ? null : item.id),
              }, open ? T.presetHide : T.presetShow),
              h('button', {
                className: 'wai-btn wai-btn-ghost',
                onClick: () => copy(item, callText, T.presetCall, setCopiedId),
              }, copiedId === item.id ? T.presetCallCopied : T.presetCall)),
            open && lv
              ? h('div', { className: 'wai-preset-more' },
                h('pre', { className: 'wai-preset-tmpl' }, lv.template),
                h('div', { className: 'wai-actions', style: { marginTop: 8 } },
                  h('button', {
                    className: 'wai-btn wai-btn-ghost',
                    onClick: () => copy(item, lv.template, T.presetCopy, setCopiedId),
                  }, copiedId === item.id ? T.presetCopied : T.presetCopy)))
              : null);
        })));
    }

    /** 分区切换：侧边栏窄栏里不必把所有内容堆在一起往下翻。 */
    function Tabs(props) {
      const [tab, setTab] = React.useState(props.initial || 'overview');
      const panes = props.panes || [];
      return h('div', null,
        h('div', { className: 'wai-tabs', role: 'tablist' },
          panes.map((p) => h('button', {
            key: p.id,
            className: 'wai-tab',
            role: 'tab',
            'aria-selected': p.id === tab ? 'true' : 'false',
            'data-active': p.id === tab ? 'true' : 'false',
            onClick: () => setTab(p.id),
          }, p.label))),
        h('div', { className: 'wai-pane', role: 'tabpanel' },
          (panes.find((p) => p.id === tab) || panes[0] || {}).content));
    }

    /** 概览分区：状态、用法与说明。 */
    function OverviewPane() {
      const [copied, setCopied] = React.useState(false);
      const copy = () => {
        try {
          Promise.resolve(navigator.clipboard.writeText(`${T.template}<你的问题>`))
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
            .catch(() => {});
        } catch (e) { /* ignore */ }
      };
      return h('div', null,
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
          h('ul', { className: 'wai-list' }, T.limits.map((text, i) => h('li', { key: i }, text)))));
    }

    /**
     * 面板内容（不含外层滚动容器）。
     * mode='tabs'：侧边栏用，分区切换，窄栏不必一路往下翻。
     * mode='flat'：设置页分区用，直接铺开（设置表单必须一眼可见，不能藏在 Tab 后面）。
     */
    function PanelContent(props) {
      const flat = !!(props && props.mode === 'flat');
      const head = [
        h('div', { className: 'wai-head' },
          h('h1', { className: 'wai-h1' }, T.title),
          h('span', { className: 'wai-build' }, `build ${CLIENT_BUILD}`)),
        h('p', { className: 'wai-lead' }, T.lead),
        h('div', { className: 'wai-note' }, T.when),
      ];
      if (flat) {
        return h('div', { className: 'wai-wrap' },
          ...head,
          h(LiveStatus, {}),
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
          h(SettingsForm, {}));
      }
      return h('div', { className: 'wai-wrap' },
        ...head,
        h(Tabs, {
          initial: 'overview',
          panes: [
            { id: 'overview', label: T.tabOverview, content: h(OverviewPane, {}) },
            { id: 'preset', label: T.tabPreset, content: h(PresetBlock, {}) },
            { id: 'settings', label: T.tabSettings, content: h(SettingsForm, {}) },
          ],
        }));
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
          }, () => h('div', { className: 'wai-root', style: { height: 'auto' } }, h(PanelContent, { mode: 'flat' })))));
        }
      };
      mount();

      // 一个 effect 托管本实例的全部「活体」资源：自诊断的定时器/观察器、配置兜底轮询、
      // 以及 mount() 之后留下的入口注册。
      //
      // 为什么必须走 pluginCtx.effect：宿主替换客户端模块时（HMR / 重装 / 改配置）
      // 只会销毁该 fiber 的效果，不会替你清理裸 setTimeout/setInterval/MutationObserver。
      // 早期版本没托管 → 旧实例的定时器一直在跑，出现「同一页面多个版本实例同时上报、
      // 旧 JSX 界面赖着不走」。effect 的清理函数是唯一可靠的退场点。
      const hostEffect = typeof pluginCtx.effect === 'function' ? pluginCtx.effect.bind(pluginCtx) : null;
      if (hostEffect === null) {
        // 极老宿主没有 effect：退化成只跑一次，至少不抛异常（不清理好过不挂载）。
        setupRuntime();
      } else {
        hostEffect(setupRuntime);
      }

      function setupRuntime() {
        // ── 自诊断（排障用）──
        // 把宿主里的真实 DOM/CSS 状态回报给宿主侧路由：样式是否落地、规则是否解析、
        // 面板是否在 shadow root 里。装载后 1.5s 报一次；等面板真正挂载（用户点开）再补
        // 一次，之后收工。用 MutationObserver 等挂载而不是轮询——面板是懒渲染的。
        let diagDone = false;
        const diagOnce = () => {
          if (diagDone) return;
          diagDone = true;
          try { reportDiag(); } catch (e) { /* ignore */ }
        };
        const diagTimer = setTimeout(diagOnce, 1500);

        let observer = null;
        if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.body) {
          try {
            observer = new MutationObserver(() => {
              let hit = null;
              try { hit = document.querySelector('.wai-root'); } catch (e) { hit = null; }
              if (hit) {
                try { observer.disconnect(); } catch (e) { /* ignore */ }
                observer = null;
                diagOnce();
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
          } catch (e) { observer = null; }
        }

        // ── 配置兜底轮询 ──
        // 为什么不只靠设置表单的 uiReload：设置也可以从命令行/API 直改
        // （curl POST /api/settings），那条路不会触发表单回调。
        let pollTimer = null;
        let loadRef = null;
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
          loadRef = load;
          load();
          // 兜底轮询：10s 一次，页面不可见时不发请求。
          try {
            pollTimer = setInterval(() => {
              try { if (typeof document === 'undefined' || !document.hidden) load(); } catch (e) { /* ignore */ }
            }, 10000);
            if (typeof pollTimer === 'object' && typeof pollTimer.unref === 'function') pollTimer.unref();
          } catch (e) { pollTimer = null; }
        }

        // 退场：先摘入口，再停定时器与观察器。本实例此后不再说话。
        return () => {
          diagDone = true;
          try { clearTimeout(diagTimer); } catch (e) { /* ignore */ }
          try { if (observer) observer.disconnect(); } catch (e) { /* ignore */ }
          try { if (pollTimer !== null) clearInterval(pollTimer); } catch (e) { /* ignore */ }
          // uiReload 是模块级变量，可能已被新实例接管；只在自己还占着它时才清。
          if (uiReload === loadRef) uiReload = null;
          for (const d of disposers) { try { d(); } catch (e) { /* ignore */ } }
          disposers = [];
        };
      }
    }
    return {
      inject: ['slots', 'layout'],
      apply,
    };
  },
});
