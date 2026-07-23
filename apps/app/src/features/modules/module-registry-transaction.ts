import type {
  InstalledModuleRegistrySnapshot,
  PersistentInstalledModuleRegistry,
} from '@localmed/storage';

function asError(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error('Неизвестная ошибка хранилища модулей.', { cause });
}

export async function commitRegistryAndArtifactMutation<T>(
  registry: PersistentInstalledModuleRegistry,
  mutateRegistry: () => T,
  mutateArtifacts: (result: T) => Promise<void>,
): Promise<T> {
  const snapshot: InstalledModuleRegistrySnapshot = registry.snapshot();
  const result = mutateRegistry();
  try {
    await mutateArtifacts(result);
    return result;
  } catch (cause) {
    const artifactError = asError(cause);
    try {
      registry.restoreSnapshot(snapshot);
    } catch (restoreCause) {
      const restoreError = asError(restoreCause);
      throw new Error(
        `Не удалось согласовать реестр и файлы модулей: ${artifactError.message}; восстановление реестра также не выполнено: ${restoreError.message}`,
        { cause: restoreError },
      );
    }
    throw artifactError;
  }
}
