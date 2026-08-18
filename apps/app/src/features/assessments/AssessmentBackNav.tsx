import type { JSX } from 'solid-js';
import { NavBackWithReturnTo } from '@/components/NavBackWithReturnTo';

export function AssessmentBackNav(props: {
  readonly sectionTitle?: string;
  readonly onBackToCatalog: () => void;
}): JSX.Element {
  return (
    <NavBackWithReturnTo
      catalogLabel="К каталогу тестов"
      catalogDetail={props.sectionTitle ?? 'Все опросники'}
      catalogIcon="list-checks"
      catalogAriaLabel="К каталогу тестов"
      onBackToCatalog={props.onBackToCatalog}
      chooserClass="assessment-back-chooser"
    />
  );
}
