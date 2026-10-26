/**
 * 离线自检脚本（不经过 dsh、不装插件也能跑）。
 *
 *   node test/smoke.mjs status            只读：配置 + ego 定位 + 存储
 *   node test/smoke.mjs probe             只读：打开/检查 ego 空间
 *   node test/smoke.mjs read              只读：现读当前会话气泡
 *   node test/smoke.mjs discuss "问题"     写操作：真的发一条讨论（受护栏约束）
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
import { readFile } from 'node:fs/promises';

const cfg = resolveConfig({});
const guard = new Guard(cfg);

async function readEgo(resultFile, out) {
  try {
    return { via: 'file', value: JSON.parse(await readFile(resultFile, 'utf8')) };
  } catch {
    const sentinel = readSentinel(out);
    return sentinel ? { via: 'sentinel', value: sentinel } : { via: 'none', value: undefined };
  }
}

const [, , cmd = 'status', arg] = process.argv;

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
  } else if (cmd === 'discuss') {
    const prompt = composePrompt({ prompt: arg ?? '' });
    if (!prompt) {
      console.error('usage: node test/smoke.mjs discuss "问题"');
      process.exit(1);
    }
    script = buildDiscussScript({
      resultFile,
      spaceName: cfg.spaceName,
      url: cfg.url,
      prompt,
      newChat: process.env.NEW_CHAT === '1',
      pollMs: cfg.pollMs,
      stableSamples: cfg.stableSamples,
      sendTimeoutMs: cfg.sendTimeoutMs,
    });
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
  if (cmd === 'discuss' && value.code === 'ok' && value.answer) {
    value.answer = cleanAnswer(value.answer, cfg.maxAnswerChars);
    await saveDiscussion(cfg, {
      id,
      title: String(arg).slice(0, 48),
      prompt: composePrompt({ prompt: arg }),
      answer: value.answer,
      url: value.url ?? null,
      createdAt: new Date().toISOString(),
      elapsedMs: value.elapsedMs ?? null,
    });
    value.storedAs = id;
    value.stored = await getDiscussion(cfg, id);
    delete value.stored.prompt;
  }
  console.log(JSON.stringify({ ...value, via, exitCode: run.exitCode, wallMs: elapsedMs }, null, 1));
}
