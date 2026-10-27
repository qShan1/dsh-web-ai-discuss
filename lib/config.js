/**
 * 配置解析与护栏下限钳制。
 *
 * 原则：护栏参数可以被调，但**不能被关掉**。所有数值上下限都写死在这里，
 * 配置里给 0 / false / null 一律回落到下限，不存在 enabled 开关。
 */

export const PLUGIN_NAME = 'dsh-web-ai-discuss';
export const TOOL_DISCUSS = 'web_ai_discuss';
export const TOOL_READ = 'web_ai_read_discussion';
export const TOOL_STATUS = 'web_ai_status';

/** 不可关闭的护栏下限。 */
const FLOOR = Object.freeze({
  /** 两次 discuss 之间的最小间隔，硬下限 5s。 */
  minGapMs: 5000,
  /** 最小间隔之上再叠加的随机抖动，硬下限 1s。 */
  jitterMs: 1000,
  /** 频率窗口，硬下限 10min。 */
  windowMs: 600000,
  /** 频率窗口内允许的 discuss 次数上限，硬上限 20。 */
  windowLimitMax: 20,
  /** 轮询间隔，硬下限 500ms。 */
  pollMs: 500,
  /** 连续稳定采样次数，硬下限 2。 */
  stableSamples: 2,
});

const num = (value, fallback) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const str = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback);

/** 界面入口位置枚举：仅侧边栏 / 仅设置页 / 两处都显示。 */
const PLACEMENTS = Object.freeze(['sidebar', 'settings', 'both']);

/**
 * 把原始 config 归一化成运行时配置。
 * @param {Record<string, unknown> | undefined} raw cordis patch 注入的 config
 */
export function resolveConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const minGapMs = Math.max(FLOOR.minGapMs, num(cfg.minGapMs, 7000));
  const jitterMs = Math.max(FLOOR.jitterMs, num(cfg.jitterMs, 3000));
  const windowMs = Math.max(FLOOR.windowMs, num(cfg.windowMs, 3600000));
  const windowLimit = Math.min(
    FLOOR.windowLimitMax,
    Math.max(1, Math.trunc(num(cfg.windowLimit, 6))),
  );
  const pollMs = Math.max(FLOOR.pollMs, num(cfg.pollMs, 900));
  const stableSamples = Math.max(FLOOR.stableSamples, Math.trunc(num(cfg.stableSamples, 3)));
  const sendTimeoutMs = Math.min(600000, Math.max(30000, num(cfg.sendTimeoutMs, 180000)));
  return {
    spaceName: str(cfg.spaceName, 'dsh-web-ai-discuss'),
    url: str(cfg.url, 'https://chat.deepseek.com/'),
    egoPath: str(cfg.egoPath, ''),
    storeDir: str(cfg.storeDir, ''),
    systemPromptSection: cfg.systemPromptSection !== false,
    maxAnswerChars: Math.min(40000, Math.max(2000, Math.trunc(num(cfg.maxAnswerChars, 12000)))),
    /** discuss 的 newChat 默认值（args 显式传入时以 args 为准）。 */
    defaultNewChat: cfg.defaultNewChat !== false,
    /** followUp 折进 context 的历史答案截断长度。 */
    followUpChars: Math.min(8000, Math.max(500, Math.trunc(num(cfg.followUpChars, 4000)))),
    minGapMs,
    jitterMs,
    windowMs,
    windowLimit,
    pollMs,
    stableSamples,
    sendTimeoutMs,
    // ── 自定义扩展位（自用） ──
    /** discuss 成功后 POST 一条 {event,payload,at} 的 JSON 到该 URL；空 = 关闭。 */
    webhookUrl: str(cfg.webhookUrl, ''),
    /** webhook 请求超时。 */
    webhookTimeoutMs: Math.min(15000, Math.max(1000, Math.trunc(num(cfg.webhookTimeoutMs, 5000)))),
    /** 用户自写 ESM 钩子模块的绝对路径，导出 onEvent(event, payload)；空 = 关闭。 */
    hooksFile: str(cfg.hooksFile, ''),
    /** 界面入口位置：仅侧边栏 / 仅设置页 / 两处都显示（改动在页面刷新后生效）。 */
    placement: PLACEMENTS.includes(cfg.placement) ? cfg.placement : 'sidebar',
    /** 主界面输入框下方是否放快捷入口（仅当侧边栏面板存在时有效）。 */
    composerDock: cfg.composerDock === true,
    floor: FLOOR,
  };
}
