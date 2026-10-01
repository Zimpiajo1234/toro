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
  /** The forklift's reverse beacon (one forklift per level: these are its own, faded by views/ForkliftView). */
  beacon: BeaconMaterials;
}

/**
 * The reverse beacon's light (views/ForkliftView): over its lens, its two turning beams and the glow on the floor
 * behind. Unlit, not tone mapped, vertex RGBA (the builder bakes the amber and its feathering: builders/forklift), no
 * depth write, front faces only (each piece faces up or out, and a double-sided transparent mesh costs two passes);
 * each fades on its own opacity (0 = off).
 */
export interface BeaconMaterials {
  lamp: MeshBasicMaterial;
  beam: MeshBasicMaterial;
  /** Floor overlay: pulled forward in depth like every other one (createOverlayMaterial), so it never z-fights. */
  glow: MeshBasicMaterial;
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
    beacon: { lamp: beaconMaterial(bag, false), beam: beaconMaterial(bag, false), glow: beaconMaterial(bag, true) },
  };
}

function beaconMaterial(bag: ResourceBag, floor: boolean): MeshBasicMaterial {
  return bag.track(
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: floor,
      polygonOffsetFactor: floor ? -2 : 0,
      polygonOffsetUnits: floor ? -2 : 0,
    }),
  );
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
 * Unlit, opaque, not tone mapped (a rack slot's cue): vertex colours exactly as painted, never shaded by the lights or
 * the shadows, never faded. Per instance: its colour scales above 1 to glow (views/RackView).
 */
export function createCueMaterial(bag: ResourceBag): MeshBasicMaterial {
  return bag.track(new MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
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
