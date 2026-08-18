import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';

export interface NavBackProps
  extends Pick<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-expanded' | 'title'> {
  readonly onClick: () => void;
  readonly 'aria-label': string;
  readonly class?: string;
  readonly icon?: JSX.Element;
}

export function NavBack(props: NavBackProps): JSX.Element {
  const { onClick, class: className, icon, ...buttonProps } = props;

  return (
    <Button
      {...buttonProps}
      type="button"
      variant="icon"
      class={className ?? 'knowledge-back-button'}
      aria-label={props['aria-label']}
      onClick={onClick}
      icon={icon ?? <AppGlyph name="arrow-left" />}
    />
  );
}
