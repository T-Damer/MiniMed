import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { PATIENT_NOTES_EVENT, searchPatientNotes } from '@/state/patient-notes';

interface PersonalNoteMatchesProps {
  readonly query: string;
}

/**
 * Personal note hits for the active query.
 *
 * Rendered outside the official results container on purpose: a personal record must never be able to
 * pass as an installed source, in the DOM or on screen.
 */
export function PersonalNoteMatches(props: PersonalNoteMatchesProps): JSX.Element {
  const [revision, setRevision] = createSignal(0);
  const bump = (): void => {
    setRevision((current) => current + 1);
  };

  onMount(() => window.addEventListener(PATIENT_NOTES_EVENT, bump));
  onCleanup(() => window.removeEventListener(PATIENT_NOTES_EVENT, bump));

  const matches = createMemo(() => {
    revision();
    const trimmed = props.query.trim();
    return trimmed.length > 1 ? searchPatientNotes(trimmed) : [];
  });

  return (
    <Show when={matches().length > 0}>
      <section class="personal-note-matches" aria-label="Совпадения в личных заметках">
        <header>
          <span class="personal-note-badge">Личные записи</span>
          <small>Не официальный источник. Только на этом устройстве.</small>
        </header>
        <ul>
          <For each={matches()}>
            {(match) => (
              <li>
                <strong>{match.card.title}</strong>
                <p>{match.snippet}</p>
                <Show when={match.note === null}>
                  <small>Совпадение в описании карточки</small>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <button
          type="button"
          onClick={() => {
            window.location.hash = '#/notes';
          }}
        >
          Открыть заметки
        </button>
      </section>
    </Show>
  );
}
