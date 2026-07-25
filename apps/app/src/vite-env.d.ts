/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_MODEL_CATALOG_URL?: string;
  readonly VITE_LOCAL_MODEL_ASSET_BASE_URL?: string;
  readonly VITE_LOCAL_MODEL_ALLOW_UPSTREAM?: string;
  readonly VITE_LOCAL_MODEL_ALLOW_AUTOMATION_DOWNLOADS?: string;
  readonly VITE_LOCAL_MODEL_AUTOLOAD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
