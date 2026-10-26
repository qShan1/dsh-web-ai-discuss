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
// useState 槽位跨渲染持久（按 hook 调用顺序），setter 支持值/函数两种更新；
// 这样 flush 一个 useEffect 里的异步 setState 后，再渲染能看到新状态。
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
    const set = (next) => {
      hookSlots[i] = typeof next === 'function' ? next(hookSlots[i]) : next;
    };
    return [hookSlots[i], set];
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
const resetHooks = () => { hookIndex = 0; };

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
const fakeCtx = {
  slots: {
    inject(name, factory) {
      check(`slots.inject 目标合法：${name}`, ['sidebar.panellist', 'main', 'tool.call.toolview'].includes(name), name);
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
};

mod.apply(fakeCtx);

check('注册三处 slot', registered.length === 3, registered.length);

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
const textOf = (node) => {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && typeof node.type === 'function') return textOf(node.type(node.props || {}));
  const kids = node.props ? node.props.children : undefined;
  return textOf(kids);
};

// 桩 fetch：记录调用
let fetchCalls = [];
globalThis.fetch = (url, init) => {
  fetchCalls.push({ url, init });
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      editable: ['minGapMs', 'windowLimit', 'defaultNewChat', 'webhookUrl', 'hooksFile'],
      floor: { minGapMs: 5000, jitterMs: 1000, windowMs: 600000, windowLimitMax: 20, pollMs: 500, stableSamples: 2 },
      settings: {},
      effective: { minGapMs: 7000, jitterMs: 3000, windowMs: 3600000, windowLimit: 6, pollMs: 900,
        stableSamples: 3, sendTimeoutMs: 180000, maxAnswerChars: 12000, systemPromptSection: true,
        webhookUrl: '', webhookTimeoutMs: 5000, hooksFile: '', defaultNewChat: true, followUpChars: 4000 },
    }),
  });
};
const flush = async () => {
  const pending = effects.splice(0);
  for (const fn of pending) fn();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

// ── 面板首屏（懒挂载语义）──
// 折叠块（用法与说明 / 自定义设置）初始关闭：不渲染其 body，SettingsForm 不挂载、零 fetch。
// hook 槽位约定（递归渲染下）：0=Panel copied，1=LazyFold(usage) open，2=LazyFold(settings) open。
const toggleFolds = [];
const walkCollectToggles = (node) => {
  if (!node || typeof node !== 'object' || node === false) return;
  if (Array.isArray(node)) { node.forEach(walkCollectToggles); return; }
  if (typeof node.type === 'function') { walkCollectToggles(node.type(node.props || {})); return; }
  if (node.props && typeof node.props.onToggle === 'function') toggleFolds.push(node.props.onToggle);
  if (node.props) walkCollectToggles(node.props.children);
};

resetHooks();
effects.length = 0;
const panelTree = mainSlot.component({});
const panelText = textOf(panelTree);
check('面板：含定位说明', panelText.includes('外部讨论通道'), panelText.slice(0, 60));
check('面板：含构建戳 0.1.0', panelText.includes('build 0.1.0'), panelText.slice(0, 140));
check('面板：含两个折叠标题', panelText.includes('用法与说明') && panelText.includes('自定义设置'), panelText.slice(0, 400));
check('面板：折叠关闭时不渲染护栏/返回码明细',
  !panelText.includes('rate_limited') && fetchCalls.length === 0, { fetches: fetchCalls.length });

// 走一遍收集 LazyFold 的 onToggle（usage 在前、settings 在后）
resetHooks();
walkCollectToggles(mainSlot.component({}));
check('LazyFold 暴露 onToggle（usage + settings）', toggleFolds.length === 2, toggleFolds.length);
for (const t of toggleFolds) t({ currentTarget: { open: true } });

// 展开后：护栏/返回码/限制明细出现；SettingsForm 挂载并 GET
resetHooks();
effects.length = 0;
const openedText1 = textOf(mainSlot.component({}));
check('展开：说明区渲染三重护栏与返回码',
  openedText1.includes('三重护栏') && openedText1.includes('rate_limited') && openedText1.includes('ego-browser'),
  openedText1.slice(openedText1.indexOf('三重护栏'), openedText1.indexOf('三重护栏') + 80));
await flush(); // SettingsForm 的 load effect → fetch → setState
resetHooks();
const panelText2 = textOf(mainSlot.component({}));
check('设置区：展开后 GET 打到正确路由',
  fetchCalls.length >= 1 && fetchCalls[0].url === '/web-ai-discuss/api/settings', fetchCalls.map((f) => f.url));
check('设置区：渲染分组标题（护栏/发送与判定/输出与扩展）',
  panelText2.includes('发送与判定') && panelText2.includes('输出与扩展'),
  panelText2.slice(panelText2.indexOf('自定义设置'), panelText2.indexOf('自定义设置') + 220));
check('设置区：渲染字段与下限', panelText2.includes('窗口上限') && panelText2.includes('最小间隔') && panelText2.includes('下限 5000'));
check('设置区：渲染保存/重新读取/恢复默认按钮', panelText2.includes('保存修改') && panelText2.includes('重新读取') && panelText2.includes('恢复默认'));

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
};
mod.apply(ctx2);
await new Promise((r) => setTimeout(r, 10)); // 等 fetch → uiReload → 重挂完成
check('位置=设置页：注册 settings.section', allRegs2.includes('settings.section'), allRegs2);
check('位置=设置页：不保留侧边栏格子与 main',
  !allRegs2.includes('sidebar.panellist') && !allRegs2.includes('main'), allRegs2);
check('位置=设置页：工具卡片仍注册', allRegs2.includes('tool.call.toolview'), allRegs2);
check('位置写入了 localStorage 缓存', (lsData[LS_KEY_TEST] || '').includes('settings'), lsData);

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exitCode = 1;
