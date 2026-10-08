import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import {
  medicationDownloadDisabled,
  medicationDownloadLabel,
} from '@/features/medications/medication-download-state';
import { useDrugDownload } from '@/features/medications/use-drug-download';

/**
 * «Скачать препараты» in place of an empty suggestion list: a drug name that finds nothing usually
 * means the medication packages are not on the device. Mounted only after a search came back empty,
 * so the module catalog is not loaded for a tool whose drugs are all installed.
 */
export function DrugCatalogOffer(props: {
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  const { state, failed, problem, active, start } = useDrugDownload(props.onContentChanged);
  const label = () =>
    medicationDownloadLabel({
      state: state(),
      failed: failed(),
      problem: problem(),
      active: active(),
    });
  // Nothing to offer once every package is installed: the name simply is not a drug of the catalog.
  const complete = () => state()?.plan.complete ?? false;

  return (
    <Show when={!complete()}>
      <Button
        type="button"
        variant="secondary"
        class="drug-interactions__catalog-offer"
        data-testid="interaction-catalog-offer"
        disabled={medicationDownloadDisabled({ state: state(), active: active() })}
        icon={
          <Show when={active()} fallback={<AppGlyph name="download" />}>
            <DownloadProgressMark
              state="running"
              progress={state()?.progress.byteProgress ?? null}
            />
          </Show>
        }
        onClick={() => void start()}
      >
        {label()}
      </Button>
    </Show>
  );
}
