/**
 * Keeps one rendered value per key while at least one place shows it. A list that moves an item
 * from one parent to another (a card crossing virtualized grid rows) releases it in the old place
 * and acquires it in the new one within the same update; eviction waits for a scheduled check, so
 * the value — a DOM node with its state — survives the move instead of being rebuilt.
 */
export class RetainedNodeCache<K, V> {
  private readonly entries = new Map<
    K,
    { readonly value: V; readonly dispose: () => void; mounts: number }
  >();

  constructor(
    private readonly create: (key: K) => { readonly value: V; readonly dispose: () => void },
    private readonly schedule: (task: () => void) => void = (task) => queueMicrotask(task),
  ) {}

  acquire(key: K): V {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { ...this.create(key), mounts: 0 };
      this.entries.set(key, entry);
    }
    entry.mounts += 1;
    return entry.value;
  }

  release(key: K): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.mounts -= 1;
    if (entry.mounts > 0) return;
    this.schedule(() => {
      if (entry.mounts > 0 || this.entries.get(key) !== entry) return;
      this.entries.delete(key);
      entry.dispose();
    });
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.dispose();
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
