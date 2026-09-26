import type { JSX } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { openCalculator } from './calculator-links';
import { ECG_PHOTO_CALIPER_ID } from './calculator-registry';
import { EcgPhotoPicker } from './EcgPhotoPicker';
import { handOffEcgPhoto } from './ecg-photo-handoff';
import '@/styles/ecg-editor-flow.css';

/** Home entry: a photo goes straight into the local editor, which opens on its first step. */
export function EcgHomeEntry(): JSX.Element {
  return (
    <section class="ecg-home" aria-labelledby="ecg-home-title">
      <div class="ecg-home__copy">
        <span class="ecg-home__kicker">
          <AppGlyph class="ecg-home__kicker-icon" name="heartbeat" />
          Фото ЭКГ
        </span>
        <h2 class="ecg-home__title" id="ecg-home-title">
          ЭКГ по фото
        </h2>
        <p class="ecg-home__text">
          RR, ЧСС, PR, QRS, QT и QTc по снимку ленты. Разметку вы проверяете по шагам, фото не
          покидает устройство.
        </p>
      </div>
      <div class="ecg-home__actions">
        <EcgPhotoPicker
          stretch
          onFile={(file) => {
            handOffEcgPhoto(file);
            openCalculator(ECG_PHOTO_CALIPER_ID);
          }}
        />
        <a class="ecg-home__link" href={`#/calculators/${ECG_PHOTO_CALIPER_ID}`}>
          Как это работает
        </a>
      </div>
    </section>
  );
}
