/**
 * ego 脚本生成器。
 *
 * 每个函数返回一段完整可执行的 ego 脚本（ESM，交给 `ego-browser nodejs` 的 stdin）。
 * 脚本内部只使用 ego 自己的 TaskSpace / Page API：
 *   taskSpace / task.page / task.pages / task.newPage / task.handOff
 *   page.goto / page.url / page.waitForSelector / page.waitForTimeout
 *   page.evaluate / page.keyboard.*
 * 没有任何网络协议拼装，也不碰 chat.deepseek.com 的私有接口。
 */

import { RESULT_TAG } from './ego.js';

const j = (value) => JSON.stringify(value);

/**
 * 公共外壳：结果对象、结果文件、哨兵行、异常兜底。
 * @param {{ resultFile: string, spaceName: string, body: string }} spec
 */
function wrap({ resultFile, spaceName, body }) {
  return `const R = { code: 'ok', reason: null };
const TAG = ${j(RESULT_TAG)};
const RESULT_FILE = ${j(resultFile)};
const SPACE_NAME = ${j(spaceName)};
const fs = await import('node:fs/promises');
const done = async () => {
  try { await fs.writeFile(RESULT_FILE, JSON.stringify(R, null, 1), 'utf8'); } catch (e) { R.resultFileError = String((e && e.message) || e); }
  try { console.error(TAG + JSON.stringify(R)); } catch (e) {}
};
try {
  await (async () => {
${body}
  })();
} catch (e) {
  R.code = 'failed';
  R.reason = 'script_error';
  R.message = String((e && e.message) || e);
  R.stack = String((e && e.stack) || '').split('\\n').slice(0, 4).join(' | ');
}
await done();
`;
}

/** 进入讨论空间并拿到一个可用的 page。 */
const acquirePage = (newChat, url, extra = '') => `    const task = await taskSpace(SPACE_NAME);
    R.spaceName = SPACE_NAME;
    R.spaceId = task.spaceId;
    let page = null;
    try { page = await task.page('p1'); } catch (e) { R.pageByLabel = 'failed'; }
    if (!page) {
      const pages = await task.pages();
      page = (pages && pages[0]) || (await task.newPage());
      R.pageFrom = pages && pages[0] ? 'existing' : 'created';
    } else {
      R.pageFrom = 'p1';
    }
    let current = '';
    try { current = String(await page.url()); } catch (e) {}
    R.urlAtStart = current;
    if (${newChat ? 'true' : 'false'} || !/chat\\.deepseek\\.com/.test(current)) {
      await page.goto(${j(url)}, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    await page.waitForSelector('css:textarea[name="search"]', { state: 'visible', timeout: 20000 }).catch(() => {});
    R.url = String(await page.url());
    R.title = await page.title().catch(() => '');
${extra}`;

/** 页面状态探针（浏览器侧），返回 composer / 会话气泡 / 登录迹象。 */
const readState = `const pre = await page.evaluate(() => {
  const ta = document.querySelector('textarea[name="search"]');
  const dialog = document.querySelector('[role="dialog"]');
  const text = String((document.body && document.body.innerText) || '').slice(0, 6000);
  const list = Array.from(document.querySelectorAll('div[class*="assistant-message-main-content"]'));
  // 用户消息：ds-message 且不含 ds-markdown（虚拟列表下用户消息数随回合单调递增）
  const userMsgs = Array.from(document.querySelectorAll('div[class*="ds-message"]'))
    .filter((el) => !el.querySelector('div[class*="ds-markdown"]'));
  return {
    hasInput: !!ta,
    disabled: !!(ta && ta.disabled),
    dialog: !!dialog,
    loginish: /(登录\\s*\\/\\s*注册|立即登录|\\blog\\s?in\\b|\\bsign\\s?in\\b)/i.test(text),
    bubbles: list.length,
    userMsgs: userMsgs.length,
    href: String(location.href),
    lastText: list.length ? String(list[list.length - 1].innerText || '').trim() : '',
    placeholder: ta ? String(ta.getAttribute('placeholder') || '') : '',
  };
});
R.state = { hasInput: pre.hasInput, disabled: pre.disabled, dialog: pre.dialog, loginish: pre.loginish, bubbles: pre.bubbles, href: pre.href };
R.loggedOut = (!pre.hasInput) || pre.disabled || (pre.dialog && pre.loginish);`;

/**
 * status 探针脚本：只看，不点击、不输入、不发送。
 * @param {{ resultFile: string, spaceName: string, url: string, navigate: boolean }} spec
 */
export function buildProbeScript({ resultFile, spaceName, url, navigate }) {
  return wrap({
    resultFile,
    spaceName,
    body: `${acquirePage(navigate, url)}
${readState}
    R.ok = true;`,
  });
}

/**
 * read_discussion 的 live 模式：把当前会话里的所有回答气泡读出来。
 * @param {{ resultFile: string, spaceName: string, url: string, limit: number }} spec
 */
export function buildReadScript({ resultFile, spaceName, url, limit }) {
  return wrap({
    resultFile,
    spaceName,
    body: `${acquirePage(false, url)}
${readState}
    const bubbles = await page.evaluate((max) => {
      const list = Array.from(document.querySelectorAll('div[class*="assistant-message-main-content"]'));
      const picked = list.slice(Math.max(0, list.length - max));
      return picked.map((el, i) => ({ i, text: String(el.innerText || '').trim() }));
    }, ${j(limit)});
    R.bubbles = bubbles;`,
  });
}

/**
 * discuss 主脚本：绑定空间 → 登录检测 → 填入 → 发送 → 轮询 → 回收答案。
 *
 * @param {object} spec
 * @param {string} spec.resultFile 结果 JSON 的绝对路径
 * @param {string} spec.spaceName ego TaskSpace 名
 * @param {string} spec.url chat 入口
 * @param {string} spec.prompt 要发送的完整文本
 * @param {boolean} spec.newChat 是否强制回到新会话
 * @param {number} spec.pollMs 轮询间隔
 * @param {number} spec.stableSamples 连续稳定采样次数
 * @param {number} spec.sendTimeoutMs 等待回答的总时长
 */
export function buildDiscussScript({
  resultFile,
  spaceName,
  url,
  prompt,
  newChat,
  pollMs,
  stableSamples,
  sendTimeoutMs,
}) {
  const body = `${acquirePage(newChat, url)}
${readState}
    if (R.loggedOut) {
      R.code = 'unauthorized';
      R.reason = pre.dialog ? 'interaction_required' : 'no_composer';
      let handed = false;
      try { await task.handOff(); handed = true; } catch (e) { R.handoffError = String((e && e.message) || e); }
      R.handoff = handed;
      return;
    }

    const before = pre.bubbles;

    // 关键（实测多轮 e2e 得出）：
    // 1. 真正的聊天滚动容器是 div[class*="ds-virtual-list--printable"]（scroller.mjs 枚举实证，
    //    sh~5754 ch~1211；此前滚 parentElement/window 都是错的——repdiag3 显示 scrollTop 恒 0）。
    // 2. 视口贴合底部时新消息才渲染进 DOM（虚拟列表）；跟随状态必须在**发送之前**建立。
    // 3. 视口内 user 计数（ds-message 无 ds-markdown 子节点）在贴底状态下单调可靠。
    const scrollBottom = () => page.evaluate(() => {
      const scroller = document.querySelector('div[class*="ds-virtual-list--printable"]');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    /**
     * 采样 = 先把视口拉回底部再计数。
     * 三连发 e2e 实证：发送确认瞬间 userMsgs=7，但新回合开始时 DeepSeek 的重渲染
     * 会破坏贴底状态（视口跳回旧位置），虚拟列表随即把底部新条目裁掉——轮询期间
     * userMsgs 恒=6、永远看不到新消息。所以每次采样都必须先恢复贴底。
     */
    const sample = async () => {
      await page.evaluate(() => {
        const scroller = document.querySelector('div[class*="ds-virtual-list--printable"]');
        if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 40) {
          scroller.scrollTop = scroller.scrollHeight;
        }
      });
      return page.evaluate(() => {
        const list = Array.from(document.querySelectorAll('div[class*="assistant-message-main-content"]'));
        const el = list[list.length - 1];
        const users = Array.from(document.querySelectorAll('div[class*="ds-message"]'))
          .filter((n) => !n.querySelector('div[class*="ds-markdown"]'));
        return {
          count: list.length,
          text: el ? String(el.innerText || '').trim() : '',
          userMsgs: users.length,
        };
      });
    };
    let preRoll = null;
    try {
      await scrollBottom();
      await page.waitForTimeout(400);
      preRoll = await sample();
    } catch (e) {}
    R.userMsgsPreRoll = preRoll ? preRoll.userMsgs : null;

    const filled = await page.evaluate((txt) => {
      const ta = document.querySelector('textarea[name="search"]');
      if (!ta) return { ok: false, why: 'no_textarea' };
      const proto = Object.getPrototypeOf(ta) || HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      ta.focus();
      setter.call(ta, txt);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: ta.value === txt, len: ta.value.length };
    }, ${j(prompt)});
    R.fill = { ok: !!filled.ok, len: filled.len ?? null };

    if (!filled.ok) {
      await page.click('css:textarea[name="search"]');
      try { await page.keyboard.insertText(${j(prompt)}); }
      catch (e) { await page.keyboard.type(${j(prompt)}); }
      R.fillFallback = await page.evaluate(() => {
        const ta = document.querySelector('textarea[name="search"]');
        return ta ? ta.value.length : -1;
      });
    }

    /**
     * 发送一次并强确认（swallow 探针结论：fill+Enter 偶发被吞——输入框清空但消息
     * 未上屏，taLen=0 不能作为成功依据）。强确认 = 贴底视口内 userMsgs 上涨；
     * 次要信号 = 气泡数上涨。确认窗口 1.8s（swallow 探针的成功时序）。
     */
    const sendConfirmed = async () => {
      const baseUsers = (preRoll ? preRoll.userMsgs : (pre.userMsgs ?? 0));
      const baseBubbles = pre.bubbles;
      for (let tries = 1; tries <= 3; tries += 1) {
        await page.keyboard.press('Enter');
        // 确认窗口：分几段检查，userMsgs 一涨立刻返回
        for (let w = 0; w < 6; w += 1) {
          await page.waitForTimeout(300);
          const s = await sample().catch(() => null);
          if (s && s.userMsgs > baseUsers) {
            return { delivered: true, tries, via: 'userMsgs', s };
          }
        }
        // 1.8s 未确认：若输入框还有内容，点发送按钮兜底；若已清空但没上屏（被吞），
        // 下一轮循环 re-Enter 之前重新填一次。
        const ta = await page.evaluate(() => {
          const el = document.querySelector('textarea[name="search"]');
          return el ? el.value : '';
        });
        R['sendTry' + tries] = { taLen: ta.length, userMsgs: (await sample().catch(() => ({}))).userMsgs ?? null };
        if (ta.length > 0) {
          await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll('button, [role="button"]'));
            const hit = nodes.find((b) => {
              const label = String(b.getAttribute('aria-label') || '') + ' ' + String(b.className || '');
              return /(send|发送)/i.test(label) && !b.disabled;
            });
            if (hit) hit.click();
          });
          await page.waitForTimeout(600);
          const s = await sample().catch(() => null);
          if (s && s.userMsgs > baseUsers) return { delivered: true, tries, via: 'sendBtn', s };
        }
        // 重新填入（被吞场景输入框可能已清空）
        const cur = await page.evaluate(() => {
          const el = document.querySelector('textarea[name="search"]');
          return el ? el.value : '';
        });
        if (cur.length === 0) {
          await page.evaluate((txt) => {
            const el = document.querySelector('textarea[name="search"]');
            const proto = Object.getPrototypeOf(el) || HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            el.focus();
            setter.call(el, txt);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }, ${j(prompt)});
        }
      }
      const fin = await sample().catch(() => null);
      return { delivered: false, tries: 3, via: 'none', s: fin };
    };

    const attempt = await sendConfirmed();
    R.sendTries = attempt.tries;
    R.sendVia = attempt.via;
    R.bubblesAfterSend = attempt.s ? attempt.s.count : null;
    R.userMsgsAfterSend = attempt.s ? attempt.s.userMsgs : null;

    // 三次都没发出去 → 不轮询，快速失败（避免白等整个 sendTimeoutMs）
    if (!attempt.delivered) {
      R.code = 'failed';
      R.reason = 'send_failed';
      R.message = 'message was not delivered after 3 send attempts (Enter + send-button retry)';
      return;
    }

    // 思考中：回答气泡出现但仍在增长/变化时也要等到稳定；超时则带回 partial。
    // 判据（两条都满足才算新回合完成）：
    //   1. 用户消息数 > baseline（发送前滚动后记录的视口内计数，见上方 scrollBottom 注释；
    //      assistant 气泡数非单调——重渲染时可能瞬时 5→4→5，不能用作判据）；
    //   2. 最后一条 assistant 文本连续 stableSamples 次采样保持不变（生成完毕）。
    // 即便新答案与上一条答案文本相同（重复提问），判据 1 也能识别新回合。
    // 轮询与采样全程不再滚动（滚动发生在发送前，见上）。
    const startedAt = Date.now();
    const deadline = startedAt + ${j(sendTimeoutMs)};
    const userBefore = preRoll ? preRoll.userMsgs : (pre.userMsgs ?? 0);
    R.userMsgsBaseline = userBefore;
    let last = '';
    let answer = '';
    let stable = 0;
    let polls = 0;
    let lastCount = preRoll ? preRoll.count : before;
    let userAfter = userBefore;
    let sawNew = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(${j(pollMs)});
      polls += 1;
      let snap;
      try { snap = await sample(); } catch (e) { continue; }
      lastCount = snap.count;
      userAfter = snap.userMsgs;
      if (userAfter <= userBefore) continue;
      sawNew = true;
      if (!snap.text) continue;
      if (snap.text === last) stable += 1;
      else { stable = 0; last = snap.text; answer = snap.text; }
      if (stable >= ${j(stableSamples)}) break;
    }

    // 最终复核：虚拟列表滞后时，超时轮询里 userMsgs 一直没涨但现场其实已有新回合。
    if (!answer) {
      for (let i = 0; i < 4 && !answer; i += 1) {
        await page.waitForTimeout(2000);
        let snap;
        try { snap = await sample(); } catch (e) { break; }
        lastCount = snap.count;
        userAfter = snap.userMsgs;
        if (userAfter > userBefore && snap.text) {
          if (snap.text === last) stable += 1;
          else { stable = 0; last = snap.text; answer = snap.text; }
          if (stable >= 2) break;
        }
      }
      if (answer) R.rescuedByFinalCheck = true;
    }

    R.polls = polls;
    R.bubblesBefore = before;
    R.bubblesAfter = lastCount;
    R.userMsgsBefore = userBefore;
    R.userMsgsAfter = userAfter;
    R.sawNew = sawNew;
    R.elapsedMs = Date.now() - startedAt;
    R.answer = answer;
    R.answerChars = answer.length;
    if (!answer) {
      R.code = 'timeout';
      R.reason = sawNew ? 'no_stable_answer' : 'no_answer';
    }
    try { R.url = String(await page.url()); } catch (e) {}`;
  return wrap({ resultFile, spaceName, body });
}
