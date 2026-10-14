import type { JSX } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { HelpIconLink } from '@/components/HelpIconLink';
import { openCalculator } from './calculator-links';
import { ECG_PHOTO_CALIPER_ID } from './calculator-registry';
import { EcgPhotoPicker } from './EcgPhotoPicker';
import { handOffEcgPhoto } from './ecg-photo-handoff';
import '@/styles/ecg-editor-flow.css';

/** Home entry: a photo goes straight into the local editor, which opens on its first step. */
export function EcgHomeEntry(): JSX.Element {
  return (
    <section class="ecg-home" aria-labelledby="ecg-home-title" data-tour="ecg-entry">
      <div class="ecg-home__head">
        <h2 class="ecg-home__title" id="ecg-home-title">
          <AppGlyph class="ecg-home__title-icon" name="heartbeat" />
          ЭКГ по фото
        </h2>
        <HelpIconLink href={`#/calculators/${ECG_PHOTO_CALIPER_ID}`} />
      </div>
      <p class="ecg-home__text">
        RR, ЧСС, PR, QRS, QT и QTc по снимку, фото остаётся на устройстве
      </p>
      <div class="ecg-home__actions">
        <EcgPhotoPicker
          stretch
          onFile={(file) => {
            handOffEcgPhoto(file);
            openCalculator(ECG_PHOTO_CALIPER_ID);
          }}
        />
      </div>
    </section>
  );
}
