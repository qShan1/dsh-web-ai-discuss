/**
 * dsh-web-ai-discuss — 宿主侧入口。
 *
 * 定位：把「已登录的网页版 DeepSeek」当成**外部讨论来源**接到 Agent 工作流里。
 * 网页交互全部交给本机 ego lite（`ego-browser nodejs`）完成，不做任何协议构造。
 *
 * 自定义入口（两处，按优先级）：
 *   1. GUI 侧边栏面板的「设置」表单 —— 写 <storeDir>/settings.json，保存即热生效；
 *   2. cordis.patch.yml 的 config 行 —— 静态默认值，settings.json 叠加其上。
 * 护栏字段可在合法区间内调整，但没有任何值能关掉护栏（FLOOR 钳制）。
 */

import { PLUGIN_NAME, resolveConfig } from './lib/config.js';
import { Guard } from './lib/guard.js';
import { registerTools } from './lib/tools.js';
import { readSettings, saveSettings, resetSettings, validateSettingsInput, EDITABLE_FIELDS } from './lib/settings.js';

export const name = PLUGIN_NAME;

/** 只声明必需服务，避免插件因可选服务缺失而不激活。 */
export const inject = ['tools'];

const GUIDANCE = [
  'web_ai_discuss 是可选的外部讨论通道：只有在需要多角度评审、方案对比、找反例或验证思路时才使用；',
  '日常问答、事实查询、代码补全等用你自己的能力直接完成。',
  '它受全局串行、随机最小间隔与频率上限三重护栏约束，code=busy / code=rate_limited 说明护栏生效，等一会再试或直接继续手头工作。',
  'code=unauthorized 表示网页端需要人接管，浏览器已交给用户；不要转述登录或引导登录，按结构化结果继续。',
].join('');

/** 设置 API 的响应辅助。 */
function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body_too_large'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    request.on('error', reject);
  });
}

/**
 * exact 路由绕开 webServer 的 fence 前缀，POST 需自备同源守卫：
 * 浏览器对跨源 POST 必带 Origin；Origin 与本机 host 不一致（或伪造的 foreign host）一律拒绝。
 * GET 只返回默认值与数值设置（无密钥），保持开放。
 */
function sameOrigin(request) {
  const origin = request.headers.origin;
  if (origin === undefined || origin === null) return true; // curl/同源表单 GET 风格请求不带 Origin
  try {
    const o = new URL(origin);
    return o.host === request.headers.host;
  } catch {
    return false;
  }
}

export function apply(ctx, config) {
  // 设置优先级：settings.json（GUI 可调）> patch config > 内置默认。
  const rawConfig = config || {};
  const settings = readSettings(rawConfig);
  const cfg = resolveConfig({ ...rawConfig, ...settings });
  const guard = new Guard(cfg);
  const logger = ctx.logger ?? console;

  // 运行中重配：保存设置后同步替换 cfg 字段（resolveConfig 已钳制，护栏关不掉）。
  // guard/tools 读的是同一 cfg 对象引用，就地合并字段即可生效。
  const hotApply = (next) => {
    Object.assign(cfg, next);
    return cfg;
  };

  try {
    if (cfg.systemPromptSection && ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
      let order = 120;
      try {
        const base = ctx.systemPrompt.getSectionOrder?.('TOOL_GOAL');
        if (typeof base === 'number' && Number.isFinite(base)) order = base + 1;
      } catch {
        /* 保留默认 order */
      }
      ctx.systemPrompt.section({ name: `tool:${PLUGIN_NAME}`, order, text: GUIDANCE });
    }
  } catch (error) {
    try {
      logger?.warn?.(`[${PLUGIN_NAME}] system prompt section skipped`, String(error?.message ?? error));
    } catch {
      /* ignore */
    }
  }

  try {
    registerTools({ ctx, cfg, guard, logger });
  } catch (error) {
    logger?.error?.(`[${PLUGIN_NAME}] failed to register tools`, error);
    throw error;
  }

  // ── 设置 API：webServer 可用时挂载（无 webServer 的 headless 环境自动跳过）──
  ctx.inject(['webServer'], (hostCtx) => {
    const host = hostCtx;
    const base = '/web-ai-discuss/api';
    const disposers = [];

    const routes = [
      {
        kind: 'exact',
        path: `${base}/settings`,
        handler: async (request, response) => {
          try {
            if (request.method === 'GET') {
              sendJson(response, 200, {
                editable: EDITABLE_FIELDS,
                floor: cfg.floor,
                settings: readSettings(cfg),
                effective: {
                  minGapMs: cfg.minGapMs, jitterMs: cfg.jitterMs, windowMs: cfg.windowMs,
                  windowLimit: cfg.windowLimit, pollMs: cfg.pollMs, stableSamples: cfg.stableSamples,
                  sendTimeoutMs: cfg.sendTimeoutMs, maxAnswerChars: cfg.maxAnswerChars,
                  systemPromptSection: cfg.systemPromptSection, webhookUrl: cfg.webhookUrl,
                  webhookTimeoutMs: cfg.webhookTimeoutMs, hooksFile: cfg.hooksFile,
                  defaultNewChat: cfg.defaultNewChat, followUpChars: cfg.followUpChars,
                  placement: cfg.placement, composerDock: cfg.composerDock,
                },
              });
              return;
            }
            if (request.method === 'POST') {
              if (!sameOrigin(request)) {
                sendJson(response, 403, { ok: false, error: 'cross_origin_refused' });
                return;
              }
              const input = await readJsonBody(request);
              // 整体重置：{"__reset": true} → 删 settings.json，恢复 patch 默认值
              if (input && input.__reset === true) {
                await resetSettings(cfg);
                hotApply(resolveConfig(rawConfig));
                sendJson(response, 200, { ok: true, reset: true, effective: { ...cfg } });
                return;
              }
              const valid = validateSettingsInput(input);
              if (!valid.ok) {
                sendJson(response, 400, { ok: false, error: valid.error, fields: valid.fields });
                return;
              }
              const saved = await saveSettings(cfg, rawConfig, valid.settings);
              hotApply(resolveConfig({ ...rawConfig, ...saved.merged }));
              sendJson(response, 200, { ok: true, settings: saved.merged, effective: saved.effective });
              return;
            }
            response.writeHead(405, { allow: 'GET, POST' });
            response.end();
          } catch (error) {
            sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
          }
        },
      },
    ];

    for (const route of routes) {
      try {
        disposers.push(host.webServer.register(route));
      } catch (error) {
        logger?.warn?.(`[${PLUGIN_NAME}] route ${route.path} not mounted`, String(error?.message ?? error));
      }
    }
    return () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* ignore */
        }
      }
    };
  });
}
