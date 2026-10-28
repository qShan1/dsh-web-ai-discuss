/**
 * 预设提示词库（preset prompts）。
 *
 * 定位：给 `web_ai_discuss` 一个**提问框架**，让网页版 DeepSeek 按固定结构回答。
 * 它只加框架、不改写你的 prompt —— 原始提问始终原样附在框架之后。
 *
 * 档位（level）：同一套框架有三档强度，用户按「这次要多狠」来调，而不是写一长串指令。
 *   light  轻   —— 一句话要求，只要结论，最省 token
 *   normal 标准 —— 固定回答结构，默认档
 *   strict 严   —— 强约束，专门挑毛病
 *
 * 约束：
 *   - 每条 template 必须含且只含一个 `{prompt}` 占位符；
 *   - prompt 始终必填（预设不是用来代替提问的）；
 *   - 预设集是插件常量，不落盘、不进设置项，避免无谓的体量与配置面。
 */

/**
 * 档位元信息。id 顺序即界面里的展示顺序。
 * @type {{ id: string, zh: string, en: string, hintZh: string, hintEn: string }[]}
 */
export const PRESET_LEVELS = Object.freeze([
  {
    id: 'light',
    zh: '轻',
    en: 'Light',
    hintZh: '一句话，只要结论，最省 token',
    hintEn: 'One line, conclusion only',
  },
  {
    id: 'normal',
    zh: '标准',
    en: 'Normal',
    hintZh: '固定回答结构，默认档',
    hintEn: 'Fixed answer structure',
  },
  {
    id: 'strict',
    zh: '严',
    en: 'Strict',
    hintZh: '强约束，专门挑毛病',
    hintEn: 'Strict, hunt for flaws',
  },
]);

/** 全部档位 id，顺序与 PRESET_LEVELS 一致。 */
export const PRESET_LEVEL_IDS = Object.freeze(PRESET_LEVELS.map((l) => l.id));

/** 默认档位。 */
export const DEFAULT_PRESET_LEVEL = 'normal';

/**
 * 预设条目：id / 中英标题 / 中英一句话说明 / 三档模板。
 * @type {{ id: string, zh: string, en: string, hintZh: string, hintEn: string, defaultLevel: string, templates: Record<string, string> }[]}
 */
export const PRESETS = Object.freeze([
  {
    id: 'review',
    zh: '方案评审',
    en: 'Review',
    hintZh: '让对方挑出会让它失败的问题',
    hintEn: 'Ask for failure-causing problems, not encouragement',
    defaultLevel: 'normal',
    templates: {
      light: '严审此策，惟指其最致命者。\n\n{prompt}',
      normal: '严审此策，勿褒勿述。\n列「致命 / 要紧 / 改一处足矣」。\n\n{prompt}',
      strict: '以最苛者观之，专索可覆其议者；存疑则标，禁作「大略不差」之语。\n列「致命 / 要紧 / 可议而可受 / 改一处足矣」。\n\n{prompt}',
    },
  },
  {
    id: 'compare',
    zh: '方案对比',
    en: 'Compare',
    hintZh: '按统一维度把几个方案摆在一起比',
    hintEn: 'Put the options on shared dimensions and compare',
    defaultLevel: 'normal',
    templates: {
      light: '以一端衡诸案，明指所取。\n\n{prompt}',
      normal: '以一端衡诸案，勿逐述。\n先列所衡之端，次以表较之，终指所取及所恃。\n\n{prompt}',
      strict: '以一端衡诸案，较毕必有所取，且言其何时不可行。\n端按轻重为序（三至六），以表陈之。\n\n{prompt}',
    },
  },
  {
    id: 'counterexample',
    zh: '找反例',
    en: 'Counterexample',
    hintZh: '专门构造能推翻结论的例子',
    hintEn: 'Construct cases that would falsify the claim',
    defaultLevel: 'normal',
    templates: {
      light: '举一实例以破此论。\n\n{prompt}',
      normal: '举实例以破此论，宁取苛且偏者，禁作「或有例外」之泛言。\n列「诸反例 / 其最甚者 / 须增何限」。\n\n{prompt}',
      strict: '专举实例以破此论：每例明其所入、所败、所违之何。\n次指最甚者，终言增何限乃立。\n\n{prompt}',
    },
  },
  {
    id: 'oppose',
    zh: '唱反调',
    en: 'Devil’s advocate',
    hintZh: '以最强反对意见挑战你的判断',
    hintEn: 'Argue the strongest case against the position',
    defaultLevel: 'normal',
    templates: {
      light: '以最强之异议难此断，勿先肯而后转。\n\n{prompt}',
      normal: '为最强之敌，证此断之非，勿先肯而后转。\n列「最强之据 / 各恃何设 / 何时乃立」；难之不得，则直告之，并出其犹立之最弱者。\n\n{prompt}',
      strict: '为最强之敌，力证此断之非；勿逊，勿作和解之收。\n列「最强之据（按杀伤为序） / 各恃之设 / 此断所立之条 / 更无可加之驳」。\n\n{prompt}',
    },
  },
  {
    id: 'simplify',
    zh: '做减法',
    en: 'Simplify',
    hintZh: '砍掉不必要的部分，给出最小可用版本',
    hintEn: 'Cut it down to the smallest version that still works',
    defaultLevel: 'normal',
    templates: {
      light: '削此策至简，惟存决成败者。\n\n{prompt}',
      normal: '削此策之繁。\n列「可尽删者 / 简后之最简者 / 所失者」。\n\n{prompt}',
      strict: '削此策至最简可行：逐条言何者可尽删（删之何故无害），出其至步骤或接口之最简者，且明告所失。\n\n{prompt}',
    },
  },
  {
    id: 'plan',
    zh: '落地拆解',
    en: 'Plan',
    hintZh: '把目标拆成可执行步骤，标出风险点',
    hintEn: 'Break the goal into executable steps with risks marked',
    defaultLevel: 'normal',
    templates: {
      light: '析此标为可行之步，标其最易败之二。\n\n{prompt}',
      normal: '析此标为可行之步，勿止于「谋之」。\n列「诸步（各具所成与所验） / 相待之序 / 最易败之二三步及备之」。\n\n{prompt}',
      strict: '析此标为可径行之步，各具所成与所验，并明其相待。\n次列最易败之二三步、其败之由与备之之策；不可行者，显标之。\n\n{prompt}',
    },
  },
  {
    id: 'diagnose',
    zh: '排障思路',
    en: 'Diagnose',
    hintZh: '从症状反推可能原因，按性价比排序',
    hintEn: 'Work back from symptoms to ranked likely causes',
    defaultLevel: 'normal',
    templates: {
      light: '即所见之象反推其因，按「最可能且最易验」为序。\n\n{prompt}',
      normal: '即所见之象反推其因，以「最可能且最易验」为序。\n列「诸可疑之因 / 各验之法 / 排查之序与最似之根」。\n\n{prompt}',
      strict: '即所见之象反推其因：列诸可疑之因、其似之度与所据，各予一验可以别于他因者。\n终定排查之序与最似之根，并指何者阙而不可定。\n\n{prompt}',
    },
  },
  {
    id: 'expand',
    zh: '拓展可能',
    en: 'Expand',
    hintZh: '列出你没被想到的解法方向',
    hintEn: 'Surface solution directions you have not considered',
    defaultLevel: 'normal',
    templates: {
      light: '举非常见而实可行之途。\n\n{prompt}',
      normal: '举非常见而实可行之途，勿述故常。\n列「诸途（要旨、所费、所宜） / 最可试者及故 / 诸途共恃之隐」。\n\n{prompt}',
      strict: '专举故常之外而实可行之途：各明其要旨、所费、所宜。\n择最可试者一条并陈其故，终指诸途共恃之隐——隐不立，则尽不立。\n\n{prompt}',
    },
  },
]);

/** 全部预设 id，顺序与 PRESETS 一致。 */
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
