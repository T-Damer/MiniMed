import { createMemo, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { RollingNumber } from '@/components/RollingNumber';
import { SkinArtStrip, SkinDangerChip } from '@/features/skin/SkinAtlas';
import { atlasCondition } from '@/features/skin/skin-atlas';
import type { SkinDangerLevel } from '@/features/skin/skin-atlas-terms';
import {
  SKIN_DOCUMENT_KIND_LABELS,
  type SkinDocumentLink,
  skinSearchHash,
} from '@/features/skin/skin-document-links';
import { icd10Text, type SkinResultView, type SkinStatusLine } from '@/features/skin/skin-results';

import '@/styles/skin-photo.css';

/** Documents shown under one condition; the rest are one search away. */
const LINKS_PER_RESULT = 3;

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * The first one to three conditions. Cards are keyed by condition, so a re-ranking moves the same
 * elements (the page animates it) instead of replacing them.
 */
export function SkinResultCards(props: {
  readonly views: readonly SkinResultView[];
  readonly linksFor: (classId: string) => readonly SkinDocumentLink[];
  readonly busy: boolean;
  readonly onOpenDocument: (documentId: string) => void;
  /** The condition's danger with the doctor's red flags applied; no chip when absent. */
  readonly dangerFor?: (classId: string) => SkinDangerLevel | undefined;
  /** Opens the atlas on a condition; no reference pictures when absent. */
  readonly onOpenAtlas?: (classId: string) => void;
  readonly listRef?: (element: HTMLOListElement) => void;
}): JSX.Element {
  const ids = createMemo((): readonly string[] => props.views.map((view) => view.classId), [], {
    equals: sameIds,
  });
  const byId = createMemo(() => new Map(props.views.map((view) => [view.classId, view])));
  return (
    <ol
      class="skin-results"
      classList={{ 'skin-results--busy': props.busy }}
      data-testid="skin-results"
      aria-busy={props.busy}
      ref={(element) => props.listRef?.(element)}
    >
      <For each={ids()}>
        {(classId) => {
          // Read through an accessor that tolerates the card leaving: `Show`'s own accessor throws
          // when it is read after its condition turned false.
          const view = (): SkinResultView | undefined => byId().get(classId);
          return (
            <li class="skin-result" data-testid="skin-result" data-class-id={classId}>
              <div class="skin-result__head">
                <h3 class="skin-result__name">{view()?.name}</h3>
                <span class="skin-result__percent">
                  <span class="skin-result__spoken">{view()?.percent}%</span>
                  <span class="skin-result__digits" aria-hidden="true">
                    <RollingNumber value={view()?.percent ?? 0} />%
                  </span>
                </span>
              </div>
              <div class="skin-result__track" aria-hidden="true">
                <span
                  class="skin-result__bar"
                  classList={{ 'skin-result__bar--malignant': view()?.malignant ?? false }}
                  style={{ '--skin-fill': String(view()?.fill ?? 0) }}
                />
              </div>
              <div class="skin-result__meta">
                <Show when={props.dangerFor?.(classId)}>
                  {(level) => <SkinDangerChip level={level()} />}
                </Show>
                <Show when={(view()?.icd10.length ?? 0) > 0}>
                  <p class="skin-result__codes">{icd10Text(view()?.icd10 ?? [])}</p>
                </Show>
              </div>
              <Show when={props.onOpenAtlas && atlasCondition(classId)}>
                {(condition) => (
                  <SkinArtStrip
                    condition={condition()}
                    onOpen={() => props.onOpenAtlas?.(classId)}
                  />
                )}
              </Show>
              <ul class="skin-result__links">
                <For each={props.linksFor(classId).slice(0, LINKS_PER_RESULT)}>
                  {(link) => (
                    <li class="skin-result__link-item">
                      <button
                        type="button"
                        class="skin-result__link"
                        data-testid="skin-document-link"
                        onClick={() => props.onOpenDocument(link.documentId)}
                      >
                        <AppGlyph name="file-text" class="skin-result__link-icon" />
                        <span class="skin-result__link-title">{link.title}</span>
                        <span class="skin-result__link-kind">
                          {SKIN_DOCUMENT_KIND_LABELS[link.kind]}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
                <li class="skin-result__link-item">
                  <a
                    class="skin-result__link skin-result__link--search"
                    href={skinSearchHash(view()?.name ?? '')}
                    data-testid="skin-search-link"
                  >
                    <AppGlyph name="search" class="skin-result__link-icon" />
                    <span class="skin-result__link-title">Искать в базе</span>
                  </a>
                </li>
              </ul>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

/** The facts about the ranking as a whole: the malignancy check and the model's doubt. */
export function SkinStatusLines(props: { readonly lines: readonly SkinStatusLine[] }): JSX.Element {
  return (
    <Show when={props.lines.length > 0}>
      <ul class="skin-status" data-testid="skin-status">
        <For each={props.lines}>
          {(line) => (
            <li
              class="skin-status__line"
              classList={{ 'skin-status__line--malignant': line.kind === 'malignant' }}
              data-kind={line.kind}
            >
              <AppGlyph
                name={line.kind === 'malignant' ? 'microscope' : 'info'}
                class="skin-status__icon"
              />
              {line.text}
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
