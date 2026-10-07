import type { JSX } from 'solid-js';
import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import {
  compactBreadcrumbItems,
  documentTrailBreadcrumbItems,
} from '@/components/app-breadcrumb-items';
import type { DocumentTrail } from '@/state/document-trail';

interface DocumentCrumbsProps {
  readonly trail: DocumentTrail;
  readonly onNavigate: (href: string) => void;
  /** The heading the page shows for itself; a last crumb repeating it is left out. */
  readonly pageTitle?: string | null;
}

export function DocumentCrumbs(props: DocumentCrumbsProps): JSX.Element {
  const compact = () =>
    compactBreadcrumbItems(documentTrailBreadcrumbItems(props.trail), props.pageTitle);
  return (
    <AppBreadcrumbs
      items={compact().items}
      allLinks={compact().allLinks}
      onNavigate={props.onNavigate}
    />
  );
}
