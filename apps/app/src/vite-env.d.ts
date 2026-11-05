/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTENT_BASE_URL?: string;
  /** Public patient diary page; defaults to this site's diary/ or the published page. */
  readonly VITE_DIARY_PAGE_URL?: string;
  /** Origin of the connected diary service when it is not the page origin (native build, ADR-0027). */
  readonly VITE_DIARY_SERVER?: string;
  /** Patient page of the connected diary when it lives apart from the service (ADR-0027). */
  readonly VITE_DIARY_CONNECTED_PAGE_URL?: string;
  readonly VITE_LOCAL_MODEL_CATALOG_URL?: string;
  readonly VITE_LOCAL_MODEL_ASSET_BASE_URL?: string;
  readonly VITE_LOCAL_MODEL_ALLOW_UPSTREAM?: string;
  readonly VITE_LOCAL_MODEL_ALLOW_AUTOMATION_DOWNLOADS?: string;
  readonly VITE_LOCAL_MODEL_AUTOLOAD?: string;
  readonly VITE_USE_LOCAL_MODULE_ARTIFACTS?: string;
  /** A build for one job: always this app profile (`diaries` for the GitVerse copy of the diaries). */
  readonly VITE_APP_PROFILE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
