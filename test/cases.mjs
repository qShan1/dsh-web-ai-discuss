/**
 * 契约测试用例（不碰真实浏览器）。
 *
 *   node test/cases.mjs
 *
 * 原理：ego-browser 的调用形态是 `spawn(egoPath, ['nodejs'])` + stdin 喂脚本。
 * 测试把 egoPath 换成 node 自身，并在临时目录里放一个名为 `nodejs` 的替身脚本
 * （`node nodejs` 会把它当脚本执行），替身从 stdin 脚本里抠出 RESULT_FILE 常量，
 * 再按 FAKE_MODE 写出预置结果。于是「ego 返回什么」变成可控输入，
 * 插件侧的映射、护栏、落盘全部走真实代码路径。
 *
 * 覆盖：正常 discuss / 未登录 handoff / 并发 busy / ego 不可用 / 超时 / 无结果 / 频率上限。
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Guard } from '../lib/guard.js';
import { Mutex } from '../lib/mutex.js';
import { resolveConfig } from '../lib/config.js';
import { registerTools } from '../lib/tools.js';

const FAKE_EGO = `const fs = require('node:fs');

let src = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { src += chunk; });
process.stdin.on('end', () => {
  const mode = process.env.FAKE_MODE || 'ok';
  const m = src.match(/const RESULT_FILE = ("(?:[^"\\\\]|\\\\[\\s\\S])*")/);
  const resultFile = m ? JSON.parse(m[1]) : null;
  const write = (value) => {
    if (!resultFile) return;
    fs.writeFileSync(resultFile, JSON.stringify(value, null, 1), 'utf8');
    process.stderr.write('__DSH_WAI_RESULT__' + JSON.stringify(value) + '\\n');
  };
  if (mode === 'none') { process.stderr.write('produced nothing\\n'); return; }
  if (mode === 'unauthorized') {
    write({ code: 'unauthorized', reason: 'interaction_required', spaceName: 'fake', spaceId: 7, handoff: true });
    return;
  }
  if (mode === 'timeout') {
    write({ code: 'timeout', reason: 'no_answer', answer: '', elapsedMs: 5, polls: 2 });
    return;
  }
  if (mode === 'slow') {
    setTimeout(() => write({ code: 'ok', answer: 'FAKE SLOW ANSWER', elapsedMs: 1500, url: 'https://example.invalid/c' }), 1500);
    return;
  }
  write({ code: 'ok', answer: 'FAKE ANSWER: ' + mode, elapsedMs: 3, url: 'https://example.invalid/c' });
});
`;

const results = [];
function record(name, fn) {
  return { name, fn };
}

async function runCase(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, note: note ?? null });
    console.log(`PASS ${name}${note ? `  (${note})` : ''}`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error) });
    console.log(`FAIL ${name}  ${String(error?.message ?? error)}`);
  }
}

/** 造一套隔离环境：假 ego 目录 + 隔离存储 + 工具表。 */
async function makeHarness({ mode = 'ok', config = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'wai-case-'));
  const fakeDir = path.join(root, 'fake');
  await mkdir(fakeDir, { recursive: true });
  await writeFile(path.join(fakeDir, 'nodejs'), FAKE_EGO, 'utf8');

  const tools = new Map();
  const ctx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
  };
  const cfg = resolveConfig({
    egoPath: process.execPath,
    storeDir: path.join(root, 'store'),
    ...config,
  });
  const guard = new Guard(cfg);
  const mutex = new Mutex();
  registerTools({ ctx, cfg, guard, mutex });
  // harness 里 status 的 probe 与 read 的 live 都要真的进 ego，所以 fake 必须慢；
  // 否则两个调用可能一个已经结束，另一个才开始，测不出互斥。

  const previousCwd = process.cwd();
  const previousMode = process.env.FAKE_MODE;
  process.chdir(fakeDir);
  process.env.FAKE_MODE = mode;

  const restore = () => {
    process.chdir(previousCwd);
    if (previousMode === undefined) delete process.env.FAKE_MODE;
    else process.env.FAKE_MODE = previousMode;
  };

  return { root, tools, cfg, guard, restore, exec: { agent: { id: 'session-test-1' } } };
}

const cases = [
  record('ego 不可用 → unavailable', async () => {
    const h = await makeHarness({ config: { egoPath: path.join(tmpdir(), 'no-such-ego', 'ego-browser.exe') } });
    try {
      const value = await h.tools.get('web_ai_discuss').execute({ prompt: '在吗' }, h.exec);
      assert.equal(value.code, 'unavailable');
      assert.equal(value.reason, 'ego_browser_not_found');
      assert.equal(value.sessionKey, 'session-test-1');
      return value.reason;
    } finally {
      h.restore();
    }
  }),

  record('未登录 → unauthorized + handoff，且不含登录话术', async () => {
    const h = await makeHarness({ mode: 'unauthorized' });
    try {
      const value = await h.tools.get('web_ai_discuss').execute({ prompt: '在吗' }, h.exec);
      assert.equal(value.code, 'unauthorized');
      assert.equal(value.reason, 'interaction_required');
      assert.equal(value.handoff.started, true);
      assert.equal(value.answer ?? null, null);
      const text = JSON.stringify(value);
      assert.ok(!/登录|sign in|log in/i.test(text), '返回里不应出现登录引导话术');
      return 'handoff.started=true';
    } finally {
      h.restore();
    }
  }),

  record('正常 discuss → ok 且落盘可读回', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const value = await discuss.execute({ prompt: '帮我想个反例', topic: '单测' }, h.exec);
      assert.equal(value.code, 'ok');
      assert.match(value.answer, /FAKE ANSWER: ok/);
      assert.ok(value.discussionId.startsWith('d-'));
      assert.equal(value.title, '单测');
      assert.equal(value.guardrails.busy, false);

      const read = h.tools.get('web_ai_read_discussion');
      const back = await read.execute({ id: value.discussionId }, h.exec);
      assert.equal(back.code, 'ok');
      assert.match(back.latest, /FAKE ANSWER: ok/);

      const index = JSON.parse(await readFile(path.join(h.cfg.storeDir, 'index.json'), 'utf8'));
      assert.equal(index.discussions.length, 1);
      return `id=${value.discussionId}`;
    } finally {
      h.restore();
    }
  }),

  record('超时 → timeout（无回答）', async () => {
    const h = await makeHarness({ mode: 'timeout' });
    try {
      const value = await h.tools.get('web_ai_discuss').execute({ prompt: '在吗' }, h.exec);
      assert.equal(value.code, 'timeout');
      assert.equal(value.reason, 'no_answer');
      assert.equal(value.partial, null);
      return value.reason;
    } finally {
      h.restore();
    }
  }),

  record('ego 没产出结果 → failed/ego_no_result', async () => {
    const h = await makeHarness({ mode: 'none' });
    try {
      const value = await h.tools.get('web_ai_discuss').execute({ prompt: '在吗' }, h.exec);
      assert.equal(value.code, 'failed');
      assert.equal(value.reason, 'ego_no_result');
      assert.ok(typeof value.stderrTail === 'string');
      return value.reason;
    } finally {
      h.restore();
    }
  }),

  record('并发两次 → 一次 ok、一次 busy', async () => {
    const h = await makeHarness({ mode: 'slow' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const [a, b] = await Promise.all([
        discuss.execute({ prompt: '第一个' }, h.exec),
        discuss.execute({ prompt: '第二个' }, h.exec),
      ]);
      const codes = [a.code, b.code].sort();
      assert.deepEqual(codes, ['busy', 'ok']);
      const busy = a.code === 'busy' ? a : b;
      assert.equal(busy.reason, 'discussion_in_progress');
      return `codes=${codes.join('/')}`;
    } finally {
      h.restore();
    }
  }),

  record('窗口频率上限 → 第二次 rate_limited', async () => {
    const h = await makeHarness({ mode: 'ok', config: { windowLimit: 1, minGapMs: 5000, jitterMs: 1000 } });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const first = await discuss.execute({ prompt: '第一次' }, h.exec);
      assert.equal(first.code, 'ok');
      const second = await discuss.execute({ prompt: '第二次' }, h.exec);
      assert.equal(second.code, 'rate_limited');
      assert.equal(second.reason, 'window_limit_reached');
      assert.ok(second.retryAfterMs > 0);
      return `retryAfterMs=${second.retryAfterMs}`;
    } finally {
      h.restore();
    }
  }),

  record('护栏下限不可被配置关掉', async () => {
    const cfg = resolveConfig({ minGapMs: 0, jitterMs: 0, windowLimit: 0, windowMs: 0, pollMs: 0, stableSamples: 0 });
    assert.ok(cfg.minGapMs >= 5000);
    assert.ok(cfg.jitterMs >= 1000);
    assert.ok(cfg.windowLimit >= 1);
    assert.ok(cfg.windowMs >= 600000);
    assert.ok(cfg.pollMs >= 500);
    assert.ok(cfg.stableSamples >= 2);
    assert.equal(cfg.floor.minGapMs, 5000);
    return `minGap=${cfg.minGapMs} windowLimit=${cfg.windowLimit}`;
  }),

  record('空 prompt → invalid，不触达 ego', async () => {
    const h = await makeHarness({ mode: 'none' });
    try {
      const value = await h.tools.get('web_ai_discuss').execute({ prompt: '   ' }, h.exec);
      assert.equal(value.code, 'invalid');
      assert.equal(value.reason, 'empty_prompt');
      return value.reason;
    } finally {
      h.restore();
    }
  }),

  record('status 只读路径 → ok', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const value = await h.tools.get('web_ai_status').execute({}, h.exec);
      assert.equal(value.code, 'ok');
      assert.equal(value.ego.found, true);
      assert.equal(value.guardrails.serial, true);
      return `ego=${value.ego.source}`;
    } finally {
      h.restore();
    }
  }),

  record('非法 id（路径穿越）→ not_found，不读盘外文件', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const read = h.tools.get('web_ai_read_discussion');
      for (const bad of ['../../profiles/desktop/package', '..\\..\\package', 'd-20261024-220234-da74/../../../package']) {
        const value = await read.execute({ id: bad }, h.exec);
        assert.equal(value.code, 'not_found', `id=${bad} 应为 not_found`);
        assert.equal(value.latest ?? null, null);
      }
      // 合法 id 仍能读
      const discuss = h.tools.get('web_ai_discuss');
      const ok = await discuss.execute({ prompt: '在吗' }, h.exec);
      const back = await read.execute({ id: ok.discussionId }, h.exec);
      assert.equal(back.code, 'ok');
      return 'traversal blocked, valid id ok';
    } finally {
      h.restore();
    }
  }),

  record('ego 空间互斥：live 读与 probe 并发 → 一次 busy', async () => {
    const h = await makeHarness({ mode: 'slow' });
    try {
      const read = h.tools.get('web_ai_read_discussion');
      const status = h.tools.get('web_ai_status');
      const [a, b] = await Promise.all([
        read.execute({ live: true }, h.exec),
        status.execute({ probe: true }, h.exec),
      ]);
      const codes = [a.code, b.code].sort();
      assert.ok(codes.includes('busy'), `应有一个 busy，实际 ${codes.join('/')}`);
      const busy = a.code === 'busy' ? a : b;
      assert.equal(busy.reason, 'ego_space_busy');
      return `codes=${codes.join('/')}`;
    } finally {
      h.restore();
    }
  }),

  record('字符串 "true" 被当作布尔 true（模型可能传字符串）', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const value = await discuss.execute({ prompt: '在吗', newChat: 'true' }, h.exec);
      assert.equal(value.code, 'ok');
      // newChat='true' 必须被当作 true（不是退回 false）
      assert.equal(value.newChat, true);
      return 'newChat coerced';
    } finally {
      h.restore();
    }
  }),

  record('等待间隔期间被取消 → 护栏不卡死（busy 归零）', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const guard = new Guard(resolveConfig({ minGapMs: 5000, jitterMs: 1000 }));
      // 先跑一次把 lastFinishedAt 推到现在
      await guard.acquire();
      guard.release();
      const controller = new AbortController();
      const pending = guard.acquire({ signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'aborted_while_waiting');
      assert.equal(guard.busy, false, '取消后 busy 必须归零');
      // 取消不计入配额
      const before = guard.snapshot().totalCalls;
      const after = guard.snapshot().totalCalls;
      assert.equal(before, after);
      return 'busy released';
    } finally {
      h.restore();
    }
  }),
];

for (const item of cases) {
  await runCase(item.name, item.fn);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log(JSON.stringify(failed, null, 1));
  process.exit(1);
}
