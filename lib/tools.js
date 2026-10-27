/**
 * 三个工具的契约：web_ai_discuss / web_ai_read_discussion / web_ai_status。
 *
 * 统一约定：
 *   - 返回值永远是同一个 canonical JSON 信封（对象根），业务非理想结果不 throw；
 *   - render 输出与 value 完全一致的 JSON 文本，保证模型看到的与旁路消费者一致；
 *   - 未登录只返回 { code: 'unauthorized', handoff: {...} }，不生成任何"请登录"话术。
 */

import { readFile } from 'node:fs/promises';
import {
  PLUGIN_NAME,
  TOOL_DISCUSS,
  TOOL_READ,
  TOOL_STATUS,
} from './config.js';
import { guessEgoVersion, readSentinel, resolveEgoPath, runEgoScript } from './ego.js';
import { emit } from './hooks.js';
import { buildDiscussScript, buildProbeScript, buildReadScript } from './script.js';
import {
  ensureStore,
  getDiscussion,
  listDiscussions,
  newDiscussionId,
  newTempResultPath,
  pruneTemp,
  saveDiscussion,
} from './store.js';

const CODES = [
  'ok',
  'invalid',
  'busy',
  'rate_limited',
  'unauthorized',
  'unavailable',
  'timeout',
  'failed',
  'not_found',
];

export const CODE_ENUM = Object.freeze(CODES);

const iso = () => new Date().toISOString();

/** 统一信封。 */
function envelope(tool, code, reason, extra = {}) {
  return {
    tool,
    code,
    reason: reason ?? null,
    message: extra.message ?? null,
    at: extra.at ?? iso(),
    ...extra,
  };
}

function fail(tool, code, reason, extra = {}) {
  const { message, at, ...rest } = extra;
  return envelope(tool, code, reason, { message: message ?? null, at, ...rest });
}

/** 答案清洗：统一换行、去尾随空白、压缩空行、限长。 */
export function cleanAnswer(text, maxChars) {
  let s = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > maxChars) {
    const cut = s.length - maxChars;
    s = `${s.slice(0, maxChars)}\n…[truncated ${cut} chars]`;
  }
  return s;
}

function titleOf(topic, prompt) {
  const base = String(topic ?? '').trim() || String(prompt ?? '').replace(/\s+/g, ' ').trim();
  return base.length > 48 ? `${base.slice(0, 48)}…` : base;
}

/** 组装真正发给网页版的文本。 */
export function composePrompt(args) {
  const prompt = String(args?.prompt ?? '').trim();
  if (!prompt) return '';
  const context = String(args?.context ?? '').trim();
  if (!context) return prompt;
  return `${prompt}\n\n---\n补充上下文：\n${context}`;
}

/**
 * followUp 语法糖：把上一条讨论的问答对折进 context。默认 newChat=true 下
 * 这是携带上文的主通道；newChat=false 的持久会话里则与网页上文互补。
 * 显式传了 context 时两者并存（followUp 在前）。
 *
 * 注意：工具 args 可能被 deepFreeze（不可扩展），因此不原地修改，
 * 返回 { args: 新对象 }，调用方用返回值替换。
 */
export async function expandFollowUp(cfg, args) {
  const ref = String(args?.followUp ?? '').trim();
  if (!ref) return null;
  const record = await getDiscussion(cfg, ref);
  if (!record) return { error: 'unknown_discussion', id: ref };
  const excerpt = cleanAnswer(record.answer, cfg.followUpChars ?? 4000);
  const block = `上一轮讨论（${record.id}「${record.title}」）的回答摘要：\n${excerpt}`;
  const prior = String(args?.context ?? '').trim();
  const merged = prior ? `${block}\n\n---\n${prior}` : block;
  return { ok: true, followedUp: record.id, args: { ...args, followUp: undefined, context: merged } };
}

/** 读结果：先读结果文件，再退回哨兵行。 */
async function readEgoResult(resultFile, output) {
  try {
    const text = await readFile(resultFile, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return { value: parsed, via: 'file' };
  } catch {
    /* fall through */
  }
  const fromSentinel = readSentinel(output);
  if (fromSentinel && typeof fromSentinel === 'object') return { value: fromSentinel, via: 'sentinel' };
  return { value: undefined, via: 'none' };
}

/** 从 ego 脚本结果里抽出给模型的公共字段。 */
function egoReport(res, egoPath) {
  return {
    executable: egoPath ?? null,
    spaceName: res?.spaceName ?? null,
    spaceId: res?.spaceId ?? null,
    url: res?.url ?? res?.urlAtStart ?? null,
    bubblesBefore: res?.bubblesBefore ?? null,
    bubblesAfter: res?.bubblesAfter ?? null,
    polls: res?.polls ?? null,
  };
}

/** 取当前会话标识，供客户端做'每会话首次自动开面板'。 */
function sessionKeyOf(exec) {
  const agent = exec && exec.agent;
  const session = agent && agent.session;
  return (session && (session.id ?? session.sessionId)) ?? (agent && agent.id) ?? null;
}

/** discuss 结束时给模型的护栏快照：本次调用已结束，busy 恒为 false。 */
function snapshotAfterGuard(guard) {
  return { ...guard.snapshot(), busy: false };
}

const JSON_TEXT = (value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }];

/**
 * 注册三个工具。
 * @param {{ ctx: any, cfg: ReturnType<import('./config.js').resolveConfig>, guard: import('./guard.js').Guard, mutex?: import('./mutex.js').Mutex, logger?: any }} deps
 */
export function registerTools({ ctx, cfg, guard, mutex, logger }) {
  const disposers = [];
  const log = (level, message, data) => {
    try {
      logger?.[level]?.(`[${PLUGIN_NAME}] ${message}`, data ?? '');
    } catch {
      /* ignore */
    }
  };

  /**
   * 占用 ego 空间。discuss / read(live) / status(probe) 都要独占同一个 TaskSpace，
   * 否则它们会同时操作同一个 page（探针把 discuss 正在用的页面导航走、
   * 两个脚本同时读虚拟列表计数）。锁被占时立刻返回 busy，不排队。
   */
  const takeSpace = (holder) => {
    if (!mutex) return { ok: true };
    if (!mutex.tryAcquire(holder)) {
      return { ok: false, code: 'busy', reason: 'ego_space_busy' };
    }
    return { ok: true };
  };
  const freeSpace = () => {
    try { mutex?.release(); } catch { /* ignore */ }
  };

  // ───────────────────────── web_ai_discuss ─────────────────────────
  const discussDescription = [
    '把一个问题/一个方案交给已登录的网页版 DeepSeek 做外部讨论，取回它的回答原文。',
    '仅在需要多角度讨论、评审、方案对比、找反例或验证思路时调用；不用于日常问答、事实查询、代码补全或可以直接自己回答的事情。',
    '写操作受三重护栏约束（全局串行、随机最小间隔、频率上限），三者不可关闭：并发调用会立刻拿到 code=busy，超额会拿到 code=rate_limited。',
    '网页端未登录/需要人机接管时返回 code=unauthorized 与 handoff 信息，浏览器侧由用户接管；不要在对话里转述登录提示。',
    '返回唯一 canonical JSON；业务非理想结果不抛异常，读 code/reason 判断。',
  ].join('');

  disposers.push(
    ctx.tools.register({
      name: TOOL_DISCUSS,
      description: discussDescription,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            description: '要交给网页版 DeepSeek 讨论的完整提问。写清目标、约束与期望产出，不要只写关键词。',
          },
          topic: {
            type: 'string',
            description: '本次讨论的短标题，用于本地记录索引；省略时取 prompt 前 48 字。',
          },
          context: {
            type: 'string',
            description: '附在提问后面的补充上下文（代码片段、约束、已有结论）。省略表示不补充。',
          },
          newChat: {
            type: 'boolean',
            description: '是否先回到 chat.deepseek.com 新会话再提问。默认 true（推荐）：新会话气泡从零开始，发送与完成判定最可靠；上下文连续性用 followUp 承担。显式传 false 才沿用当前网页会话（适合网页端手动追问场景，发送偶发未生效时可能 timeout）。',
          },
          timeoutMs: {
            type: 'integer',
            description: '本次等待回答的最长时间（毫秒），会被钳制到 30000–600000；默认取插件配置。',
          },
          followUp: {
            type: 'string',
            description: '语法糖：传入一条历史讨论 id（d-YYYYMMDD-...），自动把那条问答折进 context 再发送，实现跨会话追问。默认 newChat=true 下这是携带上文的主通道；newChat=false 时网页会话本身也保留上文。',
          },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => JSON_TEXT(value),
      },
      timeoutMs: 660000,
      async execute(args, exec) {
        const at = iso();
        const sessionKey = sessionKeyOf(exec);
        if (args?.followUp) {
          const fu = await expandFollowUp(cfg, args);
          if (fu?.error) {
            return fail(TOOL_DISCUSS, 'not_found', fu.error, { at, sessionKey, id: fu.id ?? null });
          }
          if (fu?.args) {
            // args 可能被 deepFreeze，用展开后的新对象替换（context 已折入历史问答）
            args = fu.args;
          }
        }
        const prompt = composePrompt(args);
        if (!prompt) {
          return fail(TOOL_DISCUSS, 'invalid', 'empty_prompt', {
            at,
            sessionKey,
            hint: 'prompt 不能为空',
          });
        }

        const permit = await guard.acquire({ signal: exec?.signal });
        if (!permit.ok) {
          log('warn', `discuss rejected: ${permit.code}/${permit.reason}`);
          return fail(TOOL_DISCUSS, permit.code, permit.reason, {
            at,
            sessionKey,
            ...(permit.retryAfterMs ? { retryAfterMs: permit.retryAfterMs } : {}),
            guardrails: permit.guardrails,
          });
        }

        try {
          const space = takeSpace(TOOL_DISCUSS);
          if (!space.ok) {
            return fail(TOOL_DISCUSS, space.code, space.reason, {
              at,
              sessionKey,
              guardrails: snapshotAfterGuard(guard),
            });
          }
          try {
            const ego = resolveEgoPath(cfg);
            if (!ego.ok) {
              return fail(TOOL_DISCUSS, 'unavailable', ego.reason, {
                at,
                sessionKey,
                guardrails: snapshotAfterGuard(guard),
                checked: ego.checked,
              });
            }
          const store = await ensureStore(cfg);
          // 顺手清掉过期的 ego 结果文件（pruneTemp 之前从未被调用，tmp 会无限堆积）。
          await pruneTemp(cfg).catch(() => {});
          const id = newDiscussionId();
          const resultFile = newTempResultPath(store.tmp, id);
          const sendTimeoutMs = Math.min(
            600000,
            Math.max(30000, Number(args?.timeoutMs) || cfg.sendTimeoutMs),
          );
          // newChat 默认取配置 defaultNewChat（true）：新会话从零开始，虚拟列表无历史裁切，
          // 发送/完成判定可靠；上下文连续性由 followUp 承担。显式传入时以 args 为准。
          // 强制布尔化：模型可能传 "true"/"false" 字符串，原来的 === true 判断会
          // 把它当成 false，静默退回旧会话（判据基线不干净）。
          const useNewChat = args?.newChat === undefined
            ? cfg.defaultNewChat !== false
            : args.newChat === true || args.newChat === 'true';
          const script = buildDiscussScript({
            resultFile,
            spaceName: cfg.spaceName,
            url: cfg.url,
            prompt,
            newChat: useNewChat,
            pollMs: cfg.pollMs,
            stableSamples: cfg.stableSamples,
            sendTimeoutMs,
          });
          if (exec?.signal?.aborted) {
            return fail(TOOL_DISCUSS, 'failed', 'aborted', { at, guardrails: snapshotAfterGuard(guard) });
          }
          const run = await runEgoScript(ego.path, script, {
            timeoutMs: sendTimeoutMs + 90000,
            signal: exec?.signal,
          });
          const { value: res, via } = await readEgoResult(resultFile, run.output);
          const egoInfo = egoReport(res, ego.path);
          const baseExtra = {
            at,
            sessionKey,
            discussionId: id,
            ego: egoInfo,
            guardrails: snapshotAfterGuard(guard),
            transport: { via, exitCode: run.exitCode, timedOut: run.timedOut, aborted: run.aborted },
          };

          if (!res) {
            return fail(TOOL_DISCUSS, 'failed', 'ego_no_result', {
              ...baseExtra,
              message: run.timedOut ? 'ego script timed out' : 'ego script produced no result',
              stderrTail: String(run.output ?? '').slice(-1200),
            });
          }

          if (res.code === 'unauthorized') {
            log('warn', 'discuss requires user interaction in ego space');
            return fail(TOOL_DISCUSS, 'unauthorized', res.reason ?? 'login_required', {
              ...baseExtra,
              handoff: {
                spaceName: res.spaceName ?? cfg.spaceName,
                spaceId: res.spaceId ?? null,
                started: res.handoff === true,
              },
            });
          }

          if (res.code === 'timeout') {
            return fail(TOOL_DISCUSS, 'timeout', res.reason ?? 'no_answer', {
              ...baseExtra,
              message: res.message ?? null,
              elapsedMs: res.elapsedMs ?? null,
              partial: res.answer ? cleanAnswer(res.answer, cfg.maxAnswerChars) : null,
            });
          }

          if (res.code !== 'ok') {
            return fail(TOOL_DISCUSS, 'failed', res.reason ?? 'ego_error', {
              ...baseExtra,
              message: res.message ?? null,
              stack: res.stack ?? null,
            });
          }

          const answer = cleanAnswer(res.answer, cfg.maxAnswerChars);
          const createdAt = iso();
          await saveDiscussion(cfg, {
            id,
            title: titleOf(args?.topic, prompt),
            prompt,
            answer,
            url: res.url ?? null,
            createdAt,
            elapsedMs: res.elapsedMs ?? null,
            ego: egoInfo,
            guardrails: snapshotAfterGuard(guard),
          });

          const value = envelope(TOOL_DISCUSS, 'ok', null, {
            at,
            sessionKey,
            discussionId: id,
            createdAt,
            title: titleOf(args?.topic, prompt),
            answer,
            answerChars: answer.length,
            elapsedMs: res.elapsedMs ?? null,
            newChat: useNewChat,
            handoff: null,
            ego: egoInfo,
            guardrails: snapshotAfterGuard(guard),
            transport: { via, exitCode: run.exitCode },
          });

          // 自定义扩展出口：webhook / 用户钩子。失败只进 notify，不影响 code。
          try {
            value.notify = await emit(cfg, 'discuss.ok', {
              id,
              title: value.title,
              prompt,
              answer,
              url: res.url ?? null,
              elapsedMs: res.elapsedMs ?? null,
              discussionId: id,
            });
          } catch (e) {
            value.notify = { event: 'discuss.ok', error: String(e?.message ?? e) };
          }
          return value;
          } finally {
            freeSpace();
          }
        } catch (error) {
          log('error', 'discuss failed', error);
          return fail(TOOL_DISCUSS, 'failed', 'plugin_error', {
            at,
            message: String(error?.message ?? error),
            guardrails: snapshotAfterGuard(guard),
          });
        } finally {
          guard.release();
        }
      },
    }),
  );

  // ───────────────────── web_ai_read_discussion ─────────────────────
  disposers.push(
    ctx.tools.register({
      name: TOOL_READ,
      description: [
        '读取已保存的 discuss 结果原文，不发新请求、不触发任何网页写操作。',
        '用法：传 id 读指定讨论；不传 id 时按最新优先返回；live=true 时从 ego 空间里现读当前会话的全部回答气泡。',
        '返回唯一 canonical JSON（code=ok 时含 items 数组与 latest 全文）。',
      ].join(''),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description: '讨论 id，形如 d-20261024-215000-ab12。省略时读本地索引里最新的若干条。',
          },
          limit: {
            type: 'integer',
            description: '返回条数，1–20，默认 3。',
          },
          live: {
            type: 'boolean',
            description: 'true 表示直接从 ego 空间当前页面读取回答气泡；默认 false，只读本地记录。',
          },
          search: {
            type: 'string',
            description: '关键字过滤（不区分大小写，匹配标题与答案正文；只作用于本地记录分支）。',
          },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => JSON_TEXT(value),
      },
      timeoutMs: 120000,
      async execute(args, exec) {
        const at = iso();
        const limit = Math.min(20, Math.max(1, Math.trunc(Number(args?.limit) || 3)));
      // live 同理：模型可能传字符串 "true"。
      const wantLive = args?.live === true || args?.live === 'true';
        const id = String(args?.id ?? '').trim();

        if (wantLive) {
          const space = takeSpace(TOOL_READ);
          if (!space.ok) {
            return fail(TOOL_READ, space.code, space.reason, { at });
          }
          try {
            const ego = resolveEgoPath(cfg);
            if (!ego.ok) return fail(TOOL_READ, 'unavailable', ego.reason, { at, checked: ego.checked });
            const store = await ensureStore(cfg);
            const resultFile = newTempResultPath(store.tmp, `read-${Date.now()}`);
            const script = buildReadScript({
              resultFile,
              spaceName: cfg.spaceName,
              url: cfg.url,
              limit,
            });
            const run = await runEgoScript(ego.path, script, { timeoutMs: 90000, signal: exec?.signal });
            const { value: res } = await readEgoResult(resultFile, run.output);
            if (!res) {
              return fail(TOOL_READ, 'failed', 'ego_no_result', {
                at,
                message: run.timedOut ? 'ego script timed out' : 'ego script produced no result',
                stderrTail: String(run.output ?? '').slice(-1200),
              });
            }
            if (res.code !== 'ok') {
              return fail(TOOL_READ, res.code === 'unauthorized' ? 'unauthorized' : 'failed', res.reason ?? 'ego_error', {
                at,
                ego: egoReport(res, ego.path),
                message: res.message ?? null,
              });
            }
            const items = Array.isArray(res.bubbles)
              ? res.bubbles.map((entry, index) => ({
                index,
                chars: String(entry?.text ?? '').length,
                text: cleanAnswer(entry?.text, cfg.maxAnswerChars),
              }))
              : [];
            return envelope(TOOL_READ, 'ok', null, {
              at,
              source: 'live',
              ego: egoReport(res, ego.path),
              items,
              latest: items.length ? items[items.length - 1].text : null,
            });
          } finally {
            freeSpace();
          }
        }

        if (id) {
          const record = await getDiscussion(cfg, id);
          if (!record) return fail(TOOL_READ, 'not_found', 'unknown_discussion', { at, id });
          const text = cleanAnswer(record.answer, cfg.maxAnswerChars);
          return envelope(TOOL_READ, 'ok', null, {
            at,
            source: 'store',
            items: [{
              id: record.id,
              title: record.title,
              createdAt: record.createdAt,
              chars: text.length,
              text,
            }],
            latest: text,
          });
        }

        const index = await listDiscussions(cfg, 200);
        const needle = String(args?.search ?? '').trim().toLowerCase();
        const items = [];
        for (const entry of index) {
          const record = await getDiscussion(cfg, entry.id);
          if (!record) continue;
          if (needle
            && !`${record.title ?? ''}\n${record.answer ?? ''}`.toLowerCase().includes(needle)) {
            continue;
          }
          items.push({
            id: record.id,
            title: record.title,
            createdAt: record.createdAt,
            chars: String(record.answer ?? '').length,
            text: cleanAnswer(record.answer, cfg.maxAnswerChars),
          });
          if (items.length >= limit) break;
        }
        if (items.length === 0) {
          return envelope(TOOL_READ, 'ok', needle ? 'no_match' : 'empty_store', { at, source: 'store', search: needle || null, items: [], latest: null });
        }
        return envelope(TOOL_READ, 'ok', null, {
          at,
          source: 'store',
          search: needle || null,
          items,
          latest: items[0].text,
        });
      },
    }),
  );

  // ────────────────────────── web_ai_status ──────────────────────────
  disposers.push(
    ctx.tools.register({
      name: TOOL_STATUS,
      description: [
        '自检：ego 可执行文件定位结果、讨论空间名、存储目录、护栏参数与用量、最近讨论索引。',
        'probe=true 时会真的打开/检查 ego 空间（只读，不输入不发送），耗时数秒；默认 false 只读本地状态。',
        '返回唯一 canonical JSON。',
      ].join(''),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          probe: {
            type: 'boolean',
            description: '是否执行只读的 ego 页面探针。默认 false。',
          },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => JSON_TEXT(value),
      },
      timeoutMs: 120000,
      async execute(args) {
        const at = iso();
        const ego = resolveEgoPath(cfg);
        const store = await ensureStore(cfg);
        const latest = await listDiscussions(cfg, 5);
        const all = await listDiscussions(cfg, 200);
        const base = {
          at,
          plugin: PLUGIN_NAME,
          spaceName: cfg.spaceName,
          url: cfg.url,
          storeDir: store.dir,
          storeStats: {
            discussions: all.length,
            oldestAt: all.length ? all[all.length - 1].createdAt : null,
            newestAt: all.length ? all[0].createdAt : null,
          },
          ego: {
            found: ego.ok,
            executable: ego.ok ? ego.path : null,
            source: ego.ok ? ego.source : ego.reason,
            ...(ego.ok ? {} : { checked: ego.checked }),
          },
          guardrails: guard.snapshot(),
          recent: latest,
        };

        // 模型可能传字符串 "true"（多数模型会，但也不能假设）。
        const wantProbe = args?.probe === true || args?.probe === 'true';
        if (!wantProbe) {
          return envelope(TOOL_STATUS, ego.ok ? 'ok' : 'unavailable', ego.ok ? null : ego.reason, base);
        }
        if (!ego.ok) {
          return fail(TOOL_STATUS, 'unavailable', ego.reason, base);
        }

        const resultFile = newTempResultPath(store.tmp, `probe-${Date.now()}`);
        const space = takeSpace(TOOL_STATUS);
        if (!space.ok) {
          return fail(TOOL_STATUS, space.code, space.reason, base);
        }
        try {
          const script = buildProbeScript({
            resultFile,
            spaceName: cfg.spaceName,
            url: cfg.url,
            navigate: false,
          });
          const run = await runEgoScript(ego.path, script, { timeoutMs: 90000 });
          const { value: res, via } = await readEgoResult(resultFile, run.output);
          if (!res) {
            return fail(TOOL_STATUS, 'failed', 'ego_no_result', {
              ...base,
              message: run.timedOut ? 'ego script timed out' : 'ego script produced no result',
              stderrTail: String(run.output ?? '').slice(-1200),
            });
          }
          const page = {
            loggedOut: res.loggedOut === true,
            spaceId: res.spaceId ?? null,
            url: res.url ?? null,
            title: res.title ?? null,
            state: res.state ?? null,
          };
          const egoVersion = ego.ok ? (guessEgoVersion(ego.path) ?? null) : null;
          const code = res.code === 'ok' ? (res.loggedOut ? 'unauthorized' : 'ok') : 'failed';
          return envelope(TOOL_STATUS, code, res.loggedOut ? 'interaction_required' : (res.reason ?? null), {
            ...base,
            ego: { ...base.ego, version: egoVersion },
            page,
            transport: { via, exitCode: run.exitCode, timedOut: run.timedOut },
          });
        } finally {
          freeSpace();
        }
      },
    }),
  );

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  };
}
