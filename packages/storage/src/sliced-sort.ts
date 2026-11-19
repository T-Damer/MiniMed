/**
 * A stable sort that gives the thread back while it runs.
 *
 * The combined store sorts every alias and every document title of the mounted modules with a
 * locale-aware comparison: with the drug packs installed that is hundreds of thousands of strings,
 * and in one piece it held a phone's main thread for seconds at each core build (performance log
 * 0.6.106). The result is exactly the one of `items.toSorted(compare)`: runs of the input are
 * sorted on their own and merged pairwise, left before right on ties.
 */
const RUN_LENGTH = 1024;
/** A pending tap or frame gets the thread within this many milliseconds. */
const SLICE_MS = 8;

function nextTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Gives input and paint a chance to run between batches of store records. */
export function createStorageTimeSlicer(budgetMs: number): () => Promise<void> | undefined {
  let startedAt = performance.now();
  return () => {
    if (performance.now() - startedAt < budgetMs) return undefined;
    return nextTask().then(() => {
      startedAt = performance.now();
    });
  };
}

export async function stableSortSliced<T>(
  items: readonly T[],
  compare: (left: T, right: T) => number,
): Promise<T[]> {
  const pause = createStorageTimeSlicer(SLICE_MS);
  let runs: T[][] = [];
  for (let start = 0; start < items.length; start += RUN_LENGTH) {
    runs.push(items.slice(start, start + RUN_LENGTH).sort(compare));
    await pause();
  }
  while (runs.length > 1) {
    const merged: T[][] = [];
    for (let index = 0; index < runs.length; index += 2) {
      const left = runs[index] as T[];
      const right = runs[index + 1];
      if (!right) {
        merged.push(left);
        continue;
      }
      const out: T[] = new Array(left.length + right.length);
      let l = 0;
      let r = 0;
      let o = 0;
      while (l < left.length && r < right.length) {
        // Ties take the left run first: the order of a stable sort.
        if (compare(right[r] as T, left[l] as T) < 0) out[o++] = right[r++] as T;
        else out[o++] = left[l++] as T;
        if ((o & 1023) === 0) await pause();
      }
      while (l < left.length) out[o++] = left[l++] as T;
      while (r < right.length) out[o++] = right[r++] as T;
      merged.push(out);
    }
    runs = merged;
  }
  return runs[0] ?? [];
}

/**
 * The last sorted result per purpose, kept while its inputs are the very same arrays: a core
 * rebuilt without a change in what is mounted (the stores hand out the same listings) does not
 * sort again.
 */
export class SortedListingMemo<T> {
  private last:
    | { readonly inputs: readonly (readonly T[])[]; readonly output: readonly T[] }
    | undefined;

  public find(inputs: readonly (readonly T[])[]): readonly T[] | undefined {
    const last = this.last;
    if (!last || last.inputs.length !== inputs.length) return undefined;
    return last.inputs.every((input, index) => input === inputs[index]) ? last.output : undefined;
  }

  public keep(inputs: readonly (readonly T[])[], output: readonly T[]): void {
    this.last = { inputs, output };
  }
}
