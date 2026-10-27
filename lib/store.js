/**
 * 本地存储：讨论记录 + ego 结果文件的落盘位置。
 *
 * 布局（默认）：
 *   <DSH_HOME>/storages/dsh-web-ai-discuss/index.json        讨论索引
 *   <DSH_HOME>/storages/dsh-web-ai-discuss/<id>.json         单次讨论全文
 *   <DSH_HOME>/storages/dsh-web-ai-discuss/tmp/*.json        ego 子进程结果文件
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

/** 解析存储根目录。 */
export function resolveStoreDir(cfg) {
  if (cfg?.storeDir) return path.resolve(cfg.storeDir);
  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh');
  return path.join(home, 'storages', 'web-ai-discuss');
}

export async function ensureStore(cfg) {
  const dir = resolveStoreDir(cfg);
  const tmp = path.join(dir, 'tmp');
  await mkdir(tmp, { recursive: true });
  return { dir, tmp, indexPath: path.join(dir, 'index.json') };
}

/** 生成讨论 id：d-YYYYMMDD-HHmmss-xxxx */
export function newDiscussionId(now = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `d-${stamp}-${randomBytes(2).toString('hex')}`;
}

export function newTempResultPath(tmpDir, id) {
  return path.join(tmpDir, `${id}-${randomBytes(3).toString('hex')}.json`);
}

async function readJson(file, fallback) {
  try {
    const text = await readFile(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 1)}\n`, 'utf8');
}

export async function readIndex(cfg) {
  const { indexPath } = await ensureStore(cfg);
  const index = await readJson(indexPath, { discussions: [] });
  if (!index || !Array.isArray(index.discussions)) return { discussions: [] };
  return index;
}

export async function writeIndex(cfg, index) {
  const { indexPath } = await ensureStore(cfg);
  await writeJson(indexPath, index);
}

/**
 * 落一条讨论记录并更新索引。
 * @param {object} cfg
 * @param {{ id: string, title: string, prompt: string, answer: string, url?: string, ego?: object, guardrails?: object, createdAt: string, elapsedMs?: number }} record
 */
export async function saveDiscussion(cfg, record) {
  if (!isDiscussionId(record?.id)) {
    throw new Error('invalid_discussion_id');
  }
  const { dir } = await ensureStore(cfg);
  await writeJson(path.join(dir, `${record.id}.json`), record);
  const index = await readIndex(cfg);
  const entry = {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    answerChars: record.answer ? record.answer.length : 0,
    url: record.url ?? null,
    attachments: Array.isArray(record.attachments) ? record.attachments.length : 0,
  };
  index.discussions = [entry, ...index.discussions.filter((d) => d.id !== record.id)].slice(0, 200);
  await writeIndex(cfg, index);
  return entry;
}

/** 讨论 id 的合法形态：d-YYYYMMDD-HHmmss-xxxx（4 位十六进制）。 */
const DISCUSSION_ID = /^d-\d{8}-\d{6}-[0-9a-f]{4}$/;

/** id 是否是合法的讨论 id（挡住路径穿越与任意文件名）。 */
export function isDiscussionId(id) {
  return typeof id === 'string' && DISCUSSION_ID.test(id);
}

export async function getDiscussion(cfg, id) {
  if (!isDiscussionId(id)) return undefined; // 非法 id 一律不落到文件系统
  const { dir } = await ensureStore(cfg);
  const file = path.join(dir, `${id}.json`);
  // 双保险：解析后必须仍在 storeDir 内。
  const resolved = path.resolve(file);
  if (resolved !== path.join(path.resolve(dir), `${id}.json`)) return undefined;
  return readJson(resolved, undefined);
}

export async function listDiscussions(cfg, limit = 10) {
  const index = await readIndex(cfg);
  return index.discussions.slice(0, Math.max(1, limit));
}

/** 清理 tmp 目录里过期的 ego 结果文件（默认 1 小时前）。 */
export async function pruneTemp(cfg, maxAgeMs = 3600000) {
  const { tmp } = await ensureStore(cfg);
  let entries = [];
  try {
    entries = await readdir(tmp);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of entries) {
    const file = path.join(tmp, name);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.mtimeMs > cutoff) continue;
      await rm(file, { force: true });
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return removed;
}
