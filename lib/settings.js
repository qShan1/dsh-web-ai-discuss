/**
 * 用户自定义设置的持久化（GUI 面板可编辑，也供工具读取默认值）。
 *
 * 存储：<storeDir>/settings.json，字段与 cordis.patch.yml 的 config 同名。
 * 优先级：settings.json（运行时可调）> patch config > 内置默认。
 *
 * 关键约束：写回前必须过 resolveConfig 的同一套钳制——护栏字段
 * 可以在合法区间内调整，但**没有任何值能把护栏关掉**。
 */

import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveConfig } from './config.js';
import { resolveStoreDir } from './store.js';

/** 允许 GUI 编辑的字段白名单（egoPath/storeDir/spaceName/url 等定位字段不暴露，改这些要走 patch 文件）。 */
export const EDITABLE_FIELDS = Object.freeze([
  'minGapMs', 'jitterMs', 'windowMs', 'windowLimit',
  'pollMs', 'stableSamples', 'sendTimeoutMs', 'maxAnswerChars',
  'systemPromptSection', 'webhookUrl', 'webhookTimeoutMs', 'hooksFile',
  'defaultNewChat', 'followUpChars', 'placement', 'composerDock',
]);

const NUMERIC_KEYS = new Set([
  'minGapMs', 'jitterMs', 'windowMs', 'windowLimit', 'pollMs',
  'stableSamples', 'sendTimeoutMs', 'maxAnswerChars', 'webhookTimeoutMs', 'followUpChars',
]);

const BOOL_KEYS = new Set(['systemPromptSection', 'defaultNewChat', 'composerDock']);

const ENUM_KEYS = {
  placement: ['sidebar', 'settings', 'both'],
};

function settingsPath(cfg) {
  return path.join(resolveStoreDir(cfg), 'settings.json');
}

/**
 * 同步读取设置（apply 启动路径与路由共用；文件小，同步 IO 可接受）。
 * @returns {object} 原始设置内容；不存在或损坏时返回 {}
 */
export function readSettings(cfg) {
  try {
    const text = readFileSync(settingsPath(cfg), 'utf8');
    const raw = JSON.parse(text);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch {
    /* 不存在或损坏 → 视为空 */
  }
  return {};
}

/**
 * 校验一次编辑请求。未知字段忽略，非法值返回字段名列表（不静默吞）。
 * @returns {{ ok: true, settings: object } | { ok: false, error: string, fields: string[] }}
 */
export function validateSettingsInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'body_must_be_object', fields: [] };
  }
  const out = {};
  const bad = [];
  for (const [key, value] of Object.entries(input)) {
    if (!EDITABLE_FIELDS.includes(key)) continue; // 白名单外字段忽略
    if (BOOL_KEYS.has(key)) {
      if (typeof value === 'boolean') out[key] = value;
      else bad.push(key);
      continue;
    }
    if (ENUM_KEYS[key]) {
      if (ENUM_KEYS[key].includes(value)) out[key] = value;
      else bad.push(key);
      continue;
    }
    if (key === 'webhookUrl' || key === 'hooksFile') {
      if (typeof value === 'string' && value.length <= 2000) out[key] = value.trim();
      else bad.push(key);
      continue;
    }
    if (NUMERIC_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[key] = Math.trunc(value);
      continue;
    }
    bad.push(key);
  }
  if (bad.length > 0) return { ok: false, error: 'invalid_field_values', fields: bad };
  return { ok: true, settings: out };
}

/**
 * 合并写入 settings.json，返回写入后的完整内容与钳制后的生效值。
 * @param {object} cfgLocator resolveConfig 产物（仅用于定位 storeDir）
 * @param {object} rawConfig cordis 行原始 config（合成钳制时的底）
 * @param {object} patch 已通过 validateSettingsInput 的字段
 */
export async function saveSettings(cfgLocator, rawConfig, patch) {
  const dir = resolveStoreDir(cfgLocator);
  await mkdir(dir, { recursive: true });
  const current = readSettings(cfgLocator);
  const merged = { ...current, ...patch };
  await writeFile(settingsPath(cfgLocator), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return { merged, effective: resolveConfig({ ...(rawConfig || {}), ...merged }) };
}

/** 删除 settings.json，恢复 patch 默认值。文件不存在视为成功。 */
export async function resetSettings(cfgLocator) {
  try {
    await unlink(settingsPath(cfgLocator));
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }
}
