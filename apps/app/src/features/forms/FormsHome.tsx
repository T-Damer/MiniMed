import { For, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { displayDate } from '@/features/forms/form-print';
import { listFormSchemas } from '@/features/forms/form-registry';
import { notesFormsPath, notesPath, notesPatientsPath } from '@/features/notes/notes-routing';
import { getPluralMessage } from '@/i18n/browser-i18n';
import '@/styles/forms.css';

export function FormsHome(props: {
  readonly backLabel: string;
  readonly patientId?: string | undefined;
  readonly episodeId?: string | undefined;
  readonly onNavigate: (path: string) => void;
}): JSX.Element {
  return (
    <section class="forms-workspace" aria-label="Формы">
      <header class="forms-workspace__chrome">
        <NavBack
          class="forms-workspace__back knowledge-back-button"
          aria-label={props.patientId ? 'К карточке пациента' : props.backLabel}
          onClick={() =>
            props.onNavigate(props.patientId ? notesPatientsPath(props.patientId) : notesPath())
          }
        />
      </header>
      <Page
        icon={<AppGlyph name="file-text" class="page__icon-glyph" />}
        title={<Heading depth={1}>Формы</Heading>}
        description="Официальные учётные формы Минздрава. Заполняются по данным карточки пациента и профиля «Врач и организация»; печатаются для подписи и печати."
      />
      <div class="forms-home__list">
        <For each={listFormSchemas()}>
          {(schema) => (
            <article class="forms-home__card paper-card">
              <div class="forms-home__card-head">
                <span class="forms-home__number">Форма № {schema.formNumber}</span>
                <span class="forms-home__count">
                  {getPluralMessage('forms_field_count', schema.fields.length)}
                </span>
              </div>
              <Heading depth={2} class="forms-home__title">
                {schema.title}
              </Heading>
              <p class="forms-home__edition">
                Приказ Минздрава России от {displayDate(schema.source.orderDate)} №{' '}
                {schema.source.orderNumber}, зарегистрирован Минюстом{' '}
                {displayDate(schema.source.registration.date)} № {schema.source.registration.number}
                . Действует с {displayDate(schema.source.effectiveFrom)}.
              </p>
              <div class="forms-home__actions">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() =>
                    props.onNavigate(
                      notesFormsPath(schema.id, {
                        ...(props.patientId ? { patientId: props.patientId } : {}),
                        ...(props.episodeId ? { episodeId: props.episodeId } : {}),
                      }),
                    )
                  }
                >
                  Заполнить форму
                </Button>
                <a
                  class="forms-home__source"
                  href={schema.source.publicationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Официальная публикация
                </a>
              </div>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}
