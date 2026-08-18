import type { JSX } from 'solid-js';

import { type AppBreadcrumbItem, AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import type { DocumentTrail } from '@/state/document-trail';

interface DocumentCrumbsProps {
  readonly trail: DocumentTrail;
  readonly onNavigate: (href: string) => void;
}

export function DocumentCrumbs(props: DocumentCrumbsProps): JSX.Element {
  const items = (): readonly AppBreadcrumbItem[] => {
    const crumbs: AppBreadcrumbItem[] = [
      { label: props.trail.origin.label, href: props.trail.origin.hash },
    ];
    const lastIndex = props.trail.crumbs.length - 1;
    for (const [index, crumb] of props.trail.crumbs.entries()) {
      if (index === lastIndex) {
        crumbs.push({ label: crumb.title });
      } else {
        crumbs.push({ label: crumb.title, href: crumb.href });
      }
    }
    return crumbs;
  };

  return <AppBreadcrumbs items={items()} onNavigate={props.onNavigate} />;
}
