import { errorStateOf } from '@localmed/contracts';
import { createSignal, For, type JSX, Match, onMount, Show, Switch } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { CalmError } from '@/components/CalmError';
import { EmptyState } from '@/components/EmptyState';
import { ListGroup, ListRow } from '@/components/ListRow';
import { SkeletonLines } from '@/components/SkeletonLines';
import {
  COMPUTER_FOLDER_FAILURE_STATES,
  type ComputerEntry,
  type ComputerFolderFailure,
  computerFolderAccess,
  computerFolderSupported,
  listComputerFolder,
  pickComputerFolder,
  readComputerFile,
  requestComputerFolderAccess,
  savedComputerFolder,
} from '@/features/library/computer-folder';
import { userLibraryKindGroup } from '@/features/library/user-library-places';
import { formatFileSize } from '@/features/library/user-library-status';

/** «Мой компьютер» on a phone, where the files are the phone's own. */
export function computerPlaceTitle(): string {
  return computerFolderSupported() ? 'Мой компьютер' : 'Мой телефон';
}

type ViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'choose' }
  | { readonly kind: 'ask'; readonly root: FileSystemDirectoryHandle }
  | {
      readonly kind: 'listed';
      readonly path: readonly FileSystemDirectoryHandle[];
      readonly entries: readonly ComputerEntry[];
    }
  | { readonly kind: 'failed'; readonly failure: ComputerFolderFailure };

const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The device's own files inside «Файлы» (owner 2026-11-11). A chosen folder is listed in place;
 * tapping a file hands it to the library, which keeps a copy and opens it in the usual reader
 * (the app works offline, so a file it shows must stay readable without the computer).
 */
export function ComputerFolderView(props: {
  /** A file the doctor opened: the page adds it to «Файлы» and opens it. */
  readonly onOpenFile: (file: File) => void;
  /** The system file picker, where the browser cannot open a folder. */
  readonly onPickFiles: () => void;
}): JSX.Element {
  const [state, setState] = createSignal<ViewState>({ kind: 'loading' });
  const [opening, setOpening] = createSignal<string | null>(null);

  const show = async (path: readonly FileSystemDirectoryHandle[]): Promise<void> => {
    const folder = path.at(-1);
    if (!folder) return;
    const listed = await listComputerFolder(folder);
    setState(
      listed.ok
        ? { kind: 'listed', path, entries: listed.value }
        : { kind: 'failed', failure: listed.error },
    );
  };

  const start = async (): Promise<void> => {
    if (!computerFolderSupported()) {
      setState({ kind: 'unsupported' });
      return;
    }
    const root = await savedComputerFolder();
    if (!root) {
      setState({ kind: 'choose' });
      return;
    }
    if ((await computerFolderAccess(root)) !== 'granted') {
      setState({ kind: 'ask', root });
      return;
    }
    await show([root]);
  };

  onMount(() => {
    void start().catch((cause: unknown) => {
      console.warn('The computer folder could not be opened.', cause);
      setState({ kind: 'choose' });
    });
  });

  const choose = async (): Promise<void> => {
    const picked = await pickComputerFolder();
    if (picked.ok) await show([picked.value]);
    else if (picked.error.kind !== 'cancelled') setState({ kind: 'failed', failure: picked.error });
  };

  const allow = async (root: FileSystemDirectoryHandle): Promise<void> => {
    const granted = await requestComputerFolderAccess(root);
    if (granted.ok) await show([root]);
    else setState({ kind: 'failed', failure: granted.error });
  };

  const open = async (entry: ComputerEntry): Promise<void> => {
    if (opening()) return;
    setOpening(entry.name);
    try {
      const file = await readComputerFile(entry);
      if (file.ok) props.onOpenFile(file.value);
      else setState({ kind: 'failed', failure: file.error });
    } finally {
      setOpening(null);
    }
  };

  return (
    <div class="computer-folder" data-testid="computer-folder">
      <Switch>
        <Match when={state().kind === 'loading'}>
          <SkeletonLines label="Открываем папку" lines={4} />
        </Match>
        <Match when={state().kind === 'unsupported'}>
          <EmptyState
            glyph="device-mobile"
            title="Файлы этого устройства"
            text="Выберите файлы — они откроются здесь и останутся в «Файлах»."
            actions={
              <Button
                type="button"
                variant="primary"
                icon={<AppGlyph name="folder-open" />}
                onClick={() => props.onPickFiles()}
              >
                Выбрать файлы
              </Button>
            }
          />
        </Match>
        <Match when={state().kind === 'choose'}>
          <EmptyState
            glyph="folder-open"
            title="Папка с компьютера"
            text="Выберите папку один раз — её файлы будут видны здесь."
            actions={
              <Button
                type="button"
                variant="primary"
                icon={<AppGlyph name="folder-open" />}
                onClick={() => void choose()}
              >
                Выбрать папку
              </Button>
            }
          />
        </Match>
        <Match
          when={(() => {
            const current = state();
            return current.kind === 'ask' ? current : undefined;
          })()}
        >
          {(asking) => (
            <EmptyState
              glyph="lock"
              title={`Папка «${asking().root.name}»`}
              text="Браузер спрашивает доступ заново после перезапуска."
              actions={
                <>
                  <Button
                    type="button"
                    variant="primary"
                    icon={<AppGlyph name="eye" />}
                    onClick={() => void allow(asking().root)}
                  >
                    Открыть доступ
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<AppGlyph name="folder-open" />}
                    onClick={() => void choose()}
                  >
                    Другая папка
                  </Button>
                </>
              }
            />
          )}
        </Match>
        <Match
          when={(() => {
            const current = state();
            return current.kind === 'failed' ? current : undefined;
          })()}
        >
          {(failed) => {
            const message = () => errorStateOf(COMPUTER_FOLDER_FAILURE_STATES, failed().failure);
            return (
              <CalmError
                title={message().title}
                detail={message().text}
                actionLabel={
                  failed().failure.kind === 'unsupported' ? 'Выбрать файлы' : 'Выбрать папку'
                }
                onAction={() =>
                  failed().failure.kind === 'unsupported' ? props.onPickFiles() : void choose()
                }
                embedded
              />
            );
          }}
        </Match>
        <Match
          when={(() => {
            const current = state();
            return current.kind === 'listed' ? current : undefined;
          })()}
        >
          {(listed) => {
            const folderName = () => listed().path.at(-1)?.name ?? '';
            return (
              <>
                <ListGroup
                  class="computer-folder__list"
                  heading={listed()
                    .path.map((folder) => folder.name)
                    .join(' / ')}
                >
                  <Show when={listed().path.length > 1}>
                    <ListRow
                      icon="arrow-u-up-left"
                      tone="gray"
                      title="Наверх"
                      subtitle={listed().path.at(-2)?.name}
                      onClick={() => void show(listed().path.slice(0, -1))}
                    />
                  </Show>
                  <For each={listed().entries}>
                    {(entry) => {
                      const group = () =>
                        entry.fileKind ? userLibraryKindGroup(entry.fileKind) : undefined;
                      return (
                        <ListRow
                          class="computer-folder__entry"
                          icon={
                            entry.kind === 'folder' ? 'folder-open' : (group()?.icon ?? 'file-text')
                          }
                          tone={entry.kind === 'folder' ? 'gray' : (group()?.tone ?? 'gray')}
                          title={entry.name}
                          subtitle={
                            entry.kind === 'file'
                              ? `${formatFileSize(entry.size ?? 0)}${entry.modified ? ` · ${DATE.format(entry.modified)}` : ''}`
                              : undefined
                          }
                          disabled={opening() !== null}
                          onClick={() =>
                            entry.kind === 'folder'
                              ? void show([
                                  ...listed().path,
                                  entry.handle as FileSystemDirectoryHandle,
                                ])
                              : void open(entry)
                          }
                        />
                      );
                    }}
                  </For>
                </ListGroup>
                <Show when={listed().entries.length === 0}>
                  <p class="computer-folder__empty">В папке «{folderName()}» нет файлов.</p>
                </Show>
                <Button
                  type="button"
                  variant="quiet"
                  class="computer-folder__change"
                  icon={<AppGlyph name="folder-open" />}
                  onClick={() => void choose()}
                >
                  Другая папка
                </Button>
              </>
            );
          }}
        </Match>
      </Switch>
    </div>
  );
}
