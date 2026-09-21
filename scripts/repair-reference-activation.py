"""Temporary exact edits for failures observed in real browser run 35665329544."""
from pathlib import Path


def edit(name: str, pairs: list[tuple[str, str]]) -> None:
    path = Path(name)
    text = path.read_text()
    for before, after in pairs:
        if text.count(before) != 1:
            raise ValueError('Activation anchor changed: ' + name + ': ' + before[:100])
        text = text.replace(before, after)
    path.write_text(text)


edit('apps/app/src/app/use-app-session.ts', [
    ('  const reconnectInstalledModules = async (): Promise<void> => {', '''  const createSessionCore = () => createBrowserCore({
    requestDownload: (resuming) => new Promise<void>((resolve, reject) => {
      if (ready()) {
        reject(new Error('Установленное ядро больше не доступно. Перезапустите приложение для повторной загрузки.'));
        return;
      }
      setCoreDownloadRequired(true);
      if (resuming) { setCoreDownloading(true); resolve(); }
      else beginCoreDownload = resolve;
    }),
    onProgress: setCoreProgress,
  });

  const reconnectInstalledModules = async (): Promise<void> => {'''),
    ('swapMedicalCore(current, createBrowserCore, (core)', 'swapMedicalCore(current, createSessionCore, (core)'),
    ('''    const initializedPromise = initializeMedicalCore(() =>
      createBrowserCore({
        requestDownload: (resuming) =>
          new Promise<void>((resolve) => {
            setCoreDownloadRequired(true);
            if (resuming) {
              setCoreDownloading(true);
              resolve();
            } else {
              beginCoreDownload = resolve;
            }
          }),
        onProgress: setCoreProgress,
      }),
    );''', '    const initializedPromise = initializeMedicalCore(createSessionCore);'),
])

edit('apps/app/src/features/reference/DefinitionReferencePanel.tsx', [
    ('  const [busy, setBusy] = createSignal(false);', '  const [busy, setBusy] = createSignal(false);\n  const [connected, setConnected] = createSignal(false);'),
    ('''    props.core;
    selected()?.id;
    selected()?.version;
    generation += 1;''', '''    const activeCore = props.core;
    const module = selected();
    generation += 1;'''),
    ('''    setBusy(false);
  });
  const request''', '''    setBusy(false);
    setConnected(false);
    if (!module?.definitionReference) return;
    if (!activeCore.reference) {
      setError('Справочник недоступен в этом варианте хранилища.');
      return;
    }
    const token = generation;
    const descriptor = module.definitionReference;
    // Registry completion precedes swapping the active MedicalCore. Do not enable lookup on
    // the old owner or clear a user's just-submitted query when the new core becomes ready.
    void activeCore.reference({ op: 'status', moduleId: module.id, editionId: descriptor.editionId }).then((result) => {
      if (token !== generation) return;
      if (!result.ok) { setError(result.error.message); return; }
      if (result.value.op === 'unavailable') return;
      if (result.value.op !== 'status' || result.value.editionId !== descriptor.editionId || result.value.entries !== descriptor.entries) {
        setError('Установленная редакция справочника не совпадает с ожидаемой.');
        return;
      }
      setConnected(true);
    }, () => { if (token === generation) setError('Не удалось подключить установленный справочник.'); });
  });
  const request'''),
    ('if (!module?.definitionReference || busy()) return;', 'if (!module?.definitionReference || !connected() || busy()) return;'),
    ('disabled={busy() || !query().trim()}', 'disabled={busy() || !connected() || !query().trim()}'),
    ('      <Show when={busy()}>', '''      <Show when={available().length > 0 && !connected() && !error()}>
        <p class="reference-panel__description" role="status">Подключаем установленный справочник к поиску…</p>
      </Show>
      <Show when={busy()}>'''),
])
