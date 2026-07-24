import { ContentModuleCatalogSchema } from '@localmed/contracts';

import rawCatalog from './catalog.preview.json';

export const MODULE_CATALOG = ContentModuleCatalogSchema.parse(rawCatalog);

export const REMOTE_MODULE_CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json';
