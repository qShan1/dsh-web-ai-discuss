/**
 * dsh-web-ai-discuss — 客户端（浏览器侧）模块。v0.1.0（未发布开发版）
 *
 * 三块 UI：
 *   1. sidebar.panellist  侧边栏格子（图标）
 *   2. main               中央面板：紧凑布局，静态说明折叠，设置区展开才挂载/请求
 *   3. tool.call.toolview web_ai_discuss 的会话卡片（每会话首次挂载自动开面板一次）
 *
 * 性能约定（上一版卡顿的教训）：
 *   - 面板首屏零网络：设置表单只在 <details> 展开时挂载并 fetch 一次，结果缓存在模块级；
 *   - 输入框全部非受控（defaultValue），输入不触发任何 React 渲染；
 *   - 静态文案 React.memo，重渲染时子树引用不变直接跳过；
 *   - fetch 带 AbortController，卸载即中止，不留悬挂请求。
 *
 * 宿主与客户端之间没有通用数据通道，真实讨论结果在会话里的工具卡片上，
 * 面板只承载说明与设置编辑（经 /web-ai-discuss/api/settings）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-web-ai-discuss',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'web-ai-discuss';
    const TOOL_DISCUSS = 'web_ai_discuss';
    const TOOL_READ = 'web_ai_read_discussion';
    const TOOL_STATUS = 'web_ai_status';
    const SETTINGS_API = '/web-ai-discuss/api/settings';
    // 构建戳：面板头部显示。看到它 = 浏览器在跑这版代码；看不到 = client 模块没装载。
    const CLIENT_BUILD = '0.1.0';

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
        lead: '把已登录的网页版 DeepSeek 当作外部思路来源；网页操作全部经本机 ego lite 完成，不构造协议、不接管登录。',
        when: '只在需要多角度讨论 / 评审 / 方案对比 / 找反例时调用；日常问答、事实查询、代码补全不要走这里。',
        store: '讨论记录写入 DSH 存储目录下的 web-ai-discuss/，用 web_ai_read_discussion 读回（支持 id / search / live）。',
        usageTitle: '用法与说明',
        template: '用 web_ai_discuss 和 DeepSeek 讨论：',
        copy: '复制调用模板',
        copied: '已复制',
        settingsTitle: '自定义设置',
        settingsHint: '写入 settings.json，叠加在 patch 默认值之上，保存即生效。护栏字段可在合法区间内调，但关不掉；egoPath / storeDir / 空间名等定位字段只走 cordis.patch.yml。',
        settingsLoading: '读取设置…',
        settingsLoadFail: '读取设置失败（宿主路由未挂载？）：',
        settingsRetry: '重试',
        settingsSave: '保存修改',
        settingsSaving: '保存中…',
        settingsSaved: '已保存并生效',
        settingsFail: '保存失败：',
        settingsFloor: '下限',
        settingsReload: '重新读取',
        settingsRestore: '恢复默认',
        settingsDirty: '未保存的修改',
        groupUi: '显示位置',
        groupGuard: '护栏',
        groupJudge: '发送与判定',
        groupOutput: '输出与扩展',
        placementLabel: '入口位置',
        placementOpts: { sidebar: '侧边栏图标', settings: '设置页分区', both: '两处都显示' },
        dockLabel: '输入框下方快捷入口',
        placementNote: '保存后几秒内自动挪动（或刷新页面立即生效）；工具卡片不受位置设置影响，始终在会话流里显示结果。',
        guardTitle: '三重护栏（不可关闭）',
        guards: [
          ['全局串行', '同一时刻只允许一次讨论，并发调用立刻返回 code=busy'],
          ['随机最小间隔', '两次讨论之间至少 7s + 0–3s 随机抖动'],
          ['窗口频率上限', '每 60 分钟最多 6 次，超额返回 code=rate_limited'],
        ],
        codesTitle: '返回码',
        codes: [
          ['ok', '拿到回答，answer 为清洗后的原文'],
          ['unauthorized', '网页端需要人接管，浏览器已交给用户；不要在对话里转述登录'],
          ['busy / rate_limited', '已有讨论在跑 / 窗口配额用尽（带 retryAfterMs）'],
          ['unavailable', '本机找不到 ego-browser'],
          ['timeout', '等到超时仍没等到可判定完成的回答'],
          ['failed(send_failed)', '三次发送确认都未送达，快速失败不白等'],
        ],
        limitsTitle: '已知限制',
        limits: [
          '依赖本机 ego-browser CLI（无 MCP 形态），插件以子进程方式调用它',
          '讨论空间在 ego 里保持存活以便追问，插件刻意不调用 finish',
          '护栏作用域是插件进程；跨进程并发不在保护范围内',
          '网页改版会影响 DOM 选择器，届时需更新 lib/script.js',
        ],
      }
      : {
        panel: 'DeepSeek talk',
        title: 'External discussion channel',
        lead: 'Pipes the logged-in DeepSeek web app in as an outside opinion through the local ego lite engine: no protocol construction, no sign-in handling.',
        when: 'Call it only for multi-angle discussion, reviews, option comparisons, or counter-examples. Not for everyday questions, fact lookups, or code completion.',
        store: 'Records land in web-ai-discuss/ under the DSH storage directory; read them back with web_ai_read_discussion (id / search / live).',
        usageTitle: 'Usage & notes',
        template: 'Use web_ai_discuss to discuss with DeepSeek: ',
        copy: 'Copy call template',
        copied: 'Copied',
        settingsTitle: 'Settings',
        settingsHint: 'Saved to settings.json on top of patch defaults, applied live. Guardrail fields move within legal bounds but cannot be switched off; egoPath / storeDir / space name stay patch-file only.',
        settingsLoading: 'Loading settings...',
        settingsLoadFail: 'Failed to load settings (host route not mounted?): ',
        settingsRetry: 'Retry',
        settingsSave: 'Save changes',
        settingsSaving: 'Saving...',
        settingsSaved: 'Saved and applied',
        settingsFail: 'Save failed: ',
        settingsFloor: 'min',
        settingsReload: 'Reload',
        settingsRestore: 'Restore defaults',
        settingsDirty: 'unsaved changes',
        groupUi: 'Placement',
        groupGuard: 'Guardrails',
        groupJudge: 'Send & completion',
        groupOutput: 'Output & extensions',
        placementLabel: 'Entry placement',
        placementOpts: { sidebar: 'Sidebar icon', settings: 'Settings section', both: 'Both' },
        dockLabel: 'Composer chip',
        placementNote: 'Takes effect within seconds after saving (or refresh the page now); the tool card in the conversation flow always shows results regardless of placement.',
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
          ['busy / rate_limited', 'A discussion is running / window quota exhausted (retryAfterMs)'],
          ['unavailable', 'ego-browser not found on this machine'],
          ['timeout', 'No completable answer before the deadline'],
          ['failed(send_failed)', 'Three send confirmations failed; fast fail, no dead wait'],
        ],
        limitsTitle: 'Known limits',
        limits: [
          'Depends on the local ego-browser CLI (no MCP form); invoked as a child process',
          'The discussion space stays alive for follow-ups; the plugin never calls finish',
          'Guardrails are process-scoped; cross-process concurrency is out of scope',
          'Web redesigns can break the DOM selectors in lib/script.js',
        ],
      };

    // ── 样式（只用主题变量，带 fallback） ──
    const S = {
      root: {
        height: '100%',
        overflowY: 'auto',
        padding: '18px 22px 28px',
        font: 'inherit',
        color: 'var(--dsw-alias-text-primary, inherit)',
        lineHeight: 1.55,
      },
      h1: { fontSize: 15, fontWeight: 600, margin: 0 },
      sub: { fontSize: 11.5, color: 'var(--dsw-alias-text-secondary, #8a8a8a)', margin: '2px 0 12px' },
      p: { fontSize: 12.5, margin: '0 0 10px', opacity: 0.92 },
      note: {
        fontSize: 12,
        borderRadius: 8,
        padding: '8px 11px',
        border: '1px dashed var(--dsw-alias-border-primary, rgba(127,127,127,0.35))',
        opacity: 0.92,
        marginBottom: 12,
      },
      card: {
        border: '1px solid var(--dsw-alias-border-primary, rgba(127,127,127,0.25))',
        borderRadius: 8,
        padding: '9px 11px',
        margin: '0 0 8px',
        fontSize: 12.5,
      },
      k: { fontWeight: 600, marginBottom: 2 },
      d: { opacity: 0.82, fontSize: 12 },
      code: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11.5,
        padding: '1px 5px',
        borderRadius: 4,
        background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,0.14))',
      },
      li: { fontSize: 12.5, margin: '0 0 5px', paddingLeft: 14, position: 'relative' },
      bullet: { position: 'absolute', left: 0, opacity: 0.5 },
      button: {
        font: 'inherit',
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        color: 'var(--dsw-alias-text-primary, inherit)',
        background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,0.14))',
        border: '1px solid var(--dsw-alias-border-primary, rgba(127,127,127,0.3))',
      },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      fold: {
        border: '1px solid var(--dsw-alias-border-primary, rgba(127,127,127,0.25))',
        borderRadius: 8,
        padding: '0 12px',
        margin: '0 0 10px',
      },
      summary: {
        cursor: 'pointer',
        padding: '9px 0',
        fontSize: 12.5,
        fontWeight: 600,
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        userSelect: 'none',
      },
      caret: { fontSize: 10, opacity: 0.6, transition: 'transform .12s ease' },
      foldBody: { padding: '2px 0 12px' },
      groupLabel: { fontSize: 11, fontWeight: 600, opacity: 0.75, margin: '8px 0 4px', letterSpacing: '0.04em' },
      fieldRow: { display: 'grid', gridTemplateColumns: 'minmax(90px, 150px) minmax(90px, 120px) 80px', gap: 8, alignItems: 'center', marginBottom: 5, fontSize: 12 },
      input: {
        font: 'inherit',
        fontSize: 12,
        width: '100%',
        boxSizing: 'border-box',
        padding: '3px 7px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-primary, rgba(127,127,127,0.3))',
        background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,0.10))',
        color: 'inherit',
      },
      floorTag: { fontSize: 10.5, opacity: 0.55 },
    };

    const caretStyle = (open) => ({ ...S.caret, transform: open ? 'rotate(90deg)' : 'none' });

    /** 折叠块：纯 DOM 行为，React 不追踪 open 状态（除非需要懒挂载）。 */
    function Fold(props) {
      const { title, children, onToggle } = props;
      return h('details', { style: S.fold, onToggle },
        h('summary', { style: S.summary },
          h('span', { style: S.caret }, '▸'),
          title),
        h('div', { style: S.foldBody }, children));
    }

    /** 懒挂载折叠块：展开瞬间才渲染 children（设置区靠它做到首屏零请求）。 */
    function LazyFold(props) {
      const { title, children } = props;
      const [open, setOpen] = React.useState(false);
      return h('details', {
        style: S.fold,
        onToggle: (e) => setOpen(!!e.currentTarget.open),
      },
        h('summary', { style: S.summary },
          h('span', { style: caretStyle(open) }, '▸'),
          title),
        open ? h('div', { style: S.foldBody }, children) : null);
    }

    const StaticInfo = React.memo(function StaticInfo(props) {
      const copy = () => {
        try {
          Promise.resolve(navigator.clipboard.writeText(`${T.template}<你的问题>`)).then(() => {
            props.onCopied();
            setTimeout(props.onCopied, 1500);
          }).catch(() => {});
        } catch (e) { /* ignore */ }
      };
      return h('div', null,
        h('p', { style: S.p }, T.lead),
        h('div', { style: S.note }, T.when),
        h(LazyFold, { title: T.usageTitle },
          h('div', { style: S.row },
            h('button', { style: S.button, onClick: copy }, props.copied ? T.copied : T.copy)),
          h('div', { style: { ...S.d, marginTop: 8 } }, T.store),
          h('div', { style: S.groupLabel }, T.guardTitle),
          T.guards.map(([k, d]) => h('div', { style: S.card, key: k },
            h('div', { style: S.k }, k), h('div', { style: S.d }, d))),
          h('div', { style: S.groupLabel }, T.codesTitle),
          T.codes.map(([k, d]) => h('div', { style: S.card, key: k },
            h('code', { style: S.code }, k), ' ', h('span', { style: S.d }, d))),
          h('div', { style: S.groupLabel }, T.limitsTitle),
          T.limits.map((text, index) => h('div', { style: S.li, key: index },
            h('span', { style: S.bullet }, '·'), text))));
    });

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
      { key: 'webhookUrl', group: 'output', zh: 'Webhook URL', en: 'Webhook URL', kind: 'text', placeholder: 'https://…（空=关）' },
      { key: 'hooksFile', group: 'output', zh: '钩子模块', en: 'Hooks module', kind: 'text', placeholder: 'C:\\…\\hooks.mjs（空=关）' },
    ];

    // 模块级缓存：折叠再展开不重新 fetch；保存/重置后失效。
    let formCache = null; // { editable, floor, settings, effective }

    /**
     * 设置表单。挂载即 fetch（有缓存则秒开）；全部输入非受控；
     * 保存时收集相对 effective 有变化的字段 POST。
     */
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
            if (node.value.trim() !== (effective[f.key] ?? '')) out[f.key] = node.value.trim();
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
            // 位置类字段（placement/composerDock）变了：让 apply 重读并挪动入口
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
          })
          .catch((e) => setSaveState({ phase: 'error', message: String((e && e.message) || e) }));
      };

      if (phase === 'loading') return h('div', { style: S.d }, T.settingsLoading);
      if (phase === 'error') {
        return h('div', { style: S.note },
          T.settingsLoadFail + String(error),
          h('div', { style: { ...S.row, marginTop: 8 } },
            h('button', { style: S.button, onClick: () => load(true) }, T.settingsRetry)));
      }

      const groups = [['ui', T.groupUi], ['guard', T.groupGuard], ['judge', T.groupJudge], ['output', T.groupOutput]];
      const bindRef = (key) => (node) => { refs.current[key] = node; };
      return h('div', null,
        h('div', { style: S.d, marginBottom: 8 }, T.settingsHint),
        groups.map(([gk, label]) => {
          const fields = SETTINGS_FIELDS.filter((f) => f.group === gk);
          if (fields.length === 0) return null;
          return h('div', { key: gk },
            h('div', { style: S.groupLabel }, label),
            gk === 'ui' ? h('div', { style: { ...S.d, fontSize: 11, marginBottom: 6 } }, T.placementNote) : null,
            fields.map((f) => {
              const v = effective[f.key];
              if (f.kind === 'bool') {
                return h('div', { style: S.fieldRow, key: f.key },
                  h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                    h('input', { type: 'checkbox', defaultChecked: v === true, ref: bindRef(f.key) }),
                    h('span', null, isZh() ? f.zh : f.en)),
                  h('span', null), h('span', null));
              }
              if (f.kind === 'select') {
                return h('div', { style: S.fieldRow, key: f.key },
                  h('span', { style: { fontSize: 11.5, opacity: 0.9 } }, isZh() ? f.zh : f.en),
                  h('select', {
                    style: { ...S.input, gridColumn: 'span 2' },
                    defaultValue: v ?? 'sidebar',
                    ref: bindRef(f.key),
                  }, f.optKeys.map((opt) => h('option', { key: opt, value: opt },
                    (T.placementOpts && T.placementOpts[opt]) || opt))),
                  h('span', null));
              }
              const isText = f.kind === 'text';
              const floorHint = f.floorKey && floor[f.floorKey] !== undefined
                ? T.settingsFloor + ' ' + floor[f.floorKey] : '';
              return h('div', { style: S.fieldRow, key: f.key },
                h('span', { style: { fontSize: 11.5, opacity: 0.9 } }, isZh() ? f.zh : f.en),
                isText
                  ? h('input', {
                    type: 'text', style: { ...S.input, gridColumn: 'span 2' },
                    defaultValue: v ?? '', placeholder: f.placeholder || '',
                    ref: bindRef(f.key),
                  })
                  : h('input', {
                    type: 'number', style: S.input, min: 0, step: 1,
                    defaultValue: v ?? '',
                    ref: bindRef(f.key),
                  }),
                isText ? null : h('span', { style: S.floorTag }, floorHint || (f.unit || '')));
            }));
        }),
        // 文本字段第二行占满（上面 grid 已给 span 2 的变体）——webhook/hooks 用单独块渲染更稳
        h('div', { style: S.row, marginTop: 10 },
          h('button', {
            style: S.button,
            disabled: saveState.phase === 'saving',
            onClick: submit,
          }, saveState.phase === 'saving' ? T.settingsSaving : T.settingsSave),
          h('button', { style: S.button, onClick: () => load(true), disabled: saveState.phase === 'saving' }, T.settingsReload),
          h('button', { style: S.button, onClick: restore, disabled: saveState.phase === 'saving' }, T.settingsRestore)),
        saveState.phase === 'ok'
          ? h('div', { style: { ...S.d, color: 'var(--dsw-alias-state-success, #2f9e44)', marginTop: 6 } }, String(saveState.message))
          : null,
        saveState.phase === 'error'
          ? h('div', { style: { ...S.d, color: 'var(--dsw-alias-state-error, #d64545)', marginTop: 6, whiteSpace: 'pre-wrap' } }, T.settingsFail + String(saveState.message))
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

    const codeColor = (code) => {
      switch (code) {
        case 'ok': return 'var(--dsw-alias-state-success, #2f9e44)';
        case 'busy':
        case 'rate_limited': return 'var(--dsw-alias-state-warning, #e8930c)';
        case 'unauthorized':
        case 'unavailable':
        case 'timeout':
        case 'failed': return 'var(--dsw-alias-state-error, #d64545)';
        default: return 'var(--dsw-alias-text-secondary, #8a8a8a)';
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
      const direct = [block.value, block.result?.value, block.result, block.output?.value, block.output];
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

      React.useEffect(() => {
        const valueKey = value && typeof value.sessionKey === 'string' ? value.sessionKey : null;
        const key = valueKey
          || pickSessionKey(props && (props.sessionId || props.sessionKey))
          || 'default';
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

      const head = h('div', { style: S.row },
        h('div', { style: S.k }, 'DeepSeek 讨论'),
        code ? h('span', {
          style: { ...S.code, color: codeColor(code), border: '1px solid currentColor', padding: '0 5px' },
        }, code) : null,
        phase === 'preparing' || phase === 'start'
          ? h('span', { style: S.d }, '进行中…')
          : null);

      if (!answer) {
        const reason = (value && value.reason) || (block && block.error && block.error.code) || null;
        const message = (value && value.message) || (block && block.error && block.error.message) || null;
        const partial = value && value.partial ? String(value.partial) : null;
        return h('div', { style: S.card }, head,
          reason ? h('div', { style: S.d }, 'reason: ' + reason) : null,
          message ? h('div', { style: S.d }, String(message)) : null,
          partial ? h('div', { style: { ...S.d, whiteSpace: 'pre-wrap', marginTop: 6 } }, partial) : null);
      }
      return h('div', { style: S.card }, head,
        h('div', {
          style: { marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 12.5, maxHeight: 320, overflowY: 'auto' },
        }, String(answer)));
    });

    function Panel() {
      const [copied, setCopied] = React.useState(false);
      return h('div', { style: S.root },
        h('div', { style: S.h1 }, T.title),
        h('div', { style: S.sub }, `${TOOL_DISCUSS} · ${TOOL_READ} · ${TOOL_STATUS} · build ${CLIENT_BUILD}`),
        h(StaticInfo, { copied, onCopied: () => setCopied((c) => !c) }),
        h(LazyFold, { title: T.settingsTitle }, h(SettingsForm, {})));
    }

    // apply 闭包里需要 ctx（selectPanel），所以组件在 apply 内注册时注入
    let ctx = null;
    // apply 里赋值的"重读显示位置并可能重挂入口"回调；SettingsForm 保存成功后调用
    let uiReload = null;

    // ── 入口位置（placement / composerDock，可经设置表单修改）──
    // 注册决策不能阻塞 apply，所以：先用上次缓存（localStorage）挂载 → GET /settings
    // 回来后若位置变了，dispose 旧注入并按新位置重挂。settings:'sidebar'|'settings'|'both'。
    const LS_KEY = '***';
    function readCachedUi() {
      try {
        const raw = globalThis.localStorage?.getItem(LS_KEY);
        const v = raw ? JSON.parse(raw) : null;
        if (v && (v.placement === 'sidebar' || v.placement === 'settings' || v.placement === 'both')) {
          return { placement: v.placement, composerDock: v.composerDock === true };
        }
      } catch (e) { /* 回落默认 */ }
      return { placement: 'sidebar', composerDock: false };
    }
    function writeCachedUi(v) {
      try { globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(v)); } catch (e) { /* ignore */ }
    }

    /** 输入框下方的小快捷入口（composerDock=true 且侧边栏存在时）。 */
    function ComposerChip() {
      return h('button', {
        style: { ...S.button, fontSize: 11.5, padding: '3px 9px', opacity: 0.85 },
        title: T.panel,
        onClick: () => {
          try { ctx.layout.selectPanel(PANEL_ID); } catch (e) { /* ignore */ }
        },
      }, '◈ ' + T.panel);
    }

    function apply(pluginCtx) {
      ctx = pluginCtx;
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
          // 设置页分区：同一 Panel 组件（自含说明 + 懒挂载设置表单）
          disposers.push(pluginCtx.slots.inject('settings.section', () => pluginCtx.slots.register({
            name: 'settings.section',
            id: PANEL_ID,
            order: 55,
            label: () => T.panel,
          }, () => h('div', { style: { padding: '4px 2px 12px', maxWidth: 880 } }, h(Panel, {})))));
        }
      };
      mount();

      // 拉一次生效配置，若位置变了就重挂（无需刷新页面即可挪动入口）。
      // 不做轮询：SettingsForm 保存成功后通过 uiReload 回调即时通知这里。
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
      }
    }

    return {
      inject: ['slots', 'layout'],
      apply,
    };
  },
});
