import type { MeshBasicMaterial, MeshStandardMaterial } from 'three';
import type { Facing, StorageSlotState, ZoneCriteria } from '../../core/types';
import { outwardYaw, type CueLook } from '../builders/rack';
import { createCueMaterial, createGlowMaterial, createOverlayMaterial } from '../materials';
import type { SlotTone } from '../views/RackView';
import type { StorageBuildContext } from './types';

/* Pieces every skin's units share (docs/STORAGE.md: the same light, the same stickers, the same burst). */

/** Painted metal (a rack bay, a dock sign), one material per piece so each fades on its own: a touch more sheen. */
export function metalMaterial(ctx: StorageBuildContext): MeshStandardMaterial {
  const material = ctx.bag.track(ctx.mats.painted.clone());
  material.roughness = 0.72;
  return material;
}

/**
 * What a level's cue shows, the same on a rack's back panel and on a dock sign's cell: an unlit sticker in the exact
 * colour of the box it asks for, rimmed in that box's ink (the neutral cue fill and rim for a symbol only), with the
 * same mark as a zone (its symbol, or its colour's glyph in levels without symbols) drawn bold in the cue ink; `lip`
 * = the tape on a rack slot's front lip.
 */
export function cueLookOf(ctx: StorageBuildContext, cue: ZoneCriteria): CueLook {
  const r = ctx.theme.rack;
  const box = cue.color ? ctx.theme.boxes[cue.color] : null;
  return {
    fill: box ? box.base : r.cueFill,
    rim: box ? box.ink : r.cueRim,
    ink: r.cueInk,
    glyph: ctx.markOf(cue)?.shape ?? null,
    lip: box ? box.base : r.cueRim,
  };
}

/** The materials of one level's light (views/RackView SlotLight): its band, its panel's glow, its cue. */
export interface LevelLight {
  band: MeshBasicMaterial;
  panel: MeshStandardMaterial;
  cue: MeshBasicMaterial;
  /** Its tones once it holds its destined box. */
  destined: SlotTone | null;
}

/**
 * The light of a level with cue `cue`: the panel glows in its cue's own tone (the zone glow of its colour, or the
 * neutral one) and lights in the tones of the box it is about, the carried one while inviting, the destined one after.
 */
export function levelLightOf(ctx: StorageBuildContext, slot: StorageSlotState, cue: ZoneCriteria): LevelLight {
  const glow = cue.color ? ctx.theme.zones[cue.color].glow : ctx.theme.neutralZone.glow;
  const destined = slot.destined ? (ctx.slotTones.get(slot.destined.color) ?? null) : null;
  const band = createOverlayMaterial(ctx.bag, destined?.band ?? glow, 0, true);
  return { band, panel: createGlowMaterial(ctx.bag, glow), cue: createCueMaterial(ctx.bag), destined };
}

/**
 * The yaw that turns a level's local +z (out of its `facing` side, builders/rack outwardYaw) toward a camera at
 * `cameraYaw`: that face, or the one opposite (a cue reads from both; a unit may turn its back to the camera).
 */
export function yawTowardCamera(facing: Facing, cameraYaw: number): number {
  const front = outwardYaw(facing);
  const towardCamera = Math.sin(front) * Math.sin(cameraYaw) + Math.cos(front) * Math.cos(cameraYaw);
  return towardCamera >= 0 ? front : front + Math.PI;
}
