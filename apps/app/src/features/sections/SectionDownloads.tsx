import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ClinicalGlyph } from '@/components/ClinicalGlyph';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  LARGE_DOWNLOAD_BYTES,
  moduleDownloadPlan,
} from '@/features/onboarding/onboarding-downloads';
import {
  installState,
  recommendationsLabel,
  type Section,
  type SectionDrugGroup,
  sectionGlyph,
  substancesLabel,
} from './section-model';
import {
  pendingSizeLabel,
  type SectionStatus,
  sectionSummary,
  selectionTotalLabel,
} from './section-plan';
import { type SectionDownload, useSectionDownload } from './use-section-download';

import './section-downloads.css';

/** Where the list sits: inside the tour card (its body scrolls) or on a settings page. */
export type SectionDownloadsVariant = 'onboarding' | 'page';

/**
 * «Скачать по разделам»: a specialty is picked as a whole (its recommendations and the drug
 * packages they name), shown with what it contains and how much is left to download. One
 * component for the tour and Settings → Загрузки; the downloads go through the shared queue.
 */
export function SectionDownloads(props: {
  readonly onContentChanged: () => Promise<void>;
  readonly variant?: SectionDownloadsVariant;
}): JSX.Element {
  const download = useSectionDownload(props.onContentChanged);
  const variant = () => props.variant ?? 'page';
  const totalLabel = () => selectionTotalLabel(download.selectedCount(), download.plan());
  const startDisabled = () =>
    download.selectedCount() === 0 || download.plan().pending.length === 0;

  return (
    <div class="section-downloads" data-testid="section-downloads">
      <Show
        when={download.sections()}
        fallback={
          <p class="section-downloads__note" role="status">
            {download.failed() ? 'Список разделов не загрузился.' : 'Загружаем список разделов…'}
          </p>
        }
      >
        {(sections) => (
          <Show
            when={sections().length > 0}
            fallback={<p class="section-downloads__note">Разделы пока недоступны.</p>}
          >
            <div
              class="section-downloads__bar"
              classList={{ 'section-downloads__bar--sticky': variant() === 'onboarding' }}
            >
              <Button
                class="section-downloads__start"
                variant="primary"
                disabled={startDisabled()}
                icon={<AppGlyph name="download" />}
                onClick={() => void download.start()}
              >
                {download.problem() && download.selectedCount() > 0
                  ? `Повторить · ${totalLabel()}`
                  : totalLabel()}
              </Button>
              <Show when={(download.plan().bytes ?? 0) >= LARGE_DOWNLOAD_BYTES}>
                <p class="section-downloads__hint">
                  Файл большой — лучше по Wi‑Fi. Загрузка идёт в фоне.
                </p>
              </Show>
            </div>
            <ul class="section-downloads__list" aria-label="Разделы медицины">
              <For each={sections()}>
                {(section) => <SectionItem section={section} download={download} />}
              </For>
            </ul>
          </Show>
        )}
      </Show>
    </div>
  );
}

function SectionItem(props: {
  readonly section: Section;
  readonly download: SectionDownload;
}): JSX.Element {
  const detailsId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const status = (): SectionStatus => props.download.status(props.section);
  const complete = () => status().install === 'complete';
  const selected = () => props.download.isSelected(props.section.id);
  const queueText = (): string => {
    const { queue, progress } = status();
    if (queue === null) return '';
    const fraction = progress.byteProgress;
    return queue === 'queued' || fraction === null
      ? 'в очереди'
      : `скачивается · ${Math.floor(fraction * 100)} %`;
  };

  return (
    <li
      class="section-downloads__item"
      classList={{
        'section-downloads__item--selected': selected(),
        'section-downloads__item--complete': complete(),
      }}
    >
      <div class="section-downloads__row">
        <label class="section-downloads__select">
          <input
            class="section-downloads__check"
            type="checkbox"
            checked={selected() || complete()}
            disabled={complete()}
            onChange={() => props.download.toggleSection(props.section.id)}
          />
          <ClinicalGlyph
            class={`section-downloads__glyph${complete() ? ' section-downloads__glyph--muted' : ''}`}
            name={sectionGlyph(props.section.id)}
          />
          <span class="section-downloads__copy">
            <span class="section-downloads__title">{props.section.title}</span>
            <span class="section-downloads__summary">
              {sectionSummary(props.section, props.download.skipped(), status())}
            </span>
          </span>
        </label>
        <Show when={status().queue !== null}>
          <span class="section-downloads__queue" role="status">
            <DownloadProgressMark
              class="section-downloads__mark"
              state={status().queue === 'queued' ? 'queued' : 'running'}
              progress={status().progress.byteProgress}
            />
            <span class="section-downloads__queue-text">{queueText()}</span>
          </span>
        </Show>
        <button
          class="section-downloads__expand"
          type="button"
          aria-expanded={open()}
          aria-controls={detailsId}
          aria-label={`Состав раздела «${props.section.title}»`}
          onClick={() => setOpen((value) => !value)}
        >
          <AppGlyph
            name="caret-down"
            class={`section-downloads__caret${open() ? ' section-downloads__caret--open' : ''}`}
          />
        </button>
      </div>
      <Show when={open()}>
        <SectionContents id={detailsId} section={props.section} download={props.download} />
      </Show>
    </li>
  );
}

function SectionContents(props: {
  readonly id: string;
  readonly section: Section;
  readonly download: SectionDownload;
}): JSX.Element {
  const isInstalled = props.download.isInstalled;
  const clinicalPlan = () => moduleDownloadPlan(props.section.clinical, isInstalled);
  const clinicalState = () => installState(props.section.clinical, isInstalled);
  return (
    <div class="section-downloads__details" id={props.id}>
      <section class="section-downloads__part">
        <h4 class="section-downloads__part-title">Клинические рекомендации</h4>
        <p class="section-downloads__part-text">
          {[
            recommendationsLabel(props.section.clinical.length),
            pendingSizeLabel(clinicalPlan(), clinicalState()),
          ]
            .filter((part) => part !== '')
            .join(' · ')}
        </p>
      </section>
      <Show when={props.section.drugGroups.length > 0}>
        <section class="section-downloads__part">
          <h4 class="section-downloads__part-title">Препараты</h4>
          <p class="section-downloads__part-text">
            Группы АТХ с препаратами, которые названы в рекомендациях раздела: реестр ЕСКЛП и
            официальные инструкции ГРЛС. Ненужную группу можно снять.
          </p>
          <ul class="section-downloads__groups">
            <For each={props.section.drugGroups}>
              {(group) => (
                <DrugGroupRow section={props.section} group={group} download={props.download} />
              )}
            </For>
          </ul>
        </section>
      </Show>
      <section class="section-downloads__part section-downloads__part--soon">
        <h4 class="section-downloads__part-title">Формы</h4>
        <p class="section-downloads__part-text">Скоро: формы документов по специальности.</p>
      </section>
    </div>
  );
}

function DrugGroupRow(props: {
  readonly section: Section;
  readonly group: SectionDrugGroup;
  readonly download: SectionDownload;
}): JSX.Element {
  const plan = () => moduleDownloadPlan(props.group.modules, props.download.isInstalled);
  const state = () => installState(props.group.modules, props.download.isInstalled);
  return (
    <li class="section-downloads__group">
      <label class="section-downloads__group-select">
        <input
          class="section-downloads__check"
          type="checkbox"
          checked={props.download.isGroupIncluded(props.section.id, props.group.id)}
          onChange={() => props.download.toggleGroup(props.section.id, props.group.id)}
        />
        <span class="section-downloads__copy">
          <span class="section-downloads__group-title">{props.group.title}</span>
          <span class="section-downloads__summary">
            {[
              `${substancesLabel(props.group.medicationCount)} из рекомендаций`,
              pendingSizeLabel(plan(), state()),
            ]
              .filter((part) => part !== '')
              .join(' · ')}
          </span>
        </span>
      </label>
    </li>
  );
}
