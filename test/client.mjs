/**
 * 客户端半（client.js）的离线契约与渲染测试。
 *
 * 本机没有可用的 React 实例（dsh 安装目录不含 react/react-dom，Web 侧 React 在打包产物里），
 * 也没有可截图验证的浏览器通道（bsk 未安装；9295 需要进程内 launch token）。
 * 因此这里用「桩 React」加载真实 client.js，验证：
 *   1) 模块外壳 id 与 export 形状
 *   2) 三处 slot 注册的 spec（id/key/order/label）
 *   3) 面板与工具卡片渲染出的文本（真实组件函数，非重写）
 *   4) 每会话首次自动 selectPanel 一次、不重复打扰
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, '..', 'client.js');

let passed = 0;
let failed = 0;
const check = (label, cond, detail) => {
  if (cond) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}${detail === undefined ? '' : `  (${JSON.stringify(detail)})`}`);
  }
};

// ── 桩环境 ──────────────────────────────────────────────
// 状态按**组件实例**存放，而不是按全局 hook 调用序号：折叠块展开后新挂载的
// 组件若按全局序号取状态，会串到别的组件的状态槽上（真实 React 按实例隔离）。
// 实例在多次渲染之间保留，所以展开/收起与异步 setState 的语义与真实 React 一致。
const instState = new Map();
let currentInstance = null;
const effects = [];
const FALLBACK_INSTANCE = { hookIdx: 0, slots: [] };

function beginInstance(fn) {
  let rec = instState.get(fn);
  if (!rec) {
    rec = { count: 0, instances: [] };
    instState.set(fn, rec);
  }
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
    const inst = currentInstance || FALLBACK_INSTANCE;
    const i = inst.hookIdx;
    inst.hookIdx += 1;
    if (inst.slots.length <= i) inst.slots.push(typeof init === 'function' ? init() : init);
    const set = (next) => {
      inst.slots[i] = typeof next === 'function' ? next(inst.slots[i]) : next;
    };
    return [inst.slots[i], set];
  },
  useEffect(fn) {
    effects.push(fn);
  },
  useMemo(fn) {
    return fn();
  },
  useCallback(fn) {
    return fn;
  },
  useRef(v) {
    return { current: v };
  },
  memo(c) {
    return c;
  },
  Fragment: 'Fragment',
};
const resetHooks = () => {
  for (const rec of instState.values()) {
    rec.count = 0;
    // 每个实例的 hook 游标也要归零：新一轮渲染从第 0 个 hook 开始，
    // 但状态槽位保留（真实 React 就是这样：hook 顺序不变，值延续）。
    for (const inst of rec.instances) inst.hookIdx = 0;
  }
  currentInstance = null;
};

let spec = null;
globalThis.window = {
  __ModuleLoader__: {
    load(input) {
      spec = input;
    },
  },
};
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'zh-CN', clipboard: { writeText: async () => {} } },
  configurable: true,
  writable: true,
});

// ── 加载真实 client.js ──────────────────────────────────
await import(pathToFileURL(CLIENT).href);

check('模块外壳：window.__ModuleLoader__.load 被调用', spec !== null);
check('模块外壳：id 等于包名', spec && spec.id === 'dsh-web-ai-discuss', spec && spec.id);

const mod = spec.factory((name) => {
  if (name === 'react') return reactStub;
  throw new Error(`unexpected require(${name})`);
});

check('inject 声明 slots 与 layout', Array.isArray(mod.inject)
  && mod.inject.includes('slots') && mod.inject.includes('layout'), mod.inject);
check('apply 是函数', typeof mod.apply === 'function');

// ── 假 ctx：记录注册 ────────────────────────────────────
const registered = [];
const selectedPanels = [];
// effect 托管：apply 必须把定时器/观察器交给宿主 fiber，而不是裸跑
const effectDisposers = [];
const fakeCtx = {
  slots: {
    inject(name, factory) {
      check(`slots.inject 目标合法：${name}`, ['sidebar.panellist', 'main', 'tool.call.toolview', 'settings.section'].includes(name), name);
      return factory();
    },
    register(spec2, component) {
      registered.push({ spec: spec2, component });
      return () => {};
    },
  },
  layout: {
    selectPanel(id) {
      selectedPanels.push(id);
    },
  },
  effect(setup) {
    const dispose = setup();
    if (typeof dispose === 'function') effectDisposers.push(dispose);
    return dispose;
  },
};

mod.apply(fakeCtx);

check('apply 用 pluginCtx.effect 托管副作用', effectDisposers.length === 1, effectDisposers.length);

// 默认入口是 both（侧边栏格子 + 主面板 + 设置页分区 + 工具卡片），四处都注册。
check('默认位置 both：注册四处 slot', registered.length === 4, registered.length);
check('默认位置 both：侧边栏与设置页分区都在',
  registered.some((r) => r.spec.name === 'sidebar.panellist')
  && registered.some((r) => r.spec.name === 'settings.section'),
  registered.map((r) => r.spec.name));

const byName = (name) => registered.find((r) => r.spec.name === name);

const side = byName('sidebar.panellist');
check('侧边栏：id=web-ai-discuss', side && side.spec.id === 'web-ai-discuss', side && side.spec);
check('侧边栏：order=40', side && side.spec.order === 40, side && side.spec.order);
check('侧边栏：label 可取到字符串', side && typeof side.spec.label === 'function'
  && side.spec.label() === 'DeepSeek 讨论', side && side.spec.label && side.spec.label());

const mainSlot = byName('main');
check('主面板：key=web-ai-discuss', mainSlot && mainSlot.spec.key === 'web-ai-discuss', mainSlot && mainSlot.spec);

const view = byName('tool.call.toolview');
check('工具卡片：key=web_ai_discuss', view && view.spec.key === 'web_ai_discuss', view && view.spec);
check('工具卡片：inject(带 sessionId 的输入) 返回 sessionKey',
  view && typeof view.spec.inject === 'function'
  && view.spec.inject({ sessionId: 'S-abc' }).sessionKey === 'S-abc',
  view && view.spec.inject && view.spec.inject({ sessionId: 'S-abc' }));

// ── 渲染树取文本 ────────────────────────────────────────
// 渲染组件时把「当前实例」切到该组件，桩 useState 才知道状态存到哪。
const renderComponent = (node) => {
  const prev = currentInstance;
  currentInstance = beginInstance(node.type);
  try {
    return node.type(node.props || {});
  } finally {
    currentInstance = prev;
  }
};

const textOf = (node) => {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && typeof node.type === 'function') return textOf(renderComponent(node));
  const kids = node.props ? node.props.children : undefined;
  return textOf(kids);
};

// 桩 fetch：记录调用。/status 与 /settings 返回不同的体。
const STATUS_BODY = {
  ok: true,
  at: '2026-10-27T05:20:00.000Z',
  guardrails: { serial: true, busy: false, windowLimit: 6, windowUsed: 2, totalCalls: 11 },
  space: { locked: false, holder: null },
  storeStats: { discussions: 12 },
  recent: [{ id: 'd-20261027-131502-9a6b', title: '用一句话回答：8+8等于几？' }],
  presets: [
    {
      id: 'review',
      title: '方案评审',
      hint: '挑出致命问题',
      defaultLevel: 'normal',
      levels: [
        { id: 'light', title: '轻', hint: '只说最致命的问题', template: '严格评审下面这份内容，只指出最致命的问题。\n\n{prompt}' },
        { id: 'normal', title: '标准', hint: '默认强度', template: '严格评审下面这份内容，指出会致命的问题。\n\n{prompt}' },
        { id: 'strict', title: '严', hint: '专找推翻它的问题', template: '以最挑剔的评审者审阅下面内容，专找会把它推翻的问题。\n\n{prompt}' },
      ],
    },
    {
      id: 'compare',
      title: '方案对比',
      hint: '按维度比较',
      defaultLevel: 'normal',
      levels: [
        { id: 'light', title: '轻', hint: '只说最大差异', template: '对比下面几项，只说最大差异。\n\n{prompt}' },
        { id: 'normal', title: '标准', hint: '默认强度', template: '按维度对比下面几项，给出取舍建议。\n\n{prompt}' },
        { id: 'strict', title: '严', hint: '找出被忽略的权衡', template: '严格对比下面几项，找出被忽略的权衡与失败条件。\n\n{prompt}' },
      ],
    },
  ],
};
const SETTINGS_BODY = {
  editable: ['minGapMs', 'windowLimit', 'defaultNewChat', 'webhookUrl', 'hooksFile'],
  floor: { minGapMs: 5000, jitterMs: 1000, windowMs: 600000, windowLimitMax: 20, pollMs: 500, stableSamples: 2 },
  settings: {},
  effective: { minGapMs: 7000, jitterMs: 3000, windowMs: 3600000, windowLimit: 6, pollMs: 900,
    stableSamples: 3, sendTimeoutMs: 180000, maxAnswerChars: 12000, systemPromptSection: true,
    webhookUrl: '', webhookTimeoutMs: 5000, hooksFile: '', defaultNewChat: true, followUpChars: 4000 },
};
let fetchCalls = [];
globalThis.fetch = (url, init) => {
  fetchCalls.push({ url, init });
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(
      String(url).includes('/status') ? STATUS_BODY : SETTINGS_BODY,
    ),
  });
};
const flush = async () => {
  const pending = effects.splice(0);
  for (const fn of pending) fn();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

// ── 面板首屏（Tab 分区 + 懒挂载语义）──
// 侧边栏面板改成三个 Tab（概览/预设/设置）：首屏只渲染概览里的运行状态与说明折叠，
// 预设区与设置表单都要切过去才挂载，避免窄栏一路往下翻。
const collectByClass = (node, cls, out = []) => {
  if (!node || typeof node !== 'object' || node === false) return out;
  if (Array.isArray(node)) { node.forEach((n) => collectByClass(n, cls, out)); return out; }
  if (typeof node.type === 'function') { collectByClass(renderComponent(node), cls, out); return out; }
  const cn = node.props && node.props.className;
  if (typeof cn === 'string' && cn.split(/\s+/).includes(cls)) out.push(node);
  if (node.props) collectByClass(node.props.children, cls, out);
  return out;
};

resetHooks();
effects.length = 0;
const panelTree = mainSlot.component({});
const panelText = textOf(panelTree);
check('面板：含定位说明', panelText.includes('外部讨论通道'), panelText.slice(0, 60));
check('面板：含构建戳 0.6.0', panelText.includes('build 0.6.0'), panelText.slice(0, 140));
check('面板：含三个分区标签', panelText.includes('概览') && panelText.includes('预设') && panelText.includes('设置'), panelText.slice(0, 400));
check('面板：首屏停在概览分区（不含设置字段）',
  panelText.includes('运行状态') && !panelText.includes('窗口上限'), panelText.slice(0, 400));
check('面板：首屏不渲染护栏/返回码明细',
  !panelText.includes('rate_limited') && fetchCalls.length === 0, { fetches: fetchCalls.map((f) => f.url) });
check('面板：首屏不挂载设置表单（未打 settings 路由）',
  !fetchCalls.some((f) => f.url === '/web-ai-discuss/api/settings'),
  fetchCalls.map((f) => f.url));

await flush(); // 概览分区 LiveStatus 的 load effect → fetch
check('运行状态：GET 打到 /status 路由',
  fetchCalls.some((f) => f.url === '/web-ai-discuss/api/status'),
  fetchCalls.map((f) => f.url));
resetHooks();
const overviewText = textOf(mainSlot.component({}));
check('运行状态：渲染用量/空间/记录三项',
  overviewText.includes('窗口用量') && overviewText.includes('ego 空间') && overviewText.includes('讨论记录'),
  overviewText.slice(overviewText.indexOf('运行状态'), overviewText.indexOf('运行状态') + 160));

// 切到「设置」分区
const clickTab = (label) => {
  resetHooks();
  const tabs = collectByClass(mainSlot.component({}), 'wai-tab');
  const target = tabs.find((t) => textOf(t).includes(label));
  if (!target || !target.props.onClick) return false;
  target.props.onClick();
  return true;
};

check('切到设置分区成功', clickTab('设置'));
// 切分区后必须先渲染一次让 SettingsForm 挂载（useEffect 才会登记），再冲刷 effect
resetHooks();
textOf(mainSlot.component({}));
await flush(); // SettingsForm 的 load effect → fetch → setState
resetHooks();
const settingsText = textOf(mainSlot.component({}));
check('设置区：渲染分组标题（发送与判定/输出与扩展）',
  settingsText.includes('发送与判定') && settingsText.includes('输出与扩展'),
  settingsText.slice(settingsText.indexOf('自定义设置'), settingsText.indexOf('自定义设置') + 220));
check('设置区：渲染字段与下限',
  settingsText.includes('窗口上限') && settingsText.includes('最小间隔') && settingsText.includes('下限 5000'));
check('设置区：渲染保存/重新读取/恢复默认按钮',
  settingsText.includes('保存修改') && settingsText.includes('重新读取') && settingsText.includes('恢复默认'));
check('设置区：GET 打到 /settings 路由',
  fetchCalls.some((f) => f.url === '/web-ai-discuss/api/settings'),
  fetchCalls.map((f) => f.url));

// 入口位置按「两个独立勾选框」呈现（placement 枚举对外仍是 sidebar/settings/both）：
// 勾选框的组合与枚举一一映射，两个都不勾没有对应值，必须就地挡住。
resetHooks();
const settingsTree = mainSlot.component({});
// 字段标签在 .wai-field 下、勾选框在其中的 .wai-check 里，取整行文本判断。
const fieldsWithCheck = collectByClass(settingsTree, 'wai-field')
  .filter((f) => collectByClass(f, 'wai-check').length === 1)
  .map((f) => textOf(f));
const checkboxLabels = fieldsWithCheck
  .filter((t) => t.includes('侧边栏图标') || t.includes('设置页分区'));
check('设置区：入口位置拆成两个勾选框（侧边栏图标 / 设置页分区）',
  checkboxLabels.length === 2
  && checkboxLabels.some((t) => t.includes('侧边栏图标'))
  && checkboxLabels.some((t) => t.includes('设置页分区')),
  checkboxLabels);
const selectCount = (() => {
  let n = 0;
  const walk = (node) => {
    if (!node || typeof node !== 'object' || node === false) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === 'function') { walk(renderComponent(node)); return; }
    if (node.type === 'select') n += 1;
    if (node.props) walk(node.props.children);
  };
  walk(settingsTree);
  return n;
})();
check('设置区：入口位置不再是下拉框', selectCount === 0, selectCount);

// 切到「预设」分区
check('切到预设分区成功', clickTab('预设'));
resetHooks();
textOf(mainSlot.component({}));
await flush(); // PresetBlock 的 fetch → setState
resetHooks();
const presetText = textOf(mainSlot.component({}));
check('预设区：渲染预设条目与 id',
  presetText.includes('review') && presetText.includes('compare')
  && presetText.includes('方案评审') && presetText.includes('方案对比'),
  presetText.slice(presetText.indexOf('预设'), presetText.indexOf('预设') + 200));
check('预设区：含档位分段控件（轻/标准/严）',
  presetText.includes('轻') && presetText.includes('标准') && presetText.includes('严'), presetText.slice(0, 300));
check('预设区：每条带「看模板」与「复制调用」',
  presetText.includes('看模板') && presetText.includes('复制调用'), presetText.slice(-300));
check('预设区：当前档位标在条目上（:normal）', presetText.includes(':normal'), presetText.slice(0, 400));

// 展开某条预设的模板预览
{
  resetHooks();
  const shows = collectByClass(mainSlot.component({}), 'wai-preset-action');
  const btn = shows.flatMap((a) => (a.props && a.props.children ? [].concat(a.props.children) : []))
    .find((b) => b && b.props && typeof b.props.onClick === 'function' && textOf(b).includes('看模板'));
  if (btn) btn.props.onClick();
  resetHooks();
  const tmplText = textOf(mainSlot.component({}));
  check('预设区：看模板后渲染模板预览', tmplText.includes('严格评审下面这份内容'), tmplText.slice(-400));
}

// 侧边栏图标
const iconTree = side.component({ size: 20, active: true });
check('图标：返回 svg 且尺寸来自 ownerProps', iconTree && iconTree.type === 'svg'
  && iconTree.props.width === 20, iconTree && iconTree.type);

// 工具卡片：ok
const okEnvelope = {
  tool: 'web_ai_discuss',
  code: 'ok',
  reason: null,
  message: 'discussed',
  at: '2026-10-24T22:00:00.000Z',
  sessionKey: 'S-1',
  answer: '这是来自网页版 DeepSeek 的回答原文。',
  answerChars: 18,
};
const okBlock = {
  kind: 'tool-result',
  callId: 'c1',
  name: 'web_ai_discuss',
  content: [{ type: 'text', text: JSON.stringify(okEnvelope, null, 1) }],
  isError: false,
  subCalls: [],
};
effects.length = 0;
const okTree = view.component({ phase: 'result', block: okBlock, sessionId: 'S-1' });
const okText = textOf(okTree);
check('卡片(ok)：显示 code', okText.includes('ok'));
check('卡片(ok)：显示回答原文', okText.includes('这是来自网页版 DeepSeek 的回答原文。'));
check('卡片(ok)：挂载后注册了一次 effect', effects.length === 1, effects.length);
check('卡片(ok)：挂载前未自动切面板', selectedPanels.length === 0, selectedPanels.length);
effects[0]();
check('卡片(ok)：首次挂载自动切到本面板', selectedPanels.length === 1 && selectedPanels[0] === 'web-ai-discuss', selectedPanels);

// 同一会话第二次挂载：不再打扰
effects.length = 0;
const okTree2 = view.component({ phase: 'result', block: okBlock, sessionId: 'S-1' });
textOf(okTree2);
effects[0]();
check('卡片：同一会话不重复切换面板', selectedPanels.length === 1, selectedPanels.length);

// 工具卡片：带附件
const attachEnvelope = {
  tool: 'web_ai_discuss',
  code: 'ok',
  reason: null,
  message: null,
  at: '2026-10-27T05:40:00.000Z',
  sessionKey: 'S-9',
  answer: '附件说了一个标题。',
  answerChars: 9,
  discussionId: 'd-20261027-134000-abcd',
  attachments: ['C:/tmp/report.pdf', 'C:/tmp/notes.md'],
};
const attachBlock = {
  kind: 'tool-result',
  callId: 'c9',
  name: 'web_ai_discuss',
  content: [{ type: 'text', text: JSON.stringify(attachEnvelope, null, 1) }],
  isError: false,
  subCalls: [],
};
const attachText = textOf(view.component({ phase: 'result', block: attachBlock, sessionId: 'S-9' }));
check('卡片(附件)：显示附件文件名', attachText.includes('report.pdf') && attachText.includes('notes.md'), attachText);

// 工具卡片：unauthorized（且不出现登录话术）
const unEnvelope = {
  tool: 'web_ai_discuss',
  code: 'unauthorized',
  reason: 'not_logged_in',
  message: 'web page needs a human takeover',
  sessionKey: 'S-2',
  handoff: { started: true, spaceId: 2 },
};
const unBlock = {
  kind: 'tool-result',
  callId: 'c2',
  name: 'web_ai_discuss',
  content: [{ type: 'text', text: JSON.stringify(unEnvelope, null, 1) }],
  isError: false,
  subCalls: [],
};
const unText = textOf(view.component({ phase: 'result', block: unBlock, sessionId: 'S-2' }));
check('卡片(unauthorized)：显示 code 与 reason', unText.includes('unauthorized') && unText.includes('not_logged_in'));
check('卡片(unauthorized)：不出现登录提示话术', !/登录|sign in|log in/i.test(unText), unText);

// 工具卡片：宿主侧异常（isError）
const errBlock = {
  kind: 'tool-result',
  callId: 'c3',
  name: 'web_ai_discuss',
  content: [],
  isError: true,
  error: { name: 'Error', code: 'boom', message: 'spawn failed' },
  subCalls: [],
};
const errText = textOf(view.component({ phase: 'result', block: errBlock, sessionId: 'S-3' }));
check('卡片(宿主异常)：显示 failed 与错误信息', errText.includes('failed') && errText.includes('spawn failed'), errText);

// 工具卡片：进行中
const startText = textOf(view.component({ phase: 'start', block: { callId: 'c4', name: 'web_ai_discuss', argsRaw: '{}', subCalls: [] }, sessionId: 'S-4' }));
check('卡片(进行中)：显示进行中状态', startText.includes('进行中'), startText);

// ── 显示位置（placement）挂载策略 ──
// 桩 localStorage：缓存值可在两次 apply 之间传递
const lsData = {};
globalThis.localStorage = {
  getItem: (k) => (k in lsData ? lsData[k] : null),
  setItem: (k, v) => { lsData[k] = String(v); },
};
// apply2：fetch 返回 placement='settings'，应注册 settings.section、不注册侧边栏格子
let fetch2Calls = [];
globalThis.fetch = (url, init) => {
  fetch2Calls.push(url);
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      editable: [], floor: {}, settings: { placement: 'settings' },
      effective: { placement: 'settings', composerDock: false },
    }),
  });
};
const LS_KEY_TEST = 'dsh-web-ai-discuss:ui';
const allRegs2 = [];
const ctx2 = {
  slots: {
    // 注入级 dispose：撤掉该注入产生过的注册（模拟宿主行为）
    inject(name, cb) {
      const start = allRegs2.length;
      cb();
      const mine = allRegs2.slice(start);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        for (const r of mine) {
          const i = allRegs2.indexOf(r);
          if (i >= 0) allRegs2.splice(i, 1);
        }
      };
    },
    register(spec) { allRegs2.push(spec.name); return () => {}; },
  },
  layout: { selectPanel() {} },
  effect(setup) {
    const dispose = setup();
    if (typeof dispose === 'function') effectDisposers.push(dispose);
    return dispose;
  },
};
mod.apply(ctx2);
await new Promise((r) => setTimeout(r, 10)); // 等 fetch → uiReload → 重挂完成
check('位置=设置页：注册 settings.section', allRegs2.includes('settings.section'), allRegs2);
check('位置=设置页：不保留侧边栏格子与 main',
  !allRegs2.includes('sidebar.panellist') && !allRegs2.includes('main'), allRegs2);
check('位置=设置页：工具卡片仍注册', allRegs2.includes('tool.call.toolview'), allRegs2);
check('位置写入了 localStorage 缓存', (lsData[LS_KEY_TEST] || '').includes('settings'), lsData);

// ── 退场清理：宿主替换模块时不能留下活体（旧实例的定时器/观察器必须停）──
// 这是实测过的真问题：早期版本裸跑 setInterval/MutationObserver，
// HMR 换模块后旧实例继续上报、旧 UI 赖着不走。
{
  const clearedTimeouts = [];
  const clearedIntervals = [];
  const realClearTimeout = globalThis.clearTimeout;
  const realClearInterval = globalThis.clearInterval;
  let observed = 0;
  let disconnected = 0;
  const RealMO = globalThis.MutationObserver;

  globalThis.clearTimeout = (t) => { clearedTimeouts.push(t); return realClearTimeout(t); };
  globalThis.clearInterval = (t) => { clearedIntervals.push(t); return realClearInterval(t); };
  globalThis.MutationObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { observed += 1; }
    disconnect() { disconnected += 1; }
  };

  const cleanupCtx = {
    slots: {
      inject(name, cb) { check(`清理用例 slots.inject 目标合法：${name}`, ['sidebar.panellist', 'main', 'tool.call.toolview', 'settings.section'].includes(name), name); cb(); return () => {}; },
      register() { return () => {}; },
    },
    layout: { selectPanel() {} },
    effect(setup) {
      const dispose = setup();
      if (typeof dispose === 'function') effectDisposers.push(dispose);
      return dispose;
    },
  };

  const before = effectDisposers.length;
  // 观察器只在有 document.body 时才建；本用例需要它来验证 disconnect。
  const hadDocument = 'document' in globalThis;
  const realDocument = globalThis.document;
  globalThis.document = { body: {}, querySelector: () => null };
  mod.apply(cleanupCtx);
  check('清理用例：apply 交出一个可销毁 effect', effectDisposers.length === before + 1, effectDisposers.length - before);
  check('清理用例：观察器已开始观察', observed >= 1, observed);

  const dispose = effectDisposers[effectDisposers.length - 1];
  let threw = null;
  try { dispose(); } catch (e) { threw = e; }
  check('清理用例：销毁不抛异常', threw === null, threw && String(threw));
  check('清理用例：观察器已断开', disconnected >= 1, disconnected);
  check('清理用例：定时器已清除（timeout + interval）',
    clearedTimeouts.length >= 1 && clearedIntervals.length >= 1,
    { clearedTimeouts: clearedTimeouts.length, clearedIntervals: clearedIntervals.length });

  let second = null;
  try { dispose(); } catch (e) { second = e; }
  check('清理用例：重复销毁安全（幂等）', second === null, second && String(second));

  globalThis.clearTimeout = realClearTimeout;
  globalThis.clearInterval = realClearInterval;
  if (hadDocument) globalThis.document = realDocument;
  else delete globalThis.document;
  if (RealMO === undefined) delete globalThis.MutationObserver;
  else globalThis.MutationObserver = RealMO;
}

// ── better-sidebar 可选集成 ──
// 它只在 client half 提供 ctx.betterSidebar；没装时必须照常工作（不写进 inject，
// 否则插件在没装它的机器上整个不激活）。装了则必须把注册包进 ctx.effect，
// 否则 HMR 后残留注册、下次激活报 already registered。
{
  const realDocument = globalThis.document;
  const hadDocument = 'document' in globalThis;
  globalThis.document = { body: {}, querySelector: () => null };

  // 1) 没装：不抛、不注册
  {
    const offs = [];
    const bare = {
      slots: { inject: (n, cb) => { cb(); return () => {}; }, register: () => () => {} },
      layout: { selectPanel() {} },
      effect(setup) { const d = setup(); offs.push(d); return d; },
    };
    let threw = null;
    try { mod.apply(bare); } catch (e) { threw = e; }
    check('better-sidebar：未安装时 apply 不抛', threw === null, threw && String(threw));
  }

  // 2) 装了：注册一页，且注册动作被 ctx.effect 托管
  {
    const tabs = [];
    const offs = [];
    let effectCalls = 0;
    const withSidebar = {
      slots: { inject: (n, cb) => { cb(); return () => {}; }, register: () => () => {} },
      layout: { selectPanel() {} },
      effect(setup) { effectCalls += 1; const d = setup(); offs.push(d); return d; },
      betterSidebar: {
        registerTab(desc) { tabs.push(desc); return () => { const i = tabs.indexOf(desc); if (i >= 0) tabs.splice(i, 1); }; },
      },
    };
    mod.apply(withSidebar);
    check('better-sidebar：注册了一页', tabs.length === 1, tabs.length);
    const desc = tabs[0] || {};
    check('better-sidebar：id 与插件面板同名（去重/单实例）',
      desc.id === 'web-ai-discuss' && desc.single === true, { id: desc.id, single: desc.single });
    check('better-sidebar：标题取当前语言的面板名', desc.title() === 'DeepSeek 讨论', desc.title && desc.title());
    check('better-sidebar：有图标与渲染组件',
      typeof desc.icon === 'function' && typeof desc.component === 'function');
    check('better-sidebar：注册包在 ctx.effect 里（HMR 可撤销）', effectCalls >= 1, effectCalls);

    // 重名注册会抛 already registered：必须记进 diag，而不是静默失败。
    const dup = {
      slots: { inject: (n, cb) => { cb(); return () => {}; }, register: () => () => {} },
      layout: { selectPanel() {} },
      effect(setup) { const d = setup(); offs.push(d); return d; },
      betterSidebar: { registerTab() { throw new Error('[dsh-better-sidebar] tab type "web-ai-discuss" already registered'); } },
    };
    let dupThrew = null;
    try { mod.apply(dup); } catch (e) { dupThrew = e; }
    check('better-sidebar：重名注册不向外抛（插件照常激活）', dupThrew === null, dupThrew && String(dupThrew));

    // 卸载后注册必须被撤销，否则下次激活 already registered
    for (const off of offs) { try { if (typeof off === 'function') off(); } catch (e) { /* ignore */ } }
    check('better-sidebar：卸载后注册已撤销', tabs.length === 0, tabs.length);
  }

  if (hadDocument) globalThis.document = realDocument;
  else delete globalThis.document;
}

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exitCode = 1;
