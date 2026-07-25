type ReleaseContentSlot = () => void;
type DownloadCoordinatorListener = () => void;

class DownloadCoordinator {
  private contentSlots = 0;
  private readonly contentIdleWaiters = new Set<() => void>();
  private readonly listeners = new Set<DownloadCoordinatorListener>();

  public subscribe(listener: DownloadCoordinatorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public hasActiveContentDownloads(): boolean {
    return this.contentSlots > 0;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  public beginContentDownload(): ReleaseContentSlot {
    this.contentSlots += 1;
    this.notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.contentSlots = Math.max(0, this.contentSlots - 1);
      this.notify();
      if (this.contentSlots === 0) {
        for (const release of this.contentIdleWaiters) release();
        this.contentIdleWaiters.clear();
      }
    };
  }

  public waitForContentIdle(): Promise<void> {
    if (this.contentSlots === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const release = (): void => {
        this.contentIdleWaiters.delete(release);
        resolve();
      };
      this.contentIdleWaiters.add(release);
    });
  }

  public async waitForContentIdleWhile(
    shouldContinue: () => boolean,
    pollIntervalMs = 250,
  ): Promise<void> {
    while (shouldContinue() && this.contentSlots > 0) {
      await Promise.race([
        this.waitForContentIdle(),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, pollIntervalMs);
        }),
      ]);
    }
  }
}

export const downloadCoordinator = new DownloadCoordinator();
