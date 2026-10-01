import type { StorageSkin } from '../../core/types';
import { BELT_IN_RENDER, BELT_OUT_RENDER } from './conveyor';
import { RACK_RENDER } from './rack';
import { TRUCK_RENDER } from './truck';
import type { StorageSkinRender } from './types';

/**
 * The storage skins registry of the render (docs/STORAGE.md «Contratos por capa», render): one entry per skin of
 * core/storage STORAGE_SKINS, which LevelView builds every unit of `level.storage` with (nothing else in the render
 * branches on a skin). Adding a skin = its entry here + its builders (docs/STORAGE.md «Cómo añadir un aspecto nuevo»).
 * A conveyor belt's two skins share one adapter (./conveyor: docs/CONVEYOR.md).
 */
export const STORAGE_RENDER: { readonly [S in StorageSkin]: StorageSkinRender } = {
  rack: RACK_RENDER,
  truck: TRUCK_RENDER,
  beltIn: BELT_IN_RENDER,
  beltOut: BELT_OUT_RENDER,
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
