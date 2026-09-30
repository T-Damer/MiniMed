import type { CoreIdentityHit, MedicalCore } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import { assertIdentityDocumentTarget } from '@/features/modules/module-pointer-install';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import { DefinitionReferencePanel } from '@/features/reference/DefinitionReferencePanel';
import { coreIdentityModule } from '@/features/search/core-identity-navigation';
import { subscribeAppPreferences } from '@/state/app-preferences';
import { openDocumentOverlay } from '@/state/document-navigation';
import '@/features/search/core-identity-matches.css';

export function CoreIdentityMatches(props: {
  readonly hits: readonly CoreIdentityHit[];
  readonly core: MedicalCore;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const [catalog] = createResource(loadModuleCatalog);
  const runtime = createMemo(() => {
    const value = catalog();
    return value ? getContentModuleRuntime(value) : undefined;
  });
  const [revision, setRevision] = createSignal(0);
  const [selected, setSelected] = createSignal<CoreIdentityHit>();
  const [opening, setOpening] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const refresh = () => setRevision((value) => value + 1);
  onCleanup(subscribeAppPreferences(refresh));
  createEffect(() => {
    const value = runtime();
    if (value) onCleanup(value.subscribe(refresh));
  });
  const moduleFor = (hit: CoreIdentityHit) => {
    revision();
    const value = runtime();
    return value ? coreIdentityModule(hit, value.getCatalog(), value.listInstalled()) : undefined;
  };
  const open = async (hit: CoreIdentityHit) => {
    if (!moduleFor(hit) || opening()) return;
    setError(undefined);
    if (hit.target.type === 'definition') {
      setSelected(hit);
      return;
    }
    setOpening(true);
    try {
      const target = hit.target;
      const local = await props.core.getDocument(target.documentId);
      if (disposed) return;
      if (local.ok) {
        assertIdentityDocumentTarget(local.value, target);
      } else if (local.error.code !== 'CONTENT_NOT_FOUND') {
        throw new Error(local.error.message);
      }
      openDocumentOverlay(target.documentId, target.anchor, {
        preferSummary: true,
        expectedIdentity: target,
      });
    } catch (cause) {
      if (!disposed)
        setError(cause instanceof Error ? cause.message : 'Не удалось открыть запись.');
    } finally {
      if (!disposed) setOpening(false);
    }
  };
  return (
    <section class="core-identity-matches" aria-label="Точные названия в источниках">
      <For each={props.hits}>
        {(hit) => (
          <article class="core-identity-matches__card">
            <h3 class="core-identity-matches__title">{hit.title}</h3>
            <Show when={hit.name !== hit.title}>
              <p class="core-identity-matches__note">Название в источнике: {hit.name}</p>
            </Show>
            <p class="core-identity-matches__note">
              {hit.coverage === 'needs-definition'
                ? 'Название сохранено; определение ещё требуется.'
                : hit.coverage === 'mention-only'
                  ? 'Упоминание в источнике.'
                  : 'Запись исходного материала.'}
            </p>
            <p class="core-identity-matches__note">
              {moduleFor(hit)?.title ??
                (catalog.loading
                  ? 'Проверяем доступный набор…'
                  : 'Эта редакция набора сейчас недоступна.')}
            </p>
            <Button
              variant="secondary"
              disabled={!moduleFor(hit) || opening()}
              onClick={() => void open(hit)}
            >
              Открыть запись
            </Button>
          </article>
        )}
      </For>
      <Show when={catalog.error}>
        <p class="core-identity-matches__note" role="alert">
          Не удалось прочитать каталог наборов.
        </p>
      </Show>
      <Show when={error()}>
        {(message) => (
          <p class="core-identity-matches__note" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={selected()}>
        {(hit) => {
          const target = hit().target;
          if (target.type !== 'definition') return null;
          return (
            <OverlayDialog open title={hit().title} onClose={() => setSelected(undefined)}>
              <DefinitionReferencePanel
                core={props.core}
                onContentChanged={props.onContentChanged}
                catalog={runtime()?.getCatalog()}
                initialCard={{
                  id: target.entityId,
                  moduleId: target.moduleId,
                  moduleVersion: target.moduleVersion,
                  editionId: target.editionId,
                }}
              />
            </OverlayDialog>
          );
        }}
      </Show>
    </section>
  );
}
