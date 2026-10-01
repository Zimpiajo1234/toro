import type { Box3, BufferGeometry, Group } from 'three';
import { isFrontUnit, type FrontUnit, type LevelStorage, type StorageSlotState } from '../../core/types';
import {
  PANEL_HEIGHT,
  SLOT_GLOW,
  addLoadingLines,
  buildRackBays,
  buildSlotCue,
  buildSlotGlowGeometry,
  buildSlotMarkerGeometry,
  buildSlotPanel,
  cueEndSides,
  outwardYaw,
} from '../builders/rack';
import type { FitBox } from '../CameraRig';
import { rackSlotY } from '../dims';
import { RackView, type RackBay, type SlotTone } from '../views/RackView';
import { cueLookOf, levelLightOf, metalMaterial, yawTowardCamera } from './common';
import type { BurstPlace, MarkerPlace, Occluder, StorageSkinRender, StorageUnitView } from './types';

/*
 * The `rack` skin (docs/RACKS.md): an adapter over builders/rack and views/RackView. A bay per column (its frame, the
 * panel of each slot with a cue, the see-through end plates of the end columns), fading on its own; the cue of each
 * such slot (the unlit sticker on both faces of its back panel and on its end plate, the tape on its front lip) and
 * its glow band; the loading line painted on the floor in front; the chosen-slot marker (views/SlotMarker) framing
 * the shelf the forks are set to.
 */

/** The unit as the rack builders read it, as it is: a rack is loaded from its front (validateLevel checks it). */
function rackOf(unit: LevelStorage): FrontUnit {
  if (!isFrontUnit(unit)) throw new Error(`storage unit ${unit.id}: a rack is loaded from its front`);
  return unit;
}

/** One rack on screen: its bays ghost (a box on one of its shelves with its bay), its slots light, the marker frames. */
class RackUnit implements StorageUnitView {
  readonly id: string;
  readonly group: Group;
  readonly bounds: Box3;
  readonly fitBox: FitBox;
  readonly occluders: readonly Occluder[];
  readonly beyondWall = null;
  /** The bay (column) holding each of its slots, «libre» ones too: a box resting there ghosts with it. */
  private readonly bayOfSlot = new Map<string, RackBay>();

  constructor(
    private readonly view: RackView,
    slots: readonly StorageSlotState[],
  ) {
    this.id = view.id;
    this.group = view.group;
    this.bounds = view.bounds;
    // Racks stand taller than the rest of the content: kept in frame whole.
    this.fitBox = { min: view.bounds.min.clone(), max: view.bounds.max.clone() };
    this.occluders = view.bays;
    for (const slot of slots) {
      const bay = view.bayOf(slot);
      if (bay) this.bayOfSlot.set(slot.id, bay);
    }
  }

  syncSlot(slot: StorageSlotState, invite: number, carried: SlotTone | null, time: number, dt: number): void {
    this.view.syncSlot(slot, invite, carried, time, dt);
  }

  playWave(slotId: string, delay: number): void {
    this.view.playWave(slotId, delay);
  }

  /** A ring around the slot's opening and sparkles out of it, at its floor, on the face the camera sees. */
  burstAt(slot: StorageSlotState, cameraYaw: number, out: BurstPlace): BurstPlace {
    out.x = slot.pos.x;
    out.y = rackSlotY(slot.level);
    out.z = slot.pos.z;
    out.yaw = yawTowardCamera(slot.facing, cameraYaw);
    out.halfW = SLOT_GLOW.halfW + 0.02;
    out.halfH = PANEL_HEIGHT / 2;
    return out;
  }

  /** The marker frames the slot's bay at its floor, turned to its front. */
  markerAt(slot: StorageSlotState, out: MarkerPlace): MarkerPlace {
    out.x = slot.pos.x;
    out.y = rackSlotY(slot.level);
    out.z = slot.pos.z;
    out.yaw = outwardYaw(slot.facing);
    return out;
  }

  hidesActorAt(slotId: string): boolean {
    return this.bayOfSlot.get(slotId)?.hidesActor ?? false;
  }
}

export const RACK_RENDER: StorageSkinRender = {
  /** The loading line in front of every column is paint on the floor. */
  paintFloor(floor, unit, level, theme) {
    addLoadingLines(floor, rackOf(unit), level, theme);
  },
  markerGeometry: buildSlotMarkerGeometry,
  builder(ctx) {
    // Shared by every rack of the level: one plain back panel and one glow band for all the slots with a cue, one cue
    // geometry per look and ends.
    let panel: BufferGeometry | null = null;
    let band: BufferGeometry | null = null;
    const cueByLook = new Map<string, BufferGeometry>();
    const frameMaterial = () => metalMaterial(ctx);
    return {
      build(unit, slots) {
        const rack = rackOf(unit);
        const bays = buildRackBays(rack, ctx.level, ctx.theme).map((g) => ctx.bag.track(g));
        const view = new RackView(unit.id, bays, frameMaterial, ctx.depthOnly, ctx.landDelay);
        for (const slot of slots) {
          const cue = slot.accepts;
          if (!cue) continue; // «libre»: its plain panel is part of the frame
          const look = cueLookOf(ctx, cue);
          const ends = cueEndSides(rack, slot.column);
          const key = `${look.fill}/${look.glyph ?? 'plain'}/${ends.join(',')}`;
          let cueGeometry = cueByLook.get(key);
          if (!cueGeometry) {
            cueGeometry = ctx.bag.track(buildSlotCue(look, ends));
            cueByLook.set(key, cueGeometry);
          }
          panel ??= ctx.bag.track(buildSlotPanel(ctx.theme));
          band ??= ctx.bag.track(buildSlotGlowGeometry());
          const light = levelLightOf(ctx, slot, cue);
          view.addSlot(slot, panel, light.panel, cueGeometry, light.cue, band, light.band, light.destined);
        }
        return new RackUnit(view, slots);
      },
    };
  },
};
