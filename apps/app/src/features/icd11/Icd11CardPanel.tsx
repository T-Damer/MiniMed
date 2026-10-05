import type { MedicalDocument } from '@localmed/contracts';
import { createMemo, For, type JSX, Show } from 'solid-js';
import { Disclosure } from '@/components/Disclosure';
import {
  ICD11_PRACTICE_NOTE,
  ICD11_RELATION_LABELS,
  ICD11_RESULT_LABEL,
  type Icd11CrosswalkLink,
  type Icd11CrosswalkRelation,
  type Icd11DocumentLink,
  icd11Ancestors,
  icd11Children,
  icd11CrosswalkLinks,
} from '@/features/icd11/icd11-document';
import { openDocumentOverlay } from '@/state/document-navigation';
import { buildOfficialDocumentHash } from '@/state/document-route';
import '@/features/icd11/icd11-card-panel.css';

const RELATION_ORDER: readonly Icd11CrosswalkRelation[] = [
  'closest',
  'mapped-into-this',
  'mapped-into-this-multiple',
];

function openLink(event: MouseEvent, documentId: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  openDocumentOverlay(documentId);
}

function DocumentLinkItem(props: { readonly link: Icd11DocumentLink }): JSX.Element {
  return (
    <li class="icd11-card__item">
      <a
        class="icd11-card__link"
        href={buildOfficialDocumentHash(props.link.documentId)}
        onClick={(event) => openLink(event, props.link.documentId)}
      >
        {props.link.label}
      </a>
    </li>
  );
}

function CrosswalkItem(props: { readonly link: Icd11CrosswalkLink }): JSX.Element {
  return (
    <li class="icd11-card__item">
      <Show
        when={props.link.icd10DocumentId}
        fallback={<span class="icd11-card__code">{props.link.icd10Code}</span>}
      >
        {(target) => (
          <a
            class="icd11-card__link icd11-card__link--code"
            href={buildOfficialDocumentHash(target())}
            aria-label={`Открыть код МКБ-10 ${props.link.icd10Code}`}
            onClick={(event) => openLink(event, target())}
          >
            {props.link.icd10Code}
          </a>
        )}
      </Show>
      <Show when={props.link.icd10TitleEn}>
        <span class="icd11-card__title-en"> — {props.link.icd10TitleEn}</span>
      </Show>
      <Show when={props.link.cluster}>
        {(cluster) => (
          <span class="icd11-card__cluster">
            {' '}
            · код МКБ-11 с расширением <span class="icd11-card__code">{cluster()}</span>
          </span>
        )}
      </Show>
    </li>
  );
}

/**
 * Header of an ICD-11 card: the label that keeps it apart from ICD-10, the WHO hierarchy as links
 * and the WHO ICD-10 crosswalk. The classification text itself stays in the reader's own sections.
 */
export function Icd11CardPanel(props: { readonly document: MedicalDocument }): JSX.Element {
  const ancestors = createMemo(() => icd11Ancestors(props.document));
  const children = createMemo(() => icd11Children(props.document));
  const crosswalk = createMemo(() => icd11CrosswalkLinks(props.document));
  const relations = createMemo(() =>
    RELATION_ORDER.map((relation) => ({
      relation,
      links: crosswalk().filter((link) => link.relation === relation),
    })).filter((group) => group.links.length > 0),
  );
  return (
    <section class="icd11-card" aria-label={ICD11_RESULT_LABEL} data-testid="icd11-card-panel">
      <p class="icd11-card__notice" role="note">
        <strong class="icd11-card__badge">{ICD11_RESULT_LABEL}.</strong> {ICD11_PRACTICE_NOTE}
      </p>
      <Show when={ancestors().length > 0}>
        <nav class="icd11-card__group" aria-label="Вышестоящие рубрики МКБ-11">
          <h2 class="icd11-card__heading">Вышестоящие рубрики</h2>
          <ul class="icd11-card__list">
            <For each={ancestors()}>{(link) => <DocumentLinkItem link={link} />}</For>
          </ul>
        </nav>
      </Show>
      <Show when={children().length > 0}>
        <Disclosure
          class="icd11-card__disclosure"
          title="Нижестоящие рубрики"
          meta={<span class="icd11-card__count">{children().length}</span>}
        >
          <ul class="icd11-card__list">
            <For each={children()}>{(link) => <DocumentLinkItem link={link} />}</For>
          </ul>
        </Disclosure>
      </Show>
      <Show when={relations().length > 0}>
        <Disclosure
          class="icd11-card__disclosure"
          title="Соответствие МКБ-10 (таблицы ВОЗ)"
          defaultOpen
        >
          <p class="icd11-card__note">
            Это таблицы соответствия ВОЗ, а не перевод и не замена кода МКБ-10. Названия кодов
            МКБ-10 даны так, как их публикует ВОЗ (на английском языке).
          </p>
          <For each={relations()}>
            {(group) => (
              <div class="icd11-card__group">
                <h3 class="icd11-card__subheading">{ICD11_RELATION_LABELS[group.relation]}</h3>
                <ul class="icd11-card__list">
                  <For each={group.links}>{(link) => <CrosswalkItem link={link} />}</For>
                </ul>
              </div>
            )}
          </For>
        </Disclosure>
      </Show>
    </section>
  );
}
