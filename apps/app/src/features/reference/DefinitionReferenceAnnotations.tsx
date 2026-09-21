import type {
  DefinitionReferenceAnnotation,
  DefinitionReferenceAnnotationPage,
  DefinitionReferenceReply,
  DefinitionReferenceRequest,
  MedicalCore,
} from '@localmed/contracts';
import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

export function DefinitionReferenceAnnotations(props: {
  readonly core: MedicalCore;
  readonly moduleId: string;
  readonly editionId: string;
  readonly entryId: string;
}): JSX.Element {
  const [opened, setOpened] = createSignal(false);
  const [page, setPage] = createSignal<DefinitionReferenceAnnotationPage>({ items: [], next: null });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [provenance, setProvenance] = createSignal<unknown>();
  let generation = 0;
  onCleanup(() => { generation += 1; });
  const request = async (value: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> => {
    const api = props.core.reference;
    if (!api) throw new Error('Чтение пояснений недоступно.');
    const reply = await api.call(props.core, value);
    if (!reply.ok || reply.value.op === 'unavailable') throw new Error('Редакция справочника больше не доступна.');
    return reply.value;
  };
  const scope = () => ({ moduleId: props.moduleId, editionId: props.editionId });
  const load = async (after?: string) => {
    const token = ++generation;
    setBusy(true); setError(undefined); setProvenance(undefined);
    try {
      const reply = await request({ ...scope(), op: 'annotations', id: props.entryId, ...(after ? { after } : {}) });
      if (reply.op !== 'annotations') throw new Error('Некорректная страница пояснений.');
      if (token === generation) setPage(reply.page);
    } catch {
      if (token === generation) setError('Не удалось прочитать пояснения. Определение остаётся доступным.');
    } finally {
      if (token === generation) setBusy(false);
    }
  };
  createEffect(() => {
    props.core; props.moduleId; props.editionId; props.entryId;
    generation += 1;
    setPage({ items: [], next: null }); setProvenance(undefined); setError(undefined); setBusy(false);
    if (opened()) void load();
  });
  const showSource = async (item: DefinitionReferenceAnnotation) => {
    const token = ++generation;
    const selected = scope();
    const entryId = props.entryId;
    setBusy(true); setError(undefined); setProvenance(undefined);
    try {
      const source = await request({ ...selected, op: 'source', id: item.sourceId });
      const block = await request({ ...selected, op: 'text', id: entryId, chunkId: item.chunkId });
      if (source.op !== 'source' || !source.source || block.op !== 'text' || !block.block || block.block.sourceId !== item.sourceId) throw new Error('Source binding unavailable');
      if (token === generation) setProvenance({ source: source.source, locator: block.block.provenance, span: { start: item.start, end: item.end, units: 'Unicode code points' } });
    } catch {
      if (token === generation) setError('Не удалось подтвердить источник этого пояснения.');
    } finally {
      if (token === generation) setBusy(false);
    }
  };
  return (
    <details class="reference-annotations" onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary class="reference-annotations__summary">Происхождение и исторические упоминания</summary>
      <Show when={opened()}>
        <p class="reference-annotations__notice">Дословные пояснения из связанных фрагментов источника. Требуют проверки; упоминание фамилии не устанавливает личность или приоритет открытия.</p>
        <Show when={!busy() && !error() && page().items.length === 0}>
          <p class="reference-annotations__notice">В этой редакции нет привязанных пояснений.</p>
        </Show>
        <For each={page().items}>{(item) => (
          <article class="reference-annotations__item">
            <h4 class="reference-annotations__title">{item.kind === 'etymology' ? 'Происхождение: текст источника' : `Имя в источнике: ${item.label}`}</h4>
            <blockquote class="reference-annotations__statement">{item.statement}</blockquote>
            <button class="package-row__button" type="button" disabled={busy()} onClick={() => void showSource(item)}>Источник пояснения</button>
          </article>
        )}</For>
        <Show when={page().next}>{(next) => <button class="package-row__button" type="button" disabled={busy()} onClick={() => void load(next())}>Следующие пояснения</button>}</Show>
        <Show when={provenance()}><pre class="reference-card__metadata">{JSON.stringify(provenance(), null, 2)}</pre></Show>
        <Show when={busy()}><p class="reference-annotations__notice" role="status">Читаем пояснения…</p></Show>
        <Show when={error()}>{(message) => <p class="package-row__error" role="alert">{message()} <button class="package-row__button" type="button" disabled={busy()} onClick={() => void load()}>Повторить</button></p>}</Show>
      </Show>
    </details>
  );
}
