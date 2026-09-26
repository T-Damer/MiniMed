import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, type JSX, Show } from 'solid-js';
import {
  parseModulePointerMetadata,
  selectModuleForPointer,
} from '@/features/modules/module-pointer-install';
import { SearchDownloadChip } from '@/features/search/SearchDownloadChip';
import type { SearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';

/**
 * A source pointer only proves that a full document exists in a published module; offer that exact
 * module (verified target membership) right in the result instead of naming its internal id.
 */
export function SearchResultModuleDownload(props: {
  readonly document: MedicalDocumentSummary | undefined;
  readonly downloads: SearchSectionDownloads;
}): JSX.Element {
  const module = createMemo(() => {
    const pointer = parseModulePointerMetadata(props.document?.metadata);
    return pointer ? selectModuleForPointer(pointer, props.downloads.catalog()) : null;
  });
  return (
    <Show when={module()}>
      {(target) => (
        <div class="result-group__action">
          <SearchDownloadChip
            label="Скачать полный текст"
            subject={target().title}
            modules={[target()]}
            downloads={props.downloads}
            accent
          />
        </div>
      )}
    </Show>
  );
}
