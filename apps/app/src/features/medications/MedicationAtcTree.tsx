import { createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { atcGroupActionLabel, atcGroupPackage } from '@/features/medications/atc-group-package';
import { loadAtcNames } from '@/features/medications/atc-names';
import {
  type AtcSubstance,
  type AtcTreeEntry,
  type AtcTreeNode,
  atcGroupModuleId,
  atcLevelOneGroups,
  buildAtcTree,
  subgroupCountLabel,
  substanceCountLabel,
} from '@/features/medications/atc-tree';
import { atcCrumbCodes, medicationAtcHash } from '@/features/medications/medication-routing';
import { useDrugDownload } from '@/features/medications/use-drug-download';
import { openDocumentOverlay } from '@/state/document-navigation';

import '@/features/medications/medication-atc-tree.css';

function goTo(code: string | null): void {
  window.location.hash = medicationAtcHash(code);
}

function nodeMeta(node: AtcTreeNode): string {
  return [
    node.children.length > 0 ? subgroupCountLabel(node.children.length) : null,
    substanceCountLabel(node.substanceCount),
  ]
    .filter(Boolean)
    .join(' · ');
}

function SubstanceCard(props: { readonly entry: AtcTreeEntry }): JSX.Element {
  return (
    <button
      type="button"
      class="atc-substance paper-card"
      aria-label={`Открыть: ${props.entry.substance.name}`}
      onClick={() => openDocumentOverlay(props.entry.substance.documentId)}
    >
      <span class="atc-substance__name">
        {props.entry.substance.name.replaceAll('+', '+\u200b')}
      </span>
      <Show when={props.entry.codes.length > 0}>
        <span class="atc-substance__codes">{props.entry.codes.join(' · ')}</span>
      </Show>
      <AppGlyph name="arrow-up-right" class="atc-substance__icon" />
    </button>
  );
}

/**
 * «По группам АТХ»: level 1 (14 groups, each tied to its ЕСКЛП package) → levels 2-4 → the
 * installed substances of the group → the substance card. The open node comes from the address,
 * so every level is a link and the browser's back button climbs the tree.
 */
export function MedicationAtcTree(props: {
  readonly substances: readonly AtcSubstance[];
  /** The catalog is still being read. */
  readonly loading: boolean;
  /** The open node (levels 1-4 or `none`); null for the list of groups. */
  readonly code: string | null;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const [names, setNames] = createSignal<Readonly<Record<string, string>>>({});
  const download = useDrugDownload(props.onContentChanged);
  onMount(() => {
    loadAtcNames()
      .then((catalog) => setNames(catalog.names))
      .catch((cause: unknown) => {
        // Without the dictionary the 14 taxonomy headings still name level 1.
        console.warn('Названия АТХ не загрузились.', cause);
      });
  });

  const tree = createMemo(() => buildAtcTree(props.substances, names()));
  const groups = createMemo(() => atcLevelOneGroups(names()));
  const node = () => (props.code ? tree().nodes.get(props.code) : undefined);

  const crumbs = () => {
    const codes = props.code ? atcCrumbCodes(props.code) : [];
    return [
      { label: 'Группы АТХ', href: medicationAtcHash(null) },
      ...codes.map((code, index) => ({
        label: code === 'none' ? 'Без кода' : code,
        ...(index < codes.length - 1 ? { href: medicationAtcHash(code) } : {}),
      })),
    ];
  };

  const packageOf = (moduleId: string | null) =>
    moduleId ? atcGroupPackage(moduleId, download.state()) : atcGroupPackage('', undefined);

  const Action = (actionProps: { readonly moduleId: string | null }): JSX.Element => {
    const item = () => packageOf(actionProps.moduleId);
    return (
      <Show when={['missing', 'queued', 'downloading'].includes(item().status)}>
        <Button
          class="atc-group__action"
          variant="secondary"
          disabled={item().status !== 'missing'}
          icon={
            <Show
              when={item().status === 'missing'}
              fallback={
                <DownloadProgressMark
                  state={item().status === 'queued' ? 'queued' : 'running'}
                  progress={item().progress}
                />
              }
            >
              <AppGlyph name="download" />
            </Show>
          }
          onClick={() => {
            const module = item().module;
            if (module) void download.start([module]);
          }}
        >
          {atcGroupActionLabel(item(), download.problem())}
        </Button>
      </Show>
    );
  };

  const GroupRow = (rowProps: {
    readonly code: string;
    readonly name: string;
    readonly moduleId: string | null;
    readonly node: AtcTreeNode | undefined;
  }): JSX.Element => {
    const count = () => rowProps.node?.substanceCount ?? 0;
    const status = () => packageOf(rowProps.moduleId).status;
    const meta = () => {
      if (rowProps.node) return nodeMeta(rowProps.node);
      if (props.loading) return 'Читаем базу…';
      return status() === 'installed' ? substanceCountLabel(0) : 'Не скачано';
    };
    const body = (
      <>
        <span class="atc-row__code">{rowProps.code === 'none' ? '—' : rowProps.code}</span>
        <span class="atc-row__body">
          <span class="atc-row__name">{rowProps.name}</span>
          <span class="atc-row__meta">{meta()}</span>
        </span>
      </>
    );
    return (
      <li class="atc-group paper-card" classList={{ 'atc-group--empty': count() === 0 }}>
        <Show when={count() > 0} fallback={<div class="atc-row atc-row--static">{body}</div>}>
          <button type="button" class="atc-row" onClick={() => goTo(rowProps.code)}>
            {body}
            <AppGlyph name="caret-right" class="atc-row__chevron" />
          </button>
        </Show>
        <Action moduleId={rowProps.moduleId} />
      </li>
    );
  };

  const missingAny = () => (download.state()?.plan.pending.length ?? 0) > 0;

  return (
    <section class="atc-tree" aria-label="Препараты по группам АТХ">
      <AppBreadcrumbs
        items={crumbs()}
        onNavigate={(href) => {
          window.location.hash = href;
        }}
      />
      <Show when={props.code ?? 'root'} keyed>
        <div class="atc-tree__panel">
          <Show
            when={props.code}
            fallback={
              <>
                <p class="atc-tree__intro">
                  Анатомо-терапевтическо-химическая классификация: 14 групп. Вещества берутся из
                  скачанных пакетов, поэтому каждая группа скачивается отдельно.
                </p>
                <ul class="atc-tree__list">
                  <For each={groups()}>
                    {(group) => (
                      <GroupRow
                        code={group.code}
                        name={group.name}
                        moduleId={group.moduleId}
                        node={tree().nodes.get(group.code)}
                      />
                    )}
                  </For>
                  <Show when={tree().nodes.get('none')}>
                    {(none) => (
                      <GroupRow
                        code="none"
                        name={none().name ?? ''}
                        moduleId={null}
                        node={none()}
                      />
                    )}
                  </Show>
                </ul>
                <Show when={missingAny() && !props.loading}>
                  <Button
                    class="atc-tree__all"
                    variant="quiet"
                    disabled={download.active()}
                    onClick={() => void download.start()}
                  >
                    Скачать все группы
                  </Button>
                </Show>
              </>
            }
          >
            {(code) => (
              <Show
                when={node()}
                fallback={
                  <div class="atc-tree__empty paper-card" role="status">
                    <p class="atc-tree__empty-text">
                      {props.loading
                        ? 'Читаем локальную базу…'
                        : `В скачанных препаратах нет веществ группы ${code()}.`}
                    </p>
                    <Action moduleId={atcGroupModuleId(code())} />
                  </div>
                }
              >
                {(current) => (
                  <>
                    <header class="atc-tree__head">
                      <span class="atc-tree__head-code">
                        {current().code === 'none' ? '—' : current().code}
                      </span>
                      <h3 class="atc-tree__title">
                        {current().name ?? `Группа ${current().code}`}
                      </h3>
                      <p class="atc-tree__meta">{nodeMeta(current())}</p>
                    </header>
                    <Show when={current().children.length > 0}>
                      <ul class="atc-tree__list">
                        <For each={current().children}>
                          {(child) => (
                            <li class="atc-group paper-card">
                              <button
                                type="button"
                                class="atc-row"
                                onClick={() => goTo(child.code)}
                              >
                                <span class="atc-row__code">{child.code}</span>
                                <span class="atc-row__body">
                                  <span class="atc-row__name">
                                    {child.name ?? `Группа ${child.code}`}
                                  </span>
                                  <span class="atc-row__meta">{nodeMeta(child)}</span>
                                </span>
                                <AppGlyph name="caret-right" class="atc-row__chevron" />
                              </button>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                    <Show when={current().entries.length > 0}>
                      <h4 class="atc-tree__subhead">Вещества (МНН)</h4>
                      <div class="atc-tree__substances">
                        <LayoutVirtualizedGrid
                          data={current().entries}
                          rowSize={72}
                          bufferSize={400}
                        >
                          {(entry) => <SubstanceCard entry={entry} />}
                        </LayoutVirtualizedGrid>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}
