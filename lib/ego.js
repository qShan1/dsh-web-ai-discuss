/**
 * ego lite 桥接层。
 *
 * 核心原则：**零协议构造**。
 * 这里只做两件事：
 *   1. 找到本机 ego-browser 可执行文件；
 *   2. 把一段 ego 脚本通过 stdin 交给 `ego-browser nodejs` 子进程执行。
 *
 * 不实现 MCP、不求解 PoW、不拼 x-hif-*、不伪造 SSE。
 * 所有网页交互都发生在 ego 自己的浏览器引擎里（脚本内用 taskSpace/page/evaluate）。
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const RESULT_TAG = '__DSH_WAI_RESULT__';

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** ego 默认安装根（Windows / macOS / Linux 同一布局：~/.local/share/ego）。 */
function egoRoots() {
  const roots = [];
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'ego'));
  roots.push(path.join(homedir(), '.local', 'share', 'ego'));
  return roots;
}

/** 在 ego 安装根下找 active_version_dir/<latest>/ego-browser[.exe]。 */
function fromInstallRoots() {
  const exe = process.platform === 'win32' ? 'ego-browser.exe' : 'ego-browser';
  for (const root of egoRoots()) {
    const active = path.join(root, 'active_version_dir');
    if (!existsSync(active)) continue;
    const direct = path.join(active, exe);
    if (isFile(direct)) return { path: direct, source: 'install:active_version_dir' };
    let entries = [];
    try {
      entries = readdirSync(active, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch {
      entries = [];
    }
    for (const dir of entries) {
      const candidate = path.join(active, dir, exe);
      if (isFile(candidate)) return { path: candidate, source: `install:${dir}` };
    }
  }
  return undefined;
}

/** 在 PATH 里找 ego-browser。 */
function fromPath() {
  const names = process.platform === 'win32' ? ['ego-browser.exe', 'ego-browser.cmd'] : ['ego-browser'];
  const dirs = String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return { path: candidate, source: 'PATH' };
    }
  }
  return undefined;
}

/**
 * 解析 ego-browser 可执行文件路径。
 * 顺序：config.egoPath → 环境变量 EGO_BROWSER_PATH → 安装目录 → PATH。
 *
 * 显式给出了 egoPath / EGO_BROWSER_PATH 时**不再回落**：调用方指了路径就尊重它，
 * 指错即报 unavailable，避免"悄悄用了另一份 ego"这种难排查的行为。
 * @returns {{ ok: true, path: string, source: string } | { ok: false, reason: string, checked: string[] }}
 */
export function resolveEgoPath(cfg) {
  const checked = [];
  if (cfg?.egoPath) {
    checked.push(cfg.egoPath);
    if (isFile(cfg.egoPath)) return { ok: true, path: cfg.egoPath, source: 'config' };
    return { ok: false, reason: 'ego_browser_not_found', checked };
  }
  const envPath = process.env.EGO_BROWSER_PATH;
  if (envPath) {
    checked.push(envPath);
    if (isFile(envPath)) return { ok: true, path: envPath, source: 'env' };
    return { ok: false, reason: 'ego_browser_not_found', checked };
  }
  for (const root of egoRoots()) checked.push(path.join(root, 'active_version_dir', '*', 'ego-browser*'));
  const installed = fromInstallRoots();
  if (installed) return { ok: true, ...installed };
  const onPath = fromPath();
  if (onPath) return { ok: true, ...onPath };
  return { ok: false, reason: 'ego_browser_not_found', checked };
}

/**
 * 执行一段 ego 脚本。
 *
 * 注意：ego 脚本里的 console.log 会落在**子进程 stderr**，stdout 通常为空，
 * 所以这里合并两路输出，并同时支持「结果文件」与「哨兵行」两种回收方式。
 *
 * @param {string} egoPath ego-browser 可执行文件
 * @param {string} script ego 脚本源码（ESM）
 * @param {{ timeoutMs?: number, signal?: AbortSignal, cwd?: string }} [options]
 * @returns {Promise<{ ok: boolean, exitCode: number | null, stdout: string, stderr: string, output: string, timedOut: boolean, aborted: boolean, error?: string }>}
 */
export function runEgoScript(egoPath, script, options = {}) {
  const timeoutMs = Math.max(5000, Number(options.timeoutMs) || 240000);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const child = spawn(egoPath, ['nodejs'], {
      cwd: options.cwd && existsSync(options.cwd) ? options.cwd : process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = (exitCode, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener?.('abort', onAbort);
      resolve({
        ok: exitCode === 0 && !timedOut && !aborted,
        exitCode,
        stdout,
        stderr,
        output: `${stdout}\n${stderr}`,
        timedOut,
        aborted,
        ...(error ? { error } : {}),
      });
    };

    const kill = () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    timer.unref?.();

    const onAbort = () => {
      aborted = true;
      kill();
    };
    options.signal?.addEventListener?.('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(code));

    child.stdin.on('error', () => {
      /* EPIPE 由 close 处理 */
    });
    child.stdin.end(script, 'utf8');
  });
}

/**
 * 从合并输出里取最后一条哨兵 JSON。
 * @param {string} output
 * @returns {unknown}
 */
export function readSentinel(output) {
  const lines = String(output ?? '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    const at = line.indexOf(RESULT_TAG);
    if (at < 0) continue;
    const payload = line.slice(at + RESULT_TAG.length).trim();
    try {
      return JSON.parse(payload);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** 从 ego 版本目录名或 `ego-browser help` 输出里猜版本；失败返回 undefined。 */
export function guessEgoVersion(egoPath) {
  const dir = path.basename(path.dirname(egoPath));
  const m = /^\d+\.\d+\.\d+(\.\d+)?$/.test(dir) ? dir : undefined;
  return m;
}
