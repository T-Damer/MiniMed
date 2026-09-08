import type { JSX } from 'solid-js';
import { NavBack } from '@/components/NavBack';
import { consumeAndRestoreReturnTo } from '@/state/return-navigation';
import { returnFromTool } from '@/state/tool-navigation';

export function AssessmentBackNav(props: {
  readonly sectionTitle?: string;
  readonly onBackToCatalog: () => void;
}): JSX.Element {
  return (
    <NavBack
      class="knowledge-back-button"
      aria-label="Назад"
      onClick={() => {
        if (!returnFromTool() && !consumeAndRestoreReturnTo()) props.onBackToCatalog();
      }}
    />
  );
}
