import { ContentPackSeedSchema } from '@localmed/contracts';
import rawContentPack from './generated/core-demo.json';

export const DEMO_CONTENT_PACK = ContentPackSeedSchema.parse(rawContentPack);
