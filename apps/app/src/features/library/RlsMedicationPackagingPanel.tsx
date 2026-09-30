import type { MedicalDocument } from '@localmed/contracts';
import { createMemo, For, type JSX, Show } from 'solid-js';
import { Disclosure } from '@/components/Disclosure';
import { rlsMedicationPackagingLinks } from '@/features/library/rls-medication-packaging';
import { openDocumentOverlay } from '@/state/document-navigation';
import { buildOfficialDocumentHash } from '@/state/document-route';
import '@/features/library/rls-medication-packaging.css';

export function RlsMedicationPackagingPanel(props: {
  readonly document: MedicalDocument;
}): JSX.Element {
  const links = createMemo(() => rlsMedicationPackagingLinks(props.document));
  return (
    <Show when={links().length > 0}>
      <Disclosure class="rls-medication-packaging" title="Упаковки препаратов на странице РЛС">
        <p class="rls-medication-packaging__note">
          Справочный список источника, не рекомендация по лечению. Полные таблицы находятся в
          отдельном наборе РЛС.
        </p>
        <ul class="rls-medication-packaging__list">
          <For each={links()}>
            {(link) => (
              <li class="rls-medication-packaging__item">
                <a
                  class="rls-medication-packaging__link"
                  href={buildOfficialDocumentHash(link.packagingDocumentId)}
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    openDocumentOverlay(link.packagingDocumentId);
                  }}
                >
                  {link.name} — формы и упаковки
                </a>
              </li>
            )}
          </For>
        </ul>
      </Disclosure>
    </Show>
  );
}
