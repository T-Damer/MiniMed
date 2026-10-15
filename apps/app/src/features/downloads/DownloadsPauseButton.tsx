import { type JSX, Match, Switch } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import type { DownloadsPauseControl } from '@/features/downloads/use-downloads-pause';

/**
 * Pause or resume the module downloads. One icon button; the glyph is a new node per state, so the
 * short CSS fade-in plays on every switch (the state change cross-fades instead of jumping), and
 * the label is the accessible name.
 */
export function DownloadsPauseButton(props: {
  readonly pause: DownloadsPauseControl;
  readonly class?: string;
}): JSX.Element {
  const label = (): string =>
    props.pause.paused() ? 'Продолжить загрузки' : 'Приостановить загрузки';
  return (
    <Button
      class={`downloads-pause ${props.class ?? ''}`.trim()}
      variant="icon"
      aria-label={label()}
      title={label()}
      data-testid="downloads-pause-toggle"
      data-paused={props.pause.paused() ? 'true' : 'false'}
      icon={
        <Switch>
          <Match when={props.pause.paused()}>
            <AppGlyph name="play" class="downloads-pause__glyph" />
          </Match>
          <Match when={!props.pause.paused()}>
            <AppGlyph name="pause" class="downloads-pause__glyph" />
          </Match>
        </Switch>
      }
      onClick={() => props.pause.toggle()}
    />
  );
}
