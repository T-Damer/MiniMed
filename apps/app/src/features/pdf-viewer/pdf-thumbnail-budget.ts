/**
 * Memory cap for page thumbnails. Every drawn thumbnail reports its pixel size; once the total is
 * over budget the ones that were visible longest ago and are not on screen now are released (the
 * owner clears its canvas and redraws on demand).
 */

export interface ThumbnailBudgetEntry {
  readonly bytes: number;
  readonly release: () => void;
}

export class ThumbnailBudget {
  private readonly maxBytes: number;
  private readonly entries = new Map<number, ThumbnailBudgetEntry>();
  private readonly visible = new Set<number>();

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  get totalBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.bytes;
    return total;
  }

  get size(): number {
    return this.entries.size;
  }

  has(page: number): boolean {
    return this.entries.has(page);
  }

  /** Marks a page as on screen (never released) or off screen (eligible, newest-used last). */
  setVisible(page: number, visible: boolean): void {
    if (visible) {
      this.visible.add(page);
      this.touch(page);
    } else {
      this.visible.delete(page);
      this.touch(page);
      this.evict();
    }
  }

  /** Records a drawn thumbnail. */
  add(page: number, entry: ThumbnailBudgetEntry): void {
    this.entries.delete(page);
    this.entries.set(page, entry);
    this.evict();
  }

  remove(page: number): void {
    this.entries.delete(page);
    this.visible.delete(page);
  }

  clear(): void {
    this.entries.clear();
    this.visible.clear();
  }

  private touch(page: number): void {
    const entry = this.entries.get(page);
    if (!entry) return;
    this.entries.delete(page);
    this.entries.set(page, entry);
  }

  private evict(): void {
    if (this.totalBytes <= this.maxBytes) return;
    // Map iteration order is insertion order, so the least recently used page comes first.
    for (const [page, entry] of [...this.entries]) {
      if (this.totalBytes <= this.maxBytes) return;
      if (this.visible.has(page)) continue;
      this.entries.delete(page);
      entry.release();
    }
  }
}
