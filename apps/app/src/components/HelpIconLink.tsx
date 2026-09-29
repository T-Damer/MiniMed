import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

import './HelpIconLink.css';

/** A round «?» that opens an explanation, in place of a «Как это работает» text link. */
export function HelpIconLink(props: {
  readonly href: string;
  readonly label?: string;
  readonly class?: string;
}): JSX.Element {
  const label = (): string => props.label ?? 'Как это работает';
  return (
    <a
      class={`help-icon-link ${props.class ?? ''}`.trim()}
      href={props.href}
      aria-label={label()}
      title={label()}
    >
      <AppGlyph name="question" class="help-icon-link__icon" />
    </a>
  );
}
