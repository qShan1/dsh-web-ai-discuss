/**
 * ego 空间互斥锁。
 *
 * 与护栏（Guard）是两件事，别混：
 *   - Guard 管**写操作的节奏**（串行 / 最小间隔 / 频率上限），只约束 discuss。
 *   - Mutex 管**ego 空间的独占**：同一时刻只允许一个 ego 子进程在动这个空间。
 *
 * 为什么需要它：discuss、read_discussion(live)、status(probe) 都要在同一个
 * ego TaskSpace 里跑脚本。它们可能抢同一个 page（acquirePage 拿到同一个 p1），
 * 并发执行会互相打断——例如 probe 在 discuss 发送途中把页面导航走，
 * 或者两个脚本同时 evaluate 同一个虚拟列表，读到错乱的计数。
 */

/** 同步取锁的互斥锁（不排队，锁被占时立刻失败）。 */
export class Mutex {
  constructor() {
    this.locked = false;
    this.holder = null;
  }

  /**
   * 尝试取锁。
   * @param {string} holder 持有者标识（用于日志与 status 展示）
   * @returns {boolean} 是否取到
   */
  tryAcquire(holder) {
    if (this.locked) return false;
    this.locked = true;
    this.holder = holder;
    return true;
  }

  release() {
    this.locked = false;
    this.holder = null;
  }

  snapshot() {
    return { locked: this.locked, holder: this.holder };
  }
}
