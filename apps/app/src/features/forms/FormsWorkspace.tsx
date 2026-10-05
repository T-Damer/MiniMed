import { type JSX, Show } from 'solid-js';

import { FormFillPage } from '@/features/forms/FormFillPage';
import { FormsHome } from '@/features/forms/FormsHome';
import { findFormSchema } from '@/features/forms/form-registry';
import type { NotesRoute } from '@/features/notes/notes-routing';
import { notesFormsPath } from '@/features/notes/notes-routing';

export type FormsRoute = Extract<NotesRoute, { kind: 'forms' | 'form' }>;

/** Routes «Формы»: the list of official forms and the filling screen of one of them. */
export function FormsWorkspace(props: {
  readonly route: FormsRoute;
  readonly onNavigate: (path: string) => void;
  readonly backLabel?: string;
}): JSX.Element {
  const schema = () =>
    props.route.kind === 'form' ? findFormSchema(props.route.formId) : undefined;
  return (
    <Show
      when={props.route.kind === 'form'}
      fallback={
        <FormsHome
          backLabel={props.backLabel ?? 'Назад к заметкам'}
          patientId={props.route.patientId}
          episodeId={props.route.episodeId}
          onNavigate={props.onNavigate}
        />
      }
    >
      <Show
        when={schema()}
        fallback={
          <section class="forms-workspace">
            <p class="forms-workspace__error" role="alert">
              Такой формы нет в приложении.
            </p>
            <button
              type="button"
              class="forms-workspace__reset"
              onClick={() => props.onNavigate(notesFormsPath())}
            >
              К списку форм
            </button>
          </section>
        }
      >
        {(form) => (
          <FormFillPage
            schema={form()}
            patientId={props.route.patientId}
            episodeId={props.route.episodeId}
            onNavigate={props.onNavigate}
          />
        )}
      </Show>
    </Show>
  );
}
