/**
 * 预设提示词库（preset prompts）。
 *
 * 定位：给 `web_ai_discuss` 一个**提问框架**，让网页版 DeepSeek 按固定结构与深度回答。
 * 它只加框架、不改写你的 prompt —— 原始提问始终原样附在框架之后。
 *
 * ## 两件事正交，不要混在一处
 *
 * 1. **预设（8 条）** 决定「从哪个角度切入」：评审 / 对比 / 反例 / 唱反调 / 减法 / 落地 / 排障 / 拓展。
 * 2. **档位（3 档）** 决定「回答要多深、多长」，与角度无关：
 *      light  极简 —— 一到两句，只要结论
 *      normal 标准 —— 按结构给，每项一到两行
 *      strict 深度 —— 逐条展开，每条给依据、触发条件与代价
 *
 * 24 条模板因此不是手写的：由「3 段档位规格 × 8 条角度结构」组合生成（见 composeTemplate）。
 * 这样档位语义全局一致，风格只在一处控，改一次全档生效。
 *
 * ## 写作规则（来自各家提示词指南，抄下来免得后人改回去）
 *
 * - **只描述想要的输出，不罗列禁止项**。Anthropic 的 prompting 指南明确写
 *   "Tell Claude what to do instead of what not to do"：正向指令的命中率高于禁令。
 *   所以「直接从第一项开始写」优于「不要写开场白」。
 * - **提示词自身的风格会带偏输出风格**（"Match your prompt style to the output you
 *   want"）。这也是本文件早先那版写成文言文之后、回答也跟着文绉绉的原因——
 *   想要白话、紧凑的回答，框架本身就得是白话、紧凑的。
 * - **篇幅用可度量的说法**（「一到两句」「每项一到两行」），不用「简洁」这类空形容词。
 * - **给模型一个读者/用途**：这段回答会被 Agent 直接接进工作流，客套与复述没有消费方。
 *
 * ## 约束
 *
 * - 每条组合出来的 template 必须含且只含一个 `{prompt}` 占位符；
 * - prompt 始终必填（预设不是用来代替提问的）；
 * - 预设集是插件常量，不落盘、不进设置项，避免无谓的体量与配置面。
 */

/**
 * 档位元信息。id 顺序即界面里的展示顺序。
 *
 * 注意：`strict` 这个 id 是历史遗留（早期三档是「轻 / 标准 / 严」，按严厉度分），
 * 现在它表示「深度」。id 不改是为了不破坏已有的 `presetLevel: 'strict'` 调用与历史记录，
 * 界面上显示的是「深度」。
 *
 * @type {{ id: string, zh: string, en: string, hintZh: string, hintEn: string }[]}
 */
export const PRESET_LEVELS = Object.freeze([
  {
    id: 'light',
    zh: '极简',
    en: 'Brief',
    hintZh: '一到两句，只要结论',
    hintEn: 'One or two lines, conclusion only',
  },
  {
    id: 'normal',
    zh: '标准',
    en: 'Standard',
    hintZh: '按结构给，每项一到两行',
    hintEn: 'Follow the structure, one or two lines each',
  },
  {
    id: 'strict',
    zh: '深度',
    en: 'Deep',
    hintZh: '逐条展开，给依据与边界',
    hintEn: 'Expand each point with evidence and limits',
  },
]);

/** 全部档位 id，顺序与 PRESET_LEVELS 一致。 */
export const PRESET_LEVEL_IDS = Object.freeze(PRESET_LEVELS.map((l) => l.id));

/** 默认档位。 */
export const DEFAULT_PRESET_LEVEL = 'normal';

/**
 * 档位规格：只管深度与篇幅，不含任何角度信息。
 * 全部写成正向描述；结尾统一用「第一项开头、最后一项结尾」同时排除开场白与收尾总结。
 *
 * 极简档特意写明「从结构里挑最关键的一条」：否则结构里的「分档 / 逐项」会和
 * 「一到两句」直接打架，模型行为不可预期（早期版本实测会折中，给出既不全也不短的答案）。
 * @type {Record<string, string>}
 */
const LEVEL_SPEC = Object.freeze({
  light: '只给结论，一到两句：从下面的结构里挑最关键的一条直接说。',
  normal: '按下面的结构逐项回答，每项一到两行。第一项开头、最后一项结尾，中间不穿插铺垫。',
  strict:
    '深度分析：按下面的结构逐项展开，每条给出依据、触发条件与代价，拿不准的直接标注为不确定。'
    + '第一项开头、最后一项结尾，中间不穿插铺垫。',
});

/**
 * 把「档位规格」与「角度结构」拼成一条完整模板。
 * @param {string} level
 * @param {string} structure
 */
function composeTemplate(level, structure) {
  return `${LEVEL_SPEC[level]} ${structure}\n\n{prompt}`;
}

/**
 * 预设条目：id / 中英标题 / 中英一句话说明 / 角度结构 / 由结构派生出的三档模板。
 *
 * `structure` 只描述这个角度要看什么，不描述篇幅——篇幅归档位管。
 */
const PRESET_DEFS = Object.freeze([
  {
    id: 'review',
    zh: '方案评审',
    en: 'Review',
    hintZh: '挑出会让它失败的问题',
    hintEn: 'Surface the problems that would sink it',
    defaultLevel: 'normal',
    structure: '列出会让这件事失败的问题，按「致命 / 要紧 / 可商量」分档；最后给一条「只改一处改哪里」。',
  },
  {
    id: 'compare',
    zh: '方案对比',
    en: 'Compare',
    hintZh: '把几个方案摆在同一组维度上比',
    hintEn: 'Put the options on shared dimensions',
    defaultLevel: 'normal',
    structure: '把几个选项放在同一组维度上逐项对齐，最后指哪个更好、它在什么条件下更好。',
  },
  {
    id: 'counterexample',
    zh: '找反例',
    en: 'Counterexample',
    hintZh: '构造能推翻这个结论的例子',
    hintEn: 'Construct cases that would falsify the claim',
    defaultLevel: 'normal',
    structure: '构造能推翻这个结论的具体反例，挑最要命的那个说清它为何成立；最后指出结论还要补什么限定。',
  },
  {
    id: 'oppose',
    zh: '唱反调',
    en: "Devil's advocate",
    hintZh: '用最强的反对意见挑战这个判断',
    hintEn: 'Argue the strongest case against it',
    defaultLevel: 'normal',
    structure: '站在最强的反对立场，论证这个判断错在哪；指出对方的论证依赖哪些假设；最后说明什么情况下你会改变看法。',
  },
  {
    id: 'simplify',
    zh: '做减法',
    en: 'Simplify',
    hintZh: '砍到最小可用版本',
    hintEn: 'Cut it to the smallest version that works',
    defaultLevel: 'normal',
    structure: '指出哪些部分可以整段删掉、删了为什么不出问题；给出最小可用版本；说明因此失去什么。',
  },
  {
    id: 'plan',
    zh: '落地拆解',
    en: 'Plan',
    hintZh: '拆成可执行步骤，标出易崩点',
    hintEn: 'Break it into steps and flag the fragile ones',
    defaultLevel: 'normal',
    structure: '拆成有序步骤，每步给完成判据；标出最容易崩的两三步，以及各自的兜底做法。',
  },
  {
    id: 'diagnose',
    zh: '排障思路',
    en: 'Diagnose',
    hintZh: '从症状反推原因，按性价比排序',
    hintEn: 'Work back from symptoms to ranked causes',
    defaultLevel: 'normal',
    structure: '从症状反推可能的原因，每个原因给一条能把它与别的区分开的验证方法；最后给排查顺序与最可能的根因。',
  },
  {
    id: 'expand',
    zh: '拓展可能',
    en: 'Expand',
    hintZh: '给没被想到的解法方向',
    hintEn: 'Surface directions you have not considered',
    defaultLevel: 'normal',
    structure: '给非常规但可行的方向，每个说清要旨 / 代价 / 适用场景；最后指最值得先试的一条及理由。',
  },
]);

/**
 * 对外导出的预设表：在定义之外附上派生出来的 `templates`（3 档各一条完整模板）。
 * 消费者仍按 `preset.templates[levelId]` 取用，不需要知道组合逻辑。
 */
export const PRESETS = Object.freeze(PRESET_DEFS.map((def) => Object.freeze({
  ...def,
  templates: Object.freeze(Object.fromEntries(
    PRESET_LEVEL_IDS.map((level) => [level, composeTemplate(level, def.structure)]),
  )),
})));

export const PRESET_IDS = Object.freeze(PRESETS.map((p) => p.id));

/**
 * 按 id 查预设。接受大小写与首尾空白；查不到返回 null。
 * @param {unknown} id
 * @returns {typeof PRESETS[number] | null}
 */
export function findPreset(id) {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return null;
  return PRESETS.find((p) => p.id === key) ?? null;
}

/**
 * 按 id 查档位。查不到返回 null。
 * @param {unknown} id
 * @returns {typeof PRESET_LEVELS[number] | null}
 */
export function findLevel(id) {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return null;
  return PRESET_LEVELS.find((l) => l.id === key) ?? null;
}

/**
 * 解析预设引用。支持两种写法：
 *   - 纯 id：`review`（用预设的默认档位）
 *   - id + 档位：`review:strict`（冒号后是档位 id）
 *
 * @param {unknown} spec
 * @param {string} [levelOverride] 显式档位（优先于 spec 里的档位）
 * @returns {{ ok: true, preset: typeof PRESETS[number], level: string, template: string }
 *          | { ok: false, error: 'unknown_preset' | 'unknown_preset_level', ... }}
 */
export function resolvePreset(spec, levelOverride) {
  const raw = String(spec ?? '').trim();
  if (!raw) return { ok: false, error: 'empty_preset' };
  const colon = raw.indexOf(':');
  const idPart = colon >= 0 ? raw.slice(0, colon) : raw;
  const levelPart = colon >= 0 ? raw.slice(colon + 1) : '';

  const preset = findPreset(idPart);
  if (!preset) return { ok: false, error: 'unknown_preset', preset: idPart };

  let levelId = levelPart ? levelPart.trim().toLowerCase() : '';
  const override = levelOverride === undefined || levelOverride === null || levelOverride === ''
    ? ''
    : String(levelOverride).trim().toLowerCase();
  if (override) {
    if (levelId && levelId !== override) {
      return { ok: false, error: 'preset_level_conflict', preset: preset.id, level: levelId, levelOverride: override };
    }
    levelId = override;
  }
  if (!levelId) levelId = preset.defaultLevel || DEFAULT_PRESET_LEVEL;
  if (!findLevel(levelId)) {
    return { ok: false, error: 'unknown_preset_level', preset: preset.id, level: levelId, available: PRESET_LEVEL_IDS.slice() };
  }

  const template = preset.templates[levelId];
  if (!template) {
    return { ok: false, error: 'unknown_preset_level', preset: preset.id, level: levelId, available: PRESET_LEVEL_IDS.slice() };
  }
  return { ok: true, preset, level: levelId, template };
}

/**
 * 给客户端 / status 用的目录（每条带三档模板，便于面板切档位与一键复制）。
 * @returns {{ id: string, title: string, titleEn: string, hint: string, hintEn: string,
 *            defaultLevel: string, levels: { id: string, title: string, titleEn: string, hint: string, hintEn: string, template: string }[] }[]}
 */
export function presetCatalog() {
  return PRESETS.map((p) => ({
    id: p.id,
    title: p.zh,
    titleEn: p.en,
    hint: p.hintZh,
    hintEn: p.hintEn,
    defaultLevel: p.defaultLevel || DEFAULT_PRESET_LEVEL,
    levels: PRESET_LEVELS.map((l) => ({
      id: l.id,
      title: l.zh,
      titleEn: l.en,
      hint: l.hintZh,
      hintEn: l.hintEn,
      template: p.templates[l.id],
    })),
  }));
}

/**
 * 把预设框架套到用户提问上。
 * @param {typeof PRESETS[number] | null} preset
 * @param {string} prompt 用户原始提问（必填）
 * @param {string} [level='normal'] 档位 id
 * @returns {string}
 */
export function applyPreset(preset, prompt, level = DEFAULT_PRESET_LEVEL) {
  const text = String(prompt ?? '');
  if (!preset) return text;
  const key = findLevel(level) ? level : (preset.defaultLevel || DEFAULT_PRESET_LEVEL);
  const template = preset.templates[key] || preset.templates[DEFAULT_PRESET_LEVEL];
  if (!template) return text;
  // 用函数式替换：用户提问里可能含 $& / $1 等序列，字符串替换会被当成引用模式。
  return template.replace('{prompt}', () => text);
}
