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
      ${newChat ? `// newChat：光 goto 首页不一定开新会话——DeepSeek 会把 landing 重定向到
      // 上一次会话（history 里的 recent chat）。必须显式点"开启新对话"，
      // 否则新旧回合混在同一条会话里，userMsgs 基线不为 0，判据就不干净。
      R.newChatClicked = false;
      try {
        const clicked = await page.evaluate(() => {
          // 注意：ego 快照里 "开启新对话" 是 button 的**兄弟文本节点**，
          // button.textContent 为空，所以不能只在 button 里找文本。
          // 做法：全量元素里找文本匹配的，取最深的那个；命中后优先点它自己，
          // 它不是可点元素时再点它的最近可点祖先（button / [role=button] / a）。
          const all = Array.from(document.querySelectorAll('body *'));
          const hits = all.filter((el) => {
            const t = String(el.textContent || '').trim();
            if (!t || t.length > 12) return false;
            return /^(开启新对话|新建对话|新对话|new\\s*chat)$/i.test(t);
          });
          if (!hits.length) return false;
          // 取最深的命中（没有子元素命中）
          const deepest = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)))[0] || hits[0];
          const clickable = deepest.closest('button, [role="button"], a') || deepest;
          clickable.click();
          return true;
        });
        R.newChatClicked = !!clicked;
        if (clicked) await page.waitForTimeout(800);
      } catch (e) { R.newChatError = String((e && e.message) || e); }` : ''}
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
 * @param {string[]} [spec.attachments] 要上传给网页版的附件绝对路径（正斜杠）
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
  attachments = [],
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

    // ── 附件上传（可选）──
    // 网页端 composer 里有一个隐藏的 input[type=file]（探针实证：multiple，accept 覆盖
    // pdf/图片/代码/文档等上千种扩展名）。用 ego 的 setInputFiles 直接塞进去，
    // 页面会渲染成附件 chip。等 chip 出现才算上传完成。
    //
    // 两类附件的「到位证据」不同，必须分开取证（探针实证，2026-10-28）：
    //   · 文本/文档类（md/pdf/docx…）→ 正文里出现「文件名」文本（"xxx.md MD 26B"）
    //   · 图片类（png/jpg/webp…）→ **正文里根本没有文件名**，整页 innerText 不含
    //     "foo.png"，只多出一个 img[src^="blob:"] 缩略图（naturalWidth 即原图宽）。
    //     旧实现只查正文文本，于是图片附件永远等不到 chip → 误判 attachment_not_ready。
    // 因此图片按「blob 缩略图增量」或「img 的 alt/title/aria-label 命中文件名」取证，
    // 其余仍按文件名文本取证；两类都满足才算完成。
    //
    // 注意：R.attachments 必须是**对象**而不是数组——数组上的自定义属性会被
    // JSON.stringify 丢掉（诊断字段 uploaded/chipsVisible 会消失）。
    R.attachments = { files: [], uploaded: 0, chipsVisible: false };
    const attachFiles = ${j(attachments)};
    if (attachFiles && attachFiles.length) {
      R.attachments.files = attachFiles;
      try {
        const inputSel = 'input[type="file"]';
        const hasInput = await page.evaluate((sel) => !!document.querySelector(sel), inputSel);
        R.attachments.hasFileInput = hasInput;
        if (!hasInput) {
          R.attachments.error = 'no_file_input';
        } else {
          // 上传前的 blob 缩略图基线：只能看**增量**，历史会话气泡里的图片也是 blob/URL
          const baseBlob = await page.evaluate(
            () => document.querySelectorAll('img[src^="blob:"]').length,
          );
          await page.setInputFiles(inputSel, attachFiles);
          const names = attachFiles.map((p) => String(p).split(/[\\\\/]/).pop());
          const isImage = (n) => /\\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(n);
          const imageNames = names.filter(isImage);
          const textNames = names.filter((n) => !isImage(n));
          R.attachments.imageCount = imageNames.length;
          R.attachments.textCount = textNames.length;
          let chipOk = false;
          let last = null;
          // 12 × 500ms 的旧上限对图片偏紧（缩略图要等 blob 生成 + 解码），放到 24 次；
          // 主循环仍会在证据齐备时立刻 break，正常情况不会真等满。
          for (let w = 0; w < 24; w += 1) {
            await page.waitForTimeout(500);
            last = await page.evaluate((spec) => {
              const body = String((document.body && document.body.innerText) || '');
              const imgs = [...document.querySelectorAll('img')];
              const namedInText = spec.textNames.filter((n) => body.includes(n)).length;
              const blobGrew =
                imgs.filter((im) => String(im.src || '').indexOf('blob:') === 0).length - spec.baseBlob;
              const namedInAttr = spec.imageNames.filter((n) =>
                imgs.some((im) => {
                  const attr =
                    (im.getAttribute('alt') || '') +
                    (im.getAttribute('title') || '') +
                    (im.getAttribute('aria-label') || '');
                  return attr.includes(n);
                }),
              ).length;
              return { namedInText, blobGrew, namedInAttr, imgCount: imgs.length };
            }, { textNames, imageNames, baseBlob });
            const imageOk =
              imageNames.length === 0 ||
              Math.max(last.blobGrew, last.namedInAttr) >= imageNames.length;
            const textOk = last.namedInText >= textNames.length;
            if (imageOk && textOk) { chipOk = true; break; }
          }
          R.attachments.uploaded = names.length;
          R.attachments.chipsVisible = chipOk;
          R.attachments.evidence = last;
          if (!chipOk) {
            R.code = 'failed';
            R.reason = 'attachment_not_ready';
            R.message = 'attachment previews did not appear in the composer';
            return;
          }
        }
      } catch (e) {
        R.code = 'failed';
        R.reason = 'attachment_upload_failed';
        R.message = String((e && e.message) || e);
        return;
      }
    }

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
