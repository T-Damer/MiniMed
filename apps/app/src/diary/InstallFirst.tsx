import type { JSX } from 'solid-js';

import { Button } from '@/components/Button';
import { ScreenHeader } from '@/diary/diary-ui';
import { InstallGuide } from '@/diary/InstallGuide';
import { insideMessenger } from '@/diary/install-state';

/**
 * A connected diary's code opened where the diary would not stay: iPhone Safari (the home-screen
 * icon keeps storage of its own, and the code works once) or a messenger's browser. The code stays
 * in the address, so the icon saved now opens with it and connects there. Whoever cannot install
 * may still connect here.
 */
export function InstallFirst(props: { readonly onPairHere: () => void }): JSX.Element {
  return (
    <main class="diary-page diary-install-first">
      <ScreenHeader
        title={insideMessenger() ? 'Откройте дневник в браузере' : 'Сначала — на экран «Домой»'}
        subtitle="Дневник подключится, когда вы откроете его со значка"
      />
      <InstallGuide entries={0} />
      <Button class="diary-button" type="button" onClick={() => props.onPairHere()}>
        {insideMessenger() ? 'Подключить здесь' : 'Подключить здесь, в Safari'}
      </Button>
    </main>
  );
}
