import type { MedicalDocument } from '@localmed/contracts';
import { createEffect, createMemo, createResource, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  type Icd10Icd11Result,
  type Icd11Target,
  icd11ForIcd10Codes,
} from '@/features/icd11/icd10-icd11-map';
import {
  chapterLine,
  documentIcd10Codes,
  ENGLISH_TITLE_MARK,
  leadTarget,
  MAX_CODE_ENTRIES,
  MODULE_NOTE,
  manyCodesHeading,
  mergedPreview,
  moreTargets,
  moreTargetsText,
  TABLES_NOTE,
  targetCodeText,
} from '@/features/icd11/icd10-to-icd11-view';
import { ICD11_MODULE_ID, ICD11_PRACTICE_NOTE } from '@/features/icd11/icd11-document';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { formatModuleBytes } from '@/features/modules/module-display';
import { useModuleInstaller } from '@/features/sections/use-module-installer';
import { openDocumentOverlay } from '@/state/document-navigation';
import { buildOfficialDocumentHash } from '@/state/document-route';
import '@/features/icd11/icd10-to-icd11-panel.css';

const FINISHED_TASK_STATES = new Set(['completed', 'failed', 'cancelled']);
const KNOWLEDGE_BASE_ICD11_HREF = '#/modules/documents/collection/icd11';
const NO_CHANGE = async (): Promise<void> => {};

function openCard(event: MouseEvent, documentId: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  openDocumentOverlay(documentId);
}

function TargetText(props: { readonly target: Icd11Target }): JSX.Element {
  return (
    <>
      <span class="icd10-to-icd11__code">{targetCodeText(props.target)}</span>
      {' · '}
      <span class="icd10-to-icd11__target-title">{props.target.title}</span>
      <Show when={props.target.titleLanguage === 'en'}>
        <span class="icd10-to-icd11__lang"> ({ENGLISH_TITLE_MARK})</span>
      </Show>
    </>
  );
}

function TargetRow(props: {
  readonly target: Icd11Target;
  /** The ICD-11 module is installed, so its card can be opened. */
  readonly cardAvailable: boolean;
}): JSX.Element {
  return (
    <li class="icd10-to-icd11__target">
      <Show
        when={props.cardAvailable ? props.target.documentId : null}
        fallback={
          <span class="icd10-to-icd11__target-line">
            <TargetText target={props.target} />
          </span>
        }
      >
        {(documentId) => (
          <a
            class="icd10-to-icd11__link"
            href={buildOfficialDocumentHash(documentId())}
            onClick={(event) => openCard(event, documentId())}
          >
            <TargetText target={props.target} />
          </a>
        )}
      </Show>
      <Show when={props.target.clusterParts.length > 0}>
        <p class="icd10-to-icd11__cluster">
          <span class="icd10-to-icd11__meta-label">Уточняющие коды: </span>
          <For each={props.target.clusterParts}>
            {(part, index) => (
              <>
                <Show when={index() > 0}>{'; '}</Show>
                <span class="icd10-to-icd11__code">{part.code}</span>
                <Show when={part.title}>
                  {' — '}
                  {part.title}
                  <Show when={part.titleLanguage === 'en'}>
                    <span class="icd10-to-icd11__lang"> ({ENGLISH_TITLE_MARK})</span>
                  </Show>
                </Show>
              </>
            )}
          </For>
        </p>
      </Show>
      <p class="icd10-to-icd11__chapter">{chapterLine(props.target)}</p>
    </li>
  );
}

function TargetTable(props: {
  readonly heading: string;
  readonly targets: readonly Icd11Target[];
  readonly cardAvailable: boolean;
}): JSX.Element {
  return (
    <div class="icd10-to-icd11__table">
      <h4 class="icd10-to-icd11__table-heading">{props.heading}</h4>
      <ul class="icd10-to-icd11__targets">
        <For each={props.targets}>
          {(target) => <TargetRow target={target} cardAvailable={props.cardAvailable} />}
        </For>
      </ul>
    </div>
  );
}

function CodeEntry(props: {
  readonly result: Icd10Icd11Result;
  readonly showCode: boolean;
  readonly cardAvailable: boolean;
}): JSX.Element {
  const merged = createMemo(() => mergedPreview(props.result));
  const otherChapter = () => props.result.labels.some((label) => label.id === 'other-chapter');
  return (
    <div class="icd10-to-icd11__entry">
      <Show when={props.showCode}>
        <h3 class="icd10-to-icd11__entry-heading">{props.result.icd10Code}</h3>
      </Show>
      <Show when={props.result.labels.length > 0}>
        <ul class="icd10-to-icd11__chips" aria-label="Что изменилось в МКБ-11">
          <For each={props.result.labels}>
            {(label) => (
              <li
                class="icd10-to-icd11__chip"
                classList={{ 'icd10-to-icd11__chip--notable': label.id !== 'single' }}
                title={label.hint}
              >
                {label.text}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={otherChapter()}>
        <p class="icd10-to-icd11__chapter">Глава МКБ-10: {props.result.icd10Chapter}</p>
      </Show>
      <Show
        when={props.result.tablesAgree}
        fallback={
          <>
            <Show when={props.result.oneCategory}>
              {(target) => (
                <TargetTable
                  heading="Таблица ВОЗ «одна категория»"
                  targets={[target()]}
                  cardAvailable={props.cardAvailable}
                />
              )}
            </Show>
            <TargetTable
              heading="Таблица ВОЗ «несколько категорий»"
              targets={props.result.multipleCategories}
              cardAvailable={props.cardAvailable}
            />
          </>
        }
      >
        <TargetTable
          heading="Таблицы ВОЗ «одна категория» и «несколько категорий»"
          targets={props.result.multipleCategories}
          cardAvailable={props.cardAvailable}
        />
      </Show>
      <Show when={merged().codes.length > 0}>
        <p class="icd10-to-icd11__merged">
          <span class="icd10-to-icd11__meta-label">
            В таблицах ВОЗ в ту же рубрику МКБ-11 отнесены также:{' '}
          </span>
          {merged().codes.join(', ')}
          <Show when={merged().rest > 0}> и ещё {merged().rest}</Show>
        </p>
      </Show>
    </div>
  );
}

/**
 * Opened details: the entries, the citation WHO's licence asks for, and the access to the ICD-11
 * module. Mounted by the disclosure only when it is first opened, so the module catalog is not loaded
 * for a card whose reader never looks at the ICD-11 answer.
 */
function Details(props: {
  readonly results: readonly Icd10Icd11Result[];
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const installer = useModuleInstaller(props.onContentChanged, 'Не удалось скачать МКБ-11.');
  const entry = createMemo(() =>
    installer.snapshot()?.catalog.modules.find((module) => module.id === ICD11_MODULE_ID),
  );
  const installed = () => installer.snapshot()?.installedIds.has(ICD11_MODULE_ID) ?? false;
  const downloadable = createMemo(() => {
    const module = entry();
    return module && isModuleReleased(module) ? module : null;
  });
  const active = () =>
    installer.starting() ||
    (installer
      .snapshot()
      ?.tasks.some(
        (task) => task.moduleId === ICD11_MODULE_ID && !FINISHED_TASK_STATES.has(task.state),
      ) ??
      false);
  const citation = () => props.results[0]?.citation ?? '';
  return (
    <div class="icd10-to-icd11__details">
      <For each={props.results}>
        {(result) => (
          <CodeEntry
            result={result}
            showCode={props.results.length > 1}
            cardAvailable={installed()}
          />
        )}
      </For>
      <p class="icd10-to-icd11__source">
        {citation()}. {TABLES_NOTE} {ICD11_PRACTICE_NOTE}
      </p>
      <Show when={installer.snapshot() && !installed()}>
        <div class="icd10-to-icd11__module">
          <p class="icd10-to-icd11__module-note">{MODULE_NOTE}</p>
          <Show
            when={downloadable()}
            fallback={
              <a class="icd10-to-icd11__module-link" href={KNOWLEDGE_BASE_ICD11_HREF}>
                Открыть в «Базе знаний»
              </a>
            }
          >
            {(module) => (
              <Button
                type="button"
                variant="primary"
                class="icd10-to-icd11__module-button"
                disabled={active()}
                icon={
                  <Show when={active()} fallback={<AppGlyph name="download" />}>
                    <DownloadProgressMark state="running" progress={null} />
                  </Show>
                }
                onClick={() => void installer.start([module()])}
              >
                {active()
                  ? 'Скачиваем…'
                  : `Скачать модуль МКБ-11 · ${formatModuleBytes(module().sizes.downloadBytes)}`}
              </Button>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * «В МКБ-11: 8A6Z · Эпилепсия или эпилептические приступы, неуточнённые» under the title of an
 * ICD-10 card: WHO's mapping tables for the card's code, folded. Nothing is shown for a code the
 * tables do not know, for a range, or when the asset cannot be read.
 */
export function Icd10ToIcd11Panel(props: {
  readonly document: MedicalDocument;
  /** Reconnects the search core after the ICD-11 module is installed from this panel. */
  readonly onContentChanged?: (() => Promise<void>) | undefined;
}): JSX.Element {
  const codes = createMemo(() => documentIcd10Codes(props.document));
  const [results] = createResource(
    () => (codes().length > 0 ? codes() : false),
    (list) => icd11ForIcd10Codes(list),
  );
  createEffect(() => {
    const failure: unknown = results.error;
    if (failure)
      console.warn(
        'Таблица соответствия МКБ-10 → МКБ-11 не загрузилась.',
        failure instanceof Error ? failure.name : 'unknown',
      );
  });
  const shown = createMemo(() => (results() ?? []).slice(0, MAX_CODE_ENTRIES));
  return (
    <Show when={shown().length > 0}>
      <section class="icd10-to-icd11" data-testid="icd10-to-icd11-panel">
        <Disclosure
          title={
            <Show
              when={shown().length === 1 ? shown()[0] : null}
              fallback={manyCodesHeading((results() ?? []).length)}
            >
              {(result) => (
                <span class="icd10-to-icd11__title">
                  <span class="icd10-to-icd11__title-label">В МКБ-11: </span>
                  <TargetText target={leadTarget(result())} />
                </span>
              )}
            </Show>
          }
          meta={
            shown().length === 1 && moreTargets(shown()[0] as Icd10Icd11Result) > 0 ? (
              <span class="icd10-to-icd11__more">
                {moreTargetsText(moreTargets(shown()[0] as Icd10Icd11Result))}
              </span>
            ) : undefined
          }
        >
          <Details results={shown()} onContentChanged={props.onContentChanged ?? NO_CHANGE} />
        </Disclosure>
      </section>
    </Show>
  );
}
