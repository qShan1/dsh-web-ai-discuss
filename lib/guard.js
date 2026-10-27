/**
 * 写操作护栏：全局串行 + 随机最小间隔 + 窗口频率上限。
 *
 * 三条护栏都是**进程级单例**，且没有任何开关能关掉：
 *   - 串行：同一时刻只允许一次 discuss 在跑，其余立即拿 busy；
 *   - 最小间隔：上一次结束后至少等待 minGapMs + 随机抖动；
 *   - 频率上限：windowMs 内最多 windowLimit 次。
 *
 * 护栏只在插件进程内生效，不依赖浏览器、不依赖外部服务。
 */

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new Error('aborted'));
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener?.('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(new Error('aborted'));
  };
  signal?.addEventListener?.('abort', onAbort, { once: true });
});

export class Guard {
  /** @param {ReturnType<import('./config.js').resolveConfig>} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.busy = false;
    this.lastFinishedAt = 0;
    this.history = [];
    this.total = 0;
    this.rejectedBusy = 0;
    this.rejectedRate = 0;
    this.startedAt = 0;
  }

  prune(now) {
    const from = now - this.cfg.windowMs;
    this.history = this.history.filter((t) => t >= from);
  }

  /** 只读快照，给 status 用。 */
  snapshot() {
    const now = Date.now();
    this.prune(now);
    return {
      serial: true,
      busy: this.busy,
      minGapMs: this.cfg.minGapMs,
      jitterMs: this.cfg.jitterMs,
      windowMs: this.cfg.windowMs,
      windowLimit: this.cfg.windowLimit,
      windowUsed: this.history.length,
      lastFinishedAt: this.lastFinishedAt ? new Date(this.lastFinishedAt).toISOString() : null,
      totalCalls: this.total,
      rejectedBusy: this.rejectedBusy,
      rejectedRate: this.rejectedRate,
    };
  }

  /**
   * 申请一次写操作许可。
   *
   * 注意：间隔等待期间若被取消（signal.aborted），必须把 busy 标志还回去，
   * 否则一次被取消的调用会把护栏永久卡在 busy，后面所有调用都拿 busy。
   *
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<{ ok: true, waitedMs: number } | { ok: false, code: 'busy' | 'rate_limited' | 'failed', reason: string, retryAfterMs?: number, guardrails: object }>}
   */
  async acquire(options = {}) {
    const signal = options.signal;
    const now = Date.now();
    if (this.busy) {
      this.rejectedBusy += 1;
      return {
        ok: false,
        code: 'busy',
        reason: 'discussion_in_progress',
        guardrails: this.snapshot(),
      };
    }
    this.prune(now);
    if (this.history.length >= this.cfg.windowLimit) {
      this.rejectedRate += 1;
      const oldest = this.history[0] ?? now;
      return {
        ok: false,
        code: 'rate_limited',
        reason: 'window_limit_reached',
        retryAfterMs: Math.max(1000, oldest + this.cfg.windowMs - now),
        guardrails: this.snapshot(),
      };
    }

    this.busy = true;
    const jitter = Math.floor(Math.random() * (this.cfg.jitterMs + 1));
    const since = this.lastFinishedAt ? now - this.lastFinishedAt : Number.POSITIVE_INFINITY;
    const need = this.cfg.minGapMs + jitter;
    const waitedMs = Number.isFinite(since) && since < need ? need - since : 0;
    if (waitedMs > 0) {
      try {
        await sleep(waitedMs, signal);
      } catch {
        // 等待期间被取消：还回许可，本次不计入配额。
        this.busy = false;
        return {
          ok: false,
          code: 'failed',
          reason: 'aborted_while_waiting',
          guardrails: this.snapshot(),
        };
      }
    }
    if (signal?.aborted) {
      this.busy = false;
      return {
        ok: false,
        code: 'failed',
        reason: 'aborted_while_waiting',
        guardrails: this.snapshot(),
      };
    }

    this.total += 1;
    this.startedAt = Date.now();
    this.history.push(this.startedAt);
    return { ok: true, waitedMs };
  }

  /** 释放许可并记账。 */
  release() {
    this.busy = false;
    this.lastFinishedAt = Date.now();
  }
}
