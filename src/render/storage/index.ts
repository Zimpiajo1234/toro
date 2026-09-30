import type { StorageSkin } from '../../core/types';
import { RACK_RENDER } from './rack';
import { TRUCK_RENDER } from './truck';
import type { StorageSkinRender } from './types';

/**
 * The storage skins registry of the render (docs/STORAGE.md «Contratos por capa», render): one entry per skin of
 * core/storage STORAGE_SKINS, which LevelView builds every unit of `level.storage` with (nothing else in the render
 * branches on a skin). Adding a skin = its entry here + its builders (docs/STORAGE.md «Cómo añadir un aspecto nuevo»).
 */
export const STORAGE_RENDER: { readonly [S in StorageSkin]: StorageSkinRender } = {
  rack: RACK_RENDER,
  truck: TRUCK_RENDER,
};

export { SUPPORT_LOOK, supportOf, type SupportLook } from './support';
export type {
  BeyondWall,
  BurstPlace,
  MarkerPlace,
  Occluder,
  StorageBuildContext,
  StorageSkinRender,
  StorageUnitBuilder,
  StorageUnitView,
} from './types';
