import type { AppBreadcrumbItem } from '@/components/AppBreadcrumbs';
import { isSameDocumentIdentity } from '@/state/document-identity';
import type { DocumentTrail, DocumentTrailCrumb } from '@/state/document-trail';

export interface CompactBreadcrumbs<T extends AppBreadcrumbItem> {
  readonly items: readonly T[];
  /** Every remaining crumb is a link: the page's own title is shown by the page heading. */
  readonly allLinks: boolean;
}

function sameLabel(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/\s+/gu, ' ').trim().toLowerCase();
  return normalize(left) === normalize(right);
}

/**
 * One crumb per document: a module pointer, a summary and the full text of one work are the same
 * document at different stages, so only the latest of them stays (the full variant that replaced
 * the short one). A trail saved by an older build can still hold both.
 */
function distinctDocumentCrumbs(
  crumbs: readonly DocumentTrailCrumb[],
): readonly DocumentTrailCrumb[] {
  return crumbs.filter(
    (crumb, index) =>
      !crumbs
        .slice(index + 1)
        .some((later) => later.kind === crumb.kind && isSameDocumentIdentity(later.id, crumb.id)),
  );
}

/** Crumbs of a document trail: the origin view, then every document that led here. */
export function documentTrailBreadcrumbItems(trail: DocumentTrail): readonly AppBreadcrumbItem[] {
  const crumbs: AppBreadcrumbItem[] = [{ label: trail.origin.label, href: trail.origin.hash }];
  const documents = distinctDocumentCrumbs(trail.crumbs);
  const lastIndex = documents.length - 1;
  for (const [index, crumb] of documents.entries()) {
    crumbs.push(
      index === lastIndex ? { label: crumb.title } : { label: crumb.title, href: crumb.href },
    );
  }
  return crumbs;
}

/**
 * A reader's header shows where the page sits («Поиск / …»), while the page heading already names
 * the document. Neighbouring crumbs with one title (a module pointer and the installed document it
 * became) collapse into one, and the last crumb is dropped when it repeats `pageTitle`, so the title
 * is not printed three times.
 */
export function compactBreadcrumbItems<T extends AppBreadcrumbItem>(
  items: readonly T[],
  pageTitle: string | null | undefined,
): CompactBreadcrumbs<T> {
  const collapsed: T[] = [];
  for (const item of items) {
    const previous = collapsed.at(-1);
    if (previous && sameLabel(previous.label, item.label)) {
      collapsed[collapsed.length - 1] = item;
    } else {
      collapsed.push(item);
    }
  }
  const last = collapsed.at(-1);
  if (pageTitle && collapsed.length > 1 && last && sameLabel(last.label, pageTitle)) {
    const rest = collapsed.slice(0, -1);
    if (rest.every((item) => item.href !== undefined)) return { items: rest, allLinks: true };
  }
  return { items: collapsed, allLinks: false };
}
