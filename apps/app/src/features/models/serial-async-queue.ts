export class SerialAsyncQueue {
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  public run<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Очередь локальной модели закрыта.'));
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public async close(): Promise<void> {
    this.closed = true;
    await this.tail;
  }
}
