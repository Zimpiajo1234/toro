import {
  AdditiveBlending,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type ColorRepresentation,
} from 'three';
import type { ResourceBag } from './resources';

/**
 * Every mesh is vertex-colored, so a level needs only a few shared materials. Instances that animate
 * their own glow (boxes, zones) get a cheap per-instance material that compiles to the same program.
 */

const ROUGHNESS = 0.86;

export interface SharedMaterials {
  /** Soft, smooth-shaded matte (floor, walls, shelves, forklift). */
  painted: MeshStandardMaterial;
  /** Flat-shaded facets for foliage. */
  faceted: MeshStandardMaterial;
  /** Unlit, not tone mapped: window glass and headlight eyes. */
  unlit: MeshBasicMaterial;
  /** Additive, vertex-alpha light shafts (very faint). */
  shaft: MeshBasicMaterial;
}

export function createSharedMaterials(bag: ResourceBag): SharedMaterials {
  return {
    painted: bag.track(new MeshStandardMaterial({ vertexColors: true, roughness: ROUGHNESS, metalness: 0 })),
    faceted: bag.track(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true })),
    unlit: bag.track(new MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
    shaft: bag.track(
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    ),
  };
}

/** Painted material with its own emissive channel (glow animated per instance). */
export function createGlowMaterial(bag: ResourceBag, glow: ColorRepresentation): MeshStandardMaterial {
  return bag.track(
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: ROUGHNESS,
      metalness: 0,
      emissive: glow,
      emissiveIntensity: 0,
    }),
  );
}

/**
 * Flat translucent overlay drawn on the floor (rings, drop preview, halos).
 * `vertexAlpha` multiplies by an RGBA vertex color (feathered edges).
 */
export function createOverlayMaterial(
  bag: ResourceBag,
  color: ColorRepresentation,
  opacity = 0,
  vertexAlpha = false,
): MeshBasicMaterial {
  return bag.track(
    new MeshBasicMaterial({
      color,
      vertexColors: vertexAlpha,
      side: vertexAlpha ? DoubleSide : FrontSide,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
}
