/**
 * 预设提示词库（preset prompts）。
 *
 * 定位：给 `web_ai_discuss` 一个**提问框架**，让网页版 DeepSeek 按固定结构回答。
 * 它只加框架、不改写你的 prompt —— 原始提问始终原样附在「待评审内容」之后。
 *
 * 约束：
 *   - 每条 template 必须含且只含一个 `{prompt}` 占位符；
 *   - prompt 始终必填（预设不是用来代替提问的）；
 *   - 预设集是插件常量，不落盘、不进设置项，避免无谓的体量与配置面。
 */

/** 预设条目：id / 中英标题 / 中英一句话说明 / 提问模板。 */
export const PRESETS = Object.freeze([
  {
    id: 'review',
    zh: '方案评审',
    en: 'Review',
    hintZh: '让对方挑出会让它失败的问题，而不是给鼓励',
    hintEn: 'Ask for failure-causing problems, not encouragement',
    template: [
      '请以严格评审者的身份审阅下面这份内容。目标是找出会让它失败的问题：不要鼓励、不要复述、不要泛泛而谈「总体不错」。',
      '',
      '待评审内容：',
      '{prompt}',
      '',
      '请按这个结构回答：',
      '1. 致命问题（会直接让它不成立）',
      '2. 重要问题（不改会明显更差）',
      '3. 可商榷但可以接受的地方',
      '4. 如果只能改一处，改哪里',
    ].join('\n'),
  },
  {
    id: 'compare',
    zh: '方案对比',
    en: 'Compare',
    hintZh: '按统一维度把几个方案摆在一起比',
    hintEn: 'Put the options on shared dimensions and compare',
    template: [
      '请把下面提到的方案按统一维度做横向对比，不要逐个描述。',
      '',
      '待对比内容：',
      '{prompt}',
      '',
      '请按这个结构回答：',
      '1. 先给出你采用的对比维度（3–6 个，按重要性排序）',
      '2. 用表格逐维度比较每个方案',
      '3. 明确给出推荐项，并说明它在什么条件下推荐、在什么条件下不推荐',
    ].join('\n'),
  },
  {
    id: 'counterexample',
    zh: '找反例',
    en: 'Counterexample',
    hintZh: '专门构造能推翻结论的例子',
    hintEn: 'Construct cases that would falsify the claim',
    template: [
      '请构造能推翻或动摇下面这个结论的具体例子。宁可给苛刻的边缘情况，也不要泛泛地说「可能存在例外」。',
      '',
      '待检验的结论：',
      '{prompt}',
      '',
      '请按这个结构回答：',
      '1. 反例清单：每个反例写清输入条件、为什么会失败、违反了结论的哪一条前提',
      '2. 哪个反例最致命',
      '3. 结论需要加上什么限定条件才站得住',
    ].join('\n'),
  },
  {
    id: 'oppose',
    zh: '唱反调',
    en: 'Devil’s advocate',
    hintZh: '以最强反对意见挑战你的判断',
    hintEn: 'Argue the strongest case against the position',
    template: [
      '请扮演最强的反对者，尽力论证下面这个判断是错的。不要客气，不要先肯定再转折；如果确实反对不了，就直说并给出仍然成立的最弱版本。',
      '',
      '待挑战的判断：',
      '{prompt}',
      '',
      '请按这个结构回答：',
      '1. 最强反对论据（3 条，按杀伤力排序）',
      '2. 每条论据依赖什么假设',
      '3. 这个判断在什么条件下才成立',
    ].join('\n'),
  },
  {
    id: 'simplify',
    zh: '做减法',
    en: 'Simplify',
    hintZh: '砍掉不必要的部分，给出最小可用版本',
    hintEn: 'Cut it down to the smallest version that still works',
    template: [
      '请把下面的方案简化：目标是砍掉不必要的复杂度，保留真正决定成败的部分。',
      '',
      '待简化内容：',
      '{prompt}',
      '',
      '请按这个结构回答：',
      '1. 哪些部分可以整个删掉（逐条说明删了为什么不影响结果）',
      '2. 简化后的最小版本（具体到步骤或接口）',
      '3. 简化会牺牲什么',
    ].join('\n'),
  },
  {
    id: 'plan',
    zh: '落地拆解',
    en: 'Plan',
    hintZh: '把目标拆成可执行步骤，标出风险点',
    hintEn: 'Break the goal into executable steps with risks marked',
    template: [
      '请把下面的目标拆成可执行的实施步骤。步骤要能被人直接动手做，不要停在「设计一下 XX」这种层面。',
      '',
      '目标与现状：',
      '{prompt}',
      '',
      '请按这个结构回答：',
      '1. 步骤清单（有序，每步给出产出物与完成判据）',
      '2. 每步的依赖关系',
      '3. 最可能出问题的两到三步，以及对应的兜底做法',
    ].join('\n'),
  },
  {
    id: 'diagnose',
    zh: '排障思路',
    en: 'Diagnose',
    hintZh: '从症状反推可能原因，按性价比排序',
    hintEn: 'Work back from symptoms to ranked likely causes',
    template: [
      '请从下面描述的现象反推可能原因，按「最可能且最容易验证」排序，并给出每种原因的验证方法。',
      '',
      '现象与已知信息：',
      '{prompt}',
      '',
      '请按这个结构回答：',
      '1. 候选原因清单（附可能性估计与判断依据）',
      '2. 每个原因的验证方法（一条命令或一步操作，能区分它与其他候选）',
      '3. 建议的排查顺序，以及最可能的根因',
    ].join('\n'),
  },
  {
    id: 'expand',
    zh: '拓展可能',
    en: 'Expand',
    hintZh: '列出你没被想到的解法方向',
    hintEn: 'Surface solution directions you have not considered',
    template: [
      '请针对下面这个问题列出你不会第一时间想到、但确实可行的解法方向。避免复述常规做法。',
      '',
      '待解决的问题：',
      '{prompt}',
      '',
      '请按这个结构回答：',
      '1. 方向清单（每个写清核心思路、代价、适用条件）',
      '2. 其中最值得试的一条，以及为什么',
      '3. 这些方向共享的隐含前提（如果前提不成立，全都不成立）',
    ].join('\n'),
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
 * 给客户端 / status 用的目录（带 template，便于面板一键复制）。
 * @returns {{ id: string, title: string, titleEn: string, hint: string, hintEn: string, template: string }[]}
 */
export function presetCatalog() {
  return PRESETS.map((p) => ({
    id: p.id,
    title: p.zh,
    titleEn: p.en,
    hint: p.hintZh,
    hintEn: p.hintEn,
    template: p.template,
  }));
}

/**
 * 把预设框架套到用户提问上。
 * @param {typeof PRESETS[number]} preset
 * @param {string} prompt 用户原始提问（必填）
 * @returns {string}
 */
export function applyPreset(preset, prompt) {
  const text = String(prompt ?? '');
  if (!preset) return text;
  return preset.template.replace('{prompt}', text);
}
