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
      light: '严格评审下面这份内容，只指出最致命的问题，不要鼓励。\n\n{prompt}',
      normal: '严格评审下面这份内容，指出会致命的问题，不要鼓励、不要复述。\n按「致命问题 / 重要问题 / 只改一处改哪里」回答。\n\n{prompt}',
      strict: '以最挑剔的评审者审阅下面内容，专找会把它推翻的问题；不确定就标为存疑，不要泛泛而谈「总体不错」。\n按「致命问题 / 重要问题 / 可商榷但可接受 / 只改一处改哪里」回答。\n\n{prompt}',
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
      light: '把下面提到的方案按统一维度做横向对比，明确给出推荐项。\n\n{prompt}',
      normal: '把下面提到的方案按统一维度做横向对比，不要逐个描述。\n先给对比维度，再用表格逐维度比较，最后明确给出推荐项及其成立条件。\n\n{prompt}',
      strict: '把下面提到的方案按统一维度做横向对比，逐维度比较后必须明确给出推荐项，并指出它在什么条件下不成立。\n维度按重要性排序（3–6 个），用表格。\n\n{prompt}',
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
      light: '构造能推翻下面这个结论的具体例子。\n\n{prompt}',
      normal: '构造能推翻下面这个结论的具体例子，宁可给苛刻的边缘情况，也不要泛泛说「可能存在例外」。\n按「反例清单 / 最致命的一个 / 结论需要加什么限定条件」回答。\n\n{prompt}',
      strict: '专门构造能推翻下面结论的具体例子：每个反例写清输入条件、失败原因、违反了哪条前提。\n再指出最致命的反例，以及结论要加什么限定条件才站得住。\n\n{prompt}',
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
      light: '以最强反对意见挑战下面这个判断，不要先肯定再转折。\n\n{prompt}',
      normal: '扮演最强的反对者，论证下面这个判断是错的，不要先肯定再转折。\n按「最强反对论据 / 每条依赖什么假设 / 什么条件下才成立」回答；反对不了就直说并给出仍然成立的最弱版本。\n\n{prompt}',
      strict: '扮演最强反对者，尽力证明下面这个判断是错的；不要客气，也不要和解式收尾。\n按「最强反对论据（按杀伤力排序） / 每条依赖的假设 / 判断成立的条件 / 你能想到的最强反驳」回答。\n\n{prompt}',
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
      light: '把下面的方案砍到最小，保留真正决定成败的部分。\n\n{prompt}',
      normal: '把下面的方案简化，砍掉不必要的复杂度。\n按「哪些部分可以整个删掉 / 简化后的最小版本 / 简化会牺牲什么」回答。\n\n{prompt}',
      strict: '把下面的方案砍到最小可用版本：逐条说明哪些部分可以整个删掉（删了为什么不影响结果），给出具体到步骤或接口的最小版本，并明确说出简化牺牲了什么。\n\n{prompt}',
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
      light: '把下面的目标拆成可执行的实施步骤，标出最可能出问题的两步。\n\n{prompt}',
      normal: '把下面的目标拆成可执行的实施步骤，不要停在「设计一下 XX」。\n按「步骤清单（每步给产出物与完成判据）/ 依赖关系 / 最可能出问题的两三步与兜底」回答。\n\n{prompt}',
      strict: '把下面的目标拆成可直接动手的实施步骤，每步给出产出物与完成判据，标明依赖关系。\n再列出最可能失败的两三步、失败原因与兜底做法；推不动的步骤明确标出。\n\n{prompt}',
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
      light: '从下面描述的现象反推可能原因，按最可能且最容易验证排序。\n\n{prompt}',
      normal: '从下面描述的现象反推可能原因，按「最可能且最容易验证」排序。\n按「候选原因清单 / 每个原因的验证方法 / 排查顺序与最可能的根因」回答。\n\n{prompt}',
      strict: '从下面描述的现象反推可能原因：列出候选原因、可能性估计与判断依据，为每个原因给一条能区分它与其他候选的验证方法。\n最后给出排查顺序与最可能的根因，并指出哪些信息缺失导致无法收敛。\n\n{prompt}',
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
      light: '列出你不会第一时间想到、但确实可行的解法方向。\n\n{prompt}',
      normal: '列出你不会第一时间想到、但确实可行的解法方向，避免复述常规做法。\n按「方向清单（核心思路、代价、适用条件）/ 最值得试的一条及原因 / 这些方向共享的隐含前提」回答。\n\n{prompt}',
      strict: '专门列出常规做法之外、但确实可行的解法方向：每个写清核心思路、代价与适用条件。\n挑出最值得试的一条并说明理由，再点明这些方向共享的隐含前提——前提不成立则全都不成立。\n\n{prompt}',
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
