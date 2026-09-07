import { getDownloadQueue } from './download-service';

/** Revalidate durable logical intentions against compiled catalogs; never replay stored URLs. */
export async function restoreDownloadIntents(): Promise<void> {
  const queue = getDownloadQueue();
  const tasks = queue
    .list()
    .filter((task) => task.resume && ['interrupted', 'failed', 'cancelled'].includes(task.state));
  for (const task of tasks) {
    const recipe = task.resume;
    if (!recipe) continue;
    let restore: (() => Promise<unknown>) | undefined;
    if (recipe.kind === 'reference-images') {
      const images = await import('@/features/library/reference-image-assets');
      if (
        task.id === images.REFERENCE_IMAGES_DOWNLOAD_ID &&
        recipe.id === task.id &&
        recipe.version === images.REFERENCE_IMAGE_MANIFEST_SHA256
      ) {
        restore = () =>
          images
            .getReferenceImageResolver()
            .downloadAll(new AbortController().signal, () => undefined);
      }
    } else if (recipe.kind === 'ecg-package') {
      const ecg = await import('@/features/calculators/ecg-package');
      if (
        task.id === ecg.ECG_DOWNLOAD_ID &&
        recipe.id === task.id &&
        recipe.version === ecg.ECG_DOWNLOAD_VERSION
      ) {
        restore = () => ecg.installEcgPackage(new AbortController().signal, () => undefined);
      }
    } else if (recipe.kind === 'speech') {
      const [asr, protocol] = await Promise.all([
        import('@/features/asr/asr-models'),
        import('@/features/asr/asr-download-protocol'),
      ]);
      if (
        task.id === protocol.asrDownloadId(recipe.id) &&
        recipe.version === protocol.ASR_DOWNLOAD_VERSION &&
        asr.ASR_MODELS.some((model) => model.id === recipe.id && model.runtimeReady)
      ) {
        restore = () => asr.activateAsrModel(recipe.id);
      }
    }
    if (!restore) {
      queue.rejectRestoration(task.id);
      continue;
    }
    queue.setRestorer(task.id, restore);
    if (task.state === 'interrupted' && queue.get(task.id)?.state === 'interrupted') {
      // Each job records its own error. One failed item must not prevent other owners restoring.
      void queue.retry(task.id).catch(() => {
        if (queue.get(task.id)?.state === 'interrupted') queue.rejectRestoration(task.id);
      });
    }
  }
}
