const MAX_CONCURRENT = 2;

class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const dbSemaphore = new Semaphore(MAX_CONCURRENT);

export async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  return dbSemaphore.run(fn);
}

export async function throttledAll<T>(fns: Array<() => Promise<T>>): Promise<T[]> {
  return Promise.all(fns.map((fn) => throttled(fn)));
}
