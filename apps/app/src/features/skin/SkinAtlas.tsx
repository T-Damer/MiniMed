import { createEffect, createMemo, createSignal, For, type JSX, on, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { createDebouncer } from '@/components/debounced-value';
import { MultiPickField } from '@/components/MultiPickField';
import { OverlayDialog } from '@/components/OverlayDialog';
import { TextArea } from '@/components/TextArea';
import { SkinLesionArt } from '@/features/skin/SkinLesionArt';
import { SkinPhotoImage } from '@/features/skin/SkinPhotoImage';
import { SkinPhotoViewer } from '@/features/skin/SkinPhotoViewer';
import {
  activeTriggers,
  atlasCondition,
  conditionDanger,
  redFlagViews,
  SKIN_ATLAS,
  type SkinAtlasCondition,
  type SkinDangerSummary,
  type SkinFindings,
  toggleFinding,
} from '@/features/skin/skin-atlas';
import {
  SKIN_COLOR_LABELS,
  SKIN_COLOR_SWATCHES,
  SKIN_COLORS,
  SKIN_DANGER_LABELS,
  SKIN_DANGER_LEVELS,
  SKIN_DANGER_SHORT,
  SKIN_ELEMENT_LABELS,
  SKIN_ELEMENTS,
  SKIN_SIGN_LABELS,
  SKIN_SIGNS,
  type SkinDangerLevel,
} from '@/features/skin/skin-atlas-terms';
import {
  SKIN_DOCUMENT_KIND_LABELS,
  type SkinDocumentLink,
  skinSearchHash,
} from '@/features/skin/skin-document-links';
import type { SkinDetails } from '@/features/skin/skin-model';
import type { SkinPhoto } from '@/features/skin/skin-pack';
import { useSkinPhotos } from '@/features/skin/use-skin-photos';

import '@/styles/skin-atlas.css';

const DANGER_ICON: Record<SkinDangerLevel, 'warning' | 'info'> = {
  low: 'info',
  moderate: 'warning',
  high: 'warning',
  urgent: 'warning',
};

/** The one line the doctor reads first: how dangerous, what to do, and why. */
export function SkinDangerBanner(props: {
  readonly summary: SkinDangerSummary;
  readonly onOpen: (conditionId: string) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class={`skin-danger skin-danger--${props.summary.level}`}
      data-testid="skin-danger"
      data-level={props.summary.level}
      onClick={() => props.onOpen(props.summary.conditionId)}
    >
      <AppGlyph name={DANGER_ICON[props.summary.level]} class="skin-danger__icon" />
      <span class="skin-danger__body">
        <span class="skin-danger__level">{SKIN_DANGER_LABELS[props.summary.level]}</span>
        <span class="skin-danger__action">{props.summary.action}</span>
        <Show when={props.summary.reasons.length > 0}>
          <span class="skin-danger__reasons">{props.summary.reasons.join(' · ')}</span>
        </Show>
      </span>
      <AppGlyph name="caret-right" class="skin-danger__caret" />
    </button>
  );
}

export function SkinDangerChip(props: { readonly level: SkinDangerLevel }): JSX.Element {
  return (
    <span class={`skin-danger-chip skin-danger-chip--${props.level}`} data-level={props.level}>
      <span class="skin-danger-chip__dot" aria-hidden="true" />
      {SKIN_DANGER_SHORT[props.level]}
    </span>
  );
}

/**
 * The condition's reference as a small tile; a tap opens the atlas on it. The first photo of the
 * installed skin pack is the tile; without photos, the drawn pictures.
 */
export function SkinArtStrip(props: {
  readonly condition: SkinAtlasCondition;
  readonly onOpen: () => void;
}): JSX.Element {
  const photosFor = useSkinPhotos();
  const photo = (): SkinPhoto | undefined => photosFor(props.condition.id)[0];
  return (
    <Show when={photo() !== undefined || props.condition.art.length > 0}>
      <button
        type="button"
        class="skin-art-strip"
        aria-label={`Атлас: ${props.condition.ru}`}
        data-testid="skin-art-strip"
        data-kind={photo() ? 'photo' : 'art'}
        onClick={() => props.onOpen()}
      >
        <Show
          when={photo()}
          fallback={
            <For each={props.condition.art}>
              {(art) => <SkinLesionArt art={art} class="skin-art-strip__tile" />}
            </For>
          }
        >
          {(first) => <SkinPhotoImage photo={first()} alt="" class="skin-art-strip__photo" />}
        </Show>
      </button>
    </Show>
  );
}

function SkinDocumentLinks(props: {
  readonly condition: SkinAtlasCondition;
  readonly links: readonly SkinDocumentLink[];
  readonly onOpenDocument: (documentId: string) => void;
}): JSX.Element {
  return (
    <>
      <ul class="skin-atlas__links">
        <For each={props.links}>
          {(link) => (
            <li class="skin-atlas__link-item">
              <button
                type="button"
                class="skin-atlas__link"
                onClick={() => props.onOpenDocument(link.documentId)}
              >
                <AppGlyph name="file-text" class="skin-atlas__link-icon" />
                <span class="skin-atlas__link-title">{link.title}</span>
                <span class="skin-atlas__link-kind">{SKIN_DOCUMENT_KIND_LABELS[link.kind]}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
      <a class="skin-atlas__search" href={skinSearchHash(props.condition.ru)}>
        <AppGlyph name="search" class="skin-atlas__search-icon" />
        <span class="skin-atlas__search-text">Искать в базе</span>
      </a>
    </>
  );
}

/** One condition: pictures, danger and action, look, course, red flags, documents. */
function SkinAtlasEntry(props: {
  readonly condition: SkinAtlasCondition;
  readonly details: SkinDetails;
  readonly findings: SkinFindings;
  readonly links: readonly SkinDocumentLink[];
  readonly onOpenDocument: (documentId: string) => void;
}): JSX.Element {
  const triggers = createMemo(() => activeTriggers(props.details, props.findings));
  const level = createMemo(() => conditionDanger(props.condition, triggers()));
  const flags = createMemo(() => redFlagViews(props.condition, triggers()));
  const photosFor = useSkinPhotos();
  const photos = (): readonly SkinPhoto[] => photosFor(props.condition.id);
  const [viewing, setViewing] = createSignal<SkinPhoto>();
  return (
    <article
      class="skin-atlas__entry"
      data-testid="skin-atlas-entry"
      data-condition={props.condition.id}
    >
      <Show
        when={photos().length > 0}
        fallback={
          <div class="skin-atlas__gallery">
            <For each={props.condition.art}>
              {(art) => (
                <figure class="skin-atlas__figure">
                  <SkinLesionArt
                    art={art}
                    class="skin-atlas__art"
                    label={`${props.condition.ru}: ${art.caption}`}
                  />
                  <figcaption class="skin-atlas__caption">{art.caption}</figcaption>
                </figure>
              )}
            </For>
          </div>
        }
      >
        <div class="skin-atlas__photos" data-testid="skin-atlas-photos">
          <For each={photos()}>
            {(photo) => (
              <button
                type="button"
                class="skin-atlas__photo"
                data-testid="skin-atlas-photo"
                aria-label={`Фото: ${props.condition.ru}`}
                onClick={() => setViewing(photo)}
              >
                <SkinPhotoImage
                  photo={photo}
                  alt={props.condition.ru}
                  class="skin-atlas__photo-image"
                  natural
                />
              </button>
            )}
          </For>
        </div>
      </Show>
      <SkinPhotoViewer
        photo={viewing()}
        title={props.condition.ru}
        onClose={() => setViewing(undefined)}
      />
      <div class={`skin-atlas__danger skin-atlas__danger--${level()}`}>
        <SkinDangerChip level={level()} />
        <span class="skin-atlas__danger-why">{props.condition.dangerWhy}</span>
      </div>
      <p class="skin-atlas__action">{props.condition.action}</p>
      <p class="skin-atlas__text">{props.condition.summary}</p>
      <h3 class="skin-atlas__heading">Течение</h3>
      <p class="skin-atlas__text">{props.condition.evolution}</p>
      <Show when={flags().length > 0}>
        <h3 class="skin-atlas__heading">Тревожные признаки</h3>
        <ul class="skin-atlas__flags">
          <For each={flags()}>
            {(flag) => (
              <li
                class={`skin-atlas__flag skin-atlas__flag--${flag.danger}`}
                classList={{ 'skin-atlas__flag--active': flag.active }}
                data-active={flag.active}
              >
                <AppGlyph name={flag.active ? 'warning' : 'info'} class="skin-atlas__flag-icon" />
                {flag.text}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <SkinDocumentLinks
        condition={props.condition}
        links={props.links}
        onOpenDocument={props.onOpenDocument}
      />
      <p class="skin-atlas__source">
        <Show when={props.condition.status === 'draft'}>
          <span class="skin-atlas__badge">Черновик</span>
        </Show>
        {props.condition.sources.map((source) => source.title).join(' · ')}
      </p>
    </article>
  );
}

/**
 * The atlas as a sheet: every condition grouped by danger (most dangerous first), or one of them.
 * Opening on a condition from a card shows it at once; «‹» returns to the list.
 */
export function SkinAtlasSheet(props: {
  readonly open: boolean;
  readonly conditionId: string | undefined;
  readonly details: SkinDetails;
  readonly findings: SkinFindings;
  readonly linksFor: (conditionId: string) => readonly SkinDocumentLink[];
  readonly onOpenDocument: (documentId: string) => void;
  readonly onSelect: (conditionId: string | undefined) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const condition = createMemo(() =>
    props.conditionId ? atlasCondition(props.conditionId) : undefined,
  );
  // Switching between the list and a condition starts at the top, not at the list's scroll.
  let anchor: HTMLDivElement | undefined;
  createEffect(
    on(
      () => props.conditionId,
      () => anchor?.closest('.skin-atlas__body')?.scrollTo({ top: 0 }),
      { defer: true },
    ),
  );
  const photosFor = useSkinPhotos();
  const groups = createMemo(() =>
    SKIN_DANGER_LEVELS.toReversed().map((level) => ({
      level,
      conditions: SKIN_ATLAS.filter((entry) => entry.danger === level),
    })),
  );
  return (
    <OverlayDialog
      open={props.open}
      title={condition()?.ru ?? 'Атлас кожи'}
      class="skin-atlas"
      bodyClass="skin-atlas__body"
      headerStart={
        <Show when={condition()}>
          <button
            type="button"
            class="skin-atlas__back"
            aria-label="Все состояния"
            onClick={() => props.onSelect(undefined)}
          >
            <AppGlyph name="caret-left" class="skin-atlas__back-icon" />
          </button>
        </Show>
      }
      onClose={props.onClose}
    >
      <div class="skin-atlas__anchor" ref={anchor} />
      <Show
        when={condition()}
        fallback={
          <div class="skin-atlas__index" data-testid="skin-atlas-index">
            <For each={groups()}>
              {(group) => (
                <Show when={group.conditions.length > 0}>
                  <section class="skin-atlas__group">
                    <h3 class="skin-atlas__group-title">
                      <SkinDangerChip level={group.level} />
                    </h3>
                    <ul class="skin-atlas__cells">
                      <For each={group.conditions}>
                        {(entry) => (
                          <li class="skin-atlas__cell-item">
                            <button
                              type="button"
                              class="skin-atlas__cell"
                              onClick={() => props.onSelect(entry.id)}
                            >
                              <Show
                                when={photosFor(entry.id)[0]}
                                fallback={
                                  <Show when={entry.art[0]}>
                                    {(art) => (
                                      <SkinLesionArt art={art()} class="skin-atlas__cell-art" />
                                    )}
                                  </Show>
                                }
                              >
                                {(first) => (
                                  <SkinPhotoImage
                                    photo={first()}
                                    alt=""
                                    class="skin-atlas__cell-photo"
                                  />
                                )}
                              </Show>
                              <span class="skin-atlas__cell-name">{entry.ru}</span>
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>
              )}
            </For>
          </div>
        }
      >
        {(entry) => (
          <SkinAtlasEntry
            condition={entry()}
            details={props.details}
            findings={props.findings}
            links={props.linksFor(entry().id)}
            onOpenDocument={props.onOpenDocument}
          />
        )}
      </Show>
    </OverlayDialog>
  );
}

/** Conditions only a description reaches, with how much of it they show. */
export function SkinDescribedCards(props: {
  readonly matches: readonly { conditionId: string; matched: number; asked: number }[];
  readonly details: SkinDetails;
  readonly findings: SkinFindings;
  readonly onOpen: (conditionId: string) => void;
}): JSX.Element {
  const triggers = createMemo(() => activeTriggers(props.details, props.findings));
  return (
    <Show when={props.matches.length > 0}>
      <section class="skin-described" data-testid="skin-described">
        <h3 class="skin-described__title">По описанию</h3>
        <ul class="skin-described__list">
          <For each={props.matches}>
            {(match) => (
              <Show when={atlasCondition(match.conditionId)}>
                {(condition) => (
                  <li
                    class="skin-described__item"
                    data-testid="skin-described-item"
                    data-condition={match.conditionId}
                  >
                    <div class="skin-described__head">
                      <span class="skin-described__name">{condition().ru}</span>
                      <SkinDangerChip level={conditionDanger(condition(), triggers())} />
                    </div>
                    <span class="skin-described__share">
                      Совпадает {match.matched} из {match.asked}
                    </span>
                    <SkinArtStrip
                      condition={condition()}
                      onOpen={() => props.onOpen(match.conditionId)}
                    />
                  </li>
                )}
              </Show>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

const EVOLUTION_SAVE_DELAY_MS = 400;

function FindingChip(props: {
  readonly on: boolean;
  readonly label: string;
  readonly swatch?: string;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class="skin-chip"
      classList={{ 'skin-chip--on': props.on }}
      aria-pressed={props.on ? 'true' : 'false'}
      onClick={() => props.onToggle()}
    >
      <Show when={props.on}>
        <AppGlyph name="check" class="skin-chip__icon" />
      </Show>
      <Show when={props.swatch}>
        {(swatch) => (
          <span class="skin-chip__swatch" style={{ background: swatch() }} aria-hidden="true" />
        )}
      </Show>
      <span class="skin-chip__label">{props.label}</span>
    </button>
  );
}

/**
 * What the doctor sees, as tap chips: elements first; colours, signs and the course appear once an
 * element is chosen. The description ranks the conditions the photo model does not know and can
 * raise the danger through red flags; it never changes the model's percentages.
 */
export function SkinFindingsInput(props: {
  readonly findings: SkinFindings;
  readonly onChange: (next: SkinFindings) => void;
}): JSX.Element {
  const [evolution, setEvolution] = createSignal(props.findings.evolution ?? '');
  const saveEvolution = createDebouncer((text: string) => {
    const { evolution: _previous, ...rest } = props.findings;
    props.onChange(text.trim().length > 0 ? { ...rest, evolution: text } : rest);
  }, EVOLUTION_SAVE_DELAY_MS);
  const started = (): boolean => (props.findings.elements?.length ?? 0) > 0;
  return (
    <div class="skin-details skin-findings" data-testid="skin-findings">
      <div class="skin-details__group">
        <MultiPickField
          label="Что видно"
          placeholder="Выберите элементы"
          testId="skin-findings-elements"
          options={SKIN_ELEMENTS.map((element) => ({
            id: element,
            label: SKIN_ELEMENT_LABELS[element],
            selected: props.findings.elements?.includes(element) ?? false,
          }))}
          onToggle={(id) =>
            props.onChange({
              ...props.findings,
              elements: toggleFinding(SKIN_ELEMENTS, props.findings.elements, id),
            })
          }
        />
      </div>
      <Show when={started()}>
        <div class="skin-details__group">
          <MultiPickField
            label="Цвет"
            placeholder="Выберите цвет"
            testId="skin-findings-colors"
            options={SKIN_COLORS.map((color) => ({
              id: color,
              label: SKIN_COLOR_LABELS[color],
              swatch: SKIN_COLOR_SWATCHES[color],
              selected: props.findings.colors?.includes(color) ?? false,
            }))}
            onToggle={(id) =>
              props.onChange({
                ...props.findings,
                colors: toggleFinding(SKIN_COLORS, props.findings.colors, id),
              })
            }
          />
        </div>
        <fieldset class="skin-details__group">
          <legend class="skin-details__label">Признаки</legend>
          <div class="skin-details__chips">
            <For each={SKIN_SIGNS}>
              {(sign) => (
                <FindingChip
                  on={props.findings.signs?.includes(sign) ?? false}
                  label={SKIN_SIGN_LABELS[sign]}
                  onToggle={() =>
                    props.onChange({
                      ...props.findings,
                      signs: toggleFinding(SKIN_SIGNS, props.findings.signs, sign),
                    })
                  }
                />
              )}
            </For>
          </div>
        </fieldset>
        <TextArea
          class="skin-findings__evolution"
          label="Как менялись элементы"
          hideLabel
          rows={2}
          placeholder="Как появились и менялись элементы"
          value={evolution()}
          onInput={(event) => {
            setEvolution(event.currentTarget.value);
            saveEvolution.call(event.currentTarget.value);
          }}
        />
      </Show>
    </div>
  );
}
