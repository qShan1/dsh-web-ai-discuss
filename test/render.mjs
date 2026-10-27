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
const hookSlots = [];
let hookIndex = 0;
const effects = [];
const reactStub = {
  createElement(type, props, ...children) {
    const kids = children.length === 0 ? undefined : children.length === 1 ? children[0] : children;
    return { type, props: { ...(props || {}), children: kids } };
  },
  useState(init) {
    const i = hookIndex;
    hookIndex += 1;
    if (hookSlots.length <= i) hookSlots.push(typeof init === 'function' ? init() : init);
    return [hookSlots[i], (next) => { hookSlots[i] = typeof next === 'function' ? next(hookSlots[i]) : next; }];
  },
  useEffect(fn) { effects.push(fn); },
  useMemo(fn) { return fn(); },
  useCallback(fn) { return fn; },
  useRef(v) { return { current: v }; },
  memo(c) { return c; },
  Fragment: 'Fragment',
};
const resetHooks = () => { hookIndex = 0; };

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
    { id: 'd-20261027-131502-9a6b', title: '用一句话回答：8+8等于几？', createdAt: '2026-10-27T05:15:02.000Z', answerChars: 8 },
    { id: 'd-20261027-130951-65f8', title: '用一句话回答：1+1等于几？', createdAt: '2026-10-27T05:09:51.000Z', answerChars: 7 },
  ],
  effective: { placement: 'sidebar', composerDock: false },
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
mod.apply(ctx);
const pick = (name) => registered.find((r) => r.spec.name === name);
const panelComp = pick('main').comp;
const cardComp = pick('tool.call.toolview').comp;
const iconComp = pick('sidebar.panellist').comp;

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
const SKIP = new Set(['children', 'key', 'ref', 'style']);

function serialize(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  if (Array.isArray(node)) return node.map(serialize).join('');
  if (typeof node === 'object' && typeof node.type === 'function') {
    const saved = hookIndex;
    const out = serialize(node.type(node.props || {}));
    hookIndex = saved;
    return out;
  }
  const { type, props } = node;
  if (typeof type !== 'string') return serialize(props.children);
  const attrs = [];
  for (const [k, v] of Object.entries(props || {})) {
    if (SKIP.has(k) || v === null || v === undefined || v === false) continue;
    if (k === 'style') { attrs.push(`style="${esc(cssOf(v))}"`); continue; }
    if (k === 'defaultChecked') { if (v) attrs.push('checked'); continue; }
    if (k.startsWith('on') && typeof v === 'function') continue; // 事件处理器不进静态页
    attrs.push(`${RENAME[k] || k}="${esc(v)}"`);
  }
  const open = `<${type}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (VOID.has(type)) return `${open}>`;
  return `${open}>${serialize(props.children)}</${type}>`;
}

const tick = () => new Promise((r) => setTimeout(r, 25));

/** 渲染一次并跑完 effect（用于让设置表单从 loading 走到 ready）。 */
async function renderStable(comp, props, { expanded }) {
  hookSlots.length = 0;
  if (expanded) hookSlots.push(true, true); // 说明区 + 设置区两个 details
  resetHooks();
  effects.length = 0;
  serialize(comp(props)); // 首帧：收集 effect
  const pending = effects.splice(0);
  for (const fn of pending) { try { fn(); } catch (e) { /* ignore */ } }
  await tick();
  resetHooks();
  effects.length = 0;
  const html = serialize(comp(props));
  for (const fn of effects.splice(0)) { try { fn(); } catch (e) { /* ignore */ } }
  return html;
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
  const tokens = dark
    ? `--dsw-alias-text-primary:#e8e8e8;--dsw-alias-text-secondary:#a0a0a0;--dsw-alias-border-primary:rgba(255,255,255,0.15);--dsw-alias-border-strong:rgba(255,255,255,0.28);--dsw-alias-bg-primary:#181818;--dsw-alias-bg-secondary:rgba(255,255,255,0.08);--dsw-alias-bg-tertiary:rgba(255,255,255,0.14);--dsw-alias-accent:#5b8cff;--dsw-alias-accent-hover:#4b7bec;--dsw-alias-state-success:#57d68d;--dsw-alias-state-warning:#f0b429;--dsw-alias-state-error:#ff7b6b;`
    : `--dsw-alias-text-primary:#1a1a1a;--dsw-alias-text-secondary:#6b6b6b;--dsw-alias-border-primary:rgba(0,0,0,0.14);--dsw-alias-border-strong:rgba(0,0,0,0.28);--dsw-alias-bg-primary:#ffffff;--dsw-alias-bg-secondary:rgba(0,0,0,0.05);--dsw-alias-bg-tertiary:rgba(0,0,0,0.1);--dsw-alias-accent:#2f6df6;--dsw-alias-accent-hover:#245ad6;--dsw-alias-state-success:#128a4a;--dsw-alias-state-warning:#a35c00;--dsw-alias-state-error:#c0392b;`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>dsh-web-ai-discuss · 视觉验收${expanded ? ' · 展开' : ''}</title>
<style>
  :root { ${tokens} }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         background: var(--dsw-alias-bg-primary); color: var(--dsw-alias-text-primary); }
  .stage { display:flex; gap:24px; padding:24px; align-items:flex-start; flex-wrap:wrap; }
  .frame { border-radius:12px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,0.16); border:1px solid var(--dsw-alias-border-primary); }
  .frame.main { width:760px; height:900px; }
  .frame.side { width:392px; height:900px; }
  .frame .bar { font-size:11px; letter-spacing:.06em; text-transform:uppercase; padding:9px 14px;
                color:var(--dsw-alias-text-secondary); border-bottom:1px solid var(--dsw-alias-border-primary); }
  .scroll { height:calc(100% - 35px); overflow-y:auto; }
  .frame.side .scroll { padding:16px; }
  .icons { display:flex; gap:10px; padding:14px 0 0; align-items:center; }
  .icons .chip { border:1px solid var(--dsw-alias-border-primary); border-radius:8px; padding:8px; }
  ${CLIENT_CSS}
</style></head>
<body><div class="stage">${body}</div></body></html>`;
}

await mkdir(OUT, { recursive: true });

const panelCollapsed = await renderStable(panelComp, {}, { expanded: false });
const panelExpanded = await renderStable(panelComp, {}, { expanded: true });
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
];
for (const [name, dark, panelHtml, _] of variants) {
  const side = `<div class="frame side"><div class="bar">会话卡片</div><div class="scroll">
      ${cardOk}${cardBusy}
      <div class="icons"><div class="chip">${iconActive}</div><div class="chip" style="opacity:.55">${iconIdle}</div></div>
    </div></div>`;
  const main = `<div class="frame main"><div class="bar">main 面板</div><div class="scroll">${panelHtml}</div></div>`;
  await writeFile(path.join(OUT, `${name}.html`), page({ dark, expanded: name.includes('expanded'), body: main + side }), 'utf8');
}
console.log('wrote out/panel.html, panel-expanded.html, panel-dark.html, panel-dark-expanded.html');
