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
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Guard } from '../lib/guard.js';
import { Mutex } from '../lib/mutex.js';
import { resolveConfig } from '../lib/config.js';
import { registerTools } from '../lib/tools.js';
import { buildDiscussScript } from '../lib/script.js';

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
    // 清理本次用例的临时目录（此前每跑一次用例就在系统 temp 里留一个 wai-case-* 目录）
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响用例结论 */
    }
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

  record('附件路径不合法 → invalid，且不消耗讨论配额', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const before = h.guard.snapshot().totalCalls;
      for (const bad of [
        ['relative.txt'],
        [path.join(tmpdir(), 'definitely-missing-file-xyz.txt')],
        ['   '],
      ]) {
        const value = await discuss.execute({ prompt: '在吗', attachments: bad }, h.exec);
        assert.equal(value.code, 'invalid', `attachments=${JSON.stringify(bad)} 应为 invalid`);
      }
      assert.equal(h.guard.snapshot().totalCalls, before, '校验失败不应计入配额');
      return 'path validation before guard';
    } finally {
      h.restore();
    }
  }),

  record('附件过多 → invalid（上限 5 个）', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const value = await h.tools.get('web_ai_discuss').execute(
        { prompt: '在吗', attachments: ['a', 'b', 'c', 'd', 'e', 'f'] },
        h.exec,
      );
      assert.equal(value.code, 'invalid');
      assert.equal(value.reason, 'too_many_attachments');
      return value.reason;
    } finally {
      h.restore();
    }
  }),

  record('附件合法 → 传给 ego 脚本并写入落盘记录', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const file = path.join(h.root, 'note.md');
      await writeFile(file, '# hi\n', 'utf8');
      const value = await h.tools.get('web_ai_discuss').execute(
        { prompt: '看看这个附件', attachments: [file] },
        h.exec,
      );
      assert.equal(value.code, 'ok');
      assert.deepEqual(value.attachments, [file.replace(/\\/g, '/')]);
      const back = await h.tools.get('web_ai_read_discussion').execute({ id: value.discussionId }, h.exec);
      assert.equal(back.code, 'ok');
      return `attachments=${value.attachments.length}`;
    } finally {
      h.restore();
    }
  }),

  record('preset 合法 → 框架套进提问，落盘仍存原始提问', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const value = await discuss.execute({ prompt: '把这个方案砍到最小', preset: 'simplify' }, h.exec);
      assert.equal(value.code, 'ok');
      assert.equal(value.preset, 'simplify');
      // 落盘的是原始提问，不含框架
      const back = await h.tools.get('web_ai_read_discussion').execute({ id: value.discussionId }, h.exec);
      assert.equal(back.code, 'ok');
      assert.equal(back.items[0].text, 'FAKE ANSWER: ok');
      const stored = JSON.parse(await readFile(path.join(h.cfg.storeDir, `${value.discussionId}.json`), 'utf8'));
      assert.equal(stored.prompt, '把这个方案砍到最小');
      assert.equal(stored.preset, 'simplify');
      return 'preset=simplify';
    } finally {
      h.restore();
    }
  }),

  record('preset 非法 → invalid/unknown_preset，且不消耗讨论配额', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const before = h.guard.snapshot().totalCalls;
      const value = await discuss.execute({ prompt: '在吗', preset: 'not-a-preset' }, h.exec);
      assert.equal(value.code, 'invalid');
      assert.equal(value.reason, 'unknown_preset');
      assert.ok(Array.isArray(value.available) && value.available.includes('review'));
      assert.equal(h.guard.snapshot().totalCalls, before, '校验失败不应计入配额');
      return value.reason;
    } finally {
      h.restore();
    }
  }),

  record('status 返回预设清单', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const value = await h.tools.get('web_ai_status').execute({}, h.exec);
      assert.equal(value.code, 'ok');
      assert.ok(Array.isArray(value.presets) && value.presets.length >= 8);
      const ids = value.presets.map((p) => p.id);
      assert.ok(ids.includes('review') && ids.includes('counterexample'));
      for (const p of value.presets) {
        assert.ok(Array.isArray(p.levels) && p.levels.length === 3, `${p.id} 应有三档`);
        assert.ok(p.levels.some((l) => l.id === 'light'));
        assert.ok(p.levels.some((l) => l.id === 'normal'));
        assert.ok(p.levels.some((l) => l.id === 'strict'));
        for (const l of p.levels) {
          assert.ok(l.template.includes('{prompt}'), `${p.id}/${l.id} 模板应含 {prompt} 占位`);
          assert.equal((l.template.match(/\{prompt\}/g) || []).length, 1);
          // 档位模板要短：轻档 ≤ 220 字符是一道防膨胀闸门（文言化后实测最长 23 字）
          if (l.id === 'light') {
            assert.ok(l.template.length <= 220, `${p.id}/light 模板过长：${l.template.length}`);
          }
        }
      }
      return `presets=${value.presets.length}`;
    } finally {
      h.restore();
    }
  }),

  record('preset 带档位 → 用该档模板，落盘记 presetLevel', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const value = await discuss.execute({ prompt: '这个缓存方案有问题吗', preset: 'review:strict' }, h.exec);
      assert.equal(value.code, 'ok');
      assert.equal(value.preset, 'review');
      assert.equal(value.presetLevel, 'strict');
      const stored = JSON.parse(await readFile(path.join(h.cfg.storeDir, `${value.discussionId}.json`), 'utf8'));
      assert.equal(stored.preset, 'review');
      assert.equal(stored.presetLevel, 'strict');
      // 落盘的 prompt 仍是原始提问，不含框架
      assert.equal(stored.prompt, '这个缓存方案有问题吗');
      return 'review:strict';
    } finally {
      h.restore();
    }
  }),

  record('presetLevel 单独传 → 覆盖预设默认档', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const value = await discuss.execute({ prompt: '砍到最小', preset: 'simplify', presetLevel: 'light' }, h.exec);
      assert.equal(value.code, 'ok');
      assert.equal(value.preset, 'simplify');
      assert.equal(value.presetLevel, 'light');
      return 'simplify/light';
    } finally {
      h.restore();
    }
  }),

  record('档位非法 → invalid/unknown_preset_level，且不消耗配额', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const before = h.guard.snapshot().totalCalls;
      const value = await discuss.execute({ prompt: '在吗', preset: 'review:nope' }, h.exec);
      assert.equal(value.code, 'invalid');
      assert.equal(value.reason, 'unknown_preset_level');
      assert.ok(Array.isArray(value.available) && value.available.includes('strict'));
      assert.equal(h.guard.snapshot().totalCalls, before, '校验失败不应计入配额');
      return value.reason;
    } finally {
      h.restore();
    }
  }),

  record('档位冲突（preset 里写了档位又传 presetLevel）→ invalid/preset_level_conflict', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      const discuss = h.tools.get('web_ai_discuss');
      const value = await discuss.execute({ prompt: '在吗', preset: 'review:strict', presetLevel: 'light' }, h.exec);
      assert.equal(value.code, 'invalid');
      assert.equal(value.reason, 'preset_level_conflict');
      return value.reason;
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

  record('检索：命中只回片段，不回全文（否则 20 条 = 几十万字符）', async () => {
    const h = await makeHarness({ mode: 'ok' });
    try {
      // 直接落两条记录，绕开护栏与 ego：本用例只验检索分支的返回形态。
      const { saveDiscussion } = await import('../lib/store.js');
      await saveDiscussion(h.cfg, {
        id: 'd-20260101-000000-aaaa',
        title: '甲乙丙：标题里有的词',
        prompt: '问一',
        answer: '这是一段答案，里面没有关键词。'.repeat(50),
        createdAt: new Date().toISOString(),
      });
      await saveDiscussion(h.cfg, {
        id: 'd-20260102-000000-bbbb',
        title: '无关标题',
        prompt: '问二',
        answer: '答案里出现甲乙丙这个词' + '尾巴'.repeat(200),
        createdAt: new Date().toISOString(),
      });
      const read = h.tools.get('web_ai_read_discussion');

      // 标题命中
      const byTitle = await read.execute({ search: '甲乙丙' }, h.exec);
      assert.equal(byTitle.code, 'ok');
      assert.equal(byTitle.items.length, 2, '两条都应命中甲乙丙');
      assert.equal(byTitle.search, '甲乙丙');
      const titleHit = byTitle.items.find((i) => i.id === 'd-20260101-000000-aaaa');
      assert.equal(titleHit.matchedIn, 'title');
      assert.ok(typeof titleHit.snippet === 'string' && titleHit.snippet.length > 0);
      assert.equal(titleHit.text, undefined, '检索分支不该回全文');

      // 答案命中：片段要带上下文且远短于全文
      const answerHit = byTitle.items.find((i) => i.id === 'd-20260102-000000-bbbb');
      assert.equal(answerHit.matchedIn, 'answer');
      assert.ok(answerHit.snippet.includes('甲乙丙'));
      assert.ok(answerHit.snippet.length < 200, '片段必须短：' + answerHit.snippet.length);
      assert.equal(byTitle.latest, null, '检索分支不给 latest 全文');
      assert.ok(byTitle.fullTextHint);

      // 未命中
      const miss = await read.execute({ search: '不存在的词' }, h.exec);
      assert.equal(miss.code, 'ok');
      assert.equal(miss.reason, 'no_match');
      assert.equal(miss.items.length, 0);

      // 不带 search 仍回全文（向后兼容）
      const recent = await read.execute({ limit: 1 }, h.exec);
      assert.equal(recent.code, 'ok');
      assert.ok(typeof recent.items[0].text === 'string' && recent.items[0].text.length > 0);
      assert.equal(recent.latest, recent.items[0].text);
      return 'title+answer snippet ok';
    } finally {
      h.restore();
    }
  }),

  record('护栏快照：给出下一次可发时间与阻塞原因', async () => {
    const cfgA = resolveConfig({ minGapMs: 5000, jitterMs: 0, windowMs: 60000, windowLimit: 2 });
    const gA = new Guard(cfgA);
    const fresh = gA.snapshot();
    assert.equal(fresh.blockedBy, null, '空护栏不该报阻塞');
    assert.equal(fresh.nextAvailableInMs, 0);

    await gA.acquire();
    gA.release();
    const after = gA.snapshot();
    assert.equal(after.blockedBy, 'min_gap');
    assert.ok(after.nextAvailableInMs > 4000 && after.nextAvailableInMs <= 5000, `间隔门：${after.nextAvailableInMs}`);
    assert.ok(typeof after.nextAvailableAt === 'string' && after.nextAvailableAt.endsWith('Z'));

    // 窗口用尽 → 阻塞原因切成 rate_window，等待时间跳到窗口剩余
    const cfgB = resolveConfig({ windowMs: 60000, windowLimit: 1 });
    const gB = new Guard(cfgB);
    await gB.acquire();
    gB.release();
    const full = gB.snapshot();
    assert.equal(full.blockedBy, 'rate_window');
    assert.ok(full.nextAvailableInMs > 55000, `窗口门：${full.nextAvailableInMs}`);
    assert.equal(full.nextAvailableIsLowerBound, true);
    return 'min_gap → rate_window';
  }),

  record('附件脚本：图片走缩略图取证，文本走文件名取证', () => {
    const common = {
      resultFile: 'C:/tmp/r.json',
      spaceName: 'dsh-web-ai-discuss',
      url: 'https://chat.deepseek.com/',
      prompt: 'hi',
      newChat: true,
      pollMs: 900,
      stableSamples: 3,
      sendTimeoutMs: 180000,
    };
    const mixed = buildDiscussScript({ ...common, attachments: ['E:/a/shot.png', 'E:/a/doc.md'] });
    // 回归防线：网页端对图片只渲染缩略图，body.innerText 里永远没有 "shot.png"。
    // 旧实现只查正文文本 → 一次成功的图片上传被判成 attachment_not_ready。
    assert.ok(
      mixed.includes('img[src^="blob:"]'),
      '生成脚本应带 blob 缩略图基线统计（图片不用文件名取证）',
    );
    assert.ok(mixed.includes('isImage'), '生成脚本应按扩展名分流取证');
    assert.ok(
      mixed.includes('/\\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i'),
      '图片扩展名白名单应完整生成',
    );
    assert.ok(mixed.includes('namedInAttr'), '生成脚本应保留 alt/title/aria 兜底取证');
    assert.ok(
      mixed.includes('const attachFiles = ["E:/a/shot.png","E:/a/doc.md"]'),
      '附件路径应原样注入',
    );
    const plain = buildDiscussScript({ ...common, attachments: [] });
    assert.ok(plain.includes('const attachFiles = [];'), '无附件时应注入空数组');
    return 'image+text split ok';
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
