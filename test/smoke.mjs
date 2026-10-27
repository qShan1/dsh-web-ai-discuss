/**
 * 离线自检脚本（不经过 dsh、不装插件也能跑）。
 *
 *   node test/smoke.mjs status            只读：配置 + ego 定位 + 存储
 *   node test/smoke.mjs probe             只读：打开/检查 ego 空间
 *   node test/smoke.mjs read              只读：现读当前会话气泡
 *   node test/smoke.mjs discuss "问题"     写操作：真的发一条讨论（受护栏约束）
 *   node test/smoke.mjs attach "问题" /abs/file.md   写操作：带附件的讨论
 *   node test/smoke.mjs preset <id> "问题"   写操作：套预设提示词框架的讨论
 *   node test/smoke.mjs guard             护栏：并发 busy + 频率上限
 *
 * 该脚本直接调用插件内部模块，等价于工具 execute 的主干路径。
 */

import { resolveConfig } from '../lib/config.js';
import { Guard } from '../lib/guard.js';
import { readSentinel, resolveEgoPath, runEgoScript } from '../lib/ego.js';
import { buildDiscussScript, buildProbeScript, buildReadScript } from '../lib/script.js';
import {
  ensureStore,
  getDiscussion,
  listDiscussions,
  newDiscussionId,
  newTempResultPath,
  saveDiscussion,
} from '../lib/store.js';
import { cleanAnswer, composePrompt } from '../lib/tools.js';
import { applyPreset, findPreset, PRESET_IDS } from '../lib/presets.js';
import { readFile } from 'node:fs/promises';

const cfg = resolveConfig({});
const guard = new Guard(cfg);
/** preset 子命令下实际使用的预设 id（落盘时记进记录）。 */
let value_preset = null;

async function readEgo(resultFile, out) {
  try {
    return { via: 'file', value: JSON.parse(await readFile(resultFile, 'utf8')) };
  } catch {
    const sentinel = readSentinel(out);
    return sentinel ? { via: 'sentinel', value: sentinel } : { via: 'none', value: undefined };
  }
}

const [, , cmd = 'status', arg, arg2] = process.argv;

if (cmd === 'status') {
  const ego = resolveEgoPath(cfg);
  const store = await ensureStore(cfg);
  console.log(JSON.stringify({ cfg, ego, store: store.dir, recent: await listDiscussions(cfg, 5) }, null, 1));
} else if (cmd === 'guard') {
  const first = await guard.acquire();
  const second = await guard.acquire();
  guard.release();
  const third = await guard.acquire();
  guard.release();
  console.log(JSON.stringify({ first, second, third, snapshot: guard.snapshot() }, null, 1));
} else {
  const ego = resolveEgoPath(cfg);
  if (!ego.ok) {
    console.error(JSON.stringify(ego, null, 1));
    process.exit(1);
  }
  const store = await ensureStore(cfg);
  const id = newDiscussionId();
  const resultFile = newTempResultPath(store.tmp, id);
  const started = Date.now();
  let script;
  if (cmd === 'probe') {
    script = buildProbeScript({ resultFile, spaceName: cfg.spaceName, url: cfg.url, navigate: false });
  } else if (cmd === 'read') {
    script = buildReadScript({ resultFile, spaceName: cfg.spaceName, url: cfg.url, limit: 3 });
  } else if (cmd === 'discuss' || cmd === 'attach' || cmd === 'preset') {
    // preset 的参数顺序是 <presetId> "<问题>"，与 discuss 的 "<问题>" 不同。
    const presetId = cmd === 'preset' ? arg : null;
    const rawPrompt = cmd === 'preset' ? (arg2 ?? '') : (arg ?? '');
    const preset = presetId ? findPreset(presetId) : null;
    if (presetId && !preset) {
      console.error(JSON.stringify({ ok: false, reason: 'unknown_preset', available: PRESET_IDS }));
      process.exit(1);
    }
    // composePrompt 只负责拼 prompt + context；预设框架由 applyPreset 单独套上，
    // 与工具侧（lib/tools.js）保持同一路径。
    const prompt = applyPreset(preset, composePrompt({ prompt: rawPrompt }));
    if (!prompt) {
      console.error('usage: node test/smoke.mjs discuss "问题"');
      process.exit(1);
    }
    const attachments = cmd === 'attach' ? (arg2 ? [arg2] : []) : [];
    script = buildDiscussScript({
      resultFile,
      spaceName: cfg.spaceName,
      url: cfg.url,
      prompt,
      // 与工具默认值保持一致（cfg.defaultNewChat）；NEW_CHAT=0 可显式关掉。
      newChat: process.env.NEW_CHAT === '0' ? false : cfg.defaultNewChat !== false,
      pollMs: cfg.pollMs,
      stableSamples: cfg.stableSamples,
      sendTimeoutMs: cfg.sendTimeoutMs,
      attachments,
    });
    if (cmd === 'preset') { value_preset = preset.id; }
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
  }

  const run = await runEgoScript(ego.path, script, { timeoutMs: 300000 });
  const { via, value } = await readEgo(resultFile, run.output);
  const elapsedMs = Date.now() - started;
  if (!value) {
    console.log(JSON.stringify({
      ok: false,
      via,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      elapsedMs,
      stdoutTail: run.stdout.slice(-800),
      stderrTail: run.stderr.slice(-2000),
    }, null, 1));
    process.exit(1);
  }
  if ((cmd === 'discuss' || cmd === 'attach' || cmd === 'preset') && value.code === 'ok' && value.answer) {
    value.answer = cleanAnswer(value.answer, cfg.maxAnswerChars);
    await saveDiscussion(cfg, {
      id,
      title: String(cmd === 'preset' ? arg2 : arg).slice(0, 48),
      prompt: cmd === 'preset' ? (arg2 ?? '') : (arg ?? ''),
      preset: value_preset,
      answer: value.answer,
      url: value.url ?? null,
      createdAt: new Date().toISOString(),
      elapsedMs: value.elapsedMs ?? null,
      attachments: cmd === 'attach' && arg2 ? [arg2] : [],
    });
    value.storedAs = id;
    value.stored = await getDiscussion(cfg, id);
    delete value.stored.prompt;
  }
  console.log(JSON.stringify({ ...value, via, exitCode: run.exitCode, wallMs: elapsedMs }, null, 1));
}
