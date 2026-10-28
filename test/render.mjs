/**
 * 把 client.js 的真实组件树渲染成静态 HTML，用于视觉验收（非手写 mock）。
 *
 *   node test/render.mjs          # 生成 out/panel*.html
 *
 * 原理：桩 React 加载真实 client.js，调用真实 Panel / ToolCard 组件函数，
 * 把元素树序列化为 HTML（style 对象转内联 CSS），并内联 client.js 里的 CSS。
 * 折叠块默认关闭；--expanded 变体先种入 open=true，再跑一轮 effect + 微任务，
 * 拿到设置表单 ready 态。
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'out');
const CLIENT_PATH = path.join(HERE, '..', 'client.js');

// ── 桩 React ──
// 状态按**组件实例**存放（真实 React 按实例隔离状态）；按全局 hook 序号取槽会让
// 折叠块展开后新挂载的组件串到别的组件的状态上。
const instState = new Map();
let currentInstance = null;
const effects = [];
function beginInstance(fn) {
  let rec = instState.get(fn);
  if (!rec) { rec = { count: 0, instances: [] }; instState.set(fn, rec); }
  const idx = rec.count++;
  if (!rec.instances[idx]) rec.instances[idx] = { hookIdx: 0, slots: [] };
  return rec.instances[idx];
}
const reactStub = {
  createElement(type, props, ...children) {
    const kids = children.length === 0 ? undefined : children.length === 1 ? children[0] : children;
    return { type, props: { ...(props || {}), children: kids } };
  },
  useState(init) {
    const inst = currentInstance || { hookIdx: 0, slots: [] };
    const i = inst.hookIdx;
    inst.hookIdx += 1;
    if (inst.slots.length <= i) inst.slots.push(typeof init === 'function' ? init() : init);
    return [inst.slots[i], (next) => { inst.slots[i] = typeof next === 'function' ? next(inst.slots[i]) : next; }];
  },
  useEffect(fn) { effects.push(fn); },
  useMemo(fn) { return fn(); },
  useCallback(fn) { return fn; },
  useRef(v) { return { current: v }; },
  memo(c) { return c; },
  Fragment: 'Fragment',
};
const resetHooks = () => {
  for (const rec of instState.values()) {
    rec.count = 0;
    for (const inst of rec.instances) inst.hookIdx = 0;
  }
  currentInstance = null;
};

globalThis.window = { __ModuleLoader__: { load: (spec) => { globalThis.__spec = spec; } } };
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'zh-CN', clipboard: { writeText: async () => {} } },
  configurable: true, writable: true,
});
const lsData = {};
globalThis.localStorage = {
  getItem: (k) => (k in lsData ? lsData[k] : null),
  setItem: (k, v) => { lsData[k] = String(v); },
};

const SETTINGS_BODY = {
  editable: ['placement', 'composerDock', 'minGapMs', 'windowLimit', 'defaultNewChat'],
  floor: { minGapMs: 5000, jitterMs: 1000, windowMs: 600000, windowLimitMax: 20, pollMs: 500, stableSamples: 2 },
  settings: {},
  effective: {
    placement: 'sidebar', composerDock: false,
    minGapMs: 7000, jitterMs: 3000, windowMs: 3600000, windowLimit: 6,
    pollMs: 900, stableSamples: 3, sendTimeoutMs: 180000,
    maxAnswerChars: 12000, followUpChars: 4000, systemPromptSection: true,
    webhookUrl: '', hooksFile: '', defaultNewChat: true,
  },
};
const STATUS_BODY = {
  ok: true,
  at: '2026-10-27T05:20:00.000Z',
  guardrails: {
    serial: true, busy: false, minGapMs: 7000, jitterMs: 3000,
    windowMs: 3600000, windowLimit: 6, windowUsed: 2,
    totalCalls: 11, rejectedBusy: 1, rejectedRate: 0, lastFinishedAt: '2026-10-27T05:19:00.000Z',
  },
  space: { locked: false, holder: null },
  storeStats: { discussions: 12, oldestAt: '2026-10-25T02:00:00.000Z', newestAt: '2026-10-27T05:19:00.000Z' },
  recent: [
    // 覆盖四种相对时间分支：分钟前 / 小时前 / 天前 / 日期兜底
    { id: 'd-20261027-131502-9a6b', title: '用一句话回答：8+8等于几？', createdAt: new Date(Date.now() - 3 * 60000).toISOString(), answerChars: 8 },
    { id: 'd-20261027-130951-65f8', title: 'G001 开局节奏与威胁感', createdAt: new Date(Date.now() - 5 * 3600000).toISOString(), answerChars: 5386 },
    { id: 'd-20261026-221045-a1b2', title: '布隆过滤器能不能替代缓存空值', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), answerChars: 274 },
    { id: 'd-20261020-090000-77cd', title: '方案对比：定时轮询 vs 长轮询 vs SSE', createdAt: new Date(Date.now() - 9 * 86400000).toISOString(), answerChars: 1201 },
  ],
  effective: { placement: 'sidebar', composerDock: false },
  presets: [
    {
      id: 'review', title: '方案评审', titleEn: 'Review',
      hint: '找出会让它失败的问题', hintEn: 'Find what would break it',
      defaultLevel: 'normal',
      levels: [
        { id: 'light', title: '轻', titleEn: 'Light', hint: '只说最致命的一个问题', template: '严格评审下面这份内容，只指出最致命的问题，不要鼓励。\n\n{prompt}' },
        { id: 'normal', title: '标准', titleEn: 'Normal', hint: '按三段结构回答', template: '严格评审下面这份内容，指出会致命的问题，不要鼓励、不要复述。\n按「致命问题 / 重要问题 / 只改一处改哪里」回答。\n\n{prompt}' },
        { id: 'strict', title: '严', titleEn: 'Strict', hint: '专找会推翻它的问题', template: '以最挑剔的评审者审阅下面内容，专找会把它推翻的问题；不确定就标为存疑。\n按「致命问题 / 重要问题 / 可商榷但可接受 / 只改一处改哪里」回答。\n\n{prompt}' },
      ],
    },
    {
      id: 'compare', title: '方案对比', titleEn: 'Compare',
      hint: '按维度对比多个方案', hintEn: 'Compare options by dimension',
      defaultLevel: 'normal',
      levels: [
        { id: 'light', title: '轻', titleEn: 'Light', hint: '只说最大差异', template: '对比下面几项，只说最大差异。\n\n{prompt}' },
        { id: 'normal', title: '标准', titleEn: 'Normal', hint: '按维度给取舍建议', template: '按维度对比下面几项，给出取舍建议。\n\n{prompt}' },
        { id: 'strict', title: '严', titleEn: 'Strict', hint: '找出被忽略的权衡', template: '严格对比下面几项，找出被忽略的权衡与失败条件。\n\n{prompt}' },
      ],
    },
  ],
};
globalThis.fetch = (url) => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve(
    String(url).includes('/status') ? STATUS_BODY : SETTINGS_BODY,
  ),
});

await import(pathToFileURL(CLIENT_PATH).href);
const clientSrc = await readFile(CLIENT_PATH, 'utf8');
const cssMatch = clientSrc.match(/\/\* @wai-css-start \*\/([\s\S]*?)\/\* @wai-css-end \*\//);
const CLIENT_CSS = cssMatch
  ? cssMatch[1].replace(/^\s*const CSS = `/, '').replace(/`;\s*$/, '')
  : '';

const mod = globalThis.__spec.factory((name) => {
  if (name === 'react') return reactStub;
  throw new Error(`unexpected require: ${name}`);
});

const registered = [];
const ctx = {
  slots: {
    inject: (n, cb) => { cb(); return () => {}; },
    register: (spec, comp) => { registered.push({ spec, comp }); return () => {}; },
  },
  layout: { selectPanel: () => {} },
};
// 让 placement='both'：侧边栏/主面板与 settings.section 两条入口都注册，
// 才能把 flat 模式的设置页一起渲染出来验收。
lsData['dsh-web-ai-discuss:ui'] = JSON.stringify({ placement: 'both', composerDock: true });
mod.apply(ctx);
const pick = (name) => registered.find((r) => r.spec.name === name);
const panelComp = pick('main').comp;
const cardComp = pick('tool.call.toolview').comp;
const iconComp = pick('sidebar.panellist').comp;
// settings.section 那条入口渲染的是 flat 模式（无线 Tab、整块平铺），
// 与侧边栏/主面板是两套排版，必须单独出图验收，否则「设置页界面没改」这类问题看不出来。
const settingsComp = pick('settings.section').comp;

// ── 序列化 ──
const cssOf = (style) => Object.entries(style || {})
  .filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
  .join(';');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);
// React 属性名 -> HTML 属性名；未列出的原样透传（保留 viewBox 这类大小写敏感的 SVG 属性）
const RENAME = {
  defaultValue: 'value', defaultChecked: 'checked', className: 'class', htmlFor: 'for',
};
const SKIP = new Set(['children', 'key', 'ref']);

function serialize(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  if (Array.isArray(node)) return node.map(serialize).join('');
  if (typeof node === 'object' && typeof node.type === 'function') {
    const saved = currentInstance;
    currentInstance = beginInstance(node.type);
    try {
      return serialize(node.type(node.props || {}));
    } finally {
      currentInstance = saved;
    }
  }
  const { type, props } = node;
  if (typeof type !== 'string') return serialize(props.children);
  const attrs = [];
  for (const [k, v] of Object.entries(props || {})) {
    if (SKIP.has(k) || v === null || v === undefined || v === false) continue;
    if (k === 'style') { attrs.push(`style="${esc(cssOf(v))}"`); continue; }
    if (k === 'defaultChecked') { if (v) attrs.push('checked'); continue; }
    if (k === 'open') { if (v === true) attrs.push('open'); continue; }
    if (k.startsWith('on') && typeof v === 'function') continue; // 事件处理器不进静态页
    attrs.push(`${RENAME[k] || k}="${esc(v)}"`);
  }
  const open = `<${type}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (VOID.has(type)) return `${open}>`;
  return `${open}>${serialize(props.children)}</${type}>`;
}

const tick = () => new Promise((r) => setTimeout(r, 25));

/**
 * 渲染一次并跑完 effect（用于让设置表单从 loading 走到 ready）。
 * expanded：展开所有 Fold；showRecent：把 LiveStatus 的「最近讨论」也展开。
 */
async function renderStable(comp, props, { expanded, tab, showRecent }) {
  resetHooks();
  effects.length = 0;
  serialize(comp(props)); // 首帧：收集 effect，同时把组件实例建出来
  if (expanded) {
    // 把所有 Fold 实例的 open 状态置真（等价于用户手动展开每个折叠块）
    for (const [fn, rec] of instState) {
      if (fn.name !== 'Fold') continue;
      for (const inst of rec.instances) if (inst.slots.length) inst.slots[0] = true;
    }
  }
  if (showRecent) {
    // LiveStatus 的第一个 useState 是 showRecent：置真等价于用户点了「最近讨论 (n) +」
    for (const [fn, rec] of instState) {
      if (fn.name !== 'LiveStatus') continue;
      for (const inst of rec.instances) if (inst.slots.length) inst.slots[0] = true;
    }
  }
  if (tab) {
    // Tabs 的第一个 useState 就是当前分区：直接改槽位等价于用户点了那个 Tab
    for (const [fn, rec] of instState) {
      if (fn.name !== 'Tabs') continue;
      for (const inst of rec.instances) if (inst.slots.length) inst.slots[0] = tab;
    }
  }
  const pending = effects.splice(0);
  for (const fn of pending) { try { fn(); } catch (e) { /* ignore */ } }
  await tick();
  resetHooks();
  effects.length = 0;
  const html = serialize(comp(props));
  for (const fn of effects.splice(0)) { try { fn(); } catch (e) { /* ignore */ } }
  await tick();
  resetHooks();
  effects.length = 0;
  // showRecent 必须在数据到位之后再置：LiveStatus 的槽位会被 fetch 回来的
  // setState 整体替换，首帧就设会被覆盖掉，等于没展开。
  // 槽位顺序：0 = state（{loading,data,error}），1 = showRecent，2 = copiedId。
  if (showRecent) {
    for (const [fn, rec] of instState) {
      if (fn.name !== 'LiveStatus') continue;
      for (const inst of rec.instances) if (inst.slots.length > 1) inst.slots[1] = true;
    }
  }
  const html2 = serialize(comp(props));
  return html2.length >= html.length ? html2 : html;
}

const ENVELOPE = {
  tool: 'web_ai_discuss', code: 'ok', reason: null, message: null,
  at: '2026-10-26T15:10:45.000Z', sessionKey: 'demo',
  discussionId: 'd-20261026-221045-a1b2', title: '缓存穿透的两种解法',
  answer: '布隆过滤器拦截不存在的 key；缓存空值并设短过期。\n前者适合 key 空间可控、允许极低误判的场景，后者实现成本更低，但对随机 key 更吃内存。',
  answerChars: 60, elapsedMs: 3640, newChat: true,
  guardrails: { serial: true, busy: false, minGapMs: 7000, jitterMs: 3000, windowLimit: 6, windowUsed: 1 },
  transport: { via: 'file', exitCode: 0 },
};
const cardOf = (value) => ({
  kind: 'tool-result', callId: 'c1', name: 'web_ai_discuss',
  content: [{ type: 'text', text: JSON.stringify(value) }], isError: false, subCalls: [],
});

function page({ dark, expanded, body }) {
  // 与宿主 dsh-client-ui-theme 一致的真实令牌（明/暗各一套），避免截图与真实界面脱节。
  const tokens = dark
    ? [
      '--dsw-alias-bg-base:#151517', '--dsw-alias-bg-layer-1:#232324', '--dsw-alias-bg-layer-2:#2c2c2e',
      '--dsw-alias-label-primary:#f9fafb', '--dsw-alias-label-secondary:#cfd3d6', '--dsw-alias-label-tertiary:#adb2b8',
      '--dsw-alias-label-caption:#81858c',
      '--dsw-alias-border-l1:#ffffff0f', '--dsw-alias-border-l2:#ffffff1f', '--dsw-alias-border-l3:#ffffff29', '--dsw-alias-border-l4:#fff3',
      '--dsw-alias-interactive-bg-hover:#ffffff14', '--dsw-alias-interactive-bg-hover-solid:#353638',
      '--dsw-alias-state-success-primary:#22c55e', '--dsw-alias-state-error-primary:#f25a5a',
      '--dsw-alias-state-warn-primary:#f59e0b', '--dsw-alias-state-business-primary:#7aaaff',
      '--dsw-alias-scrollbar-bg-l2:#545557', '--dsw-alias-scrollbar-hover-l2:#65676b',
      '--dsw-radius-xs:4px', '--dsw-radius-sm:8px', '--dsw-radius-md:12px', '--dsw-radius-lg:16px',
    ].join(';')
    : [
      '--dsw-alias-bg-base:#fff', '--dsw-alias-bg-layer-1:#fff', '--dsw-alias-bg-layer-2:#fff',
      '--dsw-alias-label-primary:#0f1115', '--dsw-alias-label-secondary:#61666b', '--dsw-alias-label-tertiary:#81858c',
      '--dsw-alias-label-caption:#adb2b8',
      '--dsw-alias-border-l1:#0000000a', '--dsw-alias-border-l2:#0000001a', '--dsw-alias-border-l3:#0000001f', '--dsw-alias-border-l4:#00000029',
      '--dsw-alias-interactive-bg-hover:#2631480f', '--dsw-alias-interactive-bg-hover-solid:#f1f3f5',
      '--dsw-alias-state-success-primary:#22c55e', '--dsw-alias-state-error-primary:#ec1313',
      '--dsw-alias-state-warn-primary:#f59e0b', '--dsw-alias-state-business-primary:#4176e6',
      '--dsw-alias-scrollbar-bg-l2:#e1e5ee', '--dsw-alias-scrollbar-hover-l2:#cfd3d6',
      '--dsw-radius-xs:4px', '--dsw-radius-sm:8px', '--dsw-radius-md:12px', '--dsw-radius-lg:16px',
    ].join(';');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>dsh-web-ai-discuss · 视觉验收${expanded ? ' · 展开' : ''}</title>
<style>
  :root { ${tokens} }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
  .stage { display:flex; gap:24px; padding:24px; align-items:flex-start; flex-wrap:wrap; }
  .frame { border-radius:12px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,0.16); border:1px solid var(--dsw-alias-border-l2); }
  .frame.main { width:760px; }
  .frame.side { width:392px; }
  .frame.narrow { width:340px; }
  .frame .bar { font-size:11px; letter-spacing:.06em; text-transform:uppercase; padding:9px 14px;
                color:var(--dsw-alias-label-secondary); border-bottom:1px solid var(--dsw-alias-border-l2); }
  .scroll { overflow-y:auto; }
  .frame.side .scroll { padding:16px; }
  .icons { display:flex; gap:10px; padding:14px 0 0; align-items:center; }
  .icons .chip { border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:8px; }
  ${CLIENT_CSS}
</style></head>
<body><div class="stage">${body}</div></body></html>`;
}

await mkdir(OUT, { recursive: true });

const panelCollapsed = await renderStable(panelComp, {}, { expanded: false });
const panelExpanded = await renderStable(panelComp, {}, { expanded: true });
// 最近讨论展开态：面板里唯一展示真实历史数据的地方，必须单独出图验收
const panelRecent = await renderStable(panelComp, {}, { expanded: false, showRecent: true });
const panelPreset = await renderStable(panelComp, {}, { expanded: false, tab: 'preset' });
const panelSettings = await renderStable(panelComp, {}, { expanded: false, tab: 'settings' });
// settings.section 入口：flat 模式，没有 Tab，概览/预设/设置一路平铺在一个面板里。
// 这条路径此前完全没出过图，所以「设置页界面没改」是验收盲区。
const flatLight = await renderStable(settingsComp, {}, { expanded: true });
const flatDark = await renderStable(settingsComp, {}, { expanded: true });
const cardOk = await renderStable(cardComp, { phase: 'result', block: cardOf(ENVELOPE), sessionId: 'demo' }, { expanded: false });
const cardBusy = await renderStable(cardComp, {
  phase: 'result', sessionId: 'demo',
  block: cardOf({ tool: 'web_ai_discuss', code: 'rate_limited', reason: 'window_limit_reached', message: '窗口内次数用尽，约 12 分钟后可再试', retryAfterMs: 720000, sessionKey: 'demo' }),
}, { expanded: false });
const iconActive = serialize(iconComp({ size: 20, active: true }));
resetHooks();
const iconIdle = serialize(iconComp({ size: 20, active: false }));
resetHooks();

const variants = [
  ['panel', false, panelCollapsed, null],
  ['panel-expanded', false, panelExpanded, null],
  ['panel-dark', true, panelCollapsed, null],
  ['panel-dark-expanded', true, panelExpanded, null],
  ['panel-preset', false, panelPreset, null],
  ['panel-settings', false, panelSettings, null],
  ['panel-recent', false, panelRecent, null],
  ['panel-flat', false, flatLight, null],
  ['panel-flat-dark', true, flatDark, null],
];
for (const [name, dark, panelHtml, _] of variants) {
  const side = `<div class="frame side"><div class="bar">会话卡片</div><div class="scroll">
      ${cardOk}${cardBusy}
      <div class="icons"><div class="chip">${iconActive}</div><div class="chip" style="opacity:.55">${iconIdle}</div></div>
    </div></div>`;
  const main = `<div class="frame main"><div class="bar">main 面板</div><div class="scroll">${panelHtml}</div></div>`;
  const narrow = `<div class="frame narrow"><div class="bar">侧边栏 340px</div><div class="scroll">${panelHtml}</div></div>`;
  await writeFile(path.join(OUT, `${name}.html`), page({ dark, expanded: name.includes('expanded'), body: main + narrow + side }), 'utf8');
}
console.log('wrote out/panel.html, panel-expanded.html, panel-dark.html, panel-dark-expanded.html, panel-preset.html, panel-settings.html, panel-flat.html, panel-flat-dark.html, panel-recent.html');
