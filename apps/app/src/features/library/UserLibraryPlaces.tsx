import { For, type JSX, Show } from 'solid-js';

import { ListGroup, ListRow } from '@/components/ListRow';
import { computerPlaceTitle } from '@/features/library/ComputerFolderView';
import { computerFolderSupported } from '@/features/library/computer-folder';
import {
  type UserLibraryKindGroup,
  type UserLibraryPlace,
  userLibraryPlaceHash,
} from '@/features/library/user-library-places';

/**
 * The top of «Файлы» (owner 2026-11-11): where files are («Мой компьютер») and what they are
 * (one row per kind, with how many), above the folders. Sections without files are left out.
 */
export function UserLibraryPlaces(props: {
  readonly kinds: readonly { readonly group: UserLibraryKindGroup; readonly count: number }[];
  readonly onOpen: (hash: string) => void;
}): JSX.Element {
  const open = (place: UserLibraryPlace): void => props.onOpen(userLibraryPlaceHash(place));
  return (
    <div class="user-library-places">
      <ListGroup heading="Места" class="user-library-places__group">
        <ListRow
          class="user-library-places__computer"
          icon={computerFolderSupported() ? 'browsers' : 'device-mobile'}
          tone="blue"
          title={computerPlaceTitle()}
          subtitle={
            computerFolderSupported() ? 'Папка на этом компьютере' : 'Файлы из памяти телефона'
          }
          onClick={() => open({ kind: 'computer' })}
        />
      </ListGroup>
      <Show when={props.kinds.length > 0}>
        <ListGroup heading="По виду" class="user-library-places__group">
          <For each={props.kinds}>
            {(item) => (
              <ListRow
                class="user-library-places__kind"
                data-testid={`user-library-kind-${item.group.id}`}
                icon={item.group.icon}
                tone={item.group.tone}
                title={item.group.title}
                subtitle={item.group.hint || undefined}
                value={String(item.count)}
                onClick={() => open({ kind: 'kind', group: item.group.id })}
              />
            )}
          </For>
        </ListGroup>
      </Show>
    </div>
  );
}
