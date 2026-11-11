import { For, type JSX } from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';

import { ListGroup, ListRow } from '@/components/ListRow';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { listFormSchemas } from '@/features/forms/form-registry';
import { notesFormsPath, notesPath, notesPatientsPath } from '@/features/notes/notes-routing';
import '@/styles/forms.css';
import { navigateBack } from '@/state/app-back';

export function FormsHome(props: {
  readonly backLabel: string;
  readonly patientId?: string | undefined;
  readonly episodeId?: string | undefined;
  readonly onNavigate: (path: string) => void;
}): JSX.Element {
  return (
    <section class="forms-workspace" aria-label="Формы">
      <Page
        hero={PAGE_HEROES.forms}
        navigation={
          <NavBack
            class="knowledge-back-button"
            aria-label={props.patientId ? 'К карточке пациента' : props.backLabel}
            onClick={() =>
              navigateBack(props.patientId ? notesPatientsPath(props.patientId) : notesPath())
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
      <ListGroup class="forms-home__list" label="Формы">
        <For each={listFormSchemas()}>
          {(schema) => (
            <ListRow
              class="forms-home__card"
              icon="file-text"
              tone="blue"
              title={schema.title}
              subtitle={`Форма № ${schema.formNumber}`}
              onClick={() =>
                props.onNavigate(
                  notesFormsPath(schema.id, {
                    ...(props.patientId ? { patientId: props.patientId } : {}),
                    ...(props.episodeId ? { episodeId: props.episodeId } : {}),
                  }),
                )
              }
            />
          )}
        </For>
      </ListGroup>
    </section>
  );
}
