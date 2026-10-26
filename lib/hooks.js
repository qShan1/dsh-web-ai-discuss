/**
 * 自定义扩展钩子（自用扩展位，不影响核心链路）。
 *
 * 两个出口：
 *   1. webhookUrl —— 每次 discuss 成功后向该 URL POST 一条 JSON（fire-and-forget，带超时，
 *      失败只记录在返回的 notify 字段里，绝不影响 discuss 的 code）。
 *   2. hooksFile —— 指向一个用户自写的 ESM 模块（绝对路径），模块导出
 *      `export async function onEvent(event, payload) { ... }`。
 *      每次事件都重新 import（带 cache-bust query），改完文件即生效、无需重启。
 *      支持的事件：'discuss.ok'（payload 与 discuss 返回值一致）。
 *
 * 任何钩子异常都被吞掉并记入 notify，主流程不受影响。
 */

import { pathToFileURL } from 'node:url';

const postJson = async (url, body, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
};

const runUserHook = async (hooksFile, event, payload) => {
  const mod = await import(`${pathToFileURL(hooksFile).href}?t=${Date.now()}`);
  if (typeof mod?.onEvent !== 'function') {
    return { ok: false, error: 'hooks_file_has_no_onEvent_export' };
  }
  await mod.onEvent(event, payload);
  return { ok: true };
};

/**
 * 事件分发入口。返回 notify 摘要（并入工具返回值）。
 * @param {object} cfg resolveConfig 产物
 * @param {string} event 事件名
 * @param {object} payload 事件载荷
 */
export async function emit(cfg, event, payload) {
  const notify = { event, webhook: null, hook: null };
  const tasks = [];

  if (cfg.webhookUrl) {
    tasks.push(
      postJson(cfg.webhookUrl, { event, payload, at: new Date().toISOString() }, cfg.webhookTimeoutMs)
        .then((r) => { notify.webhook = r; })
        .catch((e) => { notify.webhook = { ok: false, error: String(e?.message ?? e) }; }),
    );
  }
  if (cfg.hooksFile) {
    tasks.push(
      runUserHook(cfg.hooksFile, event, payload)
        .then((r) => { notify.hook = r; })
        .catch((e) => { notify.hook = { ok: false, error: String(e?.message ?? e) }; }),
    );
  }
  if (tasks.length > 0) await Promise.all(tasks);
  return notify;
}
