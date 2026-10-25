import type { MedicalDocument } from '@localmed/contracts';
import { For, type JSX, Show } from 'solid-js';

import { OverlayDialog } from '@/components/OverlayDialog';
import { documentEditionValue } from '@/features/library/document-version-label';
import { readerDocumentSource } from '@/features/library/reader-document-source';
import { readerAudience, readerMetaParts } from '@/features/library/reader-meta-line';
import { DrugReferenceFooter } from '@/features/medications/DrugReferenceFooter';
import type { InstructionSourceInfo } from '@/features/medications/instruction-source';
import type { RegistrationRow } from '@/features/medications/substance-reading';
import { pluralRu } from '@/i18n/labels';

import './document-info-dialog.css';

function statusLabel(status: string): string | null {
  if (status === 'active' || status === 'current') return 'Действующая редакция';
  if (status === 'superseded') return 'Заменённая редакция';
  if (status === 'historical') return 'Исторический документ';
  return null;
}

/**
 * «⋯» → «Информация» of a reader (owner 2026-10-20): what the document is, its edition and status,
 * where its text comes from and — on a drug card — the registrations, one short line each. None of
 * this sits on the page, which shows the subject only.
 */
export function DocumentInfoDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly document: MedicalDocument;
  readonly drugSources?: readonly string[];
  readonly instruction?: InstructionSourceInfo | null;
  readonly registrations?: readonly RegistrationRow[];
}): JSX.Element {
  const rows = (): readonly (readonly [string, string])[] => {
    const kind = readerMetaParts(props.document)[0];
    const edition = documentEditionValue(props.document.versionLabel);
    const status = statusLabel(props.document.status);
    const audience = readerAudience(props.document);
    return [
      ...(kind ? [['Вид', kind] as const] : []),
      ...(edition ? [['Редакция', edition] as const] : []),
      ...(status ? [['Статус', status] as const] : []),
      ...(audience ? [['Для кого', audience] as const] : []),
    ];
  };
  // A drug card names its sources in DrugReferenceFooter; every other document gets one row here.
  const source = () =>
    (props.drugSources?.length ?? 0) > 0 || props.instruction
      ? null
      : readerDocumentSource(props.document);
  const registrations = () => props.registrations ?? [];
  return (
    <OverlayDialog
      open={props.open}
      title="Информация"
      class="document-info"
      onClose={props.onClose}
    >
      <dl class="document-info__list">
        <For each={rows()}>
          {([term, value]) => (
            <div class="document-info__row">
              <dt class="document-info__term">{term}</dt>
              <dd class="document-info__value">{value}</dd>
            </div>
          )}
        </For>
        <Show when={source()}>
          {(value) => (
            <>
              <div class="document-info__row">
                <dt class="document-info__term">Источник</dt>
                <dd class="document-info__value">
                  <Show when={value().url} fallback={value().name}>
                    {(url) => (
                      <a class="document-info__link" href={url()} rel="noreferrer" target="_blank">
                        {value().name}
                      </a>
                    )}
                  </Show>
                </dd>
              </div>
              <Show when={value().fetchedOn}>
                {(date) => (
                  <div class="document-info__row">
                    <dt class="document-info__term">Получено</dt>
                    <dd class="document-info__value">{date()}</dd>
                  </div>
                )}
              </Show>
            </>
          )}
        </Show>
      </dl>
      <DrugReferenceFooter
        sources={props.drugSources ?? []}
        instruction={props.instruction ?? null}
      />
      <Show when={registrations().length > 0}>
        <section class="document-info__registrations" aria-labelledby="document-info-registrations">
          <h3 class="document-info__heading" id="document-info-registrations">
            {registrations().length}{' '}
            {pluralRu(registrations().length, 'регистрация', 'регистрации', 'регистраций')}
          </h3>
          <ul class="document-info__registration-list" data-testid="drug-registrations">
            <For each={registrations()}>
              {(row) => (
                <li class="document-info__registration">
                  <span class="document-info__registration-name">{row.name}</span>
                  <Show when={row.forms}>
                    {(forms) => <span class="document-info__registration-forms"> — {forms()}</span>}
                  </Show>
                  <span class="document-info__registration-meta">
                    {[row.holder, row.registrationNumber].filter(Boolean).join(' · ')}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </OverlayDialog>
  );
}
