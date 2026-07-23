import { ContentModuleCatalogSchema } from '@localmed/contracts';

import rawCatalog from './catalog.preview.json';

export const MODULE_CATALOG = ContentModuleCatalogSchema.parse(rawCatalog);

export const REMOTE_MODULE_CATALOG_URL =
  'https://github.com/T-Damer/MiniMed/releases/download/datasets-preview-1/catalog.preview.json';
