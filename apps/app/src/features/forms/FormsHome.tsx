import { For, type JSX } from 'solid-js';

import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { displayDate } from '@/features/forms/form-print';
import { listFormSchemas } from '@/features/forms/form-registry';
import { localToday, orderReference, validityLine } from '@/features/forms/form-source-line';
import { notesFormsPath, notesPath, notesPatientsPath } from '@/features/notes/notes-routing';
import '@/styles/forms.css';

export function FormsHome(props: {
  readonly backLabel: string;
  readonly patientId?: string | undefined;
  readonly episodeId?: string | undefined;
  readonly onNavigate: (path: string) => void;
}): JSX.Element {
  return (
    <section class="forms-workspace" aria-label="Формы">
      <Page
        navigation={
          <NavBack
            class="knowledge-back-button"
            aria-label={props.patientId ? 'К карточке пациента' : props.backLabel}
            onClick={() =>
              props.onNavigate(props.patientId ? notesPatientsPath(props.patientId) : notesPath())
            }
          />
        }
        title={<Heading depth={1}>Формы</Heading>}
        help={
          <>
            <p>Официальные учётные формы Минздрава.</p>
            <p>
              Заполняются по данным карточки пациента и профиля «Врач и организация»; печатаются для
              подписи и печати.
            </p>
          </>
        }
        helpTitle="О формах"
      />
      <div class="forms-home__list">
        <For each={listFormSchemas()}>
          {(schema) => (
            <article class="forms-home__card paper-card">
              <span class="forms-home__number">Форма № {schema.formNumber}</span>
              <Heading depth={2} class="forms-home__title">
                {schema.title}
              </Heading>
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
              </div>
              <p class="forms-home__edition">
                {orderReference(schema.source)}, зарегистрирован Минюстом{' '}
                {displayDate(schema.source.registration.date)} № {schema.source.registration.number}
                . {validityLine(schema.source, localToday())}{' '}
                <a
                  class="forms-home__source"
                  href={schema.source.publicationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Официальная публикация
                </a>
              </p>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}
