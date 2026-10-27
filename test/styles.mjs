/**
 * 样式注入的回归测试（对应真实缺陷：宿主里样式停留在旧版本）。
 *
 * 真实事故（用户 m03258 报「宿主里界面没有样式」）：
 *   宿主里 <style id="dsh-web-ai-discuss-styles"> 是**常驻 DOM**，
 *   插件热重载 / 重新装载时只更新 JSX，旧 <style> 仍在文档里。
 *   原实现是「存在就跳过」，于是 CSS 被冻结在**首次安装时**的版本：
 *   实测宿主里挂着 0.1.0 时代的 CSS（8410 字符 / 63 条规则），
 *   而 JSX 已是 0.4.0（14296 字符 / 105 条规则）→ 「JS 是新版、样式还是旧版」。
 *
 * 这里用桩 DOM 复现该场景：预置一个**内容过期**的 <style>，
 * 断言 apply() 之后它被替换成当前 CSS，而不是被跳过。
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

// ── 桩 DOM ──────────────────────────────────────────────
const STYLE_ID = 'dsh-web-ai-discuss-styles';

/** 造一个最小 <style> 替身。 */
const makeStyle = (id, text) => ({
  id,
  textContent: text,
  dataset: {},
  parentNode: null,
  sheet: null,
  getAttribute(name) {
    if (name === 'data-plugin') return this.dataset.plugin ?? null;
    if (name === 'data-plugin-css') return this.dataset.pluginCss ?? null;
    return null;
  },
});

const head = {
  children: [],
  appendChild(node) {
    node.parentNode = head;
    head.children.push(node);
    return node;
  },
  contains(node) { return head.children.includes(node); },
};

const styles = new Map();
const documentStub = {
  head,
  body: { attributes: [], appendChild() {}, removeChild() {} },
  hidden: false,
  createElement(tag) {
    if (tag === 'style') return makeStyle('', '');
    return { tagName: String(tag).toUpperCase(), style: {}, dataset: {}, attributes: [] };
  },
  getElementById(id) { return styles.get(id) ?? null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  removeEventListener() {},
};

globalThis.document = documentStub;
globalThis.getComputedStyle = () => ({
  getPropertyValue: () => '',
  display: 'block',
});
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'zh-CN', clipboard: { writeText: async () => {} } },
  configurable: true,
  writable: true,
});
globalThis.window = {
  __ModuleLoader__: { load() {} },
};
globalThis.fetch = async () => ({ ok: false, json: async () => null });

// ── 场景：宿主里已经挂着一个**过期**的样式标签 ──────────
const STALE = '/* 0.1.0 时代的旧 CSS */\n.wai-sub{color:#999}\n.wai-chip-card{border:1px solid #ccc}';
const staleTag = makeStyle(STYLE_ID, STALE);
styles.set(STYLE_ID, staleTag);
head.children.push(staleTag);

const slotNames = [];
const fakeCtx = {
  slots: {
    inject(name, factory) {
      const reg = factory();
      for (const r of (reg && reg.__names) || []) slotNames.push(r);
      return () => {};
    },
    register(spec) {
      slotNames.push(spec.name);
      return () => {};
    },
  },
  layout: { selectPanel() {} },
};

// ── 加载真实 client.js 并 apply ─────────────────────────
let spec = null;
globalThis.window.__ModuleLoader__.load = (input) => { spec = input; };
await import(pathToFileURL(CLIENT).href);

check('模块外壳被加载', spec !== null);
const mod = spec.factory((name) => {
  if (name === 'react') {
    // 只需要最少的 hook 能力：apply() 本身不渲染组件。
    return {
      createElement: (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids } }),
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useRef: (v) => ({ current: v }),
      memo: (c) => c,
      Fragment: 'Fragment',
    };
  }
  throw new Error(`unexpected require(${name})`);
});

mod.apply(fakeCtx);

const tag = documentStub.getElementById(STYLE_ID);
check('样式标签仍在（没有被重复插入第二个）',
  head.children.filter((n) => n.id === STYLE_ID).length === 1,
  head.children.map((n) => n.id));

check('过期 CSS 已被替换：不再是旧内容', tag.textContent !== STALE);
check('替换后包含新版特征类 .wai-build', tag.textContent.includes('.wai-build'));
check('替换后不再包含已删除的旧类 .wai-sub', !tag.textContent.includes('.wai-sub'));
check('替换后不再包含已删除的旧类 .wai-chip-card', !tag.textContent.includes('.wai-chip-card'));
check('替换后 CSS 体量明显大于旧版（>10000 字符）', tag.textContent.length > 10000, tag.textContent.length);

// 归属标记：宿主按 data-plugin 清理样式，需要它
check('样式带 data-plugin 归属标记', tag.getAttribute('data-plugin') === 'dsh-web-ai-discuss',
  tag.getAttribute('data-plugin'));
check('样式带 data-plugin-css 标记', tag.getAttribute('data-plugin-css') === STYLE_ID,
  tag.getAttribute('data-plugin-css'));

// ── 场景二：内容已是最新时不应重复写入 ────────────────
const before = tag.textContent;
const writes = [];
const rawDesc = Object.getOwnPropertyDescriptor(tag, 'textContent');
Object.defineProperty(tag, 'textContent', {
  configurable: true,
  get() { return rawDesc.get ? rawDesc.get.call(tag) : before; },
  set(v) { writes.push(v); rawDesc.set ? rawDesc.set.call(tag, v) : (before = v); },
});
mod.apply(fakeCtx);
check('内容已是最新时不重复写入', writes.length === 0, writes.length);
Object.defineProperty(tag, 'textContent', { configurable: true, value: before, writable: true });

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exitCode = 1;
